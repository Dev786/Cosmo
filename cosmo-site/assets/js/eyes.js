/* ============================================================================
   CosmoEyes — a standalone, faithful recreation of the desktop app's "classic"
   expression pack (src/renderer/packs/classic). Pure DOM + inline CSS, no deps.
   Drives the hero, the demo stage, the funnel modal.

   The cuteness comes from four things the real pack has and a flat pair of
   circles doesn't: (1) soft cheek blush, (2) a glossy dark crescent at the
   bottom of the white, (3) a drop-shadow that lifts the eye off the page, and
   (4) two catch-lights clustered top-right (one big, one small) reading as a
   single wet highlight — not two mismatched reflections.

   Usage:
     const eyes = new CosmoEyes(el, { scale: 2.2, interactive: true });
     eyes.setState('happy'); eyes.pulse('heart');
   ========================================================================== */
(function (global) {
  'use strict';
  var clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };
  var rand = function (lo, hi) { return lo + Math.random() * (hi - lo); };
  var EASE = 'cubic-bezier(.34,.12,.2,1)';

  // Per-mood recipe — base px @ scale 1, mirrors recipes.ts exactly.
  //   outer/inner: eye + white diameters · ox/oy: white offset (px, -=up/left)
  //   lid: top-eyelid coverage 0..1 · sy: vertical squish · op: opacity
  //   hl/hlx/hly: catch-light size + top-right anchor · rot: per-eye tilt
  var R = {
    idle:      { outer: 58, inner: 28, ox: -3, oy: -4, lid: 0,    sy: 1,    op: 1,   gap: 24, hl: 11, hlx: '57%', hly: '12%', rot: 0, tilt: 0,  color: '#1e1e2e', mouth: 'smile' },
    listening: { outer: 70, inner: 34, ox: 0,  oy: -1, lid: 0,    sy: 1.04, op: 1,   gap: 24, hl: 14, hlx: '57%', hly: '12%', rot: 0, tilt: -8, color: '#1e1e2e', mouth: 'smile' },
    thinking:  { outer: 56, inner: 24, ox: 5,  oy: -6, lid: 0,    sy: 1,    op: 1,   gap: 24, hl: 10, hlx: '64%', hly: '12%', rot: 0, tilt: 0,  color: '#1e1e2e', mouth: 'smile' },
    speaking:  { outer: 58, inner: 26, ox: -3, oy: -4, lid: 0,    sy: 1.08, op: 1,   gap: 24, hl: 11, hlx: '57%', hly: '12%', rot: 0, tilt: 0,  color: '#1e1e2e', mouth: 'talk' },
    happy:     { outer: 62, inner: 0,  ox: 0,  oy: 0,  lid: 0,    sy: 0.32, op: 1,   gap: 26, hl: 0,  hlx: '57%', hly: '12%', rot: 0, tilt: 0,  color: '#1e1e2e', mouth: 'grin' },
    bored:     { outer: 58, inner: 26, ox: -3, oy: 4,  lid: 0.35, sy: 1,    op: 1,   gap: 24, hl: 10, hlx: '57%', hly: '12%', rot: 0, tilt: 0,  color: '#1e1e2e', mouth: 'flat' },
    annoyed:   { outer: 58, inner: 22, ox: 0,  oy: 2,  lid: 0.18, sy: 0.88, op: 1,   gap: 24, hl: 8,  hlx: '57%', hly: '12%', rot: 6, tilt: 0,  color: '#2e1e1e', mouth: 'frown' },
    sleeping:  { outer: 58, inner: 0,  ox: 0,  oy: 0,  lid: 0,    sy: 0.12, op: 0.7, gap: 24, hl: 0,  hlx: '57%', hly: '12%', rot: 0, tilt: 0,  color: '#2a2a3e', mouth: 'flat' },
  };

  function el(css) { var d = document.createElement('div'); if (css) d.style.cssText = css; return d; }

  function CosmoEyes(container, opts) {
    opts = opts || {};
    this.s = opts.scale || 1;
    this.interactive = !!opts.interactive;
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.state = 'idle';
    this.gaze = { x: 0, y: 0 };
    this.lastGaze = 0;
    this.timers = [];

    container.innerHTML = '';
    var face = el('position:relative;display:inline-flex;flex-direction:column;align-items:center;');
    var area = el('position:relative;display:inline-flex;align-items:center;justify-content:center;');
    var eyes = el('display:flex;align-items:center;justify-content:center;');
    this.eyes = [this._buildEye(), this._buildEye()];
    eyes.appendChild(this.eyes[0].wrap);
    eyes.appendChild(this.eyes[1].wrap);
    // Soft cheek blush — the single biggest "cute, not creepy" factor.
    this.blushL = this._buildBlush('left:6%');
    this.blushR = this._buildBlush('right:6%');
    area.appendChild(eyes);
    area.appendChild(this.blushL);
    area.appendChild(this.blushR);
    this.mouth = el('border-style:solid;border-color:#2d2d3e;transition:all .22s ease;');
    face.appendChild(area);
    face.appendChild(this.mouth);
    container.appendChild(face);
    this.faceEl = face; this.eyesEl = eyes; this.areaEl = area;

    this.apply('idle', true);
    if (!this.reduced) {
      this._scheduleBlink();
      this._scheduleWander();
      if (this.interactive) this._bindCursor();
    }
  }

  CosmoEyes.prototype._buildEye = function () {
    var wrap = el('position:relative;border-radius:50%;flex-shrink:0;overflow:hidden;' +
      'filter:drop-shadow(0 3px 8px rgba(0,0,0,.35));' +
      'transition:width .28s ' + EASE + ',height .28s ' + EASE + ',transform .28s ' + EASE + ',background .3s ease,opacity .3s ease;');
    var inner = el('position:absolute;border-radius:50%;background:#fff;pointer-events:none;' +
      'transition:width .28s ' + EASE + ',height .28s ' + EASE + ',left .16s ' + EASE + ',top .16s ' + EASE + ',opacity .2s ease;');
    // Glossy dark crescent across the bottom of the white = wet, 3-D shine.
    var gloss = el('position:absolute;left:0;bottom:0;width:100%;height:55%;z-index:2;pointer-events:none;' +
      'background:radial-gradient(ellipse at bottom,rgba(0,0,0,.20) 0%,transparent 72%);');
    var hl1 = el('position:absolute;border-radius:50%;background:rgba(255,255,255,.92);z-index:5;pointer-events:none;');
    var hl2 = el('position:absolute;border-radius:50%;background:rgba(255,255,255,.75);z-index:5;pointer-events:none;');
    var lid = el('position:absolute;left:0;top:0;width:100%;height:0;z-index:10;');
    wrap.appendChild(inner); wrap.appendChild(gloss);
    wrap.appendChild(hl1); wrap.appendChild(hl2); wrap.appendChild(lid);
    return { wrap: wrap, inner: inner, hl1: hl1, hl2: hl2, lid: lid };
  };

  CosmoEyes.prototype._buildBlush = function (side) {
    return el('position:absolute;bottom:2%;' + side + ';border-radius:50%;' +
      'background:rgba(255,150,162,.5);transition:opacity .4s ease,background .3s ease;opacity:.6;pointer-events:none;');
  };

  // Render a mood's geometry. `instant` skips transitions on first paint.
  CosmoEyes.prototype.apply = function (name, instant) {
    var r = R[name] || R.idle, s = this.s, self = this;
    this.state = name;
    this.eyesEl.style.gap = (r.gap * s) + 'px';
    this.faceEl.style.transition = 'transform .26s ease';
    this.faceEl.style.transform = 'rotate(' + (r.tilt || 0) + 'deg)';
    this.eyes.forEach(function (eye) {
      if (instant) eye.wrap.style.transition = 'none';
      var w = r.outer * s, h = r.outer * s;
      eye.wrap.style.width = w + 'px';
      eye.wrap.style.height = h + 'px';
      eye.wrap.style.background = r.color;
      eye.wrap.style.opacity = r.op;
      eye.wrap.style.transform = 'scaleY(' + r.sy + ') rotate(' + (r.rot || 0) + 'deg)';
      // white inner
      var iw = r.inner * s;
      if (iw > 0) {
        eye.inner.style.display = 'block';
        eye.inner.style.width = iw + 'px';
        eye.inner.style.height = iw + 'px';
        self._pupil(eye, r);
      } else {
        eye.inner.style.display = 'none';
      }
      // catch-lights, clustered top-right of the white
      var hl = r.hl * s;
      if (hl > 0) {
        eye.hl1.style.display = 'block'; eye.hl2.style.display = 'block';
        eye.hl1.style.width = hl + 'px'; eye.hl1.style.height = hl + 'px';
        eye.hl1.style.left = r.hlx; eye.hl1.style.top = r.hly;
        eye.hl2.style.width = (hl * 0.5) + 'px'; eye.hl2.style.height = (hl * 0.5) + 'px';
        eye.hl2.style.left = 'calc(' + r.hlx + ' + ' + (hl - 2) + 'px)';
        eye.hl2.style.top = 'calc(' + r.hly + ' + ' + (hl - 2) + 'px)';
      } else {
        eye.hl1.style.display = 'none'; eye.hl2.style.display = 'none';
      }
      // eyelid rest coverage
      eye.lid.style.background = r.color;
      eye.lid.style.height = (r.lid * h) + 'px';
      if (instant) { void eye.wrap.offsetWidth; eye.wrap.style.transition = ''; }
    });
    // blush — bigger/pinker when happy, gone when annoyed
    var bw = r.outer * 0.5 * s, bh = r.outer * 0.19 * s;
    var bop = name === 'happy' ? '0.9' : name === 'annoyed' ? '0' : name === 'sleeping' ? '0.35' : '0.6';
    [this.blushL, this.blushR].forEach(function (b) {
      b.style.width = bw + 'px'; b.style.height = bh + 'px'; b.style.opacity = bop;
    });
    this._mouth(r.mouth);
  };

  // Position the white = base offset (scaled) + live gaze, anchored top-left.
  CosmoEyes.prototype._pupil = function (eye, r) {
    var s = this.s;
    var gx = this.gaze.x * 13 * s, gy = this.gaze.y * 8 * s;
    var base = (r.outer - r.inner) / 2 * s;
    eye.inner.style.left = (base + r.ox * s + gx) + 'px';
    eye.inner.style.top = (base + r.oy * s + gy) + 'px';
  };

  CosmoEyes.prototype._mouth = function (kind) {
    var s = this.s, m = this.mouth;
    m.style.marginTop = (5 * s) + 'px';
    m.style.background = 'transparent';
    m.style.borderColor = '#2d2d3e';
    var set = function (w, h, bw, sideTop, radius, op) {
      m.style.width = (w * s) + 'px'; m.style.height = (h * s) + 'px';
      var b = (bw * s) + 'px';
      m.style.borderWidth = sideTop ? (b + ' ' + b + ' 0 ' + b) : ('0 ' + b + ' ' + b + ' ' + b);
      m.style.borderRadius = radius;
      m.style.opacity = String(op);
    };
    var r = function (v) { return (v * s) + 'px'; };
    switch (kind) {
      case 'grin':  set(24, 10, 3, false, '0 0 ' + r(14) + ' ' + r(14), 0.82); break;
      case 'flat':  m.style.borderColor = '#2d2d3e'; m.style.width = (14 * s) + 'px'; m.style.height = (3 * s) + 'px';
                    m.style.borderWidth = '0 0 ' + (2 * s) + 'px 0'; m.style.borderRadius = '0'; m.style.opacity = '0.5'; break;
      case 'frown': set(18, 6, 3, true, r(10) + ' ' + r(10) + ' 0 0', 0.7); break;
      case 'talk':  m.style.borderWidth = '0'; m.style.background = '#46313c'; m.style.width = (11 * s) + 'px';
                    m.style.height = (9 * s) + 'px'; m.style.borderRadius = '50%'; m.style.opacity = '0.9'; break;
      default:      set(20, 8, 3, false, '0 0 ' + r(12) + ' ' + r(12), 0.72); // smile
    }
  };

  CosmoEyes.prototype.setState = function (name) {
    if (!R[name]) return;
    this.apply(name);
    if (name === 'speaking' && !this.reduced) this._lipsync();
  };

  // Cursor-follow gaze (idle/bored/speaking only — locked while thinking/listening).
  CosmoEyes.prototype.setGaze = function (dx, dy) {
    if (this.state === 'thinking' || this.state === 'listening') return;
    this.gaze.x = clamp(dx, -1, 1); this.gaze.y = clamp(dy, -1, 1);
    this.lastGaze = Date.now();
    var r = R[this.state] || R.idle, self = this;
    this.eyes.forEach(function (eye) { if (r.inner) self._pupil(eye, r); });
  };

  CosmoEyes.prototype.blink = function () {
    var r = R[this.state] || R.idle, self = this;
    this.eyes.forEach(function (eye) {
      var h = parseFloat(eye.wrap.style.height) || (r.outer * self.s);
      eye.lid.style.transition = 'height .055s ease-in';
      eye.lid.style.height = h + 'px';
      self._after(125, function () {
        eye.lid.style.transition = 'height .085s ease-out';
        eye.lid.style.height = (r.lid * h) + 'px';
      });
    });
  };

  CosmoEyes.prototype.pulse = function (name) {
    var self = this;
    if (name === 'blink') return this.blink();
    if (name === 'lookAround' || name === 'lookAway') {
      this.setGaze(-1, 0);
      this._after(360, function () { self.setGaze(1, 0); });
      this._after(780, function () { self.setGaze(0, 0); });
      return;
    }
    if (name === 'heart' || name === 'giggle') {
      this._floater('❤', '#ff6b8a');
      if (this.blushL) { this.blushL.style.opacity = '0.95'; this.blushR.style.opacity = '0.95'; }
      this._after(900, function () { self.apply(self.state); });
      return;
    }
    if (name === 'startle') {
      this.eyes.forEach(function (eye) { eye.wrap.style.transform = 'scaleY(1.2)'; });
      this._after(220, function () { self.apply(self.state); });
      return;
    }
    if (name === 'yawn' || name === 'stretch') {
      this.eyes.forEach(function (eye) { eye.wrap.style.transform = 'scaleY(1.12)'; });
      this._after(320, function () { self.apply(self.state); });
    }
  };

  CosmoEyes.prototype._floater = function (glyph, color) {
    var f = document.createElement('div');
    f.textContent = glyph;
    f.style.cssText = 'position:absolute;left:54%;top:-2px;font-size:' + (16 * this.s / 2) +
      'px;color:' + color + ';pointer-events:none;transition:transform 1.3s ease-out,opacity 1.3s;opacity:1;z-index:20;';
    this.faceEl.appendChild(f);
    requestAnimationFrame(function () { f.style.transform = 'translate(8px,-46px) scale(1.1)'; f.style.opacity = '0'; });
    this._after(1350, function () { f.remove(); });
  };

  CosmoEyes.prototype._lipsync = function () {
    var self = this;
    if (this.state !== 'speaking') return;
    var frames = [[8, 5], [13, 12], [11, 8], [15, 15], [11, 7]], s = this.s, i = 0;
    var tick = function () {
      if (self.state !== 'speaking') { self._mouth('smile'); return; }
      var f = frames[i % frames.length]; i++;
      self.mouth.style.transition = 'width .09s ease,height .09s ease';
      self.mouth.style.borderWidth = '0'; self.mouth.style.borderRadius = '50%';
      self.mouth.style.background = '#46313c'; self.mouth.style.opacity = '0.9';
      self.mouth.style.width = (f[0] * s) + 'px'; self.mouth.style.height = (f[1] * s) + 'px';
      self._after(115, tick);
    };
    tick();
  };

  CosmoEyes.prototype._scheduleBlink = function () {
    var self = this;
    var next = function () { self.blink(); self._after(rand(3500, 6500), next); };
    this._after(rand(3500, 6500), next);
  };

  CosmoEyes.prototype._scheduleWander = function () {
    var self = this;
    var next = function () {
      if (Date.now() - self.lastGaze > 1600 && self.state !== 'thinking' && self.state !== 'listening') {
        self.gaze.x = rand(-0.4, 0.4); self.gaze.y = rand(-0.5, 0.25);
        var r = R[self.state] || R.idle;
        self.eyes.forEach(function (eye) { if (r.inner) self._pupil(eye, r); });
      }
      self._after(rand(2200, 4700), next);
    };
    this._after(rand(2200, 4700), next);
  };

  CosmoEyes.prototype._bindCursor = function () {
    var self = this;
    this._onMove = function (ev) {
      var rect = self.faceEl.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      self.setGaze((ev.clientX - cx) / 260, (ev.clientY - cy) / 260);
    };
    window.addEventListener('mousemove', this._onMove, { passive: true });
  };

  CosmoEyes.prototype._after = function (ms, fn) { var t = setTimeout(fn, ms); this.timers.push(t); return t; };
  CosmoEyes.prototype.stop = function () {
    this.timers.forEach(clearTimeout); this.timers = [];
    if (this._onMove) window.removeEventListener('mousemove', this._onMove);
  };

  global.CosmoEyes = CosmoEyes;
})(window);
