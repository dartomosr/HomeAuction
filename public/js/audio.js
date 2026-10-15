import { store } from './store.js';

function initAudio() {
  if (!store.audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) store.audioCtx = new AudioContextClass();
  }
  if (store.audioCtx && store.audioCtx.state === 'suspended') {
    store.audioCtx.resume();
  }
}

function playTickSound() {
  if (!store.soundEnabled || !store.audioCtx) return;
  try {
    const osc = store.audioCtx.createOscillator();
    const gain = store.audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, store.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, store.audioCtx.currentTime + 0.035);

    gain.gain.setValueAtTime(0.16, store.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, store.audioCtx.currentTime + 0.035);

    osc.connect(gain);
    gain.connect(store.audioCtx.destination);
    osc.start();
    osc.stop(store.audioCtx.currentTime + 0.04);
  } catch (_) {}
}

function playEliminatedSound() {
  if (!store.soundEnabled || !store.audioCtx) return;
  try {
    const now = store.audioCtx.currentTime;
    const osc = store.audioCtx.createOscillator();
    const gain = store.audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.35);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(store.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch (_) {}
}

function playWinnerFanfare() {
  if (!store.soundEnabled || !store.audioCtx) return;
  try {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const now = store.audioCtx.currentTime + idx * 0.11;
      const osc = store.audioCtx.createOscillator();
      const gain = store.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(store.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    });
  } catch (_) {}
}

function playFxTone(effect) {
  if (!store.soundEnabled || !store.audioCtx || effect === 'fold') return;
  try {
    const now = store.audioCtx.currentTime;
    if (['glass', 'shot', 'blast', 'bubble', 'slash'].includes(effect)) {
      const duration = effect === 'glass' ? .32 : effect === 'blast' ? .49 : .17;
      const sampleRate = store.audioCtx.sampleRate;
      const buffer = store.audioCtx.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
      const channel = buffer.getChannelData(0);
      let smoothed = 0;
      for (let i = 0; i < channel.length; i++) {
        const t = i / sampleRate;
        const noise = (Math.random() * 2 - 1);
        smoothed = smoothed * .74 + noise * .26;
        const envelope = Math.pow(1 - t / duration, effect === 'glass' ? 3.4 : 1.8);
        channel[i] = (noise * .55 + smoothed * .45) * envelope;
      }
      const noiseSource = store.audioCtx.createBufferSource();
      noiseSource.buffer = buffer;
      const filter = store.audioCtx.createBiquadFilter();
      filter.type = effect === 'glass' ? 'highpass' : 'lowpass';
      filter.frequency.value = effect === 'glass' ? 1700 : effect === 'shot' ? 1800 : 600;
      const gain = store.audioCtx.createGain();
      gain.gain.value = effect === 'glass' ? .055 : effect === 'shot' ? .075 : .065;
      noiseSource.connect(filter); filter.connect(gain); gain.connect(store.audioCtx.destination);
      noiseSource.start(now); noiseSource.stop(now + duration);
    }
    if (effect === 'glass') {
      [830, 1230, 1910, 2560].forEach((frequency, i) => {
        const start = now + i * .024;
        const osc = store.audioCtx.createOscillator();
        const gain = store.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.018, start);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .19 + i * .04);
        osc.connect(gain); gain.connect(store.audioCtx.destination);
        osc.start(start); osc.stop(start + .23 + i * .04);
      });
    }
  } catch (_) {}
}

export { initAudio, playTickSound, playEliminatedSound, playWinnerFanfare, playFxTone };
