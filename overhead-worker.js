/* A cancellable worker keeps SGP4 calculation off the interaction thread. */
// SunCalc 1.9's UMD export targets window; expose the worker global under that name.
self.window=self;
importScripts('vendor/overhead/satellite-6.0.1.min.js',
  'vendor/overhead/suncalc-1.9.0.js','overhead-engine.js');
self.onmessage=({data})=>{
  const began=performance.now();
  try {
    for(const [index,window] of data.windows.entries()) {
      const passes=[];let rejected=0;
      for(const object of data.objects) {
        try { passes.push(...OverheadEngine.detectPasses(object,data.site,window.start,window.end,data.minimum)); }
        catch { rejected++; }
      }
      self.postMessage({index,passes,rejected,duration:performance.now()-began});
    }
    self.postMessage({done:true,duration:performance.now()-began});
  } catch(error) { self.postMessage({error:error.message}); }
};
