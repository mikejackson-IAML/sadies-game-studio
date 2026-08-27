# SPEC — Her Game Studio, as built

Reference for anyone (human or Claude) changing this system later. Describes
what exists, not what was hoped for. Written for an adult.

Companion docs: `README.md` (setup and operations), `CLAUDE.md` (her-facing
operating instructions), `.claude/skills/new-world/SKILL.md` (the design flow).

---

## 1. Shape of the system

```
Claude Code web  ──stdio──▶  mcp/server.js  ──HTTPS──▶  Marble  (worlds)
       │                          │          ──HTTPS──▶  Gemini  (concept images)
       │                          ▼
       │                    repo state: worlds/, logs/, config/
       ▼
  npm scripts (ship / save / backup)  ──▶  docs/  ──▶  GitHub Pages
```

Everything is files in the repo. No database. The repo is the state.

She only ever talks to Claude. Claude calls MCP tools and npm scripts. She never
runs a command, and no flow requires her to.

---

## 2. MCP tools

Server: `mcp/server.js` (stdio wiring only). Behaviour: `mcp/lib/tools.js`.
Registered via `.mcp.json`; `WORLDLABS_API_KEY` and `GEMINI_API_KEY` pass through
from the environment.

| Tool | Cost | Contract |
| --- | --- | --- |
| `list_styles` | free | Returns the Style Menu: built-in styles from `config/styles.json` plus every world she has made (`world:<id>`). |
| `design_world` | ~1 image | Args: `answers` (required), `name`, `gameType`, `styleIds[]`, `directions`, `addToWorldId`. Creates `worlds/_drafts/<draftId>/`, writes `draft.json` + `world-card.md`, draws `hero.jpg`. Returns the draft id. |
| `revise_hero` | ~1 image | Args: `draftId`, `change`. Redraws the hero conditioned on the previous hero. Hard-capped at `maxHeroRevisions`. |
| `preview_world` | ~4 images | Args: `draftId`, `directions`. Merges and **persists** partial compass answers; refuses until all four exist. Draws `front/right/back/left.jpg` conditioned on the hero. Finalises the World Card. |
| `make_world` | **1 daily world + credits** | Args: `draft_id` (preferred) or `description` (fallback), `name`, `add_to_world`. The only tool that spends the daily allowance. |
| `list_my_worlds` | free | Her worlds with names, dates, and whether each has a World Card. |
| `worlds_left_today` | free | Remaining allowance and when it resets. |

Every tool returns kid-safe prose plus explicit instructions to Claude. No tool
returns a status code, URL, file path outside the repo, or anything key-shaped.

---

## 3. The daily limit

The gate is `mcp/lib/limit.js#checkAllowance`, called by `makeWorld` before any
network call. It is the enforcement point; `CLAUDE.md` and the skill only
describe the rule.

- **Ledger**: `logs/usage.json`. Records with status `succeeded` **or** `pending`
  count against the day. A crashed run already spent credits, so it still burns
  the day.
- **Refund**: a failure that never reached the API (missing key, DNS failure,
  unknown parent world) deletes its record — `cancelGeneration`. She is never
  charged a day for an outage.
- **Day boundary**: `mcp/lib/clock.js#studioDay` formats the instant in
  `config.timezone` (IANA, default `America/Chicago`) via `Intl`. DST-correct.
  The countdown she sees is deliberately fuzzy ("in about 3 hours").
- **Durability**: `mcp/lib/git.js#persistLedger` commits and pushes the ledger
  immediately after each generation. This is load-bearing — Claude Code web runs
  in ephemeral containers that re-clone the repo, so a local-only ledger would
  reset every session. `persistLedger` never throws.
- **Fail-closed**: a missing or corrupt `config/studio.json` yields a limit of 1,
  not unlimited. `dailyWorldLimit` is clamped to 0–20.

**Known gap:** if the push fails (offline, bad credentials) the limit holds for
that session but is not durable until something pushes. Logged to
`logs/errors.log`.

---

## 4. World Design Studio

Five steps, driven by the `new-world` skill, one question at a time.

1. **Dream it** — first question is always *what will you DO here*, because
   `gameType` selects a spatial recipe (`GAME_SHAPE` in `mcp/lib/worldcard.js`):
   explore → paths and hiding spots; maze → corridors; platformer → verticality;
   sandbox → a flat open middle. Then place, inhabitants, time, weather, secret,
   sounds.
2. **Pick a style** — `config/styles.json` holds 10 recipes (palette, lighting,
   materials, descriptors, mood). `mixStyles()` blends up to two. Her own worlds
   appear as `world:<id>` and resolve to a recipe from their stored World Card.
3. **See it** — one hero image locks the style.
4. **Look around** — the compass game; four answers map to Marble azimuths.
5. **The World Card** — `world-card.md` plus `storyReadback()` for her final yes.

**Every step but `make_world` is free.** All iteration happens at the image
layer by design.

**Escape hatch:** "surprise me" on any question is handled by the skill filling
the answer from `about-me.md`.

**Drafts** live in `worlds/_drafts/<draftId>/` and survive indefinitely. On a
successful build `promoteDraft()` moves the card and all five images into
`worlds/<worldId>/` and deletes the draft.

---

## 5. Marble integration

Verified against real client code (the official docs host is blocked by egress
policy — re-verify when reachable).

- Base `https://api.worldlabs.ai/marble/v1`, header `WLT-Api-Key`.
- `POST /worlds:generate` → operation; `GET /operations/{id}` → `{done, metadata.progress, response, error}`.
- Assets: `assets.splats.spz_urls.{100k,500k,full_res}`, `assets.mesh.collider_mesh_url`, `assets.imagery.pano_url`, `assets.thumbnail_url`.
- Models: `marble-1.1` = 1500 credits; `marble-1.1-plus` = 1500 + 300/dynamic cube (max 5).

**Multi-image (the Design Studio path).** Images are uploaded in two steps —
`POST /media-assets:prepare_upload` then a `PUT` to the returned signed URL with
its `required_headers` — and referenced by `media_asset_id`:

```json
{ "world_prompt": {
    "type": "multi-image",
    "multi_image_prompt": [{ "azimuth": 0, "content": { "source": "media_asset", "media_asset_id": "..." } }],
    "text_prompt": "...",
    "reconstruct_images": true } }
```

Azimuth is degrees clockwise from straight ahead: `front 0, right 90, back 180,
left 270` (`AZIMUTH` in `mcp/lib/worldlabs.js`).

**Expansion.** There is no public endpoint that extends an existing `world_id`.
Marble's "expand" is an interactive web-app feature, and `marble-1.1-plus`
expands automatically within one generation. So:

1. `expansionSupported()` probes `POST /worlds:expand` with an empty body once a
   week (cached in `logs/api-capabilities.json`). 400/422 → the endpoint exists;
   404 → it does not. No world is generated and no credits move either way.
2. If it ever appears, it is used automatically with no code change.
3. Otherwise expansion is a **remix**: the parent's World Card seeds a new
   design, and a new world is generated. The parent is never modified or deleted.

---

## 6. Concept images

`mcp/lib/images.js`, behind a provider adapter (`PROVIDERS`). Only `gemini` is
implemented — it was the sole image API reachable from the build environment.

- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Key in the `x-goog-api-key` **header**, never the URL.
- `generationConfig.responseModalities: ["TEXT","IMAGE"]`; the image comes back
  as `candidates[0].content.parts[].inline_data.data` (base64).
- Directional views pass the hero back as `inline_data`, which is what keeps all
  five images in one style.
- Default model `gemini-3.1-flash-image` (`config.imageModel`).

Images are **optional**. With no key, `design_world` and `preview_world` still
produce a complete World Card and say so in Claude-facing text; `make_world`
falls back to the text prompt. Nothing errors at her.

To add a provider: implement one function with the `generateGemini` signature,
register it in `PROVIDERS`, set `config.imageProvider`.

---

## 7. Templates and the engine

`shared/engine.js` — `Studio.create({title, howTo, mode, worldBounds, startPosition})`.

- **Rendering**: three 0.185.1 + `@sparkjsdev/spark` 2.1.0, both vendored into
  `vendor/` (plus the `three/addons` Spark reaches, via `scripts/vendor-addons.mjs`).
  No CDN; identical offline and on Pages.
- **World**: `SplatMesh({url})`, `quaternion.set(1,0,0,0)` to flip Y-down splat
  data upright. Collider-mesh GLB URL is kept in the registry as the fallback path.
- **Camera**: third person, behind and above, orbiting on `yaw`/`pitch`, with a
  pull-in probe so walls never hide her character.
- **Character**: `shared/avatar.js` builds her from primitives per
  `config/avatar.json` (colours, hat, companion). Origin at the feet, faces −Z.
  Limbs swing with speed; the companion trails and bobs.
- **Collision**: splats carry none, so gameplay collides with `Box3`s registered
  via `addSolid()`. Axis-by-axis resolution; falling below −18 respawns.
- **Controls**: one code path for both input types — keyboard WASD/arrows +
  space, on-screen thumb-stick + JUMP, drag anywhere to orbit. `M` mutes.
- **Audio**: `shared/audio.js`. Music bed chosen by the world's `mood`; footsteps
  become splashes in `watery` worlds. Mute persists in `localStorage`. Audio
  unlocks on first input, per browser autoplay policy.
- **Test hooks**: `window.__studioPos()` and `window.__studioDebug()`.

`game-config.json` next to each game's `index.html` carries
`{worldId, worldFile, worldName, mood, studioName}`. Templates and shipped games
sit at the same relative depth (`../../shared`, `../../vendor`, `../../worlds`,
`../../assets`, `../../config/avatar.json`), so nothing is rewritten at ship time.

The four templates are `explore`, `maze` (seeded recursive-backtracker),
`platformer` (spiral of platforms, some drifting), `sandbox` (palette + PLACE +
UNDO, layout in `localStorage`).

---

## 8. Sound assets

`scripts/make-audio.mjs` synthesises everything into `assets/audio/`: five
looping music beds (`bright`, `mysterious`, `watery`, `spooky`, `spacey`) and
seven effects. 16 kHz mono 16-bit WAV, ~2.9 MB total, deterministic.

Written from scratch because every audio library host is blocked by egress
policy — and because it means there is no licence attached to anything. Loops
are seam-safe: note tails wrap around the loop point rather than being cut.

Styles map to moods in `config/styles.json`; `ship` writes the world's mood into
`game-config.json`.

---

## 9. Ship and the arcade

`npm run ship -- --game <folder> --title "<title>" [--world <id>] [--cover <path>] [--approve]`

1. Copies a template into `games/` on first ship so templates stay pristine.
2. Rebuilds only `docs/games/<slug>/`; other shipped games are untouched.
3. Copies `shared/`, `vendor/`, `assets/`, the world file, and **only**
   `config/avatar.json` (never the whole config directory) into `docs/`.
4. Cover art: `--cover` → the world's `hero.jpg` → its `thumb.jpg`. Always
   rewritten through `stripJpegMetadata()`.
5. Updates `docs/arcade.json`, regenerates `docs/index.html`.
6. **Runs the privacy check. On any violation the build is rolled back entirely
   and nothing is published.**
7. Commits and pushes, unless `requireShipApproval` is true and `--approve` is
   absent, in which case it stages and prints the approve command.

Pages serves `main` → `/docs`. `.nojekyll` is present.

---

## 10. Privacy enforcement

`scripts/privacy-check.mjs`, run automatically inside `ship` and available as
`npm run privacy`.

- **Text**: every deployed text file is scanned for whole-word, case-insensitive
  matches against `config/privacy.local.json` (gitignored; template at
  `config/privacy.example.json`). `vendor/` is excluded. Placeholder entries
  beginning `Put` are ignored, so the example file is inert.
- **Images**: every deployed JPEG is checked for EXIF/XMP/IPTC/comment segments
  (`scripts/lib/jpeg.mjs`). Ship strips them on the way in; the check catches
  anything that slipped past.
- Failure **blocks and rolls back the publish**. It is not a warning.

The rule itself — first name only, ever — is stated as the first section of
`CLAUDE.md`.

---

## 11. Backups

World binaries are large and each costs a day of her allowance.

- **Git LFS**: `.gitattributes` tracks `worlds/**/*.{spz,ply,glb}` and
  `docs/worlds/**`. `npm run lfs:setup` installs hooks and reports anything
  committed before LFS was enabled, with the `git lfs migrate` command to fix it.
  Without git-lfs installed the patterns are inert and git does not error.
- **Second copy**: `npm run backup` mirrors `worlds/` (drafts included) to
  `config.backupPath` / `STUDIO_BACKUP_PATH` / `--to`, and maintains
  `worlds/backup-manifest.json` with a SHA-256 per file. `--verify` checks
  without copying and exits non-zero on mismatch; a normal run repairs
  mismatches. The manifest is written even with no destination configured.

GitHub's free LFS tier is 1 GB — at roughly one world a day, plan for a data pack.

---

## 12. Tests

`npm test` — 39 tests, no network, no keys:

- `clock.test.js` — timezone day boundaries, DST, countdown.
- `config.test.js` — defaults, clamping, key redaction.
- `limit.test.js` — allowance across statuses, days, limits, corrupt ledger.
- `generation.test.js` — full simple-path flow against a mocked Marble:
  success, second-world refusal, tomorrow's-world, no-leak assertions,
  pre-flight refund, remix preserving the original.
- `design.test.js` — full Design Studio against mocked Gemini + Marble: style
  menu, hero image, revision cap, partial compass persistence, four directional
  images conditioned on the hero, **azimuths `[0,90,180,270]`**, draft promotion,
  her world joining the Style Menu, design-while-out-of-allowance.

`npm run test:games` — Playwright drives all four templates against the
placeholder world and asserts: the splat loads, overlays are genuinely hidden
(computed style, not just the attribute), the frame contains real geometry
(decoded from a screenshot — the WebGL buffer is cleared after each frame), the
avatar is in the scene, audio loaded, the player moves, and the console is clean.

Uses `/opt/pw-browsers/chromium` if present, else Playwright's own; override
with `PLAYWRIGHT_CHROMIUM_PATH`. Software GL renders at a few FPS, so the
movement assertion polls rather than timing a fixed window.

---

## 13. Files that are load-bearing

| Path | Why it matters |
| --- | --- |
| `mcp/lib/limit.js` | The daily gate. Nothing may generate without it. |
| `mcp/lib/git.js` | Makes the limit survive a fresh container. |
| `scripts/privacy-check.mjs` | Blocks publishing anything identifying. |
| `config/studio.json` | Limit, timezone, model, approval flag, backup path. |
| `config/privacy.local.json` | Gitignored. Her real details, never committed. |
| `logs/usage.json` | Source of truth for the limit. |
| `worlds/worlds.json` | Registry: cards, styles, moods, asset URLs. |
| `.gitattributes` | LFS tracking for world binaries. |
| `shared/style.css` | Contains `[hidden] { display: none !important }` — without it `.overlay { display: flex }` keeps the win screen painted over every game. |

---

## 14. Deliberate constraints

- Only `make_world` costs the daily allowance. Keep it that way; if a new tool
  would spend a generation, it goes through `checkAllowance` first.
- Nothing she can see contains technical detail. Asserted by tests.
- Templates are never edited in place; `ship` copies them into `games/`.
- Nothing is ever deleted: not games, not worlds, not shipped arcade entries.
- Both API keys come from the environment only and are scrubbed from every log
  path by `redact()` / `scrub()`.
