"use strict";
// Four tactile interactive repair mini-games:
// 1. "torque"  — hold & release in green snug zone (bulb / porch deck screws)
// 2. "wiring"  — safety shutoff + 3 ordered steps + power/water back on (switch / outdoor spigot)
// 3. "level"   — center oscillating spirit bubble / laser beam & fasten 3x (hinge / gutter / sensor)
// 4. "measure" — pull tape measure / strike hammer in mark zone 3x (storm door / fence pickets)

const RepairMini = (() => {
  let active = null;

  function open(repair, difficultyKey, hostEl, callbacks) {
    const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.standard;
    active = {
      repair,
      diff,
      host: hostEl,
      callbacks,
      done: false,
      stepCount: 0,
      goalSteps: 3,
      // Timing / gauge state
      value: 0,
      dir: 1,
      holding: false,
      zoneCenter: 0.68,
      zoneHalf: 0.14 * diff.sweetSpot,
      // Wiring / plumbing state
      shutoff: false,
      wiredSteps: [false, false, false],
      zapped: false,
      status: repair.miniPrompt,
    };

    if (repair.miniGame === "torque") {
      active.goalSteps = repair.id === "bulb" ? 2 : 3;
      renderTorque();
    } else if (repair.miniGame === "wiring") {
      renderWiring();
    } else if (repair.miniGame === "level") {
      active.zoneCenter = 0.5;
      active.zoneHalf = 0.15 * diff.sweetSpot;
      active.value = 0.15;
      renderOscillator("level");
    } else {
      active.zoneCenter = 0.72;
      active.zoneHalf = 0.13 * diff.sweetSpot;
      active.value = 0.1;
      renderOscillator("measure");
    }
    return active;
  }

  function close() {
    active = null;
  }

  function setMsg(text, tone = "") {
    if (!active) return;
    active.status = text;
    const el = active.host.querySelector(".mini-status");
    if (el) {
      el.textContent = text;
      el.className = "mini-status" + (tone ? " " + tone : "");
    }
  }

  function completeRepair(extra = {}) {
    if (!active || active.done) return;
    active.done = true;
    SFX.fixed();
    const cb = active.callbacks.onComplete;
    const repair = active.repair;
    setTimeout(() => cb(repair, extra), 220);
  }

  // --- 1. TORQUE HOLD & RELEASE ---
  function renderTorque() {
    const a = active;
    const label = a.repair.id === "bulb" ? "Hold to Twist Bulb" : "Hold to Drive Screw";
    const pctLeft = (a.zoneCenter - a.zoneHalf) * 100;
    const pctWidth = a.zoneHalf * 200;
    a.host.innerHTML =
      '<div class="mini-wrap">' +
      '<div class="mini-steps"><span>PROGRESS</span><b class="mini-count">0 / ' +
      a.goalSteps +
      "</b></div>" +
      '<div class="mini-track"><div class="mini-zone" style="left:' +
      pctLeft +
      "%;width:" +
      pctWidth +
      '%"></div><div class="mini-needle" style="left:0%"></div></div>' +
      '<p class="mini-status" role="status">' +
      a.status +
      "</p>" +
      '<button type="button" class="primary mini-act" id="miniHoldBtn">' +
      label +
      " (or Space)</button>" +
      "</div>";
    const btn = a.host.querySelector("#miniHoldBtn");
    const down = (e) => {
      if (e.type === "pointerdown" && e.button !== 0) return;
      e.preventDefault();
      if (!active || active.done) return;
      active.holding = true;
      SFX.drill();
    };
    const up = (e) => {
      if (!active || !active.holding) return;
      e?.preventDefault?.();
      releaseTorque();
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
  }

  function releaseTorque() {
    if (!active || active.done) return;
    const a = active;
    a.holding = false;
    const dist = Math.abs(a.value - a.zoneCenter);
    if (dist <= a.zoneHalf) {
      a.stepCount++;
      SFX.pickup();
      const counter = a.host.querySelector(".mini-count");
      if (counter) counter.textContent = a.stepCount + " / " + a.goalSteps;
      if (a.stepCount >= a.goalSteps) {
        setMsg("Snug and true! Repair complete!", "ok");
        completeRepair();
      } else {
        a.value = 0;
        a.zoneCenter = 0.52 + Math.random() * 0.28;
        const zone = a.host.querySelector(".mini-zone");
        if (zone) zone.style.left = (a.zoneCenter - a.zoneHalf) * 100 + "%";
        setMsg("Nice! Fasten #" + (a.stepCount + 1) + " of " + a.goalSteps + " in the green zone.", "ok");
      }
    } else {
      SFX.miss();
      setMsg(
        a.value < a.zoneCenter
          ? "A little loose — hold until the needle hits green!"
          : "Easy! Almost overtightened — release inside the green zone!",
        "warn",
      );
      a.value = 0;
    }
  }

  // --- 2. WIRING / PLUMBING SAFETY SEQUENCE ---
  function renderWiring() {
    const a = active;
    const isPlumb = a.repair.wiringMode === "plumbing";
    const steps = isPlumb
      ? [
          { label: "1. Pull Old Stem", color: "#94a3b8" },
          { label: "2. Wrap Teflon Tape (3x)", color: "#e2e8f0" },
          { label: "3. Seat 3/8\" Bevel Washer", color: "#3b82f6" },
        ]
      : [
          { label: "1. Black Hot → Brass Screw", color: "#f59e0b" },
          { label: "2. White Neutral → Silver Screw", color: "#cbd5e1" },
          { label: "3. Bare Copper → Green Ground", color: "#4ade80" },
        ];
    a.host.innerHTML =
      '<div class="mini-wrap">' +
      '<div class="breaker-row">' +
      "<span>" +
      (isPlumb ? "MAIN SPIGOT SHUTOFF VALVE" : "CIRCUIT BREAKER #14") +
      "</span>" +
      '<button type="button" class="breaker-btn live" id="breakerBtn">' +
      (isPlumb ? "WATER: ON" : "POWER: ON") +
      "</button>" +
      "</div>" +
      '<div class="wire-list">' +
      steps
        .map(
          (st, idx) =>
            '<button type="button" class="wire-btn" data-wire="' +
            idx +
            '"><i style="background:' +
            st.color +
            '"></i><span>' +
            st.label +
            '</span><b class="wire-state">TODO</b></button>',
        )
        .join("") +
      "</div>" +
      '<p class="mini-status" role="status">' +
      a.status +
      "</p>" +
      "</div>";

    const breaker = a.host.querySelector("#breakerBtn");
    breaker.onclick = () => {
      if (!active || active.done) return;
      const allWired = a.wiredSteps.every(Boolean);
      if (!a.shutoff) {
        a.shutoff = true;
        breaker.textContent = isPlumb ? "WATER: OFF (SAFE)" : "POWER: OFF (SAFE)";
        breaker.className = "breaker-btn safe";
        SFX.click();
        setMsg(
          isPlumb
            ? "Water shut off! Now complete all 3 sealing steps in order."
            : "Breaker OFF! Safe to wire — connect all 3 terminals.",
          "ok",
        );
      } else if (allWired) {
        breaker.textContent = isPlumb ? "WATER: ON · DRY!" : "POWER: ON · SOLID!";
        breaker.className = "breaker-btn restored";
        SFX.click();
        setMsg(
          isPlumb ? "Zero drips under full pressure!" : "Crisp click, bright light, up to code!",
          "ok",
        );
        completeRepair({ safetyFirst: !a.zapped });
      } else {
        SFX.miss();
        setMsg("Finish all 3 steps before turning it back ON!", "warn");
      }
    };

    a.host.querySelectorAll(".wire-btn").forEach((btn) => {
      btn.onclick = () => {
        if (!active || active.done) return;
        const idx = Number(btn.dataset.wire);
        if (a.wiredSteps[idx]) return;
        if (!a.shutoff) {
          a.zapped = true;
          SFX.zap();
          setMsg(
            isPlumb
              ? "SPLASH! Cold water right in the face — shut OFF the valve first!"
              : "ZAP! That circuit is live — flip the breaker OFF first!",
            "warn",
          );
          return;
        }
        const nextExpected = a.wiredSteps.indexOf(false);
        if (idx !== nextExpected) {
          SFX.miss();
          setMsg("Do step " + (nextExpected + 1) + " first!", "warn");
          return;
        }
        a.wiredSteps[idx] = true;
        btn.classList.add("wired");
        btn.querySelector(".wire-state").textContent = "✓ DONE";
        SFX.drill();
        if (a.wiredSteps.every(Boolean)) {
          setMsg(
            isPlumb
              ? "All sealed! Turn the water valve back ON to pressure test."
              : "All 3 wires tight! Flip the breaker back ON to test.",
            "ok",
          );
        } else {
          setMsg("Tight! Continue to step " + (idx + 2) + ".", "ok");
        }
      };
    });
  }

  // --- 3 & 4. OSCILLATING BUBBLE LEVEL / LASER / TAPE MEASURE / HAMMER ---
  function renderOscillator(kind) {
    const a = active;
    const isMeasure = kind === "measure";
    const isFence = a.repair.id === "fence";
    const isSensor = a.repair.id === "sensor";
    const pctLeft = (a.zoneCenter - a.zoneHalf) * 100;
    const pctWidth = a.zoneHalf * 200;
    const actionLabel = isFence
      ? "Strike Nail (Space)"
      : isMeasure
        ? "Snap-Cut at 36\" (Space)"
        : isSensor
          ? "Lock Laser Beam (Space)"
          : "Drive Fastener (Space)";
    const trackClass = isFence
      ? "mini-track cedar"
      : isMeasure
        ? "mini-track tape"
        : isSensor
          ? "mini-track laser"
          : "mini-track bubble";

    a.host.innerHTML =
      '<div class="mini-wrap">' +
      '<div class="mini-steps"><span>' +
      (isFence ? "NAILS DRIVEN" : isMeasure ? "CLEAN CUTS" : isSensor ? "BEAM LOCKS" : "LEVEL FASTENERS") +
      '</span><b class="mini-count">0 / ' +
      a.goalSteps +
      "</b></div>" +
      '<div class="' +
      trackClass +
      '"><div class="mini-zone" style="left:' +
      pctLeft +
      "%;width:" +
      pctWidth +
      '%"></div><div class="mini-needle ' +
      (kind === "level" ? "bubble-dot" : "") +
      '" style="left:15%"></div></div>' +
      '<p class="mini-status" role="status">' +
      a.status +
      "</p>" +
      '<button type="button" class="primary mini-act" id="miniTapBtn">' +
      actionLabel +
      "</button>" +
      "</div>";

    a.host.querySelector("#miniTapBtn").onclick = () => triggerOscillator();
  }

  function triggerOscillator() {
    if (!active || active.done) return;
    const a = active;
    const dist = Math.abs(a.value - a.zoneCenter);
    if (dist <= a.zoneHalf) {
      a.stepCount++;
      if (a.repair.id === "fence") SFX.hammer();
      else SFX.drill();
      const counter = a.host.querySelector(".mini-count");
      if (counter) counter.textContent = a.stepCount + " / " + a.goalSteps;
      if (a.stepCount >= a.goalSteps) {
        setMsg("Dead on! Repair complete!", "ok");
        completeRepair();
      } else {
        setMsg("Solid hit (" + a.stepCount + " / " + a.goalSteps + ")! Catch the next pass!", "ok");
      }
    } else {
      SFX.miss();
      setMsg("Slightly off mark — wait until the indicator enters the green zone!", "warn");
    }
  }

  function tick(dt) {
    if (!active || active.done) return;
    const a = active;
    if (a.repair.miniGame === "torque") {
      if (a.holding) {
        a.value = Math.min(1, a.value + dt * 0.72);
        if (a.value >= 1) releaseTorque();
      } else {
        a.value = Math.max(0, a.value - dt * 1.4);
      }
    } else if (a.repair.miniGame === "level" || a.repair.miniGame === "measure") {
      const speed = (a.repair.miniGame === "measure" ? 0.92 : 0.78) / Math.sqrt(a.diff.sweetSpot);
      a.value += a.dir * dt * speed;
      if (a.value >= 0.96) {
        a.value = 0.96;
        a.dir = -1;
      } else if (a.value <= 0.04) {
        a.value = 0.04;
        a.dir = 1;
      }
    } else {
      return;
    }

    const needle = a.host.querySelector(".mini-needle");
    const track = a.host.querySelector(".mini-track");
    if (needle) needle.style.left = a.value * 100 + "%";
    if (track) track.classList.toggle("in-zone", Math.abs(a.value - a.zoneCenter) <= a.zoneHalf);
  }

  function onKeyDown(k) {
    if (!active || active.done) return false;
    if (k !== " " && k !== "enter") return false;
    if (active.repair.miniGame === "torque") {
      if (!active.holding) {
        active.holding = true;
        SFX.drill();
      }
      return true;
    }
    if (active.repair.miniGame === "level" || active.repair.miniGame === "measure") {
      triggerOscillator();
      return true;
    }
    return false;
  }

  function onKeyUp(k) {
    if (!active || active.done) return false;
    if ((k === " " || k === "enter") && active.repair.miniGame === "torque" && active.holding) {
      releaseTorque();
      return true;
    }
    return false;
  }

  return { open, close, tick, onKeyDown, onKeyUp, getState: () => active };
})();
