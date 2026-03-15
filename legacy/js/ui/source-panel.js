/**
 * Source Panel — 소스 목록 UI
 * 올/실/코/편물 탭 전환, 검색, 정렬
 * 항목 클릭 → 포커스 뷰에 반영
 * 의존: FiberAPI, FocusView
 */
var SourcePanel = (function () {
  'use strict';

  // ── DOM refs ──
  var $list, $empty, $tabs, $search, $sort;

  // ── State ──
  var currentTab = 'all';   // all | fiber | thread | stitch | fabric
  var searchQuery = '';
  var sortBy = 'newest';    // newest | tension | connections
  var _tabChangeCallback = null;

  // Data caches
  var allFibers = [];
  var allThreads = [];
  var allStitches = [];
  var allFabrics = [];

  function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

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
    $list = document.getElementById('sourceList');
    $empty = document.getElementById('sourceEmpty');
    $tabs = document.getElementById('sourceTabs');
    $search = document.getElementById('sourceSearch');
    $sort = document.getElementById('sourceSort');

    if ($tabs) {
      $tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tab]');
        if (!btn) return;
        currentTab = btn.dataset.tab;
        $tabs.querySelectorAll('[data-tab]').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.tab === currentTab);
        });
        render();
        _syncFocusView(true);
        if (_tabChangeCallback) _tabChangeCallback(currentTab);
      });
    }

    if ($search) {
      var debounce = null;
      $search.addEventListener('input', function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          searchQuery = $search.value.trim().toLowerCase();
          render();
          _syncFocusView(); // Overview 모드면 카드 갱신 (포커스 모드면 무시)
        }, 150);
      });
    }

    if ($sort) {
      $sort.addEventListener('change', function () {
        sortBy = $sort.value;
        render();
        _syncFocusView(); // Overview 모드면 카드 갱신 (포커스 모드면 무시)
      });
    }
  }

  // ── Data loading ──

  function refresh() {
    Promise.all([
      FiberAPI.listFibers(),
      FiberAPI.listThreads(),
      FiberAPI.listStitches(),
      FiberAPI.listFabrics()
    ]).then(function (results) {
      allFibers = results[0] || [];
      allThreads = results[1] || [];
      allStitches = results[2] || [];
      allFabrics = results[3] || [];
      render();
      _syncFocusView();
    }).catch(function () {
      allFibers = []; allThreads = []; allStitches = []; allFabrics = [];
      render();
      _syncFocusView();
    });
  }

  // ── Rendering ──

  function render() {
    if (!$list) return;
    $list.innerHTML = '';

    var items = _getFilteredItems();

    if (!items.length) {
      if ($empty) {
        $empty.style.display = '';
        $empty.textContent = searchQuery ? '검색 결과가 없습니다.' : '아직 데이터가 없습니다.';
      }
      return;
    }
    if ($empty) $empty.style.display = 'none';

    items.forEach(function (item) {
      $list.appendChild(_renderItem(item));
    });
  }

  function _getFilteredItems() {
    var items = [];

    if (currentTab === 'all' || currentTab === 'fiber') {
      allFibers.forEach(function (f) {
        items.push({ type: 'fiber', id: f.id, data: f, time: f.caught_at, tension: f.tension || 3 });
      });
    }
    if (currentTab === 'all' || currentTab === 'thread') {
      allThreads.forEach(function (t) {
        items.push({ type: 'thread', id: t.id, data: t, time: t.created_at, tension: 0 });
      });
    }
    if (currentTab === 'all' || currentTab === 'stitch') {
      allStitches.forEach(function (s) {
        items.push({ type: 'stitch', id: s.id, data: s, time: s.created_at, tension: 0 });
      });
    }
    if (currentTab === 'all' || currentTab === 'fabric') {
      allFabrics.forEach(function (f) {
        items.push({ type: 'fabric', id: f.id, data: f, time: f.created_at || f.updated_at, tension: 0 });
      });
    }

    // Search filter
    if (searchQuery) {
      items = items.filter(function (item) {
        var text = _getItemText(item).toLowerCase();
        return text.indexOf(searchQuery) !== -1;
      });
    }

    // Sort
    if (sortBy === 'tension') {
      items.sort(function (a, b) { return b.tension - a.tension || b.time - a.time; });
    } else {
      items.sort(function (a, b) { return b.time - a.time; });
    }

    return items;
  }

  function _getItemText(item) {
    var d = item.data;
    if (item.type === 'fiber') return d.text || '';
    if (item.type === 'thread') return (d.why || '') + ' ' + (d.fiber_a_id || '') + ' ' + (d.fiber_b_id || '');
    if (item.type === 'stitch') return d.why || '';
    if (item.type === 'fabric') return (d.title || '') + ' ' + (d.insight || '');
    return '';
  }

  function _renderItem(item) {
    var el = document.createElement('div');
    el.className = 'source-item source-item--' + item.type;
    el.dataset.nodeId = item.id;

    var typeIcons = { fiber: '\u25CB', thread: '\u2500', stitch: '\u2715', fabric: '\u25A1' };
    var typeNames = { fiber: '\uC62C', thread: '\uC2E4', stitch: '\uCF54', fabric: '\uD3B8\uBB3C' };
    var icon = typeIcons[item.type] || '\u00B7';
    var typeName = typeNames[item.type] || '';

    var text = _getDisplayText(item);
    var meta = _timeAgo(item.time);

    el.innerHTML =
      '<span class="source-item__icon" title="' + typeName + '">' + icon + '</span>' +
      '<div class="source-item__body">' +
        '<div class="source-item__text">' + esc(text) + '</div>' +
        '<div class="source-item__meta">' +
          '<span class="source-item__type">' + typeName + '</span>' +
          '<span class="source-item__time">' + meta + '</span>' +
          (item.type === 'fiber' ? '<span class="source-item__tension">' + _tensionDots(item.tension) + '</span>' : '') +
        '</div>' +
      '</div>';

    el.addEventListener('click', function () {
      // Highlight active item in source list
      var prev = $list.querySelector('.source-item.is-active');
      var wasActive = (prev === el);
      if (prev) prev.classList.remove('is-active');

      if (typeof FocusView !== 'undefined') {
        var isOv = FocusView.isOverviewMode && FocusView.isOverviewMode();
        if (isOv) {
          // 오버뷰 모드: 토글 하이라이트 (재클릭 시 해제)
          if (wasActive) {
            FocusView.highlightOverviewCard(null);
          } else {
            el.classList.add('is-active');
            FocusView.highlightOverviewCard(item.id);
          }
        } else {
          // 포커스 모드: 기존 동작 (setFocus)
          el.classList.add('is-active');
          if (FocusView.setFocus) FocusView.setFocus(item.id);
        }
      }
    });

    return el;
  }

  function _getDisplayText(item) {
    var d = item.data;
    if (item.type === 'fiber') {
      var t = d.text || '';
      return t.length > 60 ? t.substring(0, 60) + '...' : t;
    }
    if (item.type === 'thread') {
      if (d.why) return d.why.length > 60 ? d.why.substring(0, 60) + '...' : d.why;
      var fa = d.fiber_a_text || d.fiber_a_id || '';
      var fb = d.fiber_b_text || d.fiber_b_id || '';
      if (fa.length > 25) fa = fa.substring(0, 25) + '...';
      if (fb.length > 25) fb = fb.substring(0, 25) + '...';
      return fa + ' \u2194 ' + fb;
    }
    if (item.type === 'stitch') {
      if (d.why) return d.why.length > 60 ? d.why.substring(0, 60) + '...' : d.why;
      var sa = _threadSummary(d.thread_a_why, d.thread_a_fiber_a_text, d.thread_a_fiber_b_text);
      var sb = _threadSummary(d.thread_b_why, d.thread_b_fiber_a_text, d.thread_b_fiber_b_text);
      return sa + ' \u2194 ' + sb;
    }
    if (item.type === 'fabric') {
      var ft = d.title || d.insight || '';
      return ft.length > 60 ? ft.substring(0, 60) + '...' : ft;
    }
    return item.id;
  }

  function _threadSummary(why, fiberAText, fiberBText) {
    if (why) return why.length > 25 ? why.substring(0, 25) + '...' : why;
    var a = fiberAText || '';
    var b = fiberBText || '';
    if (a.length > 12) a = a.substring(0, 12) + '..';
    if (b.length > 12) b = b.substring(0, 12) + '..';
    if (a && b) return a + '+' + b;
    return a || b || '?';
  }

  function _tensionDots(t) {
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<span class="source-item__dot' + (i <= t ? ' is-filled' : '') + '"></span>';
    }
    return out;
  }

  function _syncFocusView(force) {
    if (typeof FocusView === 'undefined' || !FocusView.showOverview) return;
    // Don't override focus mode unless forced (tab switch)
    if (!force && FocusView.getFocusNodeId && FocusView.getFocusNodeId()) return;

    var items = _getFilteredItems();
    FocusView.showOverview(items);
  }

  /** 외부에서 소스 항목 하이라이트 (포커스 전환 시 동기화) */
  function highlightItem(nodeId) {
    if (!$list) return;
    var prev = $list.querySelector('.source-item.is-active');
    if (prev) prev.classList.remove('is-active');
    if (!nodeId) {
      // 하이라이트 해제 시 원래 순서 복원
      _restoreSourceOrder();
      return;
    }
    var el = $list.querySelector('[data-node-id="' + nodeId + '"]');
    if (el) {
      el.classList.add('is-active');
      // 최상단으로 DOM 이동
      var firstItem = $list.querySelector('.source-item');
      if (firstItem && firstItem !== el) {
        $list.insertBefore(el, firstItem);
      }
      $list.scrollTop = 0;
    }
  }

  /** 소스 목록 원래 순서 복원 (render 재호출) */
  function _restoreSourceOrder() {
    render();
  }

  /** 외부에서 탭을 설정 (콜백 발동 없음, 히스토리 복원용) */
  function setTab(tabName) {
    currentTab = tabName || 'all';
    if ($tabs) {
      $tabs.querySelectorAll('[data-tab]').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tab === currentTab);
      });
    }
    render();
  }

  function getTab() { return currentTab; }

  function onTabChange(cb) { _tabChangeCallback = cb; }

  /** 오버뷰 강제 갱신 (히스토리 복원 시 사용) */
  function triggerOverview() { _syncFocusView(true); }

  return {
    init: init,
    refresh: refresh,
    render: render,
    highlightItem: highlightItem,
    setTab: setTab,
    getTab: getTab,
    onTabChange: onTabChange,
    triggerOverview: triggerOverview
  };
})();
