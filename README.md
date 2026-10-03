# Aristo Wars

A multiplayer cryptogram race with a late-2000s puzzle-site look. Up to six
players get the same substitution cipher of a famous quotation and race to
crack it. Mechanics
follow the classic Puzzle Baron cryptogram: click a cell, type a letter, and it
fills every matching code letter. There's also a Letters Remaining strip, a
letter-frequency table under the puzzle, a reference chart of English letter
frequencies, an on-screen keyboard, and the quote's source shown in
the clear.

No build step and no backend. It's plain HTML, CSS and JavaScript with
[Bootstrap 5](https://getbootstrap.com) from a CDN, so it runs on GitHub Pages as is.

The lobby, the game and the rules are separate pages, so the browser's back
button works as expected. The waiting room lives on the game page because the
connection to your opponent only lasts while that page is open.

## Play

- **Set Up a Room**: pick the rules (or click **Use My Defaults**), then share
  the 4-character code or link. Click **Start Match** once everyone's in.
- **Join Room**: enter the code, or just open the share link.
- **Practice**: solo mode with a timer.
- **Default Settings**: save your usual rules in this browser.

**Default Settings** (used for practice, and filled in by **Use My
Defaults** when setting up a room): hints per round (0 for none, or
unlimited), the Letters Remaining panel, the letter count table under the
puzzle, highlighting matching letters, autofill, and the countdown length.
With autofill off, typing fills only the box you clicked, and the table's
"Your letter" row stays empty.

**Personal preference** (only affects you, never part of a room's rules):
letter case. Uppercase or Lowercase sets how your answers look and which keys
count. Either accepts both.

**Chosen fresh for every game:** number of rounds, number of players (2–6),
round time limit, extra time for everyone else after the first solve, how many
players must agree to a hint, and partial credit.

**Scoring:** a solve is worth 100 points. If the round ends first, a player
loses a set number of points for every unfinished letter beyond an allowance
(for example, −10 per letter after the first 2), never going below 0. The
highest total after the last round wins.

**Hints:** any player can propose one. If enough other players agree, one
letter is revealed on everyone's board. Practice hints are free.

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
shows to join. The flag follows you from page to page.

## How the multiplayer works

Players connect browser to browser over WebRTC using
[PeerJS](https://peerjs.com). PeerJS's free public server only introduces them.
The host's browser connects to every guest and acts as referee: it picks the
quote and a random seed (every browser builds the identical cipher from them in
`js/puzzle.js`), tracks progress, runs the time limit and grace period, counts
hint votes and scores each round. Only progress, "solved"/"gave up" and hint
messages are exchanged.

Most pairs connect directly. Players behind a VPN, a corporate firewall or a
strict mobile network need a **TURN relay**, which is set up in `js/config.js`:

1. Sign up for free at <https://www.metered.ca/stun-turn> and create a TURN app.
2. In `js/config.js`, set `meteredApp` to the app's subdomain (the `yourname`
   part of `yourname.metered.live`) and `meteredApiKey` to its API key.

To check the relay works, open the site with `?relay` on both sides. That
forces every connection through the relay.

When you change any JS or CSS file, bump the `?v=` number on the
`<script>`/`<link>` tags in every HTML page so browsers don't keep using
cached copies.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Lobby: name, host a room, join a room, practice |
| `create.html` | Room setup: choose the rules |
| `settings.html` | Default Settings |
| `play.html` | Waiting room and the game (`?mode=host&rules=…`, `?mode=join&room=CODE`, `?mode=practice`) |
| `how-to-play.html` | Rules |
| `css/style.css` | Web 2.0 theme on top of Bootstrap, plus the puzzle board |
| `js/common.js` | Shared helpers: links that keep test flags, saved screen name |
| `js/lobby.js` | Lobby page logic |
| `js/settings.js` | Game rules: definitions, saved defaults, forms, scoring |
| `js/settings-page.js` | Default Settings page logic |
| `js/create.js` | Room setup page logic |
| `js/game.js` | Game board, input, match flow |
| `js/quotes.js` | Quote bank (add more here) |
| `js/puzzle.js` | Seeded cipher and puzzle generation |
| `js/config.js` | TURN relay settings |
| `js/net.js` | PeerJS connection, plus the `?local` and `?relay` test flags |

See [ROADMAP.md](ROADMAP.md) for what's next.
