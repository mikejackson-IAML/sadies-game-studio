#!/usr/bin/env node
/**
 * Generates worlds/placeholder/world.ply — a 3D Gaussian Splatting scene in the
 * standard INRIA binary PLY layout, so the four game templates are playable
 * before any Marble world has been generated.
 *
 * Authored in Marble/3DGS convention (Y points DOWN), so the engine applies the
 * same 180-degree X flip to this world as it does to a real Marble splat. Keeps
 * one code path for both.
 *
 * Deterministic: seeded RNG, so re-running produces a byte-identical file.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SH_C0 = 0.28209479177387814;

// mulberry32 — small, fast, seeded.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260827);
const range = (a, b) => a + rand() * (b - a);

const splats = [];
/** colour is linear 0..1 RGB; size is world units; up is -Y. */
function splat(x, y, z, r, g, b, alpha, sx, sy, sz) {
  splats.push({ x, y, z, r, g, b, alpha, sx, sy, sz });
}
function jitterColor(c, amt) {
  return c.map((v) => Math.min(1, Math.max(0, v + range(-amt, amt))));
}

// ---------------------------------------------------------------- ground
// A wide grassy disc with gentle rolling height.
const GROUND_R = 26;
const groundHeight = (x, z) =>
  Math.sin(x * 0.13) * 0.6 + Math.cos(z * 0.11) * 0.5 + Math.sin((x + z) * 0.07) * 0.35;

for (let i = 0; i < 17000; i++) {
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * GROUND_R;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const y = groundHeight(x, z); // +Y is down, so this dips the ground
  const [cr, cg, cb] = jitterColor([0.28, 0.62, 0.26], 0.10);
  splat(x, y, z, cr, cg, cb, 0.96, range(0.15, 0.26), 0.04, range(0.15, 0.26));
}

// A sandy path looping through the meadow, so there is somewhere obvious to walk.
for (let i = 0; i < 2400; i++) {
  const t = rand() * Math.PI * 2;
  const pr = 11 + Math.sin(t * 3) * 2.5;
  const x = Math.cos(t) * pr + range(-1.1, 1.1);
  const z = Math.sin(t) * pr + range(-1.1, 1.1);
  const [cr, cg, cb] = jitterColor([0.82, 0.72, 0.48], 0.06);
  splat(x, groundHeight(x, z) - 0.04, z, cr, cg, cb, 0.97, range(0.14, 0.24), 0.035, range(0.14, 0.24));
}

// ---------------------------------------------------------------- trees
const CANOPY_COLORS = [
  [0.20, 0.60, 0.25], [0.16, 0.52, 0.30], [0.95, 0.55, 0.75],
  [0.98, 0.72, 0.30], [0.55, 0.35, 0.80],
];
function tree(cx, cz, scale, canopy) {
  const groundY = groundHeight(cx, cz);
  const trunkH = 2.4 * scale;
  for (let i = 0; i < 130; i++) {
    const h = rand() * trunkH;
    const rr = 0.16 * scale * (1 - h / (trunkH * 1.6));
    const a = rand() * Math.PI * 2;
    const [cr, cg, cb] = jitterColor([0.36, 0.24, 0.15], 0.05);
    splat(cx + Math.cos(a) * rr, groundY - h, cz + Math.sin(a) * rr,
      cr, cg, cb, 0.98, 0.065 * scale, 0.10 * scale, 0.065 * scale);
  }
  const top = groundY - trunkH - 1.1 * scale;
  for (let i = 0; i < 950; i++) {
    // Cluster of three overlapping blobs makes a fluffier canopy than one sphere.
    const lobe = i % 3;
    const ox = (lobe === 1 ? 0.75 : lobe === 2 ? -0.7 : 0) * scale;
    const oz = (lobe === 1 ? -0.5 : lobe === 2 ? 0.55 : 0) * scale;
    const oy = (lobe === 0 ? -0.45 : 0.1) * scale;
    const rr = (0.95 + (lobe === 0 ? 0.35 : 0)) * scale;
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u) * Math.cbrt(rand());
    const [cr, cg, cb] = jitterColor(canopy, 0.09);
    splat(cx + ox + Math.cos(th) * s * rr, top + oy + u * rr * 0.85, cz + oz + Math.sin(th) * s * rr,
      cr, cg, cb, 0.92, 0.105 * scale, 0.105 * scale, 0.105 * scale);
  }
}
for (let i = 0; i < 15; i++) {
  const a = (i / 15) * Math.PI * 2 + range(-0.18, 0.18);
  const r = range(9, 22);
  tree(Math.cos(a) * r, Math.sin(a) * r, range(0.85, 1.5),
    CANOPY_COLORS[Math.floor(rand() * CANOPY_COLORS.length)]);
}

// ---------------------------------------------------------------- mushrooms
const CAP_COLORS = [[0.95, 0.25, 0.30], [0.98, 0.62, 0.15], [0.45, 0.70, 0.98], [0.85, 0.35, 0.85]];
for (let m = 0; m < 12; m++) {
  const a = rand() * Math.PI * 2, r = range(3, 20);
  const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
  const gy = groundHeight(cx, cz);
  const sc = range(0.5, 1.1);
  const cap = CAP_COLORS[Math.floor(rand() * CAP_COLORS.length)];
  for (let i = 0; i < 90; i++) {
    const h = rand() * 0.85 * sc;
    const aa = rand() * Math.PI * 2, rr = 0.11 * sc;
    splat(cx + Math.cos(aa) * rr, gy - h, cz + Math.sin(aa) * rr,
      0.95, 0.93, 0.86, 0.98, 0.055 * sc, 0.065 * sc, 0.055 * sc);
  }
  for (let i = 0; i < 210; i++) {
    const aa = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * 0.62 * sc;
    const dome = -Math.sqrt(Math.max(0, 1 - (rr / (0.62 * sc)) ** 2)) * 0.3 * sc;
    const [cr, cg, cb] = jitterColor(cap, 0.07);
    splat(cx + Math.cos(aa) * rr, gy - 0.85 * sc + dome, cz + Math.sin(aa) * rr,
      cr, cg, cb, 0.96, 0.07 * sc, 0.05 * sc, 0.07 * sc);
  }
}

// ---------------------------------------------------------------- balloons
const BALLOON = [
  [0.98, 0.30, 0.35], [0.99, 0.72, 0.20], [0.35, 0.85, 0.45],
  [0.35, 0.62, 0.98], [0.75, 0.42, 0.95], [0.99, 0.50, 0.78],
];
for (let b = 0; b < 14; b++) {
  const a = rand() * Math.PI * 2, r = range(4, 20);
  const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
  const cy = -range(4.5, 11);
  const col = BALLOON[b % BALLOON.length];
  const sc = range(0.55, 0.95);
  for (let i = 0; i < 190; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u) * Math.cbrt(rand());
    const [cr, cg, cb] = jitterColor(col, 0.05);
    splat(cx + Math.cos(th) * s * sc, cy + u * sc * 1.15, cz + Math.sin(th) * s * sc,
      cr, cg, cb, 0.94, 0.065 * sc, 0.07 * sc, 0.065 * sc);
  }
}

// ---------------------------------------------------------------- flowers
for (let i = 0; i < 2200; i++) {
  const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * GROUND_R * 0.95;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const col = BALLOON[Math.floor(rand() * BALLOON.length)];
  const [cr, cg, cb] = jitterColor(col, 0.12);
  splat(x, groundHeight(x, z) - range(0.12, 0.4), z, cr, cg, cb, 0.9, 0.045, 0.045, 0.045);
}

// ---------------------------------------------------------------- encode PLY
const HEADER_PROPS = [
  "x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
  "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
];
const header =
  "ply\nformat binary_little_endian 1.0\n" +
  `element vertex ${splats.length}\n` +
  HEADER_PROPS.map((p) => `property float ${p}\n`).join("") +
  "end_header\n";

const STRIDE = HEADER_PROPS.length * 4;
const body = Buffer.alloc(splats.length * STRIDE);
const logit = (a) => Math.log(a / (1 - a));
const toSH = (c) => (c - 0.5) / SH_C0;

splats.forEach((s, i) => {
  const o = i * STRIDE;
  const f = [
    s.x, s.y, s.z,
    toSH(s.r), toSH(s.g), toSH(s.b),
    logit(Math.min(0.999, s.alpha)),
    Math.log(s.sx), Math.log(s.sy), Math.log(s.sz),
    1, 0, 0, 0, // identity quaternion, w first
  ];
  for (let k = 0; k < f.length; k++) body.writeFloatLE(f[k], o + k * 4);
});

const outDir = join(ROOT, "worlds", "placeholder");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "world.ply"), Buffer.concat([Buffer.from(header, "ascii"), body]));
console.log(`Wrote ${splats.length} splats -> worlds/placeholder/world.ply`);
