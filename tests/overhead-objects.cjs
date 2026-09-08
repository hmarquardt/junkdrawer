/* Run: node tests/overhead-objects.cjs
   Deterministic object-metadata tests: no network, no npm. Fixtures are shaped like the
   real CelesTrak SATCAT and Wikidata SPARQL responses. */
const assert = require('node:assert/strict');
const O = require('../overhead-objects.js');
const W = require('../overhead-weekly.js');

const literal = value => ({type:'literal', value});
const binding = (extra) => Object.assign({item:{type:'uri',value:'http://www.wikidata.org/entity/Q584697'},
  norad:literal('25994'), cospar:literal('1999-068A'),
  itemLabel:literal('Terra'),
  itemDescription:literal('NASA climate research satellite'),
  operatorLabel:literal('National Aeronautics and Space Administration'),
  operatorShort:literal('NASA'),
  launch:{datatype:'http://www.w3.org/2001/XMLSchema#dateTime', type:'literal', value:'1999-12-18T00:00:00Z'},
  website:{type:'uri',value:'https://terra.nasa.gov/'},
  article:{type:'uri',value:'https://en.wikipedia.org/wiki/Terra_(satellite)'}}, extra);
const sparql = rows => ({head:{vars:[]}, results:{bindings:rows}});
const TERRA_WIKIDATA = sparql([
  binding({typeLabel:literal('Earth observation satellite')}),
  binding({typeLabel:literal('artificial satellite of the Earth')})
]);
const TERRA_SATCAT = [{OBJECT_NAME:'TERRA',OBJECT_ID:'1999-068A',NORAD_CAT_ID:25994,OBJECT_TYPE:'PAY',OPS_STATUS_CODE:'X',OWNER:'US',
  LAUNCH_DATE:'1999-12-18',LAUNCH_SITE:'AFWTR',DECAY_DATE:'',PERIOD:98.55,INCLINATION:97.94,APOGEE:691,PERIGEE:688,RCS:12.444,
  DATA_STATUS_CODE:'',ORBIT_CENTER:'EA',ORBIT_TYPE:'ORB'}];
const TERRA_PASS = {id:'pass-1',norad:'25994',name:'TERRA',groups:['visual'],train:null};
// Wikidata typed but description- and operator-free: the documented "partial" case
// (structured identity + mission category, no plain-English description).
const NOAA_WIKIDATA = sparql([{item:{value:'http://www.wikidata.org/entity/Q46996282'},norad:{value:'43013'},
  cospar:{value:'2017-072A'},itemLabel:{value:'NOAA-20'},launch:{value:'2017-11-18T00:00:00Z'},typeLabel:{value:'weather satellite'}}]);
const NOAA_SATCAT = [{OBJECT_NAME:'NOAA-20',OBJECT_ID:'2017-072A',NORAD_CAT_ID:43013,OBJECT_TYPE:'PAY',OPS_STATUS_CODE:'+',OWNER:'US',
  LAUNCH_DATE:'2017-11-18',LAUNCH_SITE:'AFWTR'}];
const ROCKET_BODY_SATCAT = [{OBJECT_NAME:'SL-16 R/B',OBJECT_ID:'1999-068B',NORAD_CAT_ID:12345,OBJECT_TYPE:'R/B',OPS_STATUS_CODE:'',OWNER:'CIS',
  LAUNCH_DATE:'1999-12-18',LAUNCH_SITE:'PKMTR'}];

function fetcher(map) {
  const calls = [];
  return {calls, fetch: async url => {
    calls.push(url);
    for (const [fragment, response] of map) if (url.includes(fragment)) {
      if (response instanceof Error) throw response;
      return response;
    }
    throw Error('Unexpected request: ' + url);
  }};
}
function memoryStore() {
  const records = new Map();
  return {records, get: async key => records.get(key) || null, put: async record => { records.set(record.key, record); },
    delete: async key => { records.delete(key); }};
}
const results = [];
(async () => {
  // Run the async checks sequentially so the deterministic fixtures stay simple.
  for (const run of [
    async () => {
      const source = fetcher([['satcat/records.php', TERRA_SATCAT], ['query.wikidata.org', TERRA_WIKIDATA]]);
      const enricher = O.createEnricher({fetchJSON: source.fetch, store: memoryStore(), now: () => Date.parse('2026-09-08T12:00Z')});
      const meta = await enricher.resolve(O.objectRequest(TERRA_PASS));
      assert.equal(meta.norad, '25994');
      assert.equal(meta.cospar, '1999-068A');
      assert.equal(meta.name, 'Terra');
      assert.equal(meta.operator, 'NASA');
      assert.equal(meta.category, 'Earth observation');
      assert.equal(meta.launchDate, '1999-12-18');
      assert.equal(meta.launchSite, 'Vandenberg, California');
      assert.equal(meta.status, 'Extended mission');
      assert.equal(meta.level, 'full');
      assert.match(meta.description, /climate research satellite/);
      assert.equal(meta.link, 'https://en.wikipedia.org/wiki/Terra_(satellite)');
      assert.equal(meta.key, 'norad:25994');
      assert.deepEqual(meta.sources, ['CelesTrak SATCAT', 'Wikidata']);
      assert.equal(O.formatLaunch(meta.launchDate), 'Dec 18, 1999');
      assert.equal(O.compactIdentity(meta), 'NASA Earth-observation satellite');
      results.push('1 Terra resolves by NORAD: operator, category, launch date, launch site, status, IDs, description and link');
    },
    async () => {
      // 2. SATCAT alone populates launch/owner/type fields (identity-only level).
      const source = fetcher([['satcat/records.php', ROCKET_BODY_SATCAT], ['query.wikidata.org', sparql([])]]);
      const enricher = O.createEnricher({fetchJSON: source.fetch, store: memoryStore()});
      const meta = await enricher.resolve({norad:'12345', name:'SL-16 R/B', groups:[], train:null, cospar:null});
      assert.equal(meta.level, 'identity');
      assert.equal(meta.objectType, 'Rocket body');
      assert.equal(meta.owner, 'Russia');
      assert.equal(meta.launchDate, '1999-12-18');
      assert.equal(meta.launchSite, 'Plesetsk, Russia');
      assert.equal(meta.description, null);
      assert.equal(meta.identitySource, 'CelesTrak SATCAT');
      assert.equal(meta.descriptionSource, null);
      // Only verified structured fields are offered; no mission purpose is invented.
      assert.equal(O.compactIdentity(meta), 'Russia spent rocket body');
      // NOAA-20: structured identity plus a category, no description = partial.
      const partial = await O.createEnricher({fetchJSON: fetcher([['satcat/records.php', NOAA_SATCAT], ['query.wikidata.org', NOAA_WIKIDATA]]).fetch})
        .resolve({norad:'43013', name:'NOAA-20', groups:[], train:null, cospar:null});
      assert.equal(partial.level, 'partial');
      assert.equal(partial.category, 'Weather');
      assert.equal(partial.launchDate, '2017-11-18');
      assert.equal(O.formatLaunch(partial.launchDate), 'Nov 18, 2017');
      assert.equal(partial.description, null);
      assert.equal(O.compactIdentity(partial), 'United States weather satellite');
      results.push('2 SATCAT populates launch/owner/type; partial and identity-only levels stay honest (no invented purpose)');
    },
    async () => {
      // 3. Rich mission description resolves from the structured source (Wikidata).
      const mission = O.missionFromWikidata(TERRA_WIKIDATA, {norad:'25994'});
      assert.equal(mission.source, 'Wikidata');
      assert.equal(mission.operator, 'NASA');
      assert.equal(mission.item, 'Q584697');
      assert.deepEqual(mission.types.sort(), ['Earth observation satellite', 'artificial satellite of the Earth']);
      assert.match(mission.description, /satellite/);
      assert.equal(O.missionFromWikidata({results:{bindings:[]}}, {norad:'1'}), null);
      assert.equal(O.missionFromWikidata(undefined, {norad:'1'}), null);
      assert.equal(O.missionFromWikidata(sparql([{item:{value:'http://www.wikidata.org/entity/Q1'}, itemDescription:{value:'Wikimedia disambiguation page'}}]), {norad:'1'}).description, null);
      results.push('3 Wikidata description, operator, category types and source resolve; disambiguation stubs rejected');
    },
    async () => {
      // 4. Metadata lookup failure leaves the object describable as unknown, never throws.
      const source = fetcher([['satcat/records.php', Error('HTTP 500')], ['query.wikidata.org', Error('HTTP 503')]]);
      const enricher = O.createEnricher({fetchJSON: source.fetch, store: memoryStore()});
      const meta = await enricher.resolve(O.objectRequest(TERRA_PASS));
      assert.equal(meta.level, 'unknown');
      assert.equal(meta.name, 'Terra');
      assert.equal(meta.norad, '25994');
      assert.equal(meta.description, null);
      assert.equal(meta.operator, null);
      assert.equal(O.compactIdentity(meta), null);
      assert.match(meta.error, /CelesTrak SATCAT/);
      assert.equal(enricher.stats.failures, 1); // one object failed, both sources tried
      assert.equal(enricher.stats.requests, 2);
      // A second resolve must not hammer a dead source again in the same session.
      const again = await enricher.resolve(O.objectRequest(TERRA_PASS));
      assert.equal(again.level, 'unknown');
      assert.equal(source.calls.length, 2);
      results.push('4 Metadata failure returns a usable unknown record, never throws, and does not retry in-session');
    },
    async () => {
      // 5. Weekly winner shows a compact one-line identity.
      const meta = O.combine({request:O.objectRequest(TERRA_PASS), identity:O.identityFromSatcat(TERRA_SATCAT[0]),
        mission:O.missionFromWikidata(TERRA_WIKIDATA, {norad:'25994'})});
      assert.equal(O.compactIdentity(meta), 'NASA Earth-observation satellite');
      assert.equal(O.compactIdentity({level:'unknown'}), null);
      assert.equal(O.compactIdentity(null), null);
      for (const known of ['25544', '48274', '20580']) {
        const local = O.KNOWN[known];
        assert.ok(local.description && local.operator && local.category, known);
        assert.equal(O.compactIdentity({...local, level:'full', operator:local.operator, category:local.category}),
          ({'25544':'International partnership crewed spacecraft', '48274':'CNSA crewed spacecraft', '20580':'NASA · ESA space observatory'})[known]);
      }
      // Recognizable objects use the tiny local record: no network at all.
      const local = fetcher([]);
      const iss = await O.createEnricher({fetchJSON: local.fetch}).resolve(O.objectRequest({norad:'25544', name:'ISS (ZARYA)', groups:['stations']}));
      assert.equal(iss.level, 'full');
      assert.equal(iss.name, 'International Space Station');
      assert.equal(iss.operator, 'International partnership');
      assert.equal(iss.cospar, '1998-067A');
      assert.equal(local.calls.length, 0);
      assert.deepEqual(iss.sources, ['Overhead known-object record']);
      results.push('5 Compact weekly identity: "NASA Earth-observation satellite" for Terra, known objects included (ISS offline), unknown → nothing');
    },
    async () => {
      // 6. Starlink uses one shared record: 300 satellites, zero mission lookups.
      const source = fetcher([]);
      const enricher = O.createEnricher({fetchJSON: source.fetch, store: memoryStore()});
      const first = await enricher.resolve(O.objectRequest({norad:'70001', name:'STARLINK-70001', groups:['starlink'], train:null}));
      assert.equal(first.key, 'starlink:object');
      assert.equal(first.operator, 'SpaceX');
      assert.equal(first.category, 'Starlink');
      assert.match(first.description, /Starlink broadband satellite constellation/);
      for (let i = 0; i < 300; i++) {
        const meta = await enricher.resolve(O.objectRequest({norad:String(70000 + i), name:'STARLINK-' + (70000 + i), groups:['starlink'], train:null}));
        assert.equal(meta.key, first.key);
      }
      assert.equal(source.calls.length, 0);
      assert.equal(enricher.stats.requests, 0);
      assert.equal(O.compactIdentity(first), 'SpaceX Starlink broadband satellite');
      results.push('6 301 Starlink objects share one record with zero metadata requests');
    },
    async () => {
      // 7. A train event gets the shared Starlink train identity.
      const source = fetcher([]);
      const enricher = O.createEnricher({fetchJSON: source.fetch, store: memoryStore()});
      const train = {id:'train-2026-210-1', norad:'train-2026-210', name:'Starlink train 2026-210', groups:['trains'],
        train:{cohortId:'2026-210', launchDate:'2026-09-06'}};
      const meta = await enricher.resolve(O.objectRequest(train));
      assert.equal(meta.key, 'starlink:train');
      assert.equal(meta.operator, 'SpaceX');
      assert.equal(meta.categoryLabel, 'Recently launched Starlink group');
      assert.equal(meta.compact || O.compactIdentity(meta), 'SpaceX recently launched Starlink group');
      assert.match(meta.description, /recently launched Starlink/);
      assert.equal(source.calls.length, 0);
      results.push('7 Train event resolves to the shared recently-launched Starlink group identity with no lookup');
    },
    async () => {
      // 8. Unknown object falls back gracefully (no SATCAT row, no Wikidata match).
      const source = fetcher([['satcat/records.php', []], ['query.wikidata.org', sparql([])]]);
      const enricher = O.createEnricher({fetchJSON: source.fetch, store: memoryStore()});
      const meta = await enricher.resolve({norad:'54321', name:'OBJECT 54321', groups:[], train:null, cospar:null});
      assert.equal(meta.level, 'unknown');
      assert.equal(meta.description, null);
      assert.equal(meta.category, 'unknown / other');
      assert.equal(meta.norad, '54321');
      assert.equal(O.provenance(meta).identitySource, 'none');
      results.push('8 Unknown object: level unknown, identifiers preserved, no fabricated mission');
    },
    async () => {
      // 9. The bounded metadata cache prevents repeated fetches (and survives a new session).
      const store = memoryStore();
      const first = fetcher([['satcat/records.php', TERRA_SATCAT], ['query.wikidata.org', TERRA_WIKIDATA]]);
      const a = O.createEnricher({fetchJSON: first.fetch, store, now: () => Date.parse('2026-09-08T12:00Z')});
      const meta = await a.resolve(O.objectRequest(TERRA_PASS));
      assert.equal(first.calls.length, 2);
      const again = await a.resolve(O.objectRequest(TERRA_PASS));
      assert.equal(again.cached, true);
      assert.equal(first.calls.length, 2);
      // Fresh session, fresh enricher: the persisted record is reused, nothing is refetched.
      const second = fetcher([]);
      const b = O.createEnricher({fetchJSON: second.fetch, store, now: () => Date.parse('2026-09-09T12:00Z')});
      const restored = await b.resolve(O.objectRequest(TERRA_PASS));
      assert.equal(restored.cached, true);
      assert.equal(restored.operator, 'NASA');
      assert.equal(second.calls.length, 0);
      assert.deepEqual(O.provenance(restored), {norad:'25994', cospar:'1999-068A', level:'full', identitySource:'CelesTrak SATCAT',
        descriptionSource:'Wikidata', cached:true, fetchedAt:'2026-09-08T12:00:00.000Z', error:null});
      // Deterministic identifier join: an object known only by COSPAR (imported element,
      // train cohort) resolves to the same record and is cached under its NORAD key.
      const joinStore = memoryStore();
      const joinFetch = fetcher([['satcat/records.php', TERRA_SATCAT], ['query.wikidata.org', TERRA_WIKIDATA]]);
      const byCospar = await O.createEnricher({fetchJSON: joinFetch.fetch, store: joinStore, now: () => Date.parse('2026-09-08T12:00Z')})
        .resolve({norad:null, cospar:'1999-068A', name:'TERRA', groups:[], train:null});
      assert.equal(byCospar.key, 'norad:25994');
      assert.equal(byCospar.operator, 'NASA');
      assert.equal(joinFetch.calls.length, 2);
      const afterJoin = fetcher([]);
      const byNorad = await O.createEnricher({fetchJSON: afterJoin.fetch, store: joinStore, now: () => Date.parse('2026-09-09T12:00Z')})
        .resolve(O.objectRequest(TERRA_PASS));
      assert.equal(byNorad.cached, true);
      assert.equal(byNorad.key, 'norad:25994');
      assert.equal(afterJoin.calls.length, 0);
      // Expired records are refetched, not trusted.
      const expired = fetcher([['satcat/records.php', TERRA_SATCAT], ['query.wikidata.org', TERRA_WIKIDATA]]);
      const c = O.createEnricher({fetchJSON: expired.fetch, store, now: () => Date.parse('2026-10-10T12:00Z')});
      assert.equal((await c.resolve(O.objectRequest(TERRA_PASS))).cached, false);
      assert.equal(expired.calls.length, 2);
      assert.equal(O.RULES.ttlDays, 21);
      assert.equal(O.RULES.maxRecords, 200);
      results.push('9 Cache: one fetch per object, reused across sessions, COSPAR joins to the NORAD record, expired records refetched (21-day TTL, 200-record cap)');
    },
    async () => {
      // 10. Metadata requests carry spacecraft identifiers only — never observer coordinates.
      const site = {lat:38.3553, lon:-87.5675, name:'Princeton, Indiana', tz:'America/Chicago'};
      const urls = [O.satcatURL({norad:'25994'}), O.satcatURL({cospar:'1999-068A'}), O.wikidataURL({norad:'25994'}), O.wikidataURL({cospar:'1999-068A'})];
      for (const url of urls) {
        const parsed = new URL(url);
        assert.ok(/celestrak\.org$|query\.wikidata\.org$/.test(parsed.hostname), url);
        assert.ok(!/38\.3553|-87\.5675|lat|lon|Princeton/i.test(decodeURIComponent(url)), url);
        // Identifier parameters only: never latitude, longitude, site name or timezone.
        const params = [...parsed.searchParams.keys()];
        assert.ok(params.every(p => ['CATNR', 'INTDES', 'NAME', 'FORMAT', 'format', 'query'].includes(p)), url);
        assert.deepEqual([...new URL(O.wikidataURL({norad:'25994'})).searchParams.keys()], ['format', 'query']);
      }
      assert.deepEqual([...new URL(O.satcatURL({cospar:'1999-068A'})).searchParams.keys()].sort(), ['FORMAT', 'INTDES']);
      assert.deepEqual([...new URL(O.satcatURL({norad:'25994'})).searchParams.keys()].sort(), ['CATNR', 'FORMAT']);
      assert.match(decodeURIComponent(O.wikidataURL({norad:'25994'})), /wdt:P377 \?norad/);
      assert.match(decodeURIComponent(O.wikidataURL({norad:'25994'})), /VALUES \?norad \{ "25994" \}/);
      assert.match(decodeURIComponent(O.wikidataURL({cospar:'1999-068A'})), /VALUES \?cospar \{ "1999-068A" \}/);
      assert.equal(O.wikidataURL({norad:null, cospar:null, name:'TERRA'}), null);
      assert.equal(JSON.stringify(site).includes('38.3553'), true); // sanity: the fixture really has coordinates
      results.push('10 Request URLs contain identifiers only: no latitude, longitude, site name or coordinates');
    },
    async () => {
      // 11. Metadata source failure cannot change weekly ranking or best-week selection.
      const now = Date.parse('2026-09-07T18:00Z'), day = 86400000;
      const windows = Array.from({length:7}, (_, i) => ({start:now + i * day, end:now + (i + 1) * day, day:'night-' + i}));
      const point = {t:now + 3600000, el:81, az:315, sun:-18, lit:true, range:450, lat:38, lon:-87};
      const base = {id:'a', norad:'25994', name:'TERRA', groups:['visual'], start:now + 3600000, end:now + 3960000, rise:now + 3540000,
        set:now + 4000000, duration:342, likely:true, provisional:false, score:96, brightness:.68,
        peak:{...point}, orbitalPeak:{...point}, entry:{...point, el:10}, exit:{...point, el:10, az:90}, path:[{...point, el:10}, {...point}],
        w:{cloud_cover:0, visibility:25000, precipitation:0}, epoch:now - 3600000};
      const other = {...base, id:'b', norad:'12345', name:'UNKNOWN 12345', score:70, peak:{...point, el:40}, groups:[]};
      const results0 = {0:[base, other]};
      const rank = () => W.rankWeeklyEvents(results0, windows, {now, complete:true, weatherSource:{at:now}});
      const before = rank();
      assert.equal(before.winner.pass.id, 'a');
      const enricher = O.createEnricher({fetchJSON: async () => { throw Error('offline'); }, store: memoryStore()});
      const metas = await Promise.all([base, other].map(p => enricher.resolve(O.objectRequest(p))));
      assert.deepEqual(metas.map(m => m.level), ['unknown', 'unknown']);
      const after = rank();
      assert.equal(after.winner.pass.id, before.winner.pass.id);
      assert.equal(after.winner.classification.label, before.winner.classification.label);
      assert.equal(after.eventsConsidered, before.eventsConsidered);
      assert.equal(JSON.stringify(after.entries.map(e => [e.pass.id, e.pass.score, e.significance])),
        JSON.stringify(before.entries.map(e => [e.pass.id, e.pass.score, e.significance])));
      // Passes are never mutated by enrichment.
      assert.equal(JSON.stringify([base, other]), JSON.stringify((() => {
        const p = {t:now + 3600000, el:81, az:315, sun:-18, lit:true, range:450, lat:38, lon:-87};
        return [{...base, peak:{...p}, orbitalPeak:{...p}, entry:{...p, el:10}, exit:{...p, el:10, az:90}, path:[{...p, el:10}, {...p}]},
          {...other, peak:{...p, el:40}, orbitalPeak:{...p}, entry:{...p, el:10}, exit:{...p, el:10, az:90}, path:[{...p, el:10}, {...p}]}];
      })()));
      results.push('11 Metadata failure leaves weekly ranking, winner, classification and pass objects byte-identical');
    }
  ]) await run();
  console.log('PASS ' + results.length + ' object-metadata scenarios:\n' + results.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
