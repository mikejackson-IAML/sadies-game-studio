/**
 * The studio tools, kept separate from the stdio wiring so the whole flow can
 * be tested against a mocked World Labs API.
 *
 * The expensive call (Marble) is gated three ways: the daily limit, an explicit
 * yes from her via the skill, and — when images are configured — a concept
 * image she has already approved. Iteration happens at the image layer, which
 * costs pennies, never at the Marble layer, which is capped at one a day.
 */
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig, paths, redact } from "./config.js";
import { checkAllowance } from "./limit.js";
import {
  openGeneration, closeGeneration, cancelGeneration,
  readRegistry, registerWorld, uniqueWorldId,
} from "./ledger.js";
import { persistLedger } from "./git.js";
import {
  StudioError, startGeneration, startExpansion, waitForWorld,
  extractAssets, downloadTo, expansionSupported, worldIdOf,
  uploadImage, startMultiImageGeneration, AZIMUTH,
} from "./worldlabs.js";
import { imagesAvailable, makeConceptImage, heroPrompt, directionPrompt, characterPrompt } from "./images.js";
import {
  styleMenu, mixStyles, newDraft, readDraft, writeDraft, draftDir,
  assemblePrompt, saveWorldCard, storyReadback, promoteDraft, DIRECTIONS,
} from "./worldcard.js";

// --------------------------------------------------------------- admin logging

export function adminLog(message) {
  const line = `[${new Date().toISOString()}] ${redact(message)}\n`;
  process.stderr.write(line);
  try {
    mkdirSync(join(paths.root, "logs"), { recursive: true });
    appendFileSync(join(paths.root, "logs", "errors.log"), line);
  } catch {
    // Logging must never break a tool call.
  }
}

const kidText = (text) => ({ content: [{ type: "text", text }] });

/** Credit estimate for Dad's log. marble-1.1-plus varies with dynamic cubes. */
function estimateCredits(model, world) {
  if (model === "marble-1.1") return 1500;
  if (model === "marble-1.1-plus") {
    const cubes = Number(world?.generation_output?.num_dynamic_cubes ?? world?.num_dynamic_cubes ?? 0);
    return 1500 + 300 * (Number.isFinite(cubes) ? Math.max(0, Math.min(5, cubes)) : 0);
  }
  return null;
}

/** Saves a design she can't build today, so tomorrow starts with it ready. */
function saveForTomorrow({ name, prompt, resetsIn, draftId }) {
  const block = [
    `## ${name}`,
    "",
    `_Saved ${new Date().toISOString().slice(0, 10)} — ready to build ${resetsIn}._`,
    draftId ? `\nThe full World Card and pictures are waiting in \`worlds/_drafts/${draftId}/\`.` : "",
    "",
    "```",
    prompt,
    "```",
    "",
  ].join("\n");

  const header = [
    "# Tomorrow's world",
    "",
    "Designs that were all finished and ready, but the day's world was already made.",
    "Next time you can build one, pick one of these — it's ready to go!",
    "",
  ].join("\n");

  try {
    if (!existsSync(paths.tomorrow)) writeFileSync(paths.tomorrow, header);
    appendFileSync(paths.tomorrow, `${block}\n`);
    return true;
  } catch (err) {
    adminLog(`failed to write tomorrows-world.md: ${err.message}`);
    return false;
  }
}

// ----------------------------------------------------------------- list_styles

export function listStyles() {
  const menu = styleMenu();
  const builtIn = menu.filter((s) => s.kind === "built-in");
  const hers = menu.filter((s) => s.kind === "hers");

  const lines = [
    "THE STYLE MENU — show her these and let her pick. She can also:",
    "  - mix any TWO of them (\"candy + underwater\")",
    "  - skip the menu entirely and just describe her own look",
    "  - pick one of her own worlds so the new one matches it",
    "",
    ...builtIn.map((s) => `${s.emoji}  ${s.name} — ${s.blurb}   [id: ${s.id}]`),
  ];
  if (hers.length) {
    lines.push("", "HER OWN WORLDS (she can build a new world in the same style as any of these):");
    lines.push(...hers.map((s) => `${s.emoji}  ${s.name}   [id: ${s.id}]`));
  }
  lines.push("", "Read them out warmly, a few at a time. Don't dump the whole list at once.");
  return kidText(lines.join("\n"));
}

// ---------------------------------------------------------------- design_world

export async function designWorld(args) {
  const config = loadConfig();
  const {
    name, gameType, answers = {}, styleIds = [], directions = {}, addToWorldId,
  } = args;

  let parent = null;
  if (addToWorldId) {
    parent = readRegistry().worlds.find((w) => w.id === addToWorldId || w.name === addToWorldId);
    if (!parent) {
      const names = readRegistry().worlds.map((w) => `"${w.name}"`).join(", ") || "(none yet)";
      return kidText(
        `I couldn't find a world called "${addToWorldId}". Nothing was used up.\n` +
          `Her worlds are: ${names}. Ask her which one she means, in a friendly way.`,
      );
    }
    // An expansion starts from the parent's World Card, so the new world is
    // recognisably the same place.
    if (parent.card) {
      for (const [key, value] of Object.entries(parent.card.answers || {})) {
        if (!answers[key]) answers[key] = value;
      }
      if (!styleIds.length && parent.card.styleIds?.length) styleIds.push(...parent.card.styleIds);
    }
  }

  const draft = newDraft({
    name: name || answers.place,
    answers,
    styleIds,
    gameType,
    directions,
    parentWorldId: parent?.id ?? null,
  });

  let imageNote;
  if (!imagesAvailable(config)) {
    imageNote =
      "NO CONCEPT IMAGE was drawn — the drawing key isn't set up. That's fine: tell her " +
      "you'll picture it in your head together, and carry straight on to the compass questions. " +
      "Do NOT show her an error.";
  } else {
    try {
      const style = mixStyles(styleIds);
      await makeConceptImage({
        prompt: heroPrompt({ answers, style }),
        outPath: join(draftDir(draft.draftId), "hero.jpg"),
        config,
      });
      draft.images.hero = "hero.jpg";
      imageNote =
        `HERO CONCEPT IMAGE saved to worlds/_drafts/${draft.draftId}/hero.jpg — show it to her ` +
        `and ask if it looks like her world. If she wants it changed, call revise_hero ` +
        `(she gets ${config.maxHeroRevisions} redraws).`;
    } catch (err) {
      const e = err instanceof StudioError ? err : new StudioError("The drawing didn't work.", String(err), "image");
      adminLog(`hero image failed [${e.code}]: ${e.adminDetail}`);
      imageNote = `NO IMAGE — say this to her kindly: "${e.kidMessage}" Then carry on designing; nothing is lost.`;
    }
  }

  writeDraft(draft);
  saveWorldCard(draft);

  return kidText(
    [
      `DESIGN STARTED. Draft id: ${draft.draftId}`,
      `World Card saved to worlds/_drafts/${draft.draftId}/world-card.md`,
      parent ? `This is a bigger version of "${parent.name}" — her original stays exactly as it is.` : "",
      "",
      imageNote,
      "",
      "NEXT: if you haven't done the compass questions yet, do them now (what's in front of you,",
      "behind you, on your left, on your right). Then call preview_world with this draft id.",
      "NO MARBLE GENERATION HAS HAPPENED and nothing has been used up.",
    ].filter(Boolean).join("\n"),
  );
}

// ----------------------------------------------------------------- revise_hero

export async function reviseHero({ draftId, change }) {
  const config = loadConfig();
  const draft = readDraft(draftId);
  if (!draft) return kidText(`I couldn't find a design called "${draftId}". Ask her to start again — nothing was used up.`);

  if (draft.heroRevisions >= config.maxHeroRevisions) {
    return kidText(
      `She's used all ${config.maxHeroRevisions} redraws for this picture. Say something like: ` +
        `"Let's go with this one — and remember, the real world always looks even better than the drawing!" ` +
        `Then move on to the compass questions and preview_world.`,
    );
  }
  if (!imagesAvailable(config)) {
    return kidText("No drawing key is set up, so there's no picture to redraw. Carry on to preview_world.");
  }

  try {
    const style = mixStyles(draft.styleIds);
    await makeConceptImage({
      prompt: `${heroPrompt({ answers: draft.answers, style })} Change this: ${change}.`,
      referenceFiles: draft.images.hero ? [join(draftDir(draftId), "hero.jpg")] : [],
      outPath: join(draftDir(draftId), "hero.jpg"),
      config,
    });
    draft.images.hero = "hero.jpg";
    draft.heroRevisions += 1;
    writeDraft(draft);
    saveWorldCard(draft);
    const left = config.maxHeroRevisions - draft.heroRevisions;
    return kidText(
      `REDRAWN — worlds/_drafts/${draftId}/hero.jpg. Show her.\n` +
        `She has ${left} redraw${left === 1 ? "" : "s"} left. Nothing has been used up.`,
    );
  } catch (err) {
    const e = err instanceof StudioError ? err : new StudioError("The drawing didn't work.", String(err), "image");
    adminLog(`hero revision failed [${e.code}]: ${e.adminDetail}`);
    return kidText(`Say to her: "${e.kidMessage}" Nothing was used up.`);
  }
}

// --------------------------------------------------------------- preview_world

export async function previewWorld({ draftId, directions }) {
  const config = loadConfig();
  const draft = readDraft(draftId);
  if (!draft) return kidText(`I couldn't find a design called "${draftId}". Nothing was used up.`);

  if (directions) draft.directions = { ...draft.directions, ...directions };
  // Save straight away: she answers the compass one direction at a time, and
  // an unsaved partial answer would be lost on the next call.
  writeDraft(draft);

  const missing = DIRECTIONS.filter((d) => !draft.directions[d]);
  if (missing.length) {
    return kidText(
      `Still need the compass answers for: ${missing.join(", ")}.\n` +
        `Ask her, one at a time: "Pretend you're standing in the middle of your world — ` +
        `what's ${missing[0] === "front" ? "in front of you" : missing[0] === "back" ? "behind you" : `on your ${missing[0]}`}?" ` +
        `Then call preview_world again with the answers. Nothing has been used up.`,
    );
  }

  const made = [];
  if (imagesAvailable(config)) {
    const heroFile = join(draftDir(draftId), "hero.jpg");
    const reference = draft.images.hero && existsSync(heroFile) ? [heroFile] : [];
    for (const direction of DIRECTIONS) {
      try {
        await makeConceptImage({
          prompt: directionPrompt({
            direction, what: draft.directions[direction], answers: draft.answers,
          }),
          referenceFiles: reference,
          outPath: join(draftDir(draftId), `${direction}.jpg`),
          config,
        });
        draft.images[direction] = `${direction}.jpg`;
        made.push(direction);
      } catch (err) {
        const e = err instanceof StudioError ? err : new StudioError("Drawing failed.", String(err), "image");
        adminLog(`direction image ${direction} failed [${e.code}]: ${e.adminDetail}`);
      }
    }
  }

  draft.status = "ready";
  draft.prompt = assemblePrompt(draft);
  writeDraft(draft);
  saveWorldCard(draft);

  return kidText(
    [
      `WORLD CARD FINISHED — worlds/_drafts/${draftId}/world-card.md`,
      made.length
        ? `Pictures drawn for: ${made.join(", ")}. Show her all four — this is what her world will look like from the middle, turning around.`
        : "No pictures this time (no drawing key set up), which is fine — the World Card is complete.",
      "",
      "NOW READ HER CARD BACK TO HER AS A SHORT STORY, in your own warm words, using this:",
      "",
      `  "${storyReadback(draft)}"`,
      "",
      "Then ask ONE playful question: is this her world? If she says yes, call make_world with",
      `draft_id "${draftId}". If she wants changes, adjust and call preview_world again.`,
      "STILL NOTHING HAS BEEN USED UP — the daily world is only spent by make_world.",
    ].join("\n"),
  );
}

// ------------------------------------------------------------------ make_world

export async function makeWorld(args) {
  const config = loadConfig();
  const allowance = checkAllowance(config);

  // Two ways in: a finished World Card (the normal path), or a plain
  // description (the simple fallback when there is no design session).
  const draft = args.draftId ? readDraft(args.draftId) : null;
  if (args.draftId && !draft) {
    return kidText(`I couldn't find a design called "${args.draftId}". NO GENERATION HAPPENED and nothing was used up.`);
  }

  const registry = readRegistry();
  let parent = null;
  let kind = "new";

  const parentRef = draft?.parentWorldId || args.add_to_world;
  if (parentRef) {
    parent = registry.worlds.find((w) => w.id === parentRef || w.name === parentRef);
    if (!parent) {
      const names = registry.worlds.map((w) => `"${w.name}"`).join(", ") || "(none yet)";
      return kidText(
        `I couldn't find a world called "${parentRef}". NO GENERATION HAPPENED and nothing was used up.\n` +
          `Her worlds are: ${names}. Ask her which one she means, in a friendly way.`,
      );
    }
    kind = "add-to";
  }

  const displayName = (args.name || draft?.name || args.description || "My world").slice(0, 80);
  let prompt = draft ? draft.prompt || assemblePrompt(draft) : args.description;

  if (!allowance.allowed) {
    const saved = saveForTomorrow({
      name: displayName, prompt, resetsIn: allowance.resetsIn, draftId: draft?.draftId,
    });
    return kidText(
      [
        `NO GENERATION HAPPENED — the daily limit is reached (${allowance.usedToday}/${allowance.limit} used on ${allowance.day}).`,
        "",
        "Tell her, warmly and in your own words:",
        "- She already made her one amazing world today, so the world machine is resting.",
        `- She can make another one ${allowance.resetsIn}.`,
        saved
          ? draft
            ? "- Her whole design — the World Card AND the pictures — is SAFELY SAVED and waiting. Nothing is lost."
            : "- Her idea is SAFELY SAVED in tomorrows-world.md, ready the moment she can build again."
          : "- Her idea is safe in this conversation.",
        "",
        "Then offer something she CAN do right now: play one of her games, remix a template,",
        "decorate her sandbox, or ship a game to the arcade. Do not sound like a rejection.",
      ].join("\n"),
    );
  }

  const recordId = openGeneration({
    day: allowance.day,
    description: args.description || draft?.answers?.place || displayName,
    prompt,
    model: config.marbleModel,
    kind,
    parentWorldId: parent?.id ?? null,
  });

  let operationStarted = false;
  try {
    let opId;
    const directionalFiles = draft
      ? DIRECTIONS.filter((d) => draft.images[d]).map((d) => ({
          direction: d, file: join(draftDir(draft.draftId), draft.images[d]),
        }))
      : [];

    if (kind === "add-to" && !draft) {
      // Simple path expansion: probe for a real endpoint, otherwise remix the
      // parent's prompt with her addition. Her original is never touched.
      const canExpand = await expansionSupported();
      if (canExpand) {
        opId = await startExpansion({
          sourceWorldId: parent.worldId, prompt, displayName, model: config.marbleModel,
        });
      } else {
        prompt = [
          parent.prompt || parent.description,
          "",
          `Additionally, this place now also includes: ${args.description}.`,
          "Keep the original setting, mood, colours and lighting recognisably the same, and make the world larger to fit the new area.",
        ].join("\n");
        opId = await startGeneration({ prompt, displayName, model: config.marbleModel, onNote: adminLog });
      }
      operationStarted = true;
    } else if (directionalFiles.length === DIRECTIONS.length) {
      // The real Design Studio path: her four compass views, each placed at the
      // bearing she described it at.
      const images = [];
      for (const { direction, file } of directionalFiles) {
        images.push({ azimuth: AZIMUTH[direction], assetId: await uploadImage(file) });
      }
      opId = await startMultiImageGeneration({
        images, prompt, displayName, model: config.marbleModel, onNote: adminLog,
      });
      operationStarted = true;
    } else {
      opId = await startGeneration({ prompt, displayName, model: config.marbleModel, onNote: adminLog });
      operationStarted = true;
    }

    const world = await waitForWorld(opId, {
      onProgress: (status, detail) => adminLog(`op ${opId}: ${status} ${detail}`),
    });

    const assets = extractAssets(world, config.splatQuality);
    if (!assets.splat) {
      throw new StudioError(
        "Your world got built, but it came back without the part I need to make it walkable. Let's try that idea again!",
        `no splat URL in world response: ${JSON.stringify(world?.assets ?? {}).slice(0, 400)}`,
        "no_splat",
      );
    }

    const id = uniqueWorldId(displayName);
    const dir = join(paths.worldsDir, id);
    mkdirSync(dir, { recursive: true });

    const splatBytes = await downloadTo(assets.splat, join(dir, "world.spz"));
    let thumbFile = null;
    if (assets.thumbnail) {
      try {
        await downloadTo(assets.thumbnail, join(dir, "thumb.jpg"));
        thumbFile = "thumb.jpg";
      } catch (err) {
        adminLog(`thumbnail download failed (non-fatal): ${err.message}`);
      }
    }

    // The World Card and its pictures move in next to the world they produced.
    if (draft) promoteDraft(draft.draftId, id);

    const style = draft ? mixStyles(draft.styleIds) : null;

    // Her character, restyled for this world. One image, never fatal: a world
    // she can play beats a picture she can look at.
    let characterArt = null;
    if (config.characterReferenceId && imagesAvailable(config)) {
      try {
        let avatar = {};
        try {
          avatar = JSON.parse(readFileSync(join(paths.root, "config", "avatar.json"), "utf8"));
        } catch {
          avatar = {};
        }
        await makeConceptImage({
          prompt: characterPrompt({ style, outfit: null, avatar }),
          outPath: join(dir, "character.jpg"),
          config,
        });
        characterArt = "character.jpg";
      } catch (err) {
        const e = err instanceof StudioError ? err : new StudioError("art failed", String(err), "character_art");
        adminLog(`character art failed (non-fatal) [${e.code}]: ${e.adminDetail}`);
      }
    }
    const record = {
      id,
      name: displayName,
      description: args.description || draft?.answers?.place || displayName,
      prompt,
      kind,
      parentId: parent?.id ?? null,
      worldId: worldIdOf(world),
      model: config.marbleModel,
      createdAtUtc: new Date().toISOString(),
      day: allowance.day,
      files: {
        splat: "world.spz",
        thumbnail: thumbFile,
        hero: draft?.images?.hero ? "hero.jpg" : null,
        worldCard: draft ? "world-card.md" : null,
        characterArt,
      },
      styleIds: draft?.styleIds ?? [],
      mood: style?.mood || "bright",
      gameType: draft?.gameType || null,
      card: draft ? { answers: draft.answers, directions: draft.directions, styleIds: draft.styleIds } : null,
      splatQuality: assets.splatQuality,
      splatBytes,
      meshUrl: assets.mesh,
      panoramaUrl: assets.panorama,
      caption: assets.caption,
      builtFrom: directionalFiles.length === DIRECTIONS.length ? "four-directional-images" : "text",
    };
    registerWorld(record);

    closeGeneration(recordId, {
      status: "succeeded",
      worldId: record.worldId,
      creditsEstimate: estimateCredits(config.marbleModel, world),
      prompt,
    });

    const git = await persistLedger(`Studio: new world "${displayName}"`, [
      "logs/usage.json", "logs/usage.md", "worlds/worlds.json", `worlds/${id}`,
    ]);
    if (!git.pushed) adminLog(`ledger not pushed (limit is local-only until it is): ${git.note}`);

    const after = checkAllowance(config);
    return kidText(
      [
        `SUCCESS — the world "${displayName}" is built and saved.`,
        `World folder: worlds/${id}/  (world.spz${record.files.worldCard ? ", world-card.md" : ""}${record.files.hero ? ", hero.jpg" : ""})`,
        record.builtFrom === "four-directional-images"
          ? "Built from her four compass pictures, so it should look like what she drew."
          : "",
        kind === "add-to" && parent
          ? `This was an "add to ${parent.name}" world. Her original stays exactly as it is.`
          : "",
        `Worlds left today: ${after.remaining}. Resets ${after.resetsIn}.`,
        "",
        "Now: celebrate with her! Tell her the world is ready, mention one lovely detail from her",
        "World Card that you expect to see in it, and ask which game she wants to put it in —",
        "explore, maze, platformer, or sandbox.",
      ].filter(Boolean).join("\n"),
    );
  } catch (err) {
    const studioErr = err instanceof StudioError
      ? err
      : new StudioError(
          "Something surprising happened while building your world. Nothing you made is lost — let's try again!",
          err?.stack || String(err),
          "unexpected",
        );

    adminLog(`make_world failed [${studioErr.code}]: ${studioErr.adminDetail}`);

    if (!operationStarted) {
      cancelGeneration(recordId); // Never charge her a day for a problem that never reached the API.
    } else {
      closeGeneration(recordId, { status: "failed", note: studioErr.code, prompt });
      await persistLedger(`Studio: world attempt failed (${studioErr.code})`, ["logs/usage.json", "logs/usage.md"]);
    }

    return kidText(
      [
        "WORLD NOT MADE. Say this to her kindly, in your own words:",
        `"${studioErr.kidMessage}"`,
        "",
        !operationStarted
          ? "GOOD NEWS: her daily world was NOT used up — she can try again as soon as it's fixed."
          : "Her daily world was used up on this attempt. Be extra kind about it and suggest playing an existing game.",
        draft ? "Her World Card and pictures are all still saved — nothing about her design is lost." : "",
        "Never show her error codes, web addresses, or anything technical.",
      ].filter(Boolean).join("\n"),
    );
  }
}

// -------------------------------------------------------------- other tools

export function listMyWorlds() {
  const { worlds } = readRegistry();
  if (worlds.length === 0) {
    return kidText(
      "She hasn't made any worlds yet — this is her very first one waiting to happen!\n" +
        "There IS a practice world built in (called 'placeholder') that every game can already use,\n" +
        "so she can play right now while she decides what world to dream up.",
    );
  }
  const lines = worlds.map((w) => {
    const when = new Date(w.createdAtUtc).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
    const from = w.kind === "add-to" && w.parentId ? ` (a bigger version of "${w.parentId}")` : "";
    const card = w.files?.worldCard ? " — has a World Card" : "";
    return `- "${w.name}"${from} — made ${when} — folder: worlds/${w.id}/${card}`;
  });
  return kidText(`She has ${worlds.length} world${worlds.length === 1 ? "" : "s"}:\n${lines.join("\n")}`);
}

export function worldsLeftToday() {
  const config = loadConfig();
  const a = checkAllowance(config);
  return kidText(
    a.remaining > 0
      ? `She has ${a.remaining} world${a.remaining === 1 ? "" : "s"} left to make today. Tell her happily!`
      : `She has used her world for today (${a.usedToday}/${a.limit}). She can make another ${a.resetsIn}. ` +
        `Say it kindly and suggest something fun she can do right now instead. ` +
        `Designing a world is still free — she can do the whole Design Studio and save it for tomorrow.`,
  );
}


