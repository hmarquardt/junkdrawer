// Small machined instrument studies for the tray, drawn at device resolution.
export function illustrate(canvas,id) {
  canvas.width=180;canvas.height=130;
  const c=canvas.getContext('2d');
  c.scale(1.4,1.4);c.translate(60,46);c.rotate(-.56);
  c.shadowColor='#0c100c';c.shadowBlur=4;c.shadowOffsetY=3;
  function metal(y,h) {
    const g=c.createLinearGradient(0,y,0,y+h);
    [[0,'#46514f'],[.22,'#e9ede5'],[.46,'#a9b6aa'],[.64,'#69746d'],[1,'#d1d6cb']].forEach(([p,v])=>g.addColorStop(p,v));
    return g;
  }
  function rod(x,y,w,h,col) {
    c.fillStyle=col||metal(y,h);c.beginPath();c.roundRect(x,y,w,h,h/2);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
  }
  if(id===0) {
    rod(-59,-5,73,10);rod(11,-2,22,4); c.strokeStyle=metal(-7,14);c.lineWidth=2.8;
    c.beginPath();c.moveTo(31,0);c.bezierCurveTo(40,-8,55,-9,56,-2);c.bezierCurveTo(57,6,41,8,31,0);c.stroke();
  } else if(id===1) {
    rod(-58,-4.5,74,9);c.fillStyle=metal(-4,8);c.beginPath();c.moveTo(13,-4);c.lineTo(45,-1.5);c.lineTo(58,-5);c.lineTo(46,1);c.lineTo(13,4);c.fill();
  } else if(id===2) {
    rod(-53,-9,74,18);rod(-41,-10,40,20,'#66776e');rod(19,-5,21,10);
    c.fillStyle=metal(-8,16);c.beginPath();c.moveTo(36,-4);c.lineTo(53,-9);c.lineTo(53,9);c.lineTo(36,4);c.fill();rod(50,-9,6,18);
  } else if(id===3) {
    // PoreScope: slim imaging barrel with an illuminated lens ring.
    rod(-60,-7,66,14);rod(-46,-9,26,18,'#5d6f74');rod(6,-5,24,10);
    c.fillStyle=metal(-9,18);c.beginPath();c.moveTo(30,-8);c.lineTo(50,-11);c.lineTo(50,11);c.lineTo(30,8);c.fill();
    c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#bff6ff';c.lineWidth=2.4;
    c.beginPath();c.ellipse(51,0,4.6,10.5,0,0,Math.PI*2);c.stroke();
    c.strokeStyle='#7fdfef';c.lineWidth=1;c.beginPath();c.ellipse(51,0,2.2,5.4,0,0,Math.PI*2);c.stroke();
    c.fillStyle='#cefa80';c.beginPath();c.arc(0,-11,2.1,0,Math.PI*2);c.fill();
  } else if(id===4) {
    // Vortex Extractor: rotor housing with twin spiral blades.
    rod(-58,-12,60,24,'#4d5a56');rod(-46,-14,30,28,'#6d7d75');rod(4,-6,26,12);
    c.fillStyle=metal(-6,14);c.beginPath();c.moveTo(30,-6);c.lineTo(47,-13);c.lineTo(47,13);c.lineTo(30,6);c.fill();
    c.save();c.translate(-30,0);c.rotate(.5);
    c.strokeStyle='#d9e6dc';c.lineWidth=2.2;
    for(const dir of [1,-1]){c.beginPath();c.moveTo(0,-3.4*dir);c.bezierCurveTo(10,-10*dir,14,3*dir,4,3.4*dir);c.stroke();}
    c.restore();
    c.strokeStyle='#2c3733';c.lineWidth=1;c.beginPath();c.arc(-30,0,10,0,Math.PI*2);c.stroke();
  } else if(id===6) {
    // The Silver Loop: a polished ring on a slim mirror-steel shaft.
    rod(-58,-4,72,8);rod(8,-3,20,6,'#7d8783');
    c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#eef4f2';c.lineWidth=3.2;
    c.beginPath();c.ellipse(40,0,9,13,0,0,Math.PI*2);c.stroke();
    c.strokeStyle='#9fe6df';c.lineWidth=1;c.beginPath();c.ellipse(40,0,5,8,0,0,Math.PI*2);c.stroke();
  } else if(id===7) {
    // Spectral Extractor: prism head with three phase vanes.
    rod(-58,-7,64,14);rod(-40,-9,24,18,'#5b6a78');
    c.fillStyle=metal(-8,16);c.beginPath();c.moveTo(26,-7);c.lineTo(46,-13);c.lineTo(46,13);c.lineTo(26,7);c.closePath();c.fill();
    c.shadowBlur=0;c.shadowOffsetY=0;
    for(const [i,alpha] of [[0,.9],[1,.55],[2,.3]]){c.strokeStyle='rgba(170,235,255,'+alpha+')';c.lineWidth=1.6;
      c.beginPath();c.moveTo(30+i*5,-10+i*2);c.lineTo(30+i*5,10-i*2);c.stroke();}
  } else if(id===8) {
    // Cryo Wand: canister, frost collar and a cold tip.
    rod(-58,-10,58,20,'#6d7d86');rod(-46,-12,28,24,'#9fb4bd');rod(0,-5,24,10);
    c.fillStyle=metal(-6,12);c.beginPath();c.moveTo(24,-6);c.lineTo(42,-9);c.lineTo(42,9);c.lineTo(24,6);c.closePath();c.fill();
    c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#c9f6ff';c.lineWidth=1.4;
    for(let i=0;i<3;i++){c.beginPath();c.arc(44,0,4+i*2.4,0,Math.PI*2);c.stroke();}
  } else if(id===9) {
    // Arcane Resonator: brass rings around a suspended crystal.
    rod(-58,-5,62,10,'#6b5a3e');rod(-42,-7,22,14,'#8c7448');
    for(const r of [12,17,22]){c.strokeStyle='rgba(214,184,110,.85)';c.lineWidth=1.6;
      c.beginPath();c.arc(36,0,r,0,Math.PI*2);c.stroke();}
    c.shadowBlur=0;c.shadowOffsetY=0;c.fillStyle='#b9f6de';
    c.beginPath();c.moveTo(36,-9);c.lineTo(44,0);c.lineTo(36,9);c.lineTo(28,0);c.closePath();c.fill();
  } else {
    // Resonance Wand: tapered shaft, tuning-fork head, stepped rings.
    rod(-57,-4,66,8);rod(9,-3,22,6,'#6f7f78');
    c.strokeStyle=metal(-9,18);c.lineWidth=3.2;
    c.beginPath();c.moveTo(31,0);c.lineTo(39,0);c.moveTo(39,-7);c.lineTo(39,7);c.moveTo(39,-7);c.lineTo(50,-6.4);c.moveTo(39,7);c.lineTo(50,6.4);c.stroke();
    c.shadowBlur=0;c.shadowOffsetY=0;c.fillStyle='#cefa80';
    c.beginPath();c.arc(50,-6.4,1.8,0,Math.PI*2);c.fill();c.beginPath();c.arc(50,6.4,1.8,0,Math.PI*2);c.fill();
    c.strokeStyle='#9ff3c8';c.lineWidth=1;
    for(const x of [6,10,14]){c.beginPath();c.arc(x,0,4.2,0,Math.PI*2);c.stroke();}
  }
  c.strokeStyle='rgba(47,57,51,.65)';c.lineWidth=1;
  for(let x=-42;x<5;x+=3){c.beginPath();c.moveTo(x,-3.7);c.lineTo(x-2,3.7);c.stroke();}
}
