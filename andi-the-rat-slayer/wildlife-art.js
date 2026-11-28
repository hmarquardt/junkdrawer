// Original cut-paper wildlife portraits. The same silhouettes are used on the map
// and on camera-facing cards in the alley, so weak devices keep every visual clue.
const wildlifeTiles = new Map();
function wildlifeTile(kind) {
  if (wildlifeTiles.has(kind)) return wildlifeTiles.get(kind);
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 144;
  const g = c.getContext("2d");
  function oval(x, y, w, h, color, tilt = 0) {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, w, h, tilt, 0, Math.PI * 2);
    g.fill();
  }
  function patch(color, points) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(...points[0]);
    points.slice(1).forEach((p) => g.lineTo(...p));
    g.closePath();
    g.fill();
  }
  const ink = "#242330",
    ivory = "#f4e6ce",
    pink = "#e3a4a1";
  if (["skunk", "raccoon", "possum", "burglardoll"].includes(kind)) {
    const skunk = kind === "skunk",
      possum = kind === "possum";
    const fur = skunk ? "#292735" : possum ? "#99959b" : "#817b73";
    if (possum) {
      g.strokeStyle = pink;
      g.lineWidth = 8;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(67, 96);
      g.bezierCurveTo(-11, 128, 4, 55, 32, 62);
      g.stroke();
    } else {
      oval(41, skunk ? 53 : 92, 23, skunk ? 48 : 39, fur, skunk ? -0.52 : -1.1);
      if (skunk) oval(37, 47, 7, 35, ivory, -0.52);
      else
        for (let i = 0; i < 3; i++)
          oval(18 + i * 14, 82 + i * 6, 5, 17, ink, 0.44);
    }
    oval(90, 89, 49, 33, fur);
    oval(70, 117, 12, 8, ink);
    oval(118, 117, 12, 8, ink);
    if (skunk) oval(88, 67, 39, 6, ivory, -0.02);
    oval(130, 72, 29, 28, possum ? ivory : fur);
    oval(114, 48, 9, 12, ink, -0.3);
    oval(142, 46, 8, 12, ink, 0.22);
    if (!skunk && !possum) oval(136, 72, 25, 9, ink, -0.08);
    if (skunk) oval(134, 61, 5, 19, ivory, -0.15);
    patch(possum ? ivory : fur, [
      [145, 76],
      [183, 88],
      [146, 98],
    ]);
    oval(possum ? 180 : 165, 86, 5, 4, possum ? pink : ink);
    oval(144, 72, 4, 4, ivory);
    oval(145, 72, 2, 3, ink);
    if (kind === "burglardoll") {
      g.strokeStyle = ivory;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(66, 87);
      g.lineTo(113, 87);
      g.stroke();
    }
  } else if (kind.startsWith("cat")) {
    const i = Number(kind[3]),
      fur = catCouncil[i].color;
    oval(97, 100, 62, 34, fur);
    oval(53, 106, 29, 13, fur, 0.15);
    patch(fur, [
      [104, 71],
      [106, 37],
      [128, 54],
      [153, 41],
      [159, 78],
    ]);
    oval(131, 77, 31, 26, fur);
    oval(132, 88, 20, 11, i === 1 ? ivory : "#d8bca2");
    for (const x of [118, 143]) {
      g.strokeStyle = i === 1 ? ivory : ink;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x - 5, 74);
      g.quadraticCurveTo(x, 78, x + 5, 73);
      g.stroke();
    }
    oval(132, 82, 4, 3, pink);
    if (kind.endsWith("yawn")) {
      oval(130, 96, 8, 10, ink);
      oval(131, 101, 5, 3, pink);
    }
    if (i === 0)
      for (let j = 0; j < 3; j++)
        oval(67 + 12 * j, 79, 3, 10, "#9c6138", -0.24);
    if (i === 1) oval(104, 111, 15, 10, ivory);
  } else if (
    [
      "crate",
      "coffin",
      "dummy",
      "rope",
      "switch",
      "fan",
      "lunch",
      "trap",
    ].includes(kind)
  ) {
    const wood = "#b78c61",
      iron = "#465461";
    if (kind === "rope") {
      patch(wood, [
        [25, 83],
        [130, 68],
        [167, 97],
        [52, 119],
      ]);
      g.strokeStyle = ivory;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(97, 89);
      g.bezierCurveTo(65, 56, 115, 26, 104, 16);
      g.stroke();
    } else if (kind === "coffin") {
      patch("#5f4454", [
        [28, 87],
        [49, 54],
        [128, 48],
        [163, 64],
        [158, 84],
        [57, 106],
      ]);
      patch("#bf9275", [
        [32, 85],
        [51, 58],
        [126, 52],
        [154, 64],
        [151, 69],
        [56, 95],
      ]);
    } else if (kind === "fan") {
      g.fillStyle = iron;
      g.fillRect(47, 26, 96, 100);
      oval(95, 72, 42, 42, "#adc6c1");
      oval(95, 72, 38, 38, "#263a46");
      for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(95, 72);
        g.rotate((i * Math.PI) / 2);
        oval(12, -12, 10, 19, "#8db5b8", 0.6);
        g.restore();
      }
      oval(95, 72, 7, 7, ivory);
    } else if (kind === "switch") {
      patch("#536275", [
        [14, 64],
        [137, 41],
        [173, 68],
        [51, 95],
      ]);
      patch("#364450", [
        [14, 64],
        [51, 95],
        [51, 125],
        [14, 93],
      ]);
      patch("#24313c", [
        [51, 95],
        [173, 68],
        [171, 97],
        [51, 125],
      ]);
      for (let i = 0; i < 3; i++) {
        oval(59 + i * 32, 68 - i * 5, 12, 6, "#e38966");
        oval(61 + i * 32, 63 - i * 5, 11, 5, "#fcbd83");
      }
    } else if (kind === "trap") {
      g.fillStyle = iron;
      g.fillRect(55, 55, 80, 65);
      oval(95, 56, 43, 11, "#b4bdba");
      oval(104, 37, 39, 9, iron, -0.33);
    } else if (kind === "lunch") {
      g.fillStyle = "#c56e51";
      g.fillRect(42, 57, 105, 60);
      g.fillStyle = ivory;
      g.fillRect(42, 57, 105, 8);
      g.strokeStyle = iron;
      g.lineWidth = 7;
      g.strokeRect(74, 39, 40, 17);
    } else {
      g.fillStyle = kind === "dummy" ? "#b99e79" : wood;
      g.fillRect(42, 56, 109, 65);
      g.strokeStyle = "#6a5342";
      g.lineWidth = 6;
      g.strokeRect(42, 56, 109, 65);
      g.beginPath();
      g.moveTo(45, 59);
      g.lineTo(148, 118);
      g.stroke();
      if (kind === "dummy") {
        g.fillStyle = ivory;
        g.font = "bold 27px serif";
        g.fillText("PROP", 59, 99);
      }
    }
  } else if (kind === "breeze") {
    g.strokeStyle = "#bdf2db";
    g.lineWidth = 5;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(28, 48 + 17 * i);
      g.bezierCurveTo(60, 32 + i * 17, 105, 55 + i * 17, 148, 40 + i * 17);
      g.stroke();
    }
  } else {
    const symbols = {
      fan: "✣",
      loot: "🍴",
      magnet: "∩",
      detect: "◎",
      weak: "✦",
      wind: "≋",
      switch: "▦",
      treat: "★",
      lunch: "▰",
      trap: "⚠",
    };
    g.fillStyle = "#263e4c";
    g.fillRect(41, 40, 110, 82);
    g.strokeStyle = "#f9c96b";
    g.lineWidth = 5;
    g.strokeRect(41, 40, 110, 82);
    g.fillStyle = kind === "weak" ? "#ffd65d" : "#a8f3e2";
    g.font = "bold 66px system-ui";
    g.textAlign = "center";
    g.fillText(symbols[kind] || "?", 96, 102);
  }
  wildlifeTiles.set(kind, c);
  return c;
}
function nightFigures(s) {
  const elapsed = s.time;
  const actors = [];
  const species = ["skunk", "raccoon", "possum"];
  for (const [i, kind] of species.entries()) {
    if (s.stage !== i + 5 && s.stage !== 8) continue;
    const main = s.stage !== 8 || i === Math.min(2, s.step);
    const at = main
      ? s.rat
      : [
          { x: -4, z: -5 },
          { x: 4, z: -7 },
          { x: 0, z: -8 },
        ][i];
    const rolled =
      kind === "possum" && s.mode !== "intro"
        ? s.stage === 7
          ? clamp((elapsed - s.curtainAt - 0.5) * 2, 0, 1)
          : 1
        : 0;
    const exit = s.exitAt !== undefined ? clamp(elapsed - s.exitAt, 0, 1) : 0;
    const retreat = s.councilBurst
      ? clamp((elapsed - s.councilStart - 1.55) * 1.6, 0, 1)
      : 0;
    actors.push({
      kind,
      x:
        at.x +
        (i % 2 ? -1 : 1) * retreat * 4 +
        (kind === "skunk" ? exit * 3 : 0),
      z: at.z - retreat * 5,
      y: 0.05,
      size: 3.8,
      tilt:
        exit && kind === "possum"
          ? Math.sin(exit * Math.PI) * 0.5
          : rolled
            ? 1.32 * rolled
            : Math.sin(elapsed * (i === 1 ? 10 : 3)) * (i === 1 ? 0.09 : 0.04),
    });
  }
  if (s.stage === 5 && s.gustUntil > s.time) {
    for (let i = 0; i < 3; i++) {
      const u = (s.time * 1.5 + i / 3) % 1;
      actors.push({
        kind: "breeze",
        x: s.airFrom.x + (s.rat.x - s.airFrom.x) * u,
        z: s.airFrom.z + (s.rat.z - s.airFrom.z) * u,
        size: 1.25,
        y: 1 + u * 0.5,
      });
    }
  }
  if (s.recall && s.time - s.recall.start < 1) {
    const { from, to, start } = s.recall,
      u = clamp(s.time - start, 0, 1);
    actors.push({
      kind: "lunch",
      x: from.x + (to.x - from.x) * u,
      z: from.z + (to.z - from.z) * u,
      size: 1.5,
      y: 0.5 + Math.sin(u * Math.PI),
    });
  }
  for (const t of s.decoys)
    actors.push({ ...t, kind: "dummy", size: 1.65, y: 0 });
  if (s.stage === 6)
    actors.push({
      kind: "burglardoll",
      x: -4.7,
      z: -5.3,
      size: 2.7,
      y: 0,
      tilt: 0.35,
    });
  catCouncil.forEach((cat, i) => {
    const u =
      s.mode === "won" && s.stage === 8
        ? 1
        : s.mode === "council"
          ? clamp((elapsed - s.councilStart - i * 0.24) * 0.9, 0, 1)
          : 0;
    actors.push({
      kind:
        "cat" +
        i +
        (i === 0 && s.stage === 8 && (s.mode === "won" || s.councilBurst)
          ? "yawn"
          : ""),
      x: cat.x + (3.35 + (i - 1) * 0.8 - cat.x) * u,
      z: cat.z + (5.1 - cat.z) * u,
      size: 2.25,
      y: 0.35 + Math.sin(u * Math.PI) * 1.1,
      tilt: 0.012 * Math.sin(elapsed + i),
    });
  });
  if (!(campaign.collected & (1 << (s.stage - 5))))
    actors.push({ kind: "treat", ...s.treatAt, size: 0.95, y: 0.25 });
  for (const t of s.targets)
    actors.push({
      kind: t.art || t.icon,
      ...t,
      size:
        t.icon === "detect"
          ? 1.05 + Math.max(0, 1 - distance(s.andi, t) / 7) * 0.35
          : 1.4,
      y: 0.3,
    });
  if (s.stage === 8)
    actors.push({ kind: "switch", x: 3.35, z: 5.1, size: 2.7, y: 0 });
  if (s.attack && (s.stage === 6 || (s.stage === 8 && s.step === 1))) {
    const a = s.attack,
      u = clamp(1 - a.delay / (levels[prefs.difficulty].warning + 0.45), 0, 1);
    actors.push({
      kind: a.lunch ? "lunch" : "trap",
      x: a.lunch ? s.rat.x + (a.x - s.rat.x) * u : a.x,
      z: a.lunch ? s.rat.z + (a.z - s.rat.z) * u : a.z,
      size: 1.4,
      y: a.lunch ? 1 + Math.sin(u * Math.PI) * 2 : 0,
    });
  }
  return actors;
}
function cloudPaint(g, x, y, rx, ry, time) {
  g.save();
  g.fillStyle = "rgba(150,205,89,.5)";
  for (let i = 0; i < 5; i++) {
    const a = time * 0.45 + (i * Math.PI * 2) / 5;
    g.beginPath();
    g.ellipse(
      x + Math.cos(a) * rx * 0.43,
      y + Math.sin(a) * ry * 0.43,
      rx * 0.58,
      ry * 0.58,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  g.restore();
}
function mapNight(g, s) {
  for (const c of s.clouds) cloudPaint(g, c.x, c.z, c.radius, c.radius, s.time);
  for (const a of nightFigures(s)) {
    g.save();
    g.translate(a.x, a.z - a.y);
    g.rotate(a.tilt || 0);
    g.drawImage(
      wildlifeTile(a.kind),
      -a.size / 2,
      -a.size * 0.65,
      a.size,
      a.size * 0.75,
    );
    g.restore();
  }
}
function threeNight(T, scene, shape, cube, ball) {
  const pool = [],
    materials = new Map(),
    clouds = [],
    stands = [],
    cloudGeo = new T.SphereGeometry(1, 20, 12);
  function material(kind) {
    if (!materials.has(kind)) {
      const map = new T.CanvasTexture(wildlifeTile(kind));
      map.colorSpace = T.SRGBColorSpace;
      materials.set(
        kind,
        new T.SpriteMaterial({ map, transparent: true, depthWrite: false }),
      );
    }
    return materials.get(kind);
  }
  function drawNight(s) {
    const active = s.stage >= 5;
    if (active && !stands.length)
      for (const [i, c] of catCouncil.entries())
        stands.push(
          shape(
            scene,
            cube,
            ["#a27c51", "#646d70", "#8e867c"][i],
            c.x,
            0.24,
            c.z,
            1.85,
            0.48,
            1.3,
          ),
        );
    stands.forEach((m) => (m.visible = active));
    const figures = active ? nightFigures(s) : [];
    for (let i = 0; i < Math.max(pool.length, figures.length); i++) {
      const a = figures[i];
      if (!pool[i]) {
        pool[i] = new T.Sprite();
        scene.add(pool[i]);
      }
      const m = pool[i];
      m.visible = !!a;
      if (!a) continue;
      m.material = material(a.kind);
      m.material.rotation = -(a.tilt || 0);
      m.scale.set(a.size, a.size * 0.75, 1);
      m.position.set(a.x, a.y + a.size * 0.35, a.z);
    }
    const zones = active ? s.clouds : [];
    for (let i = 0; i < Math.max(clouds.length, zones.length); i++) {
      if (!clouds[i]) {
        const cm = new T.Mesh(
          cloudGeo,
          new T.MeshStandardMaterial({
            color: 0x93cc52,
            emissive: 0x4d7a22,
            emissiveIntensity: 0.45,
            roughness: 0.9,
            transparent: true,
            opacity: 0.48,
            depthWrite: false,
          }),
        );
        scene.add(cm);
        clouds[i] = cm;
      }
      const m = clouds[i],
        c = zones[i];
      m.visible = !!c;
      if (!c) continue;
      m.position.set(c.x, 0.34, c.z);
      m.scale.set(c.radius, 0.42 + Math.sin(s.time * 4 + i) * 0.12, c.radius);
      m.material.opacity = Math.min(0.52, c.life * 0.25);
    }
  }
  drawNight.dispose = () => {
    cloudGeo.dispose();
    for (const m of materials.values()) {
      m.map.dispose();
      m.dispose();
    }
    for (const sprite of pool) scene.remove(sprite);
  };
  return drawNight;
}

function paintInterlude() {
  const canvas = $("interlude"),
    g = canvas.getContext("2d"),
    t = s.interludeTime || 0;
  const w = canvas.width,
    h = canvas.height;
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#152336");
  bg.addColorStop(0.55, "#2b2a3b");
  bg.addColorStop(1, "#4e353d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // Warm apartment lamp glow on the left
  const lamp = g.createRadialGradient(54, 90, 4, 54, 90, 110);
  lamp.addColorStop(0, "rgba(255,196,112,0.28)");
  lamp.addColorStop(1, "rgba(255,196,112,0)");
  g.fillStyle = lamp;
  g.fillRect(0, 0, w, h);
  // Night window with stars and crescent glow
  g.fillStyle = "#101829";
  g.fillRect(32, 12, 118, 76);
  g.strokeStyle = "#6c7f8a";
  g.lineWidth = 2;
  g.strokeRect(32, 12, 118, 76);
  g.fillStyle = "rgba(255,235,185,0.22)";
  g.beginPath();
  g.arc(62, 28, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f7dcab";
  g.beginPath();
  g.arc(62, 28, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#d9e8ff";
  for (const [sx, sy] of [
    [102, 24],
    [128, 34],
    [116, 56],
    [47, 54],
  ])
    g.fillRect(sx, sy, 2, 2);
  g.fillStyle = "#7a8d96";
  g.fillRect(89, 12, 3, 76);
  g.fillRect(32, 47, 118, 2);
  // Couch + cushions
  g.fillStyle = "#36504f";
  g.fillRect(58, 82, 148, 46);
  g.fillStyle = "#486865";
  g.fillRect(62, 86, 66, 20);
  g.fillRect(132, 86, 68, 20);
  g.fillStyle = "#90a29a";
  g.fillRect(60, 105, 144, 8);
  g.save();
  g.translate(106, 101 + Math.min(t, 1) * 4);
  g.rotate(0.28 * Math.min(t, 1));
  g.scale(34, 34);
  paintAndi(g, 0.4, t, 0);
  g.restore();
  // Dropped teacher tote
  g.fillStyle = "#b57c50";
  g.fillRect(46, 112, 18, 19);
  g.fillStyle = "#d9be98";
  g.fillRect(47, 107, 3, 9);
  g.fillRect(60, 107, 3, 9);
  // Buzzing smartphone with glowing alert screen
  const buzz = Math.sin(t * 34) * 1.6;
  const phoneGlow = g.createRadialGradient(294, 72, 10, 294, 72, 92);
  phoneGlow.addColorStop(0, "rgba(120,235,204,0.28)");
  phoneGlow.addColorStop(1, "rgba(120,235,204,0)");
  g.fillStyle = phoneGlow;
  g.fillRect(190, 0, 200, h);
  g.fillStyle = "#0e141d";
  g.strokeStyle = "#5c7585";
  g.lineWidth = 2;
  g.fillRect(228 + buzz, 22, 134, 98);
  g.strokeRect(228 + buzz, 22, 134, 98);
  g.fillStyle = "#ff7547";
  g.fillRect(229 + buzz, 23, 132, 4);
  g.fillStyle = "#91e8cc";
  g.font = "bold 11px monospace";
  g.fillText("● ALLEY WATCH", 239 + buzz, 48);
  g.fillStyle = "#fff1d6";
  g.font = "600 12px system-ui";
  g.fillText("Wildlife activity", 239 + buzz, 73);
  g.fillText("reported nearby.", 239 + buzz, 91);
}

// A short illustrated insert shares the wildlife portraits with both play views.
function paintNightCard(canvas) {
  const g = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  const gradient = g.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, "#15233a");
  gradient.addColorStop(0.54, "#33344c");
  gradient.addColorStop(1, "#7a5b48");
  g.fillStyle = gradient;
  g.fillRect(0, 0, w, h);
  // Stars
  g.fillStyle = "rgba(255,244,218,0.65)";
  for (let i = 0; i < 18; i++) {
    const sx = (i * 53 + 17) % w,
      sy = (i * 19 + 9) % 58;
    g.fillRect(sx, sy, i % 3 === 0 ? 2 : 1.3, i % 3 === 0 ? 2 : 1.3);
  }
  // Soft moon halo + disc
  const moonHalo = g.createRadialGradient(313, 26, 8, 313, 26, 48);
  moonHalo.addColorStop(0, "rgba(255,232,175,0.45)");
  moonHalo.addColorStop(1, "rgba(255,232,175,0)");
  g.fillStyle = moonHalo;
  g.fillRect(255, 0, 120, 80);
  g.fillStyle = "#f2e1b8";
  g.beginPath();
  g.arc(313, 26, 11, 0, Math.PI * 2);
  g.fill();
  // Distant Chicago skyline with Willis Tower & Hancock silhouettes
  g.fillStyle = "#1c2434";
  g.fillRect(88, 22, 18, 90);
  g.fillRect(92, 10, 2, 14);
  g.fillRect(101, 10, 2, 14);
  g.beginPath();
  g.moveTo(252, 110);
  g.lineTo(258, 26);
  g.lineTo(270, 26);
  g.lineTo(276, 110);
  g.closePath();
  g.fill();
  g.fillRect(260, 14, 1.5, 13);
  g.fillRect(267, 14, 1.5, 13);
  for (let i = 0; i < 9; i++) {
    const x = i * 50 - 15,
      y = 34 + ((i * 29) % 50);
    g.fillStyle = i % 2 ? "#212b3a" : "#2c3240";
    g.fillRect(x, y, 43, 111 - y);
    g.fillStyle = i % 3 === 0 ? "#ffd082" : "#b89c6f";
    g.fillRect(x + 6, y + 9, 5, 8);
    g.fillRect(x + 24, y + 9, 5, 8);
    if (y < 64) g.fillRect(x + 15, y + 25, 5, 8);
  }
  g.strokeStyle = "#18202b";
  g.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    g.moveTo(0, 8 + i * 4);
    g.quadraticCurveTo(176, 73 + i * 3, w, 13 + i * 5);
    g.stroke();
  }
  g.fillStyle = "#242b33";
  g.fillRect(0, 109, w, h - 109);
  g.fillStyle = "rgba(255,212,140,0.12)";
  g.fillRect(0, 109, w, 2);
  const won = s.mode === "won";
  const cast =
    s.stage === 8
      ? won
        ? ["cat0yawn", "cat1", "cat2"]
        : ["skunk", "raccoon", "possum"]
      : [["skunk"], ["raccoon"], ["possum"]][s.stage - 5];
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  cast.forEach((kind, i) => {
    const width = cast.length > 1 ? 110 : 157,
      x = cast.length > 1 ? 27 + i * 112 : 116;
    g.drawImage(wildlifeTile(kind), x, 132 - width * 0.75, width, width * 0.75);
  });
  if (s.stage === 6 && !won) g.drawImage(wildlifeTile("loot"), 204, 72, 38, 31);
  if (s.stage === 7 && won)
    g.drawImage(wildlifeTile("coffin"), 213, 78, 60, 48);
  g.restore();
}
