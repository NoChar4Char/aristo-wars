# Aristo Wars Roadmap

Guiding rule: stay a static site on GitHub Pages as long as possible. Add a
backend only when a feature truly needs shared, persistent state.

## v0.1: Playable duel (done)

- [x] Classic cryptogram board: click to select, type to fill every matching letter, arrow keys to move, Backspace to clear
- [x] Letters Remaining, letter-frequency table, on-screen keyboard (on by default on touchscreens)
- [x] Source shown in the clear, punctuation kept, no letter encodes to itself
- [x] Difficulty by starting letters (Easy 4 / Medium 2 / Hard 0)
- [x] Hints by mutual agreement: either player proposes at any time, and if the other agrees, the same letter is revealed on both boards (free in practice mode)
- [x] Late-2000s "Web 2.0" look: glossy header and nav tabs, boxed panels, sidebar, striped progress bars
- [x] 1v1 over WebRTC (PeerJS): room code and share link, host referees, same seeded cipher for both players
- [x] Live rival progress bar, 3-2-1 countdown, best of 1/3/5, rematch, disconnect handling
- [x] Practice (solo) mode
- [x] `?local` two-tab test mode

## v0.2: Make connections reliable (next, highest priority)

The biggest risk today is that some pairs of players can't connect at all.

- [ ] Add a TURN relay to `ICE_SERVERS` (for example, the Metered or Twilio free tiers, or a self-hosted coturn). Keep credentials short-lived if possible.
- [ ] Rejoin after a dropped connection: keep the room code and restore the round state from the host
- [ ] A connection-status light and a ping indicator in the scoreboard
- [ ] Optional fallback: relay game messages through Firebase Realtime Database or Supabase Realtime when WebRTC fails

## v0.3: Polish and feel

- [ ] Sound effects: key clicks, a "ding!" on solve, and a mute toggle
- [ ] Short chat or canned taunts ("Close!", "Well played")
- [ ] Solved-word animation and a flashy "WINNER!" banner for match wins
- [ ] Better mobile input: a hidden text field for the native keyboard, and larger touch targets
- [ ] Accessibility: screen-reader labels for cells, high-contrast theme, keyboard focus outlines
- [ ] Dark theme
- [ ] Optional "hint vote" setting for the host: always allow, require agreement (the default), or no hints
- [ ] Show the loser how far they got (percentage and time) on the round summary

## v0.4: More puzzles and modes

- [ ] Expand the quote bank to 500+ public-domain quotes, stored in `quotes.json` with categories (literature, history, science, humor)
- [ ] Category picker for the host
- [ ] **Patristocrat** mode (no word spaces), the classic hard variant
- [ ] Encrypt the source line as well, as an extra-hard option
- [ ] **Custom challenge**: each player writes a quote for the other to crack
- [ ] **Daily Duel**: everyone gets the same puzzle each day, seeded from the date. Works fully on a static site.

## v0.5: Scoring and records (static-friendly)

- [ ] Puzzle-Baron-style points per solve (base points, a time bonus, minus hints), shown alongside wins
- [ ] Local stats in `localStorage`: games played, win rate, fastest solve, streaks
- [ ] Shareable result text for the Daily Duel ("Aristo Wars #42 · 1:37 · 1 hint")

## v1.0: Accounts and leaderboards (needs a backend)

- [ ] Sign-in (GitHub, Google or email) through Supabase or Firebase Auth
- [ ] Elo rating and a public Hall of Fame
- [ ] Matchmaking queue: play a random opponent without sharing codes
- [ ] Server-checked results so leaderboards can't be faked. Today, a determined player could read the answer out of the page, which is fine for friendly games.
- [ ] Spectator links and more than 2 players ("battle royale" rooms)

## Known limitations

- Connecting fails for some VPN, corporate or strict-NAT networks until a TURN relay is configured (see v0.2).
- The public PeerJS signaling server is free and best-effort. For uptime you can self-host `peerjs-server`.
- There's no anti-cheat: the answer exists in each player's browser.
