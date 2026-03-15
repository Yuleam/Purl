/**
 * Focus View — 포커스 모델 기반 시각화 (DOM 카드 기반)
 * 중앙: 선택 노드 (크게), 주변: 유사/연결 노드
 * 원칙 2: 텍스트가 주인공 (이중 부호화)
 * 원칙 4: tone→색조, tension→크기 (감정 차원)
 * 원칙 6: 부분만 보여줌 (패턴 완성)
 * 의존: FiberAPI
 */
var FocusView = (function () {
  'use strict';

  // ── DOM refs ──
  var $space, $wrapper, $lines, $context, $empty, $breadcrumb, $loading;

  // ── State ──
  var focusNodeId = null;
  var focusNode = null;     // { id, type, detail }
  var hintNodes = [];       // [{ node_id, type, detail, similarity, signals, x, y, cardEl }]
  var phase = '';
  var density = 0;
  var clusterCount = 1;  // API 응답의 cluster_count
  var isStructural = false;
  var structuralEdges = []; // [{ from, to }]
  var similarHintData = []; // 실/코 유사 힌트 원본 (resize 용)
  var parentNodes = [];     // 부모 노드 원본 (resize 용)
  var showSimilar = true;   // 유사 힌트 표시 토글

  // ── Overview mode ──
  var overviewMode = false;
  var overviewNodes = [];   // [{ id, type, data, cardEl }]

  // ── Breadcrumb (탐색 이력) ──
  var focusHistory = [];    // [{id, type, label}]

  // ── Center card ref ──
  var centerCardEl = null;

  // ── Card push-away (확장 시 카드 밀어내기) ──
  var _savedPositions = null; // { nodeId: { x, y } }

  // ── View transform (pan/zoom) ──
  var view = { x: 0, y: 0, scale: 1 };
  var MIN_SCALE = 0.4, MAX_SCALE = 3;

  // ── Interaction ──
  var isPanning = false;
  var hasDragged = false;   // 드래그 여부 (클릭과 구분)
  var panStart = { x: 0, y: 0 };
  var viewStart = { x: 0, y: 0 };

  // ── Navigate callback (브라우저 히스토리 연동) ──
  var _navigateCallback = null;

  // ── Animation (원칙 1: 확산 활성화) ──
  var animationId = null;
  var BASE_DELAY = 400;   // 첫 힌트 등장까지 대기 (ms)
  var DECAY = 0.85;       // 간격 감쇠율
  var LINE_DELAY = 150;   // 카드 등장 후 연결선까지 (ms)
  var STRUCT_DELAY = 200; // 구조적 모드 등장 간격 (ms)
  var OFFSET_PX = 15;     // 방향성 오프셋 크기 (px)

  // ── Type/Tone 정보 ──
  var TYPE_NAMES = { fiber: '올', thread: '실', stitch: '코', fabric: '편물' };
  var TONE_NAMES = { resonance: '공명', friction: '마찰', question: '물음' };

  // ── 유틸리티 ──
  function _timeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return '방금 전';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + '분 전';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + '시간 전';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + '일 전';
    return Math.floor(day / 30) + '개월 전';
  }

  // ── Init ──

  function init() {
    $space = document.getElementById('focusSpace');
    $wrapper = document.getElementById('focusWrapper');
    $lines = document.getElementById('focusLines');
    $context = document.getElementById('focusContext');
    $breadcrumb = document.getElementById('focusBreadcrumb');
    $empty = document.getElementById('focusEmpty');
    $loading = document.getElementById('focusLoading');
    if (!$space) return;

    _setupInteraction();
    _setupResize();
  }

  // ══════════════════════════════════════
  // Overview 모드
  // ══════════════════════════════════════

  function showOverview(items) {
    overviewMode = true;
    focusNodeId = null;
    focusNode = null;
    hintNodes = [];
    centerCardEl = null;

    if (!items || !items.length) {
      overviewNodes = [];
      _showEmpty(true);
      return;
    }

    _showEmpty(false);
    overviewNodes = items.map(function (item) {
      return {
        id: item.id,
        type: item.type,
        data: item.data,
        detail: item.data
      };
    });

    view.x = 0; view.y = 0; view.scale = 1;
    _renderOverviewMode();
  }

  // ══════════════════════════════════════
  // 포커스 변경
  // ══════════════════════════════════════

  /** 공개 API: 히스토리 추가 후 포커스 전환 */
  function setFocus(nodeId) {
    // 히스토리 추가: 현재 포커스가 있고, 다른 노드로 이동할 때만
    if (nodeId && focusNodeId && focusNode && nodeId !== focusNodeId) {
      focusHistory.push({
        id: focusNodeId,
        type: _nodeType(focusNodeId),
        label: _getNodeLabel(focusNode)
      });
      if (focusHistory.length > 10) focusHistory.shift();
    }

    _doSetFocus(nodeId);
    if (_navigateCallback) _navigateCallback({ type: 'focus', nodeId: nodeId });
  }

  /** 외부에서 히스토리 복원 시 사용 (popstate) */
  function restoreFocus(nodeId) {
    focusHistory = [];
    _doSetFocus(nodeId);
  }

  /** 네비게이션 콜백 등록 (explorer-app에서 pushState 연동) */
  function onNavigate(cb) { _navigateCallback = cb; }

  /** 내부: 실제 포커스 전환 로직 (히스토리 조작 없음) */
  function _doSetFocus(nodeId) {
    overviewMode = false;
    overviewNodes = [];
    isStructural = false;
    structuralEdges = [];
    similarHintData = [];
    parentNodes = [];
    centerCardEl = null;

    if (!nodeId) {
      focusNodeId = null;
      focusNode = null;
      hintNodes = [];
      _showLoading(false);
      _showEmpty(true);
      _clearCards();
      _updateContext();
      _renderBreadcrumb();
      if (typeof SourcePanel !== 'undefined' && SourcePanel.highlightItem) {
        SourcePanel.highlightItem(null);
      }
      return;
    }

    focusNodeId = nodeId;
    _showEmpty(false);
    _showLoading(true);

    if (typeof SourcePanel !== 'undefined' && SourcePanel.highlightItem) {
      SourcePanel.highlightItem(nodeId);
    }

    var type = _nodeType(nodeId);

    // 실/코 → 구조적 자식 + 부모 + 유사 힌트 병렬 로딩
    if (type === 'thread' || type === 'stitch') {
      Promise.all([
        _loadFocusNode(nodeId),
        FiberAPI.getNodeHints(nodeId).catch(function () { return { hints: [] }; }),
        FiberAPI.getNodeParents(nodeId).catch(function () { return { parents: [] }; })
      ]).then(function (results) {
        focusNode = results[0];
        var hintResult = results[1];
        similarHintData = hintResult && hintResult.hints || [];
        parentNodes = results[2] && results[2].parents || [];
        return _loadStructuralChildren(type, focusNode.detail);
      }).then(function (result) {
        _showLoading(false);
        isStructural = true;
        structuralEdges = result.edges;
        _buildStructuralLayout(result.nodes, showSimilar ? similarHintData : [], parentNodes);
        _renderFocusMode();
        _updateContext();
        _renderBreadcrumb();
      }).catch(function (err) {
        _showLoading(false);
        console.error('[FocusView] structural+hint load error:', err);
        focusNode = focusNode || null;
        hintNodes = [];
        _clearCards();
      });
      return;
    }

    // 편물 → 구조적 자식 + 부모 (편물의 부모는 보통 없지만 일관성 유지)
    if (type === 'fabric') {
      Promise.all([
        _loadFocusNode(nodeId),
        FiberAPI.getNodeParents(nodeId).catch(function () { return { parents: [] }; })
      ]).then(function (results) {
        focusNode = results[0];
        parentNodes = results[1] && results[1].parents || [];
        similarHintData = [];
        return _loadStructuralChildren(type, focusNode.detail);
      }).then(function (result) {
        _showLoading(false);
        isStructural = true;
        structuralEdges = result.edges;
        _buildStructuralLayout(result.nodes, [], parentNodes);
        _renderFocusMode();
        _updateContext();
        _renderBreadcrumb();
      }).catch(function (err) {
        _showLoading(false);
        console.error('[FocusView] structural load error:', err);
        focusNode = focusNode || null;
        hintNodes = [];
        _clearCards();
      });
      return;
    }

    // 올(fiber) → 유사도 힌트 + 부모 표시
    Promise.all([
      FiberAPI.getNodeHints(nodeId).catch(function () { return { hints: [], phase: '', density: 0, cluster_count: 1 }; }),
      _loadFocusNode(nodeId),
      FiberAPI.getNodeParents(nodeId).catch(function () { return { parents: [] }; })
    ]).then(function (results) {
      var result = results[0];
      var hints = result && result.hints || [];
      phase = result && result.phase || '';
      density = result && result.density || 0;
      clusterCount = result && result.cluster_count || 1;

      focusNode = results[1];
      parentNodes = results[2] && results[2].parents || [];

      _showLoading(false);
      if (hints.length > 0 || parentNodes.length > 0) {
        _buildLayout(hints, parentNodes);
      } else {
        hintNodes = [];
      }
      _renderFocusMode();
      _updateContext();
      _renderBreadcrumb();
    }).catch(function () {
      _loadFocusNode(nodeId).then(function (node) {
        _showLoading(false);
        focusNode = node;
        hintNodes = [];
        phase = '';
        _renderFocusMode();
        _updateContext();
        _renderBreadcrumb();
      }).catch(function () {
        _showLoading(false);
        focusNode = null;
        hintNodes = [];
        _showEmpty(true);
        _clearCards();
      });
    });
  }

  function goBack() {
    if (!focusHistory.length) return;
    var prev = focusHistory.pop();
    _doSetFocus(prev.id);
  }

  // ══════════════════════════════════════
  // 데이터 로딩
  // ══════════════════════════════════════

  function _loadFocusNode(nodeId) {
    var type = _nodeType(nodeId);
    if (type === 'fiber') {
      return FiberAPI.getFiber(nodeId).then(function (d) {
        return { id: nodeId, type: 'fiber', detail: d };
      });
    }
    if (type === 'thread') {
      return FiberAPI.getThread(nodeId).then(function (d) {
        return { id: nodeId, type: 'thread', detail: d };
      });
    }
    if (type === 'stitch') {
      return FiberAPI.getStitch(nodeId).then(function (d) {
        return { id: nodeId, type: 'stitch', detail: d };
      });
    }
    if (type === 'fabric') {
      return FiberAPI.getFabric(nodeId).then(function (d) {
        return { id: nodeId, type: 'fabric', detail: d };
      });
    }
    return Promise.resolve({ id: nodeId, type: 'unknown', detail: {} });
  }

  function _nodeType(nodeId) {
    if (!nodeId) return 'unknown';
    var p = nodeId.substring(0, 3);
    if (p === 'fb_') return 'fiber';
    if (p === 'th_') return 'thread';
    if (p === 'sc_') return 'stitch';
    if (p === 'fa_') return 'fabric';
    return 'unknown';
  }

  // ── 구조적 하위 노드 로딩 ──

  function _loadStructuralChildren(type, detail) {
    if (type === 'thread') {
      var fiberIds = detail.fibers ? detail.fibers.map(function (f) { return f.id; })
        : [detail.fiber_a_id, detail.fiber_b_id].filter(Boolean);
      return Promise.all(fiberIds.map(function (fid) {
        return FiberAPI.getFiber(fid).then(function (d) {
          return { id: fid, type: 'fiber', detail: d, parentId: detail.id, level: 1 };
        });
      })).then(function (nodes) {
        return {
          nodes: nodes,
          edges: nodes.map(function (n) { return { from: detail.id, to: n.id }; })
        };
      });
    }

    if (type === 'stitch') {
      var members = detail.members || [];
      return Promise.all(members.map(function (m) {
        if (m.type === 'fiber') {
          return FiberAPI.getFiber(m.id).then(function (d) {
            return { id: m.id, type: 'fiber', detail: d, parentId: detail.id, level: 1 };
          });
        }
        if (m.type === 'thread') {
          return FiberAPI.getThread(m.id).then(function (d) {
            return { id: m.id, type: 'thread', detail: d, parentId: detail.id, level: 1 };
          });
        }
        return Promise.resolve({ id: m.id, type: m.type, detail: m.detail || {}, parentId: detail.id, level: 1 });
      })).then(function (nodes) {
        return {
          nodes: nodes,
          edges: nodes.map(function (n) { return { from: detail.id, to: n.id }; })
        };
      });
    }

    if (type === 'fabric') {
      return FiberAPI.getFabricFull(detail.id).then(function (fabric) {
        var nodes = [];
        var edges = [];
        (fabric.members || []).forEach(function (m) {
          if (m.type === 'thread' && m.detail) {
            nodes.push({ id: m.detail.id || m.id, type: 'thread', detail: m.detail, parentId: detail.id, level: 1 });
            edges.push({ from: detail.id, to: m.detail.id || m.id });
            // 실의 하위 올
            var threadFibers = m.detail.fibers || [];
            threadFibers.forEach(function (f) {
              nodes.push({ id: f.id, type: 'fiber', detail: f, parentId: m.detail.id || m.id, level: 2 });
              edges.push({ from: m.detail.id || m.id, to: f.id });
            });
          } else if (m.type === 'fiber' && m.detail) {
            nodes.push({ id: m.detail.id || m.id, type: 'fiber', detail: m.detail, parentId: detail.id, level: 1 });
            edges.push({ from: detail.id, to: m.detail.id || m.id });
          }
        });
        return { nodes: nodes, edges: edges };
      });
    }

    return Promise.resolve({ nodes: [], edges: [] });
  }

  // ══════════════════════════════════════
  // 레이아웃 계산
  // ══════════════════════════════════════

  // ── 구조적 레이아웃 (계층 배치) ──
  function _buildStructuralLayout(nodes, hints, parents) {
    var W = $space.offsetWidth || 400;
    var H = $space.offsetHeight || 400;
    var cx = W / 2;
    var cy = H / 2;

    var level1 = nodes.filter(function (n) { return n.level === 1; });
    var level2 = nodes.filter(function (n) { return n.level === 2; });

    var R0 = Math.min(W, H) * 0.25; // 부모 링 (위쪽)
    var R1 = Math.min(W, H) * 0.25; // 자식 링
    var R2 = Math.min(W, H) * 0.42;
    var R3 = Math.min(W, H) * 0.58; // 유사 힌트 링

    // 부모가 있으면 자식을 아래쪽 반원에, 부모를 위쪽 반원에 배치
    var hasParents = parents && parents.length > 0;

    // 자식 노드 배치 (부모 있으면 아래쪽 반원, 없으면 전체 원)
    level1.forEach(function (child, i) {
      var angle;
      if (hasParents) {
        // 아래쪽 반원 (π/4 ~ 3π/4, 즉 대략 5시~7시 방향 넓게)
        var childSpread = Math.PI; // 180도
        var childStart = 0; // 3시 방향 기준, 아래쪽 반원
        if (level1.length === 1) {
          angle = Math.PI / 2; // 6시 방향 (정 아래)
        } else {
          angle = childStart + childSpread * (i + 0.5) / level1.length;
        }
      } else {
        angle = (2 * Math.PI * i) / level1.length - Math.PI / 2;
      }
      child.x = cx + Math.cos(angle) * R1;
      child.y = cy + Math.sin(angle) * R1;
    });

    level1.forEach(function (parent) {
      var children = level2.filter(function (n) { return n.parentId === parent.id; });
      if (!children.length) return;
      var parentAngle = Math.atan2(parent.y - cy, parent.x - cx);
      var spread = Math.PI * 0.5;
      children.forEach(function (child, i) {
        var angle;
        if (children.length === 1) {
          angle = parentAngle;
        } else {
          angle = parentAngle - spread / 2 + (spread * i) / (children.length - 1);
        }
        child.x = cx + Math.cos(angle) * R2;
        child.y = cy + Math.sin(angle) * R2;
      });
    });

    hintNodes = nodes.map(function (n) {
      return {
        node_id: n.id,
        type: n.type,
        detail: n.detail,
        similarity: null,
        role: 'structural',
        x: n.x,
        y: n.y,
        parentId: n.parentId,
        level: n.level,
        cardEl: null
      };
    });

    // 부모 노드 배치 (위쪽 반원)
    if (hasParents) {
      parents.forEach(function (p, i) {
        var angle;
        var parentSpread = Math.PI; // 위쪽 180도
        var parentStart = -Math.PI; // 9시 방향부터 위쪽으로
        if (parents.length === 1) {
          angle = -Math.PI / 2; // 12시 방향 (정 위)
        } else {
          angle = parentStart + parentSpread * (i + 0.5) / parents.length;
        }
        hintNodes.push({
          node_id: p.id,
          type: p.type,
          detail: p,
          similarity: null,
          role: 'parent',
          x: cx + Math.cos(angle) * R0,
          y: cy + Math.sin(angle) * R0,
          level: -1, // 부모는 -1 레벨
          cardEl: null
        });
        // 부모 → 중앙 엣지 추가
        structuralEdges.push({ from: p.id, to: focusNodeId });
      });
    }

    // 유사 힌트 노드 (R3 링에 배치)
    if (hints && hints.length) {
      hints.forEach(function (h, i) {
        var angle = (2 * Math.PI * i) / hints.length - Math.PI / 2;
        hintNodes.push({
          node_id: h.node_id,
          type: h.type,
          detail: h.detail,
          similarity: h.similarity,
          signals: h.signals,
          cluster_id: h.cluster_id,
          role: 'similar',
          x: cx + Math.cos(angle) * R3,
          y: cy + Math.sin(angle) * R3,
          level: 3,
          cardEl: null
        });
      });
    }
  }

  // ── 유사도 힌트 레이아웃 (클러스터 기반 방사형 — 원칙 3) ──
  var GAP_ANGLE = Math.PI / 12; // 클러스터 간 15도 간격

  function _buildLayout(hints, parents) {
    var W = $space.offsetWidth || 400;
    var H = $space.offsetHeight || 400;
    var cx = W / 2;
    var cy = H / 2;

    hintNodes = [];
    var hasParents = parents && parents.length > 0;
    var count = hints.length;
    if (!count && !hasParents) return;

    var maxRadius = Math.min(W, H) * 0.42;
    var minRadius = 180;

    // 부모가 있으면 유사 힌트를 아래쪽 반원에 배치
    var hintAngleStart, hintAngleTotal;
    if (hasParents) {
      hintAngleStart = 0; // 3시 방향부터
      hintAngleTotal = Math.PI; // 아래쪽 180도
    } else {
      hintAngleStart = -Math.PI / 2; // 12시 방향부터
      hintAngleTotal = 2 * Math.PI; // 전체 360도
    }

    if (count > 0) {
      // 클러스터별 힌트 분류
      var cc = clusterCount || 1;
      var clusterGroups = {}; // cluster_id -> [hint index]
      for (var i = 0; i < count; i++) {
        var cid = hints[i].cluster_id != null ? hints[i].cluster_id : 0;
        if (!clusterGroups[cid]) clusterGroups[cid] = [];
        clusterGroups[cid].push(i);
      }
      var clusterKeys = Object.keys(clusterGroups);
      cc = clusterKeys.length; // 실제 클러스터 수

      // 각 클러스터의 각도 영역 할당
      var totalGap = GAP_ANGLE * (cc > 1 ? cc : 0); // 클러스터 1개면 gap 없음
      var usableAngle = hintAngleTotal - totalGap;
      var anglePerCluster = usableAngle / Math.max(1, cc);

      var clusterStartAngles = [];
      var currentAngle = hintAngleStart;
      for (var c = 0; c < cc; c++) {
        clusterStartAngles.push(currentAngle);
        currentAngle += anglePerCluster + (cc > 1 ? GAP_ANGLE : 0);
      }

      // 각 힌트 배치
      for (var ci = 0; ci < clusterKeys.length; ci++) {
        var key = clusterKeys[ci];
        var group = clusterGroups[key];
        var startAngle = clusterStartAngles[ci];

        for (var gi = 0; gi < group.length; gi++) {
          var h = hints[group[gi]];
          var angle;
          if (group.length === 1) {
            angle = startAngle + anglePerCluster / 2;
          } else {
            angle = startAngle + anglePerCluster * (gi + 0.5) / group.length;
          }

          var sim01 = (h.similarity || 0) / 100;
          var dist = maxRadius - sim01 * (maxRadius - minRadius);

          hintNodes.push({
            node_id: h.node_id || h.id,
            type: h.type || 'fiber',
            detail: h.detail || h,
            similarity: h.similarity,
            signals: h.signals,
            cluster_id: h.cluster_id != null ? h.cluster_id : 0,
            x: cx + Math.cos(angle) * dist,
            y: cy + Math.sin(angle) * dist,
            cardEl: null
          });
        }
      }
    }

    // 부모 노드 (위쪽 반원에 배치)
    if (hasParents) {
      var R0 = Math.min(W, H) * 0.25;
      parents.forEach(function (p, i) {
        var angle;
        if (parents.length === 1) {
          angle = -Math.PI / 2; // 12시 방향
        } else {
          // 위쪽 반원: -π ~ 0 (9시 → 12시 → 3시)
          angle = -Math.PI + Math.PI * (i + 0.5) / parents.length;
        }
        hintNodes.push({
          node_id: p.id,
          type: p.type,
          detail: p,
          similarity: null,
          role: 'parent',
          x: cx + Math.cos(angle) * R0,
          y: cy + Math.sin(angle) * R0,
          level: -1,
          cardEl: null
        });
        structuralEdges.push({ from: p.id, to: focusNodeId });
      });
      isStructural = true; // 엣지 렌더링을 위해
    }
  }

  // ── 충돌 회피 (2-pass: DOM 측정 후 반지름 방향으로 밀어냄) ──
  function _resolveCollisions(cx, cy) {
    if (hintNodes.length < 2) return;

    var PADDING = 8; // 카드 간 최소 여백
    var MAX_ITER = 10;

    // Pass 1: DOM에서 실제 크기 측정
    var rects = [];
    for (var i = 0; i < hintNodes.length; i++) {
      var el = hintNodes[i].cardEl;
      if (!el) continue;
      var w = el.offsetWidth || 180;
      var h = el.offsetHeight || 60;
      rects.push({
        idx: i,
        x: hintNodes[i].x,
        y: hintNodes[i].y,
        hw: w / 2 + PADDING, // half-width + padding
        hh: h / 2 + PADDING  // half-height + padding
      });
    }

    // Pass 2: 반복적으로 겹침 해소
    for (var iter = 0; iter < MAX_ITER; iter++) {
      var moved = false;
      for (var a = 0; a < rects.length; a++) {
        for (var b = a + 1; b < rects.length; b++) {
          var ra = rects[a], rb = rects[b];
          var overlapX = (ra.hw + rb.hw) - Math.abs(ra.x - rb.x);
          var overlapY = (ra.hh + rb.hh) - Math.abs(ra.y - rb.y);
          if (overlapX <= 0 || overlapY <= 0) continue;

          // 겹침 발생 — 반지름 방향(중심에서 바깥)으로 밀어냄
          moved = true;
          var pushDist = Math.min(overlapX, overlapY) / 2 + 1;

          // a, b 각각 중심으로부터의 각도
          var angA = Math.atan2(ra.y - cy, ra.x - cx);
          var angB = Math.atan2(rb.y - cy, rb.x - cx);

          // 중심에 더 가까운 쪽을 더 많이 밀어냄
          var distA = Math.sqrt((ra.x - cx) * (ra.x - cx) + (ra.y - cy) * (ra.y - cy));
          var distB = Math.sqrt((rb.x - cx) * (rb.x - cx) + (rb.y - cy) * (rb.y - cy));

          if (distA < distB) {
            rb.x += Math.cos(angB) * pushDist;
            rb.y += Math.sin(angB) * pushDist;
          } else {
            ra.x += Math.cos(angA) * pushDist;
            ra.y += Math.sin(angA) * pushDist;
          }
        }
      }
      if (!moved) break;
    }

    // 결과 반영: hintNodes + DOM 위치 업데이트
    for (var r = 0; r < rects.length; r++) {
      var rect = rects[r];
      var node = hintNodes[rect.idx];
      node.x = rect.x;
      node.y = rect.y;
      if (node.cardEl) {
        node.cardEl.style.left = rect.x + 'px';
        node.cardEl.style.top = rect.y + 'px';
      }
    }
  }

  // ══════════════════════════════════════
  // DOM 카드 생성 (원칙 2+4+6)
  // ══════════════════════════════════════

  /**
   * _createCard(node, role)
   * role: 'center' | 'hint' | 'structural' | 'overview'
   * 원칙 2: 텍스트 직접 표시
   * 원칙 4: tone→CSS 클래스, tension→CSS 클래스
   * 원칙 6: hint는 30자만
   */
  function _createCard(node, role) {
    var el = document.createElement('div');
    var d = node.detail || node;
    var type = node.type || 'fiber';

    el.className = 'focus-card';
    if (role === 'center') el.classList.add('is-center');
    el.dataset.nodeId = node.id || node.node_id;
    el.dataset.nodeType = type;

    // 원칙 4: tone 클래스 (fiber만 tone 있음)
    if (type === 'fiber') {
      var tone = d.tone || 'resonance';
      el.classList.add('tone-' + tone);
      // 원칙 4: tension 클래스
      var tension = d.tension || 3;
      el.classList.add('tension-' + Math.min(5, Math.max(1, tension)));
    } else {
      // 비-fiber: 기본 스타일 (tension-3)
      el.classList.add('tension-3');
      // 타입별 시각적 구분
      el.classList.add('type-' + type);
    }

    // 원칙 2: 텍스트 내용
    var textEl = document.createElement('div');
    textEl.className = 'focus-card__text';
    var text = _getNodeText(node, type);
    if (role === 'center' || role === 'overview') {
      textEl.textContent = text; // 전체 (center: 원칙2, overview: 스캔용)
    } else {
      // 원칙 6: 부분만 (20자 — 카드 폭 내에서 읽히는 최적 길이)
      textEl.textContent = text.length > 20 ? text.substring(0, 20) + '...' : text;
      // 확장 시 전체 텍스트 복원용 (원칙 6: 부분→전체)
      el.dataset.fullText = text;
    }
    el.appendChild(textEl);

    // 원칙 5: 중심 카드에 출처 표시
    if (role === 'center' && d.source_title) {
      var srcEl = document.createElement('div');
      srcEl.className = 'focus-card__source';
      srcEl.textContent = d.source_title;
      el.appendChild(srcEl);
    }

    // 타입 배지 (비-fiber 카드)
    if (type !== 'fiber') {
      var typeEl = document.createElement('div');
      typeEl.className = 'focus-card__type-badge';
      typeEl.textContent = TYPE_NAMES[type] || type;
      el.appendChild(typeEl);
    }

    // 힌트/유사 카드: 유사도 표시
    if ((role === 'hint' || role === 'similar') && node.similarity != null) {
      var simEl = document.createElement('div');
      simEl.className = 'focus-card__sim';
      simEl.textContent = node.similarity + '%';
      el.appendChild(simEl);
    }

    // similar 카드에 CSS 클래스 추가
    if (role === 'similar') {
      el.classList.add('focus-card--similar');
    }

    // parent 카드에 CSS 클래스 추가
    if (role === 'parent') {
      el.classList.add('focus-card--parent');
    }

    // Overview 카드: 메타 정보 (시간)
    if (role === 'overview') {
      var time = d.caught_at || d.created_at || d.updated_at;
      if (time) {
        var metaEl = document.createElement('div');
        metaEl.className = 'focus-card__meta';
        var timeEl = document.createElement('span');
        timeEl.className = 'focus-card__meta-time';
        timeEl.textContent = _timeAgo(time);
        metaEl.appendChild(timeEl);
        el.appendChild(metaEl);
      }
    }

    // 상세 확장용 빈 컨테이너 (Phase 5: 클릭 시 채워짐)
    var detailEl = document.createElement('div');
    detailEl.className = 'focus-card__detail';
    el.appendChild(detailEl);

    return el;
  }

  /** 노드에서 표시할 텍스트 추출 */
  function _getNodeText(node, type) {
    var d = node.detail || node;
    if (type === 'fiber') return d.text || '';
    if (type === 'thread') return d.why || '';
    if (type === 'stitch') return d.why || '';
    if (type === 'fabric') return d.title || d.name || d.insight || '';
    return d.text || d.title || '';
  }

  /** 라벨 추출 (breadcrumb, 로그용) */
  function _getNodeLabel(node) {
    if (!node || !node.detail) return node.id || '';
    var d = node.detail;
    if (node.type === 'fiber') return d.text || '';
    if (node.type === 'thread') return d.why || '';
    if (node.type === 'stitch') return d.why || '';
    if (node.type === 'fabric') return d.name || d.title || d.insight || '';
    return d.text || d.title || '';
  }

  // ══════════════════════════════════════
  // DOM 렌더링
  // ══════════════════════════════════════

  /** 모든 카드와 연결선 제거 */
  function _clearCards() {
    // 진행 중인 애니메이션 취소
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if ($wrapper) {
      // SVG를 보존하고 카드만 제거
      var cards = $wrapper.querySelectorAll('.focus-card');
      for (var i = 0; i < cards.length; i++) {
        cards[i].remove();
      }
    }
    if ($lines) {
      $lines.innerHTML = '';
      $lines.classList.remove('is-dimmed');
    }
    centerCardEl = null;
    _savedPositions = null;
  }

  /** 포커스 모드 렌더링
   * @param {boolean} skipAnimation — true면 즉시 표시 (리사이즈 등)
   */
  function _renderFocusMode(skipAnimation) {
    _clearCards();
    if (!focusNode || !$wrapper) return;

    // 스크롤 비활성화 (pan/zoom 모드)
    if ($space) $space.classList.remove('is-overview-mode');

    // wrapper를 absolute 배치 모드로
    $wrapper.style.position = 'absolute';
    $wrapper.style.display = '';
    $wrapper.style.flexWrap = '';
    $wrapper.style.gap = '';
    $wrapper.style.padding = '';
    _applyView();

    var W = $space.offsetWidth || 400;
    var H = $space.offsetHeight || 400;
    var cx = W / 2;
    var cy = H / 2;

    // ── 중심 카드 ──
    centerCardEl = _createCard(focusNode, 'center');
    centerCardEl.style.left = cx + 'px';
    centerCardEl.style.top = cy + 'px';
    $wrapper.appendChild(centerCardEl);

    // ── 힌트/구조적 카드 ──
    hintNodes.forEach(function (h) {
      var role = h.role || (isStructural ? 'structural' : 'hint');
      var card = _createCard(
        { id: h.node_id, type: h.type, detail: h.detail, similarity: h.similarity, signals: h.signals },
        role
      );
      card.style.left = h.x + 'px';
      card.style.top = h.y + 'px';
      h.cardEl = card;
      $wrapper.appendChild(card);
    });

    // ── 충돌 회피 (2-pass: DOM 측정 후 위치 보정) ──
    if (!isStructural && hintNodes.length > 1) {
      _resolveCollisions(cx, cy);
    }

    // ── 원칙1: 방향성 오프셋 (중심에서 퍼져나오는 느낌) ──
    hintNodes.forEach(function (h) {
      if (!h.cardEl) return;
      var dx = cx - h.x;
      var dy = cy - h.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      h.cardEl.style.setProperty('--offset-x', (dx / len * OFFSET_PX) + 'px');
      h.cardEl.style.setProperty('--offset-y', (dy / len * OFFSET_PX) + 'px');
    });

    // ── 애니메이션 분기 ──
    if (skipAnimation) {
      // 리사이즈 등: 즉시 표시
      _updateLines(cx, cy);
      _revealCards();
    } else if (isStructural) {
      // 구조적 모드: 레벨별 순차 등장
      _startStructuralAnimation(cx, cy);
    } else {
      // 유사도 힌트: 감쇠 간격 순차 등장 (원칙 1+6)
      _startSpreadingAnimation(cx, cy);
    }

    // ── 위상/구조 표시 ──
    _updatePhaseLabel();
  }

  /** 오버뷰 모드 렌더링 (flex-wrap 그리드) */
  function _renderOverviewMode() {
    _clearCards();
    if (!$wrapper) return;

    // 스크롤 허용
    if ($space) $space.classList.add('is-overview-mode');

    // wrapper를 flex 그리드 모드로
    $wrapper.style.position = 'relative';
    $wrapper.style.transform = '';
    $wrapper.style.display = 'flex';
    $wrapper.style.flexWrap = 'wrap';
    $wrapper.style.gap = '8px';
    $wrapper.style.padding = '16px';
    $wrapper.style.alignContent = 'flex-start';
    $wrapper.style.alignItems = 'flex-start';

    overviewNodes.forEach(function (item) {
      var card = _createCard(
        { id: item.id, type: item.type, detail: item.data || item.detail },
        'overview'
      );
      card.classList.add('is-overview'); // CSS에서 position:relative + transform:none
      card.classList.add('is-visible');  // 즉시 표시
      item.cardEl = card;
      $wrapper.appendChild(card);
    });
  }

  /** 즉시 모두 표시 (리사이즈, skipAnimation 용) */
  function _revealCards() {
    if (centerCardEl) centerCardEl.classList.add('is-visible');
    hintNodes.forEach(function (h) {
      if (h.cardEl) h.cardEl.classList.add('is-visible');
    });
  }

  /**
   * 순차 등장 애니메이션 — 원칙 1 (확산 활성화) + 원칙 6 (부분만 보여줌)
   * 유사도 높은 힌트부터 감쇠 간격으로 등장, 연결선은 카드 등장 후 LINE_DELAY ms 뒤
   * 단일 rAF 루프로 관리 — cancelAnimationFrame 한 번으로 전체 취소
   */
  function _startSpreadingAnimation(cx, cy) {
    // 중심 카드: 즉시
    if (centerCardEl) centerCardEl.classList.add('is-visible');
    if (!hintNodes.length) return;

    // 연결선 미리 생성 (opacity:0, CSS transition이 등장 처리)
    // 카드 가장자리에서 시작/끝 — 선이 카드를 관통하지 않도록
    var ch = _cardHalf(centerCardEl);
    hintNodes.forEach(function (h) {
      var isLinked = h.signals && h.signals.graph === 100;
      var cls = isLinked ? 'focus-line--linked' : 'focus-line--hint';
      var hh = _cardHalf(h.cardEl);
      var start = _rectEdge(cx, cy, ch.hw, ch.hh, h.x, h.y);
      var end = _rectEdge(h.x, h.y, hh.hw, hh.hh, cx, cy);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', start.x);
      line.setAttribute('y1', start.y);
      line.setAttribute('x2', end.x);
      line.setAttribute('y2', end.y);
      line.setAttribute('class', cls);
      line.style.opacity = '0';
      $lines.appendChild(line);
      h._lineEl = line;
    });

    // 등장 시각 계산 (감쇠 간격: 400 → 340 → 289 → 246 → 209ms)
    var cumulative = 0;
    for (var i = 0; i < hintNodes.length; i++) {
      cumulative += BASE_DELAY * Math.pow(DECAY, i);
      hintNodes[i]._appearTime = cumulative;
      hintNodes[i]._lineTime = cumulative + LINE_DELAY;
      hintNodes[i]._cardRevealed = false;
      hintNodes[i]._lineRevealed = false;
    }

    var startTime = performance.now();
    function tick() {
      var elapsed = performance.now() - startTime;
      var allDone = true;

      for (var i = 0; i < hintNodes.length; i++) {
        var h = hintNodes[i];
        if (!h._cardRevealed && elapsed >= h._appearTime) {
          if (h.cardEl) h.cardEl.classList.add('is-visible');
          h._cardRevealed = true;
        }
        if (!h._lineRevealed && elapsed >= h._lineTime) {
          if (h._lineEl) h._lineEl.style.opacity = '1';
          h._lineRevealed = true;
        }
        if (!h._cardRevealed || !h._lineRevealed) allDone = false;
      }

      if (!allDone) {
        animationId = requestAnimationFrame(tick);
      } else {
        animationId = null;
      }
    }

    animationId = requestAnimationFrame(tick);
  }

  /**
   * 구조적 순차 등장 — 레벨별 펼쳐짐
   * level 1 (직접 하위) → level 2 (간접 하위) 순서로 등장
   */
  function _startStructuralAnimation(cx, cy) {
    // 중심 카드: 즉시
    if (centerCardEl) centerCardEl.classList.add('is-visible');
    if (!hintNodes.length) return;

    // 위치 맵 구성
    var nodePositions = {};
    nodePositions[focusNodeId] = { x: cx, y: cy };
    hintNodes.forEach(function (h) {
      nodePositions[h.node_id] = { x: h.x, y: h.y };
    });

    // 구조적 연결선 미리 생성 (opacity:0)
    // 카드 참조 맵 (가장자리 계산용)
    var nodeCards = {};
    nodeCards[focusNodeId] = centerCardEl;
    hintNodes.forEach(function (h) { nodeCards[h.node_id] = h.cardEl; });

    structuralEdges.forEach(function (edge) {
      var from = nodePositions[edge.from];
      var to = nodePositions[edge.to];
      if (!from || !to) return;
      var fh = _cardHalf(nodeCards[edge.from]);
      var th = _cardHalf(nodeCards[edge.to]);
      var start = _rectEdge(from.x, from.y, fh.hw, fh.hh, to.x, to.y);
      var end = _rectEdge(to.x, to.y, th.hw, th.hh, from.x, from.y);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', start.x);
      line.setAttribute('y1', start.y);
      line.setAttribute('x2', end.x);
      line.setAttribute('y2', end.y);
      line.setAttribute('class', 'focus-line--linked');
      line.style.opacity = '0';
      $lines.appendChild(line);
      // 대상 노드에 연결선 참조 저장 (자식: edge.to, 부모: edge.from)
      for (var i = 0; i < hintNodes.length; i++) {
        if (hintNodes[i].node_id === edge.to || hintNodes[i].node_id === edge.from) {
          hintNodes[i]._lineEl = line;
          break;
        }
      }
    });

    // 유사 힌트 노드 연결선 (중심 → similar, 점선)
    var ch = _cardHalf(centerCardEl);
    hintNodes.forEach(function (h) {
      if (h.role !== 'similar') return;
      var hh = _cardHalf(h.cardEl);
      var s = _rectEdge(cx, cy, ch.hw, ch.hh, h.x, h.y);
      var e = _rectEdge(h.x, h.y, hh.hw, hh.hh, cx, cy);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', s.x);
      line.setAttribute('y1', s.y);
      line.setAttribute('x2', e.x);
      line.setAttribute('y2', e.y);
      line.setAttribute('class', 'focus-line--similar');
      line.style.opacity = '0';
      $lines.appendChild(line);
      h._lineEl = line;
    });

    // 레벨별 분리: -1(부모) → 1(직접 하위) → 2(간접 하위) → 3(유사 힌트)
    var levelParent = [];
    var level1 = [];
    var level2 = [];
    var level3 = [];
    hintNodes.forEach(function (h) {
      if (h.role === 'similar') level3.push(h);
      else if (h.role === 'parent' || h.level === -1) levelParent.push(h);
      else if (h.level === 2) level2.push(h);
      else level1.push(h);
    });

    // 등장 시각: 부모 → 자식 level 1 → level 2 → 유사 힌트
    levelParent.forEach(function (h, i) {
      h._appearTime = STRUCT_DELAY * (i + 1);
      h._lineTime = h._appearTime + LINE_DELAY;
      h._cardRevealed = false;
      h._lineRevealed = false;
    });
    var parentEnd = levelParent.length ? levelParent[levelParent.length - 1]._appearTime + STRUCT_DELAY : 0;
    level1.forEach(function (h, i) {
      h._appearTime = parentEnd + STRUCT_DELAY * (i + 1);
      h._lineTime = h._appearTime + LINE_DELAY;
      h._cardRevealed = false;
      h._lineRevealed = false;
    });
    var level1End = level1.length ? level1[level1.length - 1]._appearTime + STRUCT_DELAY : parentEnd;
    level2.forEach(function (h, i) {
      h._appearTime = level1End + STRUCT_DELAY * (i + 1);
      h._lineTime = h._appearTime + LINE_DELAY;
      h._cardRevealed = false;
      h._lineRevealed = false;
    });
    // 유사 힌트: 구조적 완료 후 300ms 간격, 감쇠 간격
    var level2End = level2.length ? level2[level2.length - 1]._appearTime + STRUCT_DELAY : level1End;
    var similarGap = 300; // 구조적↔유사 전환 간격
    level3.forEach(function (h, i) {
      h._appearTime = level2End + similarGap + BASE_DELAY * Math.pow(DECAY, i);
      h._lineTime = h._appearTime + LINE_DELAY;
      h._cardRevealed = false;
      h._lineRevealed = false;
    });

    var startTime = performance.now();
    function tick() {
      var elapsed = performance.now() - startTime;
      var allDone = true;

      for (var i = 0; i < hintNodes.length; i++) {
        var h = hintNodes[i];
        if (!h._cardRevealed && elapsed >= h._appearTime) {
          if (h.cardEl) h.cardEl.classList.add('is-visible');
          h._cardRevealed = true;
        }
        if (!h._lineRevealed && elapsed >= h._lineTime) {
          if (h._lineEl) h._lineEl.style.opacity = '1';
          h._lineRevealed = true;
        }
        if (!h._cardRevealed || !h._lineRevealed) allDone = false;
      }

      if (!allDone) {
        animationId = requestAnimationFrame(tick);
      } else {
        animationId = null;
      }
    }

    animationId = requestAnimationFrame(tick);
  }

  /** SVG 연결선 그리기 (skipAnimation용 — 즉시 표시) */
  function _updateLines(cx, cy) {
    if (!$lines) return;
    $lines.innerHTML = '';

    if (isStructural && structuralEdges.length > 0) {
      // 구조적 연결: 부모-자식 간 선
      var nodePositions = {};
      nodePositions[focusNodeId] = { x: cx, y: cy };
      hintNodes.forEach(function (h) {
        nodePositions[h.node_id] = { x: h.x, y: h.y };
      });
      // 카드 참조 맵
      var nodeCards = {};
      nodeCards[focusNodeId] = centerCardEl;
      hintNodes.forEach(function (h) { nodeCards[h.node_id] = h.cardEl; });

      structuralEdges.forEach(function (edge) {
        var from = nodePositions[edge.from];
        var to = nodePositions[edge.to];
        if (!from || !to) return;
        var fh = _cardHalf(nodeCards[edge.from]);
        var th = _cardHalf(nodeCards[edge.to]);
        var start = _rectEdge(from.x, from.y, fh.hw, fh.hh, to.x, to.y);
        var end = _rectEdge(to.x, to.y, th.hw, th.hh, from.x, from.y);
        _addLine(start.x, start.y, end.x, end.y, 'focus-line--linked');
      });

      // 유사 힌트 연결선 (중심 → similar 노드, 점선)
      var ch2 = _cardHalf(centerCardEl);
      hintNodes.forEach(function (h) {
        if (h.role !== 'similar') return;
        var hh2 = _cardHalf(h.cardEl);
        var s = _rectEdge(cx, cy, ch2.hw, ch2.hh, h.x, h.y);
        var e = _rectEdge(h.x, h.y, hh2.hw, hh2.hh, cx, cy);
        _addLine(s.x, s.y, e.x, e.y, 'focus-line--similar');
      });
    } else {
      // 유사도 힌트: 중심에서 방사형 선 (카드 가장자리에서 시작/끝)
      var ch = _cardHalf(centerCardEl);
      hintNodes.forEach(function (h) {
        var isLinked = h.signals && h.signals.graph === 100;
        var cls = isLinked ? 'focus-line--linked' : 'focus-line--hint';
        var hh = _cardHalf(h.cardEl);
        var start = _rectEdge(cx, cy, ch.hw, ch.hh, h.x, h.y);
        var end = _rectEdge(h.x, h.y, hh.hw, hh.hh, cx, cy);
        _addLine(start.x, start.y, end.x, end.y, cls);
      });
    }
  }

  function _addLine(x1, y1, x2, y2, className) {
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', className);
    $lines.appendChild(line);
  }

  /** 카드 사각형 가장자리 교차점 — 선이 카드를 관통하지 않도록 */
  function _rectEdge(cx, cy, halfW, halfH, tx, ty) {
    var dx = tx - cx;
    var dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    var sx = halfW / (Math.abs(dx) || 0.001);
    var sy = halfH / (Math.abs(dy) || 0.001);
    var s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  /** 카드 DOM 크기 → half-width, half-height (+ 여백) */
  function _cardHalf(el, margin) {
    if (!el) return { hw: 0, hh: 0 };
    return {
      hw: el.offsetWidth / 2 + (margin || 4),
      hh: el.offsetHeight / 2 + (margin || 4)
    };
  }

  /** 위상/구조 라벨 (좌상단 정보) */
  function _updatePhaseLabel() {
    // 기존 라벨 제거
    var old = $wrapper.querySelector('.focus-phase-label');
    if (old) old.remove();

    var label = '';
    var structCount = 0;
    var simCount = 0;

    if (isStructural) {
      hintNodes.forEach(function (h) {
        if (h.role === 'similar') simCount++;
        else structCount++;
      });
      label = (TYPE_NAMES[focusNode.type] || '') + ' 구조 · ' + structCount + '개 연결';
      if (similarHintData.length > 0) {
        label += ' · ' + simCount + '개 유사';
      }
    } else if (phase) {
      var phaseLabels = { 'casting-on': '코잡기', 'transition': '전환', 'knitting': '뜨개질' };
      label = (phaseLabels[phase] || phase) + ' · ' + hintNodes.length + '개 유사';
    }

    if (label) {
      var el = document.createElement('div');
      el.className = 'focus-phase-label';
      el.textContent = label;

      // 유사 힌트 토글 버튼 (실/코에만)
      if (isStructural && similarHintData.length > 0) {
        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'focus-similar-toggle' + (showSimilar ? ' is-active' : '');
        toggleBtn.textContent = showSimilar ? '유사 숨기기' : '유사 보기';
        toggleBtn.title = '유사한 ' + (TYPE_NAMES[focusNode.type] || '') + ' 표시/숨기기';
        toggleBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          showSimilar = !showSimilar;
          // 레이아웃 재구성 (부모 제외 — _buildStructuralLayout이 다시 추가)
          var structNodes = hintNodes.filter(function (h) { return h.role !== 'similar' && h.role !== 'parent'; }).map(function (h) {
            return { id: h.node_id, type: h.type, detail: h.detail, parentId: h.parentId, level: h.level };
          });
          _buildStructuralLayout(structNodes, showSimilar ? similarHintData : [], parentNodes);
          _renderFocusMode(true);
        });
        el.appendChild(toggleBtn);
      }

      $wrapper.appendChild(el);
    }
  }

  // ══════════════════════════════════════
  // Breadcrumb (원칙 7: 탐색 경로)
  // ══════════════════════════════════════

  function _renderBreadcrumb() {
    if (!$breadcrumb) return;
    $breadcrumb.innerHTML = '';

    focusHistory.forEach(function (item, idx) {
      var span = document.createElement('span');
      span.className = 'breadcrumb-item';
      var lbl = item.label || '';
      span.textContent = lbl.length > 15 ? lbl.substring(0, 15) + '...' : lbl;
      span.title = lbl;
      span.dataset.nodeId = item.id;
      span.addEventListener('click', function () {
        // 해당 지점까지 히스토리 자르고, 히스토리 추가 없이 포커스 전환
        focusHistory = focusHistory.slice(0, idx);
        _doSetFocus(item.id);
        if (_navigateCallback) _navigateCallback({ type: 'focus', nodeId: item.id });
      });
      $breadcrumb.appendChild(span);

      var sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = ' \u25B8 ';
      $breadcrumb.appendChild(sep);
    });

    // 현재 노드
    if (focusNode) {
      var cur = document.createElement('span');
      cur.className = 'breadcrumb-current';
      var curLabel = _getNodeLabel(focusNode);
      cur.textContent = curLabel.length > 20 ? curLabel.substring(0, 20) + '...' : curLabel;
      cur.title = curLabel;
      $breadcrumb.appendChild(cur);
    }
  }

  // ══════════════════════════════════════
  // 맥락 바 (원칙 5: 인코딩 맥락 재현)
  // ══════════════════════════════════════

  function _updateContext() {
    if (!$context) return;
    $context.innerHTML = '';

    if (!focusNode || focusNode.type !== 'fiber') return;
    var d = focusNode.detail;
    if (!d || !d.source_title) return;

    var srcEl = document.createElement('div');
    srcEl.className = 'focus-context__source';
    srcEl.textContent = d.source_title;
    $context.appendChild(srcEl);

    if (d.source_range) {
      var rangeEl = document.createElement('div');
      rangeEl.className = 'focus-context__range';
      rangeEl.textContent = d.source_range;
      $context.appendChild(rangeEl);
    }
  }

  // ══════════════════════════════════════
  // Pan / Zoom (CSS transform)
  // ══════════════════════════════════════

  function _applyView() {
    if (!$wrapper) return;
    $wrapper.style.transform =
      'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
  }

  // ══════════════════════════════════════
  // 유틸리티
  // ══════════════════════════════════════

  function _showEmpty(show) {
    if ($empty) $empty.style.display = show ? '' : 'none';
    if ($space) $space.style.display = show ? 'none' : '';
    if ($context) $context.style.display = show ? 'none' : '';
  }

  function _showLoading(show) {
    if ($loading) $loading.style.display = show ? '' : 'none';
  }

  /** 카드 DOM에서 노드 정보 찾기 */
  function _findNodeByCardEl(cardEl) {
    var nodeId = cardEl.dataset.nodeId;
    if (!nodeId) return null;

    // 포커스 노드
    if (focusNode && (focusNode.id === nodeId)) {
      return focusNode;
    }

    // 힌트 노드
    for (var i = 0; i < hintNodes.length; i++) {
      if (hintNodes[i].node_id === nodeId) return hintNodes[i];
    }

    // 오버뷰 노드
    for (var j = 0; j < overviewNodes.length; j++) {
      if (overviewNodes[j].id === nodeId) return overviewNodes[j];
    }

    return null;
  }

  // ══════════════════════════════════════
  // 이벤트 핸들링 (DOM 이벤트 위임)
  // ══════════════════════════════════════

  var _clickTimer = null;

  function _setupInteraction() {
    // 카드 클릭 (이벤트 위임) — 딜레이로 싱글/더블 클릭 구분
    $wrapper.addEventListener('click', function (e) {
      var cardEl = e.target.closest('.focus-card');
      if (!cardEl) return;
      e.stopPropagation(); // pan 방지

      var node = _findNodeByCardEl(cardEl);
      if (!node) return;

      if (overviewMode) {
        // 딜레이: 싱글 클릭(인라인 확장) vs 더블 클릭(포커스 이동) 구분
        if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
        var capturedOvNode = node;
        var capturedOvEl = cardEl;
        _clickTimer = setTimeout(function () {
          _clickTimer = null;
          _onOverviewNodeClick(capturedOvNode, capturedOvEl);
        }, 200);
        return;
      }

      // 딜레이: 더블 클릭 판별 대기 (200ms)
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
      var capturedNode = node;
      var capturedEl = cardEl;
      _clickTimer = setTimeout(function () {
        _clickTimer = null;
        _onNodeClick(capturedNode, capturedEl);
      }, 200);
    });

    // 카드 더블클릭 → 해당 노드로 포커스 이동
    $wrapper.addEventListener('dblclick', function (e) {
      var cardEl = e.target.closest('.focus-card');
      if (!cardEl) return;
      e.stopPropagation();

      // 대기 중인 싱글 클릭 취소
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }

      var node = _findNodeByCardEl(cardEl);
      if (!node) return;

      var nodeId = node.id || node.node_id;
      if (nodeId && nodeId !== focusNodeId) {
        setFocus(nodeId);
      }
    });

    // 카드 우클릭 (컨텍스트 메뉴)
    $wrapper.addEventListener('contextmenu', function (e) {
      var cardEl = e.target.closest('.focus-card');
      if (!cardEl) return;

      var node = _findNodeByCardEl(cardEl);
      if (!node) return;

      e.preventDefault();
      _contextTarget = node;
      _contextTargetEl = cardEl;

      var $menu = document.getElementById('focusContextMenu');
      if (!$menu) return;
      $menu.style.left = e.clientX + 'px';
      $menu.style.top = e.clientY + 'px';
      $menu.classList.add('is-visible');
    });

    // Pan: space 영역에서의 드래그
    $space.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      // 카드 위에서는 pan 시작하지 않음
      if (e.target.closest('.focus-card')) return;
      if (overviewMode) return; // 오버뷰는 flex 스크롤

      isPanning = true;
      hasDragged = false;
      panStart.x = e.clientX;
      panStart.y = e.clientY;
      viewStart.x = view.x;
      viewStart.y = view.y;
      $space.style.cursor = 'grabbing';
    });

    $space.addEventListener('mousemove', function (e) {
      if (!isPanning) return;
      var dx = e.clientX - panStart.x;
      var dy = e.clientY - panStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
      view.x = viewStart.x + dx;
      view.y = viewStart.y + dy;
      _applyView();
    });

    $space.addEventListener('mouseup', function () {
      if (isPanning) {
        isPanning = false;
        $space.style.cursor = '';
      }
    });

    $space.addEventListener('mouseleave', function () {
      isPanning = false;
      $space.style.cursor = '';
    });

    // Zoom: 마우스 휠
    $space.addEventListener('wheel', function (e) {
      if (overviewMode) return;
      e.preventDefault();
      var rect = $space.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var delta = -e.deltaY * 0.001;
      var newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * (1 + delta)));
      var ratio = newScale / view.scale;
      view.x = mx - (mx - view.x) * ratio;
      view.y = my - (my - view.y) * ratio;
      view.scale = newScale;
      _applyView();
    }, { passive: false });

    // 빈 영역 더블클릭: 뷰 리셋
    $space.addEventListener('dblclick', function (e) {
      if (e.target.closest('.focus-card')) return;
      view.x = 0; view.y = 0; view.scale = 1;
      _applyView();
    });

    // 컨텍스트 메뉴 닫기
    document.addEventListener('click', function (e) {
      var $menu = document.getElementById('focusContextMenu');
      if ($menu && !$menu.contains(e.target)) {
        $menu.classList.remove('is-visible');
      }
    });

    // 키보드: Alt+← 뒤로가기, ESC 확장 닫기
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (typeof DetailPanel !== 'undefined' && DetailPanel.getExpandedCardEl && DetailPanel.getExpandedCardEl()) {
          _restoreCardPositions();
          DetailPanel.close();
          return;
        }
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        history.back();
      }
    });

    // 빈 영역 클릭 시 인라인 확장 닫기 (드래그가 아닌 경우만)
    $space.addEventListener('click', function (e) {
      if (hasDragged) return;
      if (e.target.closest('.focus-card')) return;
      if (typeof DetailPanel !== 'undefined' && DetailPanel.getExpandedCardEl && DetailPanel.getExpandedCardEl()) {
        _restoreCardPositions();
        DetailPanel.close();
      }
    });
  }

  // ── 노드 클릭 핸들러 ──

  var _contextTarget = null;
  var _contextTargetEl = null;

  function _onNodeClick(node, cardEl) {
    var nodeId = node.id || node.node_id;

    if (nodeId === focusNodeId) {
      // 중심 카드 클릭 → 인라인 확장 (토글)
      if (typeof DetailPanel !== 'undefined') {
        if (cardEl.classList.contains('is-expanded')) {
          _restoreCardPositions();
          DetailPanel.close();
        } else {
          DetailPanel.show(focusNode, cardEl);
          _pushCardsOnExpand(cardEl);
        }
      }
      return;
    }

    // 힌트/구조 카드 클릭 → 인라인 확장 (토글)
    if (typeof DetailPanel !== 'undefined') {
      if (cardEl.classList.contains('is-expanded')) {
        _restoreCardPositions();
        DetailPanel.close();
      } else {
        DetailPanel.show(node, cardEl);
        _pushCardsOnExpand(cardEl);
      }
    }
  }

  function _onOverviewNodeClick(node, cardEl) {
    // 오버뷰 싱글 클릭 → 인라인 확장 + 소스 패널 동기화
    if (!cardEl) return;
    var nodeId = node.id || node.node_id;
    if (typeof DetailPanel !== 'undefined') {
      if (cardEl.classList.contains('is-expanded')) {
        DetailPanel.close();
        // 소스 패널 하이라이트 해제
        if (typeof SourcePanel !== 'undefined' && SourcePanel.highlightItem) {
          SourcePanel.highlightItem(null);
        }
      } else {
        DetailPanel.show(node, cardEl);
        // 소스 패널에서 해당 항목 하이라이트 + 최상단 이동
        if (typeof SourcePanel !== 'undefined' && SourcePanel.highlightItem) {
          SourcePanel.highlightItem(nodeId);
        }
      }
    }
  }

  // ── 컨텍스트 메뉴 액션 ──

  function handleContextAction(action) {
    var $menu = document.getElementById('focusContextMenu');
    if ($menu) $menu.classList.remove('is-visible');

    if (!_contextTarget) return;
    var targetId = _contextTarget.node_id || _contextTarget.id;

    if (action === 'new-thought') {
      var thoughtTargetType = _contextTarget.type || 'fiber';
      KnittingDialog.prompt({
        title: '새 생각',
        message: '이 노드에서 떠오른 생각을 적어주세요.',
        placeholder: '떠오른 생각...',
        submitLabel: '올 잡기'
      }, function (text) {
        if (!text) return;
        FiberAPI.catchFiber({
          text: text,
          source: 'thought',
          tension: 3,
          tone: 'resonance',
          born_from_id: targetId,
          born_from_type: thoughtTargetType
        }).then(function (newFiber) {
          if (thoughtTargetType === 'fiber') {
            FiberAPI.createThread({
              fiber_a_id: targetId,
              fiber_b_id: newFiber.id,
              why: ''
            }).then(function () {
              if (focusNodeId) setFocus(focusNodeId);
              if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
            });
          } else {
            FiberAPI.createConnection({
              node_a_id: targetId,
              node_b_id: newFiber.id,
              why: 'thought born from'
            }).then(function () {
              if (focusNodeId) setFocus(focusNodeId);
              if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
            });
          }
        });
      });
    } else if (action === 'connect') {
      var sourceId = focusNodeId;
      var sourceType = focusNodeId ? _nodeType(focusNodeId) : null;
      if (!sourceId) {
        if (typeof KnittingDialog !== 'undefined') {
          KnittingDialog.alert('엮기', '먼저 노드를 클릭하여 선택한 뒤,\n다른 노드를 우클릭하여 엮어주세요.');
        }
        return;
      }
      if (targetId === sourceId) {
        if (typeof KnittingDialog !== 'undefined') {
          KnittingDialog.alert('엮기', '같은 노드끼리는 엮을 수 없습니다.');
        }
        return;
      }
      var targetType = _contextTarget.type || 'fiber';
      KnittingDialog.prompt({
        title: '엮기',
        message: '이 둘이 연결되는 이유를 적어주세요 (선택)',
        placeholder: '이유나 느낌...',
        submitLabel: '엮기'
      }, function (why) {
        var fType = sourceType || _nodeType(sourceId);
        var tType = targetType;
        if (fType === 'fiber' && tType === 'fiber') {
          FiberAPI.createThread({
            fiber_a_id: sourceId,
            fiber_b_id: targetId,
            why: why || ''
          }).then(function () {
            if (typeof KnittingDialog !== 'undefined') KnittingDialog.alert('엮기 완료', '실이 생성되었습니다.');
            if (focusNodeId) setFocus(focusNodeId);
            if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
          }).catch(function (err) {
            if (typeof KnittingDialog !== 'undefined') KnittingDialog.alert('오류', '실 생성에 실패했습니다.');
            console.error('createThread error:', err);
          });
        } else if (fType === 'thread' && tType === 'thread') {
          FiberAPI.createStitch({
            thread_a_id: sourceId,
            thread_b_id: targetId,
            why: why || ''
          }).then(function () {
            if (typeof KnittingDialog !== 'undefined') KnittingDialog.alert('엮기 완료', '코가 생성되었습니다.');
            if (focusNodeId) setFocus(focusNodeId);
            if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
          }).catch(function (err) {
            if (typeof KnittingDialog !== 'undefined') KnittingDialog.alert('오류', '코 생성에 실패했습니다.');
            console.error('createStitch error:', err);
          });
        } else {
          FiberAPI.createConnection({
            node_a_id: sourceId,
            node_b_id: targetId,
            why: why || ''
          }).then(function () {
            if (focusNodeId) setFocus(focusNodeId);
            if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
          }).catch(function (err) {
            if (typeof KnittingDialog !== 'undefined') KnittingDialog.alert('오류', '연결에 실패했습니다.');
            console.error('createConnection error:', err);
          });
        }
      });
    } else if (action === 'detail') {
      if (typeof DetailPanel !== 'undefined' && DetailPanel.show && _contextTargetEl) {
        DetailPanel.show(_contextTarget, _contextTargetEl);
        _pushCardsOnExpand(_contextTargetEl);
      }
    }

    _contextTarget = null;
    _contextTargetEl = null;
  }

  // ══════════════════════════════════════
  // 카드 밀어내기 (확장 시 겹침 방지)
  // ══════════════════════════════════════

  /** 확장된 카드와 겹치는 카드를 밖으로 밀어냄 */
  function _pushCardsOnExpand(expandedEl) {
    // 이전 위치 복원 (다른 카드가 이미 확장 중이었을 경우)
    if (_savedPositions) _restoreCardPositions(true);

    _savedPositions = {};
    var PADDING = 12;

    // 확장 카드 크기 측정 (rAF로 리플로우 후)
    requestAnimationFrame(function () {
      var expRect = {
        x: parseFloat(expandedEl.style.left),
        y: parseFloat(expandedEl.style.top),
        hw: expandedEl.offsetWidth / 2 + PADDING,
        hh: expandedEl.offsetHeight / 2 + PADDING
      };

      // SVG 연결선 dim
      if ($lines) $lines.classList.add('is-dimmed');

      // 중심 카드 포함 모든 카드 검사
      var allCards = [];
      if (centerCardEl && centerCardEl !== expandedEl) {
        allCards.push({ el: centerCardEl, id: centerCardEl.dataset.nodeId,
          x: parseFloat(centerCardEl.style.left), y: parseFloat(centerCardEl.style.top) });
      }
      hintNodes.forEach(function (h) {
        if (h.cardEl && h.cardEl !== expandedEl) {
          allCards.push({ el: h.cardEl, id: h.node_id, x: h.x, y: h.y });
        }
      });

      allCards.forEach(function (card) {
        var cw = card.el.offsetWidth / 2;
        var ch = card.el.offsetHeight / 2;
        var overlapX = (expRect.hw + cw) - Math.abs(card.x - expRect.x);
        var overlapY = (expRect.hh + ch) - Math.abs(card.y - expRect.y);

        if (overlapX > 0 && overlapY > 0) {
          // 원래 위치 저장
          _savedPositions[card.id] = { x: card.x, y: card.y };

          // 밀어낼 방향: 확장 카드 중심에서 해당 카드 방향
          var dx = card.x - expRect.x;
          var dy = card.y - expRect.y;
          var dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var pushDist = Math.min(overlapX, overlapY) + PADDING;

          var newX = card.x + (dx / dist) * pushDist;
          var newY = card.y + (dy / dist) * pushDist;

          card.el.style.left = newX + 'px';
          card.el.style.top = newY + 'px';

          // hintNodes 위치도 임시 업데이트
          for (var i = 0; i < hintNodes.length; i++) {
            if (hintNodes[i].node_id === card.id) {
              hintNodes[i].x = newX;
              hintNodes[i].y = newY;
              break;
            }
          }
        }
      });
    });
  }

  /** 밀어낸 카드를 원래 위치로 복원 */
  function _restoreCardPositions(skipLineDim) {
    if (!_savedPositions) return;

    // SVG 연결선 복원
    if (!skipLineDim && $lines) $lines.classList.remove('is-dimmed');

    Object.keys(_savedPositions).forEach(function (nodeId) {
      var pos = _savedPositions[nodeId];

      // 중심 카드
      if (centerCardEl && centerCardEl.dataset.nodeId === nodeId) {
        centerCardEl.style.left = pos.x + 'px';
        centerCardEl.style.top = pos.y + 'px';
      }

      // 힌트 카드
      for (var i = 0; i < hintNodes.length; i++) {
        if (hintNodes[i].node_id === nodeId) {
          hintNodes[i].x = pos.x;
          hintNodes[i].y = pos.y;
          if (hintNodes[i].cardEl) {
            hintNodes[i].cardEl.style.left = pos.x + 'px';
            hintNodes[i].cardEl.style.top = pos.y + 'px';
          }
          break;
        }
      }
    });

    _savedPositions = null;
  }

  // ══════════════════════════════════════
  // ResizeObserver
  // ══════════════════════════════════════

  function _setupResize() {
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        if (overviewMode) return; // flex 그리드는 자동 리플로우

        if (focusNode && isStructural) {
          var structNodes = hintNodes.filter(function (h) { return h.role !== 'similar' && h.role !== 'parent'; }).map(function (h) {
            return { id: h.node_id, type: h.type, detail: h.detail, parentId: h.parentId, level: h.level };
          });
          _buildStructuralLayout(structNodes, showSimilar ? similarHintData : [], parentNodes);
          _renderFocusMode(true);
        } else if (focusNode && hintNodes.length) {
          _buildLayout(hintNodes.filter(function (h) { return h.role !== 'parent'; }).map(function (h) {
            return { node_id: h.node_id, type: h.type, detail: h.detail, similarity: h.similarity, signals: h.signals, cluster_id: h.cluster_id };
          }), parentNodes);
          _renderFocusMode(true);
        }
      });
      if ($space) ro.observe($space);
    }
  }

  /** 오버뷰 모드에서 특정 카드를 하이라이트 + 최상단 이동 + 상세 확장 */
  function highlightOverviewCard(nodeId) {
    if (!$wrapper) return;
    // 기존 하이라이트 해제 + 원래 순서 복원
    var prev = $wrapper.querySelector('.focus-card.is-highlighted');
    if (prev) {
      prev.classList.remove('is-highlighted');
      if (typeof DetailPanel !== 'undefined') DetailPanel.close();
      _restoreOverviewOrder();
    }
    if (!nodeId) return;
    var card = $wrapper.querySelector('[data-node-id="' + nodeId + '"]');
    if (card && card.classList.contains('is-overview')) {
      card.classList.add('is-highlighted');
      // 카드 중 맨 앞으로 DOM 이동
      var firstCard = $wrapper.querySelector('.focus-card');
      if (firstCard && firstCard !== card) {
        $wrapper.insertBefore(card, firstCard);
      }
      if ($space) $space.scrollTop = 0;
      // 상세보기 자동 확장
      var node = _findNodeByCardEl(card);
      if (node && typeof DetailPanel !== 'undefined') {
        DetailPanel.show(node, card);
      }
    }
  }

  /** overviewNodes 순서대로 카드 DOM 복원 */
  function _restoreOverviewOrder() {
    overviewNodes.forEach(function (item) {
      if (item.cardEl && item.cardEl.parentNode === $wrapper) {
        $wrapper.appendChild(item.cardEl);
      }
    });
  }

  /** 현재 오버뷰 모드인지 */
  function isOverviewMode() {
    return overviewMode;
  }

  // ── Public API ──

  return {
    init: init,
    setFocus: setFocus,
    restoreFocus: restoreFocus,
    onNavigate: onNavigate,
    showOverview: showOverview,
    handleContextAction: handleContextAction,
    goBack: goBack,
    getFocusNodeId: function () { return focusNodeId; },
    highlightOverviewCard: highlightOverviewCard,
    isOverviewMode: isOverviewMode
  };
})();
