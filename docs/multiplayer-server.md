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
| `src/net/protocol.ts` | Message and HTTP types, room codes, `parseClientMessage`, fixed error wording. Shared with the 2c client. |
| `src/core/table.ts` | `TableCore`: real state, held choice, moves, both id maps. Shared by `LocalTable` (`src/ui/table.ts`) and the room. |
| `server/room.ts` | `RoomCore`: the room's logic with no Cloudflare types (runs under vitest). `settledFor`, `checkDeck`. |
| `server/gameRoom.ts` | `GameRoom`, the Durable Object (SQLite-backed): storage, sockets (Hibernation API), alarm. |
| `server/index.ts` | The game Worker's router: create (rate-limited), join, lobby, socket, internal report. |
| `server/forward.ts` | The site Worker's forwarding and the online bug report. |
| `server/tokens.ts` | Seat tokens (only SHA-256 hashes stored), room codes, seeds. |
| `server/cf.ts` | The few Workers runtime types used (instead of `@cloudflare/workers-types`, which clashes with the DOM types). |

## Protocol

HTTP (all JSON):

- `POST /api/games` `{ side, deck: { identity, cards }, format, visibility?: 'invite', playerId? }` -> 201 `{ code, seat, token }`. Startup and Standard use `validateDeck`; Casual only with a System Gateway starter deck as it comes (rules 1.4.1a). 5 per minute per address.
- `POST /api/games/:code/join` `{ deck, playerId? }` -> `{ seat, token }`; 404 unknown, 409 full, 422 `{ reasons }` illegal for the host's format. The game starts at once.
- `GET /api/games/:code` -> `{ code, format, hostSide, hostIdentity, open, over, build, protocol }` (never the decklist).
- `POST /api/games/:code/report?token=` `{ description, screen, version, website? }` -> 204 or an error status, no body (see Bug reports).
- Lookups, joins and socket connects: 30 per minute per address.

WebSocket `GET /api/games/:code/ws?token=`:

- Server: `hello { seat, build, protocol }`, `state { seq, view, legal, waitingOn, held }`, `opponent { connected }`, `error { code, message }`, `over { winner, reason }`, `pong`.
- Client: `act { seq, action }` (viewer ids), `cancel { seq }`, `ping` (answered by the runtime without waking the room).

No free-text field anywhere (no names, no chat). A seat is `playerId` plus token.

## What each seat is sent

- **seq is per seat**: it counts the states sent to that seat. An `act` must carry the latest one (`SET_STOPS` and `CONCEDE` need not). A global move counter would tell each seat how many moves the other made between its states.
- **The mover** gets its new state at once, unless its move led into a decision of the other side's inside an R&D access (below); then at the next settled point.
- **The other seat** gets a state only at a settled point, and only if what it would be sent changed.
- **Settled** for a viewer (`settledFor` in `server/room.ts`): the game waits on the viewer, or on nobody, or the decision it waits on is not inside the access of a card from R&D. "Inside the access of a card from R&D": the card most recently accessed this run was not accessed in Archives and is still in R&D (once stolen or trashed, where it went is public). This is audit finding LEAK-ACCESS-PAUSE (rules 4.2.2, 7.1.2): whether the Runner has something to decide about an R&D card says what the card is. At ALL stops every R&D access pauses (chunk 2a), so the sequence is the same anyway; at AUTO/NONE the Corp hears a move later when the Runner had something to decide, a timing tell only (accepted by Jeff for AUTO).
- **A held choice** (`uncommitted.ts`) is shown to its player only. Answering commits the action and the answer as one move; cancel sends nothing to the other seat. If the other seat changes its stops meanwhile, the stops go on the committed state and the choice is worked out again on top (dropped if it can no longer be held).
- **Errors** are fixed wording (`SOCKET_ERROR_TEXT`); the engine's text is logged on the server only.
- **Reconnect**: `hello`, then the last state the seat was sent, exactly as sent and stored with the room (`last:corp`, `last:runner`), never the state as it is now: at an unsettled point that would show the withheld moment. Then `over` if the game ended. A second socket on a seat closes the first (code 4000).
- **Client actions are rebuilt** (`sanitizeAction` in `src/net/protocol.ts`): known keys only, each value of a known shape (viewer ids, server ids, prompt and option ids, enums, bounded integers and lists); stops only `auto`, `full` or `none`. The room then accepts only what the seat was offered (its legal list), plus the own-side choices that list can't spell out, as on the local table: installs that trash first or go onto a host (8.5.6), a prompt answer that trashes first, an "any number of cards" answer to its own prompt. Cards discarded down to hand size and cards trashed first are a set: any order of an offered set is taken. So nothing a client sends reaches the other seat's view or the stored moves unchecked (no free text, no chat).

## Storage and lifetime

Five values per room (`meta`, `state`, `moves`, `last:corp`, `last:runner`), one row each: `meta` (seats, token hashes, decks, format, build, seq and last-sent hashes, both id maps, the held action, result), `state` (the real `GameState`), `moves`, and each seat's last state message as sent. The held choice is stored as its action and worked out again on load. Every change is written before anything is sent, but only what changed (`storageWrites` in `server/room.ts`): `meta` always, `state` and `moves` on a committed move, a seat's `last:*` when it was sent a state. A move writes 2-4 rows. Measured in the 200-game fuzz: late-game state up to about 86 KB, moves about 50 KB, meta about 7 KB, messages up to about 98 KB.

**Daily ceiling (free plan).** Durable Objects storage allows 100,000 rows written a day. At about 3 rows a move and 200-500 moves a game that is roughly 65-165 games a day across all rooms. The limit is per account, so staging and production share it (figure from the reviewer's reading of Cloudflare's pricing, unverified here). Past it, writes fail until the next day; if online play outgrows that, the paid plan's allowance is far higher.

**CPU.** A Durable Object gets 30 s of CPU per incoming request or WebSocket message, on the free plan too (Cloudflare's Durable Objects limits page, read through a search summary on 2026-11-10 because developers.cloudflare.com is blocked in these threads). Measured (room fuzz `--wake`, 16 games, 1,384 wakes: load from JSON, move, snapshot): p50 2.0 ms, p99 13.4 ms, max 19.5 ms. No saving needed.

Alarm: 7 days after the last move, or 1 day after the game ended, the room deletes itself. The alarm is set only when there is none or the room now expires sooner (the game ended); after more moves it fires early, sees the room isn't due yet and sets itself again, so moves don't each write an alarm. A state that no longer loads after a deploy ends the game as a draw (`over { winner: null, reason: 'server update' }`).

## Bug reports

The room's attachment never reaches the browser: the site Worker asks the game Worker (`/internal/games/:code/report`), builds the report and files it through `worker/bugReport.ts` as usual. It is the whole game (real state, moves, seed, both decks, full log), also mid-game. Issues go to a public repository, so a report filed mid-game shows the opponent's hidden cards to anyone reading the issue; Jeff accepted that for bug fixing (2026-11-09, "if it's a problem we can change it later"). The fix, if needed: attach the reporter's view until the game ends (`RoomCore.reportFor`).

## Checks

- `tests/room.test.ts`: create, join, illegal decks, full room, stale seq, wrong seat, reconnect, held choice and cancel, concede, game over, lifetime, broken state, generic errors, settled points.
- `scripts/room-fuzz.ts` (library `scripts/leak-check-room.ts`, short version `tests/roomFuzz.test.ts`): two clients play through `RoomCore`; every message is leak-checked, seq and settled rules checked, snapshots reloaded, and the twin check runs at the message level (stops at ALL; odd seeds with the Runner at AUTO compare message sequences, Corp blind, R&D pairs).
- Dry runs: `npx wrangler deploy --dry-run -c wrangler.games.jsonc` (and `.staging.jsonc`), and of the site with the bindings.

## Cloudflare setup (once)

See the hand-off for the steps sent to Jeff. In short: two new Workers from the same repository, each with its own deploy command (`-c wrangler.games.jsonc` / `-c wrangler.games.staging.jsonc`), production branch `main` / `beta`, no builds for other branches. The site's bindings go in only after the Workers exist, because the site's deploy needs them.

**Production branches, in order** (both Workers were first set to build from `mp-server`, 2026-11-10):

1. After `mp-server` merges to `beta`: set both `netrunner-games-staging` and `netrunner-games` to build from `beta`. Not `main` yet: `main` has no `wrangler.games.jsonc` until beta merges to main, so every push to main would fail the build.
2. As part of the beta -> main merge: set `netrunner-games` to build from `main`. Staging stays on `beta`.

Cloudflare shows the game Workers a note asking to update the name in `wrangler.jsonc`: it reads the root file and ignores `-c`. Ignore it, and never merge an automatic PR that renames `wrangler.jsonc` (that is the site's Worker).

`BUILD_ID`: the deploy command passes the commit (`--var BUILD_ID:$WORKERS_CI_COMMIT_SHA`); without it the build id is `dev`. Chunk 2c compares it with the page's build to ask for a refresh.
