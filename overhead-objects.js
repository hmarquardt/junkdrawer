/* Overhead: object identity enrichment — "what is this object?".
   Layer 1: CelesTrak SATCAT — structured identity (owner, object type, launch date/site,
   operational status, NORAD + COSPAR identifiers).
   Layer 2: Wikidata (CC0 structured data) — operator, mission category, short plain-English
   description and an official/source link.
   Deterministic identifier joins only: NORAD → COSPAR → (exact) name. On demand: never at
   load, never for the whole catalog, never blocking propagation, scoring or ranking.
   Requests contain spacecraft identifiers only — never observer coordinates.
   Nothing here edits passes, scores or rankings; the module only describes objects. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const RULES = Object.freeze({ttlDays:21,maxRecords:200,maxDescription:340});
     /* Tiny built-in map for objects every user recognizes. Local, deterministic, no network.
        Deliberately three entries (ISS, Tiangong, Hubble): not a hand-maintained catalog. */
  const KNOWN = Object.freeze({
    '25544':{name:'International Space Station',operator:'International partnership',category:'Human spaceflight',cospar:'1998-067A',launchDate:'1998-11-20',
      description:'Continuously crewed research laboratory in low Earth orbit, flown with NASA, Roscosmos, ESA, JAXA and CSA. Usually the brightest thing overhead.',
      link:'https://en.wikipedia.org/wiki/International_Space_Station'},
    '48274':{name:'Tiangong',operator:'CNSA',category:'Human spaceflight',cospar:'2021-035A',launchDate:'2021-04-29',
      description:'China’s permanently crewed space station, assembled in low Earth orbit since 2021.',
      link:'https://en.wikipedia.org/wiki/Tiangong_space_station'},
    '20580':{name:'Hubble Space Telescope',operator:'NASA · ESA',category:'Astronomy',cospar:'1990-037B',launchDate:'1990-04-24',
      description:'Space telescope imaging the universe from low Earth orbit since 1990.',
      link:'https://en.wikipedia.org/wiki/Hubble_Space_Telescope'}
  });
  /* Shared Starlink identity: one record for the whole constellation, one for trains.
     Hundreds of satellites must never trigger hundreds of mission lookups. */
  const STARLINK = Object.freeze({
    object:{key:'starlink:object',name:'Starlink',operator:'SpaceX',category:'Starlink',
      description:'Part of SpaceX’s Starlink broadband satellite constellation.',
      link:'https://en.wikipedia.org/wiki/Starlink'},
    train:{key:'starlink:train',name:'Starlink train',operator:'SpaceX',category:'Starlink',categoryLabel:'Recently launched Starlink group',
      description:'A group of recently launched Starlink satellites from one SpaceX launch, still travelling close enough together to look like a moving string of pearls.',
      compact:'SpaceX recently launched Starlink group',
      link:'https://en.wikipedia.org/wiki/Starlink'}
  });
  const CATEGORIES = Object.freeze(['Earth observation','Communications','Navigation','Weather','Scientific research','Technology demonstration',
    'Military / defense','Astronomy','Human spaceflight','Recent launch','Starlink','Rocket body','Debris','unknown / other']);
  const CATEGORY_PHRASE = Object.freeze({'Earth observation':'Earth-observation satellite','Communications':'communications satellite',
    'Navigation':'navigation satellite','Weather':'weather satellite','Scientific research':'research satellite',
    'Technology demonstration':'technology demonstration satellite','Military / defense':'military satellite','Astronomy':'space observatory',
    'Human spaceflight':'crewed spacecraft','Recent launch':'recently launched satellite','Starlink':'Starlink broadband satellite',
    'Rocket body':'spent rocket body','Debris':'orbital debris fragment'});
  /* Display shortening only — never a substitute for missing metadata. */
  const OPERATOR_SHORT = Object.freeze({'National Aeronautics and Space Administration':'NASA','National Oceanic and Atmospheric Administration':'NOAA',
    'Roscosmos State Corporation':'Roscosmos','China National Space Administration':'CNSA','European Space Agency':'ESA',
    'Japan Aerospace Exploration Agency':'JAXA','Indian Space Research Organisation':'ISRO','Canadian Space Agency':'CSA',
    'United States Space Force':'USSF','Korea Aerospace Research Institute':'KARI','National Centre for Space Studies':'CNES',
    'German Aerospace Center':'DLR','United States Air Force':'USAF'});
  const OWNERS = Object.freeze({US:'United States',CIS:'Russia',RU:'Russia',PRC:'China',CHN:'China',JPN:'Japan',IND:'India',FRA:'France',GER:'Germany',
    UK:'United Kingdom',IT:'Italy',CAN:'Canada',BRA:'Brazil',ISRA:'Israel',ESA:'European Space Agency',NATO:'NATO',AUS:'Australia',KOR:'South Korea',
    NZ:'New Zealand',SPN:'Spain',NETH:'Netherlands',SWE:'Sweden',TAI:'Taiwan',IRAN:'Iran',UKR:'Ukraine',SAFR:'South Africa',ARG:'Argentina',MEX:'Mexico'});
  const OBJECT_TYPES = Object.freeze({PAY:'Payload','R/B':'Rocket body',DEB:'Debris',UNK:'Unknown object',TBA:'Unassigned'});
  const OPS_STATUS = Object.freeze({'+':'Operational','-':'No longer operational','P':'Partially operational','B':'Backup / standby','S':'Spare',
    'X':'Extended mission','D':'Decayed','?':null});
  const LAUNCH_SITES = Object.freeze({AFWTR:'Vandenberg, California',AFETR:'Cape Canaveral, Florida',KSC:'Kennedy Space Center, Florida',
    JSC:'Jiuquan, China',TSC:'Taiyuan, China',TYMSC:'Baikonur, Kazakhstan',XSC:'Xichang, China',WSC:'Wenchang, China',PKMTR:'Plesetsk, Russia',
    KYMSC:'Kourou, French Guiana',SNMLP:'Sea Launch (Pacific)',FRGUI:'Kourou, French Guiana',SVOB:'Svobodny, Russia',
    SRIH:'Satish Dhawan, India',TNSTA:'Tanegashima, Japan',YAVNE:'Palmachim, Israel',UNKN:null});
  const ACRONYMS = new Set(['ISS','NASA','ESA','CNSA','JAXA','CSA','ISRO','NOAA','US','USA','GPS','USSF','HST','CSS','TIANHE']);
  const UNKNOWN = 'unknown / other';

  const clean = v => { const s = String(v ?? '').trim(); return s ? s : null; };
  function normalizeCospar(v) {
    const s = clean(v); if (!s) return null;
    const m = /^(\d{4})[-\s]?(\d{3})([A-Za-z]{0,3})$/.exec(s.replace(/\s+/g, ''));
    return m ? m[1] + '-' + m[2] + m[3].toUpperCase() : s.replace(/\s+/g, '').toUpperCase() || null;
  }
  function titleCaseName(name) {
    const s = clean(name); if (!s) return null;
    // Only plain all-caps names are title-cased: "TERRA" → "Terra". Designations with digits,
    // suffixes or parentheses ("SL-16 R/B", "OBJECT 54321", "ISS (ZARYA)") are left alone.
    if (!/^[A-Z][A-Z ./\-]*$/.test(s) || s.length > 32) return s;
    return s.split(/(\s+)/).map(part => /^[A-Z]+$/.test(part) && !ACRONYMS.has(part)
      ? part[0] + part.slice(1).toLowerCase() : part).join('');
  }
  function isStarlinkName(name) { return /^STARLINK[\s\-]/i.test(clean(name) || ''); }
  /* Derive the enrichment request from a pass (train events carry a cohort, not a NORAD). */
  function objectRequest(p) {
    const train = p && p.train ? {cohortId:clean(p.train.cohortId),launchDate:clean(p.train.launchDate)} : null;
    return {norad:clean(p && p.norad) || null, cospar:normalizeCospar(p && (p.cospar || p.OBJECT_ID)) || null,
      name:clean(p && p.name) || null, groups:Array.isArray(p && p.groups) ? p.groups : [], train};
  }
  function sharedIdentity(request) {
    const r = request || {};
    if (r.train || (r.groups || []).includes('trains')) return STARLINK.train;
    if (isStarlinkName(r.name) || (r.groups || []).includes('starlink')) return STARLINK.object;
    return null;
  }
  /* Local shortcut for objects everyone recognizes: deterministic, offline, no lookup. */
  function knownIdentity(request) {
    const r = request || {}, id = clean(r.norad);
    if (id && KNOWN[String(id).replace(/^0+/, '')]) return KNOWN[String(id).replace(/^0+/, '')];
    const cospar = normalizeCospar(r.cospar);
    if (cospar) for (const entry of Object.values(KNOWN)) if (normalizeCospar(entry.cospar) === cospar) return entry;
    return null;
  }
  /* Display operator: an agency acronym in the label (NOAA, NASA) beats an obscure
     sub-organization short name (OSPO); otherwise Wikidata's short name is used. */
  function operatorDisplay(full, short) {
    if (!full) return short || null;
    const acronym = /\b[A-Z]{2,6}\b/.exec(full);
    if (acronym) return acronym[0];
    return short || OPERATOR_SHORT[full] || full;
  }
  /* Cache/identity key: NORAD is authoritative, COSPAR is the deterministic fallback,
     the shared Starlink records collapse a whole constellation, and name is last resort. */
  function cacheKey(request) {
    const r = request || {};
    const shared = sharedIdentity(r); if (shared) return shared.key;
    if (clean(r.norad)) return 'norad:' + String(r.norad).replace(/^0+/, '');
    const cospar = normalizeCospar(r.cospar); if (cospar) return 'cospar:' + cospar;
    const name = clean(r.name); if (name) return 'name:' + name.toLowerCase();
    return null;
  }
  function satcatURL(request) {
    const r = request || {}, base = 'https://celestrak.org/satcat/records.php';
    if (clean(r.norad)) return base + '?CATNR=' + encodeURIComponent(String(r.norad).replace(/^0+/, '')) + '&FORMAT=json';
    const cospar = normalizeCospar(r.cospar);
    if (cospar) return base + '?INTDES=' + encodeURIComponent(cospar) + '&FORMAT=json';
    return base + '?NAME=' + encodeURIComponent(clean(r.name) || '') + '&FORMAT=json';
  }
  const SPARQL_BY_NORAD = ids => 'SELECT ?item ?norad ?cospar ?itemLabel ?itemDescription ?operatorLabel ?operatorShort ?launch ?website ?article ?typeLabel WHERE {\n' +
    '  VALUES ?norad { ' + ids.map(id => '"' + id + '"').join(' ') + ' }\n' +
    '  ?item wdt:P377 ?norad .\n' +
    '  OPTIONAL { ?item wdt:P247 ?cospar . }\n' +
    '  OPTIONAL { ?item wdt:P137 ?operator . OPTIONAL { ?operator wdt:P1813 ?operatorShort . FILTER(lang(?operatorShort) = "en") } }\n' +
    '  OPTIONAL { ?item wdt:P619 ?launch . }\n' +
    '  OPTIONAL { ?item wdt:P856 ?website . }\n' +
    '  OPTIONAL { ?item wdt:P31 ?type . }\n' +
    '  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }\n' +
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n}';
  const SPARQL_BY_COSPAR = ids => 'SELECT ?item ?norad ?cospar ?itemLabel ?itemDescription ?operatorLabel ?operatorShort ?launch ?website ?article ?typeLabel WHERE {\n' +
    '  VALUES ?cospar { ' + ids.map(id => '"' + id + '"').join(' ') + ' }\n' +
    '  ?item wdt:P247 ?cospar .\n' +
    '  OPTIONAL { ?item wdt:P377 ?norad . }\n' +
    '  OPTIONAL { ?item wdt:P137 ?operator . OPTIONAL { ?operator wdt:P1813 ?operatorShort . FILTER(lang(?operatorShort) = "en") } }\n' +
    '  OPTIONAL { ?item wdt:P619 ?launch . }\n' +
    '  OPTIONAL { ?item wdt:P856 ?website . }\n' +
    '  OPTIONAL { ?item wdt:P31 ?type . }\n' +
    '  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }\n' +
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n}';
  function wikidataURL(request) {
    const r = request || {};
    const norad = clean(r.norad), cospar = normalizeCospar(r.cospar);
    const query = norad ? SPARQL_BY_NORAD([String(norad).replace(/^0+/, '')]) : cospar ? SPARQL_BY_COSPAR([cospar]) : null;
    if (!query) return null;
    return 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  }
  /* Deterministic join: prefer the requested NORAD, then COSPAR, then an exact name. */
  function selectSatcat(rows, request = {}) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const norad = clean(request.norad), cospar = normalizeCospar(request.cospar), name = (clean(request.name) || '').toLowerCase();
    const byNorad = norad && rows.find(r => String(r.NORAD_CAT_ID ?? '').replace(/^0+/, '') === String(norad).replace(/^0+/, ''));
    if (byNorad) return byNorad;
    const byCospar = cospar && rows.find(r => normalizeCospar(r.OBJECT_ID) === cospar);
    if (byCospar) return byCospar;
    return name ? rows.find(r => String(r.OBJECT_NAME || '').trim().toLowerCase() === name) || null : null;
  }
  function identityFromSatcat(row) {
    if (!row || typeof row !== 'object') return null;
    const type = clean(row.OBJECT_TYPE);
    return {norad:clean(row.NORAD_CAT_ID) ? String(row.NORAD_CAT_ID).replace(/^0+/, '') : null,
      cospar:normalizeCospar(row.OBJECT_ID), name:clean(row.OBJECT_NAME),
      owner:OWNERS[clean(row.OWNER)] || clean(row.OWNER) || null, ownerCode:clean(row.OWNER) || null,
      objectType:OBJECT_TYPES[type] || (type ? 'Object type ' + type : null), objectTypeCode:type || null,
      launchDate:clean(row.LAUNCH_DATE) || null, launchSite:LAUNCH_SITES[clean(row.LAUNCH_SITE)] || clean(row.LAUNCH_SITE) || null,
      status:OPS_STATUS[clean(row.OPS_STATUS_CODE)] || null, decayed:!!clean(row.DECAY_DATE),
      apogee:Number.isFinite(+row.APOGEE) ? +row.APOGEE : null, perigee:Number.isFinite(+row.PERIGEE) ? +row.PERIGEE : null,
      source:'CelesTrak SATCAT'};
  }
  function missionFromWikidata(payload, request = {}) {
    const rows = payload && payload.results && payload.results.bindings;
    if (!Array.isArray(rows) || !rows.length) return null;
    const groups = new Map();
    for (const b of rows) {
      const id = b.item && b.item.value; if (!id) continue;
      const g = groups.get(id) || {item:id,label:null,description:null,operators:new Map(),types:new Set(),launch:null,website:null,article:null,norad:null,cospar:null};
      if (b.itemLabel && b.itemLabel.value) g.label = b.itemLabel.value;
      if (b.itemDescription && b.itemDescription.value) g.description = b.itemDescription.value;
      if (b.norad && b.norad.value) g.norad = String(b.norad.value).replace(/^0+/, '');
      if (b.cospar && b.cospar.value) g.cospar = normalizeCospar(b.cospar.value);
      if (b.operatorLabel && b.operatorLabel.value) {
        const op = g.operators.get(b.operatorLabel.value) || {short:null};
        if (b.operatorShort && b.operatorShort.value) op.short = b.operatorShort.value;
        g.operators.set(b.operatorLabel.value, op);
      }
      if (b.typeLabel && b.typeLabel.value) g.types.add(b.typeLabel.value);
      if (b.launch && b.launch.value) g.launch = b.launch.value.slice(0, 10);
      if (b.website && b.website.value) g.website = b.website.value;
      if (b.article && b.article.value) g.article = b.article.value;
      groups.set(id, g);
    }
    const list = [...groups.values()], norad = request.norad ? String(request.norad).replace(/^0+/, '') : null;
    const cospar = normalizeCospar(request.cospar);
    const chosen = (norad && list.find(g => g.norad === norad)) || (cospar && list.find(g => g.cospar === cospar)) || list[0];
    if (!chosen) return null;
    const operators = [...chosen.operators.entries()].map(([full, meta]) => operatorDisplay(full, meta.short)).filter(Boolean);
    const unique = [...new Set(operators)];
    return {item:chosen.item.split('/').pop(), label:chosen.label, description:cleanDescription(chosen.description),
      operator:unique.length ? unique.slice(0, 3).join(' · ') : null, operatorFull:chosen.operators.size ? [...chosen.operators.keys()].join(' · ') : null,
      types:[...chosen.types], launchDate:chosen.launch, website:chosen.website, article:chosen.article,
      norad:chosen.norad || null, cospar:chosen.cospar || null, source:'Wikidata'};
  }
  function cleanDescription(text) {
    const s = clean(text); if (!s) return null;
    if (/disambiguation|wikimedia list|stub/i.test(s) || s.length < 12) return null;
    const trimmed = s.length > RULES.maxDescription ? s.slice(0, RULES.maxDescription - 1).replace(/\s+\S*$/, '') + '…' : s;
    return /[.?!]$/.test(trimmed) ? trimmed : trimmed + '.';
  }
  function missionCategory({types = [], description = '', objectType = null, name = '', groups = [], train = false} = {}) {
    if (train) return 'Starlink';
    if (isStarlinkName(name) || groups.includes('starlink')) return 'Starlink';
    const text = (types.join(' | ') + ' | ' + description).toLowerCase();
    const match = (re, category) => re.test(text) ? category : null;
    return match(/space station|crewed spacecraft|human spaceflight|space laboratory/, 'Human spaceflight')
      || match(/reconnaissance|military|spy satellite|reconnaissance satellite/, 'Military / defense')
      || match(/weather satellite|meteorological/, 'Weather')
      || match(/earth observation|remote sensing|earth sciences|climate/, 'Earth observation')
      || match(/communications? satellite|communication satellite|broadcasting satellite|telecommunications/, 'Communications')
      || match(/navigation satellite|global positioning|glonass|galileo satellite/, 'Navigation')
      || match(/space telescope|observatory|astronomical|astronomy/, 'Astronomy')
      || match(/research satellite|scientific satellite|science satellite|research spacecraft/, 'Scientific research')
      || match(/technology demonstration|demonstration satellite|experimental satellite|test satellite/, 'Technology demonstration')
      || (groups.includes('last-30-days') ? 'Recent launch' : null)
      || (objectType === 'Rocket body' ? 'Rocket body' : objectType === 'Debris' ? 'Debris' : null)
      || UNKNOWN;
  }
  function formatLaunch(date) {
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date + 'T00:00:00Z' : date);
    if (!Number.isFinite(ms)) return clean(date);
    return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',year:'numeric',month:'short',day:'numeric'}).format(new Date(ms));
  }
  /* Merge the layers. Never fabricates: an unresolved field stays null. */
  function combine({request = {}, identity = null, mission = null, known = null, at = Date.now()} = {}) {
    const norad = (known && known.norad) || clean(request.norad) || (identity && identity.norad) || (mission && mission.norad) || null;
    const cospar = (known && known.cospar) || normalizeCospar(request.cospar) || (identity && identity.cospar) || (mission && mission.cospar) || null;
    const name = (known && known.name) || titleCaseName(mission && mission.label) || titleCaseName(identity && identity.name) || titleCaseName(request.name) || null;
    const category = (known && known.category) || missionCategory({types:mission ? mission.types : [], description:mission ? mission.description : '',
      objectType:identity && identity.objectType, name:request.name, groups:request.groups, train:!!request.train}) || UNKNOWN;
    const description = (known && known.description) || (mission && mission.description) || null;
    const operator = (known && known.operator) || (mission && mission.operator) || null;
    const owner = identity ? identity.owner : null;
    const launchDate = (known && known.launchDate) || (identity && identity.launchDate) || (mission && mission.launchDate) || null;
    const link = (known && known.link) || (mission && (mission.article || mission.website)) || null;
    const sources = [identity && 'CelesTrak SATCAT', mission && 'Wikidata', known && 'Overhead known-object record'].filter(Boolean);
    // Full = operator + category + description + IDs. Partial = structured identity plus a
    // mission category. Identity = catalog fields only (type, IDs, launch). Unknown = nothing.
    const structuredOnly = category === UNKNOWN || category === 'Rocket body' || category === 'Debris';
    const level = sources.length === 0 ? 'unknown' : description ? 'full' : structuredOnly ? 'identity' : 'partial';
    return {key:cacheKey({...request, norad, cospar, name}) || (known && known.key) || null,
      norad:norad ? String(norad) : null, cospar, name, operator, owner, category,
      categoryLabel:(known && known.categoryLabel) || (category === UNKNOWN ? null : category),
      description, launchDate, launchSite:identity ? identity.launchSite : null, status:identity ? identity.status : null,
      objectType:identity ? identity.objectType : null, apogee:identity ? identity.apogee : null, perigee:identity ? identity.perigee : null,
      link, linkLabel:link ? (mission && mission.article ? 'Wikipedia' : 'Official site') : null,
      level, sources, identitySource:identity ? 'CelesTrak SATCAT' : known ? 'Overhead known-object record' : null,
      descriptionSource:description ? (known ? 'Overhead known-object record' : 'Wikidata') : null,
      cached:false, fetchedAt:at, error:null, warning:null};
  }
  function compactIdentity(meta) {
    if (!meta || meta.level === 'unknown') return null;
    if (meta.compact) return meta.compact;
    const who = meta.operator || meta.owner;
    if (!who) return null;
    const phrase = CATEGORY_PHRASE[meta.category] || (meta.category === UNKNOWN ? null : 'satellite');
    return phrase ? who + ' ' + phrase : null;
  }
  function provenance(meta) {
    if (!meta) return null;
    return {norad:meta.norad || null, cospar:meta.cospar || null, level:meta.level,
      identitySource:meta.identitySource || 'none', descriptionSource:meta.descriptionSource || 'none',
      cached:!!meta.cached, fetchedAt:meta.fetchedAt ? new Date(meta.fetchedAt).toISOString() : null,
      error:meta.error || null, warning:meta.warning || null};
  }
  function unknownMeta(request, at = Date.now()) {
    return {key:cacheKey(request), norad:clean(request && request.norad) || null, cospar:normalizeCospar(request && request.cospar) || null,
      name:titleCaseName(request && request.name) || null, operator:null, owner:null, category:UNKNOWN, categoryLabel:null, description:null,
      launchDate:null, launchSite:null, status:null, objectType:null, apogee:null, perigee:null, link:null, linkLabel:null,
      level:'unknown', sources:[], identitySource:null, descriptionSource:null, cached:false, fetchedAt:at, error:null, warning:null};
  }
  /* On-demand enricher. Never throws; failures return an "unknown" record so the event,
     the weekly ranking and every other feature stay untouched. */
  function createEnricher(options = {}) {
    const fetchJSON = options.fetchJSON, store = options.store || null;
    const now = options.now || (() => Date.now());
    const ttl = options.ttl || RULES.ttlDays * DAY;
    const memory = new Map(), pending = new Map(), negative = new Map();
    /* Two different outcomes are recorded separately:
       objectFailures — no source produced usable metadata for the object (error is shown in
         diagnostics and stored on the record);
       sourceWarnings — a source failed but another produced usable metadata, so the object
         is enriched with a warning (never a public error).
       `failures` remains as a compatibility alias for `objectFailures`. */
    const stats = {requests:0, objectFailures:0, sourceWarnings:0, lastError:null, lastWarning:null, cached:0,
      get failures() { return this.objectFailures; }};
    const usable = record => !!record && Number.isFinite(record.at) && now() - record.at < ttl && !!record.data;
    async function load(key, depth = 0) {
      if (memory.has(key)) return memory.get(key);
      if (!store || typeof store.get !== 'function') return null;
      try {
        const record = await store.get(key);
        // A COSPAR-only lookup may hit an alias written after a NORAD join resolved.
        if (usable(record) && record.aliasOf && depth < 2) return load(record.aliasOf, depth + 1);
        if (usable(record)) { memory.set(key, record); return record; }
        if (record && typeof store.delete === 'function') store.delete(key).catch(() => {});
      } catch {}
      return null;
    }
    async function save(record) {
      memory.set(record.key, record);
      if (!store || typeof store.put !== 'function') return;
      try { await store.put(record); } catch {}
    }
    async function fetchMeta(request, key) {
      let identity = null, mission = null; const failed = [];
      const satcat = satcatURL(request);
      if (satcat) {
        stats.requests++;
        try { identity = identityFromSatcat(selectSatcat(await fetchJSON(satcat), request)); }
        catch (e) { failed.push('CelesTrak SATCAT: ' + (e && e.message ? e.message : 'unavailable')); }
      }
      const joined = {norad:clean(request.norad) || (identity && identity.norad) || null,
        cospar:normalizeCospar(request.cospar) || (identity && identity.cospar) || null};
      const sparql = wikidataURL(joined);
      if (sparql) {
        stats.requests++;
        try {
          mission = missionFromWikidata(await fetchJSON(sparql), joined);
          if (!mission && joined.cospar && joined.norad) {
            const fallbackURL = wikidataURL({cospar:joined.cospar});
            if (fallbackURL && fallbackURL !== sparql) { stats.requests++; mission = missionFromWikidata(await fetchJSON(fallbackURL), joined); }
          }
        } catch (e) {
          failed.push('Wikidata: ' + (e && e.message ? e.message : 'unavailable'));
        }
      }
      if (!identity && !mission) {
        // Object failure: nothing usable from any source.
        stats.objectFailures++; stats.lastError = failed.join(' · ') || 'No metadata source returned a record';
        const unknown = {...unknownMeta({...request, ...joined}, now()), key, error:stats.lastError};
        negative.set(key, unknown);
        return unknown;
      }
      const meta = combine({request:{...request, ...joined}, identity, mission, at:now()});
      if (failed.length) {
        // Partial enrichment: verified data is kept and the failure is recorded for diagnostics.
        meta.warning = failed.join(' · ');
        stats.sourceWarnings += failed.length; stats.lastWarning = meta.warning;
      }
      // Store under the canonical (NORAD) key; remember the key the caller asked under so
      // TERRA, NORAD 25994 and COSPAR 1999-068A all resolve to the same cached record.
      const canonical = meta.key || key;
      await save({key:canonical, at:now(), data:meta});
      if (key !== canonical) await save({key, at:now(), aliasOf:canonical, data:meta});
      return meta;
    }
    async function resolve(request) {
      const shared = sharedIdentity(request);
      if (shared) return {...shared, level:'full', sources:['Overhead shared Starlink record'], identitySource:'Overhead shared Starlink record',
        descriptionSource:'Overhead shared Starlink record', categoryLabel:shared.categoryLabel || shared.category, cached:false, fetchedAt:now(), error:null};
      const known = knownIdentity(request);
      if (known) return {...combine({request, known, at:now()}), cached:false};
      const key = cacheKey(request);
      if (!key) return unknownMeta(request, now());
      const hit = await load(key);
      if (hit && hit.data) { stats.cached++; return {...hit.data, cached:true}; }
      if (negative.has(key)) return negative.get(key);
      if (pending.has(key)) return pending.get(key);
      const task = fetchMeta(request, key).then(meta => { pending.delete(key); return meta; },
        error => { pending.delete(key); stats.objectFailures++; stats.lastError = error && error.message ? error.message : 'Metadata lookup failed';
          const unknown = {...unknownMeta(request, now()), key, error:stats.lastError}; negative.set(key, unknown); return unknown; });
      pending.set(key, task);
      return task;
    }
    return {resolve, stats, cacheSize:() => memory.size, RULES};
  }
  root.OverheadObjects = {RULES, KNOWN, STARLINK, CATEGORIES, CATEGORY_PHRASE, UNKNOWN,
    normalizeCospar, titleCaseName, objectRequest, sharedIdentity, knownIdentity, operatorDisplay, cacheKey, satcatURL, wikidataURL,
    selectSatcat, identityFromSatcat, missionFromWikidata, missionCategory, combine, compactIdentity,
    provenance, unknownMeta, formatLaunch, createEnricher};
  if (typeof module !== 'undefined') module.exports = root.OverheadObjects;
})(typeof self !== 'undefined' ? self : globalThis);
