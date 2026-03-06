/**
 * Basket Panel — 올 바구니 UI
 * 올/실 목록 표시, 상세 보기, 힌트 표시, 실 잣기, 코 만들기
 * 하이라이트 시스템, 답글, 컨텍스트 메뉴
 * 의존: FiberAPI, NoteEditor
 */
var BasketPanel = (function () {
  'use strict';

  var $list, $empty, $contextMenu;
  var fibers = [];
  var selectedFiberId = null;
  var detailMode = false;
  var pendingSelection = null;
  var savedSelectionOnMousedown = null;
  var _scopeNoteIds = null; // null = 전체, [id, ...] = 필터

  function setScope(noteIds) {
    _scopeNoteIds = noteIds && noteIds.length ? noteIds : null;
    render();
  }

  function _getVisibleFibers() {
    if (!_scopeNoteIds) return fibers;
    return fibers.filter(function (f) {
      return _scopeNoteIds.indexOf(f.source_note_id) !== -1;
    });
  }

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
    var mon = Math.floor(day / 30);
    return mon + '개월 전';
  }

  // ── Highlight system ──

  function _getNodePath(node) {
    var contentEl = NoteEditor.getContentElement();
    var path = []; var cur = node;
    while (cur && cur !== contentEl) {
      var parent = cur.parentNode;
      if (!parent) break;
      path.unshift(Array.from(parent.childNodes).indexOf(cur));
      cur = parent;
    }
    return path;
  }

  function _getNodeFromPath(path) {
    var node = NoteEditor.getContentElement();
    for (var i = 0; i < path.length; i++) {
      if (!node || !node.childNodes[path[i]]) return null;
      node = node.childNodes[path[i]];
    }
    return node;
  }

  function _serializeRange(range) {
    return {
      startContainer: _getNodePath(range.startContainer),
      startOffset: range.startOffset,
      endContainer: _getNodePath(range.endContainer),
      endOffset: range.endOffset,
      text: range.toString()
    };
  }

  function _restoreRange(ser) {
    try {
      var s = _getNodeFromPath(ser.startContainer);
      var e = _getNodeFromPath(ser.endContainer);
      if (!s || !e) return null;
      var r = document.createRange();
      r.setStart(s, Math.min(ser.startOffset, s.length || s.childNodes.length));
      r.setEnd(e, Math.min(ser.endOffset, e.length || e.childNodes.length));
      // DOM 경로 복원 후 텍스트가 일치하는지 검증
      if (ser.text && r.toString() !== ser.text) return null;
      return r;
    } catch (ex) { return null; }
  }

  function _findTextRange(contentEl, searchText) {
    if (!contentEl || !searchText) return null;
    var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var idx = node.textContent.indexOf(searchText);
      if (idx !== -1) {
        try {
          var r = document.createRange();
          r.setStart(node, idx);
          r.setEnd(node, idx + searchText.length);
          return r;
        } catch (ex) {}
      }
    }
    return null;
  }

  function _createHighlightSpan(fiberId, text) {
    var span = document.createElement('span');
    span.className = 'text-highlight';
    span.textContent = text;
    span.dataset.fiberId = fiberId;
    span.addEventListener('click', function () {
      selectedFiberId = fiberId;
      detailMode = true;
      render();
    });
    return span;
  }

  function _applyFiberHighlight(fiberId, sourceRange) {
    try {
      // 1차: DOM 경로 기반 복원
      var range = _restoreRange(sourceRange);
      // 2차: DOM 경로 실패 시 텍스트 검색 fallback
      if (!range && sourceRange.text) {
        var contentEl = NoteEditor.getContentElement();
        range = _findTextRange(contentEl, sourceRange.text);
      }
      if (!range) return;
      var span = _createHighlightSpan(fiberId, range.toString());
      range.deleteContents();
      range.insertNode(span);
    } catch (ex) {}
  }

  function _removeFiberHighlight(fiberId) {
    var contentEl = NoteEditor.getContentElement();
    if (!contentEl) return;
    var hl = contentEl.querySelector('[data-fiber-id="' + fiberId + '"]');
    if (hl) {
      var text = document.createTextNode(hl.textContent);
      hl.parentNode.replaceChild(text, hl);
      text.parentNode.normalize();
    }
  }

  function refreshHighlights(noteId) {
    if (!noteId) return;
    var contentEl = NoteEditor.getContentElement();
    if (!contentEl) return;

    // Find fibers for this note from cached list
    var noteFibers = fibers.filter(function (f) {
      return f.source_note_id === noteId && f.source_range;
    });

    noteFibers.forEach(function (f) {
      // Skip if already highlighted
      if (contentEl.querySelector('[data-fiber-id="' + f.id + '"]')) return;
      _applyFiberHighlight(f.id, f.source_range);
    });
  }

  // ── Context menu ──

  function _setupContextMenu() {
    $contextMenu = document.getElementById('noteContextMenu');
    if (!$contextMenu) return;

    document.addEventListener('mousedown', function (e) {
      if (e.button !== 2) return;
      var editorBody = document.getElementById('editorBody');
      var blankContent = document.getElementById('blankContent');
      var templateForm = document.getElementById('templateForm');
      if (!editorBody || !editorBody.contains(e.target)) return;
      savedSelectionOnMousedown = null;
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        var text = sel.toString();
        if (text && text.trim()) {
          var inContentEditable = !!(blankContent && sel.anchorNode && blankContent.contains(sel.anchorNode));
          try {
            var range = inContentEditable ? sel.getRangeAt(0).cloneRange() : null;
            savedSelectionOnMousedown = { text: text.trim(), range: range, fromContentEditable: inContentEditable };
          } catch (ex) {}
        }
      } else if (document.activeElement && document.activeElement.tagName === 'TEXTAREA' && templateForm && templateForm.contains(document.activeElement)) {
        var ta = document.activeElement;
        var start = ta.selectionStart, end = ta.selectionEnd;
        if (start !== end) {
          savedSelectionOnMousedown = { text: ta.value.substring(start, end).trim(), range: null, fromContentEditable: false };
        }
      }
    }, true);

    document.addEventListener('contextmenu', function (e) {
      var editorBody = document.getElementById('editorBody');
      var blankNote = document.getElementById('blankNote');
      var templateNote = document.getElementById('templateNote');
      if (!editorBody || !editorBody.contains(e.target)) return;
      if ((!blankNote || !blankNote.contains(e.target)) && (!templateNote || !templateNote.contains(e.target))) return;

      var text = '';
      var range = null;
      var inContentEditable = false;

      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        text = sel.toString();
        var blankContent = document.getElementById('blankContent');
        inContentEditable = !!(blankContent && sel.anchorNode && blankContent.contains(sel.anchorNode));
        try {
          range = inContentEditable ? sel.getRangeAt(0).cloneRange() : null;
        } catch (ex) {}
      }
      if ((!text || !text.trim()) && savedSelectionOnMousedown) {
        text = savedSelectionOnMousedown.text;
        range = savedSelectionOnMousedown.range;
        inContentEditable = savedSelectionOnMousedown.fromContentEditable;
      }
      if (!text || !text.trim()) {
        var activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'TEXTAREA') {
          var start = activeEl.selectionStart, end = activeEl.selectionEnd;
          if (start !== end) text = activeEl.value.substring(start, end);
        }
      }
      if (!text || !text.trim()) return;

      e.preventDefault();
      e.stopPropagation();
      pendingSelection = { text: text.trim(), range: range, fromContentEditable: inContentEditable };
      _showMenu(e.clientX, e.clientY);
      savedSelectionOnMousedown = null;
    }, true);

    var catchBtn = $contextMenu.querySelector('[data-action="catch-fiber"]');
    if (catchBtn) {
      catchBtn.addEventListener('click', function () {
        if (pendingSelection) {
          _catchFiberFromSelection(pendingSelection);
          pendingSelection = null;
        }
        _hideMenu();
      });
    }

    document.addEventListener('click', function (e) {
      if ($contextMenu && !$contextMenu.contains(e.target)) {
        _hideMenu();
      }
    });
  }

  function _showMenu(x, y) {
    if (!$contextMenu) return;
    _hideMenu();
    $contextMenu.style.left = x + 'px';
    $contextMenu.style.top = y + 'px';
    $contextMenu.classList.add('is-visible');
  }

  function _hideMenu() {
    if ($contextMenu) $contextMenu.classList.remove('is-visible');
  }

  // ── 올 잡기 (Fiber Catch) ──

  function _catchFiberFromSelection(sel) {
    var snap = NoteEditor.getCurrentSnapshot();
    var text = (sel.text || '').trim();
    if (!text) return;

    // Serialize range for highlight
    var sourceRange = null;
    if (sel.fromContentEditable && sel.range) {
      try { sourceRange = _serializeRange(sel.range); } catch (ex) {}
    }

    var dialog = document.getElementById('tensionDialog');
    var preview = document.getElementById('tensionPreview');
    var dots = document.getElementById('tensionDots');
    var toneBtns = document.getElementById('toneBtns');
    var saveBtn = document.getElementById('tensionSave');
    var cancelBtn = document.getElementById('tensionCancel');
    if (!dialog || !dots) return;

    if (preview) preview.textContent = text;

    var selectedTension = 3;
    dots.querySelectorAll('.tension-dot').forEach(function (d) {
      d.classList.toggle('is-active', parseInt(d.dataset.t) <= 3);
    });

    var selectedTone = 'resonance';
    if (toneBtns) {
      toneBtns.querySelectorAll('.tone-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tone === 'resonance');
      });
    }

    function onDotClick(e) {
      var dot = e.target.closest('.tension-dot');
      if (!dot) return;
      selectedTension = parseInt(dot.dataset.t);
      dots.querySelectorAll('.tension-dot').forEach(function (d) {
        d.classList.toggle('is-active', parseInt(d.dataset.t) <= selectedTension);
      });
    }
    dots.addEventListener('click', onDotClick);

    function onToneClick(e) {
      var btn = e.target.closest('.tone-btn');
      if (!btn) return;
      selectedTone = btn.dataset.tone;
      toneBtns.querySelectorAll('.tone-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tone === selectedTone);
      });
    }
    if (toneBtns) toneBtns.addEventListener('click', onToneClick);

    dialog.classList.add('is-open');

    function cleanup() {
      dialog.classList.remove('is-open');
      dots.removeEventListener('click', onDotClick);
      if (toneBtns) toneBtns.removeEventListener('click', onToneClick);
      saveBtn.onclick = null;
      cancelBtn.onclick = null;
    }

    saveBtn.onclick = function () {
      FiberAPI.catchFiber({
        text: text,
        source: 'note',
        source_note_id: snap.noteId || '',
        source_note_title: snap.noteTitle || '',
        tension: selectedTension,
        tone: selectedTone,
        source_range: sourceRange
      }).then(function (fiber) {
        cleanup();
        // Apply highlight immediately
        if (sourceRange && fiber) _applyFiberHighlight(fiber.id, sourceRange);
        refresh();
      }).catch(function () {
        KnittingDialog.alert('올 잡기 실패', '서버가 꺼져있을 수 있습니다.');
        cleanup();
      });
    };

    cancelBtn.onclick = cleanup;
  }

  // ── Init ──

  function init() {
    $list = document.getElementById('basketList');
    $empty = document.getElementById('basketEmpty');
    _setupContextMenu();
  }

  function refresh() {
    FiberAPI.listFibers().then(function (data) {
      fibers = data || [];
      render();
    }).catch(function () {
      fibers = [];
      render();
    });
  }

  function render() {
    if (!$list || !$empty) return;

    if (detailMode && selectedFiberId) {
      _renderDetail(selectedFiberId);
      return;
    }

    $list.innerHTML = '';

    var visible = _getVisibleFibers();

    if (!visible.length) {
      $empty.style.display = '';
      if (_scopeNoteIds && fibers.length) {
        $empty.innerHTML = '이 범위에는 아직 올이 없습니다.';
      } else {
        $empty.innerHTML = '잡은 올이 없습니다.<br>텍스트를 선택하고 우클릭 →<br>올 잡기를 해보세요.';
      }
      return;
    }
    $empty.style.display = 'none';

    visible.forEach(function (f) {
      $list.appendChild(_renderCard(f));
    });
  }

  function _renderCard(fiber) {
    var card = document.createElement('div');
    card.className = 'fiber-card fiber-card--' + (fiber.tone || 'resonance');
    card.dataset.id = fiber.id;

    var tensionBar = '';
    for (var i = 1; i <= 5; i++) {
      tensionBar += '<span class="fiber-card__dot' + (i <= fiber.tension ? ' is-filled' : '') + '"></span>';
    }

    var isYarn = fiber.thought && fiber.thought.trim();
    var badge = isYarn ? '<span class="fiber-card__badge">실</span>' : '';
    var toneLabels = { resonance: '공명', friction: '마찰', question: '물음' };
    var toneBadge = '<span class="fiber-card__tone">' + (toneLabels[fiber.tone] || '공명') + '</span>';

    card.innerHTML =
      '<button class="fiber-card__delete" title="삭제">&times;</button>' +
      '<div class="fiber-card__tension">' + tensionBar + '</div>' +
      '<div class="fiber-card__text">' + esc(fiber.text.length > 100 ? fiber.text.substring(0, 100) + '...' : fiber.text) + '</div>' +
      (isYarn ? '<div class="fiber-card__thought">' + esc(fiber.thought.length > 60 ? fiber.thought.substring(0, 60) + '...' : fiber.thought) + '</div>' : '') +
      '<div class="fiber-card__meta">' +
        (fiber.source_note_title ? '<span class="fiber-card__source">' + esc(fiber.source_note_title) + '</span>' : '') +
        '<span class="fiber-card__time">' + _timeAgo(fiber.caught_at) + '</span>' +
        badge + toneBadge +
      '</div>';

    card.querySelector('.fiber-card__delete').addEventListener('click', function (e) {
      e.stopPropagation();
      KnittingDialog.confirm({ message: '이 올을 삭제할까요?', confirmLabel: '삭제', danger: true }, function () {
        FiberAPI.deleteFiber(fiber.id).then(function () {
          _removeFiberHighlight(fiber.id);
          refresh();
        });
      });
    });

    card.addEventListener('click', function () {
      selectedFiberId = fiber.id;
      detailMode = true;
      render();
    });

    return card;
  }

  function _renderDetail(fiberId) {
    if (!$list) return;
    $empty.style.display = 'none';
    $list.innerHTML = '';

    var fiber = fibers.find(function (f) { return f.id === fiberId; });
    if (!fiber) {
      detailMode = false;
      render();
      return;
    }

    var detail = document.createElement('div');
    detail.className = 'basket-detail';

    // Back button
    var backBtn = document.createElement('button');
    backBtn.className = 'basket-detail__back';
    backBtn.textContent = '\u2190 목록';
    backBtn.addEventListener('click', function () {
      detailMode = false;
      selectedFiberId = null;
      refresh();
    });
    detail.appendChild(backBtn);

    // Tension (editable)
    var tensionDiv = document.createElement('div');
    tensionDiv.className = 'basket-detail__tension';
    tensionDiv.innerHTML = '<span class="basket-detail__label">장력</span>';
    var dotsDiv = document.createElement('div');
    dotsDiv.className = 'tension-dots tension-dots--inline';
    for (var i = 1; i <= 5; i++) {
      var dot = document.createElement('span');
      dot.className = 'tension-dot' + (i <= fiber.tension ? ' is-active' : '');
      dot.dataset.t = i;
      dot.textContent = i;
      dotsDiv.appendChild(dot);
    }
    dotsDiv.addEventListener('click', function (e) {
      var d = e.target.closest('.tension-dot');
      if (!d) return;
      var t = parseInt(d.dataset.t);
      FiberAPI.updateFiber(fiberId, { tension: t }).then(function (updated) {
        fiber.tension = updated.tension;
        dotsDiv.querySelectorAll('.tension-dot').forEach(function (dd) {
          dd.classList.toggle('is-active', parseInt(dd.dataset.t) <= t);
        });
      });
    });
    tensionDiv.appendChild(dotsDiv);
    detail.appendChild(tensionDiv);

    // Tone (결, editable)
    var toneDiv = document.createElement('div');
    toneDiv.className = 'basket-detail__tone';
    toneDiv.innerHTML = '<span class="basket-detail__label">결</span>';
    var toneSel = document.createElement('div');
    toneSel.className = 'tone-selector tone-selector--inline';
    var toneOptions = [
      { key: 'resonance', label: '공명' },
      { key: 'friction', label: '마찰' },
      { key: 'question', label: '물음' }
    ];
    toneOptions.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.className = 'tone-btn tone-btn--' + opt.key + ((fiber.tone || 'resonance') === opt.key ? ' is-active' : '');
      btn.dataset.tone = opt.key;
      btn.textContent = opt.label;
      toneSel.appendChild(btn);
    });
    toneSel.addEventListener('click', function (e) {
      var btn = e.target.closest('.tone-btn');
      if (!btn) return;
      var newTone = btn.dataset.tone;
      FiberAPI.updateFiber(fiberId, { tone: newTone }).then(function (updated) {
        fiber.tone = updated.tone;
        toneSel.querySelectorAll('.tone-btn').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.tone === newTone);
        });
      });
    });
    toneDiv.appendChild(toneSel);
    detail.appendChild(toneDiv);

    // Full text
    var textDiv = document.createElement('div');
    textDiv.className = 'basket-detail__text';
    textDiv.textContent = fiber.text;
    detail.appendChild(textDiv);

    // Source info (clickable → navigate to note + scroll to highlight)
    if (fiber.source_note_title && fiber.source_note_id) {
      var srcDiv = document.createElement('div');
      srcDiv.className = 'basket-detail__source basket-detail__source--link';
      srcDiv.textContent = '출처: ' + fiber.source_note_title;
      srcDiv.title = '클릭하면 원본 노트로 이동합니다';
      srcDiv.addEventListener('click', function () {
        _navigateToSource(fiber);
      });
      detail.appendChild(srcDiv);
    } else if (fiber.source_note_title) {
      var srcDiv2 = document.createElement('div');
      srcDiv2.className = 'basket-detail__source';
      srcDiv2.textContent = '출처: ' + fiber.source_note_title;
      detail.appendChild(srcDiv2);
    }

    // Thought (spin) area
    var thoughtSection = document.createElement('div');
    thoughtSection.className = 'basket-detail__thought-section';
    var thoughtLabel = document.createElement('div');
    thoughtLabel.className = 'basket-detail__label';
    thoughtLabel.textContent = '내 생각 (실 잣기)';
    thoughtSection.appendChild(thoughtLabel);

    var thoughtInput = document.createElement('textarea');
    thoughtInput.className = 'basket-detail__thought-input';
    thoughtInput.placeholder = '이게 왜 걸렸지?';
    thoughtInput.rows = 3;
    thoughtInput.value = fiber.thought || '';
    thoughtSection.appendChild(thoughtInput);

    var thoughtSave = document.createElement('button');
    thoughtSave.className = 'basket-detail__thought-save';
    thoughtSave.textContent = '저장';
    thoughtSave.addEventListener('click', function () {
      var val = thoughtInput.value.trim();
      FiberAPI.updateFiber(fiberId, { thought: val }).then(function (updated) {
        fiber.thought = updated.thought;
        fiber.spun_at = updated.spun_at;
        thoughtSave.textContent = '저장됨';
        setTimeout(function () { thoughtSave.textContent = '저장'; }, 1000);
      });
    });
    thoughtSection.appendChild(thoughtSave);
    detail.appendChild(thoughtSection);

    // Stitches section (엮인 코)
    var stitchesSection = document.createElement('div');
    stitchesSection.className = 'basket-detail__stitches';
    var stitchesLabel = document.createElement('div');
    stitchesLabel.className = 'basket-detail__label';
    stitchesLabel.textContent = '엮인 코';
    stitchesSection.appendChild(stitchesLabel);

    var stitchesList = document.createElement('div');
    stitchesList.className = 'basket-detail__stitch-list';
    stitchesList.innerHTML = '<div class="stitches-loading">불러오는 중...</div>';
    stitchesSection.appendChild(stitchesList);

    var knotBtn = document.createElement('button');
    knotBtn.className = 'basket-detail__knot-btn';
    knotBtn.textContent = '매듭 짓기';
    knotBtn.disabled = true;
    stitchesSection.appendChild(knotBtn);
    detail.appendChild(stitchesSection);

    // Load stitches async
    var fiberStitches = [];
    FiberAPI.listStitches(fiberId).then(function (stitches) {
      var loadingEl = stitchesList.querySelector('.stitches-loading');
      if (loadingEl) loadingEl.remove();

      if (!stitches || !stitches.length) {
        var noStitches = document.createElement('div');
        noStitches.className = 'stitches-empty';
        noStitches.textContent = '아직 엮인 코가 없습니다.';
        stitchesList.appendChild(noStitches);
        return;
      }

      fiberStitches = stitches;
      knotBtn.disabled = false;

      stitches.forEach(function (s) {
        var otherId = s.fiber_a_id === fiberId ? s.fiber_b_id : s.fiber_a_id;
        var otherFiber = fibers.find(function (f) { return f.id === otherId; });
        var otherText = otherFiber ? otherFiber.text : '(삭제된 올)';
        if (otherText.length > 60) otherText = otherText.substring(0, 60) + '...';

        var stitchEl = document.createElement('div');
        stitchEl.className = 'stitch-item';
        stitchEl.innerHTML =
          '<div class="stitch-item__text">' + esc(otherText) + '</div>' +
          (s.why ? '<div class="stitch-item__why">' + esc(s.why) + '</div>' : '') +
          '<button class="stitch-item__delete" title="코 삭제">&times;</button>';

        stitchEl.querySelector('.stitch-item__delete').addEventListener('click', function (e) {
          e.stopPropagation();
          KnittingDialog.confirm({ message: '이 코를 삭제할까요?', confirmLabel: '삭제', danger: true }, function () {
            FiberAPI.deleteStitch(s.id).then(function () {
              stitchEl.remove();
              fiberStitches = fiberStitches.filter(function (st) { return st.id !== s.id; });
              if (!fiberStitches.length) knotBtn.disabled = true;
            });
          });
        });

        stitchEl.addEventListener('click', function () {
          selectedFiberId = otherId;
          _renderDetail(otherId);
        });

        stitchesList.appendChild(stitchEl);
      });
    }).catch(function () {
      var loadingEl = stitchesList.querySelector('.stitches-loading');
      if (loadingEl) loadingEl.textContent = '코를 불러올 수 없습니다.';
    });

    // Knot button handler
    knotBtn.addEventListener('click', function () {
      if (!fiberStitches.length) return;
      _openKnotDialog(fiberId, fiberStitches);
    });

    // Replies section (답글)
    var repliesSection = document.createElement('div');
    repliesSection.className = 'basket-detail__replies';
    var repliesLabel = document.createElement('div');
    repliesLabel.className = 'basket-detail__label';
    repliesLabel.textContent = '답글';
    repliesSection.appendChild(repliesLabel);

    var repliesList = document.createElement('div');
    repliesList.className = 'basket-detail__reply-list';
    repliesSection.appendChild(repliesList);

    var replyForm = document.createElement('div');
    replyForm.className = 'basket-detail__reply-form';
    replyForm.innerHTML =
      '<textarea class="basket-detail__reply-input" placeholder="이 올에 대한 생각..." rows="2"></textarea>' +
      '<button class="basket-detail__reply-submit">등록</button>';
    repliesSection.appendChild(replyForm);
    detail.appendChild(repliesSection);

    // Load replies async
    FiberAPI.listReplies(fiberId).then(function (replies) {
      if (!replies || !replies.length) return;
      replies.forEach(function (r) {
        repliesList.appendChild(_createReplyElement(r, fiberId));
      });
    }).catch(function () {
      repliesList.innerHTML = '<div class="replies-empty">답글을 불러올 수 없습니다.</div>';
    });

    // Reply submit handler
    var replyInput = replyForm.querySelector('.basket-detail__reply-input');
    var replySubmit = replyForm.querySelector('.basket-detail__reply-submit');
    replySubmit.addEventListener('click', function () {
      var text = replyInput.value.trim();
      if (!text) return;
      FiberAPI.addReply(fiberId, text).then(function (reply) {
        repliesList.appendChild(_createReplyElement(reply, fiberId));
        replyInput.value = '';
      });
    });

    // Delete
    var delBtn = document.createElement('button');
    delBtn.className = 'basket-detail__delete';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', function () {
      KnittingDialog.confirm({ message: '이 올을 삭제할까요?', confirmLabel: '삭제', danger: true }, function () {
        FiberAPI.deleteFiber(fiberId).then(function () {
          _removeFiberHighlight(fiberId);
          detailMode = false;
          selectedFiberId = null;
          refresh();
        });
      });
    });
    detail.appendChild(delBtn);

    // Hints
    var hintsSection = document.createElement('div');
    hintsSection.className = 'basket-detail__hints';
    hintsSection.innerHTML = '<div class="basket-detail__label">비슷한 올</div><div class="hints-loading">찾는 중...</div>';
    detail.appendChild(hintsSection);

    $list.appendChild(detail);

    // Load hints async (하이브리드 스코어링: { hints, phase, density })
    FiberAPI.getHints(fiberId).then(function (result) {
      var loadingEl = hintsSection.querySelector('.hints-loading');
      if (loadingEl) loadingEl.remove();

      // 호환: 배열이면 그대로, 객체면 .hints 사용
      var hints = Array.isArray(result) ? result : (result && result.hints || []);
      var phase = result && result.phase || '';

      if (!hints.length) {
        var noHints = document.createElement('div');
        noHints.className = 'hints-empty';
        noHints.textContent = '아직 비슷한 올이 없습니다.';
        hintsSection.appendChild(noHints);
        return;
      }

      hints.forEach(function (hint) {
        var signalInfo = hint.signals
          ? ' title="임베딩 ' + hint.signals.embedding + '% · 그래프 ' + hint.signals.graph + '% · 답글 ' + hint.signals.reply + '%"'
          : '';
        var hintCard = document.createElement('div');
        hintCard.className = 'hint-card';
        hintCard.innerHTML =
          '<div class="hint-card__similarity"' + signalInfo + '>' + hint.similarity + '%</div>' +
          '<div class="hint-card__text">' + esc(hint.text.length > 80 ? hint.text.substring(0, 80) + '...' : hint.text) + '</div>' +
          '<button class="hint-card__stitch-btn" title="이 올과 엮기">엮기</button>';

        var stitchBtn = hintCard.querySelector('.hint-card__stitch-btn');
        stitchBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var hId = hint.id;
          KnittingDialog.prompt({
            title: '엮기',
            message: '이 둘이 연결되는 이유나 느낌을 적어주세요 (선택)',
            placeholder: '이유나 느낌...',
            submitLabel: '엮기'
          }, function (why) {
            FiberAPI.createStitch({
              fiber_a_id: fiberId,
              fiber_b_id: hId,
              why: why || ''
            }).then(function () {
              stitchBtn.textContent = '연결됨';
              stitchBtn.disabled = true;
            });
          });
        });

        hintCard.addEventListener('click', function () {
          selectedFiberId = hint.id;
          _renderDetail(hint.id);
        });

        hintsSection.appendChild(hintCard);
      });
    }).catch(function () {
      var loadingEl = hintsSection.querySelector('.hints-loading');
      if (loadingEl) loadingEl.textContent = '힌트를 불러올 수 없습니다.';
    });
  }

  function _createReplyElement(reply, fiberId) {
    var el = document.createElement('div');
    el.className = 'fiber-reply';
    el.dataset.replyId = reply.id;
    el.innerHTML =
      '<div class="fiber-reply__header">' +
        '<span class="fiber-reply__time">' + _timeAgo(reply.created_at) + '</span>' +
        '<button class="fiber-reply__delete" title="삭제">&times;</button>' +
      '</div>' +
      '<p class="fiber-reply__note">' + esc(reply.note) + '</p>';

    el.querySelector('.fiber-reply__delete').addEventListener('click', function (e) {
      e.stopPropagation();
      FiberAPI.deleteReply(fiberId, reply.id).then(function () { el.remove(); });
    });

    return el;
  }

  // ── Knot dialog ──

  function _openKnotDialog(fiberId, stitchList) {
    var dialog = document.getElementById('knotDialog');
    var list = document.getElementById('knotStitchList');
    var input = document.getElementById('knotInsight');
    var saveBtn = document.getElementById('knotSave');
    var cancelBtn = document.getElementById('knotCancel');
    if (!dialog || !list || !input) return;

    list.innerHTML = '';
    input.value = '';

    stitchList.forEach(function (s) {
      var otherId = s.fiber_a_id === fiberId ? s.fiber_b_id : s.fiber_a_id;
      var otherFiber = fibers.find(function (f) { return f.id === otherId; });
      var otherText = otherFiber ? otherFiber.text : '(삭제된 올)';
      if (otherText.length > 50) otherText = otherText.substring(0, 50) + '...';

      var item = document.createElement('label');
      item.className = 'knot-stitch-item';
      item.innerHTML =
        '<input type="checkbox" checked value="' + esc(s.id) + '" />' +
        '<span class="knot-stitch-item__text">' + esc(otherText) + '</span>' +
        (s.why ? '<span class="knot-stitch-item__why">' + esc(s.why) + '</span>' : '');
      list.appendChild(item);
    });

    dialog.classList.add('is-open');

    function cleanup() {
      dialog.classList.remove('is-open');
      saveBtn.onclick = null;
      cancelBtn.onclick = null;
    }

    saveBtn.onclick = function () {
      var insight = input.value.trim();
      if (!insight) { input.focus(); return; }

      var checked = list.querySelectorAll('input[type="checkbox"]:checked');
      var stitchIds = [];
      checked.forEach(function (cb) { stitchIds.push(cb.value); });

      if (!stitchIds.length) {
        KnittingDialog.alert('최소 1개의 코를 선택해주세요.');
        return;
      }

      FiberAPI.createKnot({ insight: insight, stitch_ids: stitchIds }).then(function () {
        cleanup();
        if (typeof GraphPanel !== 'undefined' && GraphPanel.refresh) GraphPanel.refresh();
      }).catch(function () {
        KnittingDialog.alert('매듭 생성 실패');
      });
    };

    cancelBtn.onclick = cleanup;
  }

  // ── Navigate to source note + scroll to highlight ──

  function _navigateToSource(fiber) {
    if (!fiber.source_note_id) return;
    if (typeof AppNavigate === 'undefined' || !AppNavigate.toNote) return;

    var ok = AppNavigate.toNote(fiber.source_note_id);
    if (!ok) return;

    // Wait for DOM update, then scroll to the highlight
    setTimeout(function () {
      var contentEl = NoteEditor.getContentElement();
      if (!contentEl) return;

      // First try: find existing highlight span
      var hl = contentEl.querySelector('[data-fiber-id="' + fiber.id + '"]');
      if (hl) {
        hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        hl.classList.add('text-highlight--flash');
        setTimeout(function () { hl.classList.remove('text-highlight--flash'); }, 1500);
        return;
      }

      // Fallback: try to restore range and scroll to it
      if (fiber.source_range) {
        // refreshHighlights may have applied it, check again
        refreshHighlights(fiber.source_note_id);
        setTimeout(function () {
          var hl2 = contentEl.querySelector('[data-fiber-id="' + fiber.id + '"]');
          if (hl2) {
            hl2.scrollIntoView({ behavior: 'smooth', block: 'center' });
            hl2.classList.add('text-highlight--flash');
            setTimeout(function () { hl2.classList.remove('text-highlight--flash'); }, 1500);
          }
        }, 100);
      }
    }, 150);
  }

  return {
    init: init,
    refresh: refresh,
    render: render,
    refreshHighlights: refreshHighlights,
    setScope: setScope,
    openKnotDialog: _openKnotDialog,
    showFiberDetail: function (fiberId) {
      selectedFiberId = fiberId;
      detailMode = true;
      render();
    }
  };
})();
