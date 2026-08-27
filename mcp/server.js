#!/usr/bin/env node
/**
 * Her Game Studio — World Design Studio MCP server (stdio wiring).
 *
 * The tool behaviour lives in lib/tools.js. Design rules that must not be
 * relaxed:
 *   1. The daily generation limit is enforced in code (lib/limit.js), not by
 *      instructions in CLAUDE.md.
 *   2. API keys are read from the environment only, never written to disk,
 *      never logged, and never returned in a tool result she can see.
 *   3. Every message that can reach her is written for an 8-year-old.
 *      Technical detail goes to stderr and logs/errors.log for Dad.
 *   4. Only make_world spends anything. Designing, styling and previewing are
 *      free, so she can iterate as much as she likes.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  listStyles, designWorld, reviseHero, previewWorld,
  makeWorld, listMyWorlds, worldsLeftToday, adminLog,
} from "./lib/tools.js";

const kidText = (text) => ({ content: [{ type: "text", text }] });

const ANSWERS_SCHEMA = {
  type: "object",
  description: "Her interview answers, in her own words. Fill in what she said; leave the rest out.",
  properties: {
    place: { type: "string", description: "What this place is." },
    inhabitants: { type: "string", description: "Who lives there." },
    colors: { type: "string", description: "The colours she sees everywhere." },
    timeOfDay: { type: "string", description: "Day, night, sunset, morning..." },
    weather: { type: "string", description: "Weather and mood." },
    secret: { type: "string", description: "The coolest secret hiding in it." },
    sounds: { type: "string", description: "What she would hear standing there." },
  },
};

const DIRECTIONS_SCHEMA = {
  type: "object",
  description: "The compass game: standing in the middle of the world, what she sees each way.",
  properties: {
    front: { type: "string" },
    right: { type: "string" },
    back: { type: "string" },
    left: { type: "string" },
  },
};

const TOOLS = [
  {
    name: "list_styles",
    description:
      "The Style Menu for the World Design Studio. Shows the built-in world styles plus any world " +
      "she has already made. Call this during step 2 of the design. Costs nothing.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "design_world",
    description:
      "Step 1-3 of the World Design Studio: saves her answers as a World Card draft and draws ONE hero " +
      "concept image to lock in the style. Costs a fraction of a cent and does NOT touch her daily world " +
      "limit. Always run this before make_world — never generate a world from a one-line request.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short friendly name for the world, in her words." },
        gameType: {
          type: "string",
          enum: ["explore", "maze", "platformer", "sandbox"],
          description: "What she said she'll DO in this world. Shapes how the space is built.",
        },
        answers: ANSWERS_SCHEMA,
        styleIds: {
          type: "array",
          items: { type: "string" },
          description: "One style id, or TWO to mix them. Use 'world:<id>' for one of her own worlds. Empty is fine.",
        },
        directions: DIRECTIONS_SCHEMA,
        addToWorldId: {
          type: "string",
          description: "Optional. Id or name of an existing world to make a bigger version of. Her original is never changed.",
        },
      },
      required: ["answers"],
    },
  },
  {
    name: "revise_hero",
    description:
      "Redraws the hero concept image with a change she asked for. Capped per design so the image bill " +
      "stays bounded. Costs nothing from her daily world limit.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "The draft id from design_world." },
        change: { type: "string", description: "What she wants different, in her words." },
      },
      required: ["draftId", "change"],
    },
  },
  {
    name: "preview_world",
    description:
      "Step 4-5: draws the four compass views in the hero's style and finishes the World Card, ready to " +
      "read back to her as a story. Costs nothing from her daily world limit.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "The draft id from design_world." },
        directions: DIRECTIONS_SCHEMA,
      },
      required: ["draftId"],
    },
  },
  {
    name: "make_world",
    description:
      "THE EXPENSIVE ONE. Builds the real 3D world with Marble from a finished World Card. " +
      "STRICTLY LIMITED per day, enforced by this server. Only call it after preview_world and a clear " +
      "yes from her. Accepts a plain description only as a fallback when there was no design session.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "The finished draft from preview_world. Strongly preferred." },
        description: { type: "string", description: "Fallback only: a full assembled prompt when there is no draft." },
        name: { type: "string", description: "Short friendly name for the world, in her words." },
        add_to_world: { type: "string", description: "Fallback only: existing world to make a bigger version of." },
      },
    },
  },
  {
    name: "list_my_worlds",
    description: "List all the worlds she has made, with their names and the dates she made them.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "worlds_left_today",
    description: "How many new worlds she can still make today, and when the limit resets.",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = new Server(
  { name: "her-game-studio-worlds", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case "list_styles":
        return listStyles();

      case "design_world":
        if (!args.answers || !Object.keys(args.answers).length) {
          return kidText(
            "NOTHING HAPPENED — design_world needs her interview answers. Run the new-world skill's " +
              "questions first, then call this with what she said.",
          );
        }
        return await designWorld(args);

      case "revise_hero":
        return await reviseHero({ draftId: String(args.draftId), change: String(args.change ?? "") });

      case "preview_world":
        return await previewWorld({ draftId: String(args.draftId), directions: args.directions });

      case "make_world":
        if (!args.draft_id && !args.description) {
          return kidText(
            "NO GENERATION HAPPENED — make_world needs either a finished draft_id or a full description. " +
              "Run the new-world skill (design_world then preview_world) first.",
          );
        }
        return await makeWorld({
          draftId: args.draft_id ? String(args.draft_id).trim() : null,
          description: args.description ? String(args.description).trim() : null,
          name: args.name ? String(args.name).trim() : "",
          add_to_world: args.add_to_world ? String(args.add_to_world).trim() : "",
        });

      case "list_my_worlds":
        return listMyWorlds();

      case "worlds_left_today":
        return worldsLeftToday();

      default:
        return kidText(`Unknown tool: ${name}`);
    }
  } catch (err) {
    adminLog(`tool ${name} crashed: ${err?.stack || err}`);
    return kidText(
      "Something in the studio hiccuped. Tell her nothing is lost and you'll try again — " +
        "and do not show her anything technical.",
    );
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
adminLog("her-game-studio MCP server ready");
