/**
 * Knitting UI — Explorer App Controller
 * 소스 패널 / 포커스 뷰 / 상세 패널 통합 초기화
 * 의존: FiberAPI, SourcePanel, FocusView, DetailPanel
 */
(function () {
  'use strict';

  // ── Init ──

  document.addEventListener('DOMContentLoaded', function () {
    FiberAPI.isAvailable().then(function (ok) {
      if (!ok) {
        console.warn('[app] 서버 연결 불가 — http://localhost:3001');
      }

      SourcePanel.init();
      FocusView.init();
      DetailPanel.init();

      SourcePanel.refresh();

      _setupResize('sourcesResizeHandle', 'sourcesSidebar', 'left');

      _setupToggle('sourcesToggle', 'sourcesSidebar');

      _setupFocusContextMenu();

      _setupHistory();
    });
  });

  // ── Focus context menu ──

  function _setupFocusContextMenu() {
    var $menu = document.getElementById('focusContextMenu');
    if (!$menu) return;

    $menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-action]');
      if (!item) return;
      var action = item.dataset.action;
      if (typeof FocusView !== 'undefined' && FocusView.handleContextAction) {
        FocusView.handleContextAction(action);
      }
    });
  }

  // ── Sidebar resize ──

  function _setupResize(handleId, sidebarId, side) {
    var handle = document.getElementById(handleId);
    var sidebar = document.getElementById(sidebarId);
    if (!handle || !sidebar) return;

    var startX, startW;

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.classList.add('is-resizing');
    });

    function onMove(e) {
      var diff = e.clientX - startX;
      if (side === 'right') diff = -diff;
      var newW = Math.max(180, Math.min(500, startW + diff));
      sidebar.style.width = newW + 'px';
      sidebar.style.flexBasis = newW + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-resizing');
    }
  }

  // ── Sidebar toggle ──

  function _setupToggle(btnId, sidebarId) {
    var btn = document.getElementById(btnId);
    var sidebar = document.getElementById(sidebarId);
    if (!btn || !sidebar) return;

    btn.addEventListener('click', function () {
      sidebar.classList.toggle('is-collapsed');
    });
  }

  // ── Browser history (pushState / popstate) ──

  function _setupHistory() {
    var _isRestoring = false;

    function _parseHash() {
      var hash = location.hash.replace(/^#/, '');
      var params = {};
      hash.split('&').forEach(function (part) {
        var kv = part.split('=');
        if (kv.length === 2) params[kv[0]] = decodeURIComponent(kv[1]);
      });
      return params; // { focus: 'fb_xxx', tab: 'fiber' }
    }

    function _buildHash(state) {
      var parts = [];
      if (state.tab && state.tab !== 'all') parts.push('tab=' + encodeURIComponent(state.tab));
      if (state.focus) parts.push('focus=' + encodeURIComponent(state.focus));
      return parts.length ? '#' + parts.join('&') : '';
    }

    function _currentState() {
      return {
        tab: SourcePanel.getTab(),
        focus: FocusView.getFocusNodeId() || null
      };
    }

    var _prevFocus = null;

    // 포커스 변경 → pushState
    FocusView.onNavigate(function (ev) {
      if (_isRestoring) return;
      var state = _currentState();
      var hash = _buildHash(state);
      history.pushState(state, '', location.pathname + hash);
      _prevFocus = state.focus;
    });

    // 탭 변경: 포커스→오버뷰 전환이면 pushState, 오버뷰끼리면 replaceState
    SourcePanel.onTabChange(function (tab) {
      if (_isRestoring) return;
      var state = _currentState();
      var hash = _buildHash(state);
      if (_prevFocus && !state.focus) {
        // 포커스 모드에서 오버뷰로 전환: 의미 있는 네비게이션
        history.pushState(state, '', location.pathname + hash);
      } else {
        history.replaceState(state, '', location.pathname + hash);
      }
      _prevFocus = state.focus;
    });

    // 뒤로가기/앞으로가기
    window.addEventListener('popstate', function (e) {
      _isRestoring = true;
      var state = e.state || _parseHash();
      var tab = state.tab || 'all';
      var focus = state.focus || null;

      SourcePanel.setTab(tab);

      if (focus) {
        FocusView.restoreFocus(focus);
      } else {
        SourcePanel.triggerOverview();
      }
      _isRestoring = false;
    });

    // 초기 딥링크: URL 해시에서 상태 복원
    var initial = _parseHash();
    if (initial.tab) {
      SourcePanel.setTab(initial.tab);
    }
    if (initial.focus) {
      // refresh 완료 후 포커스 적용 (데이터 로딩 대기)
      setTimeout(function () {
        FocusView.restoreFocus(initial.focus);
      }, 500);
    }

    // 초기 상태 replaceState
    var initState = _currentState();
    history.replaceState(initState, '', location.pathname + _buildHash(initState));
  }

})();
