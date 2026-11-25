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
  } else {
    rod(-53,-9,74,18);rod(-41,-10,40,20,'#66776e');rod(19,-5,21,10);
    c.fillStyle=metal(-8,16);c.beginPath();c.moveTo(36,-4);c.lineTo(53,-9);c.lineTo(53,9);c.lineTo(36,4);c.fill();rod(50,-9,6,18);
  }
  c.strokeStyle='rgba(47,57,51,.65)';c.lineWidth=1;
  for(let x=-42;x<5;x+=3){c.beginPath();c.moveTo(x,-3.7);c.lineTo(x-2,3.7);c.stroke();}
}
