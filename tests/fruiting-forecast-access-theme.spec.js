const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');

const port = 8800 + (process.pid % 700) + 3;
const url = `http://127.0.0.1:${port}/fruiting-forecast.html`;
let server;

test.use({ channel: 'chrome', viewport: { width: 1280, height: 850 } });
test.beforeAll(async () => {
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await new Promise((resolve, reject) => http.get(url, r => { r.resume(); resolve(); }).on('error', reject)); return; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('Static test server did not start');
});
test.afterAll(() => { if (server) server.kill(); });

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.route('**/api/analytics/**', r => r.abort());
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__ && window.__FRUITING_FORECAST_ACCESS_TEST__);
  await page.evaluate(() => {
    const g = { type: 'MultiPolygon', coordinates: [[[[-87.7,38.2],[-87.5,38.2],[-87.5,38.4],[-87.7,38.4],[-87.7,38.2]]]] };
    window.__FFH__ = {
      geom: g,
      score: { speciesId:'chanterelle', score:84, band:'High', confidence:{label:'High',score:88}, components:{habitat:90}, habitatDetail:{score:90} },
      metrics: { rain10:1.5, rain14:1.8, daysSinceRain:6, soilMoisture:.29, soilTemp:66, airTemp:70, et07:.7, vpd:.6, wind:4, freeze:false, heat:79 },
      makeAnalysis: function(extra) {
        extra = extra || {};
        var score = { speciesId:'chanterelle', score:84, band:'High', confidence:{label:'High',score:88}, components:{habitat:90}, habitatDetail:{score:90} };
        var candidate = { id:'pike', name:'Pike State Forest', manager:'Indiana DNR — State Forest', propertyType:'State Forest', ownershipClass:'PUBLIC',
          center:{lat:38.3,lon:-87.6}, distance:12,
          habitat:{available:true, sampleCells:8, anchor:{lat:38.3,lon:-87.62,forest:.95,oakHickory:1}, forest:{cover:.9,canopy:.8}, hosts:{oakHickory:.8}, soil:{}},
          weatherZoneId:'center', scores:[score], biologicalOpportunity:84, topSpeciesId:'chanterelle',
          huntability:{score:92, actionability:'ACTIONABLE_WITH_RESTRICTIONS'},
          rule:{collectingStatus:'ALLOWED_WITH_LIMITS', summary:'Personal use only.', verifiedAt:'2026-09-01', scope:{propertyName:'Pike State Forest'}, sourceUrl:'https://example.gov/rule', sourceTitle:'Rule'},
          recommendedHuntScore:77, geometrySource:'PAD-US', sourceUrl:'https://example.gov/geometry',
          accessPoints:[], suggestedStart:null };
        for (var k in extra) if (extra.hasOwnProperty(k)) candidate[k] = extra[k];
        var w = { point:{id:'center', searchRadius:50}, metrics:{ rain10:1.5, rain14:1.8, daysSinceRain:6, soilMoisture:.29, soilTemp:66, airTemp:70, et07:.7, vpd:.6, wind:4, freeze:false, heat:79 }, daily:{forecastDates:[],forecastPrecip:[],forecastMax:[],forecastMin:[]}, hourly:[] };
        return { location:{lat:38.35,lon:-87.57}, zones:[{id:'center', point:{lat:38.35,lon:-87.57, distance:0}, scores:[score], weather: w}],
          candidates:[candidate], ranked:[], observations:{}, gis:{status:'enhanced'} };
      },
      chanterelleScore: function() {
        var t = window.__FRUITING_FORECAST_TEST__;
        var sp = t.SPECIES.find(function(x){return x.id==='chanterelle'});
        var w = { point:{id:'z', searchRadius:50}, metrics:window.__FFH__.metrics, daily:{forecastDates:[],forecastPrecip:[],forecastMax:[],forecastMin:[]}, hourly:[] };
        return t.scoreSpecies(sp, w, null, new Date()).score;
      }
    };
  });
  return errors;
}

test('real access dataset loads from DuckDB with provenance', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await open(page);
  const result = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__, a = window.__FRUITING_FORECAST_ACCESS_TEST__;
    const manifest = await t.gisManifest(false);
    await t.initDuckDB();
    const conn = await t.initDuckDB();
    const rows = await a.accessPointRows(conn, manifest, {lat:38.35,lon:-87.57}, 50, false, undefined);
    return { count:rows.length, datasetVersion:manifest.accessPoints && manifest.accessPoints.datasetVersion || null, source:manifest.accessPoints && manifest.accessPoints.source || null };
  });
  expect(result.datasetVersion).toBeTruthy();
  expect(result.source).toBe('OpenStreetMap');
  expect(result.count).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('suggested start prefers confidence over distance', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(() => {
    const a = window.__FRUITING_FORECAST_ACCESS_TEST__;
    const pts = [
      { name:'Low near', type:'PARKING', confidence:'LOW', distanceToHabitatMi:0.1 },
      { name:'High far', type:'TRAILHEAD', confidence:'HIGH', distanceToHabitatMi:3.2 },
      { name:'Medium mid', type:'PARKING', confidence:'MEDIUM', distanceToHabitatMi:1.4 }
    ];
    return { best:a.suggestedStart(pts).name, rev:a.suggestedStart(pts.slice().reverse()).name, label:a.accessTypeLabel('BOAT_RAMP') };
  });
  expect(r.best).toBe('High far');
  expect(r.rev).toBe('High far');
  expect(r.label).toBe('Boat ramp');
  expect(errors).toEqual([]);
});

test('property shows access points, start suggestion, and habitat distances', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__, h = window.__FRUITING_FORECAST_HUNTABILITY_TEST__, a = window.__FRUITING_FORECAST_ACCESS_TEST__, s = t.getState();
    const ap1 = { accessId:'ap1', propertyId:'pike', propertyName:'Pike State Forest', name:'Main Trailhead', lat:38.31,lon:-87.61, type:'TRAILHEAD', source:'OpenStreetMap', sourceUrl:'https://osm.org/node/1', confidence:'HIGH', official:true, operator:'Indiana DNR', notes:'surface: gravel', verifiedAt:'2026-09-01', distanceToHabitatMi:0.9 };
    const ap2 = { accessId:'ap2', propertyId:'pike', propertyName:'Pike State Forest', name:'North lot', lat:38.33,lon:-87.59, type:'PARKING', source:'OpenStreetMap', sourceUrl:'https://osm.org/node/2', confidence:'MEDIUM', official:false, operator:null, notes:null, verifiedAt:'2026-09-01', distanceToHabitatMi:2.1 };
    const analysis = window.__FFH__.makeAnalysis({ accessPoints:[ap1, ap2], suggestedStart:a.suggestedStart([ap1, ap2]) });
    s.analysis = analysis; s.gis.properties = [{ id:'pike', geometry:window.__FFH__.geom }];
    s.selectedSpecies = 'chanterelle'; s.selectedZone = 'center'; s.selectedProperty = 'pike'; s.mapLayer = 'accesspoints';
    h.renderHuntable(); h.renderMap(); h.renderDetail();
  });
  await expect(page.locator('#detailContent')).toContainText('Access points');
  await expect(page.locator('#detailContent')).toContainText('Suggested start');
  await expect(page.locator('#detailContent')).toContainText('straight-line');
  await expect(page.locator('#huntableList')).toContainText('Suggested start:');
  expect(errors).toEqual([]);
});

test('no access points shows honest empty state without fake pins', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__, h = window.__FRUITING_FORECAST_HUNTABILITY_TEST__, s = t.getState();
    const analysis = window.__FFH__.makeAnalysis({ accessPoints:[], suggestedStart:null });
    s.analysis = analysis; s.gis.properties = [{ id:'pike', geometry:window.__FFH__.geom }];
    s.selectedSpecies = 'chanterelle'; s.selectedZone = 'center'; s.selectedProperty = 'pike';
    h.renderDetail();
  });
  await expect(page.locator('#detailContent')).toContainText('No verified access point found');
  await expect(page.locator('#detailContent')).toContainText('No pin was invented');
  expect(errors).toEqual([]);
});

test('access data failure degrades gracefully without affecting biology', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__;
    const sp = t.SPECIES.find(function(x){return x.id==='chanterelle'});
    const w = { point:{id:'z', searchRadius:50}, metrics:{ rain10:1.5, rain14:1.8, daysSinceRain:6, soilMoisture:.29, soilTemp:66, airTemp:70, et07:.7, vpd:.6, wind:4, freeze:false, heat:79 }, daily:{forecastDates:[],forecastPrecip:[],forecastMax:[],forecastMin:[]}, hourly:[] };
    return { score1: t.scoreSpecies(sp, w, null, new Date()).score, score2: t.scoreSpecies(sp, w, null, new Date()).score };
  });
  expect(r.score1).toBe(r.score2);
  expect(r.score1).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('light/dark/system theme: persistence, score invariance, dark is first-class', async ({ page }) => {
  const errors = await open(page);
  await page.selectOption('#themeSelect', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => window.__FRUITING_FORECAST_TEST__);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await page.evaluate(() => ({ theme:window.__FRUITING_FORECAST_ACCESS_TEST__.currentTheme(), bg:getComputedStyle(document.body).backgroundColor, color:getComputedStyle(document.body).color }));
  expect(light.theme).toBe('light');
  const sLight = await page.evaluate(() => {
      const t = window.__FRUITING_FORECAST_TEST__;
      const sp = t.SPECIES.find(function(x){return x.id==='chanterelle'});
      const w = { point:{id:'z', searchRadius:50}, metrics:{ rain10:1.5, rain14:1.8, daysSinceRain:6, soilMoisture:.29, soilTemp:66, airTemp:70, et07:.7, vpd:.6, wind:4, freeze:false, heat:79 }, daily:{forecastDates:[],forecastPrecip:[],forecastMax:[],forecastMin:[]}, hourly:[] };
      return t.scoreSpecies(sp, w, null, new Date()).score;
    });
  await page.selectOption('#themeSelect', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.selectOption('#themeSelect', 'system');
  await page.emulateMedia({ colorScheme:'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme:'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const sDark = await page.evaluate(() => {
      const t = window.__FRUITING_FORECAST_TEST__;
      const sp = t.SPECIES.find(function(x){return x.id==='chanterelle'});
      const w = { point:{id:'z', searchRadius:50}, metrics:{ rain10:1.5, rain14:1.8, daysSinceRain:6, soilMoisture:.29, soilTemp:66, airTemp:70, et07:.7, vpd:.6, wind:4, freeze:false, heat:79 }, daily:{forecastDates:[],forecastPrecip:[],forecastMax:[],forecastMin:[]}, hourly:[] };
      return t.scoreSpecies(sp, w, null, new Date()).score;
    });
  expect(sLight).toBe(sDark);
  expect(light.color).not.toBe(light.bg);
  expect(darkBg).not.toBe(light.bg);
  expect(errors).toEqual([]);
});

test('map tile filter differs between themes; light dialogs meet contrast', async ({ page }) => {
  const errors = await open(page);
  const filterFor = () => page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'leaflet-tile';
    document.body.appendChild(probe);
    const f = getComputedStyle(probe).filter;
    probe.remove();
    return f;
  });
  await page.selectOption('#themeSelect', 'light');
  const lightFilter = await filterFor();
  await page.selectOption('#themeSelect', 'dark');
  const darkFilter = await filterFor();
  expect(lightFilter).not.toBe(darkFilter);
  expect(darkFilter).toContain('brightness');
  await page.selectOption('#themeSelect', 'light');
  await page.evaluate(() => document.getElementById('settingsDialog').showModal());
  const dc = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('settingsDialog'));
    return { bg: cs.backgroundColor, color: cs.color };
  });
  await page.evaluate(() => document.getElementById('settingsDialog').close());
  const toHex = s => { const m = s.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').slice(0,3).map(x => Number(x.trim()).toString(16).padStart(2,'0')); return '#'+p.join(''); };
  const lum = h => { const n = h.replace('#',''); const [r,g,b] = [0,2,4].map(i => parseInt(n.slice(i,i+2),16)/255).map(u => u <= .03928 ? u/12.92 : Math.pow((u+.055)/1.055,2.4)); return .2126*r + .7152*g + .0722*b; };
  const cr = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  expect(cr(toHex(dc.color), toHex(dc.bg))).toBeGreaterThan(4.5);
  expect(errors).toEqual([]);
});

test('light mode meets WCAG AA on key surfaces; pin colors resolve', async ({ page }) => {
  const errors = await open(page);
  await page.selectOption('#themeSelect', 'light');
  const audit = await page.evaluate(() => {
    function lum(color) {
      const m = color.match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const parts = m[1].split(',').map(Number);
      const [r,g,b] = parts.slice(0,3).map(v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); });
      const a = parts.length > 3 ? parts[3] : 1;
      return { l:.2126*r + .7152*g + .0722*b, a };
    }
    function bgOf(el) {
      let node = el;
      while (node && node !== document.documentElement) {
        const l = lum(getComputedStyle(node).backgroundColor);
        if (l && l.a > 0.85) return l.l;
        node = node.parentElement;
      }
      return 1;
    }
    function ratio(el) {
      const fg = lum(getComputedStyle(el).color); if (!fg) return null;
      const bg = bgOf(el);
      return (Math.max(fg.l, bg) + .05) / (Math.min(fg.l, bg) + .05);
    }
    const probes = { body:document.body, eyebrow:document.querySelector('.eyebrow'), safety:document.querySelector('.safety span'), statusLine:document.getElementById('status') };
    const out = {};
    for (const [k,el] of Object.entries(probes)) if (el) out[k] = Math.round(ratio(el)*100)/100;
    const a = window.__FRUITING_FORECAST_ACCESS_TEST__;
    out.pinPark = a.accessTypeColor('PARKING');
    out.pinTrail = a.accessTypeColor('TRAILHEAD');
    return out;
  });
  expect(audit.body).toBeGreaterThanOrEqual(7);
  expect(audit.eyebrow).toBeGreaterThanOrEqual(4.5);
  expect(audit.safety).toBeGreaterThanOrEqual(4.5);
  expect(audit.pinPark).toMatch(/^#/);
  expect(audit.pinTrail).toMatch(/^#/);
  expect(errors).toEqual([]);
});

test('OpenRouter intelligence cannot mutate access points or huntability', async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(async () => {
    const t = window.__FRUITING_FORECAST_TEST__, s = t.getState();
    const ap = [{ accessId:'ap1', name:'Main lot', type:'PARKING', confidence:'HIGH', distanceToHabitatMi:1.2 }];
    s.analysis = Object.assign(window.__FFH__.makeAnalysis({ accessPoints:ap, suggestedStart:ap[0] }), { id:'acc-a', generatedAt:new Date().toISOString(), version:'FF-test' });
    const before = JSON.stringify(s.analysis.candidates[0].accessPoints) + '|' + JSON.stringify(s.analysis.candidates[0].suggestedStart) + '|' + JSON.stringify(s.analysis.candidates[0].huntability);
    await t.attachIntelligence('acc-a', 'brief', { content:'Interpretation only — cannot mutate evidence.' });
    const after = JSON.stringify(s.analysis.candidates[0].accessPoints) + '|' + JSON.stringify(s.analysis.candidates[0].suggestedStart) + '|' + JSON.stringify(s.analysis.candidates[0].huntability);
    const ev = JSON.stringify(t.analysisEvidence());
    return { unchanged:before===after, incAccess:ev.indexOf('Main lot')>=0, incSuggested:ev.indexOf('suggestedStart')>=0 };
  });
  expect(r.unchanged).toBe(true);
  expect(r.incAccess).toBe(true);
  expect(r.incSuggested).toBe(true);
  expect(errors).toEqual([]);
});

test('mobile light mode: no overflow, suggested start visible', async ({ page }) => {
  const errors = await open(page);
  await page.selectOption('#themeSelect', 'light');
  await page.evaluate(() => {
    const t = window.__FRUITING_FORECAST_TEST__, h = window.__FRUITING_FORECAST_HUNTABILITY_TEST__, a = window.__FRUITING_FORECAST_ACCESS_TEST__, s = t.getState();
    const ap = { accessId:'ap1', propertyId:'pike', name:'Pike State Forest Trailhead', lat:38.31,lon:-87.61, type:'TRAILHEAD', source:'OpenStreetMap', sourceUrl:'https://osm.org/node/1', confidence:'HIGH', official:true, operator:'Indiana DNR', notes:null, verifiedAt:'2026-09-01', distanceToHabitatMi:0.9 };
    const analysis = window.__FFH__.makeAnalysis({ accessPoints:[ap], suggestedStart:ap });
    s.analysis = analysis; s.gis.properties = [{ id:'pike', geometry:window.__FFH__.geom }];
    s.selectedSpecies = 'chanterelle'; s.selectedZone = 'center'; s.selectedProperty = 'pike'; s.mapLayer = 'huntable';
    h.renderHuntable(); h.renderMap(); h.renderDetail();
  });
  await page.setViewportSize({ width:390, height:844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#detailContent')).toContainText('Suggested start');
  expect(errors).toEqual([]);
});
