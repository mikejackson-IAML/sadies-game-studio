/**
 * Explore and Collect — walk around her world and gather every glowing star.
 * Change TREASURE_COUNT or the colours to make it yours.
 */
import { Studio, THREE } from "../../shared/engine.js";

const TREASURE_COUNT = 8;
const COLORS = [0xffc93c, 0xff6ba9, 0x3ddc97, 0x4fb8ff, 0x8a63d2, 0xff8c42];

const studio = await Studio.create({
  title: "Explore and Collect",
  howTo: [
    "Walk around with the arrow keys, or the round stick on the left.",
    "Drag anywhere on the picture to look around.",
    "Find all the glowing stars — just walk into one to collect it!",
    "That's YOU on the screen! Drag to swing the camera around you.",
    "Collect every star to win.",
  ],
  mode: "walk",
  worldBounds: 24,
  startPosition: [0, 0, 0],
});

const treasures = [];
for (let i = 0; i < TREASURE_COUNT; i++) {
  const angle = (i / TREASURE_COUNT) * Math.PI * 2 + 0.4;
  const radius = 7 + (i % 3) * 5.5;
  const color = COLORS[i % COLORS.length];

  const star = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.3 }),
  );
  star.position.set(Math.cos(angle) * radius, 1.15, Math.sin(angle) * radius);
  star.userData.collected = false;
  star.userData.bobOffset = i * 0.7;

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 16, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22 }),
  );
  star.add(glow);

  studio.scene.add(star);
  treasures.push(star);
}

let collected = 0;
studio.setScore(0, TREASURE_COUNT);
studio.setGoal("Find all the glowing stars!");

studio.onUpdate((dt) => {
  const time = performance.now() / 1000;
  for (const star of treasures) {
    if (star.userData.collected) continue;
    star.rotation.y += dt * 1.6;
    star.position.y = 1.15 + Math.sin(time * 2 + star.userData.bobOffset) * 0.22;

    if (star.position.distanceTo(studio.playerPosition) < 1.7) {
      star.userData.collected = true;
      star.visible = false;
      collected++;
      studio.audio.play("collect");
      studio.setScore(collected, TREASURE_COUNT);
      studio.setGoal(
        collected === TREASURE_COUNT
          ? "You got them all!"
          : `${TREASURE_COUNT - collected} more to find!`,
      );
      if (collected === TREASURE_COUNT) {
        studio.win("You found every single star. You explored the whole world!");
      }
    }
  }
});
