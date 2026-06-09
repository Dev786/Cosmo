/* Shared site behaviors, loaded on every page:
   1. Scroll-reveal for .reveal elements (IntersectionObserver, once).
   2. Reading-progress bar (#arch-progress) on the Architecture page.
   3. Sticky-TOC scrollspy (.arch-toc) — highlights the chapter you're reading. */
(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- 1. scroll reveal ----
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if (reveals.length) {
    if (reduced || !('IntersectionObserver' in window)) {
      reveals.forEach(function (n) { n.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      reveals.forEach(function (n) { io.observe(n); });
    }
  }

  // ---- 1b. logo eyes follow the cursor ----
  var logoEyes = Array.prototype.slice.call(document.querySelectorAll('.brand-eyes i'));
  if (logoEyes.length && !reduced) {
    var rafL = null;
    window.addEventListener('mousemove', function (ev) {
      if (rafL) return;
      rafL = requestAnimationFrame(function () {
        rafL = null;
        logoEyes.forEach(function (eye) {
          var r = eye.getBoundingClientRect();
          if (!r.width) return;
          var dx = ev.clientX - (r.left + r.width / 2);
          var dy = ev.clientY - (r.top + r.height / 2);
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var max = r.width * 0.2;                 // a couple px of travel
          var mag = Math.max(0.3, Math.min(1, dist / 420));
          eye.style.setProperty('--ex', (dx / dist * max * mag).toFixed(2) + 'px');
          eye.style.setProperty('--ey', (dy / dist * max * mag).toFixed(2) + 'px');
        });
      });
    }, { passive: true });
  }

  // ---- 2. reading-progress bar ----
  var bar = document.getElementById('arch-progress');
  if (bar) {
    var onScroll = function () {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---- 3. TOC scrollspy ----
  var toc = document.querySelector('.arch-toc');
  if (toc) {
    var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
    var map = {};
    var chapters = links.map(function (a) {
      var id = a.getAttribute('href').slice(1);
      map[id] = a;
      return document.getElementById(id);
    }).filter(Boolean);

    if ('IntersectionObserver' in window && chapters.length) {
      var current = null;
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            if (current) current.classList.remove('is-active');
            var a = map[e.target.id];
            if (a) { a.classList.add('is-active'); current = a; }
          }
        });
      }, { rootMargin: '-80px 0px -65% 0px', threshold: 0 });
      chapters.forEach(function (c) { spy.observe(c); });
    }
  }

  // ---- 4. zoomable system map ----
  var mapEl = document.querySelector('.arch-map');
  if (mapEl) {
    var vp = mapEl.querySelector('.arch-map__viewport');
    var canvas = mapEl.querySelector('.arch-map__canvas');
    var svg = canvas && canvas.querySelector('svg');
    if (vp && canvas && svg) {
      var vbW = (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) || 1180;
      var vbH = (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height) || 800;
      var scale = 1, tx = 0, ty = 0, minS = 0.25, maxS = 4;
      canvas.style.width = vbW + 'px'; canvas.style.height = vbH + 'px';
      var apply = function () { canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; };
      var fit = function () {
        var r = vp.getBoundingClientRect();
        scale = Math.max(minS, Math.min(maxS, Math.min(r.width / vbW, r.height / vbH) * 0.98));
        tx = (r.width - vbW * scale) / 2;
        ty = (r.height - vbH * scale) / 2;
        apply();
      };
      var zoomAt = function (cx, cy, factor) {
        var ns = Math.max(minS, Math.min(maxS, scale * factor));
        tx = cx - (cx - tx) * (ns / scale);
        ty = cy - (cy - ty) * (ns / scale);
        scale = ns; apply();
      };
      vp.addEventListener('wheel', function (e) {
        e.preventDefault();
        var r = vp.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      }, { passive: false });
      var dragging = false, lx = 0, ly = 0;
      vp.addEventListener('pointerdown', function (e) {
        dragging = true; lx = e.clientX; ly = e.clientY; vp.classList.add('is-grab');
        if (vp.setPointerCapture) try { vp.setPointerCapture(e.pointerId); } catch (_) {}
      });
      vp.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY; apply();
      });
      var endDrag = function () { dragging = false; vp.classList.remove('is-grab'); };
      vp.addEventListener('pointerup', endDrag);
      vp.addEventListener('pointercancel', endDrag);
      Array.prototype.forEach.call(mapEl.querySelectorAll('[data-zoom]'), function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-zoom');
          if (k === 'reset') { fit(); return; }
          var r = vp.getBoundingClientRect();
          zoomAt(r.width / 2, r.height / 2, k === 'in' ? 1.25 : 0.8);
        });
      });
      fit();
      window.addEventListener('resize', fit);
    }
  }
})();
