/**
 * Her Game Studio — shared game engine.
 *
 * Every template builds on this. It loads one of her Marble worlds as the
 * scenery (a Gaussian splat), puts HER character in it, and runs normal
 * Three.js meshes on top for the things you can actually touch: platforms,
 * walls, collectables.
 *
 * The camera is third person and sits behind her character, because the point
 * of designing a character is getting to see it. Splat worlds carry no
 * collision data, so gameplay collides against meshes we place ourselves —
 * which keeps every template working with ANY world she makes.
 */
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { buildAvatar, buildCompanion, loadAvatarConfig, applyWorldOutfit } from "./avatar.js";
import { GameAudio } from "./audio.js";

const EYE_HEIGHT = 1.6;
const PLAYER_HALF = 0.3;
const GRAVITY = -22;
const CAMERA_DISTANCE = 4.6;
const CAMERA_HEIGHT = 1.1;
const STEP_DISTANCE = 2.2;

export class Studio {
  static async create(options) {
    const studio = new Studio(options);
    await studio._boot();
    return studio;
  }

  constructor({ title, howTo, mode = "walk", worldBounds = 26, startPosition = [0, 0, 6] }) {
    this.title = title;
    this.howTo = howTo;
    this.mode = mode;
    this.worldBounds = worldBounds;
    this.startPosition = startPosition;

    this.solids = [];
    this._updaters = [];
    this._won = false;
    this._lastFrame = performance.now();
    this._walked = 0;

    this.player = {
      position: new THREE.Vector3(startPosition[0], startPosition[1] + EYE_HEIGHT, startPosition[2]),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0.25,
      grounded: true,
      speed: 5.2,
      jumpSpeed: 8.2,
      canJump: true,
    };
  }

  // ------------------------------------------------------------------- boot

  async _boot() {
    this.config = await loadGameConfig();
    this.avatarConfig = await loadAvatarConfig();
    this.ui = buildUI(this.title, this.howTo, this.config.studioName);
    document.body.appendChild(this.ui.root);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.ui.canvasHolder.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fd3ff);
    this.scene.fog = new THREE.Fog(0x8fd3ff, 42, 100);

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 300);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f5a, 2.1));
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.5);
    sun.position.set(12, 20, 8);
    this.scene.add(sun);

    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);

    this._addCharacter();
    this._updateCamera();

    // Only ask for character art when the world actually has some — a
    // speculative fetch would 404 in the console on every other world.
    if (this.config.characterArt) {
      this.ui.setCharacterArt(`../../worlds/${this.config.worldId}/${this.config.characterArt}`);
    }

    this.audio = new GameAudio();
    const audioReady = this.audio.load(this.config.mood || "bright");

    await this._loadWorld();
    await audioReady;

    this._bindInput();

    // Hooks the automated game tests use to confirm she actually moves.
    window.__studioPos = () => ({ ...this.player.position });
    window.__studioDebug = () => ({
      pos: { ...this.player.position }, grounded: this.player.grounded,
      solidCount: this.solids.length, hasAvatar: !!this.avatar,
      hasCompanion: !!this.companion, outfit: this.outfit, muted: this.audio.muted,
      audioReady: this.audio.ready, mood: this.config.mood,
    });

    window.addEventListener("resize", () => this._resize());
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _addCharacter() {
    this.avatar = buildAvatar(this.avatarConfig);
    // A small costume change so she belongs in the world she built.
    this.outfit = applyWorldOutfit(this.avatar, this.config.styleId, this.config.mood);
    this.scene.add(this.avatar);

    const { animal, color } = this.avatarConfig.companion || {};
    this.companion = animal && animal !== "none" ? buildCompanion(animal, color) : null;
    if (this.companion) {
      this.companion.position.set(this.player.position.x + 1, 0.6, this.player.position.z + 1);
      this.scene.add(this.companion);
    }
  }

  async _loadWorld() {
    const url = `../../worlds/${this.config.worldId}/${this.config.worldFile}`;
    try {
      const splat = new SplatMesh({
        url,
        onProgress: (event) => {
          if (event?.lengthComputable && event.total > 0) {
            this.ui.setLoadProgress(event.loaded / event.total);
          }
        },
      });
      // Splat data is authored Y-down; this flips it upright for Three.js.
      splat.quaternion.set(1, 0, 0, 0);
      this.scene.add(splat);
      this.world = splat;
      await splat.initialized;
      this.ui.hideLoading();
    } catch (err) {
      console.error("world load failed", err);
      this.ui.showWorldError();
      throw err;
    }
  }

  // ------------------------------------------------------------------ input

  _bindInput() {
    this.keys = new Set();
    const unlock = () => this.audio.unlock();

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      unlock();
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (e.code === "KeyM") this._toggleMute();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("touchstart", unlock, { passive: true });

    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, jump: false };
    bindTouchControls(this.ui, this.touch, this.renderer.domElement);

    this.ui.muteBtn.addEventListener("click", () => this._toggleMute());
    this.ui.setMuted(this.audio.muted);
  }

  _toggleMute() {
    this.audio.unlock();
    this.ui.setMuted(this.audio.toggleMute());
  }

  _readMovement() {
    const k = this.keys;
    let forward = 0;
    let strafe = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) forward += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) forward -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) strafe += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) strafe -= 1;

    forward += this.touch.move.y;
    strafe += this.touch.move.x;

    const jump = k.has("Space") || this.touch.jump;
    this.touch.jump = false;

    const len = Math.hypot(forward, strafe);
    if (len > 1) { forward /= len; strafe /= len; }
    return { forward, strafe, jump };
  }

  // ---------------------------------------------------------------- physics

  _step(dt) {
    const p = this.player;
    const { forward, strafe, jump } = this._readMovement();

    p.yaw -= this.touch.look.x;
    p.pitch += this.touch.look.y;
    p.pitch = Math.max(-0.3, Math.min(1.05, p.pitch));
    this.touch.look.x = 0;
    this.touch.look.y = 0;

    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const wishX = (-sin * forward + cos * strafe) * p.speed;
    const wishZ = (-cos * forward - sin * strafe) * p.speed;

    p.velocity.y += GRAVITY * dt;
    if (jump && p.grounded && p.canJump) {
      p.velocity.y = p.jumpSpeed;
      p.grounded = false;
      this.audio.play("jump");
    }

    const beforeX = p.position.x;
    const beforeZ = p.position.z;
    this._moveAxis("x", wishX * dt);
    this._moveAxis("z", wishZ * dt);
    this._moveAxis("y", p.velocity.y * dt);

    // The invisible fence keeps her inside the pretty part of the world.
    const r = Math.hypot(p.position.x, p.position.z);
    if (r > this.worldBounds) {
      p.position.x *= this.worldBounds / r;
      p.position.z *= this.worldBounds / r;
    }

    // Falling off the world is never fatal — she just gets put back.
    if (p.position.y < -18) this.respawn();

    const moved = Math.hypot(p.position.x - beforeX, p.position.z - beforeZ);
    if (p.grounded) {
      this._walked += moved;
      if (this._walked >= STEP_DISTANCE) {
        this._walked = 0;
        this.audio.footstep();
      }
    }

    this._animateCharacter(dt, moved / Math.max(dt, 0.0001));
    this._updateCamera();
  }

  _animateCharacter(dt, speed) {
    const time = performance.now() / 1000;
    const p = this.player;

    // The character stands at the player's feet and faces the way she walks.
    this.avatar.position.set(p.position.x, p.position.y - EYE_HEIGHT, p.position.z);
    this.avatar.rotation.y = p.yaw;

    const anim = this.avatar.userData.animation;
    const stride = Math.min(1, speed / this.player.speed);
    const swing = Math.sin(time * 9) * 0.55 * stride;
    anim.legs[0].rotation.x = swing;
    anim.legs[1].rotation.x = -swing;
    anim.arms[0].rotation.x = -swing * 0.8;
    anim.arms[1].rotation.x = swing * 0.8;
    anim.torso.position.y = 0.72 + Math.abs(Math.sin(time * 9)) * 0.03 * stride;
    if (!p.grounded) {
      anim.arms[0].rotation.x = -1.9;
      anim.arms[1].rotation.x = -1.9;
    }

    if (this.companion) {
      // Trails behind and to the side, bobbing along.
      const target = new THREE.Vector3(
        p.position.x + Math.sin(p.yaw + 0.9) * 1.5,
        p.position.y - EYE_HEIGHT + 0.55 + Math.sin(time * 3) * 0.1,
        p.position.z + Math.cos(p.yaw + 0.9) * 1.5,
      );
      this.companion.position.lerp(target, Math.min(1, dt * 3.4));
      this.companion.rotation.y = p.yaw;
      const wings = this.companion.userData.wings;
      if (wings) {
        wings[0].rotation.z = Math.sin(time * 14) * 0.7;
        wings[1].rotation.z = -Math.sin(time * 14) * 0.7;
      }
    }
  }

  _updateCamera() {
    const p = this.player;
    const focus = new THREE.Vector3(p.position.x, p.position.y - 0.15, p.position.z);

    const cosPitch = Math.cos(p.pitch);
    const dir = new THREE.Vector3(
      Math.sin(p.yaw) * cosPitch,
      Math.sin(p.pitch),
      Math.cos(p.yaw) * cosPitch,
    );

    // Pull the camera in if a wall would come between it and her, so she is
    // never hidden behind maze walls or platforms.
    let distance = CAMERA_DISTANCE;
    const probe = new THREE.Vector3();
    for (let s = 0.35; s <= 1; s += 0.1) {
      probe.copy(focus).addScaledVector(dir, CAMERA_DISTANCE * s);
      probe.y += CAMERA_HEIGHT * s;
      if (this.solids.some((box) => box.containsPoint(probe))) {
        distance = CAMERA_DISTANCE * Math.max(0.32, s - 0.12);
        break;
      }
    }

    this.camera.position.copy(focus).addScaledVector(dir, distance);
    this.camera.position.y += CAMERA_HEIGHT * (distance / CAMERA_DISTANCE);
    this.camera.lookAt(focus.x, focus.y + 0.35, focus.z);
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.player;
    p.position[axis] += delta;

    const box = this._playerBox();
    for (const solid of this.solids) {
      if (!solid.intersectsBox(box)) continue;
      if (axis === "y") {
        if (delta < 0) {
          p.position.y = solid.max.y + EYE_HEIGHT;
          p.grounded = true;
        } else {
          p.position.y = solid.min.y - (EYE_HEIGHT - PLAYER_HALF);
        }
        p.velocity.y = 0;
      } else {
        p.position[axis] -= delta; // Walls simply stop her; no sliding jitter.
      }
      return;
    }

    if (axis === "y") {
      const floor = EYE_HEIGHT;
      if (p.position.y <= floor) {
        p.position.y = floor;
        p.velocity.y = 0;
        p.grounded = true;
      } else if (delta < 0) {
        p.grounded = false;
      }
    }
  }

  _playerBox() {
    const p = this.player.position;
    return new THREE.Box3(
      new THREE.Vector3(p.x - PLAYER_HALF, p.y - EYE_HEIGHT, p.z - PLAYER_HALF),
      new THREE.Vector3(p.x + PLAYER_HALF, p.y + PLAYER_HALF, p.z + PLAYER_HALF),
    );
  }

  _frame() {
    const now = performance.now();
    const dt = Math.min((now - this._lastFrame) / 1000, 0.05);
    this._lastFrame = now;
    if (!this._won) {
      this._step(dt);
      for (const fn of this._updaters) fn(dt, this);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------- public API

  onUpdate(fn) { this._updaters.push(fn); }

  addSolid(object3d) {
    object3d.updateMatrixWorld(true);
    this.solids.push(new THREE.Box3().setFromObject(object3d));
    return object3d;
  }

  respawn() {
    const p = this.player;
    p.position.set(this.startPosition[0], this.startPosition[1] + EYE_HEIGHT, this.startPosition[2]);
    p.velocity.set(0, 0, 0);
  }

  setGoal(text) { this.ui.goal.textContent = text; }
  setScore(have, total) {
    this.ui.score.textContent = total ? `${have} / ${total}` : String(have);
    this.ui.score.parentElement.hidden = false;
  }
  win(message) {
    if (this._won) return;
    this._won = true;
    this.audio.play("win");
    this.ui.showWin(message, this.avatarConfig.name);
  }
  get playerPosition() { return this.player.position; }
}

// ------------------------------------------------------------- game config

async function loadGameConfig() {
  const fallback = {
    worldId: "placeholder",
    worldFile: "world.ply",
    worldName: "Practice World",
    studioName: "",
    mood: "bright",
    styleId: "",
    characterArt: null,
  };
  try {
    const response = await fetch("./game-config.json", { cache: "no-store" });
    if (!response.ok) return fallback;
    return { ...fallback, ...(await response.json()) };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------- UI

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildUI(title, howTo, studioName) {
  const root = el("div", "studio-root");
  const canvasHolder = el("div", "canvas-holder");
  root.appendChild(canvasHolder);

  const hud = el("div", "hud");
  const titleEl = el("div", "hud-title", title);
  const goal = el("div", "hud-goal", "");
  const scoreWrap = el("div", "hud-score-wrap");
  scoreWrap.hidden = true;
  scoreWrap.appendChild(el("span", "hud-star", "⭐"));
  const score = el("span", "hud-score", "0");
  scoreWrap.appendChild(score);
  hud.append(titleEl, goal, scoreWrap);
  root.appendChild(hud);

  const helpBtn = el("button", "big-btn help-btn", "?");
  helpBtn.setAttribute("aria-label", "How to play");
  root.appendChild(helpBtn);

  const muteBtn = el("button", "big-btn mute-btn", "🔊");
  muteBtn.setAttribute("aria-label", "Turn the sound on or off");
  root.appendChild(muteBtn);

  const helpPanel = el("div", "panel help-panel");
  helpPanel.hidden = true;
  helpPanel.appendChild(el("h2", null, "How to play"));
  const list = el("ul");
  for (const line of howTo) list.appendChild(el("li", null, line));
  list.appendChild(el("li", null, "Tap the speaker button any time to turn the sound on or off."));
  helpPanel.appendChild(list);
  const closeHelp = el("button", "big-btn", "Got it!");
  helpPanel.appendChild(closeHelp);
  root.appendChild(helpPanel);
  helpBtn.addEventListener("click", () => { helpPanel.hidden = !helpPanel.hidden; });
  closeHelp.addEventListener("click", () => { helpPanel.hidden = true; });

  // Touch controls: a thumb-stick on the left, a jump button on the right.
  const stick = el("div", "stick");
  const stickNub = el("div", "stick-nub");
  stick.appendChild(stickNub);
  root.appendChild(stick);
  const jumpBtn = el("button", "big-btn jump-btn", "JUMP");
  root.appendChild(jumpBtn);

  const loading = el("div", "overlay loading");
  loading.appendChild(el("div", "spinner"));
  loading.appendChild(el("h2", null, "Building your world…"));
  const bar = el("div", "bar");
  const barFill = el("div", "bar-fill");
  bar.appendChild(barFill);
  loading.appendChild(bar);
  loading.appendChild(el("p", null, "This takes a few seconds. It's worth it!"));
  const characterArt = el("img", "character-art");
  characterArt.alt = "";
  characterArt.hidden = true;
  loading.appendChild(characterArt);
  root.appendChild(loading);

  const win = el("div", "overlay win");
  win.hidden = true;
  win.appendChild(el("div", "win-emoji", "🎉"));
  const winTitle = el("h1", null, "YOU DID IT!");
  const winMsg = el("p", "win-msg", "");
  win.append(winTitle, winMsg);
  const again = el("button", "big-btn", "Play again");
  again.addEventListener("click", () => window.location.reload());
  win.appendChild(again);
  root.appendChild(win);

  if (studioName) root.appendChild(el("div", "studio-stamp", studioName));

  return {
    root, canvasHolder, goal, score, stick, stickNub, jumpBtn, muteBtn,
    setLoadProgress(fraction) {
      barFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    },
    /** Shows her character in this world's style, if that art exists. */
    setCharacterArt(url) {
      characterArt.onload = () => { characterArt.hidden = false; };
      characterArt.onerror = () => { characterArt.hidden = true; };
      characterArt.src = url;
    },
    setMuted(muted) {
      muteBtn.textContent = muted ? "🔇" : "🔊";
      muteBtn.classList.toggle("muted", muted);
    },
    hideLoading() { loading.hidden = true; },
    showWorldError() {
      loading.innerHTML = "";
      loading.appendChild(el("div", "win-emoji", "🐧"));
      loading.appendChild(el("h2", null, "This world didn't want to load!"));
      loading.appendChild(el("p", null, "Nothing is broken and nothing is lost. Try refreshing the page, or ask Claude for help."));
    },
    showWin(message, name) {
      winTitle.textContent = name ? `YOU DID IT, ${name.toUpperCase()}!` : "YOU DID IT!";
      winMsg.textContent = message;
      win.hidden = false;
    },
  };
}

// ---------------------------------------------------------- touch controls

function bindTouchControls(ui, touch, canvas) {
  const LOOK_SENSITIVITY = 0.0032;
  let stickId = null;
  let stickOrigin = { x: 0, y: 0 };
  const RADIUS = 52;

  const startStick = (event) => {
    const t = event.changedTouches ? event.changedTouches[0] : event;
    stickId = t.identifier ?? "mouse";
    stickOrigin = { x: t.clientX, y: t.clientY };
    ui.stick.classList.add("active");
    event.preventDefault();
  };
  const moveStick = (event) => {
    if (stickId === null) return;
    const touches = event.changedTouches ? Array.from(event.changedTouches) : [event];
    const t = touches.find((x) => (x.identifier ?? "mouse") === stickId);
    if (!t) return;
    const dx = Math.max(-RADIUS, Math.min(RADIUS, t.clientX - stickOrigin.x));
    const dy = Math.max(-RADIUS, Math.min(RADIUS, t.clientY - stickOrigin.y));
    ui.stickNub.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.move.x = dx / RADIUS;
    touch.move.y = -dy / RADIUS;
    event.preventDefault();
  };
  const endStick = () => {
    stickId = null;
    touch.move.x = 0;
    touch.move.y = 0;
    ui.stickNub.style.transform = "translate(0px, 0px)";
    ui.stick.classList.remove("active");
  };

  ui.stick.addEventListener("touchstart", startStick, { passive: false });
  ui.stick.addEventListener("touchmove", moveStick, { passive: false });
  ui.stick.addEventListener("touchend", endStick);
  ui.stick.addEventListener("touchcancel", endStick);
  ui.stick.addEventListener("mousedown", startStick);
  window.addEventListener("mousemove", moveStick);
  window.addEventListener("mouseup", endStick);

  ui.jumpBtn.addEventListener("touchstart", (e) => { touch.jump = true; e.preventDefault(); }, { passive: false });
  ui.jumpBtn.addEventListener("click", () => { touch.jump = true; });

  // Dragging anywhere on the scene swings the camera around her — the same
  // gesture on mouse and finger, so there is only one thing to learn.
  let lookId = null;
  let last = { x: 0, y: 0 };
  const startLook = (event) => {
    const t = event.changedTouches ? event.changedTouches[0] : event;
    lookId = t.identifier ?? "mouse";
    last = { x: t.clientX, y: t.clientY };
  };
  const moveLook = (event) => {
    if (lookId === null) return;
    const touches = event.changedTouches ? Array.from(event.changedTouches) : [event];
    const t = touches.find((x) => (x.identifier ?? "mouse") === lookId);
    if (!t) return;
    touch.look.x += (t.clientX - last.x) * LOOK_SENSITIVITY;
    touch.look.y += (t.clientY - last.y) * LOOK_SENSITIVITY;
    last = { x: t.clientX, y: t.clientY };
    event.preventDefault();
  };
  const endLook = () => { lookId = null; };

  canvas.addEventListener("touchstart", startLook, { passive: false });
  canvas.addEventListener("touchmove", moveLook, { passive: false });
  canvas.addEventListener("touchend", endLook);
  canvas.addEventListener("mousedown", startLook);
  canvas.addEventListener("mousemove", moveLook);
  window.addEventListener("mouseup", endLook);
}

export { THREE };
