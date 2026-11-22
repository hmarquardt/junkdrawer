// Coordinates are metres on the alley floor. Both renderers use the same simulation.
function createAlleyView(host, quality) {
  const canvas = document.createElement("canvas");
  let gl;
  try {
    gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
  } catch {}
  if (!gl || !window.THREE) return createMapView(host);
  const T = THREE,
    renderer = new T.WebGLRenderer({ canvas, context: gl });
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    view = createMapView(host);
  });
  host.replaceChildren(canvas);
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(42, 1, 0.1, 150);
  scene.background = new T.Color(0x9daaa5);
  scene.fog = new T.FogExp2(0x9daaa5, 0.016);
  const light = new T.DirectionalLight(0xffdda6, 3);
  light.position.set(-12, 24, 9);
  light.castShadow = true;
  Object.assign(light.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    far: 75,
  });
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0005;
  scene.add(light, new T.HemisphereLight(0xe9f2fb, 0x8d7662, 2));
  const cube = new T.BoxGeometry(1, 1, 1),
    ball = new T.SphereGeometry(1, 18, 12),
    lowBall = new T.SphereGeometry(1, 8, 6);
  const materials = new Map(),
    batches = new Map();
  let seed = 9723;
  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function surface(brick) {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d");
    g.fillStyle = brick ? "#9b8a78" : "#525656";
    g.fillRect(0, 0, 1024, 1024);
    if (brick)
      for (let y = 0; y < 32; y++)
        for (let x = -1; x < 12; x++) {
          g.fillStyle =
            "hsl(" + (10 + rand() * 12) + " 24% " + (31 + rand() * 18) + "%)";
          g.fillRect(x * 96 + (y % 2) * 48, y * 32, 93, 29);
        }
    for (let i = 0; i < 55000; i++) {
      g.fillStyle = rand() < 0.5 ? "#1b181623" : "#eee1cb20";
      g.fillRect(rand() * 1024, rand() * 1024, rand() * 5 + 1, 2);
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(brick ? 2 : 4, brick ? 1 : 5);
    return tex;
  }
  function material(color) {
    if (!materials.has(color))
      materials.set(
        color,
        new T.MeshStandardMaterial({
          color: color === "brick" || color === "road" ? 0xffffff : color,
          map:
            color === "brick" || color === "road"
              ? surface(color === "brick")
              : null,
          roughness: color === "#789397" ? 0.19 : 0.83,
          metalness: color === "#789397" ? 0.48 : 0.08,
        }),
      );
    return materials.get(color);
  }
  function shape(group, geo, color, x, y, z, w, h, d) {
    const m = new T.Mesh(geo, material(color));
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function box(color, x, y, z, w, h, d, angle = 0) {
    const dummy = new T.Object3D();
    dummy.position.set(x, y, z);
    dummy.rotation.z = angle;
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    if (!batches.has(color)) batches.set(color, []);
    batches.get(color).push(dummy.matrix);
  }
  box("road", 0, -0.18, 0, 30, 0.3, 70);
  for (const side of [-1, 1])
    for (let row = -3; row <= 3; row++) {
      const z = row * 9,
        x = side * 12.5;
      box("brick", x, 3.9, z, 8, 7.8, 8.6);
      box("#423d35", x, 7.9, z, 8.3, 0.25, 9);
      for (const dz of [-2.8, 0, 2.8])
        for (const y of [3.8, 6.3]) {
          box("#b29a7e", side * 8.45, y, z + dz, 0.25, 1.8, 1.3);
          box(
            rand() < 0.4 ? "#c3af84" : "#586462",
            side * 8.28,
            y,
            z + dz,
            0.12,
            1.55,
            1.1,
          );
          box("#474744", side * 8.2, y, z + dz, 0.1, 0.1, 1.1);
        }
      box("#655f55", side * 8.4, 1.25, z, 0.4, 2.5, 4.5);
      for (let k = 0; k < 9; k++)
        box("#807b6c", side * 8.16, 0.3 + k * 0.25, z, 0.08, 0.035, 4.4);
      box("#49473d", side * 8.1, 3, z, 1.25, 0.15, 5);
      for (let k = 0; k < 8; k++)
        box("#403e37", side * 7.52, 3.53, z - 2.3 + k * 0.65, 0.06, 1, 0.06);
      if (row % 2 === 0)
        for (let step = 0; step < 11; step++)
          box(
            "#534f44",
            side * 7.85,
            0.25 + step * 0.25,
            z - 4.2 + step * 0.23,
            0.95,
            0.09,
            0.31,
          );
      box("#423e39", side * 7.52, 4.02, z, 0.08, 0.09, 5);
    }
  for (const z of [-18, -2, 14]) {
    box("#66513c", 8, 4.6, z, 0.24, 9.2, 0.24);
    box("#574632", 8, 8.6, z, 2, 0.16, 0.16);
  }
  for (const x of [7.3, 8, 8.7]) box("#363938", x, 8.6, -2, 0.035, 0.04, 48);
  for (let i = 0; i < 18; i++)
    shape(
      scene,
      lowBall,
      "#69787b",
      (rand() - 0.5) * 13,
      -0.023,
      (rand() - 0.5) * 32,
      0.3 + rand() * 0.9,
      0.037,
      0.4 + rand() * 1.4,
    );
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 8; k++)
      box("#393a35", 7.1, 0.014, i * 7 - 12 + k * 0.11, 0.7, 0.024, 0.04);
  // Painted pavement lettering and the faded garage mural are original canvas textures.
  function painted(words, ink, ground, width, height) {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 192;
    const g = c.getContext("2d");
    g.fillStyle = ground;
    g.fillRect(0, 0, 1024, 192);
    g.fillStyle = ink;
    g.textAlign = "center";
    g.font = "900 104px sans-serif";
    g.fillText(words, 512, 130, 970);
    for (let i = 0; i < 3500; i++)
      g.clearRect(rand() * 1024, rand() * 192, rand() * 5 + 1, 1 + rand() * 2);
    const map = new T.CanvasTexture(c);
    map.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(
      new T.PlaneGeometry(width, height),
      new T.MeshStandardMaterial({ map, transparent: true, depthWrite: false }),
    );
    scene.add(m);
    return m;
  }
  const roadSign = painted("KEEP CLEAR", "#d1c1a1", "#0000", 4, 1);
  roadSign.rotation.x = -Math.PI / 2;
  roadSign.position.set(2, 0.025, 7);
  const garage = painted("ALLEY AUTO", "#e1cfab", "#394b49", 4.5, 1);
  garage.rotation.y = Math.PI / 2;
  garage.position.set(-8.15, 2.1, 1);
  for (let i = 0; i < 5; i++)
    box("#d5b878", -3.1 + i * 0.5, 0.02, 9.5, 0.33, 0.03, 0.075);

  const bins = [];
  for (const [x, z] of alleyBins) {
    const b = new T.Group();
    b.position.set(x, 0, z);
    scene.add(b);
    bins.push(b);
    shape(b, cube, "#34554b", 0, 0.68, 0, 1.65, 1.25, 2);
    shape(b, cube, "#233832", 0, 1.36, 0, 1.78, 0.17, 2.12);
    for (let k = 0; k < 3; k++)
      shape(b, cube, "#718478", 0, 1.47, k * 0.55 - 0.55, 1.7, 0.08, 0.06);
  }
  for (const [color, list] of batches) {
    const mesh = new T.InstancedMesh(cube, material(color), list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = color !== "road";
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const andi = new T.Group(),
    car = new T.Group();
  scene.add(andi, car);
  const oval = (g, c, x, y, z, w, h, d) => shape(g, ball, c, x, y, z, w, h, d);
  oval(andi, "#ca6335", 0, 1.03, 0, 0.33, 0.53, 0.22);
  oval(andi, "#b08062", 0, 1.72, 0, 0.22, 0.28, 0.21);
  oval(andi, "#47352c", 0, 1.9, -0.04, 0.235, 0.18, 0.23);
  const legs = [-1, 1].map((s) =>
    shape(andi, cube, "#344353", s * 0.15, 0.37, 0, 0.21, 0.74, 0.23),
  );
  for (const s of [-1, 1])
    oval(andi, "#b56038", s * 0.34, 1, 0, 0.12, 0.39, 0.13);
  shape(andi, cube, "#dfbf7c", 0.37, 0.65, 0, 0.29, 0.46, 0.36);
  shape(car, cube, "#527b87", 0, 0.58, 0, 1.55, 0.7, 3.15);
  shape(car, cube, "#334950", 0, 1.07, -0.13, 1.35, 0.48, 1.62);
  shape(car, cube, "#749397", 0, 1.35, -0.13, 1.38, 0.11, 1.6);
  shape(car, cube, "#9aa9a8", 0, 0.36, 1.61, 1.49, 0.11, 0.1);
  shape(car, cube, "#24323a", 0, 0.58, 1.59, 0.55, 0.19, 0.06);
  shape(car, cube, "#a76147", 0, 0.64, -1.61, 1.2, 0.15, 0.05);
  for (const z of [-0.99, 0.72]) {
    const windshield = shape(
      car,
      cube,
      "#7699a6",
      0,
      1.04,
      z,
      1.26,
      0.47,
      0.055,
    );
    windshield.rotation.x = z < 0 ? -0.24 : 0.24;
  }
  for (const side of [-1, 1]) {
    shape(car, cube, "#a0a99f", side * 0.688, 1.06, -0.09, 0.045, 0.44, 0.075);
    shape(car, cube, "#4e6971", side * 0.83, 0.98, 0.52, 0.2, 0.14, 0.21);
  }
  for (const s of [-1, 1]) {
    shape(car, cube, "#ffe6a6", s * 0.51, 0.64, 1.59, 0.37, 0.18, 0.05);
    for (const z of [-0.96, 0.98])
      oval(car, "#262929", s * 0.72, 0.34, z, 0.2, 0.34, 0.34);
  }
  function ratModel(simple = false) {
    const g = new T.Group(),
      geo = simple ? lowBall : ball;
    scene.add(g);
    const part = (c, x, y, z, w, h, d) => shape(g, geo, c, x, y, z, w, h, d);
    part("#6c5848", 0, 0.34, 0, 0.34, 0.33, 0.66);
    part("#786252", 0, 0.39, 0.46, 0.25, 0.24, 0.36);
    part("#bf8779", 0, 0.34, 0.78, 0.09, 0.075, 0.08);
    for (const s of [-1, 1]) {
      part("#ae8678", s * 0.19, 0.61, 0.41, 0.11, 0.13, 0.08);
      part("#1c1818", s * 0.16, 0.49, 0.64, 0.045, 0.048, 0.046);
    }
    const feet = [];
    for (const side of [-1, 1]) {
      for (const z of [-0.31, 0.28]) {
        feet.push(part("#a6806e", side * 0.23, 0.115, z, 0.077, 0.105, 0.15));
      }
    }
    if (!simple) {
      const strands = [];
      for (const side of [-1, 1])
        for (let i = 0; i < 4; i++) {
          strands.push(
            0.08 * side,
            0.36,
            0.67,
            (0.32 + i * 0.037) * side,
            0.38 + i * 0.015,
            0.73 - i * 0.065,
          );
        }
      const lines = new T.BufferGeometry();
      lines.setAttribute("position", new T.Float32BufferAttribute(strands, 3));
      g.add(
        new T.LineSegments(lines, new T.LineBasicMaterial({ color: 0xc6b3a0 })),
      );
    }
    const tail = [];
    let parent = g;
    for (let i = 0; i < 5; i++) {
      const joint = new T.Group();
      joint.position.set(0, i === 0 ? 0.19 : 0, i === 0 ? -0.47 : -0.18);
      parent.add(joint);
      shape(
        joint,
        lowBall,
        "#a77a6c",
        0,
        0,
        -0.09,
        0.055 - i * 0.007,
        0.055 - i * 0.007,
        0.15,
      );
      parent = joint;
      tail.push(joint);
    }
    return {
      g,
      tail,
      feet,
      body: g.children.filter((m) => m.geometry === ball),
    };
  }
  const boss = ratModel(),
    mob = [ratModel(true), ratModel(true)];
  const crown = shape(boss.g, cube, "#bd994d", 0, 0.69, 0.06, 0.42, 0.18, 0.32);
  const hat = shape(boss.g, cube, "#252a29", 0, 0.76, 0.32, 0.58, 0.18, 0.48);
  const visor = shape(boss.g, cube, "#57cfc2", 0, 0.52, 0.64, 0.44, 0.1, 0.08);
  const rolling = shape(scene, cube, "#476356", 0, 1, 0, 1.38, 1.55, 1.5);
  const claw = shape(scene, ball, "#e5a738", 0, 0, 0, 0.28, 0.28, 0.28);
  const bolts = [0, 1, 2].map(() =>
    shape(scene, lowBall, "#a5f3ea", 0, 0, 0, 0.15, 0.19, 0.15),
  );
  const debris = Array.from({ length: 16 }, () =>
    shape(scene, lowBall, "#a69075", 0, 0, 0, 0.13, 0.1, 0.19),
  );
  const contact = document.createElement("canvas");
  contact.width = contact.height = 64;
  const cg = contact.getContext("2d"),
    shade = cg.createRadialGradient(32, 32, 0, 32, 32, 32);
  shade.addColorStop(0, "#201b16a0");
  shade.addColorStop(1, "#201b1600");
  cg.fillStyle = shade;
  cg.fillRect(0, 0, 64, 64);
  const contactMat = new T.MeshBasicMaterial({
    map: new T.CanvasTexture(contact),
    transparent: true,
    depthWrite: false,
  });
  const contacts = [andi, boss.g, car, ...bins].map((obj) => {
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), contactMat);
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    return { m, obj };
  });
  const pads = [0, 1, 2].map(() => {
    const m = shape(scene, cube, "#e99c43", 0, 0.06, 0, 1.7, 0.12, 1.7);
    return m;
  });
  const symbols = pads.map((pad, i) => {
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = "#14211d";
    g.fillRect(0, 0, 96, 96);
    g.fillStyle = "#ffd183";
    g.textAlign = "center";
    g.font = "bold 64px monospace";
    g.fillText(String(i + 1), 48, 71);
    const m = new T.Mesh(
      new T.PlaneGeometry(1.32, 1.32),
      new T.MeshBasicMaterial({ map: new T.CanvasTexture(c) }),
    );
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    return m;
  });
  const ring = new T.Mesh(
    new T.RingGeometry(0.91, 1, 64),
    new T.MeshBasicMaterial({ color: 0xff6737, side: T.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const outline = new T.Mesh(
    new T.RingGeometry(0.8, 1, 32),
    new T.MeshBasicMaterial({ color: 0x8be3d2 }),
  );
  outline.rotation.x = -Math.PI / 2;
  scene.add(outline);
  function options(q) {
    quality = q;
    renderer.shadowMap.enabled = q === "high";
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(devicePixelRatio, q === "high" ? 1.6 : 1));
  }
  options(quality);
  function pose(model, p, scale, t) {
    model.g.position.set(
      p.x,
      0.045 + (Math.abs(Math.sin(t * 18)) * 0.045 * (p.speed || 0)) / 5,
      p.z,
    );
    model.g.rotation.y = p.angle;
    model.g.scale.setScalar(scale);
    model.feet.forEach((foot, i) => {
      foot.rotation.x =
        Math.sin(t * 21 + (i === 0 || i === 3 ? 0 : Math.PI)) *
        Math.min(0.85, p.speed * 0.22);
    });
    model.tail.forEach(
      (j, i) => (j.rotation.y = Math.sin(t * 9 - i * 0.6) * 0.23),
    );
  }
  function draw(s) {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (
      canvas.clientWidth !== w ||
      canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(h * renderer.getPixelRatio())
    )
      renderer.setSize(w, h, false);
    const p = s.andi,
      r = s.rat;
    andi.visible = !s.driving;
    andi.position.set(p.x, s.dash > 0 ? 0.12 : 0, p.z);
    andi.rotation.y = p.angle;
    legs.forEach(
      (l, i) =>
        (l.rotation.x =
          Math.sin(s.time * 13 + i * Math.PI) * (p.speed > 0.1 ? 0.48 : 0)),
    );
    car.position.set(s.car.x, 0, s.car.z);
    car.rotation.y = s.car.angle;
    pose(boss, r, s.scale, s.time);
    if (s.attack && (s.stage === 2 || (s.stage === 4 && s.step === 2))) {
      const u = clamp(
        1 - s.attack.delay / levels[prefs.difficulty].warning,
        0,
        1,
      );
      boss.g.position.x += (s.attack.x - r.x) * u;
      boss.g.position.z += (s.attack.z - r.z) * u;
      boss.g.position.y += Math.sin(u * Math.PI) * 2.8;
    }
    crown.visible = s.stage === 1;
    hat.visible = s.stage === 4;
    visor.visible = s.stage === 3;
    mob.forEach((m, i) => {
      m.g.visible = !!s.mobs[i];
      if (m.g.visible) pose(m, s.mobs[i], 0.86, s.time);
    });
    pads.forEach((m, i) => {
      const a = s.targets[i];
      m.visible = symbols[i].visible = !!a && !a.used;
      if (m.visible) {
        m.position.set(a.x, 0.09, a.z);
        symbols[i].position.set(a.x, 0.17, a.z);
      }
    });
    bins.forEach((b, i) => {
      b.rotation.z = s.mode === "intro" ? Math.sin(s.time * 26) * 0.035 : 0;
      b.scale.y = s.crushed.includes(i) ? 0.23 : 1;
    });
    contacts.forEach(({ m, obj }) => {
      m.visible = obj.visible;
      m.position.set(obj.position.x, 0.018, obj.position.z);
      const size = obj === boss.g ? s.scale * 0.72 : obj === andi ? 0.61 : 1.7;
      m.scale.set(size, size * 1.24, 1);
    });
    rolling.visible = !!s.roll || (s.stage === 0 && !!s.attack);
    if (s.stage === 0 && s.attack) {
      const u =
        1 - Math.max(0, s.attack.delay) / levels[prefs.difficulty].warning;
      rolling.position.set(
        s.attack.fromX + (s.attack.x - s.attack.fromX) * u,
        0.78,
        s.attack.z,
      );
      rolling.rotation.z = 0.15 * Math.sin(u * 12);
    }
    if (s.roll) {
      const u = 1 - s.roll.time / 0.65;
      rolling.position.set(
        s.roll.from.x + (s.roll.to.x - s.roll.from.x) * u,
        0.8 + 0.35 * Math.sin(u * Math.PI),
        s.roll.from.z + (s.roll.to.z - s.roll.from.z) * u,
      );
      rolling.rotation.x = u * 7;
    }
    claw.visible = s.stun > 0 && s.targets.length > 0;
    if (claw.visible)
      claw.position.set(
        s.targets[0].x,
        0.57 + 0.1 * Math.sin(s.time * 7),
        s.targets[0].z,
      );
    bolts.forEach((b, i) => {
      b.visible = s.stage === 3 && !!s.attack;
      if (b.visible) {
        const u = Math.min(1, Math.max(0, 1 - s.attack.delay / 1.8 - i * 0.06));
        b.position.set(
          r.x + (s.attack.x - r.x) * u,
          1 + 2 * Math.sin(u * Math.PI),
          r.z + (s.attack.z - r.z) * u,
        );
      }
    });
    debris.forEach((m, i) => {
      m.visible = s.stun > 4.6;
      if (m.visible) {
        const u = 5.5 - s.stun;
        m.position.set(
          r.x + u * Math.sin(i * 2.4) * 3,
          0.2 + Math.sin(u * Math.PI) * 1.8,
          r.z + u * Math.cos(i * 2.4) * 3,
        );
      }
    });
    ring.visible = !!s.attack;
    if (s.attack) {
      ring.position.set(s.attack.x, 0.2, s.attack.z);
      ring.scale.setScalar(s.attack.radius);
      ring.material.color.set(s.attack.delay > 0 ? 0xffbd62 : 0xff4829);
    }
    outline.position.set(p.x, 0.19, p.z);
    outline.scale.setScalar(s.driving ? 1.65 : 0.55);
    outline.material.color.set(s.inv > 0 ? 0xff9965 : 0x8be3d2);
    const intro = s.mode === "intro" ? Math.min(1, s.intro / 2.8) : 0,
      fx = p.x * 0.48 * (1 - intro) + r.x * intro,
      fz = p.z * 0.55 * (1 - intro) + r.z * intro;
    const farDetail = quality === "low" || distance(p, r) > 10;
    for (const part of boss.body) part.geometry = farDetail ? lowBall : ball;
    const d = (w / h < 0.85 ? 21 : 15) * s.zoom * (1 - 0.32 * intro);
    camera.aspect = w / h;
    camera.position.set(fx, d * 1.05, fz + d * 0.72);
    camera.lookAt(fx, 0, fz - 1);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  return { draw, options };
}
function createMapView(host) {
  const c = document.createElement("canvas");
  host.replaceChildren(c);
  const g = c.getContext("2d");
  function draw(s) {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const k = Math.min(w / 19, h / 29) / s.zoom,
      focus = s.mode === "intro" ? s.rat : s.andi;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#333e39";
    g.fillRect(0, 0, w, h);
    g.setTransform(
      k,
      0,
      0,
      k,
      w / 2 - focus.x * k * 0.12,
      h / 2 - focus.z * k * 0.14,
    );
    g.fillStyle = "#68685c";
    g.fillRect(-8, -13, 16, 26);
    function label(x, z, symbol, color, size = 1) {
      g.fillStyle = color;
      g.font = "bold " + size + "px system-ui";
      g.textAlign = "center";
      g.fillText(symbol, x, z + 0.35);
    }
    alleyBins.forEach(([x, z], i) => {
      g.fillStyle = s.crushed.includes(i) ? "#927966" : "#2b493d";
      g.fillRect(x - 0.82, z - 1, 1.64, 2);
    });
    if (s.attack) {
      g.strokeStyle = "#ffc466";
      g.lineWidth = 0.16;
      g.beginPath();
      g.arc(s.attack.x, s.attack.z, s.attack.radius, 0, 2 * Math.PI);
      g.stroke();
    }
    s.targets.forEach((a, i) => {
      if (!a.used) label(a.x, a.z, String(i + 1), "#ffc978", 1.6);
    });
    if (s.stage === 0 && s.attack) {
      const u = 1 - s.attack.delay / levels[prefs.difficulty].warning;
      label(
        s.attack.fromX + (s.attack.x - s.attack.fromX) * u,
        s.attack.z,
        "▣",
        "#ffb65e",
        1.6,
      );
    }
    if (s.roll) {
      const u = 1 - s.roll.time / 0.65;
      label(
        s.roll.from.x + (s.roll.to.x - s.roll.from.x) * u,
        s.roll.from.z + (s.roll.to.z - s.roll.from.z) * u,
        "▣",
        "#8db790",
        1.8,
      );
    }
    label(s.car.x, s.car.z, "🚙", "#fff", 2.2);
    label(s.rat.x, s.rat.z, "🐀", "#efe6de", 1.25 * s.scale);
    s.mobs.forEach((m) => label(m.x, m.z, "🐀", "#fff"));
    if (!s.driving) label(s.andi.x, s.andi.z, "🧥", "#ff9e58", 1.4);
  }
  return { draw, options() {} };
}
