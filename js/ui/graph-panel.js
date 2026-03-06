/**
 * Graph Panel — 뜨개판 시각화
 * 올(노드)과 코(엣지)의 연결 그래프를 force-directed layout으로 표시
 * 의존: FiberAPI, BasketPanel
 */
var GraphPanel = (function () {
  'use strict';

  // ── DOM refs ──
  var $canvas, $tooltip, $empty, ctx;

  // ── Graph data ──
  var nodes = [];     // { id, x, y, vx, vy, text, tension, hasThought, sourceTitle }
  var edges = [];     // { sourceIdx, targetIdx, why }
  var nodeMap = {};   // fiber id -> node index

  // ── View transform ──
  var view = { x: 0, y: 0, scale: 1 };
  var MIN_SCALE = 0.3, MAX_SCALE = 3;

  // ── Simulation ──
  var simRunning = false;
  var simAlpha = 1;
  var rafId = null;

  // ── Interaction ──
  var hoveredNode = null;
  var hoveredEdge = null;
  var dragNode = null;
  var isPanning = false;
  var panStart = { x: 0, y: 0 };
  var viewStart = { x: 0, y: 0 };
  var dpr = 1;

  // ── Cluster ──
  var clusterMap = {};    // sourceTitle -> { color, cx, cy }
  var clusterList = [];   // unique sourceTitle list

  // ── Filter / Search ──
  var filterSource = '';    // '' = all
  var filterTension = 0;   // 0 = off, 3 = tension >= 3
  var searchQuery = '';
  var highlightSet = null;  // Set of node indices to highlight (null = no filter active)
  var neighborSet = null;   // Set of node indices that are neighbors of hovered node

  // ── Knots ──
  var knottedStitchIds = new Set();  // stitch IDs that are part of a knot

  // ── Constants ──
  var REPULSION = 800;
  var SPRING = 0.05;
  var REST_LENGTH = 60;
  var GRAVITY = 0.02;
  var DAMPING = 0.6;
  var ALPHA_DECAY = 0.99;
  var ALPHA_MIN = 0.001;
  var CLUSTER_FORCE = 0.015;

  // ── Thread colors (fallback if CSS vars unavailable) ──
  var THREAD_COLORS = [
    '#b8956a', '#6ba3c2', '#7aad5e', '#c2886b', '#8b6bc2',
    '#c26b6b', '#6bc2b0', '#c2b06b', '#6b7ec2', '#b06bc2'
  ];

  // ── Tone colors (결) ──
  var TONE_COLORS = {
    resonance: '#b8956a',
    friction: '#c26b6b',
    question: '#6ba3c2'
  };

  // ── CSS variable cache ──
  var _cs = null;
  function _css(name) {
    if (!_cs) _cs = getComputedStyle(document.documentElement);
    return _cs.getPropertyValue(name).trim() || null;
  }

  function _invalidateCSS() { _cs = null; }

  // ── Init ──

  function init() {
    $canvas = document.getElementById('graphCanvas');
    $tooltip = document.getElementById('graphTooltip');
    $empty = document.getElementById('graphEmpty');
    if (!$canvas) return;
    ctx = $canvas.getContext('2d');

    _setupInteraction();
    _setupResize();
    _setupFilters();

    // Invalidate CSS cache on dark mode toggle
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', _invalidateCSS);
    }
  }

  // ── Data loading ──

  function refresh() {
    Promise.all([
      FiberAPI.listFibers(),
      FiberAPI.listStitches(),
      FiberAPI.listKnots()
    ]).then(function (results) {
      _loadKnottedStitches(results[2] || []);
      _buildGraph(results[0] || [], results[1] || []);
    }).catch(function () {
      nodes = []; edges = []; nodeMap = {};
      _showEmpty(true);
    });
  }

  function _loadKnottedStitches(knots) {
    knottedStitchIds = new Set();
    knots.forEach(function (k) {
      if (k.stitch_ids) {
        k.stitch_ids.forEach(function (sid) { knottedStitchIds.add(sid); });
      }
    });
  }

  function _buildGraph(fibers, stitches) {
    nodes = [];
    edges = [];
    nodeMap = {};

    if (!fibers.length) {
      _showEmpty(true);
      _render();
      return;
    }
    _showEmpty(false);

    var W = $canvas.offsetWidth || 300;
    var H = $canvas.offsetHeight || 400;

    fibers.forEach(function (f, i) {
      nodeMap[f.id] = i;
      nodes.push({
        id: f.id,
        x: W / 2 + (Math.random() - 0.5) * W * 0.6,
        y: H / 2 + (Math.random() - 0.5) * H * 0.6,
        vx: 0, vy: 0,
        text: f.text || '',
        tension: f.tension || 3,
        hasThought: !!(f.thought && f.thought.trim()),
        sourceTitle: f.source_note_title || '',
        tone: f.tone || 'resonance'
      });
    });

    stitches.forEach(function (s) {
      var ai = nodeMap[s.fiber_a_id];
      var bi = nodeMap[s.fiber_b_id];
      if (ai !== undefined && bi !== undefined) {
        edges.push({ id: s.id, sourceIdx: ai, targetIdx: bi, why: s.why || '' });
      }
    });

    // Build cluster map
    _buildClusters();

    // Reset view & filters
    view.x = 0; view.y = 0; view.scale = 1;
    _applyFilters();
    _populateSourceFilter();

    _startSim();
  }

  function _showEmpty(show) {
    if ($empty) $empty.style.display = show ? '' : 'none';
    if ($canvas) $canvas.style.display = show ? 'none' : '';
  }

  // ── Clustering ──

  function _buildClusters() {
    clusterMap = {};
    clusterList = [];
    var colorIdx = 0;

    nodes.forEach(function (n) {
      var src = n.sourceTitle || '(출처 없음)';
      if (!clusterMap[src]) {
        clusterMap[src] = { color: THREAD_COLORS[colorIdx % THREAD_COLORS.length], nodes: [] };
        clusterList.push(src);
        colorIdx++;
      }
      clusterMap[src].nodes.push(n);
      n.cluster = src;
      n.clusterColor = clusterMap[src].color;
    });

    // Assign cluster center targets (spread around canvas center)
    var W = $canvas.offsetWidth || 300;
    var H = $canvas.offsetHeight || 400;
    var count = clusterList.length;
    clusterList.forEach(function (src, i) {
      var angle = (2 * Math.PI * i) / (count || 1);
      var radius = Math.min(W, H) * 0.25;
      clusterMap[src].cx = W / 2 + Math.cos(angle) * radius;
      clusterMap[src].cy = H / 2 + Math.sin(angle) * radius;
    });
  }

  // ── Filtering ──

  function _applyFilters() {
    highlightSet = null;
    var hasFilter = false;
    var set = new Set();

    nodes.forEach(function (n, i) {
      var pass = true;
      if (filterSource && n.cluster !== filterSource) pass = false;
      if (filterTension > 0 && n.tension < filterTension) pass = false;
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        if (n.text.toLowerCase().indexOf(q) === -1 && n.cluster.toLowerCase().indexOf(q) === -1) pass = false;
      }
      if (pass) set.add(i);
      if (!pass) hasFilter = true;
    });

    if (hasFilter || searchQuery) highlightSet = set;
  }

  function _computeNeighbors(node) {
    if (!node) { neighborSet = null; return; }
    var idx = nodes.indexOf(node);
    var set = new Set([idx]);
    edges.forEach(function (e) {
      if (e.sourceIdx === idx) set.add(e.targetIdx);
      if (e.targetIdx === idx) set.add(e.sourceIdx);
    });
    neighborSet = set;
  }

  function _populateSourceFilter() {
    var $sel = document.getElementById('graphFilterSource');
    if (!$sel) return;
    var prev = $sel.value;
    $sel.innerHTML = '<option value="">모든 출처</option>';
    clusterList.forEach(function (src) {
      var opt = document.createElement('option');
      opt.value = src;
      opt.textContent = src + ' (' + clusterMap[src].nodes.length + ')';
      $sel.appendChild(opt);
    });
    $sel.value = prev || '';
  }

  // ── Filter event setup ──

  function _setupFilters() {
    var $sel = document.getElementById('graphFilterSource');
    var $btn = document.getElementById('graphFilterTension');
    var $search = document.getElementById('graphSearch');

    if ($sel) {
      $sel.addEventListener('change', function () {
        filterSource = $sel.value;
        _applyFilters();
        if (!simRunning) _render();
      });
    }

    if ($btn) {
      $btn.addEventListener('click', function () {
        filterTension = filterTension ? 0 : 3;
        $btn.classList.toggle('is-active', !!filterTension);
        _applyFilters();
        if (!simRunning) _render();
      });
    }

    if ($search) {
      var debounce = null;
      $search.addEventListener('input', function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          searchQuery = $search.value.trim();
          _applyFilters();
          if (!simRunning) _render();
        }, 150);
      });
    }
  }

  // ── Force-directed simulation ──

  var APPROX_THRESHOLD = 80; // 이 수 이상이면 근사 반발력 사용

  /**
   * 그리드 기반 근사 반발력 — 가까운 노드끼리만 계산
   * 먼 노드는 셀 중심으로 묶어서 O(N * K) (K = 인근 셀 수)
   */
  function _approxRepulsion(N) {
    var cellSize = REST_LENGTH * 3;
    var grid = {};
    var i, key, ni, nj;

    // 그리드에 노드 배치
    for (i = 0; i < N; i++) {
      var gx = Math.floor(nodes[i].x / cellSize);
      var gy = Math.floor(nodes[i].y / cellSize);
      key = gx + ',' + gy;
      if (!grid[key]) grid[key] = { nodes: [], cx: 0, cy: 0 };
      grid[key].nodes.push(i);
    }

    // 셀 중심 계산
    var keys = Object.keys(grid);
    for (var k = 0; k < keys.length; k++) {
      var cell = grid[keys[k]];
      var sx = 0, sy = 0;
      for (i = 0; i < cell.nodes.length; i++) {
        sx += nodes[cell.nodes[i]].x;
        sy += nodes[cell.nodes[i]].y;
      }
      cell.cx = sx / cell.nodes.length;
      cell.cy = sy / cell.nodes.length;
    }

    // 각 노드에 대해: 인근 셀은 개별 계산, 먼 셀은 셀 중심으로 근사
    for (i = 0; i < N; i++) {
      var ngx = Math.floor(nodes[i].x / cellSize);
      var ngy = Math.floor(nodes[i].y / cellSize);

      for (var kk = 0; kk < keys.length; kk++) {
        var cell2 = grid[keys[kk]];
        var parts = keys[kk].split(',');
        var cgx = parseInt(parts[0]), cgy = parseInt(parts[1]);
        var nearCell = Math.abs(cgx - ngx) <= 1 && Math.abs(cgy - ngy) <= 1;

        if (nearCell) {
          // 가까운 셀: 개별 노드와 정확히 계산
          for (var m = 0; m < cell2.nodes.length; m++) {
            nj = cell2.nodes[m];
            if (nj <= i) continue;
            var dx = nodes[nj].x - nodes[i].x;
            var dy = nodes[nj].y - nodes[i].y;
            var dist = Math.sqrt(dx * dx + dy * dy) || 1;
            var force = REPULSION / (dist * dist);
            var fx = (dx / dist) * force;
            var fy = (dy / dist) * force;
            nodes[i].vx -= fx; nodes[i].vy -= fy;
            nodes[nj].vx += fx; nodes[nj].vy += fy;
          }
        } else {
          // 먼 셀: 셀 중심으로 근사 (전체 셀 질량 = 노드 수)
          var dx2 = cell2.cx - nodes[i].x;
          var dy2 = cell2.cy - nodes[i].y;
          var dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
          var force2 = REPULSION * cell2.nodes.length / (dist2 * dist2);
          nodes[i].vx -= (dx2 / dist2) * force2;
          nodes[i].vy -= (dy2 / dist2) * force2;
        }
      }
    }
  }

  function _simTick() {
    if (simAlpha < ALPHA_MIN) {
      simRunning = false;
      return;
    }

    var N = nodes.length;
    var i, j, e, dx, dy, dist, force, fx, fy;

    // Repulsive force
    if (N < APPROX_THRESHOLD) {
      // 정확한 O(N²) — 소규모 그래프
      for (i = 0; i < N; i++) {
        for (j = i + 1; j < N; j++) {
          dx = nodes[j].x - nodes[i].x;
          dy = nodes[j].y - nodes[i].y;
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
          force = REPULSION / (dist * dist);
          fx = (dx / dist) * force;
          fy = (dy / dist) * force;
          nodes[i].vx -= fx; nodes[i].vy -= fy;
          nodes[j].vx += fx; nodes[j].vy += fy;
        }
      }
    } else {
      // 근사: 그리드 기반 O(N) — 대규모 그래프
      _approxRepulsion(N);
    }

    // Attractive force (edges)
    for (e = 0; e < edges.length; e++) {
      var a = nodes[edges[e].sourceIdx];
      var b = nodes[edges[e].targetIdx];
      dx = b.x - a.x; dy = b.y - a.y;
      dist = Math.sqrt(dx * dx + dy * dy) || 1;
      force = SPRING * (dist - REST_LENGTH);
      fx = (dx / dist) * force;
      fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Center gravity
    var W = $canvas.offsetWidth || 300;
    var H = $canvas.offsetHeight || 400;
    var cx = (W / 2 - view.x) / view.scale;
    var cy = (H / 2 - view.y) / view.scale;
    for (i = 0; i < N; i++) {
      nodes[i].vx += (cx - nodes[i].x) * GRAVITY;
      nodes[i].vy += (cy - nodes[i].y) * GRAVITY;
    }

    // Cluster force — pull toward cluster center
    for (i = 0; i < N; i++) {
      var cl = clusterMap[nodes[i].cluster];
      if (cl) {
        nodes[i].vx += (cl.cx - nodes[i].x) * CLUSTER_FORCE;
        nodes[i].vy += (cl.cy - nodes[i].y) * CLUSTER_FORCE;
      }
    }

    // Apply velocity with damping
    for (i = 0; i < N; i++) {
      if (nodes[i] === dragNode) continue;
      nodes[i].vx *= DAMPING;
      nodes[i].vy *= DAMPING;
      nodes[i].x += nodes[i].vx * simAlpha;
      nodes[i].y += nodes[i].vy * simAlpha;
    }

    simAlpha *= ALPHA_DECAY;
  }

  function _startSim() {
    if (simRunning) return;
    simRunning = true;
    simAlpha = 1;
    _frame();
  }

  function _reheat() {
    simAlpha = Math.max(simAlpha, 0.3);
    if (!simRunning) {
      simRunning = true;
      _frame();
    }
  }

  function _frame() {
    if (!simRunning) { _render(); return; }
    _simTick();
    _render();
    rafId = requestAnimationFrame(_frame);
  }

  // ── Canvas rendering ──

  function _render() {
    if (!$canvas || !ctx) return;

    dpr = window.devicePixelRatio || 1;
    var W = $canvas.offsetWidth;
    var H = $canvas.offsetHeight;
    if (!W || !H) return;

    $canvas.width = W * dpr;
    $canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    var bg = _css('--bg') || '#faf9f7';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (!nodes.length) return;

    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    var mutedColor = _css('--text-muted') || '#a0a0a0';
    var accentColor = _css('--accent') || '#b8956a';
    var hasHover = !!(hoveredNode || dragNode);
    var activeNode = hoveredNode || dragNode;

    // Compute neighbor set for hover highlight
    _computeNeighbors(activeNode);

    // ── Draw cluster backgrounds ──
    if (clusterList.length > 1) {
      clusterList.forEach(function (src) {
        var cl = clusterMap[src];
        var clNodes = cl.nodes;
        if (clNodes.length < 2) return;
        // Compute bounding circle
        var sumX = 0, sumY = 0;
        clNodes.forEach(function (n) { sumX += n.x; sumY += n.y; });
        var cxc = sumX / clNodes.length;
        var cyc = sumY / clNodes.length;
        var maxR = 0;
        clNodes.forEach(function (n) {
          var d = Math.sqrt((n.x - cxc) * (n.x - cxc) + (n.y - cyc) * (n.y - cyc));
          if (d > maxR) maxR = d;
        });
        ctx.beginPath();
        ctx.arc(cxc, cyc, maxR + 30, 0, Math.PI * 2);
        ctx.fillStyle = _hexAlpha(cl.color, 0.06);
        ctx.fill();
      });
    }

    // ── Draw edges ──
    edges.forEach(function (edge) {
      var a = nodes[edge.sourceIdx];
      var b = nodes[edge.targetIdx];
      var isKnotted = edge.id && knottedStitchIds.has(edge.id);

      // Determine visibility
      var isNeighborEdge = neighborSet &&
        (neighborSet.has(edge.sourceIdx) && neighborSet.has(edge.targetIdx));
      var isFilteredA = highlightSet && !highlightSet.has(edge.sourceIdx);
      var isFilteredB = highlightSet && !highlightSet.has(edge.targetIdx);

      if (isFilteredA || isFilteredB) {
        ctx.globalAlpha = 0.03;
      } else if (hasHover) {
        ctx.globalAlpha = isNeighborEdge ? 0.8 : 0.05;
      } else {
        ctx.globalAlpha = (edge === hoveredEdge) ? 1 : isKnotted ? 0.7 : 0.4;
      }

      ctx.lineWidth = isKnotted ? 3 / view.scale : 1.5 / view.scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = isKnotted ? accentColor : (isNeighborEdge ? accentColor : mutedColor);
      ctx.stroke();

      // Draw knot marker (small diamond) at midpoint
      if (isKnotted && ctx.globalAlpha > 0.1) {
        var mx = (a.x + b.x) / 2;
        var my = (a.y + b.y) / 2;
        var s = 4 / view.scale;
        ctx.beginPath();
        ctx.moveTo(mx, my - s);
        ctx.lineTo(mx + s, my);
        ctx.lineTo(mx, my + s);
        ctx.lineTo(mx - s, my);
        ctx.closePath();
        ctx.fillStyle = accentColor;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    });

    // ── Draw nodes ──
    nodes.forEach(function (node, idx) {
      var r = 8 + node.tension * 3;
      var color = node.clusterColor || THREAD_COLORS[idx % THREAD_COLORS.length];

      // Determine if this node is dimmed
      var isDimmed = false;
      if (highlightSet && !highlightSet.has(idx)) isDimmed = true;
      if (hasHover && neighborSet && !neighborSet.has(idx)) isDimmed = true;

      if (isDimmed) ctx.globalAlpha = 0.15;

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

      if (node.hasThought) {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.fillStyle = _hexAlpha(color, 0.15);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / view.scale;
        ctx.stroke();
      }

      // Tone ring (결 색상)
      var toneColor = TONE_COLORS[node.tone] || TONE_COLORS.resonance;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = toneColor;
      ctx.lineWidth = 2 / view.scale;
      ctx.stroke();

      // Tone mark (friction: X, question: dot)
      if (node.tone === 'friction') {
        var m = r * 0.25;
        ctx.beginPath();
        ctx.moveTo(node.x - m, node.y - m);
        ctx.lineTo(node.x + m, node.y + m);
        ctx.moveTo(node.x + m, node.y - m);
        ctx.lineTo(node.x - m, node.y + m);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 / view.scale;
        ctx.stroke();
      } else if (node.tone === 'question') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // Hover ring
      if (node === hoveredNode || node === dragNode) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2 / view.scale;
        ctx.stroke();
      }

      // Search match ring
      if (highlightSet && highlightSet.has(idx) && searchQuery) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1.5 / view.scale;
        ctx.setLineDash([4 / view.scale, 3 / view.scale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Label: show for hovered neighbors, search matches, or small graphs
      var showLabel = false;
      if (node === activeNode) showLabel = true;
      else if (hasHover && neighborSet && neighborSet.has(idx)) showLabel = true;
      else if (highlightSet && highlightSet.has(idx)) showLabel = true;
      else if (nodes.length < 15 && view.scale >= 0.6) showLabel = true;

      if (showLabel && !isDimmed) {
        var label = node.text.length > 12 ? node.text.substring(0, 12) + '...' : node.text;
        ctx.font = Math.round(10 / view.scale) + 'px Pretendard, sans-serif';
        ctx.fillStyle = _css('--text') || '#2c2c2c';
        ctx.textAlign = 'center';
        ctx.fillText(label, node.x, node.y + r + 14 / view.scale);
      }
    });

    ctx.restore();
  }

  function _hexAlpha(hex, alpha) {
    var m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }

  // ── Hit testing ──

  function _screenToGraph(mx, my) {
    return {
      x: (mx - view.x) / view.scale,
      y: (my - view.y) / view.scale
    };
  }

  function _hitNode(mx, my) {
    var g = _screenToGraph(mx, my);
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      var r = 8 + n.tension * 3 + 4;
      var dx = g.x - n.x, dy = g.y - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  function _hitEdge(mx, my) {
    var g = _screenToGraph(mx, my);
    var threshold = 6 / view.scale;
    for (var i = 0; i < edges.length; i++) {
      var a = nodes[edges[i].sourceIdx];
      var b = nodes[edges[i].targetIdx];
      var d = _pointToSegmentDist(g.x, g.y, a.x, a.y, b.x, b.y);
      if (d < threshold) return edges[i];
    }
    return null;
  }

  function _pointToSegmentDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
    var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    var projX = ax + t * dx, projY = ay + t * dy;
    return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
  }

  // ── Interaction ──

  function _setupInteraction() {
    $canvas.addEventListener('mousedown', _onMouseDown);
    $canvas.addEventListener('mousemove', _onMouseMove);
    $canvas.addEventListener('mouseup', _onMouseUp);
    $canvas.addEventListener('mouseleave', _onMouseLeave);
    $canvas.addEventListener('wheel', _onWheel, { passive: false });
    $canvas.addEventListener('dblclick', _onDblClick);
    $canvas.addEventListener('contextmenu', _onContextMenu);

    // Graph context menu actions
    var $graphMenu = document.getElementById('graphContextMenu');
    if ($graphMenu) {
      $graphMenu.querySelector('[data-action="graph-knot"]').addEventListener('click', function () {
        _hideGraphMenu();
        if (_contextNode) _openGraphKnotDialog(_contextNode);
      });
      $graphMenu.querySelector('[data-action="graph-detail"]').addEventListener('click', function () {
        _hideGraphMenu();
        if (_contextNode) _onNodeClick(_contextNode);
      });
      document.addEventListener('click', function (e) {
        if ($graphMenu && !$graphMenu.contains(e.target)) _hideGraphMenu();
      });
    }
  }

  var _contextNode = null;

  function _onContextMenu(e) {
    var rect = $canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var node = _hitNode(mx, my);
    if (!node) return;

    e.preventDefault();
    _contextNode = node;
    var $menu = document.getElementById('graphContextMenu');
    if (!$menu) return;
    $menu.style.left = e.clientX + 'px';
    $menu.style.top = e.clientY + 'px';
    $menu.classList.add('is-visible');
  }

  function _hideGraphMenu() {
    var $menu = document.getElementById('graphContextMenu');
    if ($menu) $menu.classList.remove('is-visible');
    _contextNode = null;
  }

  function _openGraphKnotDialog(node) {
    // Load stitches for this node, then open the knot dialog
    FiberAPI.listStitches(node.id).then(function (stitches) {
      if (!stitches || !stitches.length) {
        KnittingDialog.alert('이 올에 엮인 코가 없습니다.');
        return;
      }
      // Use BasketPanel's knot dialog opener if available
      if (typeof BasketPanel !== 'undefined' && BasketPanel.openKnotDialog) {
        BasketPanel.openKnotDialog(node.id, stitches);
      }
    });
  }

  function _onMouseDown(e) {
    if (e.button !== 0) return;
    var rect = $canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    var node = _hitNode(mx, my);
    if (node) {
      dragNode = node;
      dragNode.vx = 0; dragNode.vy = 0;
      $canvas.classList.add('is-panning');
      return;
    }

    isPanning = true;
    panStart.x = e.clientX; panStart.y = e.clientY;
    viewStart.x = view.x; viewStart.y = view.y;
    $canvas.classList.add('is-panning');
  }

  function _onMouseMove(e) {
    var rect = $canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    if (dragNode) {
      var g = _screenToGraph(mx, my);
      dragNode.x = g.x; dragNode.y = g.y;
      _reheat();
      return;
    }

    if (isPanning) {
      view.x = viewStart.x + (e.clientX - panStart.x);
      view.y = viewStart.y + (e.clientY - panStart.y);
      if (!simRunning) _render();
      return;
    }

    // Hover detection
    var prevNode = hoveredNode;
    var prevEdge = hoveredEdge;
    hoveredNode = _hitNode(mx, my);
    hoveredEdge = hoveredNode ? null : _hitEdge(mx, my);

    if (hoveredNode !== prevNode || hoveredEdge !== prevEdge) {
      if (!simRunning) _render();
    }

    // Tooltip
    if (hoveredNode) {
      var text = hoveredNode.text.length > 50 ? hoveredNode.text.substring(0, 50) + '...' : hoveredNode.text;
      _showTooltip(text, e.clientX - rect.left, e.clientY - rect.top);
      $canvas.style.cursor = 'pointer';
    } else if (hoveredEdge && hoveredEdge.why) {
      _showTooltip(hoveredEdge.why, e.clientX - rect.left, e.clientY - rect.top);
      $canvas.style.cursor = 'default';
    } else {
      _hideTooltip();
      $canvas.style.cursor = 'grab';
    }
  }

  function _onMouseUp(e) {
    if (dragNode) {
      // If barely moved, treat as click
      var rect = $canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var node = _hitNode(mx, my);
      if (node && node === dragNode) {
        _onNodeClick(node);
      }
      dragNode = null;
      $canvas.classList.remove('is-panning');
      return;
    }

    if (isPanning) {
      isPanning = false;
      $canvas.classList.remove('is-panning');
    }
  }

  function _onMouseLeave() {
    dragNode = null;
    isPanning = false;
    hoveredNode = null;
    hoveredEdge = null;
    _hideTooltip();
    $canvas.classList.remove('is-panning');
    if (!simRunning) _render();
  }

  function _onWheel(e) {
    e.preventDefault();
    var rect = $canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var delta = -e.deltaY * 0.001;
    var newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * (1 + delta)));
    var ratio = newScale / view.scale;
    view.x = mx - (mx - view.x) * ratio;
    view.y = my - (my - view.y) * ratio;
    view.scale = newScale;
    if (!simRunning) _render();
  }

  function _onDblClick() {
    view.x = 0; view.y = 0; view.scale = 1;
    if (!simRunning) _render();
  }

  function _onNodeClick(node) {
    var tabBasket = document.getElementById('tabBasket');
    if (tabBasket) tabBasket.click();
    if (typeof BasketPanel !== 'undefined' && BasketPanel.showFiberDetail) {
      BasketPanel.showFiberDetail(node.id);
    }
  }

  // ── Tooltip ──

  function _showTooltip(text, x, y) {
    if (!$tooltip) return;
    $tooltip.textContent = text;
    $tooltip.style.left = (x + 12) + 'px';
    $tooltip.style.top = (y - 8) + 'px';
    $tooltip.classList.add('is-visible');
  }

  function _hideTooltip() {
    if ($tooltip) $tooltip.classList.remove('is-visible');
  }

  // ── Resize ──

  function _setupResize() {
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        if (!simRunning) _render();
      });
      if ($canvas && $canvas.parentElement) ro.observe($canvas.parentElement);
    }
  }

  // ── Public API ──

  return {
    init: init,
    refresh: refresh
  };
})();
