/**
 * Maze Adventure — a maze grows inside her world. Find the big golden door.
 * Make CELLS bigger for a harder maze, smaller for an easier one.
 */
import { Studio, THREE } from "../../shared/engine.js";

const CELLS = 6;
const CELL_SIZE = 3.4;
const WALL_HEIGHT = 3.2;
const OFFSET = ((CELLS - 1) * CELL_SIZE) / 2;

/** Recursive-backtracker maze. Seeded so the maze is the same every time. */
function carveMaze(size, seed = 7) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ n: true, e: true, s: true, w: true, seen: false })),
  );
  const stack = [[0, 0]];
  cells[0][0].seen = true;

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = [
      [cx, cy - 1, "n", "s"],
      [cx + 1, cy, "e", "w"],
      [cx, cy + 1, "s", "n"],
      [cx - 1, cy, "w", "e"],
    ].filter(([x, y]) => x >= 0 && y >= 0 && x < size && y < size && !cells[y][x].seen);

    if (!options.length) { stack.pop(); continue; }
    const [nx, ny, wallHere, wallThere] = options[Math.floor(rand() * options.length)];
    cells[cy][cx][wallHere] = false;
    cells[ny][nx][wallThere] = false;
    cells[ny][nx].seen = true;
    stack.push([nx, ny]);
  }
  return cells;
}

const studio = await Studio.create({
  title: "Maze Adventure",
  howTo: [
    "Walk with the arrow keys, or the round stick on the left.",
    "Drag anywhere on the picture to look around.",
    "The walls are see-through so you can peek at your world.",
    "That's YOU on the screen! Drag to swing the camera around you.",
    "Find the big golden door to win!",
  ],
  mode: "walk",
  worldBounds: 24,
  startPosition: [-OFFSET, 0, -OFFSET],
});

const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a63d2, transparent: true, opacity: 0.72, roughness: 0.4,
});

function addWall(x, z, width, depth) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, WALL_HEIGHT, depth), wallMaterial);
  wall.position.set(x, WALL_HEIGHT / 2, z);
  studio.scene.add(wall);
  studio.addSolid(wall);
}

const maze = carveMaze(CELLS);
const T = 0.35;
for (let y = 0; y < CELLS; y++) {
  for (let x = 0; x < CELLS; x++) {
    const cx = x * CELL_SIZE - OFFSET;
    const cz = y * CELL_SIZE - OFFSET;
    const cell = maze[y][x];
    if (cell.n) addWall(cx, cz - CELL_SIZE / 2, CELL_SIZE + T, T);
    if (cell.w) addWall(cx - CELL_SIZE / 2, cz, T, CELL_SIZE + T);
    if (x === CELLS - 1 && cell.e) addWall(cx + CELL_SIZE / 2, cz, T, CELL_SIZE + T);
    if (y === CELLS - 1 && cell.s) addWall(cx, cz + CELL_SIZE / 2, CELL_SIZE + T, T);
  }
}

const door = new THREE.Mesh(
  new THREE.BoxGeometry(1.7, 2.6, 0.3),
  new THREE.MeshStandardMaterial({ color: 0xffc93c, emissive: 0xffc93c, emissiveIntensity: 0.55 }),
);
door.position.set(OFFSET, 1.3, OFFSET);
studio.scene.add(door);

studio.setGoal("Find the golden door!");
studio.onUpdate((dt) => {
  door.rotation.y += dt * 0.9;
  if (door.position.distanceTo(studio.playerPosition) < 2) {
    studio.win("You found your way through the whole maze. Amazing sense of direction!");
  }
});
