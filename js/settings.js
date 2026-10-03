// Game rules: what they are, how they're stored as defaults, and the form that
// edits them. Used by settings.html (save defaults), create.html (set up a
// room) and play.html (rules summary, validating the room's rules).
//
// GENERAL rules apply to practice and to competitive games, and can be saved
// as defaults. EXCLUSIVE rules are chosen fresh for each competitive game.
// PERSONAL preferences only affect the player who sets them.
const Settings = (() => {
  // Rules that can be saved as defaults. Unlimited hints are stored as -1.
  const GENERAL = [
    { key: "maxHints", label: "Hints per round", type: "num",
      options: [[0, "0 (no hints)"], [1, "1"], [2, "2"], [3, "3"], [5, "5"], [-1, "Unlimited"]] },
    { key: "showRemaining", label: "Letters Remaining panel", type: "bool",
      options: [[true, "Show"], [false, "Hide"]],
      help: "The A–Z strip showing which answer letters you haven't used yet." },
    { key: "showFreq", label: "Letter count table under the puzzle", type: "bool",
      options: [[true, "Show"], [false, "Hide"]],
      help: "How many times each code letter appears in the puzzle." },
    { key: "highlight", label: "Highlight matching letters", type: "bool",
      options: [[true, "On"], [false, "Off"]],
      help: "When you click a box, every box with the same code letter lights up." },
    { key: "autofill", label: "Autofill matching letters", type: "bool",
      options: [[true, "On"], [false, "Off"]],
      help: "Typing a letter fills every box with the same code letter. When off, only the box you clicked fills in, and the “Your letter” row of the letter count table stays empty." },
    { key: "countdown", label: "Countdown before each round", type: "num",
      options: [[3, "3 seconds"], [5, "5 seconds"], [10, "10 seconds"]] },
  ];

  // Rules chosen fresh for every game; never filled in from defaults.
  const EXCLUSIVE = [
    { key: "rounds", label: "Number of rounds", type: "num",
      options: [[1, "1 round"], [3, "3 rounds"], [5, "5 rounds"], [7, "7 rounds"]] },
    { key: "players", label: "Players", type: "num",
      options: [[2, "2 players (1v1)"], [3, "3 players"], [4, "4 players"], [5, "5 players"], [6, "6 players"]] },
    { key: "timeLimit", label: "Round time limit", type: "num",
      options: [[0, "No limit"], [2, "2 minutes"], [3, "3 minutes"], [5, "5 minutes"], [10, "10 minutes"]] },
    { key: "grace", label: "After the first solve, everyone else gets", type: "num",
      options: [[0, "No extra time (round ends)"], [15, "15 seconds"], [30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"]] },
    { key: "hintAgree", label: "Players who must agree to a hint", type: "numOrAll",
      options: [[1, "1 other player"], [2, "2 other players"], [3, "3 other players"], [4, "4 other players"], [5, "5 other players"], ["all", "Everyone"]] },
  ];
  // Personal preferences: saved separately, never part of a room's rules.
  const PERSONAL = [
    { key: "letterCase", label: "Letter case", type: "str",
      options: [["upper", "Uppercase (A)"], ["lower", "Lowercase (a)"], ["either", "Either (A or a)"]],
      help: "How your answers appear, and which keys count. With Uppercase, type capitals (Shift or Caps Lock); with Lowercase, type small letters; with Either, both work the same." },
  ];

  // Partial credit is two numbers rather than a menu.
  const PARTIAL = { free: { min: 0, max: 26 }, deduct: { min: 1, max: 100 } };

  const BUILTIN = { maxHints: 3, showRemaining: true, showFreq: true, highlight: true, autofill: true, countdown: 3 };
  const BUILTIN_PERSONAL = { letterCase: "either" };

  // ---------------------------------------------------------- defaults storage
  function saved() {
    try { return JSON.parse(localStorage.getItem("aw-defaults")) || null; } catch (_) { return null; }
  }
  function defaults() { return clean(GENERAL, { ...BUILTIN, ...(saved() || {}) }, BUILTIN); }
  function save(values) {
    try { localStorage.setItem("aw-defaults", JSON.stringify(values)); return true; } catch (_) { return false; }
  }
  function personal() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem("aw-personal")); } catch (_) {}
    return clean(PERSONAL, { ...BUILTIN_PERSONAL, ...(p || {}) }, BUILTIN_PERSONAL);
  }
  function savePersonal(values) {
    try { localStorage.setItem("aw-personal", JSON.stringify(values)); return true; } catch (_) { return false; }
  }

  // Keep only allowed values; fall back to `fallback` (or drop) otherwise.
  function clean(fields, values, fallback = {}) {
    const out = {};
    for (const f of fields) {
      const ok = f.options.some(([v]) => v === values[f.key]);
      if (ok) out[f.key] = values[f.key];
      else if (f.key in fallback) out[f.key] = fallback[f.key];
    }
    return out;
  }

  // ---------------------------------------------------------- forms
  const toForm = (v) => String(v);
  function fromForm(f, s) {
    if (s === "") return undefined;
    if (f.type === "bool") return s === "true";
    if (f.type === "str") return s;
    if (f.type === "numOrAll" && s === "all") return "all";
    return Number(s);
  }

  // Render a list of fields as Bootstrap selects into `container`.
  // With placeholder: true every select starts on "Choose…", so the host must pick.
  function render(container, fields, { placeholder = false } = {}) {
    container.innerHTML = fields.map((f) => `
      <div class="col-sm-6">
        <label for="set-${f.key}" class="form-label">${f.label}</label>
        <select id="set-${f.key}" class="form-select" data-key="${f.key}">
          ${placeholder ? '<option value="" selected disabled>Choose…</option>' : ""}
          ${f.options.map(([v, l]) => `<option value="${toForm(v)}">${l}</option>`).join("")}
        </select>
        ${f.help ? `<div class="form-text">${f.help}</div>` : ""}
      </div>`).join("");
  }

  function fill(fields, values) {
    for (const f of fields) {
      const el = document.getElementById("set-" + f.key);
      if (el && f.key in values) { el.value = toForm(values[f.key]); el.classList.remove("is-invalid"); }
    }
  }

  // Returns { values, missing: [keys] }. Disabled fields are skipped.
  function read(fields) {
    const values = {}, missing = [];
    for (const f of fields) {
      const el = document.getElementById("set-" + f.key);
      if (!el || el.disabled) continue;
      const v = fromForm(f, el.value);
      if (v === undefined) missing.push(f.key); else values[f.key] = v;
      el.classList.toggle("is-invalid", v === undefined);
    }
    return { values, missing };
  }

  // ---------------------------------------------------------- a room's full rules
  // Validate rules received in a URL or from the host. Returns null if unusable.
  function sanitize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const s = { ...clean(GENERAL, raw), ...clean(EXCLUSIVE, raw) };
    for (const f of [...GENERAL, ...EXCLUSIVE]) {
      if (!(f.key in s) && !(f.key === "hintAgree" && s.maxHints === 0)) return null;
    }
    if (s.maxHints === 0) s.hintAgree = "all";
    else if (s.hintAgree !== "all") s.hintAgree = Math.min(s.hintAgree, s.players - 1);
    for (const k of ["free", "deduct"]) {
      const n = Number(raw[k]);
      if (!Number.isInteger(n) || n < PARTIAL[k].min || n > PARTIAL[k].max) return null;
      s[k] = n;
    }
    return s;
  }

  // Points for one player's round: a solve is 100; otherwise lose `deduct`
  // for every unfinished letter beyond the first `free` ones.
  function points(s, solved, lettersLeft) {
    if (solved) return 100;
    return Math.max(0, 100 - Math.max(0, lettersLeft - s.free) * s.deduct);
  }

  function summary(s) {
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const onOff = (v) => (v ? "On" : "Off");
    const hints = s.maxHints === 0 ? "None"
      : `${s.maxHints === -1 ? "Unlimited" : `Up to ${s.maxHints} per round`}${s.players > 1
        ? `; ${s.hintAgree === "all" ? "everyone" : plural(s.hintAgree, "other player")} must agree` : ""}`;
    return [
      ["Rounds", `${s.rounds} (highest total wins)`],
      ["Players", `Up to ${s.players}`],
      ["Time limit", s.timeLimit ? `${s.timeLimit} min per round` : "None"],
      ["After first solve", s.grace ? `Others get ${s.grace}s more` : "Round ends right away"],
      ["Hints", hints],
      ["Scoring", `Solve = 100 pts. Unsolved: −${s.deduct} per unfinished letter after the first ${s.free}`],
      ["Letters Remaining", s.showRemaining ? "Shown" : "Hidden"],
      ["Letter count table", s.showFreq ? "Shown" : "Hidden"],
      ["Highlight matching letters", onOff(s.highlight)],
      ["Autofill", onOff(s.autofill)],
      ["Countdown", `${s.countdown} seconds`],
    ];
  }

  function encode(s) { return btoa(JSON.stringify(s)); }
  function decode(str) { try { return sanitize(JSON.parse(atob(str))); } catch (_) { return null; } }

  return {
    GENERAL, EXCLUSIVE, PERSONAL, PARTIAL, BUILTIN, BUILTIN_PERSONAL,
    saved, defaults, save, personal, savePersonal, render, fill, read, sanitize, points, summary, encode, decode,
  };
})();
