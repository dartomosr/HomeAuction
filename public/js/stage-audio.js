const STORAGE_KEY = 'homeauction-stage-muted';

// Independent of the player store: the screen never initializes participant controls.
export class StageSound {
  constructor({ storage, contextFactory } = {}) {
    try { this.storage = storage === undefined ? globalThis.localStorage : storage; } catch { this.storage = null; }
    this.contextFactory = contextFactory || (() => new (window.AudioContext || window.webkitAudioContext)());
    this.muted = false;
    try { this.muted = this.storage?.getItem(STORAGE_KEY) === 'true'; } catch { /* Private storage can be disabled. */ }
    this.active = true;
    this.context = null;
    this.lastPlayed = new Map();
    this.voices = 0;
    this.onChange = () => {};
  }

  async unlock() {
    if (this.muted) return;
    try {
      if (!this.context) {
        const ctx = this.context = this.contextFactory();
        this.master = ctx.createGain();
        this.master.gain.value = this.active ? .5 : 0;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 18;
        compressor.ratio.value = 3;
        this.master.connect(compressor).connect(ctx.destination);
        const reverb = ctx.createConvolver();
        const impulse = ctx.createBuffer(2, ctx.sampleRate * .9, ctx.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const samples = impulse.getChannelData(channel);
          for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 3;
        }
        reverb.buffer = impulse;
        const wet = ctx.createGain();
        wet.gain.value = .16;
        reverb.connect(wet).connect(this.master);
        this.reverb = reverb;
        ctx.onstatechange = () => this.onChange();
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* A browser may require a click before enabling audio. */ }
    this.onChange();
  }

  setMuted(muted) {
    this.muted = muted;
    try { this.storage?.setItem(STORAGE_KEY, String(muted)); } catch { /* Keep the session preference. */ }
    this.updateGain();
    this.onChange();
    if (!muted) void this.unlock();
  }

  setActive(active) { this.active = active; this.updateGain(); }

  updateGain() {
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.active && !this.muted ? .5 : 0, this.context.currentTime, .025);
    }
  }

  note(frequency, delay = 0, duration = .5, volume = .16, pan = 0, endFrequency = frequency) {
    const ctx = this.context;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = pan;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration * .7);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + .018);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(envelope).connect(stereo);
    stereo.connect(this.master);
    stereo.connect(this.reverb);
    this.voices++;
    oscillator.onended = () => { this.voices--; oscillator.disconnect(); envelope.disconnect(); stereo.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  tick(speed = .5, duel = false) {
    const ctx = this.context;
    if (this.muted || !this.active || !ctx || ctx.state !== 'running' || this.voices > 12) return false;
    if (ctx.currentTime - (this.lastPlayed.get('tick') ?? -Infinity) < .035) return false;
    this.lastPlayed.set('tick', ctx.currentTime);
    const frequency = (duel ? 170 : 300) + Math.max(0, Math.min(1, speed)) * 450;
    this.note(frequency, 0, .055, duel ? .17 : .13, .1, frequency * .55);
    return true;
  }

  play(kind) {
    const ctx = this.context;
    if (this.muted || !this.active || !ctx || ctx.state !== 'running' || this.voices > 12) return false;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(kind) ?? -Infinity) < .16) return false;
    this.lastPlayed.set(kind, now);
    if (kind === 'elimination') {
      this.note(110, 0, .85, .28, 0, 45);
      this.note(330, .025, .45, .10, -.15, 85);
    } else if (kind === 'countdown') {
      this.note(440, 0, .15, .12, 0, 330);
    } else if (kind === 'page') {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * .38, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = .7;
      filter.frequency.setValueAtTime(700, now);
      filter.frequency.exponentialRampToValueAtTime(2400, now + .32);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(.12, now + .1);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .37);
      noise.connect(filter).connect(gain).connect(this.master);
      noise.onended = () => { noise.disconnect(); filter.disconnect(); gain.disconnect(); };
      noise.start(now);
      noise.stop(now + .38);
    } else if (kind === 'up') {
      this.note(660, 0, .3, .17, -.25, 880);
      this.note(1320, .07, .4, .07, .3);
    } else if (kind === 'down') {
      this.note(330, 0, .42, .2, .15, 220);
      this.note(165, .04, .5, .08, -.2);
    } else {
      const notes = kind === 'all-ready' ? [523.25, 659.25, 783.99, 1046.5]
        : kind === 'ready' ? [440, 554.37, 659.25] : [392, 493.88, 587.33];
      notes.forEach((frequency, i) => this.note(frequency, i * .045, kind === 'all-ready' ? .95 : .55, .13, (i - 1) * .3));
    }
    return true;
  }
}
