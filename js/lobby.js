// Lobby page: collect a name, then set up a room, join one, or practice.
(() => {
  const $ = (s) => document.querySelector(s);

  function showError(text) {
    $("#lobby-msg").textContent = text;
    $("#lobby-msg").classList.toggle("hidden", !text);
  }

  function saveName() {
    AW.setName($("#name").value.trim().slice(0, 16) || "Solver");
  }

  function go(extra) {
    saveName();
    location.href = AW.link("play.html", extra);
  }

  function join() {
    const code = $("#join-code").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) return showError("Room codes are 4 characters.");
    go({ mode: "join", room: code });
  }

  $("#name").value = AW.getName();
  const room = AW.params.get("room");
  if (room) {
    $("#join-code").value = room.toUpperCase().slice(0, 4);
    $("#join-card").classList.add("border-primary", "shadow");
  }

  $("#btn-solo").onclick = () => go({ mode: "practice" });
  $("#btn-host").onclick = () => { saveName(); location.href = AW.link("create.html"); };
  $("#btn-join").onclick = join;
  $("#join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
})();
