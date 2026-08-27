/**
 * Build Anything — a creative sandbox. Pick a thing, press PLACE, decorate her
 * world. The layout saves by itself and is still there next time.
 */
import { Studio, THREE } from "../../shared/engine.js";

const PIECES = [
  { key: "block",   label: "🧱", name: "Block",   color: 0xff6ba9 },
  { key: "ball",    label: "⚽", name: "Ball",    color: 0x4fb8ff },
  { key: "tower",   label: "🗼", name: "Tower",   color: 0x8a63d2 },
  { key: "star",    label: "⭐", name: "Star",    color: 0xffc93c },
  { key: "tree",    label: "🌳", name: "Tree",    color: 0x3ddc97 },
];

const studio = await Studio.create({
  title: "Build Anything",
  howTo: [
    "Walk with the arrow keys, or the round stick on the left.",
    "Pick a thing from the row of buttons at the bottom.",
    "Press PLACE to put it down right in front of you.",
    "Press UNDO to take back the last thing you placed.",
    "Everything saves by itself — it will still be here next time!",
  ],
  mode: "walk",
  worldBounds: 24,
});

const SAVE_KEY = `studio-sandbox:${studio.config.worldId}`;
let chosen = PIECES[0];
const placed = [];

function build(piece, position, rotationY) {
  let mesh;
  const material = new THREE.MeshStandardMaterial({ color: piece.color, roughness: 0.45 });

  if (piece.key === "block") mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), material);
  else if (piece.key === "ball") mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), material);
  else if (piece.key === "tower") mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3.2, 12), material);
  else if (piece.key === "star") mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), material);
  else mesh = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 10), material);

  const height = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).y;
  mesh.position.set(position.x, height / 2, position.z);
  mesh.rotation.y = rotationY;
  studio.scene.add(mesh);
  studio.addSolid(mesh);
  placed.push({ key: piece.key, x: position.x, z: position.z, rotationY, mesh });
}

function save() {
  try {
    const data = placed.map(({ key, x, z, rotationY }) => ({ key, x, z, rotationY }));
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // A full or blocked localStorage must never interrupt her building.
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]");
    for (const item of saved) {
      const piece = PIECES.find((p) => p.key === item.key);
      if (piece) build(piece, { x: item.x, z: item.z }, item.rotationY || 0);
    }
  } catch {
    // Ignore a corrupt save rather than showing her an error.
  }
}

// ------------------------------------------------------------------- palette
const palette = document.createElement("div");
palette.className = "palette";
for (const piece of PIECES) {
  const button = document.createElement("button");
  button.className = "big-btn piece-btn";
  button.textContent = piece.label;
  button.title = piece.name;
  button.setAttribute("aria-label", piece.name);
  button.addEventListener("click", () => {
    chosen = piece;
    for (const other of palette.children) other.classList.remove("chosen");
    button.classList.add("chosen");
    studio.setGoal(`${piece.name} chosen — press PLACE!`);
  });
  palette.appendChild(button);
}
palette.firstChild.classList.add("chosen");
studio.ui.root.appendChild(palette);

const placeBtn = document.createElement("button");
placeBtn.className = "big-btn place-btn";
placeBtn.textContent = "PLACE";
placeBtn.addEventListener("click", () => {
  const p = studio.playerPosition;
  const yaw = studio.player.yaw;
  const spot = { x: p.x - Math.sin(yaw) * 3, z: p.z - Math.cos(yaw) * 3 };
  build(chosen, spot, Math.random() * Math.PI * 2);
  save();
  studio.setScore(placed.length);
  studio.setGoal(`${placed.length} thing${placed.length === 1 ? "" : "s"} built!`);
});
studio.ui.root.appendChild(placeBtn);

const undoBtn = document.createElement("button");
undoBtn.className = "big-btn undo-btn";
undoBtn.textContent = "UNDO";
undoBtn.addEventListener("click", () => {
  const last = placed.pop();
  if (!last) return;
  studio.scene.remove(last.mesh);
  studio.solids.pop();
  save();
  studio.setScore(placed.length);
});
studio.ui.root.appendChild(undoBtn);

load();
studio.setScore(placed.length);
studio.setGoal(placed.length ? "Welcome back to your build!" : "Pick a thing, then press PLACE!");
