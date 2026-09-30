// Peer-to-peer link via PeerJS (WebRTC). The public PeerJS server only brokers
// the introduction; game messages travel directly between the two browsers.
//
// Add ?local to the URL to link two tabs of the same browser with a
// BroadcastChannel instead (handy for testing without a network).
const Net = (() => {
  const PREFIX = "aristo-wars-";
  const LOCAL = new URLSearchParams(location.search).has("local");
  // STUN finds each player's public address. Players behind strict NATs, VPNs or
  // corporate firewalls also need a TURN relay: add one here, e.g.
  // { urls: "turn:your.turn.host:3478", username: "user", credential: "pass" }
  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const PEER_OPTS = { config: { iceServers: ICE_SERVERS } };
  const CONNECT_TIMEOUT_MS = 15000;
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let peer = null, conn = null, h = {};

  function makeCode() {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function available() { return LOCAL || typeof Peer !== "undefined"; }

  // Minimal stand-in for a PeerJS DataConnection over BroadcastChannel.
  function localConn(code, isHost) {
    const ch = new BroadcastChannel(PREFIX + code);
    const ev = {};
    const c = {
      open: false,
      on(name, fn) { ev[name] = fn; },
      send(d) { ch.postMessage({ from: isHost, d }); },
      close() { ch.postMessage({ from: isHost, sys: "bye" }); ch.close(); c.open = false; },
    };
    const opened = () => { if (!c.open) { c.open = true; ev.open && ev.open(); } };
    ch.onmessage = ({ data }) => {
      if (data.from === isHost) return;
      if (data.sys === "knock" && isHost) { ch.postMessage({ from: isHost, sys: "welcome" }); opened(); }
      else if (data.sys === "welcome" && !isHost) opened();
      else if (data.sys === "bye") { c.open = false; ev.close && ev.close(); }
      else if (data.d !== undefined) ev.data && ev.data(data.d);
    };
    if (!isHost) ch.postMessage({ from: isHost, sys: "knock" });
    addEventListener("beforeunload", () => c.open && c.close());
    return c;
  }

  function keepAlive(p) {
    p.on("disconnected", () => { if (!p.destroyed) p.reconnect(); });
  }

  function wire(c) {
    conn = c;
    c.on("open", () => h.open && h.open());
    c.on("data", (d) => h.data && h.data(d));
    c.on("close", () => { if (conn === c) { conn = null; h.close && h.close(); } });
    c.on("error", (e) => h.error && h.error(e));
  }

  function host(handlers) {
    h = handlers;
    const code = makeCode();
    if (LOCAL) { setTimeout(() => { h.ready && h.ready(code); wire(localConn(code, true)); }); return; }
    peer = new Peer(PREFIX + code, PEER_OPTS);
    keepAlive(peer);
    peer.on("open", () => h.ready && h.ready(code));
    peer.on("connection", (c) => {
      if (conn && conn.open) {
        c.on("open", () => { c.send({ t: "full" }); setTimeout(() => c.close(), 500); });
        return;
      }
      wire(c);
    });
    peer.on("error", (e) => {
      if (e.type === "unavailable-id") { peer.destroy(); host(handlers); }
      else h.error && h.error(e);
    });
  }

  function join(code, handlers) {
    h = handlers;
    const timer = setTimeout(() => {
      if (!(conn && conn.open)) h.error && h.error({ type: "timeout" });
    }, CONNECT_TIMEOUT_MS);
    const done = h.open, fail = h.error;
    h.open = () => { clearTimeout(timer); done && done(); };
    h.error = (e) => { clearTimeout(timer); fail && fail(e); };
    if (LOCAL) { wire(localConn(code, false)); return; }
    peer = new Peer(PEER_OPTS);
    keepAlive(peer);
    peer.on("open", () => wire(peer.connect(PREFIX + code, { reliable: true })));
    peer.on("error", (e) => h.error && h.error(e));
  }

  function send(msg) { if (conn && conn.open) conn.send(msg); }

  function leave() {
    try { conn && conn.close(); } catch (_) {}
    try { peer && peer.destroy(); } catch (_) {}
    conn = null; peer = null;
  }

  return { available, host, join, send, leave };
})();
