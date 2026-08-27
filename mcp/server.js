#!/usr/bin/env node
/**
 * Her Game Studio — Marble world MCP server (stdio wiring).
 *
 * The tool behaviour lives in lib/tools.js. Design rules that must not be
 * relaxed:
 *   1. The daily generation limit is enforced in code (lib/limit.js), not by
 *      instructions in CLAUDE.md.
 *   2. The API key is read from the environment only, never written to disk,
 *      never logged, and never returned in a tool result she can see.
 *   3. Every message that can reach her is written for an 8-year-old.
 *      Technical detail goes to stderr and logs/errors.log for Dad.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { makeWorld, listMyWorlds, worldsLeftToday, adminLog } from "./lib/tools.js";

const kidText = (text) => ({ content: [{ type: "text", text }] });

const TOOLS = [
  {
    name: "make_world",
    description:
      "Build a brand-new 3D world with the Marble world machine, or make a bigger version of one of her existing worlds. " +
      "STRICTLY LIMITED to a set number of worlds per day, enforced by this server. " +
      "Only call this AFTER running the new-world interview skill and getting her go-ahead — never from a one-line request.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "The rich, detailed world prompt assembled from her interview answers: the place, who lives there, " +
            "colours, time of day, the secret, the sounds. Not her one-line request.",
        },
        name: { type: "string", description: "Short friendly name for the world, in her words." },
        add_to_world: {
          type: "string",
          description:
            "Optional. The id or name of an existing world to make a bigger version of. " +
            "Her original world is never changed or deleted.",
        },
      },
      required: ["description"],
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
  { name: "her-game-studio-worlds", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === "make_world") {
      if (!args.description || !String(args.description).trim()) {
        return kidText(
          "NO GENERATION HAPPENED — make_world was called without a description. " +
            "Run the new-world interview skill first, then call this with the full assembled prompt.",
        );
      }
      return await makeWorld({
        description: String(args.description).trim(),
        name: args.name ? String(args.name).trim() : "",
        add_to_world: args.add_to_world ? String(args.add_to_world).trim() : "",
      });
    }
    if (name === "list_my_worlds") return listMyWorlds();
    if (name === "worlds_left_today") return worldsLeftToday();
    return kidText(`Unknown tool: ${name}`);
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
