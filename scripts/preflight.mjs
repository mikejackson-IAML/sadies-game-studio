#!/usr/bin/env node
/**
 * Network preflight: can this machine actually reach the services the studio
 * depends on?
 *
 *   npm run preflight
 *
 * Worth running on the environment Sadie's sessions run in, not just yours.
 * Managed environments often allow-list outbound hosts, and a blocked host
 * looks exactly like a bad API key from inside the app — this tells them apart.
 */
const HOSTS = [
  { host: "api.worldlabs.ai", need: "required", what: "Marble API — generating worlds" },
  { host: "cdn.marble.worldlabs.ai", need: "required", what: "downloading the world files Marble produces" },
  { host: "generativelanguage.googleapis.com", need: "optional", what: "Gemini concept images" },
  { host: "platform.higgsfield.ai", need: "optional", what: "Higgsfield character art" },
  { host: "github.com", need: "required", what: "saving and publishing her games" },
];

/**
 * Some managed environments run a policy proxy that answers a blocked CONNECT
 * with its own HTTP 403. That is indistinguishable from the service itself
 * returning 403, so ask the proxy directly when one is present — otherwise a
 * blocked host reports as reachable, which is worse than not checking at all.
 */
async function proxyDenials() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return null;
  try {
    const response = await fetch(`${proxy.replace(/\/$/, "")}/__agentproxy/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const status = await response.json();
    return (status.recentRelayFailures || [])
      .filter((f) => f.kind === "connect_rejected")
      .map((f) => String(f.host || "").split(":")[0]);
  } catch {
    return null;
  }
}

async function probe(host) {
  const started = Date.now();
  try {
    const response = await fetch(`https://${host}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    // 401/403/404 from the service itself is fine — this tests reachability,
    // not authentication. Proxy denials are separated out below.
    return { ok: true, status: response.status, detail: `HTTP ${response.status}`, ms: Date.now() - started };
  } catch (err) {
    const message = String(err?.message || err);
    return {
      ok: false,
      status: 0,
      detail: /timeout|abort/i.test(message) ? "timed out" : "connection refused or blocked",
      ms: Date.now() - started,
    };
  }
}

console.log("\n  Network preflight\n");

const results = [];
for (const entry of HOSTS) {
  results.push({ ...entry, ...(await probe(entry.host)) });
}

// Re-classify anything the local policy proxy admits it refused.
const denied = await proxyDenials();
for (const result of results) {
  if (denied?.includes(result.host)) {
    result.ok = false;
    result.detail = "BLOCKED by network policy";
  }
}

for (const result of results) {
  const mark = result.ok ? "ok  " : result.need === "required" ? "FAIL" : "--  ";
  console.log(`  ${mark} ${result.host.padEnd(36)} ${result.detail.padEnd(28)} ${result.what}`);
}

// Fallback heuristic for environments with no queryable proxy: if every remote
// service answers 403 while a control host answers normally, that is a policy
// block, not five services all rejecting us at once.
if (denied === null) {
  const control = results.find((r) => r.host === "github.com");
  const suspicious = results.filter((r) => r.host !== "github.com" && r.status === 403);
  if (control?.status === 200 && suspicious.length === results.length - 1) {
    console.log("\n  WARNING: every service returned 403 while github.com answered normally.");
    console.log("  That pattern is an outbound policy block, not five bad keys. Treat the");
    console.log("  hosts above as unreachable and check the environment's network policy.");
  }
}

const blockedRequired = results.filter((r) => !r.ok && r.need === "required");
const blockedOptional = results.filter((r) => !r.ok && r.need === "optional");

if (blockedOptional.length) {
  console.log(`\n  Optional services unreachable: ${blockedOptional.map((r) => r.host).join(", ")}`);
  console.log("  Everything still works without them; those features are simply off.");
}

if (!blockedRequired.length) {
  console.log("\n  All required hosts reachable.\n");
  process.exit(0);
}

console.log(
  [
    "",
    `  ${blockedRequired.length} REQUIRED host(s) unreachable: ${blockedRequired.map((r) => r.host).join(", ")}`,
    "",
    "  From inside the studio this looks identical to a bad API key, so check this",
    "  first. Almost always it is an outbound allow-list on the environment rather",
    "  than anything wrong with the studio.",
    "",
    "  For Claude Code on the web: add these hosts to the environment's network",
    "  policy, then re-run. Run this on the environment SADIE uses, not only on",
    "  your own machine — they can have different policies.",
    "",
  ].join("\n"),
);
process.exit(1);
