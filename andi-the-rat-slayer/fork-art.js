// A shared polished-metal profile for the illustrated equipment close-up and map.
function paintUtensil(g, length, head, glow) {
  const metal = g.createLinearGradient(0, -head * 0.45, 0, head * 0.45);
  metal.addColorStop(0, "#52616b");
  metal.addColorStop(0.25, "#effbff");
  metal.addColorStop(0.48, "#8296a0");
  metal.addColorStop(0.65, "#ffffff");
  metal.addColorStop(1, "#5c6872");
  g.fillStyle = metal;
  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = 4;
  }
  const neck = length - head * 0.95;
  for (let i = 0; i < 3; i++) {
    const width = head * (0.2 - i * 0.04);
    g.fillRect((i * neck) / 3, -width / 2, neck / 3 + 0.025, width);
  }
  g.beginPath();
  g.moveTo(neck, -head * 0.1);
  g.quadraticCurveTo(
    neck + head * 0.32,
    -head * 0.13,
    neck + head * 0.38,
    -head * 0.46,
  );
  g.lineTo(neck + head * 0.49, -head * 0.46);
  g.lineTo(neck + head * 0.49, head * 0.46);
  g.quadraticCurveTo(neck + head * 0.12, head * 0.2, neck, head * 0.1);
  g.fill();
  for (let j = 0; j < 4; j++) {
    const y = (j - 1.5) * head * 0.275;
    g.beginPath();
    g.moveTo(neck + head * 0.36, y - head * 0.07);
    g.lineTo(length, y - head * 0.015);
    g.lineTo(length - head * 0.08, y + head * 0.06);
    g.lineTo(neck + head * 0.35, y + head * 0.07);
    g.fill();
  }
  g.shadowBlur = 0;
}
const forkFilms = {
  1: [
    "LEGENDARY WEAPON ACQUIRED",
    "THE FORK OF FURY",
    "Dishwasher safe. Ratfather not safe.",
  ],
  2: ["EXTENSION UPGRADE", "THE MEGA FORK", "Four prongs. Extra reach."],
  3: [
    "LIVE CIRCUIT UPGRADE",
    "THE CONDUCTIVE FORK",
    "Pretty sure that's not dishwasher safe anymore.",
  ],
  4: [
    "LEGENDARY UPGRADE",
    "THE FORK OF DESTINY",
    "I told you to stay out of my alley.",
  ],
};
let lastFilmFrame = -1;
function paintFilm() {
  const c = $("reveal"),
    g = c.getContext("2d"),
    t = s.mode === "won" ? s.time - s.fork.finaleStart : s.intro;
  const end = s.mode === "won",
    stage = s.stage;
  const [tag, name, line] = forkFilms[stage];
  setCopy($("filmTag"), end ? "FINISHING MOVE" : tag);
  setCopy($("filmName"), name);
  let caption = line;
  if (!end && stage === 1 && t < 2.45)
    caption =
      t < 0.85
        ? "Her hand finds the car keys. Wrong boss."
        : t < 1.85
          ? "Andi checks her bag. “Well, I didn't pack for this.”"
          : "SHHHHIIIING!";
  if (!end && stage === 4 && t < 3.2)
    caption =
      t < 1.4
        ? "The Ratfather laughs at the dinner fork."
        : "It keeps extending. The Ratfather stops laughing.";
  setCopy($("filmLine"), caption);
  const frame = Math.floor(t * 24);
  if (lastFilmFrame === frame) return;
  lastFilmFrame = frame;
  const w = c.width,
    h = c.height;
  g.clearRect(0, 0, w, h);
  const bg = g.createRadialGradient(
    w * 0.54,
    h * 0.54,
    0,
    w * 0.54,
    h * 0.5,
    w * 0.55,
  );
  bg.addColorStop(0, stage === 3 ? "#375970" : "#6e5334");
  bg.addColorStop(1, "#151a18");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const u = clamp((t - (end ? 0 : 1.65)) / (stage === 4 ? 1.35 : 0.42), 0, 1);
  if (!end && stage === 1 && t > 1.65 && !s.fork.introChime) {
    s.fork.introChime = true;
    forkChime(true);
  }
  g.save();
  g.translate(w * 0.5, h * 0.53);
  g.rotate(-0.12 + Math.sin(t * 0.9) * 0.085);
  g.scale(0.9 + 0.1 * Math.cos(t * 1.1), 1);
  const len = 170 + u * (stage === 4 ? 450 : 335);
  g.translate(-len / 2, 0);
  if (stage === 1 && t < 1.65) {
    g.font = "56px system-ui";
    g.fillText(t < 0.85 ? "🔑" : "👜", -72, 32);
  }
  paintUtensil(
    g,
    len,
    stage === 4 ? 86 : 65,
    stage === 3 ? "#63dbff" : stage === 4 ? "#ffcc62" : null,
  );
  g.restore();
  if ((u > 0 && u < 1) || stage === 3) {
    g.strokeStyle = stage === 3 ? "#9ce8ff" : "#ffebad";
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const x = w * 0.12 + i * w * 0.066,
        y = h * 0.27 + Math.sin(i * 5 + frame) * 11;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  if (end)
    for (let i = 0; i < 44; i++) {
      g.fillStyle = ["#ffc255", "#72ddf3", "#ff805a"][i % 3];
      g.fillRect(
        (i * 73 + frame * ((i % 3) + 1)) % w,
        (i * 47 + frame * 2) % h,
        7,
        4,
      );
    }
}
let fxDirty = false;
function drawForkEffects() {
  if (!$("sceneCard").hidden && !$("utensilFilm").hidden && s.fork) paintFilm();
  const c = $("forkFx"),
    f = s.fork,
    age = f?.burst ? s.time - f.burst.start : 2;
  if (age > 1.05 || !f?.burst) {
    if (fxDirty) {
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
      fxDirty = false;
    }
    return;
  }
  const w = $("view").clientWidth,
    h = $("view").clientHeight;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d"),
    b = f.burst,
    p = view.project(b.x, b.z, 0.95);
  g.clearRect(0, 0, w, h);
  fxDirty = true;
  g.save();
  g.translate(p.x, p.y);
  g.globalAlpha = Math.min(1, (1.05 - age) * 2);
  const count = s.economy ? 8 : b.kind === "confetti" ? 32 : 16;
  for (let i = 0; i < count; i++) {
    const a = i * 2.4,
      r = (12 + (i % 5) * 7) * Math.sin((Math.min(1, age * 1.8) * Math.PI) / 2);
    const x = Math.sin(a) * r,
      y = Math.cos(a) * r - age * 24;
    g.fillStyle =
      b.kind === "arc"
        ? ["#8ee7ff", "#fff"][i % 2]
        : ["#ffd06c", "#fff6d6", "#fc9978", "#b9d7df"][i % 4];
    if (i % 5 === 0) {
      g.globalAlpha *= 0.48;
      g.beginPath();
      g.arc(x, y, 3 + age * 6, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = Math.min(1, (1.05 - age) * 2);
    } else if (b.kind === "arc") {
      g.strokeStyle = g.fillStyle;
      g.beginPath();
      g.moveTo(x * 0.5, y * 0.5);
      g.lineTo(x + 4, y + 6);
      g.lineTo(x - 3, y - 6);
      g.stroke();
    } else {
      g.font = "bold 15px system-ui";
      g.fillText(i % 2 ? "✦" : "✶", x, y);
    }
  }
  g.font = "bold 16px system-ui";
  g.textAlign = "center";
  g.strokeStyle = "#20221c";
  g.lineWidth = 4;
  g.strokeText(b.label, 0, -24 - age * 20);
  g.fillStyle = "#fff5bb";
  g.fillText(b.label, 0, -24 - age * 20);
  g.restore();
}

// Original three-quarter sprite for Canvas fallback. The same cardigan, book
// tote, ID badge and shoulder-length hair carry the silhouette at map scale.
function paintAndi(g, heading, time, speed) {
  const side = Math.sin(heading),
    back = Math.cos(heading) < -0.35,
    step = speed > 0.1 ? Math.sin(time * 13) : 0;
  function oval(x, y, w, h, color, tilt = 0) {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, w, h, tilt, 0, 2 * Math.PI);
    g.fill();
  }
  function rect(x, y, w, h, color) {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  }
  oval(0, 0.23, 0.49, 0.16, "#262f2980");
  for (const dir of [-1, 1]) {
    const offset = dir * step * 0.11;
    rect(dir * 0.115 - 0.067, -0.36 + offset, 0.135, 0.5, "#344353");
    oval(dir * 0.115 + 0.02, 0.17 + offset, 0.11, 0.065, "#333934");
  }
  oval(0, -0.56, 0.252, 0.35, "#b85c39");
  oval(-0.26, -0.59, 0.066, 0.245, "#ac5334", -0.1);
  oval(0.26, -0.59, 0.07, 0.245, "#c66c44", 0.12);
  if (!back) {
    oval(side * 0.04, -0.72, 0.11, 0.15, "#f5dfb8");
    g.strokeStyle = "#296c70";
    g.lineWidth = 0.027;
    g.beginPath();
    g.moveTo(-0.073, -0.82);
    g.lineTo(0.014, -0.6);
    g.lineTo(0.09, -0.82);
    g.stroke();
    rect(-0.045, -0.62, 0.115, 0.125, "#f4ead3");
  }
  const sway = step * 0.026;
  oval(sway, -1, 0.225, 0.28, "#d0a056");
  oval(side * 0.05, -1.03, 0.172, 0.192, "#c39879");
  oval(side * 0.01, -1.17, 0.22, 0.135, "#edc575", -0.09);
  oval(-0.164 + sway, -0.99, 0.078, 0.23, "#e3b15d", 0.11);
  oval(0.169 + sway, -0.985, 0.07, 0.224, "#efc97f", -0.1);
  if (back) oval(sway, -1.025, 0.192, 0.24, "#e1b563");
  else oval(0.065 + side * 0.055, -1.05, 0.017, 0.018, "#564339");
  rect(-0.39, -0.49, 0.195, 0.29, "#d7bb83");
  rect(-0.37, -0.54, 0.12, 0.07, "#6a928d");
  rect(-0.24, -0.56, 0.037, 0.07, "#bb794e");
}
