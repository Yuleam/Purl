/**
 * Knitting UI — Note Editor
 * 노트 작성/편집, 빈 노트+템플릿 노트, 마크다운 지원
 * 의존: KnittingNote, KnittingStorage
 */
var NoteEditor = (function () {
  'use strict';

  var currentNoteId = null;
  var currentType = 'blank';
  var onNoteChanged = null;
  var _pendingBookshelfId = null;

  var $blankNote, $templateNote, $blankTitle, $blankContent;
  var $templateTitle, $templateForm, $saveBtn, $newBtn;
  var $typeBtns;

  function init(opts) {
    onNoteChanged = opts.onNoteChanged || null;

    $blankNote = document.getElementById('blankNote');
    $templateNote = document.getElementById('templateNote');
    $blankTitle = document.getElementById('blankTitle');
    $blankContent = document.getElementById('blankContent');
    $templateTitle = document.getElementById('templateTitle');
    $templateForm = document.getElementById('templateForm');
    $saveBtn = document.getElementById('saveNoteBtn');
    $newBtn = document.getElementById('newNoteBtn');

    var typeSwitch = document.getElementById('noteTypeSwitch');
    $typeBtns = typeSwitch ? typeSwitch.querySelectorAll('[data-type]') : [];

    $typeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchType(btn.getAttribute('data-type'));
      });
    });

    if ($newBtn) $newBtn.addEventListener('click', function () { save(); clearEditor(); $blankTitle.focus(); });
    if ($saveBtn) $saveBtn.addEventListener('click', function () { save(); });

    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's') { e.preventDefault(); save(); return; }

      // 에디터 포커스 중일 때만 포매팅 단축키 동작
      if (!$blankContent || !$blankContent.contains(document.activeElement) &&
          document.activeElement !== $blankContent) return;

      // Undo/Redo
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); _undo(); return;
      }
      if (mod && (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); _redo(); return;
      }

      if (mod && e.key === 'b') {
        e.preventDefault(); document.execCommand('bold'); return;
      }
      if (mod && e.key === 'i') {
        e.preventDefault(); document.execCommand('italic'); return;
      }
      if (mod && e.key === 'u') {
        e.preventDefault(); document.execCommand('underline'); return;
      }
      if (mod && e.shiftKey && e.key === 'S') {
        e.preventDefault(); document.execCommand('strikeThrough'); return;
      }
      if (mod && e.key === 'k') {
        e.preventDefault();
        var url = prompt('URL을 입력하세요:');
        if (url) document.execCommand('createLink', false, url);
        return;
      }
      if (e.key === 'Tab' && !mod) {
        e.preventDefault();
        if (e.shiftKey) document.execCommand('outdent');
        else document.execCommand('indent');
        return;
      }
    });

    if ($blankContent) {
      $blankContent.addEventListener('paste', function (e) {
        var clipboard = e.clipboardData || window.clipboardData;
        if (!clipboard) return;

        // 이미지 붙여넣기
        var items = clipboard.items;
        if (items) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image/') === 0) {
              e.preventDefault();
              var file = items[i].getAsFile();
              if (!file) return;
              // 1MB 초과 경고
              if (file.size > 1024 * 1024) {
                KnittingDialog.alert('이미지 크기 주의', '1MB를 초과하는 이미지입니다. 저장 용량에 영향을 줄 수 있습니다.');
              }
              var reader = new FileReader();
              reader.onload = function (ev) {
                document.execCommand('insertHTML', false,
                  '<img src="' + ev.target.result + '" alt="붙여넣기 이미지">');
              };
              reader.readAsDataURL(file);
              return;
            }
          }
        }

        // 마크다운 붙여넣기
        var plain = clipboard.getData('text/plain');
        if (!plain || !_looksLikeMd(plain)) return;
        e.preventDefault();
        var html = _mdToHtml(plain);
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          var range = sel.getRangeAt(0);
          range.deleteContents();
          var frag = range.createContextualFragment(html);
          range.insertNode(frag);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }

    _setupInputRules();
    _setupFormatToolbar();
    _setupAutoSave();
    _setupCharCount();
    _setupUndoRedo();
    _setupFindReplace();
    _setupContextualHints();
  }

  function switchType(type) {
    currentType = type;
    $typeBtns.forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-type') === type); });
    if ($blankNote) $blankNote.classList.toggle('is-active', type === 'blank');
    if ($templateNote) $templateNote.classList.toggle('is-active', type === 'template');
  }

  function getEditorData() {
    var data;
    if (currentType === 'blank') {
      data = {
        type: 'blank',
        title: $blankTitle.value.trim(),
        content: ($blankContent.innerText || '').trim(),
        htmlContent: $blankContent.innerHTML
      };
    } else {
      var answers = {};
      if ($templateForm) {
        $templateForm.querySelectorAll('[data-question]').forEach(function (inp) {
          answers['q' + inp.getAttribute('data-question')] = inp.value.trim();
        });
      }
      data = { type: 'template', title: $templateTitle.value.trim(), answers: answers };
    }
    // 새 노트 생성 시 대상 책장 포함
    if (!currentNoteId && _pendingBookshelfId) {
      data.bookshelfId = _pendingBookshelfId;
    }
    return data;
  }

  function setEditorData(note) {
    if (!note) return;
    switchType(note.type || 'blank');
    if (note.type === 'blank') {
      $blankTitle.value = note.title || '';
      if (note.htmlContent) $blankContent.innerHTML = note.htmlContent;
      else $blankContent.textContent = note.content || '';
      _rehydrateChecklists();
      _updateCharCount();
      _resetUndoHistory();
    } else {
      $templateTitle.value = note.title || '';
      if ($templateForm) {
        $templateForm.querySelectorAll('[data-question]').forEach(function (inp) {
          var key = 'q' + inp.getAttribute('data-question');
          inp.value = note.answers && note.answers[key] ? note.answers[key] : '';
        });
      }
    }
  }

  function clearEditor() {
    currentNoteId = null;
    $blankTitle.value = '';
    $blankContent.innerHTML = '';
    if ($templateTitle) $templateTitle.value = '';
    if ($templateForm) {
      $templateForm.querySelectorAll('[data-question]').forEach(function (inp) { inp.value = ''; });
    }
    switchType('blank');
    _updateCharCount();
    _resetUndoHistory();
  }

  function setTargetBookshelf(bsId) {
    _pendingBookshelfId = bsId || null;
  }

  function save() {
    var data = getEditorData();
    var wasNew = !currentNoteId;
    var note = KnittingNote.save(currentNoteId, data);
    if (note) {
      currentNoteId = note.id;
      if (wasNew) _pendingBookshelfId = null;
      _showSaveConfirm();
      if (onNoteChanged) onNoteChanged();
    }
  }

  function loadNote(id) {
    var note = KnittingNote.getById(id);
    if (!note) return;
    currentNoteId = id;
    setEditorData(note);
    if (onNoteChanged) onNoteChanged();
  }

  function deleteNote(id) {
    KnittingNote.remove(id);
    if (currentNoteId === id) clearEditor();
    if (onNoteChanged) onNoteChanged();
  }

  function getCurrentNoteId() { return currentNoteId; }
  function getCurrentType() { return currentType; }
  function getContentElement() { return $blankContent; }

  function getCurrentSnapshot() {
    var data = getEditorData();
    return {
      noteId: currentNoteId,
      noteTitle: data.title || '',
      noteContent: currentType === 'blank'
        ? ($blankContent.innerText || '').trim()
        : Object.values(data.answers || {}).filter(Boolean).join('\n\n')
    };
  }

  function _showSaveConfirm() {
    if (!$saveBtn) return;
    $saveBtn.classList.add('is-saved');
    var span = $saveBtn.querySelector('span');
    if (span) { var t = span.textContent; span.textContent = '저장됨'; }
    setTimeout(function () {
      $saveBtn.classList.remove('is-saved');
      if (span) span.textContent = '저장';
    }, 1200);
  }

  // ── Feature Discovery ──

  function _getDiscovered() {
    try { return JSON.parse(localStorage.getItem('knitting_discovered_features') || '{}'); }
    catch (e) { return {}; }
  }

  function _markDiscovered(featureKey) {
    var d = _getDiscovered();
    if (d[featureKey]) return;
    d[featureKey] = true;
    localStorage.setItem('knitting_discovered_features', JSON.stringify(d));
  }

  function _isDiscovered(featureKey) {
    return !!_getDiscovered()[featureKey];
  }

  // ── Contextual Hints ──

  var $hintEl = null;
  var $hintText = null;
  var _hintTimer = null;
  var _hintAutoHideTimer = null;
  var _hintCurrentKey = null;
  var _selectionTimer = null;

  var HINT_RULES = [
    {
      key: 'heading',
      test: function (text) {
        var lines = text.split('\n').filter(Boolean);
        return lines.length >= 3 && lines[0].length <= 20 && lines[0].length > 0;
      },
      message: '# 을 입력하면 제목이 돼요'
    },
    {
      key: 'list',
      test: function (text) {
        var lines = text.split('\n').filter(Boolean);
        if (lines.length < 3) return false;
        var similar = 0;
        for (var i = 1; i < lines.length; i++) {
          if (lines[i].length > 0 && Math.abs(lines[i].length - lines[i - 1].length) < 15) similar++;
        }
        return similar >= 2;
      },
      message: '- 를 입력하면 목록이 돼요'
    },
    {
      key: 'checklist',
      test: function (text) {
        return /할\s?일|해야|TODO|확인|체크/i.test(text);
      },
      message: '[ ] 를 입력하면 체크리스트가 돼요'
    },
    {
      key: 'tone-question',
      test: function (text) {
        return /\?\s*$/.test(text.trim());
      },
      message: '이 물음을 올로 잡아보세요 — 선택 후 우클릭'
    },
    {
      key: 'tone-friction',
      test: function (text) {
        return /(?:^|\n)\s*(?:그런데|하지만|아닌데|반대로|오히려)/.test(text);
      },
      message: '반대 생각도 올로 잡을 수 있어요'
    },
    {
      key: 'find',
      test: function (text) {
        return text.length > 300;
      },
      message: 'Ctrl+F로 노트 안에서 검색할 수 있어요'
    }
  ];

  function _setupContextualHints() {
    $hintEl = document.getElementById('editorHint');
    $hintText = document.getElementById('hintText');
    var $hintClose = document.getElementById('hintClose');
    if (!$hintEl || !$hintText || !$blankContent) return;

    $hintClose.addEventListener('click', function () {
      if (_hintCurrentKey) _markDiscovered(_hintCurrentKey);
      _hideHint();
    });

    // 에디터 입력 시 debounce 2초 후 평가
    $blankContent.addEventListener('input', function () {
      _hideHint();
      if (_hintTimer) clearTimeout(_hintTimer);
      _hintTimer = setTimeout(_evaluateHints, 2000);
    });

    // 텍스트 선택 3초 유지 → format-toolbar 힌트
    $blankContent.addEventListener('mouseup', function () {
      if (_selectionTimer) clearTimeout(_selectionTimer);
      _selectionTimer = setTimeout(function () {
        var sel = window.getSelection();
        if (sel && !sel.isCollapsed && !_isDiscovered('format-toolbar')) {
          _showHint('선택한 텍스트에 서식을 바꿀 수 있어요', 'format-toolbar');
        }
      }, 3000);
    });

    $blankContent.addEventListener('mousedown', function () {
      if (_selectionTimer) clearTimeout(_selectionTimer);
    });
  }

  function _evaluateHints() {
    if (!$blankContent) return;
    var text = ($blankContent.innerText || '').trim();
    if (!text) return;

    for (var i = 0; i < HINT_RULES.length; i++) {
      var rule = HINT_RULES[i];
      if (_isDiscovered(rule.key)) continue;
      if (rule.test(text)) {
        _showHint(rule.message, rule.key);
        return;
      }
    }
  }

  function _showHint(message, featureKey) {
    if (!$hintEl || !$hintText) return;
    if (_hintAutoHideTimer) clearTimeout(_hintAutoHideTimer);

    _hintCurrentKey = featureKey;
    $hintText.textContent = message;
    $hintEl.classList.remove('is-hiding');
    $hintEl.classList.add('is-visible');

    _hintAutoHideTimer = setTimeout(function () {
      _hideHint();
    }, 5000);
  }

  function _hideHint() {
    if (!$hintEl) return;
    if (_hintAutoHideTimer) clearTimeout(_hintAutoHideTimer);
    if (!$hintEl.classList.contains('is-visible')) return;

    $hintEl.classList.add('is-hiding');
    setTimeout(function () {
      $hintEl.classList.remove('is-visible', 'is-hiding');
    }, 300);
    _hintCurrentKey = null;
  }

  // ── Auto Save ──

  var _autoSaveTimer = null;

  function _setupAutoSave() {
    function scheduleAutoSave() {
      if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
      _autoSaveTimer = setTimeout(function () {
        // 내용이 있을 때만 저장
        var data = getEditorData();
        var hasContent = currentType === 'blank'
          ? (data.title || data.content)
          : (data.title || Object.values(data.answers || {}).some(Boolean));
        if (hasContent) save();
      }, 2000);
    }

    if ($blankContent) $blankContent.addEventListener('input', scheduleAutoSave);
    if ($blankTitle) $blankTitle.addEventListener('input', scheduleAutoSave);
    if ($templateForm) {
      $templateForm.querySelectorAll('textarea').forEach(function (ta) {
        ta.addEventListener('input', scheduleAutoSave);
      });
    }
    if ($templateTitle) $templateTitle.addEventListener('input', scheduleAutoSave);
  }

  // ── Char Count ──

  var $charCount = null;

  function _setupCharCount() {
    $charCount = document.getElementById('charCount');
    if (!$charCount || !$blankContent) return;
    $blankContent.addEventListener('input', _updateCharCount);
  }

  function _updateCharCount() {
    if (!$charCount) return;
    var len = ($blankContent.innerText || '').replace(/\n$/,'').length;
    $charCount.textContent = len + '자';
  }

  // ── Undo / Redo ──

  var _undoStack = [];
  var _redoStack = [];
  var _undoTimer = null;
  var _undoMax = 50;

  function _setupUndoRedo() {
    if (!$blankContent) return;

    // 초기 상태 저장
    _undoStack = [$blankContent.innerHTML];
    _redoStack = [];

    $blankContent.addEventListener('input', function () {
      if (_undoTimer) clearTimeout(_undoTimer);
      _undoTimer = setTimeout(function () {
        _pushUndo($blankContent.innerHTML);
      }, 500);
    });
  }

  function _pushUndo(html) {
    // 마지막과 동일하면 무시
    if (_undoStack.length && _undoStack[_undoStack.length - 1] === html) return;
    _undoStack.push(html);
    if (_undoStack.length > _undoMax) _undoStack.shift();
    _redoStack = [];
  }

  function _undo() {
    if (_undoStack.length <= 1) return;
    _redoStack.push(_undoStack.pop());
    $blankContent.innerHTML = _undoStack[_undoStack.length - 1];
    _rehydrateChecklists();
    _updateCharCount();
  }

  function _redo() {
    if (!_redoStack.length) return;
    var html = _redoStack.pop();
    _undoStack.push(html);
    $blankContent.innerHTML = html;
    _rehydrateChecklists();
    _updateCharCount();
  }

  function _resetUndoHistory() {
    _undoStack = [$blankContent ? $blankContent.innerHTML : ''];
    _redoStack = [];
  }

  // ── Find / Replace ──

  var _findMatches = [];
  var _findCurrent = -1;

  function _setupFindReplace() {
    var $bar = document.getElementById('editorFind');
    var $findInput = document.getElementById('findInput');
    var $replaceInput = document.getElementById('replaceInput');
    var $findCount = document.getElementById('findCount');
    var $findNext = document.getElementById('findNext');
    var $findPrev = document.getElementById('findPrev');
    var $replaceOne = document.getElementById('replaceOne');
    var $replaceAll = document.getElementById('replaceAll');
    var $findClose = document.getElementById('findClose');
    if (!$bar || !$findInput) return;

    function _openFind() {
      _markDiscovered('find');
      $bar.classList.add('is-visible');
      $findInput.focus();
      if ($findInput.value) _doSearch($findInput.value);
    }

    function _closeFind() {
      $bar.classList.remove('is-visible');
      _clearHighlights();
      _findMatches = [];
      _findCurrent = -1;
      if ($findCount) $findCount.textContent = '';
      $blankContent.focus();
    }

    // Ctrl+F 가로채기 — 전역 keydown에 추가
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'f') {
        // 에디터가 활성 상태일 때만
        if ($blankContent && ($blankContent.contains(document.activeElement) ||
            document.activeElement === $blankContent ||
            $bar.contains(document.activeElement))) {
          e.preventDefault();
          _openFind();
        }
      }
      if (e.key === 'Escape' && $bar.classList.contains('is-visible')) {
        _closeFind();
      }
    });

    $findInput.addEventListener('input', function () {
      _doSearch($findInput.value);
    });

    $findInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _goNext(); }
    });

    if ($findNext) $findNext.addEventListener('click', _goNext);
    if ($findPrev) $findPrev.addEventListener('click', _goPrev);
    if ($findClose) $findClose.addEventListener('click', _closeFind);
    if ($replaceOne) $replaceOne.addEventListener('click', function () {
      _replaceCurrent($replaceInput ? $replaceInput.value : '');
    });
    if ($replaceAll) $replaceAll.addEventListener('click', function () {
      _replaceAllMatches($replaceInput ? $replaceInput.value : '');
    });

    function _clearHighlights() {
      if (!$blankContent) return;
      $blankContent.querySelectorAll('.find-highlight').forEach(function (el) {
        var parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      });
    }

    function _doSearch(query) {
      _clearHighlights();
      _findMatches = [];
      _findCurrent = -1;
      if (!query || !$blankContent) {
        if ($findCount) $findCount.textContent = '';
        return;
      }

      var walker = document.createTreeWalker($blankContent, NodeFilter.SHOW_TEXT, null, false);
      var textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      var lowerQ = query.toLowerCase();
      textNodes.forEach(function (tn) {
        var text = tn.textContent;
        var lower = text.toLowerCase();
        var idx = lower.indexOf(lowerQ);
        if (idx === -1) return;

        // 텍스트 노드를 분할하면서 하이라이트 삽입
        var frag = document.createDocumentFragment();
        var pos = 0;
        while (idx !== -1) {
          if (idx > pos) frag.appendChild(document.createTextNode(text.substring(pos, idx)));
          var mark = document.createElement('span');
          mark.className = 'find-highlight';
          mark.textContent = text.substring(idx, idx + query.length);
          frag.appendChild(mark);
          _findMatches.push(mark);
          pos = idx + query.length;
          idx = lower.indexOf(lowerQ, pos);
        }
        if (pos < text.length) frag.appendChild(document.createTextNode(text.substring(pos)));
        tn.parentNode.replaceChild(frag, tn);
      });

      if ($findCount) $findCount.textContent = _findMatches.length + '개';
      if (_findMatches.length) {
        _findCurrent = 0;
        _highlightCurrent();
      }
    }

    function _highlightCurrent() {
      _findMatches.forEach(function (m, i) {
        m.classList.toggle('find-highlight--current', i === _findCurrent);
      });
      if (_findMatches[_findCurrent]) {
        _findMatches[_findCurrent].scrollIntoView({ block: 'center', behavior: 'smooth' });
        if ($findCount) $findCount.textContent = (_findCurrent + 1) + '/' + _findMatches.length;
      }
    }

    function _goNext() {
      if (!_findMatches.length) return;
      _findCurrent = (_findCurrent + 1) % _findMatches.length;
      _highlightCurrent();
    }

    function _goPrev() {
      if (!_findMatches.length) return;
      _findCurrent = (_findCurrent - 1 + _findMatches.length) % _findMatches.length;
      _highlightCurrent();
    }

    function _replaceCurrent(replacement) {
      if (_findCurrent < 0 || !_findMatches[_findCurrent]) return;
      var mark = _findMatches[_findCurrent];
      mark.parentNode.replaceChild(document.createTextNode(replacement), mark);
      $blankContent.normalize();
      _findMatches.splice(_findCurrent, 1);
      if (_findCurrent >= _findMatches.length) _findCurrent = 0;
      if ($findCount) $findCount.textContent = _findMatches.length + '개';
      if (_findMatches.length) _highlightCurrent();
      else if ($findCount) $findCount.textContent = '0개';
    }

    function _replaceAllMatches(replacement) {
      _findMatches.forEach(function (mark) {
        mark.parentNode.replaceChild(document.createTextNode(replacement), mark);
      });
      $blankContent.normalize();
      _findMatches = [];
      _findCurrent = -1;
      if ($findCount) $findCount.textContent = '0개';
    }
  }

  // ── Floating Format Toolbar ──

  var $formatToolbar = null;

  function _setupFormatToolbar() {
    $formatToolbar = document.getElementById('formatToolbar');
    if (!$formatToolbar || !$blankContent) return;

    // 버튼 클릭 시 선택 유지
    $formatToolbar.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });

    $formatToolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var cmd = btn.dataset.cmd;
      if (!cmd) return;

      if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3') {
        document.execCommand('formatBlock', false, '<' + cmd + '>');
      } else if (cmd === 'blockquote') {
        document.execCommand('formatBlock', false, '<blockquote>');
      } else if (cmd === 'createLink') {
        var url = prompt('URL을 입력하세요:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd);
      }
      _updateToolbarState();
      _markDiscovered('format-toolbar');
    });

    // 선택 변경 감지
    function _onSelectionChange() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        _hideFormatToolbar();
        return;
      }
      // 에디터 안의 선택인지 확인
      var range = sel.getRangeAt(0);
      if (!$blankContent.contains(range.commonAncestorContainer)) {
        _hideFormatToolbar();
        return;
      }
      _showFormatToolbar(range);
    }

    $blankContent.addEventListener('mouseup', function () {
      setTimeout(_onSelectionChange, 10);
    });
    $blankContent.addEventListener('keyup', function (e) {
      if (e.shiftKey) setTimeout(_onSelectionChange, 10);
    });

    // 에디터 밖 클릭 시 숨김
    document.addEventListener('mousedown', function (e) {
      if ($formatToolbar && !$formatToolbar.contains(e.target) && !$blankContent.contains(e.target)) {
        _hideFormatToolbar();
      }
    });
  }

  function _showFormatToolbar(range) {
    if (!$formatToolbar) return;
    var rect = range.getBoundingClientRect();
    var editorRect = $blankContent.closest('.editor-body').getBoundingClientRect();

    var left = rect.left + rect.width / 2 - editorRect.left;
    var top = rect.top - editorRect.top - 40;

    // 툴바 너비 고려하여 좌우 보정
    $formatToolbar.style.left = Math.max(0, left - 150) + 'px';
    $formatToolbar.style.top = Math.max(0, top) + 'px';
    $formatToolbar.classList.add('is-visible');
    _updateToolbarState();
  }

  function _hideFormatToolbar() {
    if ($formatToolbar) $formatToolbar.classList.remove('is-visible');
  }

  function _updateToolbarState() {
    if (!$formatToolbar) return;
    $formatToolbar.querySelectorAll('button[data-cmd]').forEach(function (btn) {
      var cmd = btn.dataset.cmd;
      var active = false;
      try {
        if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3' || cmd === 'blockquote') {
          var block = document.queryCommandValue('formatBlock');
          active = block.toLowerCase() === cmd || block.toLowerCase() === '<' + cmd + '>';
        } else if (cmd !== 'createLink' && cmd !== 'insertUnorderedList') {
          active = document.queryCommandState(cmd);
        }
      } catch (ex) {}
      btn.classList.toggle('is-active', active);
    });
  }

  // ── Input Rules (마크다운 입력 단축키) ──

  function _getBlockParent(node) {
    var blocks = ['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== $blankContent) {
      if (blocks.indexOf(el.tagName) !== -1) return el;
      el = el.parentElement;
    }
    return null;
  }

  function _replaceBlock(block, tag, prefixLen) {
    if (/^h[1-6]$/i.test(tag)) _markDiscovered('heading');
    var text = block.textContent.substring(prefixLen);
    var newEl = document.createElement(tag);
    newEl.textContent = text;
    block.parentNode.replaceChild(newEl, block);
    // 커서를 새 엘리먼트 끝으로
    var sel = window.getSelection();
    var range = document.createRange();
    if (newEl.childNodes.length) {
      range.setStart(newEl.childNodes[0], text.length);
    } else {
      range.setStart(newEl, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function _wrapInList(block, listTag, prefixLen) {
    _markDiscovered('list');
    var text = block.textContent.substring(prefixLen);
    var list = document.createElement(listTag);
    var li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
    block.parentNode.replaceChild(list, block);
    var sel = window.getSelection();
    var range = document.createRange();
    if (li.childNodes.length) {
      range.setStart(li.childNodes[0], text.length);
    } else {
      range.setStart(li, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ── Checklist ──

  function _makeChecklistItem(text) {
    var item = document.createElement('div');
    item.className = 'checklist-item';
    item.contentEditable = 'false';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'checklist-item__check';
    cb.addEventListener('change', function () {
      item.classList.toggle('is-checked', cb.checked);
    });
    var span = document.createElement('span');
    span.className = 'checklist-item__text';
    span.contentEditable = 'true';
    span.textContent = text;
    item.appendChild(cb);
    item.appendChild(span);
    return item;
  }

  function _createChecklist(block, prefixLen) {
    _markDiscovered('checklist');
    var text = block.textContent.substring(prefixLen);
    var item = _makeChecklistItem(text);
    block.parentNode.replaceChild(item, block);
    var span = item.querySelector('.checklist-item__text');
    var sel = window.getSelection();
    var range = document.createRange();
    if (span.childNodes.length) {
      range.setStart(span.childNodes[0], text.length);
    } else {
      range.setStart(span, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function _rehydrateChecklists() {
    if (!$blankContent) return;
    $blankContent.querySelectorAll('.checklist-item').forEach(function (item) {
      item.contentEditable = 'false';
      var cb = item.querySelector('.checklist-item__check');
      var span = item.querySelector('.checklist-item__text');
      if (span) span.contentEditable = 'true';
      if (cb) {
        item.classList.toggle('is-checked', cb.checked);
        cb.addEventListener('change', function () {
          item.classList.toggle('is-checked', cb.checked);
        });
      }
    });
  }

  function _setupInputRules() {
    if (!$blankContent) return;

    $blankContent.addEventListener('input', function () {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      if (!range.collapsed) return;

      var node = range.startContainer;
      if (node.nodeType !== 3) return; // 텍스트 노드만

      var block = _getBlockParent(node);
      if (!block) return;

      // 리스트/blockquote/heading 안에서는 재변환 안 함
      var tag = block.tagName;
      if (tag === 'LI' || tag === 'BLOCKQUOTE' || /^H[1-6]$/.test(tag)) return;

      var text = block.textContent;

      // 헤딩: ### + space
      if (/^### $/.test(text)) { _replaceBlock(block, 'h3', 4); return; }
      if (/^## $/.test(text)) { _replaceBlock(block, 'h2', 3); return; }
      if (/^# $/.test(text)) { _replaceBlock(block, 'h1', 2); return; }

      // 비순서 리스트: - 또는 * + space
      if (/^[-*] $/.test(text)) { _wrapInList(block, 'ul', 2); return; }

      // 순서 리스트: 1. + space
      if (/^\d+\. $/.test(text)) {
        var prefixLen = text.indexOf('. ') + 2;
        _wrapInList(block, 'ol', prefixLen);
        return;
      }

      // 인용: > + space
      if (/^> $/.test(text)) { _replaceBlock(block, 'blockquote', 2); return; }

      // 체크리스트: [ ] + space
      if (/^\[\] $/.test(text) || /^\[ \] $/.test(text)) {
        var prefLen = text.indexOf(']') + 2;
        _createChecklist(block, prefLen);
        return;
      }
    });

    // Enter 키 처리: 빈 리스트 탈출, --- → hr
    $blankContent.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;

      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var node = sel.getRangeAt(0).startContainer;
      var block = _getBlockParent(node);
      if (!block) return;

      // --- → hr 삽입
      if (block.textContent.trim() === '---') {
        e.preventDefault();
        var hr = document.createElement('hr');
        var p = document.createElement('p');
        p.innerHTML = '<br>';
        block.parentNode.replaceChild(hr, block);
        hr.parentNode.insertBefore(p, hr.nextSibling);
        var range = document.createRange();
        range.setStart(p, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }

      // 빈 리스트 아이템에서 Enter → 리스트 탈출
      if (block.tagName === 'LI' && block.textContent.trim() === '') {
        var list = block.parentElement;
        if (list && (list.tagName === 'UL' || list.tagName === 'OL')) {
          e.preventDefault();
          var p = document.createElement('p');
          p.innerHTML = '<br>';
          list.parentNode.insertBefore(p, list.nextSibling);
          block.parentNode.removeChild(block);
          if (!list.children.length) list.parentNode.removeChild(list);
          var range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return;
      }

      // 체크리스트 아이템에서 Enter
      var checkItem = node.nodeType === 3 ? node.parentElement : node;
      while (checkItem && checkItem !== $blankContent) {
        if (checkItem.classList && checkItem.classList.contains('checklist-item')) break;
        checkItem = checkItem.parentElement;
      }
      if (checkItem && checkItem.classList && checkItem.classList.contains('checklist-item')) {
        var textSpan = checkItem.querySelector('.checklist-item__text');
        // 빈 아이템이면 체크리스트 탈출
        if (textSpan && textSpan.textContent.trim() === '') {
          e.preventDefault();
          var p = document.createElement('p');
          p.innerHTML = '<br>';
          checkItem.parentNode.insertBefore(p, checkItem.nextSibling);
          checkItem.parentNode.removeChild(checkItem);
          var range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // 내용 있으면 새 체크리스트 아이템 생성
          e.preventDefault();
          var newItem = _makeChecklistItem('');
          checkItem.parentNode.insertBefore(newItem, checkItem.nextSibling);
          var newSpan = newItem.querySelector('.checklist-item__text');
          var range = document.createRange();
          range.setStart(newSpan, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    });
  }

  // ── Markdown ──

  function _esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  function _looksLikeMd(text) {
    if (/^#{1,6}\s+.+/m.test(text)) return true;
    if (/^```/m.test(text)) return true;
    if (/^\|.+\|[\s]*\n\|[\s\-:| ]+\|/m.test(text)) return true;
    var c = 0;
    if (/\*\*.+?\*\*/m.test(text)) c++;
    if (/^[-*+]\s+/m.test(text)) c++;
    if (/^\d+\.\s+/m.test(text)) c++;
    if (/^>\s/m.test(text)) c++;
    return c >= 2;
  }

  function _inlineMd(t) {
    t = _esc(t);
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');
    t = t.replace(/`(.+?)`/g, '<code>$1</code>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    return t;
  }

  function _splitTableRow(line) {
    var cells = line.split('|');
    if (cells[0].trim() === '') cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
    return cells.map(function (c) { return c.trim(); });
  }

  function _parseTable(lines, start) {
    var headers = _splitTableRow(lines[start]);
    var i = start + 2;
    var rows = [];
    while (i < lines.length && /^\|.+\|/.test(lines[i].trim())) {
      rows.push(_splitTableRow(lines[i]));
      i++;
    }
    var html = '<table class="md-table"><thead><tr>' +
      headers.map(function (c) { return '<th>' + _inlineMd(c) + '</th>'; }).join('') +
      '</tr></thead>';
    if (rows.length) {
      html += '<tbody>' + rows.map(function (row) {
        return '<tr>' + row.map(function (c) { return '<td>' + _inlineMd(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
    }
    html += '</table>';
    return { html: html, end: i };
  }

  function _mdToHtml(md) {
    var lines = md.split('\n');
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var trimmed = lines[i].trim();
      if (/^\|.+\|/.test(trimmed) && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1].trim())) {
        var tbl = _parseTable(lines, i);
        out.push(tbl.html);
        i = tbl.end;
        continue;
      }
      if (trimmed.indexOf('```') === 0) {
        var code = []; i++;
        while (i < lines.length && lines[i].trim().indexOf('```') !== 0) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + _esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      var hm = trimmed.match(/^(#{1,6})\s+(.+?)$/);
      if (hm) { out.push('<h' + hm[1].length + '>' + _inlineMd(hm[2]) + '</h' + hm[1].length + '>'); i++; continue; }
      if (/^[-*_]{3,}\s*$/.test(trimmed)) { out.push('<hr>'); i++; continue; }
      if (/^>/.test(trimmed)) {
        var q = [];
        while (i < lines.length && /^>/.test(lines[i].trim())) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + q.map(_inlineMd).join('<br>') + '</blockquote>');
        continue;
      }
      if (/^\s*[-*+]\s+/.test(lines[i])) {
        var items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push('<li>' + _inlineMd(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>'); i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^\s*\d+\.\s+/.test(lines[i])) {
        var ol = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          ol.push('<li>' + _inlineMd(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++;
        }
        out.push('<ol>' + ol.join('') + '</ol>');
        continue;
      }
      if (trimmed === '') { i++; continue; }
      var p = [];
      while (i < lines.length) {
        var pt = lines[i].trim();
        if (pt === '' || /^#{1,6}\s/.test(pt) || /^>/.test(pt) || /^\s*[-*+]\s+/.test(lines[i]) || pt.indexOf('```') === 0) break;
        p.push(lines[i]); i++;
      }
      if (p.length) out.push('<p>' + p.map(_inlineMd).join('<br>') + '</p>');
    }
    return out.join('\n');
  }

  return {
    init: init, loadNote: loadNote, deleteNote: deleteNote,
    clearEditor: clearEditor, getCurrentNoteId: getCurrentNoteId,
    getCurrentType: getCurrentType, getContentElement: getContentElement,
    getCurrentSnapshot: getCurrentSnapshot, save: save,
    setTargetBookshelf: setTargetBookshelf
  };
})();
