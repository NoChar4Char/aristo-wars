# Aristo Wars Roadmap

Guiding rule: stay a static site on GitHub Pages as long as possible. Add a
backend only when a feature truly needs shared, persistent state.

## v0.1: Playable duel (done)

- [x] Classic cryptogram board: click to select, type to fill every matching letter, arrow keys to move, Backspace to clear
- [x] Letters Remaining, letter-frequency table, on-screen keyboard (on by default on touchscreens)
- [x] Source shown in the clear, punctuation kept, no letter encodes to itself
- [x] Every puzzle starts blank, with no letters filled in
- [x] Letter-frequency table (2 rows × 27 columns) under the puzzle, and a sidebar chart of English letter frequencies
- [x] Hints by mutual agreement: either player proposes at any time, and if the other agrees, the same letter is revealed on both boards (free in practice mode)
- [x] Late-2000s "Web 2.0" look: glossy header and nav tabs, boxed panels, sidebar, striped progress bars
- [x] Built on Bootstrap 5, with separate pages for the lobby, game and rules (the back button works)
- [x] Rooms for up to 6 players, with a host-controlled Start Match
- [x] Default Settings page (rules for practice and competition, plus personal letter case), and a room setup page with "Use My Defaults"
- [x] Options: 0–5 or unlimited hints, Letters Remaining on/off, letter count table on/off, highlight matching letters, autofill on/off
- [x] Per-game rules: player count, round time limit, grace period after the first solve, hint-agreement threshold, partial credit
- [x] Points scoring: 100 per solve, with configurable deductions for unfinished letters
- [x] 1v1 over WebRTC (PeerJS): room code and share link, host referees, same seeded cipher for both players
- [x] Live rival progress bar, 3-2-1 countdown, best of 1/3/5, rematch, disconnect handling
- [x] Practice (solo) mode
- [x] `?local` two-tab test mode

## v0.2: Make connections reliable (next, highest priority)

The biggest risk today is that some pairs of players can't connect at all.

- [x] TURN relay (Metered) configured in `js/config.js`, so players can connect from any network
- [ ] Switch to short-lived relay credentials (Metered's credentials API) instead of the static login
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
- [ ] Difficulty levels based on quote length (short quotes are harder to crack)
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
- [ ] Spectator links and bigger rooms (more than 6 players)

## Known limitations

- Connecting fails for some VPN, corporate or strict-NAT networks until a TURN relay is configured (see v0.2).
- The public PeerJS signaling server is free and best-effort. For uptime you can self-host `peerjs-server`.
- There's no anti-cheat: the answer exists in each player's browser.
