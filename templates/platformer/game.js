/**
 * Jump and Climb — floating platforms spiral up through her world.
 * Reach the flag at the very top. Add more platforms to PLATFORMS to go higher.
 */
import { Studio, THREE } from "../../shared/engine.js";

const STEPS = 12;
const COLORS = [0xff6ba9, 0xffc93c, 0x3ddc97, 0x4fb8ff, 0x8a63d2];

const studio = await Studio.create({
  title: "Jump and Climb",
  howTo: [
    "Walk with the arrow keys, or the round stick on the left.",
    "Press the SPACE bar or the big JUMP button to jump.",
    "Hop from platform to platform all the way to the top.",
    "That's YOU on the screen! Drag to swing the camera around you.",
    "If you fall, don't worry! You just land on the grass and can try again.",
  ],
  mode: "platform",
  worldBounds: 24,
  startPosition: [0, 0, 0],
});

const moving = [];
for (let i = 0; i < STEPS; i++) {
  const angle = i * 1.05;
  const radius = 3.5 + (i % 4) * 1.6;
  const color = COLORS[i % COLORS.length];

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.45, 2.8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45 }),
  );
  platform.position.set(Math.cos(angle) * radius, 1.6 + i * 1.35, Math.sin(angle) * radius);
  studio.scene.add(platform);
  studio.addSolid(platform);

  // Every third platform drifts side to side to make the climb interesting.
  if (i % 3 === 2) {
    moving.push({ mesh: platform, box: studio.solids[studio.solids.length - 1], base: platform.position.clone(), phase: i });
  }
}

const top = new THREE.Vector3(Math.cos(STEPS * 1.05) * 4, 1.6 + STEPS * 1.35, Math.sin(STEPS * 1.05) * 4);
const goalPad = new THREE.Mesh(
  new THREE.CylinderGeometry(2, 2, 0.4, 24),
  new THREE.MeshStandardMaterial({ color: 0xfffdf7, roughness: 0.5 }),
);
goalPad.position.copy(top);
studio.scene.add(goalPad);
studio.addSolid(goalPad);

const flag = new THREE.Mesh(
  new THREE.ConeGeometry(0.6, 1.6, 8),
  new THREE.MeshStandardMaterial({ color: 0xffc93c, emissive: 0xffc93c, emissiveIntensity: 0.5 }),
);
flag.position.set(top.x, top.y + 1.2, top.z);
studio.scene.add(flag);

studio.setGoal("Climb all the way to the golden flag!");

studio.onUpdate((dt) => {
  const time = performance.now() / 1000;
  for (const item of moving) {
    const drift = Math.sin(time * 0.8 + item.phase) * 1.9;
    const nextX = item.base.x + drift;
    item.box.translate(new THREE.Vector3(nextX - item.mesh.position.x, 0, 0));
    item.mesh.position.x = nextX;
  }
  flag.rotation.y += dt * 1.4;

  if (flag.position.distanceTo(studio.playerPosition) < 2.4) {
    studio.win("You climbed all the way to the top! What a jumper!");
  }
});
