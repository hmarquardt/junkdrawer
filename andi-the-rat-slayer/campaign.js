// Only bounded campaign records belong here. Positions and live combat restart at the entrance.
const SAVE_KEY = "andi.campaign";
const lastLevel = 9;
const whole = (value, min, max, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;
function cleanSave(raw = {}) {
  const unlocked = whole(raw.unlocked, 1, lastLevel, 1);
  const settings = raw.settings || {};
  const checkpoint = whole(raw.checkpoint, 1, unlocked, unlocked);
  const best = {};
  for (let level = 1; level <= unlocked; level++) {
    const seconds = raw.best?.[level];
    if (Number.isFinite(seconds) && seconds > 0 && seconds < 86400)
      best[level] = seconds;
  }
  return {
    version: 2,
    started: raw.started === true,
    unlocked,
    checkpoint,
    chapter: checkpoint >= 6 ? 2 : 1,
    lastCompleted: whole(raw.lastCompleted, 0, unlocked, 0),
    legacy: raw.legacy === true,
    best,
    upgrades: [
      ...new Set(Array.isArray(raw.upgrades) ? raw.upgrades : []),
    ].filter((n) => whole(n, 2, Math.min(8, unlocked), 0)),
    achievements: ["fork", "council"].filter(
      (id) => Array.isArray(raw.achievements) && raw.achievements.includes(id),
    ),
    treats: whole(raw.treats, 0, 3, 0),
    collected: whole(raw.collected, 0, 15, 0),
    settings: {
      difficulty: ["story", "normal", "rush"].includes(settings.difficulty)
        ? settings.difficulty
        : "story",
      quality: settings.quality === "low" ? "low" : "high",
      sound: settings.sound !== false,
    },
  };
}
let saveWarning = "",
  preserveNewer = false;
function loadCampaign() {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (text === null) return cleanSave();
    const data = JSON.parse(text);
    if (data?.version === 1) {
      // V1 used furthestLevel and kept preferences alongside progression.
      const migrated = cleanSave({
        ...data,
        unlocked: data.furthestLevel,
        started: true,
        settings: data,
      });
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(migrated));
      } catch {
        saveWarning =
          "Save upgrade pending. Progress is available for this session.";
      }
      return migrated;
    }
    if (data?.version > 2) {
      preserveNewer = true;
      saveWarning =
        "A newer game created this save. This session will preserve it.";
    } else if (data?.version === 2) return cleanSave(data);
    else throw Error();
  } catch {
    saveWarning = "Saved progress could not be read. You can still play.";
  }
  return cleanSave();
}
let campaign = loadCampaign(),
  replay = false;
// Other tabs may be playing an older level. Refresh their menu and mark that run
// as a replay before it reaches the next checkpoint.
addEventListener("storage", (event) => {
  if (event.key !== SAVE_KEY && event.key !== null) return;
  preserveNewer = false;
  saveWarning = "";
  campaign = loadCampaign();
  if (s && !campaign.started) {
    if ($("dialog").open) $("dialog").close();
    home();
  }
  if (s && s.stage + 1 < campaign.unlocked) replay = true;
  if (!s) {
    Object.assign(prefs, campaign.settings);
    $("sound").textContent = "♫　 SOUND " + (prefs.sound ? "ON" : "OFF");
    $("sound").setAttribute("aria-pressed", prefs.sound);
  }
  refreshCampaignMenu();
});
function persistCampaign() {
  campaign.chapter = campaign.checkpoint >= 6 ? 2 : 1;
  campaign.settings = { ...prefs };
  if (!preserveNewer) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(campaign));
      saveWarning = "";
    } catch {
      saveWarning =
        "Browser storage unavailable. Progress lasts for this session.";
    }
  }
  refreshCampaignMenu();
}
function unlockFork(level) {
  if (level >= 2 && level <= 8 && !campaign.upgrades.includes(level))
    campaign.upgrades.push(level);
}
function stageCheckpoint(stage) {
  const level = stage + 1;
  campaign.started = true;
  if (!replay) campaign.checkpoint = level;
  if (level !== 7) unlockFork(level);
  persistCampaign();
}
function completeCheckpoint() {
  const level = s.stage + 1;
  const next = Math.min(lastLevel, level + 1);
  campaign.lastCompleted = level;
  campaign.best[level] = Math.min(
    campaign.best[level] || Infinity,
    Math.max(0.01, Math.round(s.playSeconds * 100) / 100),
  );
  if (s.fork?.achievement && !campaign.achievements.includes("fork"))
    campaign.achievements.push("fork");
  if (level === 9 && !campaign.achievements.includes("council"))
    campaign.achievements.push("council");
  if (level >= campaign.unlocked) replay = false;
  campaign.unlocked = Math.max(campaign.unlocked, next);
  if (!replay) campaign.checkpoint = next;
  persistCampaign();
}
function refreshCampaignMenu() {
  $("continue").hidden = !campaign.started;
  $("start").textContent = campaign.started ? "New Game" : "▶　Play campaign";
  $("legacy").hidden =
    campaign.legacy || campaign.unlocked >= 6 || preserveNewer;
  $("saveStatus").textContent =
    saveWarning ||
    (campaign.started
      ? "Checkpoint · Level " + campaign.checkpoint + " · "
      : "") + "Progress saves on this browser and device only.";
  $("saveAlert").textContent = saveWarning;
  const pills = $("campaignPills");
  if (pills) {
    const items = [];
    const cleared = Object.keys(campaign.best).length;
    if (cleared || campaign.started)
      items.push("Acts cleared · " + cleared + " / " + lastLevel);
    if (campaign.achievements.includes("fork"))
      items.push("★ Fork Around & Find Out");
    if (campaign.achievements.includes("council"))
      items.push("★ Council Adjourned");
    if (campaign.treats > 0)
      items.push("🐾 Treats · " + campaign.treats);
    pills.innerHTML = items.map((t) => '<span class="pill">' + t + "</span>").join("");
  }
  if (typeof renderBossLineup === "function") renderBossLineup();
}
function bindCampaignMenu() {
  $("continue").onclick = () => start(campaign.checkpoint - 1);
  $("selectLevel").onclick = () => {
    modal(
      "LEVEL SELECT",
      "<p>Replay an unlocked encounter. Your campaign checkpoint is kept.</p>",
    );
    if (campaign.achievements.length || campaign.treats) {
      const details = document.createElement("p");
      const badges = campaign.achievements.map((id) =>
        id === "fork" ? "Fork Around and Find Out" : "Council Adjourned",
      );
      details.textContent = [...badges, "Cat treats · " + campaign.treats].join(
        "　★　",
      );
      $("content").append(details);
    }
    cases.forEach((c, i) => {
      if (i === 0 || i === 5) {
        const heading = document.createElement("h3");
        heading.textContent =
          i === 0 ? "Chapter 1 · First Bell" : "Chapter 2 · Chicago After Dark";
        $("content").append(heading);
      }
      const b = document.createElement("button");
      b.textContent =
        i +
        1 +
        " · " +
        c.name +
        (campaign.best[i + 1] ? " · Best " + campaign.best[i + 1] + " s" : "");
      b.disabled = i + 1 > campaign.unlocked;
      b.onclick = () => {
        $("dialog").close();
        start(i, i + 1 < campaign.unlocked);
      };
      $("content").append(b);
    });
  };
  $("legacy").onclick = () => {
    modal(
      "RETURNING PLAYER",
      '<p>Finished the original five bosses before saves existed? Unlock Chicago After Dark on this device. Your earlier times and achievements stay unrecorded.</p><button id="confirmLegacy">I finished Chapter 1 · Unlock Chapter 2</button>',
    );
    $("confirmLegacy").onclick = () => {
      Object.assign(campaign, {
        unlocked: 6,
        checkpoint: 6,
        started: true,
        legacy: true,
      });
      campaign.upgrades = [2, 3, 4, 5];
      persistCampaign();
      $("dialog").close();
    };
  };
  $("resetProgress").onclick = () => {
    modal(
      "RESET PROGRESS?",
      '<p>Delete all campaign progress, records, treats and upgrades on this device? This cannot be undone.</p><button id="confirmReset">Delete my progress</button>',
    );
    $("confirmReset").onclick = () => {
      campaign = cleanSave();
      preserveNewer = false;
      persistCampaign();
      $("dialog").close();
    };
  };
  refreshCampaignMenu();
}
