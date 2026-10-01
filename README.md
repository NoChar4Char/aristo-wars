# Aristo Wars

A head-to-head cryptogram duel with a late-2000s puzzle-site look. Two players get the
same substitution cipher of a famous quotation and race to crack it. Mechanics
follow the classic Puzzle Baron cryptogram: click a cell, type a letter, and it
fills every matching code letter. There's also a Letters Remaining strip, a
letter-frequency table under the puzzle, a reference chart of English letter
frequencies, an on-screen keyboard, and the quote's source shown in
the clear.

No build step and no backend. It's plain HTML, CSS and JavaScript, so it runs on
GitHub Pages as is.

## Play

- **Open a Room**: you get a 4-character code and a share link.
- **Join Room**: enter the code, or just open the share link.
- **Practice Alone**: solo mode with a timer.

Matches are a single puzzle, best of 3, or best of 5. Every puzzle starts
completely blank.

**Hints:** either player can propose a hint at any time. If the other player
agrees, the host picks a letter and it's revealed on *both* boards, so a hint
never favors one side. In practice mode, hints are free and unlimited.

## Deploy to GitHub Pages

1. Push to `main`.
2. Open the repo's **Settings → Pages**, set *Source: Deploy from a branch*,
   branch `main`, folder `/ (root)`.
3. The site goes live at `https://<user>.github.io/aristo-wars/`.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To test a duel on one machine without any networking, add `?local` to the URL
in two tabs: `http://localhost:8000/?local` to host, and the share link it
shows to join.

## How the multiplayer works

Players connect directly, browser to browser, over WebRTC using
[PeerJS](https://peerjs.com). PeerJS's free public server only introduces the
two players. The host acts as referee: it picks the quote and a random seed,
and both browsers build the identical cipher from them (`js/puzzle.js`). Only
progress percentages and "solved" or "gave up" messages are exchanged.

Most pairs connect directly. Players behind a VPN, a corporate firewall or a
strict mobile network need a **TURN relay**, which is set up in `js/config.js`:

1. Sign up for free at <https://www.metered.ca/stun-turn> and create a TURN app.
2. In `js/config.js`, set `meteredApp` to the app's subdomain (the `yourname`
   part of `yourname.metered.live`) and `meteredApiKey` to its API key.

To check the relay works, open the site with `?relay` on both sides. That
forces every connection through the relay.

When you change any JS or CSS file, bump the `?v=` number on the
`<script>`/`<link>` tags in `index.html` so browsers don't keep using cached
copies.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout: lobby, waiting room, game |
| `css/style.css` | Web 2.0 styling |
| `js/quotes.js` | Quote bank (add more here) |
| `js/puzzle.js` | Seeded cipher and puzzle generation |
| `js/config.js` | TURN relay settings |
| `js/net.js` | PeerJS connection, plus the `?local` and `?relay` test flags |
| `js/app.js` | Game board, input, match flow |

See [ROADMAP.md](ROADMAP.md) for what's next.
