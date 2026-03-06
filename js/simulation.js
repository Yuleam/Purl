/**
 * Knitting — Simulation (Scrollytelling)
 * 한 해의 뜨개질 시뮬레이션: 월별 카드, 실타래 경로, Canvas 오버뷰
 * 의존: window.KnittingNotes, window.KnittingThreads (from data.js)
 */
(function () {
  'use strict';

  var NOTES = window.KnittingNotes || [];
  var THREADS = window.KnittingThreads || [];
  var MNAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  var noteThreads = [];
  for (var i = 0; i < NOTES.length; i++) noteThreads.push([]);
  THREADS.forEach(function (th, ti) {
    th.ids.forEach(function (id) { if (noteThreads[id].indexOf(ti) === -1) noteThreads[id].push(ti); });
  });

  function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  function buildMonths() {
    var container = document.getElementById('months');
    var buckets = [];
    for (var m = 0; m < 12; m++) buckets.push([]);
    NOTES.forEach(function (n, i) { buckets[n.m].push(i); });

    buckets.forEach(function (ids, m) {
      if (ids.length === 0) return;
      var sec = document.createElement('div');
      sec.className = 'ks-month';
      var label = document.createElement('div');
      label.className = 'ks-month__label';
      label.textContent = MNAMES[m];
      sec.appendChild(label);
      var list = document.createElement('div');
      list.className = 'ks-month__notes';

      ids.forEach(function (idx) {
        var note = NOTES[idx];
        var threads = noteThreads[idx];
        var card = document.createElement('div');
        card.className = 'ks-card' + (threads.length > 1 ? ' ks-card--cross' : '');

        if (threads.length > 0) {
          var bars = document.createElement('div');
          bars.className = 'ks-card__bars';
          threads.forEach(function (ti) {
            var bar = document.createElement('div');
            bar.className = 'ks-card__bar';
            bar.style.background = THREADS[ti].c;
            bars.appendChild(bar);
          });
          card.appendChild(bars);
        }

        var title = document.createElement('h3');
        title.className = 'ks-card__title';
        title.textContent = note.t;
        card.appendChild(title);

        var excerpt = document.createElement('p');
        excerpt.className = 'ks-card__excerpt';
        excerpt.textContent = note.e;
        card.appendChild(excerpt);

        var footer = document.createElement('div');
        footer.className = 'ks-card__footer';
        if (threads.length > 1) {
          var knot = document.createElement('span');
          knot.className = 'ks-card__knot';
          var c1 = THREADS[threads[0]].c;
          var c2 = THREADS[threads[1]] ? THREADS[threads[1]].c : c1;
          knot.style.cssText = '--kc1:' + c1 + '; --kc2:' + c2;
          footer.appendChild(knot);
        }
        threads.forEach(function (ti) {
          var dot = document.createElement('span');
          dot.className = 'ks-card__dot';
          dot.style.background = THREADS[ti].c;
          footer.appendChild(dot);
        });
        card.appendChild(footer);
        list.appendChild(card);
      });
      sec.appendChild(list);
      container.appendChild(sec);
    });
  }

  function buildThreads() {
    var container = document.getElementById('threadList');

    THREADS.forEach(function (th, ti) {
      var div = document.createElement('div');
      div.className = 'ks-thread';
      var head = document.createElement('div');
      head.className = 'ks-thread__head';
      head.innerHTML = '<span class="ks-thread__color" style="background:' + th.c + '"></span><span class="ks-thread__name">' + esc(th.n) + '</span>';
      div.appendChild(head);

      var items = document.createElement('div');
      items.className = 'ks-thread__items';
      items.id = 'thread' + ti;
      var style = document.createElement('style');
      style.textContent = '#thread' + ti + '::before{background:' + th.c + '22;}';
      document.head.appendChild(style);

      var sorted = th.ids.slice().sort(function (a, b) { return NOTES[a].m - NOTES[b].m; });
      sorted.forEach(function (idx) {
        var note = NOTES[idx];
        var item = document.createElement('div');
        item.className = 'ks-thread__item';
        var dot = document.createElement('span');
        dot.className = 'ks-thread__item-dot';
        dot.style.background = th.c;
        item.appendChild(dot);
        var month = document.createElement('div');
        month.className = 'ks-thread__item-month';
        month.textContent = MNAMES[note.m];
        item.appendChild(month);
        var text = document.createElement('div');
        text.className = 'ks-thread__item-text';
        text.textContent = note.e;
        item.appendChild(text);
        var ttl = document.createElement('div');
        ttl.className = 'ks-thread__item-title';
        ttl.textContent = '— ' + note.t;
        item.appendChild(ttl);

        var others = noteThreads[idx].filter(function (x) { return x !== ti; });
        if (others.length > 0) {
          var othersDiv = document.createElement('div');
          othersDiv.className = 'ks-thread__item-others';
          others.forEach(function (oti) {
            var d = document.createElement('span');
            d.className = 'ks-card__dot';
            d.style.background = THREADS[oti].c;
            othersDiv.appendChild(d);
          });
          item.appendChild(othersDiv);
        }
        items.appendChild(item);
      });
      div.appendChild(items);
      container.appendChild(div);
    });
  }

  function srand(seed) { var x = Math.sin(seed * 9301 + 49297) * 49271; return x - Math.floor(x); }

  function hexAlpha(hex, a) {
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function drawOverview(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.offsetWidth;
    var H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var padX = W * 0.1; var padY = H * 0.2;
    var usableW = W - padX * 2; var usableH = H - padY * 2;

    var buckets = [];
    for (var m = 0; m < 12; m++) buckets.push([]);
    NOTES.forEach(function (n, i) { buckets[n.m].push(i); });

    var pos = [];
    for (var i = 0; i < NOTES.length; i++) pos.push({ x: 0, y: 0 });
    buckets.forEach(function (ids, m) {
      var cx = padX + (m + 0.5) / 12 * usableW;
      ids.forEach(function (idx, j) {
        var spread = ids.length > 1 ? j / (ids.length - 1) : 0.5;
        pos[idx] = { x: cx + (srand(idx) - 0.5) * (usableW / 16), y: padY + spread * usableH };
      });
    });

    THREADS.forEach(function (th, ti) {
      var sorted = th.ids.slice().sort(function (a, b) { return pos[a].x - pos[b].x; });
      if (sorted.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pos[sorted[0]].x, pos[sorted[0]].y);
      for (var k = 1; k < sorted.length; k++) {
        var p0 = pos[sorted[k - 1]]; var p1 = pos[sorted[k]];
        var cpx = (p0.x + p1.x) / 2; var cpy = (p0.y + p1.y) / 2 + (srand(ti * 100 + k) - 0.5) * 40;
        ctx.quadraticCurveTo(cpx, cpy, p1.x, p1.y);
      }
      ctx.strokeStyle = hexAlpha(th.c, 0.25);
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    NOTES.forEach(function (n, i) {
      var p = pos[i]; var threads = noteThreads[i];
      var r = threads.length > 1 ? 3.5 : 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = threads.length > 0 ? hexAlpha(THREADS[threads[0]].c, 0.5) : 'rgba(80,80,80,0.3)';
      ctx.fill();
    });
  }

  function setupObserver() {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) entry.target.classList.add('is-visible'); });
    }, { threshold: 0.15 });
    document.querySelectorAll('.ks-card, .ks-thread__item').forEach(function (el) { observer.observe(el); });
  }

  function injectKnotStyles() {
    var style = document.createElement('style');
    style.textContent =
      '.ks-card__knot::before { background: var(--kc1, #b8956a); }' +
      '.ks-card__knot::after { background: var(--kc2, #6ba3c2); }';
    document.head.appendChild(style);
  }

  function init() {
    injectKnotStyles();
    buildMonths();
    buildThreads();
    drawOverview('overviewCanvas');
    drawOverview('closingCanvas');
    setupObserver();
    window.addEventListener('resize', function () {
      drawOverview('overviewCanvas');
      drawOverview('closingCanvas');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
