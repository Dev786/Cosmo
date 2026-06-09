/* Home hero: an interactive CosmoEyes that follows the cursor and warms up with a
   little personality. */
(function () {
  'use strict';
  const box = document.getElementById('hero-eyes');
  if (!box || !window.CosmoEyes) return;
  const eyes = new CosmoEyes(box, { scale: 2.4, interactive: true });
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  // A small "hello": glance around, then a happy beat.
  setTimeout(() => eyes.pulse('lookAround'), 1200);
  setTimeout(() => { eyes.setState('happy'); eyes.pulse('heart'); }, 3000);
  setTimeout(() => eyes.setState('idle'), 4600);
  box.addEventListener('click', () => { eyes.setState('happy'); eyes.pulse('heart'); setTimeout(() => eyes.setState('idle'), 1400); });
})();
