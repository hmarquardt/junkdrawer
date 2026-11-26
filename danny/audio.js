// Contact, suction and release sounds are synthesized after user activation. A trusted
// equipment record may supply an optional audio asset, decoded only on first use.
export function soundEngine(){
  let ctx,master,contact,level=.65,sampleKey='',sample;
  const wake=()=>{
    try{
      if(!ctx){ctx=new AudioContext();master=ctx.createGain();master.gain.value=level*.7;master.connect(ctx.destination);}
      if(ctx.state==='suspended')ctx.resume().catch(()=>{});
    }catch{}
  };
  function volume(value){level=value;if(master)master.gain.setTargetAtTime(value*.7,ctx.currentTime,.025);}
  function tone(from,to,duration,gain,type,delay=0,pan=0){
    if(!ctx || ctx.state!=='running')return;
    const osc=ctx.createOscillator(),amp=ctx.createGain(),t=ctx.currentTime+delay;
    osc.type=type;osc.frequency.setValueAtTime(from,t);osc.frequency.exponentialRampToValueAtTime(to,t+duration);
    amp.gain.setValueAtTime(.001,t);amp.gain.exponentialRampToValueAtTime(gain,t+.005);
    amp.gain.exponentialRampToValueAtTime(.001,t+duration);
    // Spatially varied releases: a chamber on the left of the field sounds on the left.
    if(ctx.createStereoPanner && pan){
      const panner=ctx.createStereoPanner();panner.pan.value=Math.max(-1,Math.min(1,pan));
      osc.connect(amp).connect(panner).connect(master);
    }else osc.connect(amp).connect(master);
    osc.start(t);osc.stop(t+duration+.01);
  }
  function stop(){
    if(!contact)return;
    contact.amp.gain.setTargetAtTime(.0001,ctx.currentTime,.012);contact.osc.stop(ctx.currentTime+.08);contact=null;
  }
  return {wake,volume,stop,
    start(tech){
      wake();stop();if(!ctx)return;
      const osc=ctx.createOscillator(),amp=ctx.createGain();osc.type=tech==='suction'?'sawtooth':'sine';
      osc.frequency.value=tech==='pulse'?112:67;amp.gain.value=.001;osc.connect(amp).connect(master);osc.start();contact={osc,amp,tech};
    },
    pressure(p,inBand){
      if(!contact)return;
      const t=ctx.currentTime;
      contact.osc.frequency.setTargetAtTime(57+p*95+(inBand?68:0),t,.045);
      contact.amp.gain.setTargetAtTime((contact.tech==='suction'?.018:.036)*(.3+p),t,.03);
    },
    play(cue,v=0,pan=0){
      if(cue==='release'){
        tone(450+v*25,43,.14,.25,'sine',0,pan);tone(820,115,.059,.09,'triangle',0,pan);
        tone(190+v*8,82,.08,.065,'sine',.069,pan);
      }else if(cue==='miss')tone(154,82,.12,.10,'triangle',0,pan);
      else if(cue==='boss'||cue==='win'){
        [330,416,494,660].forEach((n,i)=>tone(n,n*1.02,.18,.10,'triangle',i*.08,pan));
      }else if(cue==='zone')tone(630,770,.075,.075,'sine',0,pan);
      else if(cue==='secondary'){
        // A second outlet opens somewhere else in the field: lower, wider, and off-centre.
        tone(310,196,.16,.12,'triangle',0,pan-.35);tone(248,150,.2,.09,'sine',.06,pan+.4);
        tone(640,412,.07,.05,'sine',.02,pan);
      }else if(cue==='crack'){tone(120,58,.14,.13,'sawtooth',0,pan);tone(430,180,.06,.06,'square',.02,pan);}
      else if(cue==='scope')tone(1180,1520,.05,.05,'sine',0,pan);
      else if(cue==='deep'){tone(96,64,.34,.12,'sine',0,pan);tone(144,96,.28,.06,'triangle',.05,pan);}
      else if(cue==='bossDeep'){
        [98,147,196,294].forEach((n,i)=>tone(n,n*1.01,.5,.09,'sine',i*.07,pan*(i%2?1:-1)));
        tone(720,180,.7,.07,'triangle',.1,pan);
      }
      else tone(470,640,.055,.065,'sine',0,pan);
    },
    async asset(url){
      if(!ctx)return;
      try{
        if(sampleKey!==url){sampleKey=url;sample=null;
          const response=await fetch(url);if(!response.ok)return;
          const buffer=await ctx.decodeAudioData(await response.arrayBuffer());
          if(sampleKey!==url)return;sample=buffer;}
        if(sample){const source=ctx.createBufferSource();source.buffer=sample;source.connect(master);source.start();}
      }catch{}
    }
  };
}
