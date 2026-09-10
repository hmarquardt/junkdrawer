// Optional network QA, separate from fixture-driven tests. Uses existing Playwright.
// The page document is fulfilled at the GitHub Pages origin. Feed requests are REAL
// browser fetches: never routed, mocked, proxied, or sent through Node's HTTP stack.
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const page = await browser.newPage();
  const originPage = 'https://hmarquardt.github.io/junkdrawer/fixed-income-cors-probe.html';
  await page.route(originPage, route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixed Income CORS verification</title>'}));
  await page.goto(originPage);
  const now = new Date().toISOString().slice(0,10), year = now.slice(0,4), month=now.slice(0,7).replace('-','');
  const end=new Date(now+'T00:00:00Z'),start=new Date(end);start.setUTCFullYear(start.getUTCFullYear()-1);
  const treasury='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?';
  const urls=['daily_treasury_yield_curve','daily_treasury_real_yield_curve'].flatMap(data=>[
   treasury+`data=${data}&field_tdr_date_value_month=${month}`,
   treasury+`data=${data}&field_tdr_date_value=${year}`
  ]).concat('https://markets.newyorkfed.org/api/rates/all/latest.json',`https://markets.newyorkfed.org/api/rates/all/search.json?startDate=${start.toISOString().slice(0,10)}&endDate=${now}`);
  const results=await page.evaluate(async urls=>Promise.all(urls.map(async url=>{
   try {
    const response=await fetch(url,{signal:AbortSignal.timeout(30000),credentials:'omit',referrerPolicy:'no-referrer'});
    const body=await response.text();let dates=[];
    if(url.includes('treasury.gov'))dates=[...new DOMParser().parseFromString(body,'application/xml').getElementsByTagNameNS('*','NEW_DATE')].map(e=>e.textContent.slice(0,10));
    else dates=JSON.parse(body).refRates.map(r=>r.effectiveDate);
    dates.sort();return{url,status:response.status,responseType:response.type,readableBytes:body.length,observations:dates.length,firstDate:dates[0]||null,lastDate:dates.at(-1)||null};
   } catch(error){return{url,error:error.message}};
  })),urls);
  console.log(JSON.stringify({checked:new Date().toISOString(),origin:await page.evaluate(()=>location.origin),results},null,2));
  if(results.some(r=>r.error||r.status!==200||r.responseType!=='cors'))process.exitCode=1;
 } finally {await browser.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
