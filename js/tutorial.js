/**
 * Knitting — Tutorial
 * 가이드 페이지의 인터랙티브 4단계 체험
 * 의존: window.KnittingNotes, window.KnittingThreads (from data.js)
 */
(function () {
  'use strict';

  var currentStep = 0;
  var totalSteps = 4;
  var stepCompleted = [false, false, false, false];
  var stitchOrder = [];
  var clueMarked = 0;

  var $progress = document.getElementById('tutProgress');
  var $stage = document.getElementById('tutStage');
  var $prev = document.getElementById('tutPrev');
  var $next = document.getElementById('tutNext');

  if (!$progress || !$stage) return;

  var $steps = $stage.querySelectorAll('.tut-step');
  var $progSteps = $progress.querySelectorAll('.tut-progress__step');
  var $progLines = $progress.querySelectorAll('.tut-progress__line');

  function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  function goStep(idx) {
    if (idx < 0 || idx >= totalSteps) return;
    currentStep = idx;
    $steps.forEach(function (el) { el.classList.remove('is-active'); });
    $steps[idx].classList.add('is-active');
    $progSteps.forEach(function (el, i) {
      el.classList.remove('is-active');
      el.classList.toggle('is-done', i < idx || stepCompleted[i]);
      if (i === idx) el.classList.add('is-active');
    });
    $progLines.forEach(function (el, i) { el.classList.toggle('is-filled', i < idx); });
    $prev.style.display = idx > 0 ? '' : 'none';
    updateNextBtn();
    if (idx === 1) syncStep1Thread();
    if (idx === 3) drawResultLines();
  }

  function updateNextBtn() {
    var done = stepCompleted[currentStep];
    $next.disabled = !done;
    if (currentStep === totalSteps - 1 && done) {
      $next.textContent = '뜨개질 시작하기';
      $next.classList.add('is-complete');
    } else {
      $next.textContent = '다음 단계';
      $next.classList.remove('is-complete');
    }
  }

  $prev.addEventListener('click', function () { goStep(currentStep - 1); });
  $next.addEventListener('click', function () {
    if (currentStep === totalSteps - 1 && stepCompleted[currentStep]) {
      window.location.href = 'index.html';
      return;
    }
    goStep(currentStep + 1);
  });

  // Step 0: Thread Create
  var $createBtn = document.getElementById('createThreadBtn');
  var $threadForm = document.getElementById('threadForm');
  var $threadCreate = document.getElementById('threadCreate');
  var $threadResult = document.getElementById('threadResult');
  var $confirmBtn = document.getElementById('confirmThreadBtn');
  var $nameInput = document.getElementById('threadNameInput');
  var $descInput = document.getElementById('threadDescInput');
  var $resultName = document.getElementById('threadResultName');
  var $resultDesc = document.getElementById('threadResultDesc');

  if ($createBtn) {
    $createBtn.addEventListener('click', function () {
      $threadCreate.style.display = 'none';
      $threadForm.style.display = '';
      $nameInput.focus();
      $nameInput.select();
    });
  }

  if ($confirmBtn) {
    $confirmBtn.addEventListener('click', function () {
      var name = $nameInput.value.trim() || '나의 아침 루틴';
      var desc = $descInput.value.trim();
      $threadForm.style.display = 'none';
      $threadResult.style.display = '';
      $resultName.textContent = name;
      $resultDesc.textContent = desc || '';
      stepCompleted[0] = true;
      updateNextBtn();
    });
    $nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') $confirmBtn.click(); });
  }

  // Step 1: Stitch Pool
  var $stitchList = document.getElementById('stitchList');
  var $stitchEmpty = document.getElementById('stitchEmpty');
  var $stitchPool = document.getElementById('stitchPool');
  var $stitchThreadName = document.getElementById('stitchThreadName');

  function syncStep1Thread() {
    var name = $nameInput ? ($nameInput.value.trim() || '나의 아침 루틴') : '나의 아침 루틴';
    if ($stitchThreadName) $stitchThreadName.textContent = name;
  }

  function buildStitchPool() {
    if (!$stitchPool || !window.KnittingNotes || !window.KnittingNotes.length) return;
    $stitchPool.innerHTML = '';
    window.KnittingNotes.forEach(function (n, i) {
      var card = document.createElement('div');
      card.className = 'tut-note-card';
      card.dataset.noteId = 'n' + i;
      card.innerHTML = '<h4>' + esc(n.t) + '</h4><p>' + esc(n.e) + '</p>';
      $stitchPool.appendChild(card);
    });
  }

  buildStitchPool();

  function renderStitches() {
    if (!$stitchList) return;
    $stitchList.innerHTML = '';
    if (stitchOrder.length === 0) {
      $stitchEmpty.style.display = '';
      stepCompleted[1] = false;
    } else {
      $stitchEmpty.style.display = 'none';
      stepCompleted[1] = stitchOrder.length >= 3;
    }
    stitchOrder.forEach(function (id, i) {
      var card = $stitchPool.querySelector('[data-note-id="' + id + '"]');
      if (!card) return;
      var title = card.querySelector('h4').textContent;
      var tag = document.createElement('span');
      tag.className = 'tut-stitch-tag';
      tag.innerHTML =
        '<span class="tut-stitch-tag__num">' + (i + 1) + '</span>' +
        '<span>' + esc(title) + '</span>' +
        '<span class="tut-stitch-tag__rm" data-rm="' + id + '">&times;</span>';
      $stitchList.appendChild(tag);
    });
    updateNextBtn();
  }

  if ($stitchPool) {
    $stitchPool.addEventListener('click', function (e) {
      var card = e.target.closest('.tut-note-card');
      if (!card || card.classList.contains('is-added')) return;
      stitchOrder.push(card.dataset.noteId);
      card.classList.add('is-added');
      renderStitches();
    });
  }

  if ($stitchList) {
    $stitchList.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]');
      if (!rm) return;
      var id = rm.dataset.rm;
      stitchOrder = stitchOrder.filter(function (x) { return x !== id; });
      var card = $stitchPool.querySelector('[data-note-id="' + id + '"]');
      if (card) card.classList.remove('is-added');
      renderStitches();
    });
  }

  // Step 2: Clue Marking
  var $clueResult = document.getElementById('clueResult');
  var $clueCount = document.getElementById('clueResultCount');
  var $cluePath = document.getElementById('clueResultPath');
  var clueTargets = document.querySelectorAll('.tut-clue-target');

  clueTargets.forEach(function (el) {
    el.addEventListener('click', function () {
      if (el.classList.contains('is-marked')) return;
      el.classList.add('is-marked');
      var note = el.closest('.tut-clue-note');
      if (note) note.classList.add('is-connected');
      clueMarked++;
      $clueCount.textContent = clueMarked;
      if (clueMarked >= 2) { $clueResult.style.display = ''; renderCluePath(); }
      if (clueMarked >= 3) { stepCompleted[2] = true; updateNextBtn(); }
    });
  });

  function renderCluePath() {
    if (!$cluePath) return;
    var names = [];
    document.querySelectorAll('.tut-clue-note.is-connected h4').forEach(function (h) { names.push(h.textContent); });
    $cluePath.innerHTML = names.map(function (n, i) {
      var arrow = i < names.length - 1 ? '<span class="tut-clue-result__path-arrow">→</span>' : '';
      return '<span class="tut-clue-result__path-item">' + esc(n) + '</span>' + arrow;
    }).join('');
  }

  // Step 3: Result
  stepCompleted[3] = true;
  var resultDisplayNoteIds = [3, 7, 9, 11, 14, 20, 24, 32, 36, 38];

  function buildResultSection() {
    var notes = window.KnittingNotes || [];
    var threads = window.KnittingThreads || [];
    if (!notes.length || !threads.length) return;

    var noteThreads = [];
    for (var i = 0; i < notes.length; i++) noteThreads.push([]);
    threads.forEach(function (th, ti) {
      th.ids.forEach(function (id) { if (noteThreads[id].indexOf(ti) === -1) noteThreads[id].push(ti); });
    });

    var crossCount = 0;
    for (var j = 0; j < noteThreads.length; j++) { if (noteThreads[j].length >= 2) crossCount++; }

    var $statTh = document.getElementById('resultStatThreads');
    var $statSt = document.getElementById('resultStatStitches');
    var $statCr = document.getElementById('resultStatCross');
    if ($statTh) $statTh.textContent = threads.length;
    if ($statSt) $statSt.textContent = notes.length;
    if ($statCr) $statCr.textContent = crossCount;

    var $threads = document.getElementById('resultThreads');
    var $canvas = document.getElementById('resultCanvas');
    if (!$threads || !$canvas) return;

    $threads.innerHTML = '';
    threads.forEach(function (th) {
      var lab = document.createElement('div');
      lab.className = 'tut-result__thread-label';
      lab.style.setProperty('--tc', th.c);
      lab.textContent = th.n;
      $threads.appendChild(lab);
    });

    $canvas.innerHTML = '';
    resultDisplayNoteIds.forEach(function (noteId) {
      var n = notes[noteId];
      if (!n) return;
      var tids = noteThreads[noteId] || [];
      var node = document.createElement('div');
      node.className = 'tut-result__node';
      node.dataset.shared = tids.length;
      node.dataset.noteId = noteId;
      var dots = '';
      tids.forEach(function (ti) {
        if (threads[ti]) dots += '<span class="tut-result__node-dot" style="background:' + threads[ti].c + ';"></span>';
      });
      node.innerHTML = dots + '<span class="tut-result__node-name">' + esc(n.t) + '</span>';
      $canvas.appendChild(node);
    });
  }

  buildResultSection();

  function drawResultLines() {
    var svg = document.getElementById('resultSvg');
    var canvas = document.getElementById('resultCanvas');
    var notes = window.KnittingNotes || [];
    var threads = window.KnittingThreads || [];
    if (!svg || !canvas || !notes.length || !threads.length) return;

    svg.innerHTML = '';
    var rect = canvas.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height);

    var nodes = canvas.querySelectorAll('.tut-result__node');
    var positions = [];
    nodes.forEach(function (n) {
      var nr = n.getBoundingClientRect();
      positions.push({ x: nr.left - rect.left + nr.width / 2, y: nr.top - rect.top + nr.height / 2 - 10 });
    });

    var noteIdToIdx = {};
    resultDisplayNoteIds.forEach(function (id, i) { noteIdToIdx[id] = i; });

    var animDelay = 0;
    threads.forEach(function (th, ti) {
      var prevIdx = -1;
      th.ids.forEach(function (noteId) {
        var idx = noteIdToIdx[noteId];
        if (idx === undefined) return;
        if (prevIdx >= 0) {
          var a = positions[prevIdx]; var b = positions[idx];
          var offset = (ti - 4) * 5;
          var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          var mx = (a.x + b.x) / 2; var my = (a.y + b.y) / 2 + offset * 2;
          path.setAttribute('d', 'M' + a.x + ',' + (a.y + offset) + ' Q' + mx + ',' + (my + offset) + ' ' + b.x + ',' + (b.y + offset));
          path.setAttribute('stroke', th.c);
          path.setAttribute('stroke-width', '2');
          path.setAttribute('fill', 'none');
          path.setAttribute('opacity', '0.6');
          path.setAttribute('stroke-linecap', 'round');
          var len = estimateLen(a.x, a.y + offset, mx, my + offset, b.x, b.y + offset);
          path.setAttribute('stroke-dasharray', len);
          path.setAttribute('stroke-dashoffset', len);
          path.style.animation = 'tutDrawLine 1s ' + animDelay + 's forwards ease';
          animDelay += 0.08;
          svg.appendChild(path);
        }
        prevIdx = idx;
      });
    });

    if (!document.getElementById('tutDrawLineStyle')) {
      var style = document.createElement('style');
      style.id = 'tutDrawLineStyle';
      style.textContent = '@keyframes tutDrawLine { to { stroke-dashoffset: 0; } }';
      document.head.appendChild(style);
    }
  }

  function estimateLen(x1, y1, cx, cy, x2, y2) {
    var d = 0; var px = x1, py = y1;
    for (var t = 0.1; t <= 1; t += 0.1) {
      var it = 1 - t;
      var x = it * it * x1 + 2 * it * t * cx + t * t * x2;
      var y = it * it * y1 + 2 * it * t * cy + t * t * y2;
      d += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      px = x; py = y;
    }
    return Math.ceil(d);
  }

  window.addEventListener('resize', function () { if (currentStep === 3) drawResultLines(); });

  goStep(0);
})();
