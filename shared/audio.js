/**
 * Game sound: one looping music bed matched to the world's style, plus effects.
 *
 * Everything is a locally bundled WAV synthesised by scripts/make-audio.mjs, so
 * there are no licences and nothing is fetched from the internet.
 *
 * Browsers block audio until the player interacts with the page, so the context
 * stays suspended until the first tap or key press and then resumes itself.
 */
const MOODS = ["bright", "mysterious", "watery", "spooky", "spacey"];
const SFX = ["jump", "collect", "win", "splash", "step", "place", "undo"];
const STORAGE_KEY = "studio-muted";

export class GameAudio {
  constructor(basePath = "../../assets/audio") {
    this.basePath = basePath;
    this.buffers = new Map();
    this.context = null;
    this.musicSource = null;
    this.ready = false;
    this.muted = this.#readMuted();
  }

  #readMuted() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  #saveMuted() {
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? "1" : "0");
    } catch {
      // Private browsing; the setting just won't persist.
    }
  }

  /** Loads the mood's music bed and every effect. Never throws. */
  async load(mood = "bright") {
    this.mood = MOODS.includes(mood) ? mood : "bright";
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.context = new AudioCtx();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.context.destination);

      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0.34;
      this.musicGain.connect(this.master);

      this.sfxGain = this.context.createGain();
      this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.master);

      const names = [`music-${this.mood}`, ...SFX.map((s) => `sfx-${s}`)];
      await Promise.all(
        names.map(async (name) => {
          try {
            const response = await fetch(`${this.basePath}/${name}.wav`);
            if (!response.ok) return;
            this.buffers.set(name, await this.context.decodeAudioData(await response.arrayBuffer()));
          } catch {
            // A missing sound is not worth interrupting her game for.
          }
        }),
      );
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  /** Called on her first tap or key press, which is when browsers allow audio. */
  unlock() {
    if (!this.context || this.unlocked) return;
    this.unlocked = true;
    this.context.resume?.().catch(() => {});
    this.startMusic();
  }

  startMusic() {
    if (!this.ready || this.musicSource) return;
    const buffer = this.buffers.get(`music-${this.mood}`);
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.musicGain);
    source.start(0);
    this.musicSource = source;
  }

  play(name) {
    if (!this.ready || this.muted || !this.unlocked) return;
    const buffer = this.buffers.get(`sfx-${name}`);
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxGain);
    source.start(0);
  }

  /** The footstep sound depends on the world: a reef should splash. */
  footstep() {
    this.play(this.mood === "watery" ? "splash" : "step");
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.context.currentTime, 0.02);
    }
    this.#saveMuted();
    return this.muted;
  }
}
