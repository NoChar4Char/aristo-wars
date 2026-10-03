// Room setup page: the host picks every rule (or uses their defaults for the
// general ones), then opens the room on play.html.
(() => {
  const $ = (s) => document.querySelector(s);
  const G = Settings.GENERAL, X = Settings.EXCLUSIVE;

  Settings.render($("#general-fields"), G, { placeholder: true });
  Settings.render($("#exclusive-fields"), X, { placeholder: true });

  // Hint agreement only matters when hints are allowed, and you can't need
  // more agreements than there are other players.
  function sync() {
    const hintsOff = $("#set-maxHints").value === "0";
    $("#set-hintAgree").disabled = hintsOff;
    const players = Number($("#set-players").value) || 6;
    for (const opt of $("#set-hintAgree").options) {
      const n = Number(opt.value);
      opt.hidden = opt.value !== "" && opt.value !== "all" && n > players - 1;
    }
    const sel = $("#set-hintAgree");
    if (sel.selectedOptions[0] && sel.selectedOptions[0].hidden) sel.value = "";
  }
  $("#set-maxHints").addEventListener("change", sync);
  $("#set-players").addEventListener("change", sync);
  sync();

  $("#btn-defaults").onclick = () => {
    Settings.fill(G, Settings.defaults());
    sync();
    const note = $("#defaults-note");
    note.textContent = Settings.saved()
      ? "Your default settings were filled in."
      : "You haven't saved any defaults yet, so the standard settings were filled in.";
    note.classList.remove("hidden");
  };

  function readPartial() {
    const out = {}, missing = [];
    for (const k of ["free", "deduct"]) {
      const el = $("#set-" + k);
      const n = Number(el.value);
      const { min, max } = Settings.PARTIAL[k];
      const ok = el.value !== "" && Number.isInteger(n) && n >= min && n <= max;
      el.classList.toggle("is-invalid", !ok);
      if (ok) out[k] = n; else missing.push(k);
    }
    return { values: out, missing };
  }

  $("#btn-open").onclick = () => {
    const g = Settings.read(G), x = Settings.read(X), p = readPartial();
    const missing = [...g.missing, ...x.missing, ...p.missing];
    const err = $("#create-msg");
    if (missing.length) {
      err.textContent = "Please choose every setting marked in red, or click “Use My Defaults” for the general ones.";
      err.classList.remove("hidden");
      document.querySelector(".is-invalid").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const rules = Settings.sanitize({ hintAgree: "all", ...g.values, ...x.values, ...p.values });
    if (!rules) { err.textContent = "Something's off with those settings. Please check them."; err.classList.remove("hidden"); return; }
    location.href = AW.link("play.html", { mode: "host", rules: Settings.encode(rules) });
  };

  // Changing a field clears its red outline.
  document.addEventListener("change", (e) => e.target.classList && e.target.classList.remove("is-invalid"));
  document.addEventListener("input", (e) => e.target.classList && e.target.classList.remove("is-invalid"));
})();
