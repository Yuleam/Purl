/**
 * Knitting UI — App Controller
 * 노트/바구니 통합 초기화, 패널 탭 전환
 * 의존: KnittingStorage, KnittingNote, KnittingBookshelf, NoteEditor, BasketPanel, FiberAPI
 */
(function () {
  'use strict';

  function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  // ── Multi-select state ──

  var _selectedNoteIds = [];
  var _lastClickedNoteId = null;
  var _contextBulkMode = false;

  function _isSelected(id) {
    return _selectedNoteIds.indexOf(id) !== -1;
  }

  function _toggleSelected(id) {
    var idx = _selectedNoteIds.indexOf(id);
    if (idx === -1) _selectedNoteIds.push(id);
    else _selectedNoteIds.splice(idx, 1);
    _updateSelectionUI();
  }

  function _addSelected(id) {
    if (_selectedNoteIds.indexOf(id) === -1) _selectedNoteIds.push(id);
  }

  function _clearSelection() {
    _selectedNoteIds = [];
    _updateSelectionUI();
  }

  function _selectRange(fromId, toId) {
    var noteEls = document.querySelectorAll('#noteList .note-item');
    var ids = [];
    noteEls.forEach(function (el) { ids.push(el.dataset.id); });
    var fromIdx = ids.indexOf(fromId);
    var toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    var start = Math.min(fromIdx, toIdx);
    var end = Math.max(fromIdx, toIdx);
    for (var i = start; i <= end; i++) {
      _addSelected(ids[i]);
    }
    _updateSelectionUI();
  }

  function _updateSelectionUI() {
    document.querySelectorAll('#noteList .note-item').forEach(function (el) {
      el.classList.toggle('is-selected', _isSelected(el.dataset.id));
    });
    _updateBulkToolbar();
  }

  function _updateBulkToolbar() {
    var toolbar = document.getElementById('bulkToolbar');
    var countEl = document.getElementById('bulkCount');
    if (!toolbar) return;
    if (_selectedNoteIds.length >= 1) {
      toolbar.style.display = '';
      if (countEl) countEl.textContent = _selectedNoteIds.length;
    } else {
      toolbar.style.display = 'none';
    }
  }

  // ── Note item rendering helper ──

  function _renderNoteItem(n, currentId) {
    var el = document.createElement('div');
    el.className = 'note-item'
      + (n.id === currentId ? ' is-active' : '')
      + (_isSelected(n.id) ? ' is-selected' : '');
    el.dataset.id = n.id;
    el.draggable = true;

    var preview = KnittingNote.getPreview(n) || '';

    el.innerHTML =
      '<div class="note-item__head">' +
        '<span class="note-item__title">' + esc(n.title || '제목 없음') + '</span>' +
        '<button type="button" class="note-item__del" data-del="' + esc(n.id) + '" title="삭제">&#10005;</button>' +
      '</div>' +
      '<div class="note-item__preview">' + esc(preview ? preview.substring(0, 80) : '') + '</div>';

    el.addEventListener('click', function (e) {
      var delBtn = e.target.closest('button[data-del]');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        var toDelete = delBtn.getAttribute('data-del');
        if (toDelete) {
          KnittingDialog.confirm({ message: '이 노트를 삭제할까요?', confirmLabel: '삭제', danger: true }, function () {
            NoteEditor.deleteNote(toDelete);
          });
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      // Ctrl/Cmd+Click → 다중 선택 토글
      if (e.ctrlKey || e.metaKey) {
        _toggleSelected(n.id);
        _lastClickedNoteId = n.id;
        return;
      }

      // Shift+Click → 범위 선택
      if (e.shiftKey && _lastClickedNoteId) {
        _selectRange(_lastClickedNoteId, n.id);
        return;
      }

      // 일반 클릭 → 선택 해제 + 기존 동작
      if (_selectedNoteIds.length > 0) _clearSelection();
      _lastClickedNoteId = n.id;
      NoteEditor.save();
      var note = KnittingNote.getById(n.id);
      if (note) {
        NoteEditor.loadNote(n.id);
        _showEditor();
      }
      if (typeof BasketPanel !== 'undefined') {
        BasketPanel.setScope([n.id]);
        // loadNote 후 DOM 안정화 대기 후 하이라이트
        setTimeout(function () {
          BasketPanel.refreshHighlights(n.id);
        }, 80);
      }
    });

    // Drag: move note(s) between bookshelves
    el.addEventListener('dragstart', function (e) {
      if (_isSelected(n.id) && _selectedNoteIds.length > 1) {
        e.dataTransfer.setData('text/plain', JSON.stringify(_selectedNoteIds));
        e.dataTransfer.setData('application/x-multi-note', 'true');
      } else {
        e.dataTransfer.setData('text/plain', n.id);
      }
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', function () {
      el.classList.remove('is-dragging');
      document.querySelectorAll('.is-drag-over').forEach(function (g) {
        g.classList.remove('is-drag-over');
      });
    });

    // Right-click: bulk or single context menu
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (_isSelected(n.id) && _selectedNoteIds.length > 0) {
        _showBulkContextMenu(e);
      } else {
        _showNoteMoveMenu(e, n.id);
      }
    });

    return el;
  }

  // ── Bookshelf scope management ──

  var _activeBookshelfIds = [];

  function _toggleBookshelfScope(bsId) {
    var descendantIds = KnittingBookshelf.getDescendantIds(bsId);
    var idx = _activeBookshelfIds.indexOf(bsId);
    if (idx === -1) {
      // 선택: 자신 + 모든 하위 폴더 추가
      descendantIds.forEach(function (id) {
        if (_activeBookshelfIds.indexOf(id) === -1) _activeBookshelfIds.push(id);
      });
    } else {
      // 해제: 자신 + 모든 하위 폴더 제거
      _activeBookshelfIds = _activeBookshelfIds.filter(function (id) {
        return descendantIds.indexOf(id) === -1;
      });
    }
    _applyScopeChange();
  }

  function _clearScope() {
    _activeBookshelfIds = [];
    _applyScopeChange();
  }

  function _getScopedNotes() {
    var all = KnittingNote.getAll();
    if (!_activeBookshelfIds.length) return all;
    return all.filter(function (n) {
      return n.bookshelfId && _activeBookshelfIds.indexOf(n.bookshelfId) !== -1;
    });
  }

  function _getScopedNoteIds() {
    return _getScopedNotes().map(function (n) { return n.id; });
  }

  function _applyScopeChange() {
    _clearSelection();
    renderNoteList();
    _renderScopeIndicator();
    if (typeof BasketPanel !== 'undefined') {
      if (_activeBookshelfIds.length) {
        BasketPanel.setScope(_getScopedNoteIds());
      } else {
        BasketPanel.setScope(null);
      }
    }
  }

  function _renderScopeIndicator() {
    var indicator = document.getElementById('scopeIndicator');
    var label = document.getElementById('scopeLabel');
    if (!indicator || !label) return;

    if (!_activeBookshelfIds.length) {
      indicator.style.display = 'none';
      return;
    }

    var names = _activeBookshelfIds.map(function (id) {
      var bs = KnittingBookshelf.getById(id);
      return bs ? bs.title : '';
    }).filter(Boolean);

    label.textContent = names.join(' + ');
    indicator.style.display = '';
  }

  // ── Bookshelf group rendering ──

  function _renderBookshelfGroup(bs, grouped, currentId, depth) {
    depth = depth || 0;
    var notes = grouped[bs.id] || [];
    var children = KnittingBookshelf.getChildren(bs.id);
    var isScoped = _activeBookshelfIds.indexOf(bs.id) !== -1;

    // 하위 책장 포함 전체 노트 수
    var allIds = KnittingBookshelf.getDescendantIds(bs.id);
    var totalCount = 0;
    allIds.forEach(function (did) { totalCount += (grouped[did] || []).length; });

    var group = document.createElement('div');
    group.className = 'bookshelf-group' +
      (bs.collapsed ? ' is-collapsed' : '') +
      (isScoped ? ' is-scoped' : '') +
      (depth > 0 ? ' bookshelf-group--sub' : '');
    group.dataset.bsId = bs.id;

    var header = document.createElement('div');
    header.className = 'bookshelf-group__header';
    header.innerHTML =
      '<span class="bookshelf-group__chevron">&#9654;</span>' +
      '<span class="bookshelf-group__title">' + esc(bs.title) + '</span>' +
      '<span class="bookshelf-group__count">' + totalCount + '</span>';

    header.addEventListener('click', function () {
      // 단일 클릭 → 접기/펼치기
      KnittingBookshelf.toggleCollapsed(bs.id);
      group.classList.toggle('is-collapsed');
    });

    header.addEventListener('dblclick', function (e) {
      e.preventDefault();
      // 더블클릭 → 스코프 토글
      _toggleBookshelfScope(bs.id);
    });

    header.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      _showBookshelfContextMenu(e, bs.id);
    });

    // Drop zone — only header responds to prevent nested conflicts
    header.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      header.classList.add('is-drag-over');
    });
    header.addEventListener('dragleave', function () {
      header.classList.remove('is-drag-over');
    });
    header.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove('is-drag-over');
      var isMulti = e.dataTransfer.getData('application/x-multi-note');
      var raw = e.dataTransfer.getData('text/plain');
      if (isMulti && raw) {
        var ids = JSON.parse(raw);
        ids.forEach(function (id) { KnittingNote.update(id, { bookshelfId: bs.id }); });
        _clearSelection();
      } else if (raw) {
        KnittingNote.update(raw, { bookshelfId: bs.id });
      }
      renderNoteList();
    });

    group.appendChild(header);

    var body = document.createElement('div');
    body.className = 'bookshelf-group__notes';
    notes.forEach(function (n) {
      body.appendChild(_renderNoteItem(n, currentId));
    });

    // 하위 폴더 재귀 렌더링
    children.forEach(function (child) {
      body.appendChild(_renderBookshelfGroup(child, grouped, currentId, depth + 1));
    });

    group.appendChild(body);

    return group;
  }

  // ── Note list rendering (tree structure) ──

  function renderNoteList() {
    var list = document.getElementById('noteList');
    var countEl = document.getElementById('noteCount');
    if (!list) return;

    var notes = KnittingNote.getAll();
    var bookshelves = KnittingBookshelf.getAll();
    if (countEl) countEl.textContent = notes.length;
    list.innerHTML = '';

    if (!notes.length && !bookshelves.length) {
      list.innerHTML = '<div class="note-list__empty">노트가 없습니다.<br>새 노트를 만들어보세요.</div>';
      return;
    }

    var currentId = NoteEditor.getCurrentNoteId();

    // Group notes by bookshelfId
    var grouped = {};
    var uncategorized = [];
    notes.forEach(function (n) {
      if (n.bookshelfId) {
        if (!grouped[n.bookshelfId]) grouped[n.bookshelfId] = [];
        grouped[n.bookshelfId].push(n);
      } else {
        uncategorized.push(n);
      }
    });

    // Render root bookshelves (하위 폴더는 재귀적으로)
    var roots = KnittingBookshelf.getRoots();
    roots.forEach(function (bs) {
      list.appendChild(_renderBookshelfGroup(bs, grouped, currentId, 0));
    });

    // Render uncategorized notes
    if (uncategorized.length || bookshelves.length) {
      if (bookshelves.length) {
        var uncatHeader = document.createElement('div');
        uncatHeader.className = 'bookshelf-group__header bookshelf-group__header--uncat';
        uncatHeader.innerHTML =
          '<span class="bookshelf-group__title">미분류</span>' +
          '<span class="bookshelf-group__count">' + uncategorized.length + '</span>';

        // Drop to uncategorize
        uncatHeader.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          uncatHeader.classList.add('is-drag-over');
        });
        uncatHeader.addEventListener('dragleave', function () {
          uncatHeader.classList.remove('is-drag-over');
        });
        uncatHeader.addEventListener('drop', function (e) {
          e.preventDefault();
          uncatHeader.classList.remove('is-drag-over');
          var isMulti = e.dataTransfer.getData('application/x-multi-note');
          var raw = e.dataTransfer.getData('text/plain');
          if (isMulti && raw) {
            var ids = JSON.parse(raw);
            ids.forEach(function (id) { KnittingNote.update(id, { bookshelfId: null }); });
            _clearSelection();
          } else if (raw) {
            KnittingNote.update(raw, { bookshelfId: null });
          }
          renderNoteList();
        });

        list.appendChild(uncatHeader);
      }

      uncategorized.forEach(function (n) {
        list.appendChild(_renderNoteItem(n, currentId));
      });
    }
  }

  // ── Bookshelf CRUD UI ──

  var _editingBookshelfId = null;
  var _newBookshelfParentId = null;

  function _showBookshelfDialog(editId, parentId) {
    var dialog = document.getElementById('bookshelfDialog');
    var input = document.getElementById('bookshelfNameInput');
    var title = document.getElementById('bookshelfDialogTitle');
    if (!dialog || !input) return;

    _editingBookshelfId = editId || null;
    _newBookshelfParentId = parentId || null;

    if (editId) {
      var bs = KnittingBookshelf.getById(editId);
      title.textContent = '이름 변경';
      input.value = bs ? bs.title : '';
    } else if (parentId) {
      var parentBs = KnittingBookshelf.getById(parentId);
      title.textContent = (parentBs ? parentBs.title : '') + ' — 하위 폴더';
      input.value = '';
    } else {
      title.textContent = '새 책장';
      input.value = '';
    }

    dialog.classList.add('is-open');
    setTimeout(function () { input.focus(); }, 50);
  }

  function _saveBookshelf() {
    var dialog = document.getElementById('bookshelfDialog');
    var input = document.getElementById('bookshelfNameInput');
    if (!input) return;

    var name = input.value.trim();
    if (!name) return;

    if (_editingBookshelfId) {
      KnittingBookshelf.update(_editingBookshelfId, { title: name });
    } else {
      KnittingBookshelf.create(name, _newBookshelfParentId);
    }

    dialog.classList.remove('is-open');
    _editingBookshelfId = null;
    _newBookshelfParentId = null;
    renderNoteList();
  }

  function _deleteBookshelf(id) {
    var bs = KnittingBookshelf.getById(id);
    if (!bs) return;
    KnittingDialog.confirm({
      title: '책장 삭제',
      message: '"' + bs.title + '" 책장을 삭제할까요?\n안의 노트는 미분류로 이동됩니다.',
      confirmLabel: '삭제',
      danger: true
    }, function () {
      KnittingNote.getAll().forEach(function (n) {
        if (n.bookshelfId === id) {
          KnittingNote.update(n.id, { bookshelfId: null });
        }
      });
      KnittingBookshelf.remove(id);
      renderNoteList();
    });
  }

  // ── Context menus ──

  function _hideAllContextMenus() {
    document.querySelectorAll('.context-menu.is-visible').forEach(function (m) {
      m.classList.remove('is-visible');
    });
  }

  var _contextBookshelfId = null;

  function _showBookshelfContextMenu(e, bsId) {
    _hideAllContextMenus();
    _contextBookshelfId = bsId;
    var menu = document.getElementById('bookshelfContextMenu');
    if (!menu) return;
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('is-visible');
  }

  function _showBulkContextMenu(e) {
    _hideAllContextMenus();
    var menu = document.getElementById('bulkContextMenu');
    var label = document.getElementById('bulkMenuLabel');
    if (!menu) return;
    if (label) label.textContent = _selectedNoteIds.length + '개 노트 선택됨';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('is-visible');
  }

  var _contextNoteId = null;

  function _showNoteMoveMenu(e, noteId) {
    _hideAllContextMenus();
    _contextNoteId = noteId;
    var menu = document.getElementById('noteMoveContextMenu');
    var listEl = document.getElementById('noteMoveList');
    if (!menu || !listEl) return;

    // Build hierarchical bookshelf options
    listEl.innerHTML = '';
    var allBs = KnittingBookshelf.getAll();

    function appendBsItems(parentId, depth) {
      var children = parentId
        ? KnittingBookshelf.getChildren(parentId)
        : KnittingBookshelf.getRoots();
      children.forEach(function (bs) {
        var item = document.createElement('div');
        item.className = 'context-menu__item';
        item.dataset.action = 'move';
        item.dataset.bsId = bs.id;
        var indent = depth > 0 ? '<span style="display:inline-block;width:' + (depth * 12) + 'px"></span>' : '';
        item.innerHTML = indent + '<span class="context-menu__icon">&#9654;</span> ' + esc(bs.title);
        listEl.appendChild(item);
        appendBsItems(bs.id, depth + 1);
      });
    }
    appendBsItems(null, 0);

    if (!allBs.length) {
      var empty = document.createElement('div');
      empty.className = 'context-menu__item';
      empty.style.pointerEvents = 'none';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = '책장이 없습니다';
      listEl.appendChild(empty);
    }

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('is-visible');
  }

  function _setupBookshelfContextMenus() {
    // Bookshelf context menu
    var bsMenu = document.getElementById('bookshelfContextMenu');
    if (bsMenu) {
      bsMenu.addEventListener('click', function (e) {
        var item = e.target.closest('.context-menu__item');
        if (!item || !_contextBookshelfId) return;
        var action = item.dataset.action;
        if (action === 'subfolder') {
          _showBookshelfDialog(null, _contextBookshelfId);
        } else if (action === 'rename') {
          _showBookshelfDialog(_contextBookshelfId);
        } else if (action === 'delete') {
          _deleteBookshelf(_contextBookshelfId);
        }
        _hideAllContextMenus();
      });
    }

    // Note move context menu
    var moveMenu = document.getElementById('noteMoveContextMenu');
    if (moveMenu) {
      moveMenu.addEventListener('click', function (e) {
        var item = e.target.closest('.context-menu__item');
        if (!item) return;
        var action = item.dataset.action;

        if (_contextBulkMode && _selectedNoteIds.length > 0) {
          var targetBsId = (action === 'move') ? item.dataset.bsId : null;
          if (action === 'move' || action === 'uncategorize') {
            _selectedNoteIds.forEach(function (id) {
              KnittingNote.update(id, { bookshelfId: targetBsId || null });
            });
            _clearSelection();
            renderNoteList();
          }
          _contextBulkMode = false;
        } else if (_contextNoteId) {
          if (action === 'move' && item.dataset.bsId) {
            KnittingNote.update(_contextNoteId, { bookshelfId: item.dataset.bsId });
            renderNoteList();
          } else if (action === 'uncategorize') {
            KnittingNote.update(_contextNoteId, { bookshelfId: null });
            renderNoteList();
          }
        }
        _hideAllContextMenus();
      });
    }

    // Close context menus on click outside
    document.addEventListener('click', function () {
      _hideAllContextMenus();
    });
  }

  // ── Bulk actions ──

  function _setupBulkActions() {
    // Bulk delete
    var bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', function () {
        var count = _selectedNoteIds.length;
        if (!count) return;
        KnittingDialog.confirm({
          title: '노트 삭제',
          message: count + '개의 노트를 삭제할까요?',
          confirmLabel: '삭제',
          danger: true
        }, function () {
          var currentId = NoteEditor.getCurrentNoteId();
          var needClear = false;
          _selectedNoteIds.forEach(function (id) {
            KnittingNote.remove(id);
            if (id === currentId) needClear = true;
          });
          if (needClear) NoteEditor.clearEditor();
          _selectedNoteIds = [];
          _updateBulkToolbar();
          renderNoteList();
        });
      });
    }

    // Bulk move
    var bulkMoveBtn = document.getElementById('bulkMoveBtn');
    if (bulkMoveBtn) {
      bulkMoveBtn.addEventListener('click', function (e) {
        if (!_selectedNoteIds.length) return;
        _contextBulkMode = true;
        _showNoteMoveMenu(e, null);
      });
    }

    // Bulk cancel
    var bulkCancelBtn = document.getElementById('bulkCancelBtn');
    if (bulkCancelBtn) {
      bulkCancelBtn.addEventListener('click', _clearSelection);
    }

    // Bulk context menu
    var bulkMenu = document.getElementById('bulkContextMenu');
    if (bulkMenu) {
      bulkMenu.addEventListener('click', function (e) {
        var item = e.target.closest('.context-menu__item');
        if (!item) return;
        var action = item.dataset.action;
        if (action === 'bulk-move') {
          _contextBulkMode = true;
          _showNoteMoveMenu(e, null);
          return;
        } else if (action === 'bulk-delete') {
          var delBtn = document.getElementById('bulkDeleteBtn');
          if (delBtn) delBtn.click();
        }
        _hideAllContextMenus();
      });
    }
  }

  // ── Sidebar collapse / expand ──

  var NOTES_DEFAULT = 240;
  var PANEL_DEFAULT = 300;
  var MIN_WIDTH = 160;
  var MAX_WIDTH = 480;

  function setupSidebarToggles() {
    var app = document.querySelector('.app');
    var notesSidebar = document.getElementById('notesSidebar');
    var notesToggle = document.getElementById('notesToggle');
    var notesExpand = document.getElementById('notesExpand');
    var rightPanel = document.getElementById('rightPanel');
    var panelToggle = document.getElementById('panelToggle');
    var panelExpand = document.getElementById('panelExpand');

    function updateAppClasses() {
      if (!app) return;
      app.classList.toggle('has-notes-collapsed', notesSidebar && notesSidebar.classList.contains('is-collapsed'));
      app.classList.toggle('has-panel-collapsed', rightPanel && rightPanel.classList.contains('is-collapsed'));
    }

    if (notesToggle && notesSidebar) {
      notesToggle.addEventListener('click', function () {
        notesSidebar.classList.add('is-collapsed');
        updateAppClasses();
      });
    }
    if (notesExpand && notesSidebar) {
      notesExpand.addEventListener('click', function () {
        notesSidebar.classList.remove('is-collapsed');
        updateAppClasses();
      });
    }
    if (panelToggle && rightPanel) {
      panelToggle.addEventListener('click', function () {
        rightPanel.classList.add('is-collapsed');
        updateAppClasses();
      });
    }
    if (panelExpand && rightPanel) {
      panelExpand.addEventListener('click', function () {
        rightPanel.classList.remove('is-collapsed');
        updateAppClasses();
      });
    }

    setupResizeHandles();
    setupEditorResize();
  }

  function setupEditorResize() {
    var editorBody = document.getElementById('editorBody');
    var leftHandle = document.getElementById('editorResizeLeft');
    var rightHandle = document.getElementById('editorResizeRight');
    var EDITOR_DEFAULT = 720;
    var EDITOR_MIN = 320;
    var EDITOR_MAX = 1200;

    function getWidth() {
      return parseInt(editorBody.style.width, 10) || EDITOR_DEFAULT;
    }
    function setWidth(w) {
      var w2 = Math.max(EDITOR_MIN, Math.min(EDITOR_MAX, w));
      editorBody.style.width = w2 + 'px';
    }
    function dragHandle(handle, sign) {
      if (!handle || !editorBody) return;
      handle.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        handle.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        var startX = e.clientX;
        var startW = getWidth();
        function onMove(e) {
          var dx = sign * (e.clientX - startX);
          var newW = Math.max(EDITOR_MIN, Math.min(EDITOR_MAX, startW + dx));
          setWidth(newW);
          startX = e.clientX;
          startW = newW;
        }
        function onUp() {
          handle.classList.remove('is-dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
    dragHandle(leftHandle, -1);
    dragHandle(rightHandle, 1);
  }

  function setupResizeHandles() {
    var notesSidebar = document.getElementById('notesSidebar');
    var rightPanel = document.getElementById('rightPanel');
    var notesResize = document.getElementById('notesResizeHandle');
    var panelResize = document.getElementById('panelResizeHandle');

    function dragResize(handle, setWidth, getWidth, invertDx, getMaxWidth) {
      if (!handle) return;
      handle.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        handle.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        var startX = e.clientX;
        var startW = getWidth();

        function onMove(e) {
          var dx = e.clientX - startX;
          if (invertDx) dx = -dx;
          var maxW = (getMaxWidth && getMaxWidth()) || MAX_WIDTH;
          var newW = Math.max(MIN_WIDTH, Math.min(maxW, startW + dx));
          setWidth(newW);
          startX = e.clientX;
          startW = newW;
        }

        function onUp() {
          handle.classList.remove('is-dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    if (notesResize && notesSidebar) {
      dragResize(notesResize,
        function (w) { notesSidebar.style.width = w + 'px'; notesSidebar.style.minWidth = w + 'px'; },
        function () { return parseInt(notesSidebar.style.width, 10) || NOTES_DEFAULT; },
        false,
        function () {
          return rightPanel && rightPanel.classList.contains('is-collapsed')
            ? Math.floor(window.innerWidth * 0.5) : MAX_WIDTH;
        }
      );
    }
    if (panelResize && rightPanel) {
      dragResize(panelResize,
        function (w) { rightPanel.style.width = w + 'px'; rightPanel.style.minWidth = w + 'px'; },
        function () { return parseInt(rightPanel.style.width, 10) || PANEL_DEFAULT; },
        true,
        function () {
          return notesSidebar && notesSidebar.classList.contains('is-collapsed')
            ? Math.floor(window.innerWidth * 0.5) : MAX_WIDTH;
        }
      );
    }
  }

  // ── Panel tabs (메모 / 뜨개질) ──

  function setupPanelTabs() {
    var tabs = document.querySelectorAll('.panel-tabs__btn');
    var panels = document.querySelectorAll('.panel-content');

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.dataset.panel;
        tabs.forEach(function (t) { t.classList.toggle('is-active', t === tab); });
        panels.forEach(function (p) { p.classList.toggle('is-active', p.id === 'panel' + target.charAt(0).toUpperCase() + target.slice(1)); });
      });
    });
  }

  // ── Editor / Thread View toggle ──

  function _showEditor() {
    document.getElementById('editorToolbar').style.display = '';
    var type = NoteEditor.getCurrentType();
    document.getElementById('blankNote').classList.toggle('is-active', type === 'blank');
    document.getElementById('templateNote').classList.toggle('is-active', type === 'template');
  }

  // ── Init ──

  function init() {
    KnittingNote.init();
    KnittingBookshelf.init();

    // 올 바구니 + 뜨개판: 서버 가용 시에만 초기화
    if (typeof FiberAPI !== 'undefined' && typeof BasketPanel !== 'undefined') {
      BasketPanel.init();
      if (typeof GraphPanel !== 'undefined') GraphPanel.init();

      FiberAPI.isAvailable().then(function (ok) {
        if (ok) {
          BasketPanel.refresh();
          if (typeof GraphPanel !== 'undefined') GraphPanel.refresh();
        } else {
          var tabBasket = document.getElementById('tabBasket');
          if (tabBasket) tabBasket.style.display = 'none';
          var tabGraph = document.getElementById('tabGraph');
          if (tabGraph) tabGraph.style.display = 'none';
        }
      }).catch(function () {
        var tabBasket = document.getElementById('tabBasket');
        if (tabBasket) tabBasket.style.display = 'none';
        var tabGraph = document.getElementById('tabGraph');
        if (tabGraph) tabGraph.style.display = 'none';
      });
    }

    var notes = KnittingNote.getAll();

    NoteEditor.init({
      onNoteChanged: function () {
        renderNoteList();
        if (typeof BasketPanel !== 'undefined') {
          var noteId = NoteEditor.getCurrentNoteId();
          // DOM 업데이트 후 하이라이트 적용 (contenteditable 렌더링 대기)
          setTimeout(function () {
            BasketPanel.refreshHighlights(noteId);
          }, 50);
        }
      }
    });

    // 새 노트 생성 시 활성 스코프의 책장에 배정
    var newNoteBtn = document.getElementById('newNoteBtn');
    if (newNoteBtn) {
      newNoteBtn.addEventListener('mousedown', function () {
        var targetBsId = _activeBookshelfIds.length === 1 ? _activeBookshelfIds[0] : null;
        NoteEditor.setTargetBookshelf(targetBsId);
      });
    }

    // Bookshelf UI
    var newBsBtn = document.getElementById('newBookshelfBtn');
    if (newBsBtn) newBsBtn.addEventListener('click', function () { _showBookshelfDialog(null); });

    var bsSaveBtn = document.getElementById('bookshelfDialogSave');
    if (bsSaveBtn) bsSaveBtn.addEventListener('click', _saveBookshelf);

    var bsCancelBtn = document.getElementById('bookshelfDialogCancel');
    if (bsCancelBtn) bsCancelBtn.addEventListener('click', function () {
      document.getElementById('bookshelfDialog').classList.remove('is-open');
    });

    var bsNameInput = document.getElementById('bookshelfNameInput');
    if (bsNameInput) bsNameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _saveBookshelf(); }
    });

    _setupBookshelfContextMenus();
    _setupBulkActions();

    // Scope indicator clear button
    var scopeClearBtn = document.getElementById('scopeClear');
    if (scopeClearBtn) scopeClearBtn.addEventListener('click', _clearScope);

    setupPanelTabs();
    setupSidebarToggles();

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (_selectedNoteIds.length > 0) { _clearSelection(); return; }
        _hideAllContextMenus();
        document.querySelectorAll('.dialog-overlay.is-open').forEach(function (d) {
          d.classList.remove('is-open');
        });
        _editingBookshelfId = null;
      }
    });

    // 노트 목록 빈 영역 클릭 시 선택 해제
    var noteListEl = document.getElementById('noteList');
    if (noteListEl) {
      noteListEl.addEventListener('click', function (e) {
        if (!e.target.closest('.note-item') && !e.target.closest('.bookshelf-group__header')) {
          _clearSelection();
        }
      });
    }

    renderNoteList();

    // 서버에서 노트 로드 완료 시 목록 다시 렌더링
    window.addEventListener('knitting:notes-loaded', function () {
      renderNoteList();
    });
  }

  // ── Public: navigate to a specific note (used by BasketPanel) ──
  window.AppNavigate = {
    toNote: function (noteId) {
      NoteEditor.save();
      var note = KnittingNote.getById(noteId);
      if (!note) return false;
      NoteEditor.loadNote(noteId);
      _showEditor();
      renderNoteList();
      if (typeof BasketPanel !== 'undefined') {
        BasketPanel.setScope([noteId]);
        setTimeout(function () {
          BasketPanel.refreshHighlights(noteId);
        }, 80);
      }
      return true;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
