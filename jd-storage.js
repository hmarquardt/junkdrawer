/*
 * jd-storage.js — tiny guarded localStorage helper for Junkdrawer pages.
 *
 * Canonical storage policy: AGENTS.md → "Browser Storage Architecture".
 * In short: all pages share one per-origin storage budget; localStorage is
 * for kilobytes of small, stable preferences; anything that grows (histories,
 * blobs, corpora, cached responses) belongs in IndexedDB with a retention
 * policy. Inspect live storage with storage-manager.html.
 *
 * Repo convention (see docs/storage-audit-2026-08.md): localStorage is for
 * kilobytes of preferences, never images, histories, or raw API responses.
 * Any write can still fail when the ~5 MB per-origin budget is exhausted —
 * usually because ANOTHER page on this shared origin is full.
 *
 * This helper exists so pages don't each reinvent quota handling:
 *   - never throws (returns a result object instead)
 *   - does not corrupt previous state (localStorage.setItem either fully
 *     applies or leaves the old value intact; we surface the failure)
 *   - optional `evict` callback lets the app shed old data and retry
 *     (re-serialized per attempt, so evicting actually shrinks the write)
 *   - does not blindly retry the same impossible write
 *
 * Usage:
 *   <script src="jd-storage.js" defer></script>
 *   var res = JDStorage.setJSON('myapp.settings.v1', settings, {
 *     evict: function () { settings.history = settings.history.slice(0, 10); },
 *     maxRetries: 3
 *   });
 *   if (!res.ok) myToast('Could not save: ' + res.error);
 *
 * Reads never need guarding: JDStorage.getJSON(key, fallback).
 * Keep it dependency-free and small — this file loads on every page that
 * includes it.
 */
(function (global) {
  'use strict';

  var MAX_RETRIES_DEFAULT = 3;

  function lastErrorInfo(err) {
    var name = err && err.name ? err.name : 'Error';
    var msg = err && err.message ? err.message : String(err);
    return { name: name, message: msg, quota: name === 'QuotaExceededError' || /quota/i.test(msg) };
  }

  function rawSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return { ok: true };
    } catch (err) {
      var info = lastErrorInfo(err);
      return { ok: false, error: info.quota ? 'Storage quota exceeded' : info.message, quota: info.quota };
    }
  }

  function rawGet(key) {
    try { return global.localStorage.getItem(key); } catch (err) { return null; }
  }

  function setString(key, value, opts) {
    var options = opts || {};
    var maxRetries = typeof options.maxRetries === 'number' ? Math.max(0, options.maxRetries) : MAX_RETRIES_DEFAULT;
    var attempt = 0;
    var res = rawSet(key, value);
    while (!res.ok && res.quota && attempt < maxRetries && typeof options.evict === 'function') {
      attempt += 1;
      try { options.evict({ attempt: attempt, key: key }); } catch (err) { /* app callback issues are its own */ }
      res = rawSet(key, value);
    }
    res.attempts = attempt;
    return res;
  }

  function getString(key, fallback) {
    var v = rawGet(key);
    return v === null ? (fallback === undefined ? null : fallback) : v;
  }

  function setJSON(key, obj, opts) {
    // Serializes per attempt so an `evict` callback that shrinks `obj`
    // actually changes what gets written on retry.
    var options = opts || {};
    var maxRetries = typeof options.maxRetries === 'number' ? Math.max(0, options.maxRetries) : MAX_RETRIES_DEFAULT;
    var attempt = 0;
    for (;;) {
      var serialized;
      try { serialized = JSON.stringify(obj); } catch (err) {
        return { ok: false, error: 'Value is not JSON-serializable: ' + lastErrorInfo(err).message, attempts: attempt };
      }
      var res = rawSet(key, serialized);
      if (res.ok || !(res.quota && attempt < maxRetries && typeof options.evict === 'function')) {
        res.attempts = attempt;
        return res;
      }
      attempt += 1;
      try { options.evict({ attempt: attempt, key: key }); } catch (err) { /* app callback issues are its own */ }
    }
  }

  function getJSON(key, fallback) {
    var v = rawGet(key);
    if (v === null) return fallback;
    try { return JSON.parse(v); } catch (err) { return fallback; }
  }

  function remove(key) {
    try { global.localStorage.removeItem(key); return true; } catch (err) { return false; }
  }

  function sizeOf(key) {
    var v = rawGet(key);
    return v === null ? 0 : (key.length + v.length) * 2; // UTF-16 code units
  }

  global.JDStorage = {
    setString: setString,
    getString: getString,
    setJSON: setJSON,
    getJSON: getJSON,
    remove: remove,
    sizeOf: sizeOf
  };
})(window);
