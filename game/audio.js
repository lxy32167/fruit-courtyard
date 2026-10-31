import { readStorage, writeStorage } from './storage.js';

export class GameAudio {
  constructor() {
    this.enabled = readStorage('sound', true) === true;
    this.musicEnabled = readStorage('music', false) === true;
    this.context = null;
    this.buffers = new Map();
    this.pending = new Map();
    this.music = new Audio('assets/audio/music.wav');
    this.music.preload = 'none';
    this.music.loop = true;
    this.music.volume = .16;
    this.playing = false;
  }

  async unlock() {
    try {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.context = new AudioContext();
      }
      if (this.context?.state === 'suspended') await this.context.resume();
      if (this.enabled) ['drop', 'merge', 'merge-large', 'lose', 'watermelon', 'button', 'bomb', 'tidy', 'upgrade', 'shake'].forEach(name => this.load(name));
      this.syncMusic();
    } catch { /* The game still works when audio is unavailable. */ }
  }

  async load(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (!this.context) return null;
    if (!this.pending.has(name)) {
      this.pending.set(name, (async () => {
        try {
          const response = await fetch(`assets/audio/${name}.wav`);
          if (!response.ok) return null;
          const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(name, buffer);
          return buffer;
        } catch { return null; }
      })());
    }
    return this.pending.get(name);
  }

  play(name, volume = .45) {
    if (!this.enabled || this.context?.state !== 'running') return;
    const buffer = this.buffers.get(name);
    if (!buffer) { this.load(name); return; }
    try {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain).connect(this.context.destination);
      source.start();
    } catch { /* Audio interruption must never interrupt gameplay. */ }
  }

  toggleSound() {
    this.enabled = !this.enabled;
    writeStorage('sound', this.enabled);
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    writeStorage('music', this.musicEnabled);
    this.syncMusic();
    return this.musicEnabled;
  }

  setPlaying(playing) { this.playing = playing; this.syncMusic(); }

  syncMusic() {
    if (this.musicEnabled && this.playing && !document.hidden) this.music.play().catch(() => {});
    else this.music.pause();
  }
}
