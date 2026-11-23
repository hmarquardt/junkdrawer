"use strict";
const $ = (id) => document.getElementById(id);
const alleyBins = [
  [-6, -7],
  [6, -6],
  [-6, 4],
  [6, 6],
];
const cases = [
  {
    name: "The Commuter",
    type: "Car interception",
    sub: "Andi has a class to teach. The alley rat has other plans.",
    line: "I've had students with better attendance than you.",
    clue: "He drops a tiny transit pass. Someone has stamped it KING OF THE BINS.",
  },
  {
    name: "The Dumpster King",
    type: "Environmental combat",
    sub: "His royal court is about to get flattened.",
    line: "Well, I didn't pack for this.",
    clue: "Under the royal lid, a municipal growth permit. Approved for thirty feet.",
  },
  {
    name: "Ratzilla",
    type: "Weak-point strikes",
    sub: "The zoning board regrets its decision.",
    line: "That is not a normal Chicago rat.",
    clue: "The growth permit carries a lab signature. Professor Ratington wants his specimen back.",
  },
  {
    name: "Professor Ratington",
    type: "Circuit puzzle",
    sub: "Peer review has gone poorly.",
    line: "Great. Another unlicensed educator.",
    clue: "The console prints a receipt. All lab expenses paid by the Ratfather.",
  },
  {
    name: "The Ratfather",
    type: "Three-phase showdown",
    sub: "An offer you can absolutely refuse.",
    line: "I'm going to mark this whole family absent.",
    clue: "The last rat tips his hat, backs into the drain, and pulls the lid shut.",
  },
];
const levels = {
  story: { health: 7, speed: 0.76, warning: 1.8 },
  normal: { health: 5, speed: 1, warning: 1.45 },
  rush: { health: 4, speed: 1.2, warning: 1.15 },
};
const prefs = { difficulty: "story", quality: "high", sound: true };
const keys = new Set(),
  route = [
    [-5, 7],
    [-5.96, 4],
    [-4.4, 2],
    [4.3, 1],
    [6, -3],
    [5, -4],
    [2, -5],
    [-4, -4],
    [-5, 1],
  ];
let s,
  view,
  audio,
  ambient,
  last = 0,
  frame = 0,
  dialogPaused = false;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (x, z) => ({ x, z, angle: Math.PI, speed: 0 });
const target = (x, z) => ({ x, z, used: false });
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
function tone(freq, len = 0.1, delay = 0, wave = "triangle", vol = 0.06) {
  if (!audio || !prefs.sound) return;
  const o = audio.createOscillator(),
    g = audio.createGain(),
    t = audio.currentTime + delay;
  o.type = wave;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g);
  g.connect(audio.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}
function unlockSound() {
  if (!prefs.sound || !window.AudioContext) return;
  if (!audio) {
    audio = new AudioContext();
    const buffer = audio.createBuffer(
        1,
        audio.sampleRate * 2,
        audio.sampleRate,
      ),
      data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      low = (low + 0.05 * (Math.random() * 2 - 1)) / 1.05;
      data[i] = low;
    }
    ambient = audio.createGain();
    ambient.gain.value = 0.07;
    const road = audio.createBufferSource();
    road.buffer = buffer;
    road.loop = true;
    road.connect(ambient);
    ambient.connect(audio.destination);
    road.start();
  }
  audio.resume().catch(() => {});
}
function resetStage(stage) {
  const hp = levels[prefs.difficulty].health;
  s = {
    stage,
    fork: equipFork(stage),
    mode: "intro",
    stick: { x: 0, z: 0 },
    economy: false,
    time: 0,
    intro: 0,
    andi: point(-2, 8),
    car: point(-2, 5.7),
    rat: point(0, -2),
    scale: [1.15, 2.15, 4.7, 2, 3.2][stage],
    driving: false,
    hp,
    maxHp: hp,
    boss: [1, 2, 2, 3, 3][stage],
    mobs: [],
    targets: [],
    crushed: [],
    attack: null,
    attackTimer: 2.6,
    stun: 0,
    inv: 0,
    dash: 0,
    dodgeWait: 0,
    lastLine: -10,
    lineUntil: 0,
    route: 0,
    rest: 0,
    zoom: s?.zoom || 1,
    step: 0,
    actionWait: 0,
    locateUntil: 0,
    receiptUntil: 0,
    impactUntil: 0,
    lastNear: 0,
  };
  if (stage === 0) s.rat = point(-5, 5);
  if (stage === 1 || stage === 4) {
    s.targets = [target(-4.2, 4), target(4.2, -6)];
    s.mobs = [stage === 1 ? point(-4.9, 2.4) : point(-3, -2), point(3, -3)];
  }
  if (stage === 3) s.targets = [target(-4, 3), target(0, -6), target(4, 4)];
  $("bhealth").max = s.boss;
  $("health").max = hp;
  $("chapter").textContent = "ENCOUNTER 0" + (stage + 1) + " / 05";
  $("boss").textContent = cases[stage].name;
  $("quote").textContent = "";
  $("forkButtons").hidden = !stage;
  $("finish").hidden = true;
  showCard(
    "BOSS ENTRANCE",
    cases[stage].name,
    cases[stage].sub,
    cases[stage].line,
    "BEGIN FIGHT",
  );
  [0, 1, 2, 3].forEach((n) =>
    tone(
      (103 + stage * 19) * [1, 1.2, 1.5, 2][n],
      0.34,
      n * (0.15 + stage * 0.012),
    ),
  );
  syncHud();
}
function showCard(tag, name, sub, line, button) {
  const briefingCard = s.mode === "intro" || s.mode === "phase";
  $("missionBrief").hidden = !briefingCard;
  $("missionBrief").innerHTML = briefingCard ? briefing() : "";
  $("sceneCard").hidden = false;
  $("sceneTag").textContent = tag;
  $("sceneName").textContent = name;
  $("sceneSub").textContent = sub;
  $("sceneLine").textContent = line ? "“" + line + "”" : "";
  $("utensilFilm").hidden = !(
    s.fork &&
    ((briefingCard && s.mode === "intro") ||
      (s.mode === "won" && s.stage === 4))
  );
  $("award").hidden = !(s.mode === "won" && s.fork?.achievement);
  $("next").textContent = button;
  $("next").focus({ preventScroll: true });
}
function play() {
  s.mode = s.mode === "paused" ? s.resumeMode : "play";
  $("sceneCard").hidden = true;
  keys.clear();
  syncHud();
}
function syncHud() {
  $("health").value = s.hp;
  $("bhealth").value = s.boss;
}
function say(lines, force = false) {
  if (!force && s.time - s.lastLine < 5) return;
  s.lastLine = s.time;
  s.lineUntil = s.time + 3.5;
  $("quote").textContent =
    "“" + lines[Math.floor(Math.random() * lines.length)] + "”";
}
function strike() {
  s.boss--;
  tone(187, 0.23);
  tone(281, 0.28, 0.12);
  if (!s.boss) {
    keys.clear();
    if (s.stage === 4) {
      s.mode = "finale";
      s.fork.finaleStart = s.time;
      $("finish").hidden = false;
    } else victoryCard();
  }
  syncHud();
}
function victoryCard() {
  s.mode = "won";
  $("finish").hidden = true;
  const end = s.stage === 4;
  showCard(
    end ? "CAMPAIGN COMPLETE" : "ENCOUNTER CLEARED",
    end ? "FIRST BELL" : cases[s.stage].name,
    cases[s.stage].clue,
    end ? "Somebody better cover my first period." : "",
    end ? "Return to title" : "Next encounter →",
  );
}
function hurt() {
  if (s.inv > 0 || s.mode !== "play") return;
  if (s.dash > 0) {
    say(["Absolutely not.", "I'm putting in for a personal day."]);
    return;
  }
  s.hp--;
  s.inv = 1.9;
  tone(72, 0.26, 0, "sawtooth");
  const v = document.createElement("div");
  v.className = "hit";
  $("view").append(v);
  setTimeout(() => v.remove(), 240);
  if (s.hp <= 0) {
    s.mode = "lost";
    showCard(
      "CHECKPOINT",
      "PERSONAL DAY",
      "Even Chicago allows a do-over.",
      "I'll take that from the top.",
      "Retry encounter",
    );
  }
  syncHud();
}
function dodge() {
  if (s?.mode !== "play" || s.dodgeWait > 0) return;
  cancelFork();
  s.dash = 0.65;
  s.dodgeWait = 1.2;
  tone(248, 0.08);
  if (s.attack && distance(s.andi, s.attack) < s.attack.radius + 0.65)
    say(["Absolutely not.", "I'm putting in for a personal day."]);
}
function action() {
  if (s?.mode !== "play" || s.actionWait > 0) return;
  s.actionWait = 0.23;
  if (s.stage === 0) {
    if (!s.driving && distance(s.andi, s.car) < CAR_RADIUS) {
      s.driving = true;
      Object.assign(s.andi, s.car);
      tone(93, 0.3);
      syncHud();
    } else if (!s.driving) s.locateUntil = s.time + 3;
    return;
  }
  if (s.roll) return;
  const index = s.targets.findIndex(
    (t) => !t.used && distance(t, s.andi) < USE_RADIUS,
  );
  if (index < 0) {
    s.locateUntil = s.time + 3;
    return;
  }
  activateTarget(index, false);
}
function activateTarget(index, byFork) {
  if (s.stage === 3 && index !== panelOrder[s.step]) {
    s.step = 0;
    s.targets.forEach((t) => (t.used = false));
    tone(83, 0.2);
    say(["Wrong circuit. Two, one, three."], true);
    s.boss = 3;
    syncHud();
    return;
  }
  if (s.stage === 4 && s.step === 1 && index !== 1) {
    say(["Panel two. I can read a seating chart."]);
    return;
  }
  const t = s.targets[index];
  t.used = true;
  if (s.stage === 1 || (s.stage === 4 && s.step === 0)) {
    s.crushed.push(index === 0 ? 2 : 1);
    s.roll = { byFork, from: { ...t }, to: { ...s.rat }, time: 0.65 };
    s.receipt =
      s.stage === 1
        ? "CART RELEASED — " + s.targets.filter((t) => t.used).length + " OF 2"
        : "CART RELEASED";
    s.receiptUntil = s.time + 3.5;
    tone(360, 0.12);
    tone(150, 0.3, 0.1, "triangle");
    s.mobs.pop();
    if (s.boss === 1 || s.stage === 4) s.mode = "impact";
    return;
  }
  finishAction(byFork);
}
function finishAction(byFork) {
  s.step++;
  s.stun = 0;
  if (s.stage === 4 && s.step === 3) {
    s.fork.extended = true;
    s.fork.extension = 1;
    s.andi.angle = Math.atan2(s.rat.x - s.andi.x, s.rat.z - s.andi.z);
    s.fork.burst = null;
    forkChime(true);
  }
  if (s.boss === 1 && (byFork || s.stage === 4)) s.fork.achievement = true;
  strike();
  if (s.mode === "won" || s.mode === "finale") return;
  if (s.stage === 2) {
    s.targets = [];
    s.attackTimer = 1.5;
  }
  if (s.stage === 4) {
    s.attack = null;
    s.attackTimer = 1.7;
    s.targets = s.step === 1 ? [target(-3, -3), target(4, 3)] : [];
    s.mobs = [];
    s.mode = "phase";
    showCard(
      "THE RATFATHER · PHASE " + (s.step + 1),
      s.step === 1 ? "HOSTILE TAKEOVER" : "LAST LUNGE",
      s.step === 1
        ? "His suit switches to backup power."
        : "He tosses his hat into the ring.",
      s.step === 1
        ? "He has a backup suit?"
        : "You're about to become a four-course meal.",
      "BEGIN PHASE",
    );
    tone(124, 0.32);
  }
  syncHud();
}
function blocked(x, z) {
  const r = s.driving ? 0.74 : 0.3;
  if (Math.abs(x) > 7.8 - r || Math.abs(z) > 12 - r) return true;
  if (
    !s.driving &&
    Math.abs(x - s.car.x) < 0.75 + r &&
    Math.abs(z - s.car.z) < 1.45 + r
  )
    return true;
  return alleyBins.some(
    ([bx, bz]) => Math.abs(x - bx) < 0.85 + r && Math.abs(z - bz) < 1 + r,
  );
}
function moveAndi(dt) {
  const p = s.andi,
    dx =
      s.stick.x +
      Number(keys.has("arrowright") || keys.has("d")) -
      Number(keys.has("arrowleft") || keys.has("a")),
    dz =
      s.stick.z +
      Number(keys.has("arrowdown") || keys.has("s")) -
      Number(keys.has("arrowup") || keys.has("w"));
  const len = Math.hypot(dx, dz);
  p.speed = len ? (s.driving ? 8 : 5.8) * (s.dash > 0 ? 1.65 : 1) : 0;
  if (!len) return;
  p.angle = Math.atan2(dx, dz);
  const x = p.x + (dx / len) * p.speed * dt,
    z = p.z + (dz / len) * p.speed * dt;
  if (!blocked(x, p.z)) p.x = x;
  if (!blocked(p.x, z)) p.z = z;
  if (s.driving) Object.assign(s.car, p);
}
function track(p, x, z, speed, dt) {
  const dx = x - p.x,
    dz = z - p.z,
    len = Math.hypot(dx, dz);
  if (len < 0.01) return;
  p.angle = Math.atan2(dx, dz);
  p.speed = Math.min(speed, (p.speed || 0) + dt * 24);
  const step = Math.min(len, p.speed * dt);
  p.x += (step * dx) / len;
  p.z += (step * dz) / len;
}
function commuter(dt) {
  const r = s.rat,
    p = s.andi,
    d = distance(r, p);
  if (s.driving && p.speed > 0 && d < 1.6) {
    strike();
    return;
  }
  if (s.rest > 0) {
    s.rest -= dt;
    r.angle = Math.atan2(p.x - r.x, p.z - r.z);
    r.speed = 0;
    if (d > 2 || s.rest > 0.32) return;
    s.rest = 0;
  }
  const [x, z] = route[s.route];
  track(r, x, z, (d < 3.6 ? 6.5 : 3.8) * levels[prefs.difficulty].speed, dt);
  if (Math.hypot(r.x - x, r.z - z) < 0.15) {
    s.route = (s.route + 1) % route.length;
    s.rest = s.route % 3 === 0 ? 0.68 : 0.16;
  }
  if (s.driving && d < 3.4) s.lastNear = s.time;
  if (s.lastNear && d > 4.4) {
    say([
      "That's the third time this week.",
      "I saw you coming, you little jerk.",
    ]);
    s.lastNear = 0;
  }
}
// A runaway municipal cart crosses the interception lane. Its destination
// stays fixed from the first warning so either steering or dodging is sufficient.
function looseCart(dt) {
  if (!s.attack) {
    s.attackTimer -= dt;
    if (s.attackTimer <= 0) {
      const x = s.andi.x,
        z = s.andi.z;
      s.attack = {
        x,
        z,
        fromX: x < 0 ? 7 : -7,
        radius: 1.65,
        delay: levels[prefs.difficulty].warning,
      };
      tone(330, 0.12);
      say(["Somebody left the wheels unlocked."]);
    }
    return;
  }
  s.attack.delay -= dt;
  if (s.attack.delay <= 0) {
    if (distance(s.attack, s.andi) < s.attack.radius) hurt();
    s.attack = null;
    s.attackTimer = 5;
  }
}
function enemies(dt) {
  const p = s.andi,
    r = s.rat,
    level = levels[prefs.difficulty];
  s.mobs.forEach((m, i) => {
    if (m.panic > 0) {
      m.panic -= dt;
      m.tumble = Math.max(0, (m.tumble || 0) - dt);
      const x = m.x + Math.sin(m.flee) * dt * 6,
        z = m.z + Math.cos(m.flee) * dt * 6;
      if (!blocked(x, m.z)) m.x = x;
      if (!blocked(m.x, z)) m.z = z;
      return;
    }
    if (
      s.fork.phase === "holding" &&
      s.fork.charged &&
      distance(m, p) < 2.7 &&
      s.time > (m.evadeUntil || 0)
    ) {
      m.evadeUntil = s.time + 5;
      m.panic = 0.22;
      m.flee = p.angle + ((i ? 1 : -1) * Math.PI) / 2;
      return;
    }
    track(m, p.x + Math.sin(s.time + i) * 0.5, p.z, 1.45 * level.speed, dt);
    if (distance(m, p) < 0.64) {
      hurt();
      m.x = i ? 4 : -4;
      m.z = -5;
    }
  });
  if (s.fork.stagger > 0) return;
  if (s.stun > 0) {
    s.stun -= dt;
    if (s.stun <= 0) {
      s.targets = [];
      syncHud();
    }
    return;
  }
  if (s.attack) {
    const a = s.attack;
    a.delay -= dt;
    if (a.delay <= 0 && !a.landed) {
      a.landed = true;
      tone(56, 0.36);
      if (distance(p, a) < a.radius) hurt();
      if (s.stage === 2 || (s.stage === 4 && s.step === 2)) {
        r.x = a.x;
        r.z = a.z;
        const bin = alleyBins.findIndex(
          ([x, z]) => Math.hypot(x - a.x, z - a.z) < BAIT_RADIUS,
        );
        if (bin >= 0 || s.stage === 4) {
          if (bin >= 0 && !s.crushed.includes(bin)) s.crushed.push(bin);
          s.stun = 5.5;
          s.targets = [target(clamp(a.x * 0.74, -5, 5), a.z * 0.82)];
          s.attack = null;
          syncHud();
          return;
        }
      }
    }
    if (a.delay < -0.38) {
      s.attack = null;
      s.attackTimer = 1.9;
    }
    return;
  }
  track(r, Math.sin(s.time * 0.5) * 2, -2 + Math.cos(s.time * 0.45), 1.3, dt);
  s.attackTimer -= dt;
  if (s.attackTimer <= 0) {
    s.attack = {
      x: p.x,
      z: p.z,
      radius: s.stage === 2 ? 2.65 : 2.05,
      delay: level.warning,
      landed: false,
    };
    tone(s.stage === 3 ? 520 : 156, 0.14);
  }
}
function advance() {
  if (!s) return;
  if (["intro", "phase", "paused"].includes(s.mode)) play();
  else if (s.mode === "won") {
    if (s.stage === 4) home();
    else resetStage(s.stage + 1);
  } else if (s.mode === "lost") resetStage(s.stage);
}
function pause() {
  if (s?.mode === "play" || s?.mode === "impact") {
    if (s.fork?.phase === "holding") cancelFork();
    s.resumeMode = s.mode;
    resetStick();
    keys.clear();
    s.mode = "paused";
    showCard(
      "CAMPAIGN PAUSED",
      "HOLD THE BELL",
      $("objective").textContent,
      "",
      "Resume",
    );
  } else if (s?.mode === "paused") play();
}
function loop(now) {
  if (!s || !view) return;
  view.performance?.(now - last);
  const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
  last = now;
  if (s.mode === "intro" && !$("dialog").open) {
    s.time += dt;
    s.intro += dt;
  }
  if (s.mode === "play") {
    s.time += dt;
    for (const key of ["dash", "inv", "actionWait", "dodgeWait"])
      s[key] = Math.max(0, s[key] - dt);
    moveAndi(dt);
    updateFork(dt);
    if (s.stage === 0) {
      commuter(dt);
      if (s.mode === "play" && s.driving) looseCart(dt);
    } else if (s.mode === "play") enemies(dt);
    if (s.lineUntil && s.time > s.lineUntil) {
      $("quote").textContent = "";
      s.lineUntil = 0;
    }
  }
  if (s.mode === "impact" && !$("dialog").open) s.time += dt;
  if (s.roll && ["play", "impact"].includes(s.mode) && !$("dialog").open) {
    s.roll.time -= dt;
    if (s.roll.time <= 0 && !s.roll.hit) {
      s.roll.hit = true;
      s.impactUntil = s.time + 0.85;
      tone(67, 0.24, 0, "sawtooth", 0.045);
      tone(108, 0.16, 0.08);
      if (s.mode === "play") {
        const { byFork } = s.roll;
        s.roll = null;
        finishAction(byFork);
      }
    }
    if (s.roll?.time < -0.45) {
      const { byFork } = s.roll;
      s.roll = null;
      finishAction(byFork);
    }
  }
  if (s.mode === "finale" && !$("dialog").open) {
    s.time += dt;
    const elapsed = s.time - s.fork.finaleStart;
    if (elapsed >= 0.36 && !s.fork.burst)
      forkBurst(s.rat, "FOUR-COURSE FINALE", "confetti");
    if (elapsed >= 1.65) victoryCard();
  }
  if (s.mode === "won" && s.stage === 4 && !$("dialog").open) s.time += dt;
  view.draw(s);
  updateMission();
  drawForkEffects();
  frame = requestAnimationFrame(loop);
}
function start() {
  unlockSound();
  document.body.classList.add("playing");
  document.body.classList.toggle("phone", touchPlay());
  $("menu").hidden = true;
  $("arena").hidden = false;
  $("help").hidden = false;
  if (!view) view = createAlleyView($("view"), prefs.quality);
  resetStage(0);
  window.scrollTo(0, 0);
  last = performance.now();
  frame = requestAnimationFrame(loop);
}
function home() {
  cancelAnimationFrame(frame);
  keys.clear();
  resetStick();
  s = null;
  document.body.classList.remove("playing", "phone");
  $("arena").hidden = true;
  $("help").hidden = true;
  $("menu").hidden = false;
  view?.dispose();
  view = null;
  audio?.close().catch(() => {});
  audio = null;
  ambient = null;
  $("start").focus();
}
function modal(title, html) {
  dialogPaused = s?.mode === "play" || s?.mode === "impact";
  if (dialogPaused) pause();
  $("dialogTitle").textContent = title;
  $("content").innerHTML = html;
  $("dialog").showModal();
}
const controlCopy =
  "<p>From the Dumpster King onward, F extends the fork. Tap J or left click to thrust. Hold for the chime and release to charge. On phones, Attack aims and extends automatically.</p><p><b>Move or steer</b> with WASD or the arrow keys. On touchscreens, hold the direction pad.</p><p><b>E / Act</b> enters the car, releases bins, strikes weak points and operates panels. Drive into the first rat to intercept it.</p><p><b>Space / Dodge</b> gives Andi a moment of protection. Amber rings show where an attack will land.</p><p><b>+ / −</b> adjusts camera distance. Camera zoom is also in Settings. Use <b>P</b> to pause.</p>";
$("help").onclick = () => modal(cases[s.stage].name, briefing());
$("how").onclick = () => modal("CONTROLS", controlCopy);
$("settings").onclick = () => {
  modal(
    "SETTINGS",
    '<label>DIFFICULTY<select id="difficulty"><option value="story">Story</option><option value="normal">Standard</option><option value="rush">Rush hour</option></select></label><label>VISUAL QUALITY<select id="quality"><option value="high">High · shadows</option><option value="low">Low · compact resolution</option></select></label>' +
      (s
        ? '<label>CAMERA DISTANCE<input id="zoom" type="range" min=".8" max="1.4" step=".1"></label><button id="back">Return to title</button>'
        : ""),
  );
  for (const k of ["difficulty", "quality"]) {
    $(k).value = prefs[k];
    $(k).onchange = () => {
      prefs[k] = $(k).value;
      if (k === "quality") view?.options(prefs.quality);
      else if (s) {
        const hp = levels[prefs.difficulty].health;
        s.hp = clamp(s.hp + hp - s.maxHp, 1, hp);
        s.maxHp = hp;
        $("health").max = hp;
        syncHud();
      }
    };
  }
  if (s) {
    $("zoom").value = s.zoom;
    $("zoom").oninput = () => (s.zoom = +$("zoom").value);
    $("back").onclick = () => {
      dialogPaused = false;
      $("dialog").close();
      home();
    };
  }
};
$("close").onclick = () => $("dialog").close();
$("dialog").onclose = () => {
  if (dialogPaused && s?.mode === "paused") play();
  dialogPaused = false;
};
$("sound").onclick = () => {
  prefs.sound = !prefs.sound;
  if (prefs.sound) unlockSound();
  else audio?.suspend();
  $("sound").textContent = "♫　 SOUND " + (prefs.sound ? "ON" : "OFF");
  $("sound").setAttribute("aria-pressed", prefs.sound);
};
cases.forEach((c, i) => {
  const b = document.createElement("button");
  b.innerHTML =
    "<small>ACT 0" +
    (i + 1) +
    "</small><strong>" +
    c.name +
    "</strong><span>" +
    c.type +
    " ↗</span>";
  b.onclick = () =>
    modal(
      c.name,
      '<p class="intel">ACT 0' +
        (i + 1) +
        " / " +
        c.type.toUpperCase() +
        "</p><p>" +
        c.sub +
        "</p><p>“" +
        c.line +
        "”</p>",
    );
  $("files").append(b);
});
$("finish").onclick = victoryCard;
$("start").onclick = start;
$("next").onclick = advance;
$("pause").onclick = pause;
function thumbButton(el, fn) {
  el.onpointerdown = (e) => {
    if (e.button === 0) {
      e.preventDefault();
      fn();
    }
  };
  el.onclick = (e) => {
    if (e.detail === 0) fn();
  };
}
thumbButton($("touchAction"), action);
thumbButton($("touchDodge"), dodge);
const pad = document.querySelector(".pad");
let stickPointer = null;
function resetStick() {
  if (s) s.stick = { x: 0, z: 0 };
  stickPointer = null;
  pad.removeAttribute("data-held");
  for (const b of pad.querySelectorAll("button")) b.classList.remove("pressed");
}
function steerTouch(e) {
  if (stickPointer !== e.pointerId || s?.mode !== "play") return;
  const r = pad.getBoundingClientRect(),
    x = (e.clientX - r.left) / r.width - 0.5,
    z = (e.clientY - r.top) / r.height - 0.5;
  const len = Math.hypot(x, z);
  s.stick = len < 0.09 ? { x: 0, z: 0 } : { x: x / len, z: z / len };
  pad.dataset.held = "true";
  for (const b of pad.querySelectorAll("button"))
    b.classList.toggle(
      "pressed",
      {
        arrowleft: -s.stick.x,
        arrowright: s.stick.x,
        arrowup: -s.stick.z,
        arrowdown: s.stick.z,
      }[b.dataset.key] > 0.35,
    );
}
pad.onpointerdown = (e) => {
  if (s?.mode !== "play" || stickPointer !== null) return;
  stickPointer = e.pointerId;
  pad.setPointerCapture(e.pointerId);
  steerTouch(e);
};
pad.onpointermove = steerTouch;
pad.onlostpointercapture = (e) => {
  if (e.pointerId === stickPointer) resetStick();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetStick();
    keys.clear();
    if (s?.mode === "play" || s?.mode === "impact") pause();
    audio?.suspend();
  } else if (s && prefs.sound) audio?.resume().catch(() => {});
});
addEventListener("keydown", (e) => {
  if (!s || $("dialog").open) return;
  const k = e.key.toLowerCase();
  if (
    s.mode === "play" &&
    ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)
  )
    e.preventDefault();
  keys.add(k);
  if (e.repeat) return;
  if (k === "p" || k === "escape") pause();
  if (k === "?") $("help").click();
  if (k === "f") toggleFork();
  if (k === "j") holdFork("key");
  if (k === "e") action();
  if (k === " ") dodge();
  if (k === "+" || k === "=") s.zoom = clamp(s.zoom - 0.1, 0.8, 1.4);
  if (k === "-") s.zoom = clamp(s.zoom + 0.1, 0.8, 1.4);
});
addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
  if (e.key.toLowerCase() === "j") releaseFork("key");
});
addEventListener("blur", () => {
  keys.clear();
  if (s?.mode === "play" || s?.mode === "impact") pause();
});

thumbButton($("forkToggle"), toggleFork);
for (const el of [$("touchAttack"), $("view")]) {
  el.addEventListener("pointerdown", (e) => {
    if (
      e.button !== 0 ||
      s?.mode !== "play" ||
      !s.fork ||
      (el === $("view") && e.pointerType !== "mouse")
    )
      return;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    holdFork(
      e.pointerId,
      el === $("view")
        ? view.aim(e.clientX - rect.left, e.clientY - rect.top)
        : null,
    );
  });
  el.addEventListener("pointerup", (e) => releaseFork(e.pointerId));
  el.addEventListener("lostpointercapture", (e) => {
    if (s?.fork?.source === e.pointerId) cancelFork();
  });
}
