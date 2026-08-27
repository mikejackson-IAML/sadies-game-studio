/**
 * The three studio tools, kept separate from the stdio wiring so the whole
 * generation flow can be tested against a mocked World Labs API.
 */
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
} from "./worldlabs.js";

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

/** Saves a prompt she can't spend today, so tomorrow starts with it ready. */
function saveForTomorrow(description, prompt, resetsIn) {
  const block = [
    `## ${description}`,
    "",
    `_Saved ${new Date().toISOString().slice(0, 10)} — ready to build ${resetsIn}._`,
    "",
    "```",
    prompt,
    "```",
    "",
  ].join("\n");

  const header = [
    "# Tomorrow's world",
    "",
    "Ideas that were all finished and ready, but the day's world was already made.",
    "Next time you can build one, pick one of these and it's ready to go!",
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

// ------------------------------------------------------------------ make_world

export async function makeWorld({ description, name, add_to_world }) {
  const config = loadConfig();
  const allowance = checkAllowance(config);
  const displayName = (name || description || "My world").slice(0, 80);

  if (!allowance.allowed) {
    const saved = saveForTomorrow(displayName, description, allowance.resetsIn);
    return kidText(
      [
        `NO GENERATION HAPPENED — the daily limit is reached (${allowance.usedToday}/${allowance.limit} used on ${allowance.day}).`,
        "",
        "Tell her, warmly and in your own words:",
        `- She already made her one amazing world today, so the world machine is resting.`,
        `- She can make another one ${allowance.resetsIn}.`,
        saved
          ? `- Her idea is SAFELY SAVED in tomorrows-world.md, so nothing is lost and it's ready the moment she can build again.`
          : `- Her idea is safe in this conversation.`,
        "",
        "Then offer something she CAN do right now: play one of her games, remix a template,",
        "decorate her sandbox, or ship a game to the arcade. Do not sound like a rejection.",
      ].join("\n"),
    );
  }

  // Resolve the "add to an existing world" path.
  const registry = readRegistry();
  let parent = null;
  let kind = "new";
  let prompt = description;

  if (add_to_world) {
    parent = registry.worlds.find((w) => w.id === add_to_world || w.name === add_to_world);
    if (!parent) {
      const names = registry.worlds.map((w) => `"${w.name}"`).join(", ") || "(none yet)";
      return kidText(
        `I couldn't find a world called "${add_to_world}". NO GENERATION HAPPENED and nothing was used up.\n` +
          `Her worlds are: ${names}. Ask her which one she means, in a friendly way.`,
      );
    }
    kind = "add-to";
  }

  const recordId = openGeneration({
    day: allowance.day,
    description,
    prompt,
    model: config.marbleModel,
    kind,
    parentWorldId: parent?.id ?? null,
  });

  let operationStarted = false;
  try {
    let opId;

    if (kind === "add-to") {
      const canExpand = await expansionSupported();
      if (canExpand) {
        prompt = description;
        opId = await startExpansion({
          sourceWorldId: parent.worldId,
          prompt,
          displayName,
          model: config.marbleModel,
        });
        operationStarted = true;
      } else {
        // Remix: rebuild the original world description with her addition folded
        // in, so the new world reads as a bigger version of the old one. Her
        // original world file is never touched.
        prompt = [
          parent.prompt || parent.description,
          "",
          `Additionally, this place now also includes: ${description}.`,
          "Keep the original setting, mood, colours and lighting recognisably the same, and make the world larger to fit the new area.",
        ].join("\n");
        opId = await startGeneration({ prompt, displayName, model: config.marbleModel });
        operationStarted = true;
      }
    } else {
      opId = await startGeneration({ prompt, displayName, model: config.marbleModel });
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

    const record = {
      id,
      name: displayName,
      description,
      prompt,
      kind,
      parentId: parent?.id ?? null,
      worldId: worldIdOf(world),
      model: config.marbleModel,
      createdAtUtc: new Date().toISOString(),
      day: allowance.day,
      files: { splat: "world.spz", thumbnail: thumbFile },
      splatQuality: assets.splatQuality,
      splatBytes,
      meshUrl: assets.mesh,
      panoramaUrl: assets.panorama,
      caption: assets.caption,
    };
    registerWorld(record);

    const credits = estimateCredits(config.marbleModel, world);
    closeGeneration(recordId, {
      status: "succeeded",
      worldId: record.worldId,
      creditsEstimate: credits,
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
        `World folder: worlds/${id}/  (splat file: world.spz${thumbFile ? ", cover picture: thumb.jpg" : ""})`,
        kind === "add-to"
          ? `This was an "add to ${parent.name}" world. Her original "${parent.name}" is untouched and still playable.`
          : "",
        `Worlds left today: ${after.remaining}. Resets ${after.resetsIn}.`,
        "",
        "Now: celebrate with her! Tell her the world is ready, describe one lovely detail you",
        "expect from her description, and ask which game she wants to put it in — explore, maze,",
        "platformer, or sandbox.",
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
      // Never charge her a day for a problem that never reached the API.
      cancelGeneration(recordId);
    } else {
      closeGeneration(recordId, { status: "failed", note: studioErr.code, prompt });
      await persistLedger(`Studio: world attempt failed (${studioErr.code})`, [
        "logs/usage.json", "logs/usage.md",
      ]);
    }

    const stillHas = !operationStarted;
    return kidText(
      [
        `WORLD NOT MADE. Say this to her kindly, in your own words:`,
        `"${studioErr.kidMessage}"`,
        "",
        stillHas
          ? "GOOD NEWS: her daily world was NOT used up — she can try again as soon as it's fixed."
          : "Her daily world was used up on this attempt. Be extra kind about it and suggest playing an existing game.",
        "Never show her error codes, web addresses, or anything technical.",
      ].join("\n"),
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
    return `- "${w.name}"${from} — made ${when} — folder: worlds/${w.id}/`;
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
        `Say it kindly and suggest something fun she can do right now instead.`,
  );
}
