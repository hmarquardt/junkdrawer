export function bindPressure(button, begin, release, cancel, move = ()=>{}, signal) {
  const options = {signal};
  let pointer = null, key = null;
  const abort = () => {
    if(pointer === null && key === null) return;
    pointer = key = null;
    cancel();
  };
  button.addEventListener('pointerdown', e => {
    if(e.button !== 0 || pointer !== null || key || !begin(e)) return;
    e.preventDefault();
    button.focus({preventScroll:true});
    pointer = e.pointerId;
    button.setPointerCapture(pointer);
  }, options);
  button.addEventListener('pointermove', e => { if(e.pointerId === pointer) move(e); });
  button.addEventListener('pointerup', e => {
    if(e.pointerId !== pointer) return;
    pointer = null; release();
  }, options);
  button.addEventListener('lostpointercapture', abort, options);
  button.addEventListener('pointercancel', abort, options);
  button.addEventListener('keydown', e => {
    if(![' ','Enter'].includes(e.key)) return;
    e.preventDefault();
    if(!e.repeat && !key && pointer === null && begin(e)) key = e.key;
  }, options);
  button.addEventListener('keyup', e => {
    if(e.key !== key) return;
    e.preventDefault(); key = null; release();
  }, options);
  button.addEventListener('blur', abort, options);
  window.addEventListener('blur',abort,options);
  document.addEventListener('visibilitychange', () => { if(document.hidden) abort(); }, options);
}
