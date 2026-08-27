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
