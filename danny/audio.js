export function soundEngine() {
  let ctx;
  function tone(start, end, length, volume, type) {
    const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(start,t);
    osc.frequency.exponentialRampToValueAtTime(end,t+length);
    gain.gain.setValueAtTime(volume,t);
    gain.gain.exponentialRampToValueAtTime(.001,t+length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t+length);
  }
  return {
    wake() {
      try { ctx ??= new AudioContext(); if(ctx.state === 'suspended') ctx.resume().catch(()=>{}); } catch {}
    },
    play(cue, variation=0) {
      if (!ctx || ctx.state !== 'running') return;
      if(cue === 'release') {
        tone(425 + variation*100,48,.115,.19,'sine');
        tone(830,125,.049,.042,'triangle');
      } else if(cue === 'miss') tone(150,90,.11,.06,'triangle');
      else tone(510,680,.04,.035,'sine');
    }
  };
}
