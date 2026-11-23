"use strict";
const forkNames = [
  "",
  "The Fork of Fury",
  "The Mega Fork",
  "The Conductive Fork",
  "The Fork of Destiny",
  "Windmill Fork",
  "Magnetic Fork",
  "Fork Detector",
  "Council Edition",
];
const forkLengths = [0, 3.15, 4.35, 4.35, 5.55, 5.55, 5.55, 5.55, 5.55];
const chargeTime = 0.48;
function equipFork(stage) {
  return stage
    ? {
        extended: stage > 1,
        extension: stage > 1 ? 1 : 0,
        phase: "ready",
        elapsed: 0,
        charged: false,
        source: null,
        swings: 0,
        firstFlick: true,
        burst: null,
        stagger: 0,
      }
    : null;
}
function toggleFork() {
  const f = s?.fork;
  if (s?.mode !== "play" || !f || s.stolen || f.phase !== "ready") return;
  f.extended = !f.extended;
  forkChime(f.extended);
  if (f.extended && f.firstFlick) {
    f.firstFlick = false;
    say(["Don't ask why I have this."], true);
  }
}
function forkChime(up) {
  [0, 1, 2, 3].forEach((i) =>
    tone(
      up ? 350 * Math.pow(1.6, i) : 900 / (1 + i * 0.35),
      0.19,
      i * 0.048,
      "triangle",
      0.045,
    ),
  );
}
function holdFork(source, aim) {
  const f = s?.fork;
  if (s?.mode !== "play" || !f || s.stolen || f.phase !== "ready" || s.dash > 0)
    return;
  f.assist = source !== "key" && !aim;
  if (f.assist) {
    if (!f.extended) toggleFork();
    aimAssistedFork();
  }
  if (aim) s.andi.angle = Math.atan2(aim.x - s.andi.x, aim.z - s.andi.z);
  f.phase = "holding";
  f.elapsed = 0;
  f.charged = false;
  f.source = source;
}
function releaseFork(source) {
  const f = s?.fork;
  if (s?.mode !== "play" || f?.phase !== "holding" || f.source !== source)
    return;
  if (f.assist) aimAssistedFork();
  f.charged = f.elapsed >= chargeTime;
  f.phase = "windup";
  f.elapsed = 0;
  f.angle = s.andi.angle;
  f.source = null;
  f.swings++;
}
function cancelFork() {
  if (!s?.fork) return;
  Object.assign(s.fork, {
    phase: "ready",
    elapsed: 0,
    charged: false,
    source: null,
  });
}
function forkReach() {
  return forkLengths[s.stage] + (s.time < s.reachUntil ? 2 : 0);
}
function forkLength() {
  return 1.05 + (forkReach() - 1.05) * s.fork.extension;
}
function forkLunge() {
  const f = s.fork,
    travel = f.charged ? 0.98 : 0.57;
  switch (f.phase) {
    case "holding":
      return -0.24 * Math.min(1, f.elapsed / chargeTime);
    case "windup":
      return -0.24;
    case "thrust":
      return -0.24 + (travel + 0.24) * Math.min(1, f.elapsed / 0.12);
    case "recover":
      return travel * Math.max(0, 1 - f.elapsed / 0.27);
    default:
      return 0;
  }
}
function forkBurst(at, label, kind = "spark") {
  s.fork.burst = { x: at.x, z: at.z, start: s.time, label, kind };
  tone(kind === "arc" ? 720 : 215, 0.15);
  tone(kind === "arc" ? 1040 : 400, 0.19, 0.055);
}
function forkContact(at, radius, reach, angle = s.andi.angle) {
  const p = s.andi,
    dx = Math.sin(angle),
    dz = Math.cos(angle);
  // The fork grows along Andi's right-hand axis. The same offset and tip
  // length drive both renderers. Intersect a target disc with that segment.
  const x = p.x + 0.31 * dz,
    z = p.z - 0.31 * dx;
  const along = (at.x - x) * dx + (at.z - z) * dz,
    across = Math.abs((at.x - x) * dz - (at.z - z) * dx);
  if (along < 0 || across > radius) return false;
  const contact = Math.max(
    0,
    along - Math.sqrt(radius * radius - across * across),
  );
  if (contact > reach) return false;
  for (let d = 0.2; d < contact; d += 0.18)
    if (blocked(x + dx * d, z + dz * d)) return false;
  return true;
}
function boltPoint() {
  const u = clamp(1 - s.attack.delay / 1.8, 0, 1);
  return {
    x: s.rat.x + (s.attack.x - s.rat.x) * u,
    z: s.rat.z + (s.attack.z - s.rat.z) * u,
  };
}
function resolveFork() {
  const f = s.fork,
    p = s.andi,
    reach = forkLength() + forkLunge() + 0.18;
  const hit = (at, r) => forkContact(at, r, reach);
  if (s.stage >= 5 && f.charged) {
    windmill();
    if (nightCue()?.icon === "wind" && distance(p, nightCue()) < windRadius) {
      nightAction(true);
      return;
    }
  }
  // A target uses the same lever, circuit and weak-point transaction as Act.
  const i = s.targets.findIndex((t) => !t.used && hit(t, 0.65));
  if (i >= 0 && !s.roll) {
    forkBurst(
      s.targets[i],
      s.stage === 3 ? "CIRCUIT CLOSED" : "CLINK!",
      s.stage === 3 ? "arc" : "spark",
    );
    activateTarget(i, true);
    return;
  }
  if (s.stage === 3 && s.attack && !s.attack.landed && hit(boltPoint(), 0.65)) {
    forkBurst(boltPoint(), "SHORT CIRCUIT", "arc");
    s.attack = null;
    s.attackTimer = 2.8;
    return;
  }
  const mob = s.mobs.find((m) => hit(m, 0.55));
  if (mob) {
    mob.panic = f.charged ? 0.85 : 0.55;
    mob.flee = p.angle;
    mob.tumble = 0.4;
    if (f.charged)
      for (const other of s.mobs) {
        if (other !== mob && distance(other, mob) < 3) {
          other.panic = 0.48;
          other.flee = Math.atan2(other.x - mob.x, other.z - mob.z);
        }
      }
    forkBurst(mob, "BOING!");
    say(["Fork around and find out."]);
    return;
  }
  if (!hit(s.rat, s.scale * 0.38)) return;
  if ((s.stage === 1 || s.stage === 3) && f.charged && !s.attack) {
    f.stagger = 1.25;
    s.attackTimer = Math.max(1, s.attackTimer);
    forkBurst(s.rat, "SEEING STARS");
    s.impactUntil = s.time + 0.65;
    say(["Fork around and find out."]);
  } else {
    forkBurst(s.rat, "BLOCKED");
    say(["I may need a bigger fork."]);
  }
}
function updateFork(dt) {
  const f = s.fork;
  if (!f) return;
  f.extension = clamp(
    f.extension + (f.extended ? 1 : -1) * dt * (f.assist ? 5.5 : 3.2),
    0,
    1,
  );
  f.stagger = Math.max(0, f.stagger - dt);
  if (f.phase === "ready") return;
  f.elapsed += dt;
  if (f.phase === "holding") {
    if (!f.charged && f.elapsed >= chargeTime) {
      f.charged = true;
      tone(450, 0.18);
      tone(660, 0.22, 0.09);
    }
    return;
  }
  s.andi.angle = f.angle;
  if (f.phase === "windup" && f.elapsed >= 0.1) {
    f.phase = "thrust";
    f.elapsed = 0;
    tone(f.charged ? 212 : 300, 0.13, 0, "sawtooth", 0.03);
  } else if (f.phase === "thrust" && f.elapsed >= 0.12) {
    f.phase = "recover";
    f.elapsed = 0;
    resolveFork();
  } else if (f.phase === "recover" && f.elapsed >= 0.36) cancelFork();
}
function forkTutorial() {
  const touch = touchPlay();
  const toggle = touch ? "Fork" : "F",
    attack = touch ? "Attack" : "J or left click";
  return {
    toggle,
    attack,
    lesson: [
      "",
      touch
        ? "Tap Attack near a rat or lever to auto-extend, aim and thrust. Hold for the chime, then release a charged thrust. Tap Fork to toggle."
        : "Extend with F. Face a minion or flagged lever, then tap J or left click. Hold until the chime, then release for a charged thrust.",
      "Your longer fork reaches exposed gold weak points. Approach the star, hold " +
        attack +
        " for the chime, then release.",
      "Thrust into numbered panels in sequence, or touch an incoming robot bolt with the fork to short it out.",
      "The glowing fork has its longest reach yet. Face the marked objective and thrust.",
      "Windmill Fork: hold " +
        attack +
        " until the chime and release to disperse nearby odor.",
      "Magnetic Fork: approach the latch and activate it to draw the stolen wagon back.",
      "Fork Detector: the stronger the signal, the closer the real prop. Follow the marker and inspect it.",
      "All upgrades are ready. Hold " +
        attack +
        " for the chime, then release at the intake.",
    ][s.stage],
  };
}
function forkStatus() {
  const f = s.fork;
  if (!f) return "";
  if (s.stolen) return "Fork stolen · recover it by hand";
  const { toggle, attack } = forkTutorial();
  if (f.phase === "holding")
    return f.charged ? "CHARGED · Release to thrust" : "Charging…";
  if (s.stage === 1 && f.firstFlick && !f.extended)
    return touchPlay()
      ? "Tap Attack · auto-aim & extend"
      : toggle + " · Extend the Fork of Fury";
  if (s.stage >= 5) {
    if (nightCue()?.icon === "wind")
      return "Windmill · hold " + attack + " for the chime";
    if (nightCue()?.icon === "detect")
      return "Fork Detector · follow the signal";
    if (nightCue()?.icon === "magnet")
      return "Magnetic Fork · retrieve at range";
    if (s.stage === 5) return "Windmill Fork · charged spin clears odor";
  }
  if (!f.swings) return attack + " · Thrust toward a target";
  return forkNames[s.stage] + " · " + (f.extended ? "extended" : "retracted");
}
const coarsePointer = matchMedia("(pointer:coarse)");
function touchPlay() {
  return navigator.maxTouchPoints > 0 || coarsePointer.matches;
}
function touchActionName() {
  if (s.stage >= 5) {
    if (!s.targets.some((t) => distance(t, s.andi) < USE_RADIUS)) {
      if (nearbyDecoy()) return "Check prop";
      if (nearbyCat() >= 0) return "Greet cat";
    }
    return nightCue()?.button || "Act";
  }
  if (s.stage === 0) return "Enter car";
  if (s.stage === 2 || (s.stage === 4 && s.step === 2)) return "Strike";
  return leverStage() ? "Release" : "Activate";
}
function assistedTarget() {
  const p = s.andi;
  const objectives = s.targets.filter(
    (t, i) =>
      !t.used &&
      (s.stage !== 3 || i === panelOrder[s.step]) &&
      !(s.stage === 4 && s.step === 1 && i !== 1),
  );
  const closeMob = s.mobs.filter((m) => !m.panic && distance(p, m) < 1.8);
  const candidates = [
    ...closeMob,
    ...objectives.sort((a, b) => distance(p, a) - distance(p, b)),
    ...s.mobs,
  ];
  if (s.stage === 3 && s.attack && !s.attack.landed)
    candidates.push(boltPoint());
  candidates.push(s.rat);
  for (const obj of candidates) {
    if (distance(p, obj) > forkReach() + 1.25) continue;
    const angle = Math.atan2(obj.x - p.x, obj.z - p.z);
    if (forkContact(obj, 0.65, forkReach() + 0.52, angle)) return obj;
  }
}

function aimAssistedFork() {
  const t = assistedTarget();
  if (t) s.andi.angle = Math.atan2(t.x - s.andi.x, t.z - s.andi.z);
}
