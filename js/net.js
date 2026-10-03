// Peer-to-peer links via PeerJS (WebRTC). The host's browser connects to every
// guest (a star), so rooms can hold several players. The public PeerJS server
// only brokers introductions; game messages go browser to browser, or through
// the TURN relay configured in js/config.js when a direct path is blocked.
//
// Test flags:
//   ?local  link tabs of the same browser with a BroadcastChannel (no network)
//   ?relay  force every connection through the TURN relay (to check it works)
const Net = (() => {
  const PREFIX = "aristo-wars-";
  const params = new URLSearchParams(location.search);
  const LOCAL = params.has("local");
  const FORCE_RELAY = params.has("relay");
  const STUN = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const CONNECT_TIMEOUT_MS = 20000;
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  let peer = null;
  let hostConn = null;       // guest: the link to the host
  const conns = new Map();   // host: guest id -> link
  let h = {};
  let relayCount = 0;

  function makeCode() {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function available() { return LOCAL || typeof Peer !== "undefined"; }
  function hasRelay() { return relayCount > 0; }

  // STUN plus whatever TURN relays are configured. Metered API credentials are
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

  function keepAlive(p) {
    p.on("disconnected", () => { if (!p.destroyed) p.reconnect(); });
  }

  // ------------------------------------------------------------ ?local transport
  // A tiny event emitter shaped like a PeerJS DataConnection.
  function fakeConn(id, sendFn, closeFn) {
    const ev = {};
    const c = {
      peer: id, open: false,
      on(name, fn) { ev[name] = fn; },
      emit(name, ...a) { ev[name] && ev[name](...a); },
      send: sendFn,
      close() { if (c.open) { c.open = false; closeFn(); c.emit("close"); } },
    };
    return c;
  }

  function localHost(code) {
    const ch = new BroadcastChannel(PREFIX + code);
    const local = new Map();
    const post = (to, o) => ch.postMessage({ from: "host", to, ...o });
    ch.onmessage = ({ data }) => {
      if (data.to !== "host") return;
      const id = data.from;
      if (data.sys === "knock") {
        const c = fakeConn(id, (d) => post(id, { d }), () => post(id, { sys: "bye" }));
        local.set(id, c);
        registerGuest(c);
        post(id, { sys: "welcome" });
        c.open = true;
        c.emit("open");
      } else if (data.sys === "bye") {
        const c = local.get(id);
        if (c && c.open) { c.open = false; c.emit("close"); }
        local.delete(id);
      } else if (data.d !== undefined) {
        const c = local.get(id);
        if (c) c.emit("data", data.d);
      }
    };
    addEventListener("pagehide", () => { for (const c of local.values()) c.close(); });
    setTimeout(() => h.ready && h.ready(code));
  }

  function localGuest(code) {
    const ch = new BroadcastChannel(PREFIX + code);
    const me = "g" + Math.random().toString(36).slice(2, 8);
    const post = (o) => ch.postMessage({ from: me, to: "host", ...o });
    const c = fakeConn("host", (d) => post({ d }), () => post({ sys: "bye" }));
    ch.onmessage = ({ data }) => {
      if (data.to !== me) return;
      if (data.sys === "welcome") { c.open = true; c.emit("open"); }
      else if (data.sys === "bye") { if (c.open) { c.open = false; c.emit("close"); } }
      else if (data.d !== undefined) c.emit("data", data.d);
    };
    wireGuest(c);
    post({ sys: "knock" });
    addEventListener("pagehide", () => c.close());
  }

  // ------------------------------------------------------------ host
  // handlers: ready(code), accept(count) -> bool, join(id), data(id, msg), leave(id), error(e)
  function host(handlers) {
    h = handlers;
    const code = makeCode();
    if (LOCAL) return localHost(code);
    peerOptions().then((opts) => startHost(code, opts, handlers));
  }

  function startHost(code, opts, handlers) {
    peer = new Peer(PREFIX + code, opts);
    keepAlive(peer);
    peer.on("open", () => h.ready && h.ready(code));
    peer.on("connection", registerGuest);
    peer.on("error", (e) => {
      if (e.type === "unavailable-id") { peer.destroy(); host(handlers); }
      else h.error && h.error(e);
    });
  }

  function registerGuest(c) {
    const id = c.peer;
    const openCount = [...conns.values()].filter((x) => x.open).length;
    if (h.accept && !h.accept(openCount)) {
      c.on("open", () => { c.send({ t: "full" }); setTimeout(() => c.close(), 500); });
      return;
    }
    conns.set(id, c);
    c.on("open", () => h.join && h.join(id));
    c.on("data", (d) => h.data && h.data(id, d));
    c.on("close", () => { if (conns.get(id) === c) { conns.delete(id); h.leave && h.leave(id); } });
    c.on("error", (e) => console.warn("[AristoWars] connection error", e));
  }

  // ------------------------------------------------------------ guest
  // handlers: open(), data(msg), close(), error(e)
  function join(code, handlers) {
    h = handlers;
    const timer = setTimeout(() => {
      if (!(hostConn && hostConn.open)) h.error && h.error({ type: "timeout" });
    }, CONNECT_TIMEOUT_MS);
    const done = h.open, fail = h.error;
    h.open = () => { clearTimeout(timer); done && done(); };
    h.error = (e) => { clearTimeout(timer); fail && fail(e); };
    if (LOCAL) return localGuest(code);
    peerOptions().then((opts) => {
      peer = new Peer(opts);
      keepAlive(peer);
      peer.on("open", () => wireGuest(peer.connect(PREFIX + code, { reliable: true })));
      peer.on("error", (e) => h.error && h.error(e));
    });
  }

  function wireGuest(c) {
    hostConn = c;
    c.on("open", () => h.open && h.open());
    c.on("data", (d) => h.data && h.data(d));
    c.on("close", () => { if (hostConn === c) { hostConn = null; h.close && h.close(); } });
    c.on("error", (e) => h.error && h.error(e));
  }

  // ------------------------------------------------------------ sending
  // Host: send to every guest. Guest: send to the host.
  function send(msg) {
    if (hostConn) { if (hostConn.open) hostConn.send(msg); return; }
    for (const c of conns.values()) if (c.open) c.send(msg);
  }

  function sendTo(id, msg) {
    const c = conns.get(id);
    if (c && c.open) c.send(msg);
  }

  function leave() {
    try { hostConn && hostConn.close(); } catch (_) {}
    for (const c of conns.values()) { try { c.close(); } catch (_) {} }
    conns.clear();
    try { peer && peer.destroy(); } catch (_) {}
    hostConn = null; peer = null;
  }

  return { available, hasRelay, host, join, send, sendTo, leave };
})();
