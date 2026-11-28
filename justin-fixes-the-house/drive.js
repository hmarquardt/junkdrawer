"use strict";
// Playable 3-lane "Lowe's Run" mini driving game on Canvas 2D.
const DriveGame = (() => {
  let active = null;

  function start(canvas, difficultyKey, neededParts, onArrive) {
    const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.standard;
    active = {
      canvas,
      diff,
      neededParts,
      onArrive,
      lane: 1, // 0, 1, 2
      xPos: 1, // smoothly interpolated lane
      targetDist: diff.driveTime * 100,
      dist: 0,
      speed: 105,
      boost: false,
      scroll: 0,
      obstacles: [],
      pickups: [],
      spawnTimer: 0.7,
      pickupTimer: 1.5,
      bumps: 0,
      bonusCollected: 0,
      invuln: 0,
      toast: "",
      toastUntil: 0,
      time: 0,
      done: false,
    };
    return active;
  }

  function stop() {
    active = null;
  }

  function shiftLane(dir) {
    if (!active || active.done) return;
    const next = Math.max(0, Math.min(2, active.lane + dir));
    if (next !== active.lane) {
      active.lane = next;
      SFX.click();
    }
  }

  function setLane(lane) {
    if (!active || active.done) return;
    const clamped = Math.max(0, Math.min(2, lane));
    if (clamped !== active.lane) {
      active.lane = clamped;
      SFX.click();
    }
  }

  function setBoost(on) {
    if (active) active.boost = !!on;
  }

  function step(dt) {
    if (!active || active.done) return;
    const d = active;
    d.time += dt;
    d.invuln = Math.max(0, d.invuln - dt);

    const targetSpeed = (d.boost ? 158 : 108) * (d.invuln > 0.6 ? 0.55 : 1);
    d.speed += (targetSpeed - d.speed) * Math.min(1, dt * 6);
    d.dist += d.speed * dt;
    d.scroll += d.speed * dt * 3.2;
    d.xPos += (d.lane - d.xPos) * Math.min(1, dt * 14);

    // Spawn holiday traffic & cones
    d.spawnTimer -= dt * d.diff.trafficRate;
    if (d.spawnTimer <= 0 && d.dist < d.targetDist - 140) {
      const lane = Math.floor(Math.random() * 3);
      const kinds = ["minivan", "cone", "sedan", "turkey"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      d.obstacles.push({
        lane,
        y: -70,
        kind,
        speedMul: kind === "cone" ? 1 : kind === "turkey" ? 0.92 : 0.62,
        hit: false,
      });
      d.spawnTimer = 0.85 + Math.random() * 0.7;
    }

    // Spawn helpful cobalt express coupons / coffee cups
    d.pickupTimer -= dt;
    if (d.pickupTimer <= 0 && d.dist < d.targetDist - 120) {
      const lane = Math.floor(Math.random() * 3);
      const conflict = d.obstacles.some((o) => o.lane === lane && o.y < 80);
      if (!conflict) {
        d.pickups.push({ lane, y: -50, taken: false });
      }
      d.pickupTimer = 2.1 + Math.random() * 1.1;
    }

    const playerY = 0.78;
    const h = d.canvas.clientHeight || 440;
    const pyPx = h * playerY;

    for (const o of d.obstacles) {
      o.y += d.speed * d.diff.trafficSpeed * o.speedMul * dt * 2.55;
      if (!o.hit && d.invuln <= 0 && Math.abs(o.lane - d.xPos) < 0.42 && Math.abs(o.y - pyPx) < 42) {
        o.hit = true;
        d.bumps++;
        d.invuln = 1.1;
        d.dist = Math.max(0, d.dist - 55);
        d.toast =
          o.kind === "turkey"
            ? "HONK! Wild Thanksgiving turkey crossing!"
            : o.kind === "cone"
              ? "Clipped a cone! Watch the paint!"
              : "Slow holiday minivan! Switching lanes!";
        d.toastUntil = d.time + 2.2;
        SFX.honk();
      }
    }
    d.obstacles = d.obstacles.filter((o) => o.y < h + 90);

    for (const pk of d.pickups) {
      pk.y += d.speed * dt * 2.4;
      if (!pk.taken && Math.abs(pk.lane - d.xPos) < 0.45 && Math.abs(pk.y - pyPx) < 38) {
        pk.taken = true;
        d.bonusCollected++;
        d.dist += 65;
        d.toast = "EXPRESS LANE! +Shortcut to Lowe’s!";
        d.toastUntil = d.time + 1.6;
        SFX.pickup();
      }
    }
    d.pickups = d.pickups.filter((pk) => !pk.taken && pk.y < h + 60);

    draw();

    if (d.dist >= d.targetDist) {
      d.done = true;
      SFX.checkout();
      d.onArrive({ bumps: d.bumps, bonusCollected: d.bonusCollected, seconds: d.time });
    }
  }

  function draw() {
    if (!active) return;
    const d = active;
    const canvas = d.canvas;
    const w = canvas.clientWidth || 780;
    const h = canvas.clientHeight || 440;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const roadW = Math.min(360, w * 0.68);
    const roadX = (w - roadW) / 2;
    const laneW = roadW / 3;
    const laneCenter = (l) => roadX + laneW * (l + 0.5);

    // Autumn suburban shoulder
    g.fillStyle = "#35442b";
    g.fillRect(0, 0, w, h);

    // Scrolling autumn trees on shoulders
    for (let i = -1; i < 8; i++) {
      const ty = ((i * 90 + d.scroll * 0.6) % (h + 120)) - 60;
      for (const side of [-1, 1]) {
        const tx = side < 0 ? roadX * 0.48 : roadX + roadW + roadX * 0.52;
        if (tx < 12 || tx > w - 12) continue;
        g.fillStyle = ["#b45309", "#d97706", "#9a3412", "#ca8a04"][Math.abs(i + (side > 0 ? 2 : 0)) % 4];
        g.beginPath();
        g.arc(tx, ty, 20 + (i % 3) * 4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(0,0,0,0.2)";
        g.beginPath();
        g.arc(tx + 4, ty + 4, 15, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Asphalt highway
    g.fillStyle = "#333940";
    g.fillRect(roadX, 0, roadW, h);
    // Crisp road edges
    g.fillStyle = "#f8f4ea";
    g.fillRect(roadX + 4, 0, 3, h);
    g.fillRect(roadX + roadW - 7, 0, 3, h);

    // Dashed lane dividers
    g.strokeStyle = "rgba(250, 204, 21, 0.78)";
    g.lineWidth = 3;
    g.setLineDash([24, 24]);
    g.lineDashOffset = -d.scroll;
    for (let i = 1; i <= 2; i++) {
      g.beginPath();
      g.moveTo(roadX + laneW * i, 0);
      g.lineTo(roadX + laneW * i, h);
      g.stroke();
    }
    g.setLineDash([]);

    // Approaching Lowe's storefront banner near finish!
    const remaining = d.targetDist - d.dist;
    if (remaining < 180) {
      const bannerY = Math.max(12, (1 - remaining / 180) * 140 - 40);
      g.fillStyle = "#004990";
      g.beginPath();
      g.roundRect(roadX - 18, bannerY, roadW + 36, 44, 6);
      g.fill();
      g.strokeStyle = "#93c5fd";
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "#ffffff";
      g.font = "900 22px BarlowCond, Impact, sans-serif";
      g.textAlign = "center";
      g.fillText("LOWE’S HARDWARE · PARKING LOT AHEAD", w / 2, bannerY + 29);
    }

    // Draw pickups
    for (const pk of d.pickups) {
      const px = laneCenter(pk.lane);
      g.fillStyle = "#1e64c8";
      g.beginPath();
      g.arc(px, pk.y, 16, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#93c5fd";
      g.lineWidth = 2;
      g.stroke();
      g.font = "15px system-ui";
      g.textAlign = "center";
      g.fillText("⚡", px, pk.y + 5);
    }

    // Draw traffic & obstacles
    for (const o of d.obstacles) {
      const ox = laneCenter(o.lane);
      g.save();
      g.translate(ox, o.y);
      if (o.kind === "cone") {
        g.fillStyle = "#f97316";
        g.beginPath();
        g.moveTo(0, -14);
        g.lineTo(13, 12);
        g.lineTo(-13, 12);
        g.closePath();
        g.fill();
        g.fillStyle = "#ffffff";
        g.fillRect(-6, -1, 12, 4);
      } else if (o.kind === "turkey") {
        g.fillStyle = "#78350f";
        g.beginPath();
        g.arc(0, 0, 14, 0, Math.PI * 2);
        g.fill();
        g.font = "22px system-ui";
        g.textAlign = "center";
        g.fillText("🦃", 0, 8);
      } else {
        const col = o.kind === "minivan" ? "#8c3b3b" : "#4b6b5c";
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.beginPath();
        g.roundRect(-19, -28, 42, 60, 7);
        g.fill();
        g.fillStyle = col;
        g.beginPath();
        g.roundRect(-20, -30, 40, 60, 7);
        g.fill();
        g.fillStyle = "#94b8c9";
        g.fillRect(-15, -18, 30, 10);
        g.fillRect(-15, 10, 30, 8);
        if (o.kind === "minivan") {
          g.fillStyle = "#d97706";
          g.fillRect(-11, -5, 22, 11); // Roof luggage!
        }
        g.fillStyle = "#ef4444";
        g.fillRect(-17, 27, 8, 3);
        g.fillRect(9, 27, 8, 3);
      }
      g.restore();
    }

    // Draw Justin's pickup truck!
    const px = laneCenter(d.xPos);
    const py = h * 0.78;
    const blink = d.invuln > 0 && Math.sin(d.time * 32) > 0;
    if (!blink) {
      g.save();
      g.translate(px, py);
      g.rotate((d.lane - d.xPos) * 0.16);
      // Headlight beams
      const grad = g.createLinearGradient(0, -34, 0, -110);
      grad.addColorStop(0, "rgba(254, 240, 138, 0.35)");
      grad.addColorStop(1, "rgba(254, 240, 138, 0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(-18, -34);
      g.lineTo(18, -34);
      g.lineTo(34, -110);
      g.lineTo(-34, -110);
      g.closePath();
      g.fill();

      // Truck shadow + body
      g.fillStyle = "rgba(0,0,0,0.4)";
      g.beginPath();
      g.roundRect(-20, -30, 44, 68, 8);
      g.fill();
      g.fillStyle = "#5b6775";
      g.beginPath();
      g.roundRect(-22, -34, 44, 68, 7);
      g.fill();
      g.strokeStyle = "#d1d9e2";
      g.lineWidth = 1.4;
      g.stroke();
      // Bed + cobalt bucket
      g.fillStyle = "#252b31";
      g.fillRect(-16, 4, 32, 24);
      g.fillStyle = "#1e64c8";
      g.beginPath();
      g.arc(7, 16, 6, 0, Math.PI * 2);
      g.fill();
      // Cab + windshield
      g.fillStyle = "#7a8999";
      g.beginPath();
      g.roundRect(-18, -17, 36, 18, 4);
      g.fill();
      g.fillStyle = "#93c5fd";
      g.fillRect(-15, -24, 30, 7);
      // Boost exhaust glow
      if (d.boost) {
        g.fillStyle = "rgba(251, 191, 36, 0.8)";
        g.beginPath();
        g.ellipse(-10, 38, 4, 9, 0, 0, Math.PI * 2);
        g.ellipse(10, 38, 4, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    // Distance progress bar at top of canvas
    const pct = Math.min(1, d.dist / d.targetDist);
    g.fillStyle = "rgba(15, 20, 26, 0.88)";
    g.beginPath();
    g.roundRect(14, 12, w - 28, 30, 8);
    g.fill();
    g.strokeStyle = "rgba(59, 130, 246, 0.45)";
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#1e293b";
    g.beginPath();
    g.roundRect(24, 21, w - 160, 12, 6);
    g.fill();
    g.fillStyle = "#3b82f6";
    g.beginPath();
    g.roundRect(24, 21, Math.max(10, (w - 160) * pct), 12, 6);
    g.fill();
    g.fillStyle = "#f8f4ea";
    g.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textAlign = "right";
    g.fillText("LOWE’S " + Math.round(pct * 100) + "%", w - 24, 31);

    // Toast quip
    if (d.toast && d.time < d.toastUntil) {
      g.font = "700 13px Barlow, system-ui, sans-serif";
      g.textAlign = "center";
      const tw = g.measureText(d.toast).width + 24;
      g.fillStyle = "rgba(15, 20, 26, 0.92)";
      g.beginPath();
      g.roundRect((w - tw) / 2, 52, tw, 28, 14);
      g.fill();
      g.strokeStyle = "#f59e0b";
      g.lineWidth = 1.2;
      g.stroke();
      g.fillStyle = "#fde68a";
      g.fillText(d.toast, w / 2, 70);
    }
  }

  return {
    start,
    stop,
    step,
    shiftLane,
    setLane,
    setBoost,
    getState: () => active,
  };
})();
