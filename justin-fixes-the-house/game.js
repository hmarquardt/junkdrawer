"use strict";
// Main game loop, bounded localStorage persistence, house navigation, Lowe's checkout, and HUD.
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function defaultSave() {
  return {
    version: 1,
    started: false,
    unlocked: 1,
    checkpoint: 1,
    best: {},
    lowesTripsTotal: 0,
    achievements: [],
    settings: {
      difficulty: "standard",
      sound: true,
    },
  };
}

let saveWarning = "";
function cleanSave(raw = {}) {
  const def = defaultSave();
  const unlocked = Number.isInteger(raw.unlocked) && raw.unlocked >= 1 && raw.unlocked <= CHAPTERS.length ? raw.unlocked : 1;
  const checkpoint = Number.isInteger(raw.checkpoint) && raw.checkpoint >= 1 && raw.checkpoint <= unlocked ? raw.checkpoint : unlocked;
  const best = {};
  for (let i = 1; i <= unlocked; i++) {
    const sec = raw.best?.[i];
    if (Number.isFinite(sec) && sec > 0 && sec < 86400) best[i] = Math.round(sec * 10) / 10;
  }
  const validAch = new Set(ACHIEVEMENTS.map((a) => a.id));
  const achievements = [...new Set(Array.isArray(raw.achievements) ? raw.achievements : [])].filter((id) => validAch.has(id));
  const s = raw.settings || {};
  return {
    version: 1,
    started: raw.started === true,
    unlocked,
    checkpoint,
    best,
    lowesTripsTotal: Number.isInteger(raw.lowesTripsTotal) && raw.lowesTripsTotal >= 0 && raw.lowesTripsTotal < 9999 ? raw.lowesTripsTotal : 0,
    achievements,
    settings: {
      difficulty: DIFFICULTIES[s.difficulty] ? s.difficulty : def.settings.difficulty,
      sound: s.sound !== false,
    },
  };
}

function loadSave() {
  try {
    const raw = localStorage.getItem(JUSTIN_SAVE_KEY);
    if (!raw) return defaultSave();
    return cleanSave(JSON.parse(raw));
  } catch {
    saveWarning = "Saved progress could not be read. Playing session-only.";
    return defaultSave();
  }
}

let campaign = loadSave();
function persistSave() {
  try {
    localStorage.setItem(JUSTIN_SAVE_KEY, JSON.stringify(campaign));
    saveWarning = "";
  } catch {
    saveWarning = "Browser storage unavailable. Progress lasts for this session.";
  }
  refreshMenu();
}

function grantAchievement(id) {
  if (!campaign.achievements.includes(id)) {
    campaign.achievements.push(id);
    persistSave();
    const meta = ACHIEVEMENTS.find((a) => a.id === id);
    if (meta && state) showToast("★ ACHIEVEMENT: " + meta.name);
  }
}

let state = null;
let rafId = 0;
let lastTs = 0;
const keys = new Set();

function makeState(chapterIdx) {
  const ch = CHAPTERS[chapterIdx];
  const repairs = {};
  for (const r of ch.repairs) {
    repairs[r.id] = { found: false, fixed: false, needsSurprise: false };
  }
  return {
    chapter: chapterIdx,
    mode: "intro", // intro | house | driving | checkout | repair | won
    time: 0,
    playSeconds: 0,
    lowesTrips: 0,
    impulsePicked: false,
    justin: { x: ch.startPos.x, y: ch.startPos.y, facing: 1, moving: false, walkTarget: null },
    repairs,
    inventory: {}, // partId -> count
    bursts: [],
    toast: "",
    toastUntil: 0,
    activeRepair: null,
    hasPartFor(r) {
      const st = this.repairs[r.id];
      const needed = st.needsSurprise ? r.surprisePart : r.part;
      return (this.inventory[needed] || 0) > 0;
    },
    missingParts() {
      const list = [];
      for (const r of CHAPTERS[this.chapter].repairs) {
        const st = this.repairs[r.id];
        if (!st.found || st.fixed) continue;
        const needed = st.needsSurprise ? r.surprisePart : r.part;
        if (!this.inventory[needed]) list.push(needed);
      }
      return [...new Set(list)];
    },
    needsLowesRun() {
      return this.missingParts().length > 0;
    },
    fixedCount() {
      return CHAPTERS[this.chapter].repairs.filter((r) => this.repairs[r.id].fixed).length;
    },
    foundCount() {
      return CHAPTERS[this.chapter].repairs.filter((r) => this.repairs[r.id].found).length;
    },
  };
}

function addBurst(x, y, text, color = "#fde68a") {
  if (!state) return;
  state.bursts.push({ x, y, text, color, start: state.time });
  if (state.bursts.length > 8) state.bursts.shift();
}

function showToast(text, duration = 3.8) {
  if (!state) return;
  state.toast = text;
  state.toastUntil = state.time + duration;
  $("quipBar").textContent = text;
}

function syncSoundButton() {
  SFX.setEnabled(campaign.settings.sound);
  $("soundBtn").textContent = "♫  SOUND " + (campaign.settings.sound ? "ON" : "OFF");
  $("soundBtn").setAttribute("aria-pressed", String(campaign.settings.sound));
}

function refreshMenu() {
  $("continueBtn").hidden = !campaign.started;
  $("startBtn").textContent = campaign.started ? "New Thanksgiving" : "▶  Start Fixing";
  $("saveStatus").textContent =
    saveWarning ||
    (campaign.started
      ? "Checkpoint · Chapter " + campaign.checkpoint + " · "
      : "") + "Progress saves locally on this device only.";

  const pills = $("campaignPills");
  const items = [];
  const cleared = Object.keys(campaign.best).length;
  if (cleared || campaign.started) items.push("Chapters cleared · " + cleared + " / " + CHAPTERS.length);
  if (campaign.lowesTripsTotal > 0) items.push("Lowe’s trips · " + campaign.lowesTripsTotal);
  if (campaign.achievements.length > 0) items.push("★ Badges · " + campaign.achievements.length + " / " + ACHIEVEMENTS.length);
  pills.innerHTML = items.map((t) => '<span class="pill">' + t + "</span>").join("");

  const grid = $("chapterGrid");
  grid.innerHTML = "";
  CHAPTERS.forEach((ch, idx) => {
    const num = idx + 1;
    const unlocked = num <= campaign.unlocked;
    const best = campaign.best[num];
    const isNext = campaign.started && num === campaign.checkpoint;
    const btn = document.createElement("button");
    btn.className = "chapterCard" + (best ? " cleared" : "") + (isNext ? " current" : "") + (!unlocked ? " locked" : "");
    const badge = best ? "✓ " + best + "s" : isNext ? "NEXT" : unlocked ? "OPEN" : "LOCKED";
    btn.innerHTML =
      '<div class="cardTop"><small>' +
      ch.code +
      '</small><i class="badge">' +
      badge +
      "</i></div>" +
      "<strong>" +
      ch.name +
      "</strong>" +
      "<span>" +
      ch.subtitle +
      "</span>" +
      '<div class="cardFixes">' +
      ch.repairs.map((r) => "<em>" + r.icon + " " + r.name + "</em>").join("") +
      "</div>";
    btn.onclick = () => {
      if (unlocked) {
        startChapter(idx);
      } else {
        openModal(
          ch.name,
          '<p class="intel">' +
            ch.code +
            " · " +
            ch.location +
            "</p><p>" +
            ch.subtitle +
            "</p><p>Clear Chapter " +
            idx +
            " to unlock this part of the house.</p>",
        );
      }
    };
    grid.append(btn);
  });
}

let lastListSig = "";
function setText(el, val) {
  if (el.textContent !== val) el.textContent = val;
}
function updateHud() {
  if (!state) return;
  const ch = CHAPTERS[state.chapter];
  const fixed = state.fixedCount();
  const total = ch.repairs.length;

  setText($("hudChapter"), ch.code + " / 0" + CHAPTERS.length);
  setText($("hudTitle"), ch.name);
  $("hudProgress").max = total;
  $("hudProgress").value = fixed;
  setText($("hudFixes"), fixed + " / " + total + " FIXED");
  setText($("hudTrips"), "LOWE’S TRIPS: " + state.lowesTrips);

  // Only rebuild the yellow legal-pad DOM when repair/inventory/mode state actually changes
  const listSig =
    state.chapter +
    "|" +
    state.mode +
    "|" +
    ch.repairs
      .map((r) => {
        const st = state.repairs[r.id];
        return [r.id, st.found ? 1 : 0, st.fixed ? 1 : 0, st.needsSurprise ? 1 : 0, state.hasPartFor(r) ? 1 : 0].join(":");
      })
      .join(",");

  if (listSig !== lastListSig) {
    lastListSig = listSig;
    const listEl = $("hardwareList");
    listEl.innerHTML = "";
    for (const r of ch.repairs) {
      const st = state.repairs[r.id];
      const partId = st.needsSurprise ? r.surprisePart : r.part;
      const part = PARTS[partId];
      const has = state.hasPartFor(r);
      const li = document.createElement("li");
      li.className = st.fixed ? "done" : !st.found ? "unfound" : has ? "ready" : "need-part";
      li.innerHTML =
        "<b>" +
        (st.fixed ? "✓ " : st.found ? r.icon + " " : "? ") +
        (st.found ? r.name : "Uninspected problem (" + r.room + ")") +
        "</b>" +
        "<small>" +
        (st.fixed
          ? "Fixed!"
          : !st.found
            ? "Walk over or click to inspect"
            : has
              ? "Have " + part.name + " — click to fix!"
              : "Need: " + part.name) +
        "</small>";
      if (!st.fixed && state.mode === "house") {
        li.style.cursor = "pointer";
        li.onclick = () => walkTo(r.x, r.y);
      }
      listEl.append(li);
    }
  }

  // Contextual primary prompt & Drive to Lowe's CTA
  const missing = state.missingParts();
  const driveBtn = $("driveLowesBtn");
  driveBtn.disabled = state.mode !== "house" || missing.length === 0;
  driveBtn.classList.toggle("pulse-cta", state.mode === "house" && missing.length > 0);
  setText(
    driveBtn,
    missing.length > 0
      ? "🛻  Drive to Lowe’s (" + missing.length + (missing.length === 1 ? " part" : " parts") + ")"
      : "🛻  Lowe’s Run (spot issues first)",
  );

  // Next objective banner
  let nextText = "";
  if (state.mode === "house") {
    const unfound = ch.repairs.find((r) => !state.repairs[r.id].found);
    const readyFix = ch.repairs.find((r) => state.repairs[r.id].found && !state.repairs[r.id].fixed && state.hasPartFor(r));
    if (readyFix) nextText = "Next: Walk to " + readyFix.name + " and press E (or click it) to fix!";
    else if (unfound) nextText = "Next: Inspect all broken items (" + state.foundCount() + "/" + total + " spotted) — click or walk with WASD.";
    else if (missing.length > 0) nextText = "Next: Head to Justin’s truck (or press Drive to Lowe’s) for " + missing.length + " part" + (missing.length > 1 ? "s" : "") + "!";
  } else if (state.mode === "driving") {
    nextText = "Steer with ←/→ or A/D (Hold ↑/W to boost) — dodge holiday traffic to Lowe’s!";
  }
  setText($("objectiveText"), nextText);

  // Contextual mobile/desktop interact button
  const nearby = nearestInteractable();
  const actBtn = $("actBtn");
  if (state.mode === "house" && nearby) {
    actBtn.hidden = false;
    setText(actBtn, nearby.label);
  } else {
    actBtn.hidden = true;
  }
}

function walkTo(tx, ty) {
  if (!state || state.mode !== "house") return;
  state.justin.walkTarget = { x: clamp(tx, 8, 92), y: clamp(ty, 10, 90) };
}

function nearestInteractable() {
  if (!state || state.mode !== "house") return null;
  const ch = CHAPTERS[state.chapter];
  const j = state.justin;
  let best = null;
  let bestDist = 14;

  for (const r of ch.repairs) {
    const st = state.repairs[r.id];
    if (st.fixed) continue;
    const d = Math.hypot(j.x - r.x, j.y - r.y);
    if (d < bestDist) {
      bestDist = d;
      const label = !st.found
        ? "Inspect " + r.name
        : state.hasPartFor(r)
          ? "Fix " + r.name
          : "Needs part from Lowe’s";
      best = { type: "repair", repair: r, label, dist: d };
    }
  }

  const truckDist = Math.hypot(j.x - ch.truckPos.x, j.y - ch.truckPos.y);
  if (truckDist < 15 && state.needsLowesRun() && truckDist < bestDist) {
    best = { type: "truck", label: "Drive to Lowe’s!", dist: truckDist };
  }
  return best;
}

function interact() {
  if (!state || state.mode !== "house") return;
  const target = nearestInteractable();
  if (!target) {
    showToast("Walk up to a pulsing hazard (!) or click directly on one to inspect it.");
    return;
  }
  if (target.type === "truck") {
    beginLowesDrive();
    return;
  }
  const r = target.repair;
  const st = state.repairs[r.id];
  if (!st.found) {
    st.found = true;
    SFX.spot();
    addBurst(r.x, r.y, "ADDED TO LIST!", "#f59e0b");
    showToast(r.inspectLine, 4.5);
    updateHud();
    return;
  }
  if (!state.hasPartFor(r)) {
    SFX.miss();
    const partId = st.needsSurprise ? r.surprisePart : r.part;
    showToast("Need " + PARTS[partId].name + " — hit Drive to Lowe’s!", 3.6);
    return;
  }
  // Chapter 3 iconic "Wrong Washer — Back to Lowe's!" surprise!
  if (r.surprisePart && !st.needsSurprise) {
    st.needsSurprise = true;
    state.inventory[r.part] = Math.max(0, (state.inventory[r.part] || 1) - 1);
    SFX.oops();
    addBurst(r.x, r.y, "WRONG SIZE!", "#f97316");
    showSceneCard(
      "CLASSIC HARDWARE MOMENT",
      "BACK TO LOWE’S!",
      r.surpriseLine,
      "The 1/2-inch flat washer won’t seat on this stem. Head back to Lowe’s for a 3/8-inch bevel washer.",
      "Let’s Make Another Run →",
      () => {
        hideSceneCard();
        beginLowesDrive();
      },
    );
    updateHud();
    return;
  }
  openRepairBench(r);
}

function openRepairBench(r) {
  state.mode = "repair";
  state.activeRepair = r;
  state.justin.walkTarget = null;
  keys.clear();

  const partId = state.repairs[r.id].needsSurprise ? r.surprisePart : r.part;
  const part = PARTS[partId];
  openModal(
    r.name,
    '<p class="intel">' +
      r.room.toUpperCase() +
      " · USING " +
      part.name.toUpperCase() +
      "</p><p>" +
      r.symptom +
      '</p><div id="repairMiniHost"></div>',
    () => {
      RepairMini.close();
      if (state && state.mode === "repair") {
        state.mode = "house";
        state.activeRepair = null;
        updateHud();
      }
    },
  );

  RepairMini.open(r, campaign.settings.difficulty, $("repairMiniHost"), {
    onComplete(rep, extra) {
      const st = state.repairs[rep.id];
      const usedPart = st.needsSurprise ? rep.surprisePart : rep.part;
      state.inventory[usedPart] = Math.max(0, (state.inventory[usedPart] || 1) - 1);
      st.fixed = true;
      RepairMini.close();
      if ($("dialog").open) $("dialog").close();
      state.mode = "house";
      state.activeRepair = null;
      addBurst(rep.x, rep.y, "FIXED! ✓", "#4ade80");
      showToast(rep.fixedLine, 4.5);
      grantAchievement("firstFix");
      if (extra?.safetyFirst) grantAchievement("safetyFirst");
      updateHud();

      if (state.fixedCount() === CHAPTERS[state.chapter].repairs.length) {
        finishChapter();
      }
    },
  });
}

function beginLowesDrive() {
  if (!state || state.mode !== "house") return;
  const missing = state.missingParts();
  if (!missing.length) {
    showToast("You already have every part on your list!");
    return;
  }
  state.mode = "driving";
  state.justin.walkTarget = null;
  state.lowesTrips++;
  campaign.lowesTripsTotal++;
  if (campaign.lowesTripsTotal >= 4 || state.lowesTrips >= 4) grantAchievement("frequentFlyer");
  persistSave();

  $("houseControls").hidden = true;
  $("driveControls").hidden = false;
  $("quipBar").textContent = "";
  state.toast = "";
  SFX.honk();

  DriveGame.start($("stageCanvas"), campaign.settings.difficulty, missing, (summary) => {
    openLowesCheckout(missing, summary);
  });
  updateHud();
}

function openLowesCheckout(missingIds, summary) {
  state.mode = "checkout";
  DriveGame.stop();
  $("driveControls").hidden = true;
  $("houseControls").hidden = false;

  const picked = new Set();
  const impulse = IMPULSE_ITEMS[state.chapter % IMPULSE_ITEMS.length];
  let boughtImpulse = false;

  const rowsHtml = missingIds
    .map((id) => {
      const p = PARTS[id];
      return (
        '<button type="button" class="aisle-item" data-part="' +
        id +
        '"><span><b>' +
        p.icon +
        " " +
        p.name +
        "</b><small>" +
        p.aisle +
        " · $" +
        p.price.toFixed(2) +
        '</small></span><i class="aisle-check">GRAB</i></button>'
      );
    })
    .join("");

  openModal(
    "LOWE’S HARDWARE · TRIP #" + state.lowesTrips,
    '<p class="intel">ARRIVED IN ' +
      summary.seconds.toFixed(1) +
      "s · " +
      (summary.bumps === 0 ? "CLEAN DRIVE" : summary.bumps + " TRAFFIC BUMP" + (summary.bumps > 1 ? "S" : "")) +
      "</p><p>Grab the parts on Justin’s yellow legal pad — and try to stay out of the tool endcaps.</p>" +
      '<div class="aisle-list">' +
      rowsHtml +
      '<button type="button" class="aisle-item impulse" id="impulseBtn"><span><b>' +
      impulse.icon +
      " " +
      impulse.name +
      "</b><small>" +
      impulse.aisle +
      " · $" +
      impulse.price.toFixed(2) +
      ' (Not on list)</small></span><i class="aisle-check">TEMPTING</i></button>' +
      "</div>" +
      '<p class="mini-status" id="checkoutMsg" role="status">Tap each listed item (or Grab All Listed) to check out.</p>' +
      '<div class="checkout-actions">' +
      '<button type="button" class="secondary" id="grabAllBtn">Grab All Listed</button>' +
      '<button type="button" class="primary" id="finishCheckoutBtn">Head Back to the House →</button>' +
      "</div>",
    () => {
      if (state && state.mode === "checkout") {
        // Auto-grant any clicked items even if closed via Escape
        picked.forEach((id) => (state.inventory[id] = (state.inventory[id] || 0) + 1));
        state.mode = "house";
        updateHud();
      }
    },
  );

  const togglePart = (btn, forceOn = false) => {
    const id = btn.dataset.part;
    if (forceOn || !picked.has(id)) {
      picked.add(id);
      btn.classList.add("picked");
      btn.querySelector(".aisle-check").textContent = "✓ IN CART";
    } else {
      picked.delete(id);
      btn.classList.remove("picked");
      btn.querySelector(".aisle-check").textContent = "GRAB";
    }
    SFX.checkout();
  };

  $("dialogContent")
    .querySelectorAll(".aisle-item[data-part]")
    .forEach((btn) => (btn.onclick = () => togglePart(btn)));

  $("grabAllBtn").onclick = () => {
    $("dialogContent")
      .querySelectorAll(".aisle-item[data-part]")
      .forEach((btn) => togglePart(btn, true));
    $("checkoutMsg").textContent = "Cart loaded! Ready to head back to the house.";
  };

  $("impulseBtn").onclick = () => {
    boughtImpulse = true;
    state.impulsePicked = true;
    grantAchievement("impulseBuy");
    SFX.oops();
    $("checkoutMsg").textContent = impulse.quip;
    $("impulseBtn").classList.add("busted");
    $("impulseBtn").querySelector(".aisle-check").textContent = "BUSTED";
  };

  $("finishCheckoutBtn").onclick = () => {
    if (picked.size === 0) {
      $("checkoutMsg").textContent = "You haven’t grabbed any parts yet! Tap the listed items or Grab All Listed.";
      SFX.miss();
      return;
    }
    picked.forEach((id) => (state.inventory[id] = (state.inventory[id] || 0) + 1));
    if (picked.size === missingIds.length && !boughtImpulse) grantAchievement("impulseResist");
    const skipped = missingIds.length - picked.size;
    state.mode = "house";
    $("dialog").close();
    showToast(
      skipped > 0
        ? "Back home! (Wait—did you forget " + skipped + " item" + (skipped > 1 ? "s" : "") + " on the list?)"
        : "Back from Lowe’s with the blue bucket loaded! Time to fix everything.",
      4.2,
    );
    updateHud();
  };
}

function finishChapter() {
  const ch = CHAPTERS[state.chapter];
  const num = state.chapter + 1;
  state.mode = "won";
  SFX.chapterWon();

  const sec = Math.max(0.1, Math.round(state.playSeconds * 10) / 10);
  campaign.best[num] = Math.min(campaign.best[num] || Infinity, sec);
  const nextNum = Math.min(CHAPTERS.length, num + 1);
  campaign.unlocked = Math.max(campaign.unlocked, nextNum);
  campaign.checkpoint = nextNum;
  if (num === CHAPTERS.length) grantAchievement("thanksgivingHero");
  persistSave();

  const isFinale = num === CHAPTERS.length;
  showSceneCard(
    isFinale ? "THANKSGIVING SAVED!" : ch.code + " COMPLETE",
    isFinale ? "DINNER’S ON THE TABLE" : ch.name,
    ch.outroLine,
    ch.outroClue + " Cleared in " + sec + "s with " + state.lowesTrips + " Lowe’s trip" + (state.lowesTrips === 1 ? "" : "s") + ".",
    isFinale ? "Return to Title" : "Next Chapter →",
    () => {
      hideSceneCard();
      if (isFinale) returnHome();
      else startChapter(state.chapter + 1);
    },
  );
}

let sceneCardAction = null;
function showSceneCard(tag, title, quote, body, btnText, onNext) {
  $("sceneTag").textContent = tag;
  $("sceneName").textContent = title;
  $("sceneLine").textContent = quote;
  $("sceneSub").textContent = body;
  $("sceneNextBtn").textContent = btnText;
  sceneCardAction = onNext;
  $("sceneCard").hidden = false;
  $("sceneNextBtn").focus({ preventScroll: true });
}

function hideSceneCard() {
  $("sceneCard").hidden = true;
  sceneCardAction = null;
}

let modalCloseCb = null;
function openModal(title, html, onClose = null) {
  $("dialogTitle").textContent = title;
  $("dialogContent").innerHTML = html;
  modalCloseCb = onClose;
  if (!$("dialog").open) $("dialog").showModal();
}

function startChapter(idx) {
  SFX.wake();
  campaign.started = true;
  campaign.checkpoint = Math.max(campaign.checkpoint, idx + 1);
  persistSave();

  state = makeState(idx);
  $("menu").hidden = true;
  $("arena").hidden = false;
  $("helpBtn").hidden = false;
  $("houseControls").hidden = false;
  $("driveControls").hidden = true;

  const ch = CHAPTERS[idx];
  showSceneCard(
    ch.code + " · " + ch.location,
    ch.name,
    ch.introLine,
    "1. Walk around (WASD / Arrows / Click) to spot all 3 broken things. 2. Drive Justin’s pickup to Lowe’s for parts. 3. Complete each repair!",
    "Start Inspection",
    () => {
      hideSceneCard();
      state.mode = "house";
      updateHud();
    },
  );
  updateHud();
  lastTs = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function returnHome() {
  cancelAnimationFrame(rafId);
  DriveGame.stop();
  RepairMini.close();
  hideSceneCard();
  if ($("dialog").open) $("dialog").close();
  state = null;
  keys.clear();
  $("arena").hidden = true;
  $("helpBtn").hidden = true;
  $("menu").hidden = false;
  refreshMenu();
  $("startBtn").focus();
}

function stepHouse(dt) {
  const j = state.justin;
  let dx = Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a"));
  let dy = Number(keys.has("arrowdown") || keys.has("s")) - Number(keys.has("arrowup") || keys.has("w"));

  if (dx || dy) {
    j.walkTarget = null;
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    j.x = clamp(j.x + dx * 32 * dt, 7, 93);
    j.y = clamp(j.y + dy * 32 * dt, 10, 90);
    if (dx !== 0) j.facing = dx > 0 ? 1 : -1;
    j.moving = true;
  } else if (j.walkTarget) {
    const vx = j.walkTarget.x - j.x;
    const vy = j.walkTarget.y - j.y;
    const dist = Math.hypot(vx, vy);
    if (dist < 1.8) {
      j.x = j.walkTarget.x;
      j.y = j.walkTarget.y;
      j.walkTarget = null;
      j.moving = false;
      // Auto-interact on arrival if we walked directly onto a hotspot or truck!
      const near = nearestInteractable();
      if (near && near.dist < 6) interact();
    } else {
      j.x += (vx / dist) * 38 * dt;
      j.y += (vy / dist) * 38 * dt;
      if (Math.abs(vx) > 0.4) j.facing = vx > 0 ? 1 : -1;
      j.moving = true;
    }
  } else {
    j.moving = false;
  }
}

function loop(ts) {
  if (!state) return;
  const dt = clamp((ts - lastTs) / 1000 || 0, 0, 0.05);
  lastTs = ts;
  state.time += dt;

  if (state.mode === "house" || state.mode === "driving" || state.mode === "repair") {
    state.playSeconds += dt;
  }

  if (state.mode === "house") {
    stepHouse(dt);
    drawHouseScene($("stageCanvas"), state);
    if (state.toast && state.time > state.toastUntil) {
      state.toast = "";
      $("quipBar").textContent = "";
    }
    updateHud();
  } else if (state.mode === "driving") {
    DriveGame.step(dt);
    updateHud();
  } else if (state.mode === "repair") {
    drawHouseScene($("stageCanvas"), state);
    RepairMini.tick(dt);
  } else {
    drawHouseScene($("stageCanvas"), state);
  }

  rafId = requestAnimationFrame(loop);
}

// --- Event Bindings ---
$("startBtn").onclick = () => startChapter(0);
$("continueBtn").onclick = () => startChapter(campaign.checkpoint - 1);
$("sceneNextBtn").onclick = () => sceneCardAction && sceneCardAction();
$("driveLowesBtn").onclick = beginLowesDrive;
$("actBtn").onclick = interact;
$("backHomeBtn").onclick = returnHome;

$("soundBtn").onclick = () => {
  campaign.settings.sound = !campaign.settings.sound;
  syncSoundButton();
  persistSave();
  if (campaign.settings.sound) SFX.click();
};

$("howBtn").onclick = () =>
  openModal(
    "HOW TO PLAY",
    "<p><b>1. Spot the Problems:</b> Walk Justin around each area with <b>WASD / Arrows</b> (or click/tap any room or pulsing <b>!</b> marker). Press <b>E</b> or click to add broken items to his Lowe’s list.</p>" +
      "<p><b>2. Make the Lowe’s Run:</b> Walk to Justin’s pickup truck (or click <b>Drive to Lowe’s</b>). Steer with <b>A/D</b> or <b>←/→</b> (hold <b>W/↑</b> to boost) through Thanksgiving traffic, then check off your parts at Lowe’s.</p>" +
      "<p><b>3. Fix Everything:</b> Return home with the blue bucket and complete each hands-on repair mini-game (torque twist, breaker wiring, spirit level, tape measure & hammer) — and watch out for the inevitable second trip to Lowe’s!</p>",
  );

$("helpBtn").onclick = () => {
  if (!state) return;
  const ch = CHAPTERS[state.chapter];
  openModal(
    ch.name + " · Field Notes",
    '<p class="intel">' +
      ch.code +
      " · " +
      ch.location +
      "</p>" +
      "<p>Spot all 3 broken items, make a Lowe’s run for the parts, and fix each item before dinner.</p>" +
      "<ul>" +
      ch.repairs
        .map((r) => "<li><b>" + r.icon + " " + r.name + ":</b> " + r.symptom + "</li>")
        .join("") +
      "</ul>",
  );
};

$("badgesBtn").onclick = () => {
  const html =
    '<div class="badge-list">' +
    ACHIEVEMENTS.map((a) => {
      const earned = campaign.achievements.includes(a.id);
      return (
        '<div class="ach-row ' +
        (earned ? "earned" : "") +
        '"><b>' +
        (earned ? "★ " : "○ ") +
        a.name +
        "</b><small>" +
        a.desc +
        "</small></div>"
      );
    }).join("") +
    "</div>";
  openModal("THANKSGIVING BADGES", html);
};

$("settingsBtn").onclick = () => {
  const opts = Object.entries(DIFFICULTIES)
    .map(
      ([k, d]) =>
        '<option value="' +
        k +
        '"' +
        (campaign.settings.difficulty === k ? " selected" : "") +
        ">" +
        d.name +
        " — " +
        d.note +
        "</option>",
    )
    .join("");
  openModal(
    "SETTINGS",
    '<label class="set-label">DIFFICULTY<select id="diffSelect">' +
      opts +
      "</select></label>" +
      (state ? '<button type="button" class="secondary" id="modalHomeBtn">Return to Title</button>' : ""),
  );
  $("diffSelect").onchange = () => {
    campaign.settings.difficulty = $("diffSelect").value;
    persistSave();
  };
  if ($("modalHomeBtn")) {
    $("modalHomeBtn").onclick = () => {
      $("dialog").close();
      returnHome();
    };
  }
};

$("resetBtn").onclick = () => {
  openModal(
    "RESET PROGRESS?",
    '<p>Clear your saved chapters, best times, Lowe’s trip count, and badges on this device?</p><button type="button" class="primary" id="confirmResetBtn">Reset All Progress</button>',
  );
  $("confirmResetBtn").onclick = () => {
    campaign = defaultSave();
    persistSave();
    $("dialog").close();
  };
};

$("dialogClose").onclick = () => $("dialog").close();
$("dialog").addEventListener("close", () => {
  if (modalCloseCb) {
    const fn = modalCloseCb;
    modalCloseCb = null;
    fn();
  }
});

// Canvas click/tap: click-to-walk in house OR tap-lane in driving!
$("stageCanvas").addEventListener("pointerdown", (e) => {
  if (!state) return;
  const rect = $("stageCanvas").getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 100;
  const ny = ((e.clientY - rect.top) / rect.height) * 100;
  if (state.mode === "house") {
    const ch = CHAPTERS[state.chapter];
    // Snap directly to a repair or truck if clicked near it
    for (const r of ch.repairs) {
      if (!state.repairs[r.id].fixed && Math.hypot(nx - r.x, ny - r.y) < 9) {
        if (Math.hypot(state.justin.x - r.x, state.justin.y - r.y) < 12) {
          interact();
        } else {
          walkTo(r.x, r.y);
        }
        return;
      }
    }
    if (state.needsLowesRun() && Math.hypot(nx - ch.truckPos.x, ny - ch.truckPos.y) < 11) {
      if (Math.hypot(state.justin.x - ch.truckPos.x, state.justin.y - ch.truckPos.y) < 15) {
        beginLowesDrive();
      } else {
        walkTo(ch.truckPos.x, ch.truckPos.y);
      }
      return;
    }
    walkTo(nx, ny);
  } else if (state.mode === "driving") {
    const lane = nx < 38 ? 0 : nx > 62 ? 2 : 1;
    DriveGame.setLane(lane);
  }
});

// Touch drive controls
$("driveLeft").onpointerdown = (e) => { e.preventDefault(); DriveGame.shiftLane(-1); };
$("driveRight").onpointerdown = (e) => { e.preventDefault(); DriveGame.shiftLane(1); };
$("driveBoost").onpointerdown = (e) => { e.preventDefault(); DriveGame.setBoost(true); };
$("driveBoost").onpointerup = () => DriveGame.setBoost(false);
$("driveBoost").onpointercancel = () => DriveGame.setBoost(false);

// Touch D-pad for house
document.querySelectorAll(".dpad button").forEach((b) => {
  const k = b.dataset.key;
  const down = (e) => { e.preventDefault(); keys.add(k); b.classList.add("held"); };
  const up = () => { keys.delete(k); b.classList.remove("held"); };
  b.addEventListener("pointerdown", down);
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("pointerleave", up);
});

// Keyboard controls
addEventListener("keydown", (e) => {
  if (!state) return;
  const k = e.key.toLowerCase();
  if (state.mode === "repair") {
    if (RepairMini.onKeyDown(k)) e.preventDefault();
    return;
  }
  if ($("dialog").open) return;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  keys.add(k);
  if (e.repeat) return;
  if (state.mode === "house" && (k === "e" || k === " ")) interact();
  if (state.mode === "driving") {
    if (k === "arrowleft" || k === "a") DriveGame.shiftLane(-1);
    if (k === "arrowright" || k === "d") DriveGame.shiftLane(1);
    if (k === "arrowup" || k === "w" || k === " ") DriveGame.setBoost(true);
  }
});

addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (state?.mode === "repair") RepairMini.onKeyUp(k);
  if (state?.mode === "driving" && (k === "arrowup" || k === "w" || k === " ")) DriveGame.setBoost(false);
});

addEventListener("blur", () => {
  keys.clear();
  DriveGame.setBoost(false);
});

// Deterministic read-only + test helpers for Playwright verification
window.__JUSTIN_TEST__ = {
  getState: () => state,
  getCampaign: () => campaign,
  startChapter,
  beginLowesDrive,
  finishDriveNow: () => {
    const d = DriveGame.getState();
    if (d) {
      d.dist = d.targetDist;
      DriveGame.step(0.016);
    }
  },
  completeActiveRepair: () => {
    const r = RepairMini.getState();
    if (r && !r.done) {
      r.done = true;
      r.callbacks.onComplete(r.repair, { safetyFirst: true });
    }
  },
};

syncSoundButton();
refreshMenu();
$("startBtn").disabled = false;
