// Each cue installs the actual world object used by the HUD, collisions and fork assist.
const nightCases = [
  {
    name: "The Stinkfather",
    type: "Alley ventilation",
    sub: "You thought the rats were bad?",
    line: "That is a whole new category of problem.",
    clue: "The skunk staggers into a laundromat. His fan has stripped the lid off a warehouse full of stolen lunchboxes.",
    goal: "Air out the alley and send the skunk packing.",
    how: [
      "Start the exhaust fan to blow the cloud back.",
      "Strike the dizzy skunk at the gold star.",
    ],
    threat: "Green odor rings swell before the cloud spreads.",
  },
  {
    name: "Trash Panda Supreme",
    type: "Fork heist",
    sub: "Your property is now his property.",
    line: "You have opposable thumbs. That's cheating.",
    clue: "The raccoon returns everything except a single mitten. His getaway manifest lists a witness who is already lying very still.",
    goal: "Recover your fork and repossess the stolen goods.",
    how: [
      "The thief hid your fork behind a dumpster. Follow the evidence tag and retrieve it by hand.",
      "Use the magnetic fork on the steel latch to reel in his getaway wagon.",
    ],
    threat:
      "Watch for spring-lid traps and flying lunchboxes. The stuffed raccoon is a decoy.",
  },
  {
    name: "The Possum of Doom",
    type: "Playing detective",
    sub: "Death is merely a suggestion.",
    line: "Didn't I already beat you?",
    clue: "The opossum bows from inside the prop coffin. The playbill credits three producers and one suspiciously complicated machine.",
    goal: "Close the opossum’s three backstage escape routes.",
    how: [
      "Ignore the curtain calls. Follow the detector to each hidden stage prop.",
      "When the fork glows, inspect the prop. Seal all three exits.",
    ],
    threat:
      "He changes hiding places after every false victory. Keep following the detector.",
  },
  {
    name: "The Midnight Menagerie",
    type: "Three-animal conspiracy",
    sub: "One alley. Three suspects. An unlicensed fog machine.",
    line: "Who approved the overtime?",
    clue: "Three cats sit on the master controls. The machine coughs up confetti, the animals scatter, and Sir Chonkington yawns.",
    goal: "Disable the wildlife contraption and open the catwalk.",
    how: [
      "Windmill away the fog over the intake using a charged attack.",
      "Magnetize the stolen brake, then find the real master switch with the detector.",
    ],
    threat:
      "The skunk fogs the intake, the raccoon rewires the brakes and the opossum plays dead at a dummy switch.",
  },
];
const nightRoutes = [
  [
    {
      x: -3.9,
      z: 4,
      label: "Exhaust fan",
      verb: "start fan",
      button: "Ventilate",
      icon: "fan",
      result: "FAN ON · fresh air! The skunk is dizzy.",
    },
    {
      x: 2,
      z: -2,
      label: "Dizzy skunk",
      verb: "strike the star",
      button: "Strike",
      icon: "weak",
      result: "THE AIR IS CLEAR",
    },
  ],
  [
    {
      x: 4.4,
      z: -4,
      label: "Stolen fork",
      verb: "recover fork",
      button: "Recover",
      icon: "loot",
      result: "FORK RECOVERED · Magnet online.",
    },
    {
      x: -3.4,
      z: 2,
      label: "Getaway latch",
      verb: "pull the latch",
      button: "Magnetize",
      icon: "magnet",
      result: "STOLEN GOODS RETURNED",
    },
  ],
  [
    {
      x: -3.5,
      z: 3,
      label: "Trapdoor rope",
      verb: "seal trapdoor",
      button: "Inspect",
      icon: "detect",
      art: "rope",
      result: "ENCORE? · A paw slips through the curtain.",
    },
    {
      x: 3.2,
      z: -5,
      label: "Hollow crate",
      verb: "seal crate",
      button: "Inspect",
      icon: "detect",
      art: "crate",
      result: "SECOND ENCORE · The corpse takes a bow.",
    },
    {
      x: 4,
      z: 5,
      label: "Prop coffin",
      verb: "close the lid",
      button: "Inspect",
      icon: "detect",
      art: "coffin",
      result: "CURTAIN CALL · all exits sealed.",
    },
  ],
  [
    {
      x: 2.7,
      z: 5,
      label: "Fog intake",
      verb: "clear fog",
      button: "Windmill",
      icon: "wind",
      result: "INTAKE CLEAR · the raccoon stole the brake!",
    },
    {
      x: 3.3,
      z: -3,
      label: "Stolen brake",
      verb: "retrieve brake",
      button: "Magnetize",
      icon: "magnet",
      result: "BRAKE ENGAGED · find the real switch.",
    },
    {
      x: 3.4,
      z: 5,
      label: "Catwalk switch",
      verb: "open catwalk",
      button: "Inspect",
      icon: "detect",
      result: "CAT COUNCIL IN SESSION",
    },
  ],
];
const catCouncil = [
  { x: -5.8, z: 8, name: "Sir Chonkington", color: "#df9244", perch: "box" },
  { x: 5.5, z: 1, name: "Madame Meatball", color: "#343944", perch: "vent" },
  {
    x: -5.6,
    z: -3,
    name: "The Honorable Biscuit",
    color: "#929ba4",
    perch: "step",
  },
];
function nightCue() {
  return nightRoutes[s.stage - 5]?.[s.step];
}
function installNightCue() {
  const cue = nightCue();
  s.targets = [{ ...cue, used: false }];
  if (cue.icon === "weak") Object.assign(s.rat, { x: cue.x, z: cue.z });
  s.decoys = [];
  if (s.stage === 7 || (s.stage === 8 && s.step === 2)) {
    s.decoys = [
      { x: -3.7, z: -1.6, icon: "dummy" },
      { x: 2, z: 1, icon: "dummy" },
    ];
  }
  if (s.stage === 7) {
    s.curtainAt = s.time;
    s.encoreAt = s.time + 1;
    const spots = [
      [-1, -1],
      [4, -5],
      [-4, 5],
    ];
    s.hideout = spots[s.step];
  }
}
function initNight() {
  s.clouds = [];
  s.catReady = [0, 0, 0];
  s.decoys = [];
  s.reachUntil = 0;
  s.stolen = s.stage === 6;
  s.treatAt = { x: -3.8, z: 7 };
  installNightCue();
}
function receipt(text, seconds = 3.4) {
  s.receipt = text;
  s.receiptUntil = s.time + seconds;
}
const windRadius = 5.7;
function windmill() {
  s.clouds = s.clouds.filter((c) => distance(c, s.andi) > windRadius);
  s.spinUntil = s.time + 0.6;
  forkBurst(s.andi, "WHOOSH!", "arc");
  tone(165, 0.3, 0, "sine");
}
function nightAction(byFork) {
  const cue = nightCue();
  if (!cue || (s.stolen && byFork)) return;
  if (cue.icon === "wind" && !(byFork && s.fork.charged)) {
    receipt(
      touchPlay()
        ? "Hold Attack for the chime, then release."
        : "Hold J for the chime, then release.",
    );
    return;
  }
  if (cue.icon === "fan") {
    s.clouds = [];
    s.gustUntil = s.time + 3;
    s.airFrom = { ...cue };
    tone(525, 0.45, 0, "sine");
  }
  if (cue.icon === "loot") {
    s.stolen = false;
    unlockFork(7);
    persistCampaign();
    forkChime(true);
  }
  if (cue.icon === "magnet") {
    s.recall = { from: { ...s.rat }, to: { ...s.andi }, start: s.time };
    forkBurst(cue, "MAGNETIC RECALL", "arc");
  }
  if (cue.icon === "detect") {
    tone(920, 0.12);
    tone(1170, 0.19, 0.13);
  }
  receipt(cue.result, 4);
  s.targets = [];
  s.step++;
  s.attack = null;
  s.attackTimer = 2.8;
  if (s.stage === 8 && s.boss === 1) {
    s.mode = "council";
    s.councilStart = s.time;
    s.targets = [];
    return;
  }
  if (cue.icon === "magnet" && s.boss === 1) {
    s.fork.achievement = true;
    s.mode = "recall";
    s.targets = [];
    return;
  }
  if (byFork && s.boss === 1) s.fork.achievement = true;
  strike();
  if (s.mode === "play") installNightCue();
}
function nearbyDecoy() {
  return s.decoys?.find((t) => distance(s.andi, t) < USE_RADIUS);
}
function nearbyCat() {
  if (!s?.catReady || s.mode !== "play") return -1;
  return catCouncil.findIndex(
    (cat, i) => s.catReady[i] <= s.time && distance(cat, s.andi) < 2.15,
  );
}
function greetCat(i) {
  s.catReady[i] = s.time + 25;
  const treat = campaign.treats > 0;
  if (treat) {
    campaign.treats--;
    persistCampaign();
  }
  if (!treat && Math.random() < 0.34) {
    receipt(
      catCouncil[i].name.toUpperCase() + " HAS CHOSEN NOT TO PARTICIPATE.",
    );
    return;
  }
  if (i === 0) s.inv = Math.max(s.inv, 9);
  if (i === 1) {
    s.hp = Math.min(s.maxHp, s.hp + 2);
    syncHud();
  }
  if (i === 2) s.reachUntil = s.time + 15;
  receipt(
    [
      "CHONKINGTON APPROVES · 9 s protection",
      "MEATBALL’S BLESSING · +2 patience",
      "BISCUIT NOTICED · 15 s extra reach",
    ][i],
  );
  tone(215, 0.18, 0, "sine");
  tone(320, 0.21, 0.12, "sine");
}
function nightTick(dt) {
  const cue = nightCue(),
    p = s.andi;
  const bit = 1 << (s.stage - 5);
  if (!(campaign.collected & bit) && distance(p, s.treatAt) < 1.4) {
    campaign.collected |= bit;
    campaign.treats = Math.min(3, campaign.treats + 1);
    persistCampaign();
    receipt("POCKETED A CAT TREAT · greet a council member.");
  }
  if (s.stage === 7 && s.time - s.curtainAt < 1) {
    track(s.rat, ...s.hideout, 8, dt);
  }
  if (s.stage === 7 && s.time >= (s.encoreAt || 0)) {
    s.encoreAt = Infinity;
    receipt(
      [
        "VICTORY…? · His tail is still moving.",
        "AN ENCORE · New crate, same possum.",
        "FINAL BOW…? · Check the prop coffin.",
      ][s.step],
    );
    tone(390, 0.22);
    tone(493, 0.19, 0.14);
    tone(285, 0.26, 0.31);
  }
  if (s.stage === 7 || (s.stage === 5 && cue.icon === "weak")) return;
  const fog = s.stage === 5 || (s.stage === 8 && s.step === 0);
  const burglar = s.stage === 6 || (s.stage === 8 && s.step === 1);
  track(
    s.rat,
    burglar
      ? Math.sin(s.time * 0.8) > 0
        ? -5
        : 5
      : Math.sin(s.time * 0.45) * 2.3,
    burglar ? -4 : -1.5,
    burglar ? 3.6 : 1.2,
    dt,
  );
  for (const c of s.clouds) {
    c.life -= dt;
    c.radius = Math.min(2.9, c.radius + dt * 0.75);
    if (distance(c, p) < c.radius && s.dash <= 0) hurt();
  }
  s.clouds = s.clouds.filter((c) => c.life > 0);
  if (s.mode !== "play") return;
  if (s.attack) {
    const a = s.attack;
    a.delay -= dt;
    if (a.delay <= 0) {
      if (fog) s.clouds.push({ x: a.x, z: a.z, radius: 0.8, life: 4 });
      else if (distance(p, a) < a.radius && s.dash <= 0) {
        // A stolen lunchbox knocks Andi sideways, while a spring lid deals patience damage.
        if (a.lunch) {
          const x = p.x + (p.x > 0 ? -1 : 1);
          if (!blocked(x, p.z)) p.x = x;
          receipt("LUNCHBOX EXPRESS");
        } else hurt();
      }
      s.attack = null;
      s.attackTimer = fog ? 3.4 : 2.5;
    }
  } else if ((s.attackTimer -= dt) <= 0) {
    s.attack = {
      x: p.x,
      z: p.z,
      radius: fog ? 2.2 : 1.7,
      delay: levels[prefs.difficulty].warning + 0.45,
      lunch: burglar && !s.lastLunch,
    };
    s.lastLunch = s.attack.lunch;
    tone(fog ? 110 : 640, 0.16, 0, fog ? "sawtooth" : "triangle");
  }
}
