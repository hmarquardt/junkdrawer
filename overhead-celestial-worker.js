/* Overhead celestial worker: computes the observing plan off the main thread.
   The page falls back to the same code synchronously if workers are unavailable, so the answer never
   depends on the worker existing. */
importScripts('vendor/overhead/astronomy-2.1.19.min.js', 'overhead-astro.js', 'overhead-opportunities.js',
  'overhead-planets.js', 'overhead-meteors.js', 'overhead-comets.js', 'overhead-celestial-plan.js');
self.onmessage = event => {
  const { id, request } = event.data || {};
  try {
    const result = self.OverheadCelestialPlan.compute(request);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
};
