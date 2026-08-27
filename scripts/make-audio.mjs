#!/usr/bin/env node
/**
 * Generates the studio's whole sound library as WAV files.
 *
 * Every sample here is synthesised from scratch, so there is no licence
 * attached to any of it and nothing had to be downloaded. Five looping music
 * beds (one per style mood) plus the game sound effects.
 *
 *   npm run audio        # rewrites assets/audio/. Deterministic.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "audio");
const RATE = 16000;

// ------------------------------------------------------------------ helpers

const clamp = (v) => Math.max(-1, Math.min(1, v));
const note = (semitonesFromA4) => 440 * 2 ** (semitonesFromA4 / 12);

function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(clamp(samples[i]) * 32000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);  // PCM
  header.writeUInt16LE(1, 22);  // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
  return 44 + data.length;
}

const WAVES = {
  sine: (p) => Math.sin(p * Math.PI * 2),
  triangle: (p) => 4 * Math.abs(p - Math.floor(p + 0.5)) - 1,
  square: (p) => (p % 1 < 0.5 ? 1 : -1),
  saw: (p) => 2 * (p - Math.floor(p + 0.5)),
};

/**
 * Adds one note into the buffer. `wrap` makes the tail wrap around to the
 * start, which is what keeps a loop seamless instead of clicking.
 */
function addNote(buf, { start, duration, freq, gain = 0.2, wave = "sine", attack = 0.01, release = 0.25, wrap = false }) {
  const shape = WAVES[wave];
  const total = Math.floor((duration + release) * RATE);
  const startIndex = Math.floor(start * RATE);

  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    let env;
    if (t < attack) env = t / attack;
    else if (t < duration) env = 1 - 0.35 * ((t - attack) / Math.max(0.001, duration - attack));
    else env = 0.65 * (1 - (t - duration) / release);
    if (env <= 0) continue;

    let index = startIndex + i;
    if (index >= buf.length) {
      if (!wrap) break;
      index -= buf.length;
    }
    buf[index] += shape(freq * t) * gain * env;
  }
}

function addNoise(buf, { start, duration, gain = 0.2, lowpass = 0.3, sweep = 0 }) {
  const startIndex = Math.floor(start * RATE);
  let seed = 12345;
  let filtered = 0;
  const total = Math.floor(duration * RATE);

  for (let i = 0; i < total; i++) {
    const index = startIndex + i;
    if (index >= buf.length) break;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x7fffffff) * 2 - 1;
    const cutoff = Math.max(0.02, Math.min(0.95, lowpass + sweep * (i / total)));
    filtered += (white - filtered) * cutoff;
    buf[index] += filtered * gain * (1 - i / total);
  }
}

/** Gentle wrapping echo — gives the loops some air without a reverb library. */
function echo(buf, delaySeconds, feedback) {
  const delay = Math.floor(delaySeconds * RATE);
  const out = Float64Array.from(buf);
  for (let i = 0; i < buf.length; i++) {
    out[(i + delay) % buf.length] += buf[i] * feedback;
  }
  return out;
}

function normalize(buf, peak = 0.82) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return buf;
  const scale = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= scale;
  return buf;
}

// ------------------------------------------------------------- music beds

const MOODS = {
  bright: {
    bars: 8, beat: 0.5, root: 3, // C
    scale: [0, 2, 4, 7, 9, 12, 14, 16],
    chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]],
    lead: "triangle", pad: "sine", padGain: 0.11, leadGain: 0.16, echo: [0.375, 0.22],
  },
  mysterious: {
    bars: 8, beat: 0.6, root: -2, // G
    scale: [0, 2, 3, 5, 7, 10, 12, 14],
    chords: [[0, 3, 7], [-2, 3, 8], [5, 8, 12], [0, 3, 7]],
    lead: "sine", pad: "triangle", padGain: 0.12, leadGain: 0.13, echo: [0.45, 0.3],
  },
  watery: {
    bars: 8, beat: 0.55, root: 1,
    scale: [0, 2, 4, 6, 7, 9, 11, 12],
    chords: [[0, 4, 9], [2, 7, 11], [-3, 4, 7], [0, 4, 9]],
    lead: "sine", pad: "sine", padGain: 0.13, leadGain: 0.12, echo: [0.55, 0.34],
  },
  spooky: {
    bars: 8, beat: 0.55, root: -4,
    scale: [0, 1, 4, 5, 7, 8, 11, 12],
    chords: [[0, 4, 7], [1, 5, 8], [-1, 4, 7], [0, 3, 8]],
    lead: "triangle", pad: "triangle", padGain: 0.1, leadGain: 0.13, echo: [0.5, 0.28],
  },
  spacey: {
    bars: 8, beat: 0.65, root: -7,
    scale: [0, 2, 5, 7, 9, 12, 14, 17],
    chords: [[0, 7, 12], [2, 9, 14], [5, 12, 17], [0, 7, 12]],
    lead: "sine", pad: "saw", padGain: 0.07, leadGain: 0.11, echo: [0.65, 0.36],
  },
};

function makeLoop(mood) {
  const spec = MOODS[mood];
  const barLength = spec.beat * 4;
  const length = Math.floor(spec.bars * barLength * RATE);
  let buf = new Float64Array(length);

  // Melody: a fixed pseudo-random walk up and down the scale. Seeded, so the
  // same mood always renders the same tune.
  let seed = mood.length * 7919;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let bar = 0; bar < spec.bars; bar++) {
    const chord = spec.chords[bar % spec.chords.length];
    const barStart = bar * barLength;

    // Pad: the chord held under everything.
    for (const interval of chord) {
      addNote(buf, {
        start: barStart, duration: barLength * 0.92, freq: note(spec.root + interval - 12),
        gain: spec.padGain, wave: spec.pad, attack: 0.15, release: 0.5, wrap: true,
      });
    }
    // Bass: root on beats 1 and 3.
    for (const offset of [0, barLength / 2]) {
      addNote(buf, {
        start: barStart + offset, duration: barLength * 0.4, freq: note(spec.root + chord[0] - 24),
        gain: 0.16, wave: "triangle", attack: 0.01, release: 0.2, wrap: true,
      });
    }
    // Lead: eighth notes, resting sometimes so it breathes.
    for (let step = 0; step < 8; step++) {
      if (rand() < 0.32) continue;
      const degree = spec.scale[Math.floor(rand() * spec.scale.length)];
      addNote(buf, {
        start: barStart + step * (spec.beat / 2),
        duration: spec.beat * 0.42,
        freq: note(spec.root + degree),
        gain: spec.leadGain * (0.7 + rand() * 0.4),
        wave: spec.lead, attack: 0.006, release: 0.22, wrap: true,
      });
    }
  }

  buf = echo(buf, spec.echo[0], spec.echo[1]);
  return normalize(buf, 0.7);
}

// ------------------------------------------------------------------- sfx

function sfx(name) {
  const seconds = { jump: 0.28, collect: 0.5, win: 1.6, splash: 0.5, step: 0.1, place: 0.22, undo: 0.28 }[name];
  const buf = new Float64Array(Math.floor(seconds * RATE));

  if (name === "jump") {
    for (let i = 0; i < buf.length; i++) {
      const t = i / RATE;
      const freq = 260 + 520 * (t / seconds);
      buf[i] = Math.sin(2 * Math.PI * freq * t) * 0.5 * (1 - t / seconds) ** 1.4;
    }
  } else if (name === "collect") {
    addNote(buf, { start: 0, duration: 0.1, freq: note(12), gain: 0.42, wave: "triangle", release: 0.12 });
    addNote(buf, { start: 0.09, duration: 0.12, freq: note(19), gain: 0.42, wave: "triangle", release: 0.22 });
    addNote(buf, { start: 0.09, duration: 0.12, freq: note(31), gain: 0.16, wave: "sine", release: 0.25 });
  } else if (name === "win") {
    const melody = [0, 4, 7, 12, 16, 19];
    melody.forEach((semi, i) => {
      addNote(buf, { start: i * 0.14, duration: 0.16, freq: note(semi + 3), gain: 0.34, wave: "triangle", release: 0.5 });
      addNote(buf, { start: i * 0.14, duration: 0.16, freq: note(semi + 15), gain: 0.12, wave: "sine", release: 0.5 });
    });
  } else if (name === "splash") {
    addNoise(buf, { start: 0, duration: 0.5, gain: 0.5, lowpass: 0.6, sweep: -0.5 });
    addNote(buf, { start: 0, duration: 0.12, freq: 180, gain: 0.2, wave: "sine", release: 0.2 });
  } else if (name === "step") {
    addNoise(buf, { start: 0, duration: 0.09, gain: 0.28, lowpass: 0.12 });
  } else if (name === "place") {
    addNoise(buf, { start: 0, duration: 0.05, gain: 0.22, lowpass: 0.35 });
    addNote(buf, { start: 0.01, duration: 0.08, freq: note(-5), gain: 0.3, wave: "sine", release: 0.14 });
  } else if (name === "undo") {
    addNote(buf, { start: 0, duration: 0.09, freq: note(7), gain: 0.3, wave: "triangle", release: 0.1 });
    addNote(buf, { start: 0.09, duration: 0.1, freq: note(0), gain: 0.3, wave: "triangle", release: 0.16 });
  }
  return normalize(buf, 0.75);
}

// ----------------------------------------------------------------- render

mkdirSync(OUT, { recursive: true });
let total = 0;
const manifest = { music: {}, sfx: {} };

for (const mood of Object.keys(MOODS)) {
  const bytes = writeWav(join(OUT, `music-${mood}.wav`), makeLoop(mood));
  manifest.music[mood] = `music-${mood}.wav`;
  total += bytes;
  console.log(`  music-${mood}.wav  ${(bytes / 1024).toFixed(0)} KB`);
}
for (const name of ["jump", "collect", "win", "splash", "step", "place", "undo"]) {
  const bytes = writeWav(join(OUT, `sfx-${name}.wav`), sfx(name));
  manifest.sfx[name] = `sfx-${name}.wav`;
  total += bytes;
  console.log(`  sfx-${name}.wav  ${(bytes / 1024).toFixed(1)} KB`);
}
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nTotal audio: ${(total / 1024 / 1024).toFixed(2)} MB (all synthesised, no licences)`);
