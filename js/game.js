// Game page (play.html): waiting room, joining, and the match itself.
// The page's URL says what to do: ?mode=host&rounds=3, ?mode=join&room=CODE,
// or ?mode=practice. The peer connection lives only as long as this page.
(() => {
  const $ = (s) => document.querySelector(s);

  const S = {
    mode: null,            // "solo" | "duel"
    role: null,            // "host" | "guest"
    myName: "You", oppName: "Rival",
    settings: { rounds: 3 },
    score: { host: 0, guest: 0 },
    roundNo: 0, usedQuotes: [],
    puzzle: null, guesses: {}, locked: new Set(), hinted: new Set(),
    cells: [], selected: -1,
    startTime: 0, timerId: null,
    active: false, roundOver: false, matchOver: false,
    hintsUsed: 0, hintPending: null, // null | "me" (I proposed) | "opp" (rival proposed)
  };

  const other = (r) => (r === "host" ? "guest" : "host");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  // ---------------------------------------------------------------- screens
  function show(id) {
    for (const el of document.querySelectorAll(".screen")) el.classList.toggle("hidden", el.id !== id);
  }

  function setMsg(el, text, kind) {
    el.textContent = text || "";
    el.className = !text ? "msg"
      : kind ? `msg alert alert-${kind === "bad" ? "danger" : "success"} py-1 px-2 small`
      : "msg small text-secondary";
  }
  const status = (t, k) => setMsg($("#status"), t, k);

  // ---------------------------------------------------------------- page start
  function backToLobby() {
    Net.leave();
    location.replace(AW.link("index.html"));
  }

  function needNet(el) {
    if (Net.available()) return true;
    el.innerHTML = "";
    setMsg(el, "Couldn't load the networking library. Check your connection and reload the page.", "bad");
    return false;
  }

  function hostRoom() {
    S.mode = "duel"; S.role = "host";
    const r = +AW.params.get("rounds");
    S.settings = { rounds: [1, 3, 5].includes(r) ? r : 3 };
    show("waiting");
    if (!needNet($("#wait-msg"))) return;
    Net.host({
      ready(code) {
        $("#room-code").textContent = code;
        $("#room-link").value = new URL(AW.link("index.html", { room: code }), location.href).href;
        $("#wait-msg").innerHTML = '<span class="spinner-border spinner-border-sm text-primary me-1"></span> Waiting for an opponent to join…';
      },
      open() {
        setMsg($("#wait-msg"), "A rival approaches…", "good");
        Net.send({ t: "hello", name: S.myName, settings: S.settings });
      },
      data: onMessage,
      close: onDisconnect,
      error(e) {
        const text = "Connection trouble: " + (e.type || e.message || e);
        setMsg(S.puzzle ? $("#status") : $("#wait-msg"), text, "bad");
      },
    });
  }

  function joinRoom() {
    S.mode = "duel"; S.role = "guest";
    const code = (AW.params.get("room") || "").toUpperCase();
    show("joining");
    $("#join-room").textContent = code;
    $("#btn-back-lobby").href = AW.link("index.html", { room: code });
    if (!needNet($("#join-msg"))) return;
    if (!/^[A-Z0-9]{4}$/.test(code)) return setMsg($("#join-msg"), "That room code doesn't look right.", "bad");
    Net.join(code, {
      open() { Net.send({ t: "hello", name: S.myName }); },
      data: onMessage,
      close: onDisconnect,
      error(e) {
        const text = e.type === "peer-unavailable" ? `No open room with code ${code}.`
          : e.type === "timeout" ? (Net.hasRelay()
            ? "Found the room but couldn't connect, even through the relay. Check your internet connection and try again."
            : "Found the room but couldn't open a direct line to it. A VPN or strict firewall on either side is the usual cause. Try turning it off, or use a different network.")
          : "Connection trouble: " + (e.type || e.message || e);
        setMsg(S.puzzle ? $("#status") : $("#join-msg"), text, "bad");
      },
    });
  }

  function onDisconnect() {
    if (S.mode !== "duel") return;
    if (!S.puzzle) { // left before the match started
      if (S.role === "host") $("#wait-msg").innerHTML = '<span class="spinner-border spinner-border-sm text-primary me-1"></span> Your opponent left. Waiting for someone else…';
      else setMsg($("#join-msg"), "The host closed the room.", "bad");
      return;
    }
    stopTimer();
    S.active = false;
    showResult("Opponent Disconnected", `${S.oppName} has left the room.`, [["Back to Lobby", backToLobby]]);
  }

  // ---------------------------------------------------------------- messages
  function onMessage(m) {
    switch (m.t) {
      case "hello":
        S.oppName = String(m.name || "Rival").slice(0, 16);
        if (S.role === "guest") S.settings = m.settings;
        else startMatch();
        break;
      case "full":
        setMsg($("#join-msg"), "That room already has two players.", "bad");
        break;
      case "round":
        beginRound(m);
        break;
      case "progress":
        setBar("opp", m.pct);
        break;
      case "solved": // guest -> host
        if (S.role === "host" && m.n === S.roundNo) resolveRound("guest", m.time, "solved");
        break;
      case "forfeit": // guest -> host
        if (S.role === "host" && m.n === S.roundNo) resolveRound("host", null, "forfeit");
        break;
      case "roundEnd": // host -> guest
        applyRoundEnd(m);
        break;
      case "hintAsk":
        if (m.n === S.roundNo) onHintAsk();
        break;
      case "hintAgree": // guest -> host
        if (S.role === "host" && m.n === S.roundNo && S.hintPending === "me") refereeHint();
        break;
      case "hintDecline":
        if (m.n === S.roundNo && S.hintPending === "me") {
          S.hintPending = null;
          status(`${S.oppName} declined the hint.`, "bad");
          refresh();
        }
        break;
      case "hintGive": // host -> guest
        if (m.n === S.roundNo) giveHint(m.c);
        break;
      case "rematch":
        if (S.role === "host" && S.matchOver) startMatch();
        break;
    }
  }

  // ---------------------------------------------------------------- match flow (host is referee)
  function startMatch() {
    S.score = { host: 0, guest: 0 };
    S.roundNo = 0;
    S.matchOver = false;
    nextRound();
  }

  function pickQuote() {
    if (S.usedQuotes.length >= QUOTES.length) S.usedQuotes = [];
    let qi;
    do { qi = Math.floor(Math.random() * QUOTES.length); } while (S.usedQuotes.includes(qi));
    S.usedQuotes.push(qi);
    return qi;
  }

  function nextRound() {
    S.roundNo++;
    const m = { t: "round", n: S.roundNo, qi: pickQuote(), seed: randomSeed(), settings: S.settings, score: S.score };
    if (S.mode === "duel") Net.send(m);
    beginRound(m);
  }

  function winsNeeded() { return Math.floor(S.settings.rounds / 2) + 1; }

  function resolveRound(winner, time, reason) {
    if (S.roundOver) return;
    const score = { ...S.score };
    score[winner]++;
    const matchOver = score[winner] >= winsNeeded();
    const m = { t: "roundEnd", n: S.roundNo, winner, time, reason, score, matchOver };
    Net.send(m);
    applyRoundEnd(m);
  }

  function applyRoundEnd(m) {
    S.roundOver = true; S.active = false;
    clearHintRequest();
    S.score = m.score; S.matchOver = m.matchOver;
    stopTimer();
    revealSolution();
    updateScoreboard();

    const iWon = m.winner === S.role;
    const wName = iWon ? "You" : S.oppName;
    const how = m.reason === "forfeit"
      ? `${iWon ? S.oppName + " gave up" : "You gave up"}.`
      : `${wName} cracked it in ${fmt(m.time)}.`;
    const tally = `${S.myName} ${S.score[S.role]} – ${S.score[other(S.role)]} ${S.oppName}`;
    const hints = S.hintsUsed ? ` Shared hints: ${S.hintsUsed}.` : "";

    if (m.matchOver) {
      const btn = S.role === "host"
        ? [["Rematch", startMatch]]
        : [["Ask for Rematch", () => { Net.send({ t: "rematch" }); status("Rematch requested…"); }]];
      showResult(iWon ? "Victory!" : "Defeat", `${how}${hints} Final score: ${tally}.`, [...btn, ["Leave", backToLobby]]);
    } else {
      const btn = S.role === "host" ? [["Next Round", nextRound]] : [];
      showResult(iWon ? "Round Won" : "Round Lost",
        `${how}${hints} Score: ${tally}.${S.role === "guest" ? " Waiting for the host to start the next round…" : ""}`, btn);
    }
  }

  // ---------------------------------------------------------------- solo
  function startSolo() {
    S.mode = "solo"; S.role = "host";
    S.settings = { rounds: 1 };
    document.body.classList.add("solo");
    nextRound();
  }

  function soloSolved(time) {
    S.roundOver = true; S.active = false;
    stopTimer();
    revealSolution();
    const used = S.hintsUsed;
    showResult("Solved!", `You cracked it in ${fmt(time)}${used ? ` with ${used} hint${used > 1 ? "s" : ""}` : " without hints"}.`,
      [["New Puzzle", nextRound], ["Lobby", backToLobby]]);
  }

  // ---------------------------------------------------------------- round setup
  function beginRound(m) {
    S.roundNo = m.n;
    S.settings = m.settings;
    S.score = m.score;
    S.matchOver = false;
    S.puzzle = buildPuzzle(m.qi, m.seed);
    S.guesses = {}; S.locked = new Set(); S.hinted = new Set();
    S.hintsUsed = 0;
    clearHintRequest();
    S.roundOver = false; S.active = false; S.selected = -1;

    show("game");
    $("#result").classList.add("hidden");
    status("");
    $("#me-name").textContent = S.myName;
    $("#opp-name").textContent = S.oppName;
    $("#round-label").textContent = S.mode === "solo"
      ? "Practice"
      : `Round ${S.roundNo} · first to ${winsNeeded()}`;
    $("#timer").textContent = "0:00";
    $("#source").textContent = "— " + S.puzzle.author;
    updateScoreboard();
    setBar("opp", 0);
    renderBoard();
    renderFreq();

    countdown(3, () => {
      S.active = true;
      S.startTime = Date.now();
      startTimer();
      refresh();
      status("Go! Click any box to start.");
    });
  }

  function countdown(n, done) {
    const ov = $("#overlay"), txt = $("#overlay-text");
    ov.classList.remove("hidden");
    const tick = () => {
      if (n === 0) { ov.classList.add("hidden"); done(); return; }
      txt.textContent = n--;
      setTimeout(tick, 800);
    };
    tick();
  }

  function startTimer() {
    stopTimer();
    S.timerId = setInterval(() => {
      $("#timer").textContent = fmt(elapsed());
    }, 200);
  }
  function stopTimer() { clearInterval(S.timerId); S.timerId = null; }
  const elapsed = () => (Date.now() - S.startTime) / 1000;

  // ---------------------------------------------------------------- board
  function renderBoard() {
    const board = $("#board");
    board.innerHTML = "";
    S.cells = [];
    for (const w of S.puzzle.cipherText.split(" ")) {
      const wd = document.createElement("div");
      wd.className = "word";
      for (const ch of w) {
        const cell = document.createElement("div");
        if (S.puzzle.sol[ch]) {
          const i = S.cells.length;
          cell.className = "cell letter";
          cell.dataset.c = ch;
          cell.innerHTML = `<span class="guess"></span><span class="ciph">${ch}</span>`;
          cell.addEventListener("click", () => select(i));
          S.cells.push(cell);
        } else {
          cell.className = "cell punct";
          cell.innerHTML = `<span class="guess">${esc(ch)}</span><span class="ciph">&nbsp;</span>`;
        }
        wd.appendChild(cell);
      }
      board.appendChild(wd);
    }
    refresh();
  }

  function refresh() {
    const selC = S.selected >= 0 ? S.cells[S.selected].dataset.c : null;
    S.cells.forEach((cell, i) => {
      const c = cell.dataset.c;
      cell.querySelector(".guess").textContent = S.roundOver ? S.puzzle.sol[c] : S.guesses[c] || "";
      cell.classList.toggle("selected", i === S.selected && !S.roundOver);
      cell.classList.toggle("same", c === selC && !S.roundOver);
      cell.classList.toggle("given", S.locked.has(c));
      cell.classList.toggle("hinted", S.hinted.has(c));
    });
    const used = new Set(Object.values(S.guesses));
    $("#remaining").innerHTML = [...ALPHA].map((l) => `<span class="${used.has(l) ? "used" : ""}">${l}</span>`).join("");
    const noneLeft = !S.puzzle || S.puzzle.letters.every((c) => S.locked.has(c));
    $("#btn-hint").textContent = S.mode === "solo" ? "Reveal a Letter" : S.hintPending === "me" ? "Hint Proposed…" : "Propose a Hint";
    $("#btn-hint").disabled = !S.active || !!S.hintPending || noneLeft;
    $("#btn-giveup").disabled = !S.active;
  }

  // Two-row table under the puzzle: each code letter and how many times it appears.
  function renderFreq() {
    const counts = {};
    for (const ch of S.puzzle.cipherText) if (S.puzzle.sol[ch]) counts[ch] = (counts[ch] || 0) + 1;
    const letters = [...ALPHA];
    $("#freq").innerHTML =
      `<tr><th>Letter</th>${letters.map((l) => `<td>${l}</td>`).join("")}</tr>` +
      `<tr><th>Count</th>${letters.map((l) => `<td class="${counts[l] ? "" : "zero"}">${counts[l] || 0}</td>`).join("")}</tr>`;
  }

  function select(i) {
    if (i < 0 || i >= S.cells.length || S.roundOver) return;
    S.selected = i;
    refresh();
  }

  function firstOpenIndex(from) {
    const n = S.cells.length;
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (!S.guesses[S.cells[i].dataset.c]) return i;
    }
    return from < n ? from : 0;
  }

  const canEdit = () => S.active && S.selected >= 0;

  function assign(p) {
    if (!canEdit()) return;
    const c = S.cells[S.selected].dataset.c;
    if (S.locked.has(c)) return status("That letter is already fixed in place.");
    const owner = Object.keys(S.guesses).find((k) => S.guesses[k] === p && k !== c);
    if (owner && S.locked.has(owner)) return status(`${p} is already fixed elsewhere in the puzzle.`, "bad");
    if (owner) delete S.guesses[owner]; // a plaintext letter can only stand for one code letter
    S.guesses[c] = p;
    status("");
    S.selected = firstOpenIndex(S.selected + 1);
    afterChange();
  }

  function clearCurrent() {
    if (!canEdit()) return;
    const c = S.cells[S.selected].dataset.c;
    if (S.locked.has(c)) return;
    delete S.guesses[c];
    afterChange();
  }

  function move(d) {
    if (S.selected < 0) return select(0);
    select((S.selected + d + S.cells.length) % S.cells.length);
  }

  function afterChange() {
    refresh();
    const pct = progressPct();
    setBar("me", pct);
    if (S.mode === "duel") Net.send({ t: "progress", pct });
    checkComplete();
  }

  function progressPct() {
    const { letters, sol } = S.puzzle;
    const right = letters.filter((c) => S.guesses[c] === sol[c]).length;
    return Math.round((100 * right) / letters.length);
  }

  function setBar(who, pct) {
    $(`#${who}-bar`).style.width = pct + "%";
    $(`#${who}-pct`).textContent = pct + "%";
  }

  function checkComplete() {
    const { letters, sol } = S.puzzle;
    if (!letters.every((c) => S.guesses[c])) return;
    if (!letters.every((c) => S.guesses[c] === sol[c])) {
      return status("Every letter is filled in, but something isn't right yet.", "bad");
    }
    const time = elapsed();
    S.active = false;
    stopTimer();
    $("#timer").textContent = fmt(time);
    if (S.mode === "solo") return soloSolved(time);
    if (S.role === "host") resolveRound("host", time, "solved");
    else { Net.send({ t: "solved", n: S.roundNo, time }); status("Solved! Checking with the referee…", "good"); refresh(); }
  }

  // Hints: free in practice. In a duel either player may propose one at any
  // time; if the other agrees, the host picks a letter and it is revealed on
  // BOTH boards, so a hint never gives one side an edge.
  function hint() {
    if (!S.active || S.hintPending) return;
    if (S.mode === "solo") return giveHint(pickHintLetter());
    S.hintPending = "me";
    Net.send({ t: "hintAsk", n: S.roundNo });
    status(`Hint proposed. Waiting for ${S.oppName} to agree…`);
    refresh();
  }

  function onHintAsk() {
    if (S.roundOver) return;
    if (S.hintPending === "me") { // both proposed at once: that's agreement
      if (S.role === "host") refereeHint();
      return;
    }
    S.hintPending = "opp";
    $("#hint-prompt-text").textContent = `${S.oppName} proposes a hint. One letter will be revealed for both of you. Agree?`;
    $("#hint-prompt").classList.remove("hidden");
    refresh();
  }

  function answerHint(yes) {
    if (S.hintPending !== "opp") return;
    clearHintRequest();
    if (!yes) {
      Net.send({ t: "hintDecline", n: S.roundNo });
      status("You declined the hint.");
      return refresh();
    }
    if (S.role === "host") refereeHint();
    else { Net.send({ t: "hintAgree", n: S.roundNo }); status("Hint agreed. Revealing…"); }
  }

  function refereeHint() {
    const c = pickHintLetter();
    Net.send({ t: "hintGive", n: S.roundNo, c });
    giveHint(c);
  }

  function pickHintLetter() {
    const open = S.puzzle.letters.filter((c) => !S.locked.has(c));
    return open.length ? open[Math.floor(Math.random() * open.length)] : null;
  }

  function clearHintRequest() {
    S.hintPending = null;
    $("#hint-prompt").classList.add("hidden");
  }

  function giveHint(c) {
    clearHintRequest();
    if (!c || S.roundOver) return refresh();
    const p = S.puzzle.sol[c];
    for (const k of Object.keys(S.guesses)) if (S.guesses[k] === p) delete S.guesses[k];
    S.guesses[c] = p;
    S.locked.add(c); S.hinted.add(c);
    S.hintsUsed++;
    status(`Hint: ${c} stands for ${p}.`, "good");
    if (S.active) afterChange(); else refresh();
  }

  function giveUp() {
    if (!S.active) return;
    S.active = false;
    if (S.mode === "solo") {
      S.roundOver = true; stopTimer(); revealSolution();
      return showResult("Revealed", "Better luck with the next one.", [["New Puzzle", nextRound], ["Lobby", backToLobby]]);
    }
    if (S.role === "host") resolveRound("guest", null, "forfeit");
    else Net.send({ t: "forfeit", n: S.roundNo });
  }

  function revealSolution() {
    const { sol } = S.puzzle;
    S.roundOver = true;
    S.cells.forEach((cell) => {
      const c = cell.dataset.c, g = S.guesses[c];
      cell.classList.toggle("wrong", !!g && g !== sol[c]);
      cell.classList.toggle("revealed", !g);
    });
    refresh();
    status("");
  }

  function updateScoreboard() {
    $("#me-score").textContent = S.score[S.role] ?? 0;
    $("#opp-score").textContent = S.score[other(S.role)] ?? 0;
  }

  function showResult(title, text, buttons) {
    $("#result-title").textContent = title;
    $("#result-text").textContent = text;
    const box = $("#result-buttons");
    box.innerHTML = "";
    buttons.forEach(([label, fn], i) => {
      const b = document.createElement("button");
      const quiet = /leave|lobby/i.test(label);
      b.className = "btn " + (quiet ? "btn-light border" : i === 0 ? "btn-success btn-lg aw-pulse" : "btn-primary");
      b.textContent = label;
      b.onclick = fn;
      box.appendChild(b);
    });
    $("#result").classList.remove("hidden");
    refresh();
  }

  // ---------------------------------------------------------------- input
  function buildKeyboard() {
    const kbd = $("#kbd");
    for (const row of ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]) {
      const r = document.createElement("div");
      r.className = "kbd-row";
      for (const l of row) {
        const b = document.createElement("button");
        b.className = "btn btn-light border";
        b.textContent = l;
        b.onclick = () => assign(l);
        r.appendChild(b);
      }
      if (row === "ZXCVBNM") {
        const b = document.createElement("button");
        b.className = "btn btn-light border wide"; b.textContent = "⌫";
        b.onclick = clearCurrent;
        r.appendChild(b);
      }
      kbd.appendChild(r);
    }
  }

  function initGameControls() {
    buildKeyboard();
    $("#btn-hint").onclick = hint;
    $("#btn-hint-yes").onclick = () => answerHint(true);
    $("#btn-hint-no").onclick = () => answerHint(false);
    $("#btn-giveup").onclick = giveUp;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    $("#opt-kbd").checked = touch;
    $("#kbd").classList.toggle("hidden", !touch);
    $("#opt-kbd").onchange = (e) => $("#kbd").classList.toggle("hidden", !e.target.checked);

    document.addEventListener("keydown", (e) => {
      if ($("#game").classList.contains("hidden")) return;
      if (e.target.matches && e.target.matches("input, select, textarea") && e.target.type !== "checkbox") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (/^[a-zA-Z]$/.test(k)) { assign(k.toUpperCase()); e.preventDefault(); }
      else if (k === "Backspace" || k === "Delete" || k === " ") { clearCurrent(); e.preventDefault(); }
      else if (k === "ArrowRight") { move(1); e.preventDefault(); }
      else if (k === "ArrowLeft") { move(-1); e.preventDefault(); }
    });
  }

  function initPageControls() {
    for (const el of document.querySelectorAll(".js-leave")) {
      el.onclick = (e) => { e.preventDefault(); backToLobby(); };
    }
    $("#btn-copy").onclick = () => {
      const inp = $("#room-link");
      inp.select();
      (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject())
        .then(() => ($("#btn-copy").textContent = "Copied!"))
        .catch(() => document.execCommand("copy"));
    };
    // Leaving the page (back button, closing the tab) ends the connection
    // right away so the opponent is told.
    addEventListener("pagehide", () => Net.leave());
  }

  initGameControls();
  initPageControls();

  const mode = AW.params.get("mode");
  S.myName = AW.getName() || (mode === "join" ? "Guest" : "Solver");
  if (mode === "host" || mode === "join") {
    $('.aw-nav a[data-page="index.html"]').classList.add("active");
    if (mode === "host") hostRoom(); else joinRoom();
  }
  else {
    $("#nav-practice").classList.add("active");
    document.title = "Practice - AristoWars";
    startSolo();
  }
})();
