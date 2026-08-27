# Her Game Studio — admin notes

A self-contained game studio for a kid, driven entirely through the Claude Code
web app. She designs 3D worlds in a five-step design studio, generates them with
the World Labs Marble API, drops them into Three.js game templates as her own
character, and publishes playable games to GitHub Pages.

**She never sees this file.** Everything she reads — `CLAUDE.md`, `about-me.md`,
the skill, error messages, the arcade — is written for an 8-year-old. Everything
here is written for you.

For how the system works internally, see **`SPEC.md`**.

---

## Setup checklist

### 1. Keys

Both are read from the environment only. Neither is ever committed, logged, or
included in anything Claude can show her — `redact()`/`scrub()` strip them from
every error path before it reaches a log line.

| Key | Required? | Get it |
| --- | --- | --- |
| `WORLDLABS_API_KEY` | **Yes** — no worlds without it | <https://platform.worldlabs.ai/> |
| `GEMINI_API_KEY` | Optional — concept images | <https://aistudio.google.com/apikey> |

> **Billing gotcha:** World Labs API Platform credits are *separate* from the
> marble.worldlabs.ai web-app subscription. Credits in the web app do not fund
> API calls. A `402` means the API balance specifically is empty.

Without `GEMINI_API_KEY` the design studio still runs end to end — it just skips
the pictures and says so in Claude-facing text. Nothing errors at her.

**For Claude Code on the web** (how she'll use it): add both as environment
variables on the environment this repo runs in, via the Claude Code web settings.
They reach the MCP server through `.mcp.json`.

**For running things locally:**
```bash
cp .env.example .env      # then paste the real keys
```
`.env` is gitignored. Verify with `npm run smoke`.

### 2. Privacy word list — do this before she ships anything

```bash
cp config/privacy.example.json config/privacy.local.json
# fill in her last name, school, city, street
```

`config/privacy.local.json` is **gitignored** — it holds her real details and
must never be committed. `npm run ship` scans everything being deployed against
it and **refuses to publish** on a match, rolling the build back. It also strips
EXIF from every cover image (a photo of her drawing can carry GPS).

Without this file, text scanning is off and ship says so. Image metadata is
still checked and stripped either way.

### 3. Turn on GitHub Pages

Push the repo, then **Settings → Pages → Source: `Deploy from a branch`**,
branch `main`, folder **`/docs`**.

Her arcade lands at `https://<username>.github.io/her-game-studio/`, each game at
`.../games/<slug>/`. `.nojekyll` is already there.

> The repo must be **public** for free GitHub Pages. Nothing sensitive is in it.

### 4. Git LFS — before the first push if possible

```bash
npm run lfs:setup
```

World binaries are large and each costs a day of her one-a-day allowance.
`.gitattributes` already tracks `worlds/**/*.{spz,ply,glb}`. Running this before
the first push means everything starts in LFS; running it later means rewriting
history (the script prints the exact `git lfs migrate` command).

Until git-lfs is installed the patterns are inert and git does not error.

> GitHub's free LFS tier is **1 GB**. At roughly one world a day you will want a
> data pack fairly quickly.

### 5. A second copy of her worlds

```bash
# set a destination once
#   "backupPath" in config/studio.json, or STUDIO_BACKUP_PATH
npm run backup              # mirror + verify
npm run backup -- --verify  # check only; non-zero exit on mismatch
```

Mirrors `worlds/` (drafts included — an unbuilt World Card is still her work) to
any path: external drive, synced folder, rclone mount. Maintains
`worlds/backup-manifest.json` with a SHA-256 per file, so silent corruption is
detectable and repairable. The manifest is written even with no destination set.

### 6. Connect the MCP server

`.mcp.json` is committed and points at `mcp/server.js`. Claude Code picks it up
when the repo is opened; approve it once when prompted. The `SessionStart` hook
installs the one runtime dependency if the container is fresh.

Verify the whole path before she uses it:

```bash
npm run smoke                  # key + auth + capability probe. Spends nothing.
npm run smoke -- --generate    # generates one REAL world. Spends credits + her daily allowance.
```

### 7. Knobs

All in `config/studio.json`, live on the next tool call, no restart:

| Key | Default | Effect |
| --- | --- | --- |
| `dailyWorldLimit` | `1` | Worlds per day. Clamped 0–20 so a typo can't run up a bill. `0` blocks generation while leaving every game playable. |
| `timezone` | `America/Chicago` | When the limit resets (local midnight, DST-aware). |
| `marbleModel` | `marble-1.1-plus` | `marble-1.1` = flat 1500 credits; `-plus` = 1500 + 300/dynamic cube (max 5). |
| `requireShipApproval` | `false` | `true` stages a game and prints an `--approve` command instead of publishing. She's told it's "waiting for a thumbs up", never rejected. |
| `maxHeroRevisions` | `2` | How many times she can redraw the concept image. Bounds the image bill. |
| `imageModel` | `gemini-3.1-flash-image` | `gemini-2.5-flash-image` also works. |
| `splatQuality` | `500k` | `100k` / `500k` / `full_res`. Affects file size and phone performance. |
| `backupPath` | `""` | Second location for `npm run backup`. |
| `studioName` | `""` | Set during her onboarding; titles the arcade. |

Her character lives in `config/avatar.json` (colours, hat, companion) and is set
during onboarding. The style menu is `config/styles.json` — add or edit recipes
freely; her own worlds join the menu automatically.

---

## How the daily limit actually holds

Instructions alone don't hold, so the gate is code.

- `mcp/lib/limit.js` is called before any network call. Claude cannot talk it
  into a second world.
- Both `succeeded` **and** `pending` records count — a crashed run already spent
  credits.
- A failure that never reached the API deletes its record, so she isn't charged
  a day for your outage.
- **The ledger is committed and pushed the moment a world is generated.** This is
  load-bearing: web sessions run in fresh containers that re-clone the repo, so a
  local-only ledger would reset every session.

**Residual gap:** if a push fails, the limit holds for that session but isn't
durable until something pushes. Recorded in `logs/errors.log`. Worth a glance if
credits move faster than expected.

---

## World Labs API — what was verified

The official docs at `docs.worldlabs.ai` were unreachable from the build
environment (blocked by network egress policy), so this was built against the API
as exercised by real client code, cross-checked between two independent
implementations. **Re-verify against the official docs when you can.**

| Thing | Value |
| --- | --- |
| Base URL | `https://api.worldlabs.ai/marble/v1` |
| Auth header | `WLT-Api-Key` |
| Generate | `POST /worlds:generate` → long-running operation |
| Poll | `GET /operations/{id}` |
| Upload | `POST /media-assets:prepare_upload` → `PUT` to signed URL |
| Multi-image | `world_prompt.type: "multi-image"` with per-image `azimuth` degrees |
| Splat assets | `assets.splats.spz_urls.{100k,500k,full_res}` |

**World expansion is not available via the API.** Marble's "expand" is an
interactive web-app feature; `marble-1.1-plus` expands automatically *within* a
single generation. There is no endpoint that extends an existing `world_id`.

So "add to my world" probes weekly for a `worlds:expand` endpoint (cached, costs
nothing, generates nothing) and uses it automatically if it ever appears.
Otherwise it seeds a new design from the parent's World Card and generates a new
world. **Her original is never touched.** It costs one generation, which is why
the skill confirms with her first.

---

## Rendering and assets

`@sparkjsdev/spark` 2.1.0 — World Labs' own Three.js splat renderer, reads `.spz`
natively. It and `three` 0.185.1 are **vendored** into `vendor/`, so games are
self-contained: no CDN, no build step, identical offline and on Pages.

If splat rendering ever misbehaves on a device, each world's collider-mesh GLB
URL is in `worlds/worlds.json` as `meshUrl` — the documented fallback.

`worlds/placeholder/world.ply` is **procedurally generated** (44,060 splats,
deterministic, `npm run world:placeholder`). It ships so all four games are
playable before she generates anything, and carries no third-party licence.

`assets/audio/` is **synthesised** by `npm run audio` — five looping music beds
and seven effects, ~2.9 MB, no licences. Every audio library host is blocked by
egress policy, and writing them means there is nothing to attribute.

---

## Layout

```
CLAUDE.md              Written for her. Claude's operating instructions.
SPEC.md                The system as built. Read this before changing anything.
about-me.md            Her profile. Claude reads it every session.
tomorrows-world.md     Auto-created. Designs saved when she's out of generations.
config/
  studio.json          Limits, model, approval flag, backup path.
  styles.json          The Style Menu recipes.
  avatar.json          Her character.
  privacy.local.json   GITIGNORED. Her real details, for the ship-time scan.
.claude/
  settings.json        SessionStart hook.
  skills/new-world/    The five-step World Design Studio. Gates all generation.
  commands/            /save-my-game and /ship.
mcp/
  server.js            stdio wiring only.
  lib/tools.js         The seven tools.
  lib/limit.js         The daily gate.
  lib/worldlabs.js     Marble client: generate, multi-image, upload, errors.
  lib/images.js        Concept images, behind a provider adapter.
  lib/worldcard.js     Styles, drafts, prompt assembly, World Cards.
  lib/git.js           Commits + pushes the ledger so the limit survives.
  test/                39 tests, mocked APIs, no keys needed.
templates/             The four starter games. Never edited in place.
games/                 Her copies.
shared/                engine.js, avatar.js, audio.js, style.css.
assets/audio/          Synthesised music and effects.
vendor/                three + spark + the addons spark needs.
worlds/                worlds.json, one folder per world, _drafts/ in progress.
docs/                  GitHub Pages root: arcade + shipped games.
logs/usage.md          Human-readable generation log — the one to skim.
logs/usage.json        Machine-readable ledger. Source of truth for the limit.
logs/errors.log        Technical failures. Gitignored.
```

---

## Commands

```bash
npm test               # 39 unit + integration tests (no network, no keys)
npm run test:games     # drives all four games in a real browser
npm run serve          # preview: http://localhost:8080/templates/explore/
npm run privacy        # scan docs/ for anything identifying
npm run ship -- --game explore --title "Star Hunt"
npm run save           # what "save my game" runs
npm run backup         # mirror worlds/ + verify checksums
npm run lfs:setup      # one-time Git LFS setup
npm run smoke          # verify the API keys end to end
npm run audio          # regenerate the sound library
npm run world:placeholder  # regenerate the practice world
```

`npm run test:games` needs a Chromium. It uses `/opt/pw-browsers/chromium` if
present, otherwise Playwright's own; override with `PLAYWRIGHT_CHROMIUM_PATH`.

---

## Cost

At `marble-1.1-plus` and one world a day: **1500–3000 credits/day** worst case,
bounded by the daily limit. Concept images add roughly five per world at a
fraction of a cent each, capped by `maxHeroRevisions`. `logs/usage.md` records an
estimate per generation.

---

## Safety properties worth knowing

- Nothing she can say makes the studio print an API key.
- Nothing deletes her work. `ship` rebuilds only the one game folder it targets;
  `save` only ever adds; the MCP server never removes a world.
- Nothing identifying reaches the public site — enforced by a check that blocks
  and rolls back the publish, not a warning in a log.
- Error messages she sees contain no status codes, URLs, file paths, or jargon —
  asserted by tests, not just convention.
- A corrupt or missing `config/studio.json` falls back to a limit of 1, not
  unlimited.
- Designing, styling, drawing and previewing are free. Only `make_world` spends
  the daily allowance.
