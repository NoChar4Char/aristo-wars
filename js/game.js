// Game page (play.html): waiting room, joining, and the match itself.
// The URL says what to do: ?mode=host&rules=..., ?mode=join&room=CODE, or
// ?mode=practice. The peer connections live only as long as this page.
//
// Up to 6 players. The host's browser is the referee: it picks each puzzle,
// tracks everyone's progress, runs the time limit and grace period, counts
// hint votes and scores each round. Guests only talk to the host.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  const cleanName = (n) => String(n || "Player").trim().slice(0, 16) || "Player";

  const S = {
    mode: null,            // "solo" | "multi"
    role: null,            // "host" | "guest"
    myId: null, myName: "",
    rules: null,
    players: [],           // [{ id, name, left }] in join order, host first
    totals: {},            // id -> points so far
    phase: "lobby",        // lobby | round | roundEnd | matchEnd
    roundNo: 0, usedQuotes: [],
    puzzle: null, guesses: {}, locked: new Set(), hinted: new Set(),
    cellGuess: [],         // per-box guesses, used when autofill is off
    cells: [], cellsOf: {}, selected: -1,
    letterCase: "either",  // personal preference: upper | lower | either
    startTime: 0, timerId: null, limitEndsAt: 0, graceEndsAt: 0,
    active: false, roundOver: false, hintsUsed: 0,
    status: {},            // id -> { state: solving|solved|gaveup|left, pct, left, time }
    vote: null, myVote: null, // current hint vote: { by, yes: [ids], needed }
    rejected: false,
    ref: null,             // host only: { graceTimer, limitTimer, vote, firstSolved }
  };

  const isHost = () => S.role === "host";
  const multi = () => S.mode === "multi";
  const activePlayers = () => S.players.filter((p) => !p.left);
  const disp = (ch) => (ch && S.letterCase === "lower" ? ch.toLowerCase() : ch);
  const nameOf = (id) => (id === S.myId ? "You" : (S.players.find((p) => p.id === id) || {}).name || "Someone");

  // ---------------------------------------------------------------- screens
  function show(id) {
    for (const el of $$(".screen")) el.classList.toggle("hidden", el.id !== id);
  }

  function setMsg(el, text, kind) {
    el.textContent = text || "";
    el.className = !text ? "msg"
      : kind ? `msg alert alert-${kind === "bad" ? "danger" : "success"} py-1 px-2 small`
      : "msg small text-secondary";
  }
  const status = (t, k) => setMsg($("#status"), t, k);
  const spin = (text) => `<span class="spinner-border spinner-border-sm text-primary me-1"></span> ${esc(text)}`;

  function backToLobby() {
    Net.leave();
    location.replace(AW.link("index.html"));
  }

  function needNet(el) {
    if (Net.available()) return true;
    setMsg(el, "Couldn't load the networking library. Check your connection and reload the page.", "bad");
    return false;
  }

  // ---------------------------------------------------------------- waiting room
  function renderRules() {
    const html = Settings.summary(S.rules).map(([k, v]) =>
      `<li class="list-group-item py-1"><b>${esc(k)}:</b> ${esc(v)}</li>`).join("");
    for (const el of $$(".js-rules")) el.innerHTML = html;
  }

  function renderLobbyPlayers() {
    const html = activePlayers().map((p) => `
      <li class="list-group-item d-flex align-items-center gap-2 py-1">
        <span class="flex-grow-1 text-truncate">${esc(p.name)}</span>
        ${p.id === "host" ? '<span class="badge text-bg-warning">Host</span>' : ""}
        ${p.id === S.myId ? '<span class="badge text-bg-secondary">You</span>' : ""}
      </li>`).join("");
    for (const el of $$(".js-players")) el.innerHTML = html;
    for (const el of $$(".js-count")) el.textContent = S.rules ? `(${activePlayers().length} of ${S.rules.players})` : "";
    if (isHost()) {
      const n = activePlayers().length;
      $("#btn-start").disabled = n < 2;
      $("#wait-msg").innerHTML = n < 2 ? spin("Waiting for players to join…")
        : `<span class="text-success fw-bold">${n} players here.</span> ${n < S.rules.players ? "Start now, or wait for more." : "The room is full. Start when ready!"}`;
    }
  }

  function applyRoster(m) {
    S.players = m.players;
    renderLobbyPlayers();
    renderPlayers();
  }

  // ---------------------------------------------------------------- host setup
  function hostRoom() {
    const rules = Settings.decode(AW.params.get("rules") || "");
    if (!rules) { location.replace(AW.link("create.html")); return; }
    S.mode = "multi"; S.role = "host"; S.myId = "host"; S.rules = rules;
    S.players = [{ id: "host", name: S.myName }];
    show("waiting");
    renderRules();
    renderLobbyPlayers();
    $("#wait-msg").innerHTML = spin("Opening a room…");
    if (!needNet($("#wait-msg"))) return;
    Net.host({
      ready(code) {
        $("#room-code").textContent = code;
        $("#room-link").value = new URL(AW.link("index.html", { room: code }), location.href).href;
        renderLobbyPlayers();
      },
      accept: (count) => S.phase === "lobby" && count < S.rules.players - 1,
      data: onHostData,
      leave: onPlayerLeft,
      error(e) {
        const text = "Connection trouble: " + (e.type || e.message || e);
        setMsg(S.puzzle ? $("#status") : $("#wait-msg"), text, "bad");
      },
    });
  }

  function broadcastRoster() {
    const m = { t: "roster", players: S.players };
    Net.send(m);
    applyRoster(m);
  }

  function onHostData(id, m) {
    const known = S.players.some((p) => p.id === id);
    if (m.t === "hello") {
      if (known || S.phase !== "lobby") return;
      S.players.push({ id, name: cleanName(m.name) });
      Net.sendTo(id, { t: "welcome", you: id, rules: S.rules });
      broadcastRoster();
      return;
    }
    if (!known || m.n !== S.roundNo) return;
    switch (m.t) {
      case "progress": hostProgress(id, m.pct, m.left); break;
      case "solved": hostSolved(id, m.time); break;
      case "gaveUp": hostGaveUp(id); break;
      case "hintAsk": hostHintAsk(id); break;
      case "hintVote": hostHintVote(id, !!m.yes); break;
    }
  }

  function onPlayerLeft(id) {
    const p = S.players.find((x) => x.id === id);
    if (!p) return;
    if (S.phase === "lobby") {
      S.players = S.players.filter((x) => x.id !== id);
      return broadcastRoster();
    }
    p.left = true;
    broadcastRoster();
    if (S.phase === "round" && !S.roundOver) {
      hostSetStatus(id, { ...(S.status[id] || {}), state: "left" });
      if (activePlayers().length < 2) return endRound("abandon");
      if (S.ref.vote) hostCheckVote();
      hostCheckAllDone();
    } else if (activePlayers().length < 2) {
      showResult("Everyone Else Left", "There's no one left to play against.", [["Back to Lobby", backToLobby]]);
    }
  }

  // ---------------------------------------------------------------- guest setup
  function joinRoom() {
    S.mode = "multi"; S.role = "guest";
    const code = (AW.params.get("room") || "").toUpperCase();
    show("joining");
    $("#join-room").textContent = code;
    $("#btn-back-lobby").href = AW.link("index.html", { room: code });
    if (!needNet($("#join-msg"))) return;
    if (!/^[A-Z0-9]{4}$/.test(code)) return setMsg($("#join-msg"), "That room code doesn't look right.", "bad");
    $("#join-msg").innerHTML = spin("Knocking on the door…");
    Net.join(code, {
      open() { Net.send({ t: "hello", name: S.myName }); },
      data: onGuestData,
      close: onHostGone,
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

  function onGuestData(m) {
    switch (m.t) {
      case "welcome":
        S.myId = m.you;
        S.rules = Settings.sanitize(m.rules);
        renderRules();
        renderLobbyPlayers();
        setMsg($("#join-msg"), "You're in! Waiting for the host to start the match…", "good");
        break;
      case "full":
        S.rejected = true;
        setMsg($("#join-msg"), "That room is full, or its match has already started.", "bad");
        break;
      case "roster": applyRoster(m); break;
      case "round": beginRound(m); break;
      case "status": applyStatus(m.id, m.st); break;
      case "grace": startGrace(m.id, m.ms); break;
      case "vote": applyVote(m); break;
      case "voteEnd": applyVoteEnd(m); break;
      case "hintGive": if (m.n === S.roundNo) giveHint(m.c); break;
      case "roundEnd": applyRoundEnd(m); break;
    }
  }

  function onHostGone() {
    if (S.rejected) return;
    if (!S.puzzle) return setMsg($("#join-msg"), "The host closed the room.", "bad");
    stopTimer();
    S.active = false;
    showResult("Host Left", "The host has left, so the match is over.", [["Back to Lobby", backToLobby]]);
  }

  // ---------------------------------------------------------------- match flow (host)
  function startMatch() {
    S.players = activePlayers();
    if (S.players.length < 2) return;
    S.totals = Object.fromEntries(S.players.map((p) => [p.id, 0]));
    S.roundNo = 0;
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
    const m = { t: "round", n: S.roundNo, qi: pickQuote(), seed: randomSeed(), players: S.players, totals: S.totals };
    if (multi()) Net.send(m);
    beginRound(m);
  }

  function hostSetStatus(id, st) {
    S.status[id] = st;
    Net.send({ t: "status", id, st });
    renderPlayers();
  }

  function hostProgress(id, pct, left) {
    const st = S.status[id];
    if (!st || st.state !== "solving" || S.roundOver) return;
    hostSetStatus(id, { ...st, pct, left });
  }

  function hostSolved(id, time) {
    const st = S.status[id];
    if (!st || st.state !== "solving" || S.roundOver) return;
    hostSetStatus(id, { state: "solved", pct: 100, left: 0, time });
    const first = !S.ref.firstSolved;
    S.ref.firstSolved = true;
    if (hostCheckAllDone() || !first) return;
    if (!S.rules.grace) return endRound("solved");
    const ms = S.rules.grace * 1000;
    S.ref.graceTimer = setTimeout(() => endRound("grace"), ms);
    Net.send({ t: "grace", id, ms });
    startGrace(id, ms);
  }

  function hostGaveUp(id) {
    const st = S.status[id];
    if (!st || st.state !== "solving" || S.roundOver) return;
    hostSetStatus(id, { ...st, state: "gaveup" });
    hostCheckAllDone();
  }

  function hostCheckAllDone() {
    const done = activePlayers().every((p) => ["solved", "gaveup"].includes((S.status[p.id] || {}).state));
    if (done) endRound("done");
    return done;
  }

  function endRound(reason) {
    if (S.roundOver) return;
    clearTimeout(S.ref.graceTimer);
    clearTimeout(S.ref.limitTimer);
    const results = S.players.map((p) => {
      const st = S.status[p.id] || { state: "left", pct: 0, left: S.puzzle.letters.length };
      const pts = st.state === "left" ? 0 : Settings.points(S.rules, st.state === "solved", st.left);
      return { id: p.id, state: st.state, time: st.time, left: st.left, pct: st.pct, points: pts };
    });
    const totals = { ...S.totals };
    for (const r of results) totals[r.id] = (totals[r.id] || 0) + r.points;
    const matchOver = S.roundNo >= S.rules.rounds || activePlayers().length < 2;
    const m = { t: "roundEnd", n: S.roundNo, reason, results, totals, matchOver };
    Net.send(m);
    applyRoundEnd(m);
  }

  // ---------------------------------------------------------------- hints (host referee)
  function hostHintAsk(by) {
    if (S.roundOver || S.ref.vote || !hintsLeftInRound()) return;
    const voters = activePlayers().filter((p) => p.id !== by).length;
    const needed = S.rules.hintAgree === "all" ? voters : Math.min(S.rules.hintAgree, voters);
    if (needed <= 0) return hostGiveHint();
    S.ref.vote = { by, yes: [], no: [], needed };
    broadcastVote();
  }

  function hostHintVote(id, yes) {
    const v = S.ref.vote;
    if (!v || id === v.by || v.yes.includes(id) || v.no.includes(id)) return;
    (yes ? v.yes : v.no).push(id);
    hostCheckVote();
  }

  function hostCheckVote() {
    const v = S.ref.vote;
    const voters = activePlayers().filter((p) => p.id !== v.by).map((p) => p.id);
    if (!activePlayers().some((p) => p.id === v.by)) return hostFailVote();
    v.yes = v.yes.filter((id) => voters.includes(id));
    v.no = v.no.filter((id) => voters.includes(id));
    v.needed = S.rules.hintAgree === "all" ? voters.length : Math.min(v.needed, voters.length);
    if (v.yes.length >= v.needed) return hostGiveHint();
    if (voters.length - v.no.length < v.needed) return hostFailVote();
    broadcastVote();
  }

  function broadcastVote() {
    const v = S.ref.vote;
    const m = { t: "vote", by: v.by, yes: v.yes, needed: v.needed };
    Net.send(m);
    applyVote(m);
  }

  function hostFailVote() {
    const m = { t: "voteEnd", by: S.ref.vote.by };
    S.ref.vote = null;
    Net.send(m);
    applyVoteEnd(m);
  }

  function hostGiveHint() {
    S.ref.vote = null;
    const c = pickHintLetter();
    const m = { t: "hintGive", n: S.roundNo, c };
    if (multi()) Net.send(m);
    giveHint(c);
  }

  // ---------------------------------------------------------------- practice
  function startSolo() {
    S.mode = "solo"; S.role = "host"; S.myId = "me";
    S.rules = { ...Settings.defaults(), rounds: 1, players: 1, timeLimit: 0, grace: 0, hintAgree: "all", free: 0, deduct: 0 };
    S.players = [{ id: "me", name: S.myName }];
    S.totals = { me: 0 };
    S.ref = {};
    document.body.classList.add("solo");
    nextRound();
  }

  function soloDone(solved, time) {
    S.roundOver = true; S.active = false;
    stopTimer();
    revealSolution();
    const used = S.hintsUsed;
    showResult(solved ? "Solved!" : "Revealed",
      solved ? `You cracked it in ${fmt(time)}${used ? ` with ${used} hint${used > 1 ? "s" : ""}` : " without hints"}.` : "Better luck with the next one.",
      [["New Puzzle", nextRound], ["Lobby", backToLobby]]);
  }

  // ---------------------------------------------------------------- rounds (everyone)
  function beginRound(m) {
    S.phase = "round";
    S.roundNo = m.n;
    S.players = m.players;
    S.totals = m.totals;
    S.puzzle = buildPuzzle(m.qi, m.seed);
    S.guesses = {}; S.locked = new Set(); S.hinted = new Set(); S.cellGuess = [];
    S.hintsUsed = 0;
    S.vote = null; S.myVote = null;
    $("#hint-prompt").classList.add("hidden");
    S.roundOver = false; S.active = false; S.selected = -1;
    S.graceEndsAt = 0; S.limitEndsAt = 0;
    S.status = {};
    for (const p of S.players) S.status[p.id] = { state: p.left ? "left" : "solving", pct: 0, left: S.puzzle.letters.length };
    if (isHost()) S.ref = { graceTimer: null, limitTimer: null, vote: null, firstSolved: false };

    show("game");
    $("#result").classList.add("hidden");
    status("");
    $("#round-label").textContent = multi() ? `Round ${S.roundNo} of ${S.rules.rounds}` : "Practice";
    $("#timer").textContent = "0:00";
    $("#clock-note").textContent = "";
    $("#source").textContent = "— " + S.puzzle.author;
    $("#freq-card").classList.toggle("hidden", !S.rules.showFreq);
    $("#remaining-card").classList.toggle("hidden", !S.rules.showRemaining);
    $("#freq-note").classList.toggle("hidden", S.rules.autofill);
    renderPlayers();
    renderBoard();
    renderFreq();

    countdown(S.rules.countdown, () => {
      S.active = true;
      S.startTime = Date.now();
      if (S.rules.timeLimit) {
        S.limitEndsAt = S.startTime + S.rules.timeLimit * 60000;
        if (isHost() && multi()) S.ref.limitTimer = setTimeout(() => endRound("time"), S.rules.timeLimit * 60000);
      }
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
    S.timerId = setInterval(tickClock, 200);
  }
  function stopTimer() { clearInterval(S.timerId); S.timerId = null; }
  const elapsed = () => (Date.now() - S.startTime) / 1000;

  function tickClock() {
    $("#timer").textContent = fmt(elapsed());
    const note = $("#clock-note");
    const now = Date.now();
    if (S.graceEndsAt) {
      note.textContent = `Round ends in ${fmt(Math.max(0, (S.graceEndsAt - now) / 1000))}`;
      note.classList.add("urgent");
    } else if (S.limitEndsAt) {
      const left = Math.max(0, (S.limitEndsAt - now) / 1000);
      note.textContent = `Time left ${fmt(left)}`;
      note.classList.toggle("urgent", left <= 30);
    } else {
      note.textContent = "";
    }
  }

  function startGrace(id, ms) {
    S.graceEndsAt = Date.now() + ms;
    if (id !== S.myId) {
      status(`${nameOf(id)} solved it! Everyone else has ${Math.round(ms / 1000)} seconds to finish.`, S.active ? "bad" : "good");
    }
  }

  function applyStatus(id, st) {
    S.status[id] = st;
    renderPlayers();
  }

  function applyRoundEnd(m) {
    S.roundOver = true; S.active = false;
    S.phase = m.matchOver ? "matchEnd" : "roundEnd";
    S.totals = m.totals;
    S.vote = null;
    $("#hint-prompt").classList.add("hidden");
    S.graceEndsAt = 0; S.limitEndsAt = 0;
    stopTimer();
    $("#clock-note").textContent = "";
    for (const r of m.results) S.status[r.id] = { state: r.state, pct: r.pct, left: r.left, time: r.time };
    revealSolution();
    renderPlayers();

    const why = {
      solved: "Someone solved it.", grace: "Time's up after the first solve.", time: "The time limit was reached.",
      done: "Everyone has finished.", abandon: "Not enough players are left.",
    }[m.reason] || "";

    let title = `Round ${m.n} Results`;
    if (m.matchOver) {
      const standing = m.results.filter((r) => r.state !== "left");
      const best = Math.max(...standing.map((r) => m.totals[r.id]));
      const winners = standing.filter((r) => m.totals[r.id] === best).map((r) => r.id);
      title = winners.length > 1 ? (winners.includes(S.myId) ? "It's a Tie!" : `${winners.map(nameOf).join(" & ")} Tie!`)
        : winners[0] === S.myId ? "You Win!" : `${nameOf(winners[0])} Wins!`;
    }

    const buttons = [];
    const canContinue = isHost() && activePlayers().length >= 2;
    if (canContinue) buttons.push(m.matchOver ? ["Rematch", startMatch] : ["Next Round", nextRound]);
    buttons.push(["Leave", backToLobby]);
    const wait = !isHost() ? (m.matchOver ? " The host can start a rematch." : " Waiting for the host to start the next round…") : "";
    showResult(title, `${why}${m.matchOver ? " That was the final round." : ""}${wait}`, buttons, resultsTable(m));
  }

  function resultsTable(m) {
    const rows = m.results.slice().sort((a, b) => m.totals[b.id] - m.totals[a.id]);
    let rank = 0, prev = null;
    const body = rows.map((r, i) => {
      if (m.totals[r.id] !== prev) { rank = i + 1; prev = m.totals[r.id]; }
      const lettersLeft = `${r.left} letter${r.left === 1 ? "" : "s"} left`;
      const how = r.state === "solved" ? `Solved in ${fmt(r.time || 0)}`
        : r.state === "gaveup" ? `Gave up, ${lettersLeft}`
        : r.state === "left" ? "Left the game" : lettersLeft;
      return `<tr class="${r.id === S.myId ? "table-warning" : ""}">
        <td>${rank}</td><td class="text-start">${esc(nameOf(r.id))}</td><td class="text-start">${how}</td>
        <td>+${r.points}</td><td><b>${m.totals[r.id]}</b></td></tr>`;
    }).join("");
    return `<div class="table-responsive mt-3"><table class="table table-sm table-bordered bg-white mb-0 align-middle text-center">
      <thead class="table-light"><tr><th>#</th><th class="text-start">Player</th><th class="text-start">This round</th><th>Points</th><th>Total</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- players panel
  function renderPlayers() {
    if (!multi() || !S.puzzle) return;
    $("#players").innerHTML = S.players.map((p) => {
      const st = S.status[p.id] || { state: "solving", pct: 0 };
      const me = p.id === S.myId;
      const label = { solving: S.roundOver ? "Unfinished" : "Solving", solved: `Solved ${fmt(st.time || 0)}`, gaveup: "Gave up", left: "Left" }[st.state] || "";
      return `<li class="list-group-item d-flex align-items-center gap-2 py-1 ${st.state === "left" ? "aw-gone" : ""}">
        <span class="aw-pname text-truncate">${esc(p.name)}${me ? ' <small class="text-secondary">(you)</small>' : ""}</span>
        <div class="progress flex-grow-1"><div class="progress-bar progress-bar-striped ${st.state === "solving" && !S.roundOver ? "progress-bar-animated" : ""} ${me ? "bg-success" : "bg-danger"}" style="width:${st.pct || 0}%"></div></div>
        <span class="aw-pstate small text-secondary">${label}</span>
        <span class="badge aw-points">${S.totals[p.id] || 0} pts</span>
      </li>`;
    }).join("");
  }

  // ---------------------------------------------------------------- board
  function renderBoard() {
    const board = $("#board");
    board.innerHTML = "";
    S.cells = [];
    S.cellsOf = {};
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
          (S.cellsOf[ch] = S.cellsOf[ch] || []).push(i);
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

  function hintsLeftInRound() {
    return S.rules.maxHints === -1 || S.hintsUsed < S.rules.maxHints;
  }

  // What's in box i. With autofill every box of a code letter shares one
  // guess; without it each box has its own. Hinted letters are fixed everywhere.
  function guessAt(i) {
    const c = S.cells[i].dataset.c;
    if (S.locked.has(c)) return S.puzzle.sol[c];
    return S.rules.autofill ? S.guesses[c] : S.cellGuess[i];
  }

  function refresh() {
    const selC = S.selected >= 0 ? S.cells[S.selected].dataset.c : null;
    S.cells.forEach((cell, i) => {
      const c = cell.dataset.c;
      cell.querySelector(".guess").textContent = disp(S.roundOver ? S.puzzle.sol[c] : guessAt(i) || "");
      cell.classList.toggle("selected", i === S.selected && !S.roundOver);
      cell.classList.toggle("same", S.rules.highlight && c === selC && !S.roundOver);
      cell.classList.toggle("given", S.locked.has(c));
      cell.classList.toggle("hinted", S.hinted.has(c));
    });
    const used = new Set(S.cells.map((_, i) => guessAt(i)).filter(Boolean));
    $("#remaining").innerHTML = [...ALPHA].map((l) => `<span class="${used.has(l) ? "used" : ""}">${disp(l)}</span>`).join("");
    renderFreq();

    const btn = $("#btn-hint");
    const noneLeft = !S.puzzle || S.puzzle.letters.every((c) => S.locked.has(c));
    btn.classList.toggle("hidden", S.rules.maxHints === 0);
    btn.textContent = !hintsLeftInRound() ? "No Hints Left"
      : S.mode === "solo" ? "Reveal a Letter"
      : S.vote && S.vote.by === S.myId ? "Hint Proposed…" : "Propose a Hint";
    btn.disabled = !S.active || !!S.vote || noneLeft || !hintsLeftInRound();
    $("#btn-giveup").disabled = !S.active;
  }

  // Table under the puzzle: each code letter, how many times it appears, and
  // (with autofill on) the letter you've put for it.
  function renderFreq() {
    if (!S.puzzle) return;
    const counts = {};
    for (const ch of S.puzzle.cipherText) if (S.puzzle.sol[ch]) counts[ch] = (counts[ch] || 0) + 1;
    const letters = [...ALPHA];
    const mine = (l) => (S.rules.autofill && counts[l] ? disp(S.guesses[l] || "") : "");
    $("#freq").innerHTML =
      `<tr><th>Letter</th>${letters.map((l) => `<td>${l}</td>`).join("")}</tr>` +
      `<tr><th>Count</th>${letters.map((l) => `<td class="${counts[l] ? "" : "zero"}">${counts[l] || 0}</td>`).join("")}</tr>` +
      `<tr class="mine"><th>Your letter</th>${letters.map((l) => `<td>${mine(l)}</td>`).join("")}</tr>`;
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
      if (!guessAt(i)) return i;
    }
    return from < n ? from : 0;
  }

  const canEdit = () => S.active && S.selected >= 0;

  function assign(p) {
    if (!canEdit()) return;
    const c = S.cells[S.selected].dataset.c;
    if (S.locked.has(c)) return status("That letter is already fixed in place.");
    if (!S.rules.autofill) { // only this box
      S.cellGuess[S.selected] = p;
      if (!S.graceEndsAt) status("");
      S.selected = firstOpenIndex(S.selected + 1);
      return afterChange();
    }
    const owner = Object.keys(S.guesses).find((k) => S.guesses[k] === p && k !== c);
    if (owner && S.locked.has(owner)) return status(`${p} is already fixed elsewhere in the puzzle.`, "bad");
    if (owner) delete S.guesses[owner]; // a plaintext letter can only stand for one code letter
    S.guesses[c] = p;
    if (!S.graceEndsAt) status("");
    S.selected = firstOpenIndex(S.selected + 1);
    afterChange();
  }

  function clearCurrent() {
    if (!canEdit()) return;
    const c = S.cells[S.selected].dataset.c;
    if (S.locked.has(c)) return;
    if (S.rules.autofill) delete S.guesses[c];
    else delete S.cellGuess[S.selected];
    afterChange();
  }

  function move(d) {
    if (S.selected < 0) return select(0);
    select((S.selected + d + S.cells.length) % S.cells.length);
  }

  // Code letters not yet correct in every box (what partial credit counts).
  function lettersLeft() {
    const { letters, sol } = S.puzzle;
    return letters.filter((c) => !S.cellsOf[c].every((i) => guessAt(i) === sol[c])).length;
  }

  function afterChange() {
    refresh();
    const left = lettersLeft();
    const pct = Math.round((100 * (S.puzzle.letters.length - left)) / S.puzzle.letters.length);
    if (multi()) {
      S.status[S.myId] = { ...S.status[S.myId], pct, left };
      renderPlayers();
      if (isHost()) hostProgress("host", pct, left);
      else Net.send({ t: "progress", n: S.roundNo, pct, left });
    }
    checkComplete(left);
  }

  function checkComplete(left) {
    if (!S.cells.every((_, i) => guessAt(i))) return;
    if (left > 0) return status("Every letter is filled in, but something isn't right yet.", "bad");
    const time = elapsed();
    S.active = false;
    refresh();
    if (S.mode === "solo") return soloDone(true, time);
    status(`Solved in ${fmt(time)}! Waiting for the round to finish…`, "good");
    if (isHost()) hostSolved("host", time);
    else Net.send({ t: "solved", n: S.roundNo, time });
  }

  function giveUp() {
    if (!S.active) return;
    S.active = false;
    refresh();
    if (S.mode === "solo") return soloDone(false);
    status("You gave up. Your partial credit is locked in. Waiting for the round to finish…");
    if (isHost()) hostGaveUp("host");
    else Net.send({ t: "gaveUp", n: S.roundNo });
  }

  function revealSolution() {
    const { sol } = S.puzzle;
    S.roundOver = true;
    S.cells.forEach((cell, i) => {
      const c = cell.dataset.c, g = guessAt(i);
      cell.classList.toggle("wrong", !!g && g !== sol[c]);
      cell.classList.toggle("revealed", !g);
    });
    refresh();
    status("");
  }

  // ---------------------------------------------------------------- hints (everyone)
  function hint() {
    if (!S.active || S.vote || !hintsLeftInRound()) return;
    if (S.mode === "solo") return giveHint(pickHintLetter());
    if (isHost()) hostHintAsk("host");
    else Net.send({ t: "hintAsk", n: S.roundNo });
  }

  function applyVote(m) {
    if (!S.vote || S.vote.by !== m.by) S.myVote = null;
    S.vote = m;
    const tally = `${m.yes.length} of ${m.needed} agreed`;
    if (m.by === S.myId) {
      $("#hint-prompt").classList.add("hidden");
      status(`Hint proposed. ${tally} so far…`);
    } else if (S.myVote !== null) {
      $("#hint-prompt").classList.add("hidden");
      status(`Hint vote: ${tally}.`);
    } else {
      $("#hint-prompt-text").textContent = `${nameOf(m.by)} proposes a hint (${tally}). One letter will be revealed for everyone. Agree?`;
      $("#hint-prompt").classList.remove("hidden");
    }
    refresh();
  }

  function answerHint(yes) {
    if (!S.vote || S.myVote !== null || S.vote.by === S.myId) return;
    S.myVote = yes;
    $("#hint-prompt").classList.add("hidden");
    status(yes ? "You agreed to the hint." : "You declined the hint.");
    if (isHost()) hostHintVote("host", yes);
    else Net.send({ t: "hintVote", n: S.roundNo, yes });
  }

  function applyVoteEnd(m) {
    S.vote = null;
    $("#hint-prompt").classList.add("hidden");
    status(m.by === S.myId ? "Not enough players agreed to your hint." : "The hint was turned down.", "bad");
    refresh();
  }

  function pickHintLetter() {
    const open = S.puzzle.letters.filter((c) => !S.locked.has(c));
    return open.length ? open[Math.floor(Math.random() * open.length)] : null;
  }

  function giveHint(c) {
    S.vote = null;
    $("#hint-prompt").classList.add("hidden");
    if (!c || S.roundOver) return refresh();
    const p = S.puzzle.sol[c];
    for (const k of Object.keys(S.guesses)) if (S.guesses[k] === p) delete S.guesses[k];
    S.guesses[c] = p;
    S.locked.add(c); S.hinted.add(c);
    S.hintsUsed++;
    status(`Hint: ${c} stands for ${p}.`, "good");
    if (S.active) afterChange(); else refresh();
  }

  function showResult(title, text, buttons, extraHtml = "") {
    $("#result-title").textContent = title;
    $("#result-text").textContent = text;
    $("#result-table").innerHTML = extraHtml;
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
        b.textContent = disp(l);
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

  function initControls() {
    buildKeyboard();
    $("#btn-hint").onclick = hint;
    $("#btn-hint-yes").onclick = () => answerHint(true);
    $("#btn-hint-no").onclick = () => answerHint(false);
    $("#btn-giveup").onclick = giveUp;
    $("#btn-start").onclick = startMatch;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    $("#opt-kbd").checked = touch;
    $("#kbd").classList.toggle("hidden", !touch);
    $("#opt-kbd").onchange = (e) => $("#kbd").classList.toggle("hidden", !e.target.checked);

    for (const el of $$(".js-leave")) {
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
    // right away so the others are told.
    addEventListener("pagehide", () => Net.leave());

    document.addEventListener("keydown", (e) => {
      if ($("#game").classList.contains("hidden")) return;
      if (e.target.matches && e.target.matches("input, select, textarea") && e.target.type !== "checkbox") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (/^[a-zA-Z]$/.test(k)) {
        e.preventDefault();
        const upper = k === k.toUpperCase();
        if (S.active && S.letterCase === "upper" && !upper) {
          return status("Your letter case is set to Uppercase: type capital letters (Shift or Caps Lock), or change it in Default Settings.");
        }
        if (S.active && S.letterCase === "lower" && upper) {
          return status("Your letter case is set to Lowercase: type small letters, or change it in Default Settings.");
        }
        assign(k.toUpperCase());
      }
      else if (k === "Backspace" || k === "Delete" || k === " ") { clearCurrent(); e.preventDefault(); }
      else if (k === "ArrowRight") { move(1); e.preventDefault(); }
      else if (k === "ArrowLeft") { move(-1); e.preventDefault(); }
    });
  }

  // ---------------------------------------------------------------- start
  S.letterCase = Settings.personal().letterCase;
  initControls();
  const mode = AW.params.get("mode");
  S.myName = cleanName(AW.getName() || (mode === "join" ? "Guest" : "Host"));
  if (mode === "host" || mode === "join") {
    $('.aw-nav a[data-page="index.html"]').classList.add("active");
    if (mode === "host") hostRoom(); else joinRoom();
  } else {
    $("#nav-practice").classList.add("active");
    document.title = "Practice - AristoWars";
    startSolo();
  }
})();
