"use strict";
// Procedural Web Audio sound synthesizer for Justin Fixes the House.
const SFX = (() => {
  let ctx = null;
  let noiseBuf = null;
  let enabled = true;

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled && ctx && ctx.state === "running") ctx.suspend().catch(() => {});
    if (enabled && ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function wake() {
    if (!enabled || !window.AudioContext) return;
    if (!ctx) {
      ctx = new AudioContext();
      noiseBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function tone(from, to, len = 0.12, wave = "triangle", vol = 0.06, delay = 0) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(25, to), t + len);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  function noise(len = 0.14, cutoff = 900, vol = 0.06, delay = 0) {
    if (!enabled || !ctx || !noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = "lowpass";
    f.frequency.setValueAtTime(cutoff, t);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + len + 0.02);
  }

  return {
    wake,
    setEnabled,
    step() {
      wake();
      noise(0.04, 420, 0.025);
    },
    spot() {
      wake();
      tone(520, 780, 0.11, "triangle", 0.055);
      tone(780, 1040, 0.13, "sine", 0.045, 0.08);
    },
    drill() {
      wake();
      tone(160, 290, 0.14, "sawtooth", 0.035);
      noise(0.14, 1400, 0.04);
    },
    hammer() {
      wake();
      tone(140, 52, 0.12, "triangle", 0.09);
      noise(0.09, 850, 0.08);
    },
    click() {
      wake();
      tone(680, 420, 0.045, "square", 0.035);
    },
    zap() {
      wake();
      tone(180, 95, 0.18, "sawtooth", 0.075);
      noise(0.18, 2200, 0.07);
    },
    miss() {
      wake();
      tone(220, 130, 0.14, "triangle", 0.06);
    },
    honk() {
      wake();
      tone(340, 336, 0.18, "sawtooth", 0.045);
      tone(425, 420, 0.18, "sawtooth", 0.04, 0.01);
    },
    pickup() {
      wake();
      tone(587, 880, 0.11, "triangle", 0.06);
      tone(880, 1175, 0.14, "sine", 0.05, 0.07);
    },
    checkout() {
      wake();
      tone(1240, 1240, 0.07, "sine", 0.05);
      tone(1560, 1560, 0.09, "sine", 0.04, 0.08);
    },
    fixed() {
      wake();
      [392, 493.88, 587.33, 783.99].forEach((f, i) =>
        tone(f, f * 1.01, 0.2, "triangle", 0.06, i * 0.075),
      );
    },
    chapterWon() {
      wake();
      [261.63, 329.63, 392, 523.25, 659.25].forEach((f, i) =>
        tone(f, f, 0.28, "triangle", 0.065, i * 0.09),
      );
    },
    oops() {
      wake();
      tone(392, 311, 0.18, "triangle", 0.06);
      tone(293, 220, 0.24, "triangle", 0.06, 0.15);
    },
  };
})();
