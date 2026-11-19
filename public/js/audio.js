// All sounds are synthesised with Web Audio, so there are no audio files to download.
export class Sfx {
  constructor() { this.ctx = null; this.listener = { x: 0, y: 0, z: 0, yaw: 0 }; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setListener(x, y, z, yaw) { Object.assign(this.listener, { x, y, z, yaw }); }

  // gain, pan and muffling from a world position
  space(pos) {
    if (!pos) return { gain: 1, pan: 0, dist: 0 };
    const L = this.listener;
    const dx = pos[0] - L.x, dz = pos[2] - L.z, dy = pos[1] - L.y;
    const dist = Math.hypot(dx, dy, dz);
    // right vector of the listener: (cos yaw, 0, -sin yaw)
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = dist > 0.1 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) : 0;
    return { gain: 1 / (1 + dist / 9), pan: pan * 0.8, dist };
  }

  chain(pos, extraGain = 1, cutoff = 18000) {
    const c = this.ctx;
    const sp = this.space(pos);
    const g = c.createGain(); g.gain.value = sp.gain * extraGain;
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = Math.min(cutoff, 16000 / (1 + sp.dist / 18));
    const p = c.createStereoPanner(); p.pan.value = sp.pan;
    g.connect(f); f.connect(p); p.connect(this.master);
    return g;
  }

  noiseBurst(dest, t0, dur, gain, type, freq, q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }

  tone(dest, t0, dur, gain, f0, f1, type = 'sine') {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  shot(weapon, pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (weapon === 'sniper') return this.sniperShot(pos);
    const rifle = weapon === 'rifle';
    const out = this.chain(pos, rifle ? 1 : 0.8);
    this.noiseBurst(out, t, rifle ? 0.16 : 0.12, 1.0, 'lowpass', rifle ? 5200 : 6500);
    this.noiseBurst(out, t, 0.05, 0.9, 'highpass', 2500);
    this.tone(out, t, 0.12, rifle ? 0.9 : 0.6, rifle ? 140 : 190, 45);
    // tail / slap-back off the walls
    this.noiseBurst(out, t + 0.03, rifle ? 0.7 : 0.5, 0.22, 'lowpass', 900);
  }

  sniperShot(pos) {
    const t = this.ctx.currentTime;
    const out = this.chain(pos, 1.3);
    this.noiseBurst(out, t, 0.28, 1.0, 'lowpass', 4200);
    this.noiseBurst(out, t, 0.06, 1.0, 'highpass', 2000);
    this.tone(out, t, 0.3, 1.0, 95, 32);
    this.noiseBurst(out, t + 0.05, 1.6, 0.3, 'lowpass', 650); // long rolling echo
    if (!pos) { // bolt cycle for your own shots
      this.noiseBurst(this.chain(null, 0.5), t + 0.45, 0.05, 0.8, 'bandpass', 2400, 3);
      this.noiseBurst(this.chain(null, 0.5), t + 0.7, 0.05, 0.9, 'bandpass', 3200, 4);
    }
  }

  swing(heavy, pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(heavy ? 600 : 1200, t); f.frequency.exponentialRampToValueAtTime(heavy ? 1800 : 3600, t + 0.15);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(f); f.connect(g); g.connect(this.chain(pos, 0.7));
    src.start(t); src.stop(t + 0.3);
  }

  footstep(pos, loud = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.chain(pos, loud, 6000);
    this.noiseBurst(out, t, 0.07, 0.6, 'bandpass', 700 + Math.random() * 400, 1.2);
    this.tone(out, t, 0.05, 0.25, 90, 50);
  }

  reload(dur) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.chain(null, 0.6);
    this.noiseBurst(out, t + 0.15, 0.04, 0.7, 'bandpass', 3000, 3);
    this.noiseBurst(out, t + dur * 0.55, 0.05, 0.8, 'bandpass', 2200, 3);
    this.noiseBurst(out, t + dur * 0.85, 0.04, 0.9, 'bandpass', 3500, 4);
  }

  hit(head, kill) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.chain(null, 0.5);
    if (head) { this.tone(out, t, 0.18, 0.5, 2600, 2500); this.tone(out, t, 0.25, 0.3, 3900, 3800); }
    else this.tone(out, t, 0.05, 0.4, 1600, 1400, 'triangle');
    if (kill) { this.tone(out, t + 0.06, 0.25, 0.4, 880, 860, 'triangle'); this.tone(out, t + 0.14, 0.3, 0.35, 1320, 1300, 'triangle'); }
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.chain(null, 0.7);
    this.tone(out, t, 0.2, 0.8, 120, 50);
    this.noiseBurst(out, t, 0.12, 0.4, 'lowpass', 600);
  }

  smoke(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.chain(pos, 0.8);
    this.tone(out, t, 0.15, 0.6, 200, 60);
    this.noiseBurst(out, t, 1.8, 0.5, 'lowpass', 1800);
  }

  boom(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this.chain(pos, 1.6, 9000);
    this.noiseBurst(out, t, 0.5, 1.0, 'lowpass', 2600);
    this.tone(out, t, 0.6, 1.0, 85, 28);
    this.noiseBurst(out, t + 0.04, 1.8, 0.45, 'lowpass', 500);  // rumble
    this.noiseBurst(out, t + 0.1, 0.5, 0.25, 'highpass', 3000); // debris
  }

  pad() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this.chain(null, 0.5);
    this.tone(out, t, 0.45, 0.5, 180, 900, 'sawtooth');
    this.noiseBurst(out, t, 0.5, 0.4, 'bandpass', 1500, 0.8);
  }

  dash() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(f); f.connect(g); g.connect(this.chain(null, 0.6));
    src.start(t); src.stop(t + 0.35);
  }

  dry() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.chain(null, 0.4), t, 0.03, 0.8, 'bandpass', 4000, 5);
  }

  beep(f = 880) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.chain(null, 0.3), t, 0.15, 0.4, f, f, 'square');
  }
}
