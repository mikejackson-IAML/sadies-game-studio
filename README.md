# Her Game Studio — admin notes

A self-contained game studio for a kid, driven entirely through the Claude Code
web app. She generates 3D worlds with the World Labs Marble API, drops them into
Three.js game templates, and publishes playable games to GitHub Pages.

**She never sees this file.** Everything she reads — `CLAUDE.md`, `about-me.md`,
the skill, error messages, the arcade — is written for an 8-year-old. Everything
here is written for you.

---

## Setup checklist

### 1. Put the API key somewhere the server can read it

The key is read from `WORLDLABS_API_KEY` and **nothing else**. It is never
committed, never logged, and never included in anything Claude can show her.
`mcp/lib/config.js` scrubs it from error text before it can reach a log line.

Get a key at <https://platform.worldlabs.ai/>.

> **Billing gotcha:** API Platform credits are *separate* from the
> marble.worldlabs.ai web-app subscription. Credits in the web app do not fund
> API calls. A `402` means the API balance specifically is empty.

**For Claude Code on the web** (how she'll use it): add `WORLDLABS_API_KEY` as an
environment variable on the environment this repo runs in, via the Claude Code
web settings. It is injected into the MCP server through `.mcp.json`.

**For running things locally:**
```bash
cp .env.example .env
# edit .env and paste the real key
```
`.env` is gitignored. Verify with `npm run smoke` (see below).

### 2. Turn on GitHub Pages

Push this repo to GitHub, then:

**Settings → Pages → Build and deployment → Source: `Deploy from a branch`**,
branch `main`, folder **`/docs`**. Save.

Her arcade lands at `https://<username>.github.io/her-game-studio/`, and each
shipped game at `.../games/<slug>/`. A `.nojekyll` file is already in `docs/` so
Pages serves everything verbatim.

> The repo must be **public** for free GitHub Pages. Nothing sensitive is in it —
> the key lives only in the environment.

### 3. Connect the MCP server

`.mcp.json` is already committed and points at `mcp/server.js`. Claude Code picks
it up automatically when the repo is opened; approve it once when prompted. The
`SessionStart` hook in `.claude/settings.json` installs the one runtime
dependency if the container is fresh, so there is nothing to run by hand.

Verify the whole path before she uses it:

```bash
npm run smoke                  # checks key + auth + capabilities. Spends nothing.
npm run smoke -- --generate    # generates one REAL world. Spends credits + her daily allowance.
```

### 4. Change the daily limit

`config/studio.json` → `dailyWorldLimit`. Takes effect on the next tool call; no
restart needed. Clamped to 0–20 so a typo can't run up a bill. Setting it to `0`
blocks generation entirely while leaving every game playable.

Reset happens at **midnight in `timezone`** (default `America/Chicago`),
DST-aware.

### 5. Flip the ship-approval flag

`config/studio.json` → `requireShipApproval`.

- `false` (default) — `/ship` builds, commits, pushes, and gives her a live URL.
- `true` — `/ship` builds and stages the game but does **not** publish. It prints
  the exact `--approve` command for you to run. She is told her game is "ready
  and waiting for a thumbs up," never that it was rejected.

---

## How the daily limit actually holds

This was the part worth getting right, because instructions alone don't hold.

- The gate is `mcp/lib/limit.js`, called by `makeWorld` before any network call.
  Claude cannot talk it into a second world; the tool refuses and returns text
  telling Claude to be kind about it.
- The ledger is `logs/usage.json`. Both `succeeded` **and** `pending` records
  count — a crashed run already spent credits, so it still burns the day.
- A failure that never reached the API (missing key, network down, unknown
  world) **deletes** its record, so she isn't charged a day for your outage.
- **The ledger is committed and pushed the moment a world is generated.** This is
  load-bearing: Claude Code web sessions run in fresh containers that re-clone
  the repo, so a ledger living only on local disk would reset every session and
  hand out unlimited worlds. `mcp/lib/git.js` does this and never throws.

**Residual gap:** if a push fails (offline, bad credentials), the limit still
holds for that session but is not durable until something pushes. The failure is
recorded in `logs/errors.log`. Worth a glance if credits move faster than
expected.

---

## World Labs API — what was verified

The official docs at `docs.worldlabs.ai` were unreachable from the build
environment (blocked by network egress policy), so this was built against the
API surface as exercised by real client code, cross-checked between two
independent implementations. **Re-verify against the official docs when you can.**

| Thing | Value |
| --- | --- |
| Base URL | `https://api.worldlabs.ai/marble/v1` |
| Auth header | `WLT-Api-Key` |
| Generate | `POST /worlds:generate` → long-running operation |
| Poll | `GET /operations/{id}` → `{done, metadata.progress, response, error}` |
| World | `GET /worlds/{id}` · list: `POST /worlds:list` |
| Splat assets | `assets.splats.spz_urls.{100k,500k,full_res}` (SPZ) |
| Other assets | `assets.mesh.collider_mesh_url` (GLB), `assets.imagery.pano_url`, `assets.thumbnail_url` |
| Models | `marble-1.1` = 1500 credits · `marble-1.1-plus` = 1500 + 300/dynamic cube (max 5) |

**World expansion is not available via the API.** Marble's "expand an existing
world" is an interactive web-app feature; `marble-1.1-plus` expands automatically
*within* a single generation (up to five dynamic cubes). There is no endpoint
that extends an existing `world_id`.

So `add_to_world` does this instead:

1. **Probes** for a `worlds:expand` endpoint once a week (cached in
   `logs/api-capabilities.json`). The probe sends an empty body — a real endpoint
   returns 400/422, a missing one 404. No world is generated either way.
2. If one ever appears, it is used automatically, no code change needed.
3. Otherwise it **remixes**: the original world's stored prompt plus her addition,
   generated as a *new* world. Her original world file is never touched or
   deleted. She's told it's "a bigger version," which is honest.

This costs one generation, which is why the skill confirms with her first.

---

## Rendering

`@sparkjsdev/spark` v2.1.0 — World Labs' own Three.js Gaussian splat renderer,
which reads `.spz` natively. Both it and `three` 0.185.1 are **vendored** into
`vendor/`, so games are fully self-contained: no CDN, no build step, and they
work offline and on Pages identically.

If splat rendering ever misbehaves on a particular device, the collider-mesh GLB
URL is stored in `worlds/worlds.json` as `meshUrl` for each world — that's the
documented fallback path.

`worlds/placeholder/world.ply` is a **procedurally generated** splat scene
(35,010 splats, deterministic, `npm run world:placeholder` to rebuild). It ships
so all four games are playable before she has generated anything, and it carries
no third-party licence.

---

## Layout

```
CLAUDE.md              Written for her. Claude's operating instructions.
about-me.md            Her profile. Claude reads it every session; onboarding fills it in.
tomorrows-world.md     Auto-created. Interview prompts saved when she's out of generations.
config/studio.json     Daily limit, timezone, model, approval flag, studio name.
.mcp.json              Registers the world server with Claude Code.
.claude/
  settings.json        SessionStart hook (installs deps in fresh containers).
  skills/new-world/    The world interview. Gates every generation.
  commands/            /save-my-game and /ship.
mcp/
  server.js            stdio wiring only.
  lib/tools.js         make_world / list_my_worlds / worlds_left_today.
  lib/limit.js         The daily gate.
  lib/worldlabs.js     API client + kid-safe error mapping.
  lib/ledger.js        usage.json, usage.md, worlds.json. Atomic writes.
  lib/git.js           Commits + pushes the ledger so the limit survives a re-clone.
  test/                28 tests, incl. the full flow against a mocked API.
templates/             The four starter games. Never edited in place.
games/                 Her copies, created by /ship or by Claude.
shared/                Engine + stylesheet used by every game.
vendor/                three + spark + the addons spark needs.
worlds/                worlds.json registry + one folder per world.
docs/                  GitHub Pages root: arcade + shipped games.
logs/usage.md          Human-readable generation log — the one to skim.
logs/usage.json        Machine-readable ledger. Source of truth for the limit.
logs/errors.log        Technical failures. Gitignored. She never sees these.
```

---

## Commands

```bash
npm test               # 28 unit + integration tests (no network, no key needed)
npm run test:games     # drives all four games in a real browser, asserts they render
npm run serve          # preview locally: http://localhost:8080/templates/explore/
npm run arcade         # rebuild docs/index.html from docs/arcade.json
npm run ship -- --game explore --title "Star Hunt"
npm run save           # what "save my game" runs
npm run smoke          # verify the API key end to end
```

`npm run test:games` needs a Chromium. It uses `/opt/pw-browsers/chromium` if
present, otherwise whatever Playwright downloaded; override with
`PLAYWRIGHT_CHROMIUM_PATH`.

---

## Cost

At the default `marble-1.1-plus` and one world per day: **1500–3000 credits/day**
worst case, bounded by the daily limit. `logs/usage.md` records an estimate per
generation. Drop to `marble-1.1` in `config/studio.json` for a flat 1500, or
lower `dailyWorldLimit`.

---

## Safety properties worth knowing

- Nothing she can say makes the studio print the API key. `redact()` strips both
  the live key and anything key-shaped from every log line and error path.
- Nothing deletes her work. `/ship` rebuilds only the one game folder it targets.
  `save` only ever adds. The MCP server never removes a world.
- Error messages she sees contain no status codes, URLs, file paths, or jargon —
  asserted by tests, not just by convention.
- A corrupt or missing `config/studio.json` falls back to a limit of 1, not to
  unlimited.
