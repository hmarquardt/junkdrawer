const {test,expect}=require('@playwright/test');
const fs=require('fs');
const crypto=require('crypto');
test.use({channel:'chrome'});
const origin='https://hmarquardt.github.io';
async function open(page){
 await page.route('**/*',r=>r.fulfill({status:200,body:''}));
 await page.route(origin+'/junkdrawer/fruiting-forecast.html',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('fruiting-forecast.html','utf8')}));
 await page.goto(origin+'/junkdrawer/fruiting-forecast.html');
 await page.waitForFunction(()=>window.__FRUITING_FORECAST_CACHE_TEST__);
}
const bytes=Buffer.from('verified fixture');
const asset={url:'habitat/fixture.parquet',datasetVersion:'fixture-v1',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
test('Parquet URL join is provider neutral; JSON and legacy remain app hosted',async({page})=>{
 await open(page);
 const result=await page.evaluate(()=>{const s=__FRUITING_FORECAST_TEST__.getState(),t=__FRUITING_FORECAST_CACHE_TEST__;s.gis.manifest={};const legacy=t.gisAssetUrl('habitat/a.parquet');s.gis.manifest.assetBaseUrl='https://objects.example/data';const remote=t.gisAssetUrl('habitat/a.parquet');const json=t.gisAssetUrl('rules.json');s.gis.manifest.assetBaseUrl+='///';return {legacy,remote,json,trailing:t.gisAssetUrl('habitat/a.parquet')}});
 expect(result).toEqual({legacy:origin+'/junkdrawer/data/fruiting-forecast/habitat/a.parquet',remote:'https://objects.example/data/habitat/a.parquet',json:origin+'/junkdrawer/data/fruiting-forecast/rules.json',trailing:'https://objects.example/data/habitat/a.parquet'});
});
test('verified cache survives host migration with no second Parquet request',async({page})=>{
 await open(page);let requests=0;
 await page.route('**/*.parquet',r=>{requests++;return r.fulfill({body:bytes,headers:{'Access-Control-Allow-Origin':origin}})});
 const result=await page.evaluate(async asset=>{const s=__FRUITING_FORECAST_TEST__.getState(),t=__FRUITING_FORECAST_CACHE_TEST__;s.gis.manifest={assetBaseUrl:'https://first.example/'};await t.gisAssetBytes('fixture',asset,false);s.gis.manifest.assetBaseUrl='https://second.example/';const b=await t.gisAssetBytes('fixture',asset,false);return new TextDecoder().decode(b)},asset);
 expect(result).toBe('verified fixture');expect(requests).toBe(1);
});
test('remote failure uses verified cache; uncached failure stays unavailable',async({page})=>{
 await open(page);
 await page.route('**/*.parquet',r=>r.fulfill({body:bytes}));
 await page.evaluate(async a=>{__FRUITING_FORECAST_TEST__.getState().gis.manifest={};await __FRUITING_FORECAST_CACHE_TEST__.gisAssetBytes('fixture',a,false)},asset);
 await page.route('**/*.parquet',r=>r.fulfill({status:503,body:'unavailable'}));
 const r=await page.evaluate(async a=>{const t=__FRUITING_FORECAST_CACHE_TEST__;const b=await t.gisAssetBytes('fixture',a,true);let missing;try{await t.gisAssetBytes('uncached',a,false)}catch(e){missing=e.message}return {body:new TextDecoder().decode(b),missing}},asset);
 expect(r.body).toBe('verified fixture');expect(r.missing).toContain('HTTP 503');
});
test('incorrect length and SHA are rejected and never cached',async({page})=>{
 await open(page);await page.route('**/*.parquet',r=>r.fulfill({body:Buffer.from('bad')}));
 const a=await page.evaluate(async a=>{try{await __FRUITING_FORECAST_CACHE_TEST__.gisAssetBytes('bad-size',a,false)}catch(e){return e.message}},asset);expect(a).toContain('unexpected size');
 await page.route('**/*.parquet',r=>r.fulfill({body:Buffer.alloc(bytes.length)}));
 const b=await page.evaluate(async a=>{try{await __FRUITING_FORECAST_CACHE_TEST__.gisAssetBytes('bad-hash',a,false)}catch(e){return e.message}},asset);expect(b).toContain('checksum mismatch');
 expect(await page.evaluate(async()=> (await __FRUITING_FORECAST_TEST__.dbAll('cache')).filter(x=>x.gis).length)).toBe(0);
});
test('abort never returns cached bytes as a successful refresh',async({page})=>{
 await open(page);await page.route('**/*.parquet',r=>r.fulfill({body:bytes}));
 const result=await page.evaluate(async a=>{const t=__FRUITING_FORECAST_CACHE_TEST__;await t.gisAssetBytes('fixture',a,false);const c=new AbortController();c.abort();try{await t.gisAssetBytes('fixture',a,true,c.signal)}catch(e){return e.name}},asset);expect(result).toBe('AbortError');
});
test('biology declarations and scoring code are byte-identical to Phase-1B baseline',()=>{
 const {execFileSync}=require('child_process');const old=execFileSync('git',['show','92e968ede9df96312721b559d9a5a5c3062142cc:fruiting-forecast.html'],{encoding:'utf8'}),now=fs.readFileSync('fruiting-forecast.html','utf8');
 const range=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b));
 expect(range(now,'  var SPECIES=','  var state=')).toBe(range(old,'  var SPECIES=','  var state='));
 for(const name of ['scoreSpecies','scoreHabitat','monthScore','rangeScore']){
  const fn=s=>{const start=s.indexOf('function '+name+'(');expect(start).toBeGreaterThan(0);return s.slice(start,s.indexOf('\n',start))};expect(fn(now)).toBe(fn(old));
 }
});
