# The game server (multiplayer phase 2, chunk 2b)

A second Cloudflare Worker owns every online game. The browser never talks to
it directly: the site Worker forwards `/api/games/*` to it through a service
binding, so the page only ever calls its own origin (no CORS, no second domain).

| Worker | Config | Built from | Used by |
| --- | --- | --- | --- |
| `netrunner-games` | `wrangler.games.jsonc` | `main` | `stackheap.run`, `android-netrunner-digital.jk9321.workers.dev` |
| `netrunner-games-staging` | `wrangler.games.staging.jsonc` | `beta` | the beta preview and every branch preview |

Both have `workers_dev: false` and `preview_urls: false`: they have no public
URL, only the site's bindings reach them (`GAMES`, `GAMES_STAGING` in
`wrangler.jsonc`; `server/forward.ts` picks by hostname). This matters: the
game Worker's internal report route returns the real state of a finished game.

## Code

| File | What |
| --- | --- |
| `src/net/protocol.ts` | Message and HTTP types, room codes, `parseClientMessage`, fixed error wording. Shared with the browser (`src/net/client.ts`, below). |
| `src/core/table.ts` | `TableCore`: real state, held choice, moves, both id maps. Shared by `LocalTable` (`src/ui/table.ts`) and the room. |
| `server/room.ts` | `RoomCore`: the room's logic with no Cloudflare types (runs under vitest). `settledFor`, `checkDeck`. |
| `server/gameRoom.ts` | `GameRoom`, the Durable Object (SQLite-backed): storage, sockets (Hibernation API), alarm. |
| `server/index.ts` | The game Worker's router: create (rate-limited), join, lobby, socket, internal report. |
| `server/forward.ts` | The site Worker's forwarding and the online bug report. |
| `server/tokens.ts` | Seat tokens (only SHA-256 hashes stored), room codes, seeds. |
| `server/limits.ts` | What one seat can make the room do (chunk 2e): the stops and socket budgets, the game-length cap. |
| `server/http.ts` | JSON responses and `readBody` (request bodies read as a stream, capped at 64 KB). |
| `server/cf.ts` | The few Workers runtime types used (instead of `@cloudflare/workers-types`, which clashes with the DOM types). |

## Protocol

HTTP (all JSON):

- `POST /api/games` `{ side, deck: { identity, cards }, format, visibility?: 'invite', playerId? }` -> 201 `{ code, seat, token }`. Startup and Standard use `validateDeck`; Casual only with a System Gateway starter deck as it comes (rules 1.4.1a). 5 per minute per address.
- `POST /api/games/:code/join` `{ deck, playerId? }` -> `{ seat, token }`; 404 unknown, 409 full, 422 `{ reasons }` illegal for the host's format. The game starts at once.
- `GET /api/games/:code` -> `{ code, format, hostSide, hostIdentity, open, over, build, protocol }` (never the decklist).
- `POST /api/games/:code/report?token=` `{ description, screen, version, website? }` -> 204 or an error status, no body (see Bug reports).
- Lookups, joins and socket connects: 30 per minute per address.
- Create and join bodies are read as a stream and cut off past 64 KB: 413 (`bad_request`), also when there is no `Content-Length` (chunked) or it says less than is sent (chunk 2e, audit MP-BODY-READ). A deck is a few KB.

WebSocket `GET /api/games/:code/ws?token=`:

- Server: `hello { seat, build, protocol }`, `state { seq, view, legal, waitingOn, held }`, `opponent { connected }`, `error { code, message }`, `over { winner, reason, final? }`, `pong`.
- Client: `act { seq, action }` (viewer ids), `cancel { seq }`, `ping` (answered by the runtime without waking the room).
- Close codes: 4000 another socket took the seat, 4001 the room was deleted, 4002 the socket went past its message budget (below; the client reconnects with its normal delays, as after any drop).
- Error codes are fixed wording (`SOCKET_ERROR_TEXT`). `too_many` ("Too many changes, wait a moment", chunk 2e) is additive: an older client shows its generic text for a code it does not know, so `PROTOCOL_VERSION` stays 1.

No free-text field anywhere (no names, no chat). A seat is `playerId` plus token.

## What each seat is sent

- **seq is per seat**: it counts the states sent to that seat. An `act` must carry the latest one (`SET_STOPS` and `CONCEDE` need not). A global move counter would tell each seat how many moves the other made between its states.
- **The mover** gets its new state at once, unless its move led into a decision of the other side's inside an R&D access (below); then at the next settled point.
- **The other seat** gets a state only at a settled point, and only if what it would be sent changed.
- **Settled** for a viewer (`settledFor` in `server/room.ts`): the game waits on the viewer, or on nobody, or the decision it waits on is not inside the access of a card from R&D. "Inside the access of a card from R&D": the card most recently accessed this run was not accessed in Archives and is still in R&D (once stolen or trashed, where it went is public). This is audit finding LEAK-ACCESS-PAUSE (rules 4.2.2, 7.1.2): whether the Runner has something to decide about an R&D card says what the card is. At ALL stops every R&D access pauses (chunk 2a), so the sequence is the same anyway; at AUTO/NONE the Corp hears a move later when the Runner had something to decide, a timing tell only (accepted by Jeff for AUTO).
- **A held choice** (`uncommitted.ts`) is shown to its player only. Answering commits the action and the answer as one move; cancel sends nothing to the other seat. If the other seat changes its stops meanwhile, the stops go on the committed state and the choice is worked out again on top (dropped if it can no longer be held).
- **The final table** (chunk 2d): `over` carries `final`, the real `GameState` at the end, to both seats, once the game has a winner (a concession too). Rule 1.7.1 ends the game, so nothing is hidden any more: both hands, R&D, facedown cards, as a local game shows at its end. It is built from the stored `state` (no second copy) and serialised once for both seats; it is as big as the stored state (up to about 86 KB), one message per seat. Not sent for the "server update" draw (`winner: null`: the room could not read its game, so there is nothing trustworthy to show). No message before `over` carries it; the room fuzzer's leak check allows `over.final` and nothing else, and checks it is the real final state. The field is optional and additive, so `PROTOCOL_VERSION` stays 1: an older client ignores it, and a newer client on an older server (a branch preview against staging built from beta before this merged) gets no `final` and keeps the end screen it had.
- **Errors** are fixed wording (`SOCKET_ERROR_TEXT`); the engine's text is logged on the server only.
- **Reconnect**: `hello`, then the last state the seat was sent, exactly as sent and stored with the room (`last:corp`, `last:runner`), never the state as it is now: at an unsettled point that would show the withheld moment. Then `over` if the game ended (with `final`, as above). A second socket on a seat closes the first (code 4000).
- **Client actions are rebuilt** (`sanitizeAction` in `src/net/protocol.ts`): known keys only, each value of a known shape (viewer ids, server ids, prompt and option ids, enums, bounded integers and lists); stops only `auto`, `full` or `none`. The room then accepts only what the seat was offered (its legal list), plus the own-side choices that list can't spell out, as on the local table: installs that trash first or go onto a host (8.5.6), a prompt answer that trashes first, an "any number of cards" answer to its own prompt. Cards discarded down to hand size and cards trashed first are a set: any order of an offered set is taken. So nothing a client sends reaches the other seat's view or the stored moves unchecked (no free text, no chat).

## Limits (chunk 2e, audit MP-STOPS-WRITE-FLOOD)

What one seat can make the room do, so no seat can spend the account's daily writes (`server/limits.ts`):

- **Unchanged stops are nothing.** `SET_STOPS` with the level the seat already has: no move, no write, no message to either seat (decided in the room; the engine and the local game are unchanged).
- **Stops changes are budgeted per seat**: 5 at once, one back every 5 s (a token bucket). A change is still a stored move, because a replay needs it (it changes where the game stops). Over budget: nothing applied or written, and the seat gets `error too_many`. The bucket is kept in `meta.stopsBudget`, which the allowed change writes anyway, so it survives the room going to sleep with no write of its own; a room stored before this has none and starts full. The client never resends on that error: it shows the text and sets its stops menu back to what the room has.
- **A message budget per seat's socket**: 40 at once, 5 a second back, counting every message that reaches the room (acts, stale acts, cancels, junk; the keep-alive `ping` is answered by the runtime and never reaches it). Past it the room closes the socket with 4002 and reads and writes nothing. In memory only: a flood keeps the object awake, so the bucket lives as long as the flood; after a sleep it starts full, which the quiet time would have refilled anyway. It is kept by seat, so a reconnect does not refill it. Measured against the client's full-game test (`tests/onlineClient.test.ts`, four games, a move every 200 ms between the two seats): a seat never used more than 1 of the 40 (5 a second is exactly the refill). At a move every 100 ms, which no person sustains, the random Runner, which also passes every window a person at AUTO never sees, ran it out in long turns in 3 of the 4 games.
- **A game's length is capped** at `MAX_GAME_MOVES` committed moves; a game that reaches it ends as a draw, `over { winner: null, reason: 'game too long' }`, with no final table (as for the "server update" draw). Not a rules end (rules 1.7 has none for length): a server limit. `MAX_GAME_MOVES` is 10,000: the longest game in `room-fuzz.ts -- 200 9000 both` (beta 22277c4, random clients at ALL stops) had 1,244 moves (seed 9050; the longest AI game 526), so the cap is about 8 times that. The move list at the cap is about 800 KB stored.
- **Discard prompts list at most 256 answers** (MP-DISCARD-COMBINATORICS): discarding down to hand size from a big hand used to list every combination (hand 18 down to 5: 8,568 answers, 2 MB in the `state` message and the stored `last:*`). The listing now stops at 256, as for "any number of cards" prompts; every answer of exactly that many different cards from the hand stays legal (rules 4.3.6, 5.5.4c), and the room's `offered` and the seat's `seatCan` accept an unlisted one by that test. A hand of 18 sends a state under 100 KB.
- **Creating a room writes `meta` only**: a key that is missing loads as empty, so the empty state, move list and last states are not written until the game starts.

## Storage and lifetime

Five values per room (`meta`, `state`, `moves`, `last:corp`, `last:runner`), one row each: `meta` (seats, token hashes, decks, format, build, seq and last-sent hashes, both id maps, the held action, result), `state` (the real `GameState`), `moves`, and each seat's last state message as sent. The held choice is stored as its action and worked out again on load. Every change is written before anything is sent, but only what changed (`storageWrites` in `server/room.ts`): `meta` always, `state` and `moves` on a committed move, a seat's `last:*` when it was sent a state. A held choice writes 2 rows, a committed move 3 to 5: 5 whenever both seats are sent a state, which is most moves (ROWS_PLACEHOLDER). Measured in the 200-game fuzz: late-game state up to about 86 KB, moves about 50 KB, meta about 7 KB, messages up to about 98 KB.

**Daily ceiling (free plan).** Durable Objects storage allows 100,000 rows written a day, and 100,000 requests a day (each incoming WebSocket message counts as 1/20 of a request). Both are per account, so staging and production share them (figures from the reviewer's reading of Cloudflare's pricing, unverified here: check the Cloudflare dashboard). At about 5 rows a move and 200-500 moves a game that is roughly 40-100 honest games a day across all rooms. Past it, writes fail until the next day; if online play outgrows that, the paid plan's allowance is far higher.

What one person can still spend, with the limits above (chunk 2e). Out-of-turn messages of any kind (repeated or alternating stops, stale acts, cancels with nothing held, pings, junk) now write at most the 5 burst stops changes of 5 rows each, then a change every 5 s: `tests/room.test.ts` "guard" counts 25 rows for 1,000 alternating stops (5,000 on beta 22277c4), 0 for every other kind. Sustained, a seat that changes its stops as fast as allowed writes 5 rows every 5 s: about 86,400 rows a day per seat, close to the whole allowance on its own. What is left:

- **Two cooperating seats playing real moves fast** (one person with two browsers): every move is checked and legal, so it is stored. Bounded by the socket budget, 5 messages a second per seat: at most about 10 moves a second for the pair, 5 rows each, about 4.3 million rows a day, or the whole allowance in under an hour. The game-length cap ends each game at `MAX_GAME_MOVES` moves, so they must keep creating rooms (below).
- **A seat changing its stops at the budget**: 5 rows every 5 s, about 86,400 rows a day per seat (above). One room, two seats: twice that.
- **Creating rooms at the create limit** (5 a minute per address): `meta` and the alarm, about 2 rows each, 7,200 rooms and about 14,400 rows a day per address; seven addresses use up the allowance.

So the limits stop a single script from emptying the day's writes in minutes with junk or toggles, but a determined person can still spend it within hours. The next step, if needed, is a per-address budget across rooms (the Worker's rate limiters) or the paid plan; not in this chunk.

**CPU.** A Durable Object gets 30 s of CPU per incoming request or WebSocket message, on the free plan too (Cloudflare's Durable Objects limits page, read through a search summary on 2026-11-10 because developers.cloudflare.com is blocked in these threads). Measured (room fuzz `--wake`, 16 games, 1,384 wakes: load from JSON, move, snapshot): p50 2.0 ms, p99 13.4 ms, max 19.5 ms. No saving needed.

Alarm: 7 days after the last move, or 1 day after the game ended, the room deletes itself. For a local `wrangler dev` only, the Durable Object reads `ROOM_IDLE_MS` and `ROOM_ENDED_MS` from its variables; no wrangler config file sets them, and anything but a positive number is ignored, so production keeps 7 days / 1 day.

The alarm on workerd (chunk 2e, MP-ALARM-UNTESTED): checked by hand, not in `npm run test:e2e:online`. A `--var` (or `--env-file`) on a multi-config `wrangler dev` reaches only the first Worker, the site, so the game Worker has to run in its own process: `wrangler dev -c wrangler.games.staging.jsonc --var ROOM_ENDED_MS:4000 --port 8789 --inspector-port 9230`, then the site with `wrangler dev -c wrangler.jsonc --port 8787` (they find each other through wrangler's local dev registry). With the e2e game plus "wait past the lifetime, the lobby answers 404", that passed 3 times (2026-11-11): the alarm fires, `deleteAll` runs and the lobby is 404 within about 10 s of the concession. As a regular test it was flaky: in 2 of 3 runs in a row the site could not reach the game Worker at all ("Network connection lost" on every request, a dev-registry problem between the two processes, before anything of ours ran), so it stays out of the suite until phase 3 finds a steadier setup (a config file with the variable is not allowed in this chunk). The alarm is set only when there is none or the room now expires sooner (the game ended); after more moves it fires early, sees the room isn't due yet and sets itself again, so moves don't each write an alarm. A state that no longer loads after a deploy ends the game as a draw (`over { winner: null, reason: 'server update' }`).

## Bug reports

The room's attachment never reaches the browser: the site Worker asks the game Worker (`/internal/games/:code/report`), builds the report and files it through `worker/bugReport.ts` as usual. It is the whole game (real state, moves, seed, both decks, full log), also mid-game. Issues go to a public repository, so a report filed mid-game shows the opponent's hidden cards to anyone reading the issue; Jeff accepted that for bug fixing (2026-11-09, "if it's a problem we can change it later"). The fix, if needed: attach the reporter's view until the game ends (`RoomCore.reportFor`).

## Checks

- `tests/room.test.ts`: create, join, illegal decks, full room, stale seq, wrong seat, reconnect, held choice and cancel, concede, game over, lifetime, broken state, generic errors, settled points, the final table (sent with `over` for a win, a concession and a reconnect to a finished room; not for the "server update" draw; in no message before `over`), the limits (unchanged stops, the stops budget across a reload, the guard: 1,000 messages of each out-of-turn kind and the rows they write, the game-length draw, lifetime overrides).
- `tests/onlineClient.test.ts`: the socket budget applied by the test's hub in the full games (never reached), close code 4002 reconnects, a refused stops change is not resent. `tests/protocolForward.test.ts`: the body cap with a chunked body.
- `scripts/room-fuzz.ts` (library `scripts/leak-check-room.ts`, short version `tests/roomFuzz.test.ts`): two clients play through `RoomCore`; every message is leak-checked, seq and settled rules checked, snapshots reloaded, and the twin check runs at the message level (stops at ALL; odd seeds with the Runner at AUTO compare message sequences, Corp blind, R&D pairs). Now and then a seat floods 20 messages that must store and send nothing (its stops at the level it has, acts and cancels with a seq it was never sent). The summary prints the longest game and the rows each stored move wrote.
- Dry runs: `npx wrangler deploy --dry-run -c wrangler.games.jsonc` (and `.staging.jsonc`), and of the site with the bindings.

## Cloudflare setup (once)

See the hand-off for the steps sent to Jeff. In short: two new Workers from the same repository, each with its own deploy command (`-c wrangler.games.jsonc` / `-c wrangler.games.staging.jsonc`), production branch `main` / `beta`, no builds for other branches. The site's bindings go in only after the Workers exist, because the site's deploy needs them.

**Production branches, in order** (both Workers were first set to build from `mp-server`, 2026-11-10):

1. After `mp-server` merges to `beta`: set both `netrunner-games-staging` and `netrunner-games` to build from `beta`. Not `main` yet: `main` has no `wrangler.games.jsonc` until beta merges to main, so every push to main would fail the build.
2. As part of the beta -> main merge: set `netrunner-games` to build from `main`. Staging stays on `beta`.

Cloudflare shows the game Workers a note asking to update the name in `wrangler.jsonc`: it reads the root file and ignores `-c`. Ignore it, and never merge an automatic PR that renames `wrangler.jsonc` (that is the site's Worker).

`BUILD_ID`: the deploy command passes the commit (`--var BUILD_ID:$WORKERS_CI_COMMIT_SHA`); without it the build id is `dev`. The browser compares `protocol`, not the build (branch previews talk to staging built from beta), to ask for a refresh.

## The browser side (chunk 2c)

| File | What |
| --- | --- |
| `src/net/client.ts` | `OnlineTable`: one seat fed by the room's socket (what `LocalTable` gives the controller), reconnects, keep-alive, the saved session and player id. No React, no engine. |
| `src/net/lobby.ts` | Host, look up and join (`/api/games`), with fixed wording for each failure; `onlineDeckProblems` (the server's own `checkDeck`); invite links. |
| `src/ui/seatLegality.ts` | The seat's legality without the real state (`seatCan`, `seatReason`), shared by the local and the online table. |
| `src/ui/useOnlineController.ts` | The online game's controller, the same shape as `useGameController`; both use `src/ui/controllerShared.ts`. |
| `src/ui/components/OnlineScreens.tsx` | The host's waiting room and the notices (open somewhere else, room gone, new version). |

- **Start screen** (`DeckPicker`): how to play first (computer, pass and play, online), then that choice's settings, then only the decks it needs. Online decks not legal in the game's format are greyed out with the reasons on hover.
- **Invite link**: `/play/K7QM-2X` opens Join with the code filled in and looked up (the site serves the app for unknown paths). The address goes back to `/` when the person leaves Join or the game starts. The link and the address bar never carry the token.
- **Session**: `{ code, seat, token }` under `netrunner.online` in localStorage (a reload or a closed tab resumes the game), cleared when the game ends or the player leaves; a random 22-character `playerId` under `netrunner.playerId`. Nothing else of an online game is stored in the browser.
- **No optimistic updates**: after an action the seat offers nothing until the next `state` (or an error). `stale` and `not_your_turn` end or keep the wait quietly; `illegal` shows the fixed text.
- **Reconnect**: 1, 2, 4, 8, then every 15 s. A socket refused before `hello` asks the lobby; a 404 means the room is gone; 4 refusals in a row while the lobby answers 200 for the room (a token it no longer knows; offline or a busy lobby counts nothing) stop the retries: "This browser is no longer seated at that game". 4000: "This game is open somewhere else" with Play here instead; leaving that notice keeps the saved session, which the playing tab of the same browser needs. The invite shows only to a host whose game has not started (`inviting` in the saved session, dropped at the first state); anyone else sees "Connecting to the game…" until the first state. 4001: the room is gone. A `hello` (or lobby) with another `protocol` asks for a refresh and sends nothing.
- **The end**: on `over` with `final` the seat becomes the open table's seat (`side: 'both'`, `view: null`, the final state, nothing legal, `act` sends nothing) and the controller's viewer becomes `'both'`, so the screen opens up as a local game does at its end. The switch fires no move listener (the ids change from the player's view-local ones to the engine's, so a before-and-after would show cards moving that did not): no sounds, card showings or accesses for it; the selection and showings from before are cleared. Without `final` the end screen stays as it was.
- **Stops**: the toggle sends `SET_STOPS` for the player's own side; on the first state the saved setting is sent once if the room has another.
- **Bug reports**: `POST /api/games/:code/report?token=` with only the description, screen, version and the honeypot; the dialog says the whole game goes with it, both players' hidden cards included.

**Local run on the Workers runtime**: `npm run test:e2e:online` builds the site and runs `wrangler dev -c wrangler.jsonc -c wrangler.games.staging.jsonc` (site and game Worker together, local SQLite Durable Object), then `e2e/online.workerd.ts` plays with two browsers: host, join by link, a turn each, a reload, concede. Wrangler is not a repo dependency (the Cloudflare builds bring their own): the config fetches `wrangler@4.155.0` with npx, or uses `$WRANGLER`. On its first run (2026-11-10) the local workerd refused to start the game Worker because its entry exported a constant, `SERVER_PROTOCOL` ("Incorrect type for map entry"; Cloudflare's own builds had accepted it). The constant was unused and is removed.
