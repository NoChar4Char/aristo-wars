// Default Settings page: edit and save the game rules "Use My Defaults" fills
// in (also used for practice), plus personal preferences.
(() => {
  const $ = (s) => document.querySelector(s);
  const G = Settings.GENERAL, P = Settings.PERSONAL;

  Settings.render($("#general-fields"), G);
  Settings.render($("#personal-fields"), P);
  Settings.fill(G, Settings.defaults());
  Settings.fill(P, Settings.personal());

  function flash(text, kind) {
    const el = $("#save-msg");
    el.className = `alert alert-${kind} py-2 mt-3 mb-0`;
    el.textContent = text;
  }

  $("#btn-save").onclick = () => {
    const ok = Settings.save(Settings.read(G).values) && Settings.savePersonal(Settings.read(P).values);
    flash(ok ? "Saved! Practice uses these now, and new rooms can use them with “Use My Defaults”."
      : "Couldn't save. Your browser may be blocking site storage.", ok ? "success" : "danger");
  };

  $("#btn-reset").onclick = () => {
    Settings.fill(G, Settings.BUILTIN);
    Settings.fill(P, Settings.BUILTIN_PERSONAL);
    flash("Standard settings filled in. Click Save to keep them.", "info");
  };
})();
