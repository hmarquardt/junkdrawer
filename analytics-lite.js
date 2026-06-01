(function () {
  "use strict";

  var DEFAULTS = {
    siteId: "junkdrawer",
    endpoint: "https://lab.aismallbizguru.com/api/analytics/collect",
    respectDoNotTrack: true,
    heartbeatSeconds: 0,
    debug: false
  };
  var VISITOR_KEY = "junkstats.visitor_id";
  var SESSION_KEY = "junkstats.session_id";
  var PREFIX = "[JunkStats]";

  if (window.JunkStats && window.JunkStats.__loaded) {
    return;
  }

  var script = document.currentScript;
  var config = resolveConfig();
  var autoPageviewQueued = false;
  var heartbeatQueued = false;

  function resolveConfig() {
    var attrs = script ? script.dataset || {} : {};
    var globalConfig = safeObject(window.JunkStatsConfig);
    return {
      siteId: pick(globalConfig.siteId, attrs.siteId, DEFAULTS.siteId),
      endpoint: pick(globalConfig.endpoint, attrs.api || attrs.endpoint, DEFAULTS.endpoint),
      respectDoNotTrack: parseBool(pick(globalConfig.respectDoNotTrack, attrs.respectDoNotTrack, DEFAULTS.respectDoNotTrack), DEFAULTS.respectDoNotTrack),
      heartbeatSeconds: parseNumber(pick(globalConfig.heartbeatSeconds, attrs.heartbeatSeconds, DEFAULTS.heartbeatSeconds), DEFAULTS.heartbeatSeconds),
      debug: parseBool(pick(globalConfig.debug, attrs.debug, DEFAULTS.debug), DEFAULTS.debug)
    };
  }

  function safeObject(value) {
    return value && typeof value === "object" ? value : {};
  }

  function pick() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== "") {
        return arguments[i];
      }
    }
    return undefined;
  }

  function parseBool(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      var clean = value.toLowerCase().trim();
      if (clean === "true" || clean === "1" || clean === "yes") return true;
      if (clean === "false" || clean === "0" || clean === "no") return false;
    }
    return fallback;
  }

  function parseNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function debugLog() {
    if (!config.debug || !window.console || !console.log) return;
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(PREFIX);
      console.log.apply(console, args);
    } catch (error) {}
  }

  function debugWarn() {
    if (!config.debug || !window.console) return;
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(PREFIX);
      (console.warn || console.log).apply(console, args);
    } catch (error) {}
  }

  function isDoNotTrackEnabled() {
    try {
      return config.respectDoNotTrack && (
        navigator.doNotTrack === "1" ||
        window.doNotTrack === "1" ||
        navigator.msDoNotTrack === "1"
      );
    } catch (error) {
      return false;
    }
  }

  function trackingDisabled() {
    if (!config.siteId || !config.endpoint) {
      debugWarn("Tracking disabled because siteId or endpoint is missing.");
      return true;
    }
    if (isDoNotTrackEnabled()) {
      debugLog("Tracking disabled because Do Not Track is enabled.");
      return true;
    }
    return false;
  }

  function randomId(prefix) {
    try {
      if (window.crypto && typeof crypto.randomUUID === "function") {
        return prefix + "_" + crypto.randomUUID();
      }
      if (window.crypto && typeof crypto.getRandomValues === "function") {
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return prefix + "_" + Array.prototype.map.call(bytes, function (byte) {
          return byte.toString(16).padStart(2, "0");
        }).join("");
      }
    } catch (error) {}
    return prefix + "_" + String(Date.now()) + "_" + Math.random().toString(36).slice(2, 14);
  }

  function storageGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (error) {}
  }

  function getVisitorId() {
    var existing = storageGet(window.localStorage, VISITOR_KEY);
    if (existing) return existing;
    var next = randomId("v");
    storageSet(window.localStorage, VISITOR_KEY, next);
    return next;
  }

  function getSessionId() {
    var existing = storageGet(window.sessionStorage, SESSION_KEY);
    if (existing) return existing;
    var next = randomId("s");
    storageSet(window.sessionStorage, SESSION_KEY, next);
    return next;
  }

  function getUtm() {
    var params;
    try {
      params = new URLSearchParams(window.location.search || "");
    } catch (error) {
      params = null;
    }
    return {
      source: params ? params.get("utm_source") : null,
      medium: params ? params.get("utm_medium") : null,
      campaign: params ? params.get("utm_campaign") : null,
      term: params ? params.get("utm_term") : null,
      content: params ? params.get("utm_content") : null
    };
  }

  function getReferrer() {
    var url = document.referrer || "";
    var domain = "";
    if (url) {
      try {
        domain = (new URL(url).hostname || "").replace(/^www\./i, "");
      } catch (error) {
        domain = "";
      }
    }
    return { url: url, domain: domain };
  }

  function getNavigationEntry() {
    try {
      if (window.performance && typeof performance.getEntriesByType === "function") {
        var entries = performance.getEntriesByType("navigation");
        return entries && entries.length ? entries[0] : null;
      }
    } catch (error) {}
    return null;
  }

  function getLoadTime(entry) {
    try {
      if (entry) {
        if (Number.isFinite(entry.duration) && entry.duration > 0) {
          return Math.round(entry.duration);
        }
        if (Number.isFinite(entry.loadEventEnd) && Number.isFinite(entry.startTime) && entry.loadEventEnd > entry.startTime) {
          return Math.round(entry.loadEventEnd - entry.startTime);
        }
      }
      if (window.performance && performance.timing) {
        var timing = performance.timing;
        if (timing.loadEventEnd && timing.navigationStart && timing.loadEventEnd > timing.navigationStart) {
          return Math.round(timing.loadEventEnd - timing.navigationStart);
        }
      }
    } catch (error) {}
    return null;
  }

  function getNavigationType(entry) {
    if (entry && entry.type) return entry.type;
    try {
      if (window.performance && performance.navigation) {
        var type = performance.navigation.type;
        if (type === 1) return "reload";
        if (type === 2) return "back_forward";
        if (type === 255) return "prerender";
        return "navigate";
      }
    } catch (error) {}
    return null;
  }

  function buildPayload(eventType, extra) {
    var navEntry = getNavigationEntry();
    var payload = {
      site_id: config.siteId,
      event_type: eventType,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      occurred_at: new Date().toISOString(),
      page: {
        url: window.location.href,
        host: window.location.hostname,
        path: window.location.pathname,
        query: window.location.search,
        title: document.title || ""
      },
      referrer: getReferrer(),
      utm: getUtm(),
      client: {
        language: navigator.language || "",
        timezone: getTimezone(),
        screen_width: window.screen ? screen.width : null,
        screen_height: window.screen ? screen.height : null,
        viewport_width: window.innerWidth || null,
        viewport_height: window.innerHeight || null,
        user_agent: navigator.userAgent || ""
      },
      performance: {
        load_time_ms: getLoadTime(navEntry),
        navigation_type: getNavigationType(navEntry)
      }
    };
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (key) {
        payload[key] = extra[key];
      });
    }
    return payload;
  }

  function getTimezone() {
    try {
      if (window.Intl && Intl.DateTimeFormat) {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      }
    } catch (error) {}
    return "";
  }

  function sendPayload(payload) {
    if (trackingDisabled()) return false;
    var json;
    try {
      json = JSON.stringify(payload);
    } catch (error) {
      debugWarn("Could not serialize payload.", error);
      return false;
    }

    try {
      if (navigator.sendBeacon && window.Blob) {
        var blob = new Blob([json], { type: "application/json" });
        if (navigator.sendBeacon(config.endpoint, blob)) {
          debugLog("Sent event with sendBeacon.", payload);
          return true;
        }
        debugWarn("sendBeacon returned false; falling back to fetch.");
      }
    } catch (error) {
      debugWarn("sendBeacon failed; falling back to fetch.", error);
    }

    try {
      if (window.fetch) {
        fetch(config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: json,
          keepalive: true,
          mode: "cors",
          credentials: "omit"
        }).then(function () {
          debugLog("Sent event with fetch.", payload);
        }).catch(function (error) {
          debugWarn("Fetch send failed.", error);
        });
        return true;
      }
    } catch (error) {
      debugWarn("Fetch send failed.", error);
    }
    return false;
  }

  function trackPageview() {
    try {
      return sendPayload(buildPayload("pageview"));
    } catch (error) {
      debugWarn("Pageview tracking failed.", error);
      return false;
    }
  }

  function trackEvent(eventName, props) {
    try {
      return sendPayload(buildPayload("custom", {
        event_name: String(eventName || ""),
        props: props && typeof props === "object" ? props : {}
      }));
    } catch (error) {
      debugWarn("Custom event tracking failed.", error);
      return false;
    }
  }

  function trackHeartbeat() {
    try {
      return sendPayload(buildPayload("heartbeat"));
    } catch (error) {
      debugWarn("Heartbeat tracking failed.", error);
      return false;
    }
  }

  function onPageLoad(callback) {
    try {
      if (document.readyState === "complete") {
        window.setTimeout(callback, 0);
      } else {
        window.addEventListener("load", callback, { once: true });
      }
    } catch (error) {
      window.setTimeout(callback, 0);
    }
  }

  function queueAutomaticPageview() {
    if (autoPageviewQueued) return;
    autoPageviewQueued = true;
    onPageLoad(function () {
      trackPageview();
      queueHeartbeat();
    });
  }

  function queueHeartbeat() {
    if (heartbeatQueued || config.heartbeatSeconds <= 0 || trackingDisabled()) return;
    heartbeatQueued = true;
    window.setTimeout(trackHeartbeat, config.heartbeatSeconds * 1000);
  }

  try {
    window.JunkStats = {
      __loaded: true,
      trackPageview: trackPageview,
      trackEvent: trackEvent,
      getVisitorId: getVisitorId,
      getSessionId: getSessionId,
      config: config
    };
    queueAutomaticPageview();
  } catch (error) {
    debugWarn("Initialization failed.", error);
  }
}());
