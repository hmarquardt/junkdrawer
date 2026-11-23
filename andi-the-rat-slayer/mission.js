// Shared by the briefing, tracker and both views. Coordinates and activation
// distances refer to the same floor plane as collision and action().
const USE_RADIUS = 2.4,
  CAR_RADIUS = 3,
  BAIT_RADIUS = 3.5;
const panelOrder = [1, 0, 2];
function inputs() {
  const touch = matchMedia("(pointer: coarse)").matches;
  return touch
    ? {
        move: "the direction pad",
        act: "Tap Act",
        dodge: "Tap Dodge",
        dodgeKey: "Dodge",
      }
    : {
        move: "WASD or the arrow keys",
        act: "Press E",
        dodge: "Press Space",
        dodgeKey: "Space",
      };
}
function briefing() {
  const { act, move, dodge, dodgeKey } = inputs();
  const releaseSteps = [
    "Find the two glowing cart-release controls.",
    `Walk close to a control using ${move}.`,
    act + " to release a rolling dumpster.",
    "Activate both controls to defeat the Dumpster King.",
    "Dodge his minions while moving between controls.",
  ];
  const missions = [
    [
      "Intercept the rat with Andi’s car.",
      [
        "Approach the blue car. " + act + " to enter.",
        "Steer across the rat’s path to intercept it.",
      ],
      "Runaway carts and the rat’s quick turns.",
    ],
    [
      "Defeat the Dumpster King.",
      releaseSteps,
      "Minions chase Andi. Amber rings mark incoming hits.",
    ],
    [
      "Strike two exposed weak points.",
      [
        "Stand beside a green dumpster to draw a stomp.",
        dodge +
          " as the impact ring closes. Approach the gold weak point. " +
          act +
          " to strike.",
      ],
      "The stomp hits hard. Each opening lasts only a few seconds.",
    ],
    [
      "Override three panels.",
      [
        "Follow the numbered panels in order: 2 → 1 → 3.",
        act + " inside the marked ring at each panel.",
      ],
      "Targeted projectiles. A wrong panel resets the sequence.",
    ],
    [
      [
        "Defeat the Ratfather in three phases. First, break his barricade.",
        [
          "Approach either cart-release lever. " +
            act +
            " to send a dumpster into his barricade.",
        ],
        "His minions and marked attacks.",
      ],
      [
        "Cut power to his suit.",
        ["Follow the marker to panel 2. " + act + " inside its ring."],
        "The suit targets your position. Dodge the impact.",
      ],
      [
        "Land the final strike.",
        [
          "Bait his lunge. " + dodge + " at impact.",
          "Approach the exposed gold weak point. " + act + " before it closes.",
        ],
        "His lunge and the short vulnerability window.",
      ],
    ][Math.min(s.step, 2)],
  ];
  const [goal, how, watch] = missions[s.stage];
  return (
    "<h3>YOUR MISSION</h3><dl><dt>Goal</dt><dd>" +
    goal +
    "</dd><dt>How</dt><dd><ol>" +
    how.map((line) => "<li>" + line + "</li>").join("") +
    "</ol></dd><dt>Watch out</dt><dd>" +
    watch +
    "</dd><dt>Controls</dt><dd>" +
    move +
    " · " +
    act +
    " to interact · " +
    dodgeKey +
    " to dodge</dd></dl>"
  );
}
function leverStage() {
  return s.stage === 1 || (s.stage === 4 && s.step === 0);
}
function missionObjects() {
  function mark(
    at,
    label,
    kind,
    radius,
    verb = "",
    eligible = true,
    used = false,
  ) {
    return {
      at,
      label,
      kind,
      radius,
      verb,
      eligible,
      used,
      dist: distance(s.andi, at),
    };
  }
  if (s.stage === 0)
    return [
      s.driving
        ? mark(s.rat, "Commuter", "rat", 1.6)
        : mark(s.car, "Blue car", "car", CAR_RADIUS, "enter"),
    ];
  if (s.stun > 0 && s.targets.length)
    return [mark(s.targets[0], "Weak point", "weak", USE_RADIUS, "strike")];
  if (s.stage === 2)
    return alleyBins.map(([x, z], i) =>
      mark({ x, z }, "Dumpster " + (i + 1), "bait", BAIT_RADIUS),
    );
  return s.targets.map((t, i) => {
    const lever = leverStage(),
      eligible = lever || i === (s.stage === 3 ? panelOrder[s.step] : 1);
    return mark(
      t,
      (lever ? "Release " : "Panel ") + (i + 1),
      lever ? "lever" : "panel",
      USE_RADIUS,
      lever ? "release cart" : "activate panel " + (i + 1),
      eligible,
      t.used,
    );
  });
}
function navigation(obj) {
  const dx = obj.at.x - s.andi.x,
    dz = obj.at.z - s.andi.z;
  return (
    ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"][
      (Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8
    ] +
    " " +
    Math.round(obj.dist) +
    " m"
  );
}
function setCopy(el, value) {
  if (el.textContent !== value) el.textContent = value;
}
function updateMission() {
  const live = s.mode === "play";
  $("guideLayer").hidden = !live && s.mode !== "impact";
  document.querySelector(".brief").hidden = !live && s.mode !== "impact";
  if (!live && s.mode !== "impact") return;
  const objects = missionObjects(),
    next = objects
      .filter((o) => o.eligible && !o.used)
      .sort((a, b) => a.dist - b.dist)[0];
  const inside = next && next.dist < next.radius;
  const count = s.targets.filter((t) => t.used).length;
  const progress = [
    s.driving ? "In the car · rat still loose" : "On foot · find the car",
    `Cart releases activated: ${count} / 2`,
    `Weak points struck: ${s.step} / 2`,
    `Panels overridden: ${s.step} / 3`,
    `Phase ${Math.min(s.step + 1, 3)} / 3`,
  ][s.stage];
  setCopy(
    $("missionGoal"),
    s.stage === 0 ? "Intercept the Commuter" : "Defeat " + cases[s.stage].name,
  );
  setCopy($("progress"), progress);
  let task = next
    ? "Reach " + next.label.toLowerCase()
    : "Bait his lunge, then dodge.";
  if (next?.kind === "rat") task = "Steer into the rat’s path";
  if (next?.kind === "bait")
    task = inside
      ? "Stay beside this dumpster until he targets you"
      : "Lure the stomp beside " + next.label.toLowerCase();
  if (next?.kind === "weak") task = "Strike the exposed weak point";
  if (next?.kind === "lever")
    task = "Reach highlighted cart release " + next.label.split(" ")[1];
  if (s.mode === "impact") task = "Watch the dumpster hit";
  setCopy(
    $("objective"),
    "Next · " + task + (next ? "  " + navigation(next) : ""),
  );
  const { act, dodge } = inputs();
  // Credit approach only for a new best distance, so pacing or an enemy moving
  // while Andi stands still does not postpone the stuck hints.
  const progressKey = [s.stage, s.step, s.driving].join("/");
  if (progressKey !== s.guideKey) {
    s.guideKey = progressKey;
    s.progressAt = s.time;
    s.bestDistances = {};
  }
  if (next) {
    const best = s.bestDistances[next.label];
    if (best === undefined) s.bestDistances[next.label] = next.dist;
    else if (s.andi.speed > 0 && next.dist < best - 0.8) {
      s.bestDistances[next.label] = next.dist;
      s.progressAt = s.time;
    }
  }
  const idle = s.time - s.progressAt,
    urgent =
      s.attack &&
      !s.attack.landed &&
      distance(s.andi, s.attack) <= s.attack.radius + 0.2;
  let instruction = "";
  if (inside && next.verb) instruction = act + " to " + next.verb;
  else if (urgent)
    instruction =
      s.attack.delay < 0.64
        ? dodge + " to dodge the impact"
        : "Impact marked · move out or dodge at impact";
  else if (s.time < s.locateUntil && next)
    instruction =
      "Follow " + next.label + " " + navigation(next) + " to its ring.";
  else if (s.time < s.locateUntil)
    instruction = "Wait for his lunge, dodge, then follow the gold weak point.";
  else if (idle >= 30 && next)
    instruction =
      "Move toward the highlighted " +
      next.label.toLowerCase() +
      (next.verb ? " and " + act.toLowerCase() + "." : ".");
  else if (idle >= 15)
    instruction = leverStage()
      ? "Those glowing controls operate the carts."
      : task + ".";
  else if (s.stage === 3) instruction = "Activate panels in order: 2 → 1 → 3";
  else if (next?.kind === "weak")
    instruction = "Get close and " + act.toLowerCase() + " to strike.";
  if (s.mode === "impact") instruction = "";
  setCopy($("instruction"), instruction);
  $("guideLayer").classList.toggle(
    "beacon",
    idle >= 30 || s.time < s.locateUntil,
  );
  setCopy($("receipt"), s.time < s.receiptUntil ? s.receipt : "");
  drawMissionMarkers(objects, next);
}
const markerPool = [];
function drawMissionMarkers(objects, next) {
  const w = $("view").clientWidth,
    h = $("view").clientHeight;
  const project = view.project;
  for (let i = 0; i < Math.max(markerPool.length, objects.length); i++) {
    if (!markerPool[i]) {
      const pin = document.createElement("span"),
        range = document.createElementNS("http://www.w3.org/2000/svg", "path");
      $("pins").append(pin);
      $("ranges").append(range);
      markerPool.push({ pin, range });
    }
    const { pin, range } = markerPool[i],
      o = objects[i];
    pin.hidden = !o;
    range.style.display = "none";
    if (!o) {
      pin.className = "pin";
      continue;
    }
    const active = o === next;
    const pos = project(o.at.x, o.at.z, o.kind === "weak" ? 1.4 : 1.9);
    const edge = pos.x < 54 || pos.x > w - 54 || pos.y < 139 || pos.y > h - 150;
    pin.hidden = edge && !active && (o.kind !== "lever" || o.used);
    if (pin.hidden) {
      pin.className = "pin";
      continue;
    }
    const x = clamp(pos.x, 58, w - 58),
      y = clamp(pos.y, 139, h - 150);
    pin.className =
      "pin" +
      (active ? " primaryPin" : "") +
      (o.used ? " complete" : "") +
      (edge ? " edge" : "");
    const symbol = o.used
      ? "✓"
      : o.kind === "weak"
        ? "✦"
        : o.kind === "lever"
          ? "⚑"
          : o.kind === "panel"
            ? "▣"
            : "◆";
    const edgeArrow = edge
      ? ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"][
          (Math.round(Math.atan2(pos.y - y, pos.x - x) / (Math.PI / 4)) + 8) % 8
        ] + " "
      : "";
    setCopy(
      pin,
      edgeArrow +
        symbol +
        " " +
        o.label +
        (o.used ? " · used" : active && o.kind === "lever" ? " · nearest" : ""),
    );
    pin.style.left = x + "px";
    pin.style.top = y + "px";
    if (o.used || (!active && o.kind !== "lever")) continue;
    range.style.display = "";
    range.setAttribute("class", active ? "activeRange" : "");
    const points = [];
    for (let j = 0; j < 24; j++) {
      const a = (j * Math.PI) / 12,
        p = project(
          o.at.x + o.radius * Math.cos(a),
          o.at.z + o.radius * Math.sin(a),
          0.08,
        );
      points.push(p.x.toFixed(1) + " " + p.y.toFixed(1));
    }
    range.setAttribute("d", "M" + points.join(" L") + " Z");
  }
  const impact = $("impact");
  impact.hidden = !(s.impactUntil > s.time);
  if (!impact.hidden) {
    const p = project(s.rat.x, s.rat.z, s.scale * 0.95);
    impact.style.left = clamp(p.x, 56, w - 56) + "px";
    impact.style.top = clamp(p.y, 45, h - 50) + "px";
  }
}
