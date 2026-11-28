"use strict";
// Illustrated Canvas 2D house floorplans, Justin character sprite (stocky, full beard, short hair),
// animated problem indicators, pickup truck, and floating feedback bursts.

function drawJustinSprite(g, x, y, facing, moving, time, holdingBucket) {
  const bob = moving ? Math.sin(time * 13) * 2.2 : Math.sin(time * 2.5) * 0.6;
  const stride = moving ? Math.sin(time * 13) * 4.5 : 0;
  g.save();
  g.translate(x, y);

  // Soft ground shadow
  g.fillStyle = "rgba(8, 10, 12, 0.45)";
  g.beginPath();
  g.ellipse(0, 16, 17, 7, 0, 0, Math.PI * 2);
  g.fill();

  // Work boots & carpenter jeans (stocky stance)
  g.fillStyle = "#33475c";
  g.fillRect(-10, 4 + stride * 0.4, 8, 11);
  g.fillRect(2, 4 - stride * 0.4, 8, 11);
  g.fillStyle = "#5c3b24";
  g.beginPath();
  g.roundRect(-11, 12 + stride * 0.4, 10, 5, 2);
  g.roundRect(1, 12 - stride * 0.4, 10, 5, 2);
  g.fill();

  // Stocky torso in charcoal/rust flannel overshirt + henley
  g.translate(0, bob);
  g.fillStyle = "#3a404a";
  g.beginPath();
  g.roundRect(-14, -14, 28, 22, 6);
  g.fill();
  // Subtle flannel plaid crosshatch
  g.strokeStyle = "rgba(204, 104, 58, 0.42)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-12, -8);
  g.lineTo(12, -8);
  g.moveTo(-12, 0);
  g.lineTo(12, 0);
  g.moveTo(-7, -13);
  g.lineTo(-7, 6);
  g.moveTo(7, -13);
  g.lineTo(7, 6);
  g.stroke();
  // Warm henley front stripe
  g.fillStyle = "#d9cdb6";
  g.fillRect(-3.5, -13, 7, 15);

  // Arms + props (Cordless drill on right, optional cobalt Lowe's bucket on left)
  g.fillStyle = "#353b44";
  g.beginPath();
  g.roundRect(-18, -11, 6, 14, 3);
  g.roundRect(12, -11, 6, 14, 3);
  g.fill();

  // Cordless drill in right hand
  g.save();
  g.translate(17, -1);
  g.rotate(facing < 0 ? -0.35 : 0.25);
  g.fillStyle = "#1e64c8";
  g.fillRect(-2, -4, 11, 5);
  g.fillStyle = "#1c2026";
  g.fillRect(0, 0, 4, 6);
  g.fillStyle = "#d5dde6";
  g.fillRect(9, -2.5, 6, 2);
  g.restore();

  // Cobalt hardware store bucket when carrying parts!
  if (holdingBucket) {
    g.save();
    g.translate(-19, 1);
    g.fillStyle = "#1d63c6";
    g.beginPath();
    g.moveTo(-6, -5);
    g.lineTo(6, -5);
    g.lineTo(4.5, 7);
    g.lineTo(-4.5, 7);
    g.closePath();
    g.fill();
    g.strokeStyle = "#e8eef5";
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, -5, 5, Math.PI, 0);
    g.stroke();
    g.fillStyle = "#facc15";
    g.fillRect(-3, -9, 3, 4);
    g.restore();
  }

  // Head — warm skin tone, short cropped dark hair, full dark beard, pencil behind ear!
  g.fillStyle = "#e3b593";
  g.beginPath();
  g.ellipse(0, -22, 10.5, 11, 0, 0, Math.PI * 2);
  g.fill();

  // Short dark hair on top & sides
  g.fillStyle = "#36261d";
  g.beginPath();
  g.ellipse(0, -29.5, 10.6, 5.2, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillRect(-10.5, -30, 21, 4.5);

  // Full dark beard wrapping lower jaw & cheeks
  g.fillStyle = "#322219";
  g.beginPath();
  g.arc(0, -20.5, 10.5, 0.12 * Math.PI, 0.88 * Math.PI);
  g.quadraticCurveTo(0, -9, -9.8, -16.5);
  g.fill();
  // Mustache + friendly grin hint
  g.fillStyle = "#3d2a20";
  g.beginPath();
  g.ellipse(0, -17.5, 6, 2.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f7ede1";
  g.fillRect(-2.6, -15.6, 5.2, 1.5);

  // Eyes
  const eyeShift = facing * 1.4;
  g.fillStyle = "#1d1612";
  g.beginPath();
  g.arc(-3.6 + eyeShift, -22.5, 1.5, 0, Math.PI * 2);
  g.arc(3.6 + eyeShift, -22.5, 1.5, 0, Math.PI * 2);
  g.fill();

  // Yellow carpenter pencil tucked behind right ear
  g.strokeStyle = "#facc15";
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(8, -25);
  g.lineTo(13.5, -28.5);
  g.stroke();

  g.restore();
}

function drawPickupTruck(g, x, y, pulse, readyForLowes) {
  g.save();
  g.translate(x, y);

  // Parking bay outline
  if (readyForLowes) {
    g.strokeStyle = `rgba(59, 130, 246, ${0.5 + 0.4 * Math.sin(pulse * 5)})`;
    g.lineWidth = 2.5;
    g.setLineDash([7, 5]);
    g.beginPath();
    g.roundRect(-34, -46, 68, 92, 10);
    g.stroke();
    g.setLineDash([]);
  }

  // Shadow
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.beginPath();
  g.roundRect(-22, -32, 48, 68, 8);
  g.fill();

  // Truck body (steel grey pickup)
  g.fillStyle = "#5b6775";
  g.beginPath();
  g.roundRect(-22, -34, 44, 68, 7);
  g.fill();
  g.strokeStyle = "#2b323b";
  g.lineWidth = 1.5;
  g.stroke();

  // Truck bed (back half)
  g.fillStyle = "#2b3036";
  g.beginPath();
  g.roundRect(-17, 4, 34, 25, 3);
  g.fill();
  // Blue hardware bucket in bed
  g.fillStyle = "#1e64c8";
  g.beginPath();
  g.arc(-7, 16, 6, 0, Math.PI * 2);
  g.fill();

  // Cab roof + windshield
  g.fillStyle = "#768494";
  g.beginPath();
  g.roundRect(-18, -16, 36, 18, 4);
  g.fill();
  g.fillStyle = "#8cc0db";
  g.fillRect(-15, -23, 30, 7);

  // Headlights
  g.fillStyle = "#fde68a";
  g.fillRect(-18, -35, 9, 3);
  g.fillRect(9, -35, 9, 3);

  // Label pill
  const label = readyForLowes ? "DRIVE TO LOWE’S" : "JUSTIN’S TRUCK";
  g.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.textAlign = "center";
  const tw = g.measureText(label).width + 14;
  g.fillStyle = readyForLowes ? "#1e64c8" : "rgba(20, 24, 30, 0.85)";
  g.beginPath();
  g.roundRect(-tw / 2, -56, tw, 18, 9);
  g.fill();
  g.strokeStyle = readyForLowes ? "#93c5fd" : "rgba(255,255,255,0.2)";
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.fillText(label, 0, -44);

  g.restore();
}

function drawHouseScene(canvas, state) {
  const w = canvas.clientWidth || 780;
  const h = canvas.clientHeight || 480;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ch = CHAPTERS[state.chapter];
  const sx = (px) => (px / 100) * w;
  const sy = (py) => (py / 100) * h;

  // Outer autumn ground / blueprint backdrop
  g.fillStyle = ch.theme === "interior" ? "#1d2229" : "#2e3b28";
  g.fillRect(0, 0, w, h);

  // Subtle blueprint grid in exterior margins
  g.strokeStyle = "rgba(147, 197, 253, 0.06)";
  g.lineWidth = 1;
  for (let gx = 0; gx < w; gx += 32) {
    g.beginPath();
    g.moveTo(gx, 0);
    g.lineTo(gx, h);
    g.stroke();
  }
  for (let gy = 0; gy < h; gy += 32) {
    g.beginPath();
    g.moveTo(0, gy);
    g.lineTo(w, gy);
    g.stroke();
  }

  // Draw rooms / zones
  for (const rm of ch.rooms) {
    const rx = sx(rm.x), ry = sy(rm.y), rw = sx(rm.w), rh = sy(rm.h);
    g.fillStyle = rm.floor;
    g.fillRect(rx, ry, rw, rh);

    // Flooring textures
    if (rm.tile) {
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.lineWidth = 1;
      for (let tx = rx; tx < rx + rw; tx += 22) {
        g.beginPath(); g.moveTo(tx, ry); g.lineTo(tx, ry + rh); g.stroke();
      }
      for (let ty = ry; ty < ry + rh; ty += 22) {
        g.beginPath(); g.moveTo(rx, ty); g.lineTo(rx + rw, ty); g.stroke();
      }
    } else if (rm.deck) {
      g.strokeStyle = "rgba(20,14,10,0.22)";
      g.lineWidth = 1;
      for (let ty = ry + 10; ty < ry + rh; ty += 10) {
        g.beginPath(); g.moveTo(rx, ty); g.lineTo(rx + rw, ty); g.stroke();
      }
    } else if (rm.grass) {
      // Scattered Thanksgiving autumn leaves
      for (let i = 0; i < 24; i++) {
        const lx = rx + ((i * 73 + 19) % Math.max(10, Math.floor(rw - 12))) + 6;
        const ly = ry + ((i * 47 + 11) % Math.max(10, Math.floor(rh - 12))) + 6;
        g.fillStyle = ["#d97706", "#b45309", "#dc2626", "#ca8a04"][i % 4];
        g.beginPath();
        g.ellipse(lx, ly, 4.5, 2.5, i, 0, Math.PI * 2);
        g.fill();
      }
    } else if (!rm.concrete) {
      // Warm hardwood plank lines
      g.strokeStyle = "rgba(35,20,10,0.18)";
      g.lineWidth = 1;
      for (let ty = ry + 12; ty < ry + rh; ty += 12) {
        g.beginPath(); g.moveTo(rx, ty); g.lineTo(rx + rw, ty); g.stroke();
      }
    }

    if (rm.rug) {
      g.fillStyle = rm.rug;
      g.beginPath();
      g.roundRect(rx + rw * 0.16, ry + rh * 0.22, rw * 0.68, rh * 0.56, 8);
      g.fill();
      g.strokeStyle = "rgba(255, 232, 184, 0.25)";
      g.lineWidth = 2;
      g.stroke();
    }

    // Room walls / borders
    g.strokeStyle = ch.theme === "interior" ? "#26221e" : "rgba(255,255,255,0.16)";
    g.lineWidth = ch.theme === "interior" ? 5 : 2;
    g.strokeRect(rx, ry, rw, rh);

    // Room architectural label
    g.fillStyle = "rgba(248, 244, 234, 0.55)";
    g.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textAlign = "left";
    g.fillText(rm.label, rx + 10, ry + 17);
  }

  // Cozy Thanksgiving decorative props per chapter
  if (ch.theme === "interior") {
    // Thanksgiving dining table with turkey platter!
    const tx = sx(69), ty = sy(34);
    g.fillStyle = "#543622";
    g.beginPath();
    g.roundRect(tx - 48, ty - 18, 96, 36, 6);
    g.fill();
    g.fillStyle = "#f5ebd6";
    g.fillRect(tx - 42, ty - 6, 84, 12);
    g.fillStyle = "#b45309";
    g.beginPath();
    g.ellipse(tx, ty, 12, 8, 0, 0, Math.PI * 2);
    g.fill();
    // Living room sofa
    g.fillStyle = "#485966";
    g.beginPath();
    g.roundRect(sx(10), sy(36), 68, 22, 6);
    g.fill();
    // Kitchen island
    g.fillStyle = "#c8c2b4";
    g.beginPath();
    g.roundRect(sx(34), sy(64), 66, 28, 4);
    g.fill();
  }

  // Draw Pickup Truck in driveway / garage
  const needsLowes = state.needsLowesRun();
  drawPickupTruck(g, sx(ch.truckPos.x), sy(ch.truckPos.y), state.time, needsLowes);

  // Draw each repair hotspot
  for (const r of ch.repairs) {
    const rx = sx(r.x), ry = sy(r.y);
    const st = state.repairs[r.id]; // { found, fixed, needsSurprise }
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 4.5 + r.x);

    if (st.fixed) {
      // Warm completed amber-green glow
      const glow = g.createRadialGradient(rx, ry, 2, rx, ry, 34);
      glow.addColorStop(0, "rgba(251, 191, 36, 0.32)");
      glow.addColorStop(1, "rgba(251, 191, 36, 0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(rx, ry, 34, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = "rgba(22, 34, 24, 0.9)";
      g.beginPath();
      g.arc(rx, ry, 18, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#4ade80";
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "#4ade80";
      g.font = "700 16px system-ui";
      g.textAlign = "center";
      g.fillText("✓", rx, ry + 6);
    } else {
      const hasPart = state.hasPartFor(r);
      const color = !st.found
        ? "#f59e0b"
        : hasPart
          ? "#4ade80"
          : "#3b82f6";

      // Animated hazard / ready ring
      g.strokeStyle = color;
      g.lineWidth = 2.2;
      g.globalAlpha = 0.38 + pulse * 0.52;
      g.beginPath();
      g.arc(rx, ry, 22 + pulse * 6, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;

      // Subtle flickering effect on unfixed electrical / drip
      if (!st.found && r.id === "bulb" && Math.sin(state.time * 24) > 0.3) {
        g.fillStyle = "rgba(254, 240, 138, 0.28)";
        g.beginPath();
        g.arc(rx, ry, 32, 0, Math.PI * 2);
        g.fill();
      }

      // Badge disc
      g.fillStyle = "rgba(18, 22, 28, 0.92)";
      g.beginPath();
      g.arc(rx, ry, 18, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2.2;
      g.stroke();

      g.fillStyle = "#fde68a";
      g.font = st.found ? "16px system-ui" : "900 18px system-ui";
      g.textAlign = "center";
      g.fillText(st.found ? r.icon : "!", rx, ry + 6);

      // Floating status tag
      const tag = !st.found
        ? "SPOT PROBLEM"
        : st.needsSurprise
          ? "WRONG WASHER!"
          : hasPart
            ? "FIX: " + r.name.split(" ")[0].toUpperCase()
            : "NEEDS PART";
      g.font = "700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      const tw = g.measureText(tag).width + 12;
      g.fillStyle = "rgba(15, 19, 24, 0.9)";
      g.beginPath();
      g.roundRect(rx - tw / 2, ry - 38, tw, 16, 4);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = color === "#3b82f6" ? "#93c5fd" : color === "#4ade80" ? "#86efac" : "#fde68a";
      g.fillText(tag, rx, ry - 27);
    }
  }

  // Draw Justin!
  const holdingBucket = Object.values(state.inventory).some((n) => n > 0);
  drawJustinSprite(
    g,
    sx(state.justin.x),
    sy(state.justin.y),
    state.justin.facing,
    state.justin.moving,
    state.time,
    holdingBucket,
  );

  // Floating feedback callouts
  for (const b of state.bursts) {
    const age = state.time - b.start;
    if (age > 1.2) continue;
    const bx = sx(b.x), by = sy(b.y) - 24 - age * 26;
    g.save();
    g.globalAlpha = Math.min(1, (1.2 - age) * 2.2);
    g.font = "800 14px BarlowCond, Impact, sans-serif";
    g.textAlign = "center";
    g.strokeStyle = "#101418";
    g.lineWidth = 4;
    g.strokeText(b.text, bx, by);
    g.fillStyle = b.color || "#fde68a";
    g.fillText(b.text, bx, by);
    g.restore();
  }
}
