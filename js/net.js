// Peer-to-peer link via PeerJS (WebRTC). The public PeerJS server only brokers
// the introduction; game messages travel directly between the two browsers.
//
// Relay (TURN) servers are configured in js/config.js.
//
// Test flags:
//   ?local  link two tabs of the same browser with a BroadcastChannel (no network)
//   ?relay  force every connection through the TURN relay (to check it works)
const Net = (() => {
  const PREFIX = "aristo-wars-";
  const LOCAL = new URLSearchParams(location.search).has("local");
  const FORCE_RELAY = new URLSearchParams(location.search).has("relay");
  // STUN finds each player's public address so most pairs connect directly.
  const STUN = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const CONNECT_TIMEOUT_MS = 20000;
  let relayCount = 0;
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let peer = null, conn = null, h = {};

  function makeCode() {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function available() { return LOCAL || typeof Peer !== "undefined"; }

  // STUN plus whatever TURN relays are configured. Metered credentials are
  // fetched fresh each time, since they expire.
  async function peerOptions() {
    const cfg = typeof TURN_CONFIG === "object" ? TURN_CONFIG : {};
    let turn = Array.isArray(cfg.servers) ? cfg.servers.slice() : [];
    if (cfg.meteredApp && cfg.meteredApiKey) {
      try {
        const url = `https://${cfg.meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(cfg.meteredApiKey)}`;
        const r = await fetch(url);
        if (r.ok) turn = turn.concat(await r.json());
        else console.warn("[AristoWars] TURN credentials request failed:", r.status);
      } catch (e) {
        console.warn("[AristoWars] TURN credentials request failed:", e);
      }
    }
    relayCount = turn.length;
    const config = { iceServers: STUN.concat(turn) };
    if (FORCE_RELAY) config.iceTransportPolicy = "relay";
    return { config };
  }

  function hasRelay() { return relayCount > 0; }

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
    peerOptions().then((opts) => startHost(code, opts, handlers));
  }

  function startHost(code, opts, handlers) {
    peer = new Peer(PREFIX + code, opts);
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
    peerOptions().then((opts) => {
      peer = new Peer(opts);
      keepAlive(peer);
      peer.on("open", () => wire(peer.connect(PREFIX + code, { reliable: true })));
      peer.on("error", (e) => h.error && h.error(e));
    });
  }

  function send(msg) { if (conn && conn.open) conn.send(msg); }

  function leave() {
    try { conn && conn.close(); } catch (_) {}
    try { peer && peer.destroy(); } catch (_) {}
    conn = null; peer = null;
  }

  return { available, hasRelay, host, join, send, leave };
})();
