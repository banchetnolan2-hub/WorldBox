// AUDIO — musiques et effets 100 % générés en direct (Web Audio) : aucun fichier sous droits.
// Pistes : MENU (calme), SIMULATION (dynamique), FIN ; variations lors des événements importants.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// accords (notes MIDI)
const CH = {
  Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62], Dm: [50, 53, 57], Bb: [46, 50, 53],
  Em: [52, 55, 59], E: [52, 56, 59], D: [50, 54, 57],
};

const TRACKS = {
  menu: { bpm: 70, prog: ['Am', 'F', 'C', 'G'], bars: 1, pad: 0.16, arp: 0.07, bass: 0.0, drums: 0, arpPattern: [0, 2, 1, 2, 0, 1, 2, 1] },
  sim: { bpm: 112, prog: ['Dm', 'Bb', 'F', 'C'], bars: 1, pad: 0.07, arp: 0.06, bass: 0.13, drums: 1, arpPattern: [0, 1, 2, 1, 0, 2, 1, 2] },
  tension: { bpm: 124, prog: ['Em', 'C', 'D', 'Em'], bars: 1, pad: 0.08, arp: 0.07, bass: 0.15, drums: 2, arpPattern: [0, 2, 0, 1, 0, 2, 1, 2] },
  end: { bpm: 84, prog: ['C', 'G', 'Am', 'F'], bars: 1, pad: 0.15, arp: 0.09, bass: 0.08, drums: 0, arpPattern: [0, 1, 2, 1, 2, 1, 0, 2] },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.settings = { music: 0.6, sfx: 0.7, mute: false };
    this.track = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.lastCapture = 0;
    this.intensity = 0;
  }

  // le contexte audio démarre au premier clic (règle des navigateurs)
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    // réverbération légère (échos filtrés)
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.28;
    const fb = this.ctx.createGain(); fb.gain.value = 0.28;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.musicBus.connect(this.master);
    this.musicBus.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(this.master);
    this.sfxBus.connect(this.master);
    this.noise = this._noiseBuffer();
    this.apply();
    if (this.pendingTrack) this.play(this.pendingTrack);
  }

  _noiseBuffer() {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    return b;
  }

  setSettings(s) { Object.assign(this.settings, s); this.apply(); }
  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.mute ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.9, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
  }

  play(name) {
    if (!this.ctx) { this.pendingTrack = name; return; }
    if (this.trackName === name) return;
    this.trackName = name;
    this.track = TRACKS[name];
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), 30);
  }

  stop() { this.trackName = null; this.track = null; }

  // ---------- séquenceur ----------
  _schedule() {
    if (!this.ctx || !this.track) return;
    const tr = this.track;
    const sixteenth = 60 / tr.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this._playStep(tr, this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  _playStep(tr, step, t, dur16) {
    const barLen = 16 * tr.bars;
    const chordName = tr.prog[Math.floor(step / barLen) % tr.prog.length];
    const chord = CH[chordName];
    const pos = step % 16;
    if (step % barLen === 0 && tr.pad) {
      for (const n of chord) this._pad(NOTE(n), t, dur16 * barLen, tr.pad);
    }
    if (tr.arp && pos % 2 === 0) {
      const idx = tr.arpPattern[(pos / 2) % tr.arpPattern.length];
      const oct = pos >= 8 && tr.drums ? 24 : 12;
      this._pluck(NOTE(chord[idx] + oct), t, dur16 * 3, tr.arp * (0.7 + (this.intensity || 0) * 0.5));
    }
    if (tr.bass && (pos % 4 === 0 || (tr.drums && pos % 4 === 2))) {
      this._bass(NOTE(chord[0] - 12), t, dur16 * 1.8, tr.bass);
    }
    if (tr.drums) {
      if (pos === 0 || pos === 8 || (tr.drums > 1 && pos === 10)) this._kick(t, 0.5);
      if (pos === 4 || pos === 12) this._snare(t, 0.22);
      if (pos % 2 === 0) this._hat(t, pos % 4 === 2 ? 0.06 : 0.035);
      if (tr.drums > 1 && pos % 2 === 1) this._hat(t, 0.025);
    }
  }

  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _pad(f, t, len, vol) {
    const c = this.ctx;
    const g = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    for (const det of [-6, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + len + 0.5);
    }
    lp.connect(g); g.connect(this.musicBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.25, t + len * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.4);
  }

  _pluck(f, t, len, vol) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = c.createGain();
    o.connect(g); g.connect(this.musicBus);
    this._env(g, t, 0.005, vol, len);
    o.start(t); o.stop(t + len + 0.05);
  }

  _bass(f, t, len, vol) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(200, t + len);
    const g = c.createGain();
    o.connect(lp); lp.connect(g); g.connect(this.musicBus);
    this._env(g, t, 0.01, vol, len);
    o.start(t); o.stop(t + len + 0.05);
  }

  _kick(t, vol) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = c.createGain();
    o.connect(g); g.connect(this.musicBus);
    this._env(g, t, 0.003, vol, 0.25);
    o.start(t); o.stop(t + 0.3);
  }

  _noiseHit(t, vol, type, freq, len, bus) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain();
    s.connect(f); f.connect(g); g.connect(bus || this.musicBus);
    this._env(g, t, 0.002, vol, len);
    s.start(t, Math.random() * 0.5); s.stop(t + len + 0.05);
  }
  _snare(t, vol) { this._noiseHit(t, vol, 'bandpass', 1800, 0.14); }
  _hat(t, vol) { this._noiseHit(t, vol, 'highpass', 7000, 0.04); }

  // ---------- effets ----------
  sfx(name) {
    if (!this.ctx || this.settings.mute) return;
    const c = this.ctx, t = c.currentTime;
    const tone = (f, len, vol, type = 'sine', delay = 0, slide = null) => {
      const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t + delay);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + delay + len);
      const g = c.createGain();
      o.connect(g); g.connect(this.sfxBus);
      this._env(g, t + delay, 0.005, vol, len);
      o.start(t + delay); o.stop(t + delay + len + 0.05);
    };
    switch (name) {
      case 'click': tone(880, 0.06, 0.08, 'triangle'); break;
      case 'capture':
        if (t - this.lastCapture < 0.12) return;
        this.lastCapture = t;
        tone(1200 + Math.random() * 400, 0.05, 0.025, 'sine');
        break;
      case 'event': // variation sonore : accord montant
        tone(NOTE(62), 0.35, 0.09, 'triangle'); tone(NOTE(66), 0.35, 0.08, 'triangle', 0.07); tone(NOTE(69), 0.5, 0.09, 'triangle', 0.14);
        this._noiseHit(t, 0.05, 'bandpass', 900, 0.4, this.sfxBus);
        break;
      case 'bad':
        tone(NOTE(50), 0.5, 0.1, 'sawtooth', 0, NOTE(43));
        break;
      case 'ship': tone(110, 0.6, 0.06, 'sawtooth'); tone(112, 0.6, 0.05, 'sawtooth'); break;
      case 'plane': this._noiseHit(t, 0.05, 'bandpass', 600, 0.9, this.sfxBus); break;
      case 'eliminated': tone(NOTE(45), 0.9, 0.14, 'sine', 0, NOTE(33)); this._noiseHit(t, 0.1, 'lowpass', 300, 0.8, this.sfxBus); break;
      case 'victory':
        [60, 64, 67, 72].forEach((n, k) => tone(NOTE(n), 0.8, 0.09, 'triangle', k * 0.12));
        break;
      default: break;
    }
  }
}

export const audio = new AudioEngine();
