/**
 * Detail Panel — 카드 인라인 확장으로 상세 정보 표시
 * 포커스 카드 클릭 → 해당 카드 내부 .focus-card__detail에 삽입
 * 원칙 5: 맥락 재현 (노드가 있는 자리에서 상세 보기)
 * 원칙 6: 부분→전체 점진 공개
 * 의존: FiberAPI
 */
var DetailPanel = (function () {
  'use strict';

  var currentNode = null;
  var currentCardEl = null;

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

  function init() {
    // 인라인 확장 모드: 별도 패널 없음
  }

  /**
   * 카드 인라인 확장으로 상세 정보 표시
   * @param {Object} node - { id, type, detail, signals }
   * @param {HTMLElement} cardEl - .focus-card 요소
   */
  function show(node, cardEl) {
    // 이전 확장 닫기
    close();

    if (!node || !node.detail || !cardEl) return;

    var $detail = cardEl.querySelector('.focus-card__detail');
    if (!$detail) return;

    currentNode = node;
    currentCardEl = cardEl;
    $detail.innerHTML = '';
    cardEl.classList.add('is-expanded');

    // 원칙 6: 힌트 카드의 잘린 텍스트 → 전체 텍스트 복원
    if (cardEl.dataset.fullText) {
      var textEl = cardEl.querySelector('.focus-card__text');
      if (textEl) textEl.textContent = cardEl.dataset.fullText;
    }

    // 비중심 카드: 포커스 이동 버튼
    var nodeId = node.id || node.node_id;
    if (!cardEl.classList.contains('is-center') && typeof FocusView !== 'undefined') {
      var navBtn = document.createElement('button');
      navBtn.className = 'detail-nav-btn';
      navBtn.textContent = '이 노드로 포커스 이동 \u2192';
      navBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        close();
        FocusView.setFocus(nodeId);
      });
      $detail.appendChild(navBtn);
    }

    var d = node.detail;
    var type = node.type;

    if (type === 'fiber') {
      _renderFiberDetail(d, $detail, cardEl);
    } else if (type === 'thread') {
      _renderThreadDetail(d, $detail, cardEl);
    } else if (type === 'stitch') {
      _renderStitchDetail(d, $detail, cardEl);
    } else if (type === 'fabric') {
      _renderFabricDetail(d, $detail, cardEl);
    }

    // 노드 ID
    var idDiv = document.createElement('div');
    idDiv.className = 'detail-id';
    idDiv.textContent = node.id || (node.node_id || '');
    $detail.appendChild(idDiv);

    // 유사도 신호
    if (node.signals) {
      var sigDiv = document.createElement('div');
      sigDiv.className = 'detail-signals';
      sigDiv.innerHTML =
        '<div class="detail-label">유사도 신호</div>' +
        '<div class="detail-signal"><span>임베딩</span><span>' + node.signals.embedding + '%</span></div>' +
        '<div class="detail-signal"><span>그래프</span><span>' + node.signals.graph + '%</span></div>' +
        (node.signals.tone ? '<div class="detail-signal"><span>결 대비</span><span>' + node.signals.tone + '%</span></div>' : '');
      $detail.appendChild(sigDiv);
    }
  }

  /** 현재 확장 닫기 */
  function close() {
    var prev = document.querySelector('.focus-card.is-expanded');
    if (prev) {
      prev.classList.remove('is-expanded');
      var prevDetail = prev.querySelector('.focus-card__detail');
      if (prevDetail) prevDetail.innerHTML = '';
      // 원칙 6: 전체 텍스트 → 잘린 텍스트로 복원
      if (prev.dataset.fullText) {
        var textEl = prev.querySelector('.focus-card__text');
        if (textEl) {
          var full = prev.dataset.fullText;
          textEl.textContent = full.length > 20 ? full.substring(0, 20) + '...' : full;
        }
      }
    }
    currentNode = null;
    currentCardEl = null;
  }

  /** 현재 확장 중인 카드 요소 반환 */
  function getExpandedCardEl() {
    return currentCardEl;
  }

  /** 인라인 에러 메시지 — 2초 후 자동 제거 */
  function _flashError(parentEl, msg) {
    var el = document.createElement('div');
    el.style.cssText = 'font-size:11px;color:var(--danger,#c26b6b);padding:2px 0;';
    el.textContent = msg || '실패했습니다';
    parentEl.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 2000);
  }

  // ── 올(fiber) 상세 ──

  function _renderFiberDetail(d, $container, cardEl) {
    // Tension (editable)
    var tensionDiv = document.createElement('div');
    tensionDiv.className = 'detail-section';
    tensionDiv.innerHTML = '<div class="detail-label">장력</div>';
    var dotsDiv = document.createElement('div');
    dotsDiv.className = 'tension-dots tension-dots--inline';
    for (var i = 1; i <= 5; i++) {
      var dot = document.createElement('span');
      dot.className = 'tension-dot' + (i <= (d.tension || 3) ? ' is-active' : '');
      dot.dataset.t = i;
      dot.textContent = i;
      dotsDiv.appendChild(dot);
    }
    dotsDiv.addEventListener('click', function (e) {
      var dd = e.target.closest('.tension-dot');
      if (!dd) return;
      var t = parseInt(dd.dataset.t);
      FiberAPI.updateFiber(d.id, { tension: t }).then(function (updated) {
        d.tension = updated.tension;
        dotsDiv.querySelectorAll('.tension-dot').forEach(function (dot2) {
          dot2.classList.toggle('is-active', parseInt(dot2.dataset.t) <= t);
        });
        _syncCardTension(cardEl, t);
      }).catch(function () { _flashError(tensionDiv, '장력 변경 실패'); });
    });
    tensionDiv.appendChild(dotsDiv);
    $container.appendChild(tensionDiv);

    // Tone (editable)
    var toneDiv = document.createElement('div');
    toneDiv.className = 'detail-section';
    toneDiv.innerHTML = '<div class="detail-label">결</div>';
    var toneSelector = document.createElement('div');
    toneSelector.className = 'tone-selector tone-selector--inline';
    [
      { key: 'resonance', label: '공명' },
      { key: 'friction', label: '마찰' },
      { key: 'question', label: '물음' }
    ].forEach(function (opt) {
      var btn = document.createElement('button');
      btn.className = 'tone-btn tone-btn--' + opt.key + ((d.tone || 'resonance') === opt.key ? ' is-active' : '');
      btn.dataset.tone = opt.key;
      btn.textContent = opt.label;
      toneSelector.appendChild(btn);
    });
    toneSelector.addEventListener('click', function (e) {
      var btn = e.target.closest('.tone-btn');
      if (!btn) return;
      var newTone = btn.dataset.tone;
      FiberAPI.updateFiber(d.id, { tone: newTone }).then(function (updated) {
        d.tone = updated.tone;
        toneSelector.querySelectorAll('.tone-btn').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.tone === newTone);
        });
        _syncCardTone(cardEl, newTone);
      }).catch(function () { _flashError(toneDiv, '결 변경 실패'); });
    });
    toneDiv.appendChild(toneSelector);
    $container.appendChild(toneDiv);

    // Source
    if (d.source_title || d.source_id) {
      var srcDiv = document.createElement('div');
      srcDiv.className = 'detail-section';
      srcDiv.innerHTML = '<div class="detail-label">출처</div><div class="detail-value">' + esc(d.source_title || d.source || '') + '</div>';
      $container.appendChild(srcDiv);
    }

    // Born from
    if (d.born_from_id) {
      var bornDiv = document.createElement('div');
      bornDiv.className = 'detail-section';
      bornDiv.innerHTML = '<div class="detail-label">탄생</div>';
      var bornLink = document.createElement('a');
      bornLink.href = '#';
      bornLink.className = 'detail-link';
      bornLink.textContent = d.born_from_id + ' (' + (d.born_from_type || '') + ')';
      bornLink.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof FocusView !== 'undefined') FocusView.setFocus(d.born_from_id);
      });
      bornDiv.appendChild(bornLink);
      $container.appendChild(bornDiv);
    }

    // Time
    var timeDiv = document.createElement('div');
    timeDiv.className = 'detail-section';
    timeDiv.innerHTML = '<div class="detail-label">잡은 시간</div><div class="detail-value">' + _timeAgo(d.caught_at) + '</div>';
    $container.appendChild(timeDiv);

    _loadConnectedThreads(d.id, $container);
    _loadReplies(d.id, $container, cardEl);

    // Delete
    _addDeleteButton('올', $container, function () {
      FiberAPI.deleteFiber(d.id).then(function () {
        close();
        if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
        if (typeof FocusView !== 'undefined') FocusView.setFocus(null);
      }).catch(function () { _flashError($container, '삭제 실패'); });
    });
  }

  // ── 실(thread) 상세 ──

  function _renderThreadDetail(d, $container, cardEl) {
    if (d.why) {
      var whyDiv = document.createElement('div');
      whyDiv.className = 'detail-text';
      whyDiv.textContent = d.why;
      $container.appendChild(whyDiv);
    }

    var threadFibers = d.fibers || [];
    threadFibers.forEach(function (f, idx) {
      _addNodeLink('올 ' + (idx + 1), f.id, f.text, $container);
    });

    var timeDiv = document.createElement('div');
    timeDiv.className = 'detail-section';
    timeDiv.innerHTML = '<div class="detail-label">생성</div><div class="detail-value">' + _timeAgo(d.created_at) + '</div>';
    $container.appendChild(timeDiv);

    _addDeleteButton('실', $container, function () {
      FiberAPI.deleteThread(d.id).then(function () {
        close();
        if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
        if (typeof FocusView !== 'undefined') FocusView.setFocus(null);
      }).catch(function () { _flashError($container, '삭제 실패'); });
    });
  }

  // ── 코(stitch) 상세 ──

  function _renderStitchDetail(d, $container, cardEl) {
    if (d.why) {
      var whyDiv = document.createElement('div');
      whyDiv.className = 'detail-text';
      whyDiv.textContent = d.why;
      $container.appendChild(whyDiv);
    }

    var members = d.members || [];
    members.forEach(function (m, idx) {
      var label = (m.type === 'fiber' ? '올' : '실') + ' ' + (idx + 1);
      var text = m.detail ? (m.detail.text || m.detail.why || m.id) : m.id;
      _addNodeLink(label, m.id, text, $container);
    });

    var timeDiv = document.createElement('div');
    timeDiv.className = 'detail-section';
    timeDiv.innerHTML = '<div class="detail-label">생성</div><div class="detail-value">' + _timeAgo(d.created_at) + '</div>';
    $container.appendChild(timeDiv);

    _addDeleteButton('코', $container, function () {
      FiberAPI.deleteStitch(d.id).then(function () {
        close();
        if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
        if (typeof FocusView !== 'undefined') FocusView.setFocus(null);
      }).catch(function () { _flashError($container, '삭제 실패'); });
    });
  }

  // ── 편물(fabric) 상세 ──

  function _renderFabricDetail(d, $container, cardEl) {
    if (d.title || d.name) {
      var titleDiv = document.createElement('div');
      titleDiv.className = 'detail-text detail-text--title';
      titleDiv.textContent = d.title || d.name;
      $container.appendChild(titleDiv);
    }

    if (d.description) {
      var descDiv = document.createElement('div');
      descDiv.className = 'detail-section';
      descDiv.innerHTML = '<div class="detail-value" style="color:var(--text-muted);font-style:italic;">' + esc(d.description) + '</div>';
      $container.appendChild(descDiv);
    }

    // 편물 읽기 뷰
    var readingSection = document.createElement('div');
    readingSection.className = 'detail-section fabric-reading';
    readingSection.innerHTML = '<div class="detail-label">엮인 구조</div><div class="fabric-reading__loading">불러오는 중...</div>';
    $container.appendChild(readingSection);

    // 비동기 호출 가드: 확장이 닫힌 후 응답이 오면 무시
    var cancelled = false;
    var checkCancelled = function () { return cancelled || !cardEl.classList.contains('is-expanded'); };

    FiberAPI.getFabricFull(d.id).then(function (full) {
      if (checkCancelled()) return;

      var loadingEl = readingSection.querySelector('.fabric-reading__loading');
      if (loadingEl) loadingEl.remove();

      var members = full.members || [];
      if (!members.length) {
        var emptyDiv = document.createElement('div');
        emptyDiv.className = 'fabric-reading__empty';
        emptyDiv.textContent = '아직 엮인 멤버가 없습니다.';
        readingSection.appendChild(emptyDiv);
        return;
      }

      members.forEach(function (m) {
        if (m.type === 'thread' && m.detail) {
          var t = m.detail;
          var threadCard = document.createElement('div');
          threadCard.className = 'fabric-thread-card';

          var whyDiv = document.createElement('div');
          whyDiv.className = 'fabric-thread-card__why';
          whyDiv.textContent = t.why || '\u2014';
          threadCard.appendChild(whyDiv);

          var threadFibers = t.fibers || [];
          threadFibers.forEach(function (f) {
            var fiberDiv = document.createElement('div');
            fiberDiv.className = 'fabric-thread-card__fiber';
            fiberDiv.innerHTML =
              '<span class="fabric-fiber__tone fabric-fiber__tone--' + (f.tone || 'resonance') + '"></span>' +
              '<span class="fabric-fiber__text">' + esc(f.text || '(삭제된 올)') + '</span>' +
              '<span class="fabric-fiber__tension">' + _tensionDots(f.tension) + '</span>';
            fiberDiv.style.cursor = 'pointer';
            fiberDiv.addEventListener('click', function (e) {
              e.stopPropagation();
              if (f.id && typeof FocusView !== 'undefined') FocusView.setFocus(f.id);
            });
            threadCard.appendChild(fiberDiv);
          });

          readingSection.appendChild(threadCard);
        } else if (m.type === 'fiber' && m.detail) {
          var fiberCard = document.createElement('div');
          fiberCard.className = 'fabric-thread-card__fiber';
          fiberCard.innerHTML =
            '<span class="fabric-fiber__tone fabric-fiber__tone--' + (m.detail.tone || 'resonance') + '"></span>' +
            '<span class="fabric-fiber__text">' + esc(m.detail.text || '') + '</span>' +
            '<span class="fabric-fiber__tension">' + _tensionDots(m.detail.tension) + '</span>';
          fiberCard.style.cursor = 'pointer';
          fiberCard.addEventListener('click', function (e) {
            e.stopPropagation();
            if (m.detail.id && typeof FocusView !== 'undefined') FocusView.setFocus(m.detail.id);
          });
          readingSection.appendChild(fiberCard);
        }
      });
    }).catch(function () {
      if (checkCancelled()) return;
      var loadingEl = readingSection.querySelector('.fabric-reading__loading');
      if (loadingEl) loadingEl.textContent = '구조를 불러올 수 없습니다.';
    });

    // Insight (editable)
    var insightSection = document.createElement('div');
    insightSection.className = 'detail-section';
    insightSection.innerHTML = '<div class="detail-label">통찰</div>';
    var insightInput = document.createElement('textarea');
    insightInput.className = 'detail-textarea';
    insightInput.rows = 3;
    insightInput.value = d.insight || '';
    insightInput.placeholder = '이 편물에 대한 통찰...';
    insightSection.appendChild(insightInput);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'detail-save-btn';
    saveBtn.textContent = '저장';
    saveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      FiberAPI.updateFabric(d.id, { insight: insightInput.value.trim() }).then(function () {
        saveBtn.textContent = '저장됨';
        setTimeout(function () { saveBtn.textContent = '저장'; }, 1000);
      }).catch(function () { _flashError(insightSection, '저장 실패'); });
    });
    insightSection.appendChild(saveBtn);
    $container.appendChild(insightSection);

    var timeDiv = document.createElement('div');
    timeDiv.className = 'detail-section';
    timeDiv.innerHTML = '<div class="detail-label">생성</div><div class="detail-value">' + _timeAgo(d.created_at) + '</div>';
    $container.appendChild(timeDiv);

    _addDeleteButton('편물', $container, function () {
      FiberAPI.deleteFabric(d.id).then(function () {
        close();
        if (typeof SourcePanel !== 'undefined') SourcePanel.refresh();
        if (typeof FocusView !== 'undefined') FocusView.setFocus(null);
      }).catch(function () { _flashError($container, '삭제 실패'); });
    });
  }

  function _tensionDots(tension) {
    var t = tension || 0;
    var dots = '';
    for (var i = 1; i <= 5; i++) {
      dots += '<span class="fabric-tension-dot' + (i <= t ? ' is-active' : '') + '"></span>';
    }
    return dots;
  }

  // ── 카드 DOM 클래스 동기화 (개선 제안 3) ──

  function _syncCardTension(cardEl, newTension) {
    if (!cardEl) return;
    for (var i = 1; i <= 5; i++) {
      cardEl.classList.remove('tension-' + i);
    }
    cardEl.classList.add('tension-' + Math.min(5, Math.max(1, newTension)));
  }

  function _syncCardTone(cardEl, newTone) {
    if (!cardEl) return;
    cardEl.classList.remove('tone-resonance', 'tone-friction', 'tone-question');
    cardEl.classList.add('tone-' + newTone);
  }

  // ── Helpers ──

  function _addNodeLink(label, nodeId, text, $container) {
    var div = document.createElement('div');
    div.className = 'detail-section';
    div.innerHTML = '<div class="detail-label">' + esc(label) + '</div>';
    var link = document.createElement('a');
    link.href = '#';
    link.className = 'detail-link';
    link.textContent = text ? (text.length > 40 ? text.substring(0, 40) + '...' : text) : nodeId;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof FocusView !== 'undefined') FocusView.setFocus(nodeId);
    });
    div.appendChild(link);
    $container.appendChild(div);
  }

  function _loadReplies(fiberId, $container, cardEl) {
    var section = document.createElement('div');
    section.className = 'detail-section detail-thoughts';
    section.innerHTML = '<div class="detail-label">생각 적기</div>';

    // Input area
    var inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
    var input = document.createElement('input');
    input.className = 'detail-textarea';
    input.type = 'text';
    input.placeholder = '이 올에 대한 생각을 적어보세요...';
    input.style.cssText = 'flex:1;padding:6px 8px;margin:0;';
    var addBtn = document.createElement('button');
    addBtn.className = 'detail-save-btn';
    addBtn.textContent = '추가';
    addBtn.style.cssText = 'margin:0;white-space:nowrap;';
    inputWrap.appendChild(input);
    inputWrap.appendChild(addBtn);
    section.appendChild(inputWrap);

    // Reply list container
    var listDiv = document.createElement('div');
    listDiv.className = 'detail-reply-list';
    section.appendChild(listDiv);

    $container.appendChild(section);

    function renderReplies(replies) {
      listDiv.innerHTML = '';
      if (!replies || !replies.length) {
        listDiv.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0;">아직 적은 생각이 없습니다.</div>';
        return;
      }
      replies.forEach(function (r) {
        var item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:6px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,0.04));';
        var text = document.createElement('div');
        text.style.cssText = 'flex:1;font-size:12px;color:var(--text);line-height:1.5;';
        text.textContent = r.note || '';
        var delBtn = document.createElement('button');
        delBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:10px;padding:2px 4px;flex-shrink:0;';
        delBtn.textContent = '\u2715';
        delBtn.title = '삭제';
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          FiberAPI.deleteReply(fiberId, r.id).then(function () {
            FiberAPI.listReplies(fiberId).then(renderReplies);
          }).catch(function () { _flashError(listDiv, '삭제 실패'); });
        });
        item.appendChild(text);
        item.appendChild(delBtn);
        listDiv.appendChild(item);
      });
    }

    function submitReply() {
      var val = input.value.trim();
      if (!val) return;
      input.value = '';
      FiberAPI.addReply(fiberId, val).then(function () {
        FiberAPI.listReplies(fiberId).then(renderReplies);
      }).catch(function () { _flashError(section, '추가 실패'); });
    }

    addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      submitReply();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitReply();
    });
    // 입력 클릭 시 카드 클릭 이벤트 전파 방지
    input.addEventListener('click', function (e) { e.stopPropagation(); });

    FiberAPI.listReplies(fiberId).then(renderReplies).catch(function (err) {
      console.error('[DetailPanel] listReplies error:', err);
    });
  }

  function _loadConnectedThreads(fiberId, $container) {
    FiberAPI.listThreads(fiberId).then(function (threads) {
      if (!threads || !threads.length) return;
      // 확장이 이미 닫혔으면 무시
      if (!currentCardEl || !currentCardEl.classList.contains('is-expanded')) return;

      var section = document.createElement('div');
      section.className = 'detail-section';
      section.innerHTML = '<div class="detail-label">연결된 실 (' + threads.length + ')</div>';
      threads.forEach(function (t) {
        var link = document.createElement('a');
        link.href = '#';
        link.className = 'detail-link detail-link--block';
        var otherIds = (t.fiber_ids || []).filter(function (id) { return id !== fiberId; });
        var displayText = t.why || otherIds.join(', ') || t.id;
        link.textContent = displayText.length > 40 ? displayText.substring(0, 40) + '...' : displayText;
        link.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof FocusView !== 'undefined') FocusView.setFocus(t.id);
        });
        section.appendChild(link);
      });
      $container.appendChild(section);
    }).catch(function (err) {
      console.error('[DetailPanel] listThreads error:', err);
    });
  }

  function _addDeleteButton(typeName, $container, onDelete) {
    var btn = document.createElement('button');
    btn.className = 'detail-delete-btn';
    btn.textContent = typeName + ' 삭제';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof KnittingDialog !== 'undefined') {
        KnittingDialog.confirm({
          message: '이 ' + typeName + '을(를) 삭제할까요?',
          confirmLabel: '삭제',
          danger: true
        }, onDelete);
      } else {
        if (confirm('이 ' + typeName + '을(를) 삭제할까요?')) onDelete();
      }
    });
    $container.appendChild(btn);
  }

  return {
    init: init,
    show: show,
    close: close,
    getExpandedCardEl: getExpandedCardEl
  };
})();
