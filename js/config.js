// Relay (TURN) settings. A relay lets two players connect even when VPNs, firewalls or
// strict home/mobile routers block a direct connection. The relay only carries the
// tiny game messages, so a free plan is plenty.
//
// Setup (free, about 2 minutes):
//   1. Sign up at https://www.metered.ca/stun-turn and create a TURN app.
//   2. The app's domain looks like "yourname.metered.live": put "yourname" below.
//   3. Copy the app's API key (Dashboard → your app → "API Key") below.
//
// The API key is meant to be used in web pages; it only lets visitors fetch
// short-lived relay credentials for your app.
const TURN_CONFIG = {
  meteredApp: "",     // e.g. "aristowars"
  meteredApiKey: "",  // e.g. "a1b2c3..."

  // Or list your own TURN servers instead (from any provider, or self-hosted coturn):
  // servers: [{ urls: "turn:turn.example.com:3478", username: "user", credential: "pass" }],
  servers: [
    {
      urls: "stun:stun.relay.metered.ca:80",
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "94e7a9e814092887bfc38aa6",
      credential: "OXDi55m9sAXzf5Sc",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "94e7a9e814092887bfc38aa6",
      credential: "OXDi55m9sAXzf5Sc",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "94e7a9e814092887bfc38aa6",
      credential: "OXDi55m9sAXzf5Sc",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "94e7a9e814092887bfc38aa6",
      credential: "OXDi55m9sAXzf5Sc",
    },
  ],
};
