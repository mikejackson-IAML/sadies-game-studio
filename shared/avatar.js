/**
 * Her character.
 *
 * Built from simple shapes rather than a downloaded model, so it is hers, it
 * has no licence attached, and it can be restyled from a few colour choices in
 * config/avatar.json. She is the playable character in every template, seen
 * from behind in third person.
 */
import * as THREE from "three";

const DEFAULTS = {
  name: "",
  bodyColor: "#ff6ba9",
  accentColor: "#ffc93c",
  skinColor: "#f6c9a0",
  hairColor: "#5b3a29",
  hat: "none",
  companion: { animal: "none", color: "#ffd166", name: "" },
};

const solid = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.55, ...opts });

function part(geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Returns a group whose origin sits at the character's FEET, facing -Z (the
 * same direction the engine treats as forward).
 */
export function buildAvatar(options = {}) {
  const cfg = { ...DEFAULTS, ...options, companion: { ...DEFAULTS.companion, ...(options.companion || {}) } };
  const group = new THREE.Group();

  const bodyMat = solid(cfg.bodyColor);
  const skinMat = solid(cfg.skinColor);
  const accentMat = solid(cfg.accentColor);
  const hairMat = solid(cfg.hairColor);

  const legs = new THREE.Group();
  const legGeo = new THREE.CapsuleGeometry(0.09, 0.28, 4, 8);
  const legL = part(legGeo, accentMat, -0.11, 0.24, 0);
  const legR = part(legGeo, accentMat, 0.11, 0.24, 0);
  legs.add(legL, legR);
  group.add(legs);

  const torso = part(new THREE.CapsuleGeometry(0.21, 0.34, 6, 12), bodyMat, 0, 0.72, 0);
  group.add(torso);

  const arms = new THREE.Group();
  const armGeo = new THREE.CapsuleGeometry(0.068, 0.26, 4, 8);
  const armL = part(armGeo, skinMat, -0.29, 0.76, 0);
  const armR = part(armGeo, skinMat, 0.29, 0.76, 0);
  arms.add(armL, armR);
  group.add(arms);

  const head = part(new THREE.SphereGeometry(0.24, 20, 16), skinMat, 0, 1.16, 0);
  group.add(head);

  // Hair as a slightly larger back-half shell so the face stays clear.
  const hair = part(new THREE.SphereGeometry(0.255, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat, 0, 1.17, 0);
  group.add(hair);

  const eyeGeo = new THREE.SphereGeometry(0.043, 10, 8);
  const eyeMat = solid("#23214a");
  group.add(part(eyeGeo, eyeMat, -0.085, 1.18, -0.205), part(eyeGeo, eyeMat, 0.085, 1.18, -0.205));

  if (cfg.hat === "cap") {
    group.add(part(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 16), accentMat, 0, 1.35, 0));
    group.add(part(new THREE.BoxGeometry(0.34, 0.03, 0.22), accentMat, 0, 1.31, -0.22));
  } else if (cfg.hat === "crown") {
    const crown = part(new THREE.CylinderGeometry(0.23, 0.2, 0.16, 8, 1, true), solid("#ffc93c", { side: THREE.DoubleSide }), 0, 1.38, 0);
    group.add(crown);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      group.add(part(new THREE.ConeGeometry(0.045, 0.11, 6), solid("#ffc93c"), Math.cos(a) * 0.21, 1.5, Math.sin(a) * 0.21));
    }
  } else if (cfg.hat === "wizard") {
    group.add(part(new THREE.ConeGeometry(0.28, 0.62, 16), solid(cfg.accentColor), 0, 1.6, 0));
    group.add(part(new THREE.CylinderGeometry(0.34, 0.34, 0.035, 18), solid(cfg.accentColor), 0, 1.31, 0));
  } else if (cfg.hat === "bow") {
    const bowMat = solid(cfg.accentColor);
    group.add(part(new THREE.SphereGeometry(0.075, 10, 8), bowMat, -0.11, 1.36, 0));
    group.add(part(new THREE.SphereGeometry(0.075, 10, 8), bowMat, 0.11, 1.36, 0));
    group.add(part(new THREE.SphereGeometry(0.045, 8, 6), bowMat, 0, 1.36, 0));
  }

  group.userData.animation = { legs: [legL, legR], arms: [armL, armR], torso, head };
  return group;
}

const COMPANION_SHAPES = {
  cat: { body: 0.19, ears: "pointy", tail: true, snout: 0.06 },
  dog: { body: 0.2, ears: "floppy", tail: true, snout: 0.09 },
  fox: { body: 0.19, ears: "pointy", tail: true, snout: 0.1 },
  bunny: { body: 0.18, ears: "long", tail: false, snout: 0.05 },
  dragon: { body: 0.22, ears: "pointy", tail: true, snout: 0.09, wings: true },
  bird: { body: 0.15, ears: "none", tail: false, snout: 0.07, wings: true },
};

/** A little friend that bobs along behind her. Origin is its centre. */
export function buildCompanion(animal, color = "#ffd166") {
  const shape = COMPANION_SHAPES[animal];
  if (!shape) return null;

  const group = new THREE.Group();
  const mat = solid(color);
  const dark = solid("#23214a");

  group.add(part(new THREE.SphereGeometry(shape.body, 16, 12), mat, 0, 0, 0));
  group.add(part(new THREE.SphereGeometry(shape.body * 0.72, 16, 12), mat, 0, shape.body * 0.85, -0.02));

  if (shape.snout) {
    group.add(part(new THREE.ConeGeometry(shape.snout * 0.7, shape.snout * 1.4, 10), mat, 0, shape.body * 0.8, -shape.body * 0.75));
  }
  const eye = new THREE.SphereGeometry(0.032, 8, 6);
  group.add(part(eye, dark, -0.06, shape.body * 0.95, -shape.body * 0.55));
  group.add(part(eye, dark, 0.06, shape.body * 0.95, -shape.body * 0.55));

  if (shape.ears === "pointy") {
    group.add(part(new THREE.ConeGeometry(0.055, 0.12, 6), mat, -0.08, shape.body * 1.4, 0));
    group.add(part(new THREE.ConeGeometry(0.055, 0.12, 6), mat, 0.08, shape.body * 1.4, 0));
  } else if (shape.ears === "long") {
    group.add(part(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), mat, -0.07, shape.body * 1.6, 0));
    group.add(part(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), mat, 0.07, shape.body * 1.6, 0));
  } else if (shape.ears === "floppy") {
    group.add(part(new THREE.CapsuleGeometry(0.045, 0.11, 4, 8), mat, -0.13, shape.body * 0.95, 0));
    group.add(part(new THREE.CapsuleGeometry(0.045, 0.11, 4, 8), mat, 0.13, shape.body * 0.95, 0));
  }
  if (shape.tail) {
    group.add(part(new THREE.CapsuleGeometry(0.045, 0.18, 4, 8), mat, 0, shape.body * 0.35, shape.body * 0.9));
  }
  if (shape.wings) {
    const wingGeo = new THREE.BoxGeometry(0.22, 0.02, 0.13);
    const wingL = part(wingGeo, mat, -0.2, shape.body * 0.6, 0.02);
    const wingR = part(wingGeo, mat, 0.2, shape.body * 0.6, 0.02);
    group.add(wingL, wingR);
    group.userData.wings = [wingL, wingR];
  }
  return group;
}

export async function loadAvatarConfig() {
  try {
    const response = await fetch("../../config/avatar.json", { cache: "no-store" });
    if (response.ok) return { ...DEFAULTS, ...(await response.json()) };
  } catch {
    // Falls back to the default look; never blocks the game from starting.
  }
  return { ...DEFAULTS };
}

/**
 * Small per-world costume changes, so her character belongs in the place she
 * built: a snorkel in the reef, a helmet in space, a scarf in the snow.
 *
 * Keyed on the world's style, falling back to its mood so an unknown style
 * still gets something sensible rather than nothing.
 */
const OUTFITS = {
  "underwater-reef": "snorkel",
  "outer-space": "helmet",
  "snowy-village": "scarf",
  "enchanted-forest": "cloak",
  "fairy-garden": "wings",
  "dino-jungle": "explorer",
  "candy-kingdom": "sprinkles",
  "rainbow-clouds": "cape",
  "spooky-friendly": "lantern",
  "desert-oasis": "sunhat",
};

const MOOD_OUTFITS = {
  watery: "snorkel",
  spacey: "helmet",
  spooky: "lantern",
  mysterious: "cloak",
  bright: null,
};

export function applyWorldOutfit(avatar, styleId, mood) {
  // A mixed style ("candy+underwater") uses whichever half we recognise first.
  const ids = String(styleId || "").split("+");
  const kind = ids.map((id) => OUTFITS[id]).find(Boolean) || MOOD_OUTFITS[mood] || null;
  if (!kind) return null;

  const group = new THREE.Group();
  const accent = solid("#ffc93c");

  if (kind === "snorkel") {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.14, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.62, roughness: 0.15 }),
    );
    glass.position.set(0, 1.19, -0.21);
    const strap = part(new THREE.TorusGeometry(0.235, 0.022, 8, 20), solid("#23214a"), 0, 1.19, 0);
    strap.rotation.y = Math.PI / 2;
    const tube = part(new THREE.CapsuleGeometry(0.022, 0.3, 4, 8), accent, 0.2, 1.3, -0.06);
    tube.rotation.z = -0.18;
    // Flippers: the camera sits behind her, so the mask alone would never be
    // seen. These read from the back, which is the view she actually has.
    for (const side of [-1, 1]) {
      const fin = part(new THREE.BoxGeometry(0.16, 0.03, 0.34), solid("#3ddc97"), side * 0.11, 0.03, -0.1);
      group.add(fin);
    }
    group.add(glass, strap, tube);
  } else if (kind === "helmet") {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xcdefff, transparent: true, opacity: 0.3, roughness: 0.05 }),
    );
    dome.position.set(0, 1.17, 0);
    const ring = part(new THREE.TorusGeometry(0.3, 0.035, 8, 22), solid("#dfe6ef"), 0, 0.94, 0);
    ring.rotation.x = Math.PI / 2;
    const pack = part(new THREE.BoxGeometry(0.3, 0.36, 0.16), solid("#dfe6ef"), 0, 0.76, 0.22);
    group.add(dome, ring, pack);
  } else if (kind === "scarf") {
    const wrap = part(new THREE.TorusGeometry(0.2, 0.06, 8, 20), solid("#ff6b6b"), 0, 0.94, 0);
    wrap.rotation.x = Math.PI / 2;
    const tail = part(new THREE.BoxGeometry(0.11, 0.4, 0.05), solid("#ff6b6b"), 0.1, 0.74, 0.16);
    tail.rotation.z = 0.2;
    const bobble = part(new THREE.SphereGeometry(0.075, 12, 10), solid("#fffdf7"), 0, 1.46, 0);
    const beanie = part(new THREE.SphereGeometry(0.26, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), solid("#4fb8ff"), 0, 1.2, 0);
    group.add(wrap, tail, bobble, beanie);
  } else if (kind === "cloak" || kind === "cape") {
    const color = kind === "cape" ? "#ff6ba9" : "#3f7d45";
    const cloak = part(new THREE.ConeGeometry(0.36, 0.78, 14, 1, true), solid(color, { side: THREE.DoubleSide }), 0, 0.7, 0.06);
    const collar = part(new THREE.TorusGeometry(0.2, 0.04, 8, 18), solid(color), 0, 0.95, 0.02);
    collar.rotation.x = Math.PI / 2;
    group.add(cloak, collar);
  } else if (kind === "wings") {
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xffd6f2, transparent: true, opacity: 0.62, roughness: 0.2, side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16, 0, Math.PI), wingMat);
      wing.position.set(side * 0.22, 0.86, 0.14);
      wing.rotation.set(0, side * 0.7, side * 0.5);
      group.add(wing);
    }
  } else if (kind === "explorer") {
    group.add(part(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 16), solid("#c8a165"), 0, 1.36, 0));
    group.add(part(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 20), solid("#c8a165"), 0, 1.3, 0));
    group.add(part(new THREE.BoxGeometry(0.28, 0.3, 0.14), solid("#8a6b3f"), 0, 0.78, 0.2));
  } else if (kind === "sprinkles") {
    const colors = ["#ff6ba9", "#ffc93c", "#3ddc97", "#4fb8ff", "#8a63d2"];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dot = part(new THREE.CapsuleGeometry(0.016, 0.04, 3, 6), solid(colors[i % colors.length]),
        Math.cos(a) * 0.22, 0.66 + (i % 4) * 0.11, Math.sin(a) * 0.22);
      dot.rotation.set(Math.cos(a), 0, Math.sin(a));
      group.add(dot);
    }
  } else if (kind === "lantern") {
    const lantern = part(new THREE.SphereGeometry(0.12, 12, 10), solid("#ff8c42", { emissive: 0xff8c42, emissiveIntensity: 0.8 }), 0.32, 0.6, -0.1);
    const stalk = part(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6), solid("#3f7d45"), 0.32, 0.7, -0.1);
    group.add(lantern, stalk);
  } else if (kind === "sunhat") {
    group.add(part(new THREE.CylinderGeometry(0.21, 0.21, 0.12, 16), solid("#f4e3b2"), 0, 1.35, 0));
    group.add(part(new THREE.CylinderGeometry(0.42, 0.42, 0.025, 22), solid("#f4e3b2"), 0, 1.3, 0));
    const band = part(new THREE.TorusGeometry(0.212, 0.022, 8, 18), solid("#4fb8ff"), 0, 1.31, 0);
    band.rotation.x = Math.PI / 2;
    group.add(band);
  }

  group.name = `outfit:${kind}`;
  avatar.add(group);
  avatar.userData.outfit = kind;
  return kind;
}
