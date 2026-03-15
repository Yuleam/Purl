/**
 * 뜨개질 Chrome Extension — Background Service Worker
 */

const API_BASE = 'http://localhost:3001/api';

// 컨텍스트 메뉴 등록
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'catch-fiber',
    title: 'Catch piece',
    contexts: ['selection']
  });
});

// 우클릭 → API 호출 → 페이지에 토스트 표시
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'catch-fiber') return;

  const text = (info.selectionText || '').trim();
  if (!text) return;

  fetch(API_BASE + '/fibers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text,
      source: (tab && tab.url) || '',
      source_note_title: (tab && tab.title) || '',
      tension: 3,
      tone: 'positive'
    })
  })
    .then(r => {
      if (!r.ok) throw new Error('API ' + r.status);
      return r.json();
    })
    .then(fiber => {
      // 페이지에 토스트 + 생각 입력 UI 삽입
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showCaughtToast,
        args: [fiber.id, text]
      });
    })
    .catch(err => {
      console.error('[purl] Catch failed:', err);
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showErrorToast,
        args: [err.message]
      });
    });
});

// 페이지에 삽입되는 함수: 성공 토스트
// 원칙7(정교화 부호화) + 부화 효과: 잡기=채집 루프(빠르게), 결/생각=의미 구성 루프(선택적)
function showCaughtToast(fiberId, fiberText) {
  // 기존 토스트 제거
  var old = document.getElementById('knitting-toast');
  if (old) old.remove();

  var toneColors = { positive: '#b8956a', critic: '#c26b6b', hold: '#6ba3c2' };
  var toneBgs = { positive: '#faf5ef', critic: '#faf0f0', hold: '#f0f5fa' };
  var toneBtnStyle = 'padding:4px 10px;border:2px solid #e0dcd6;border-radius:4px;background:#fff;font-size:11px;cursor:pointer;text-align:center';

  var toast = document.createElement('div');
  toast.id = 'knitting-toast';
  toast.innerHTML =
    // 상단: 완료 메시지 + 닫기(X)
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<span style="font-weight:600;color:#b8956a">Caught!</span>' +
      '<button id="knitting-close" style="border:none;background:none;font-size:16px;color:#999;cursor:pointer;padding:0 2px;line-height:1">&times;</button>' +
    '</div>' +
    // 텍스트 미리보기
    '<div style="font-size:12px;color:#666;margin-bottom:8px;max-height:40px;overflow:hidden">' +
      fiberText.substring(0, 60) + (fiberText.length > 60 ? '...' : '') +
    '</div>' +
    // 결 선택 (한 줄, 선택적 — 기본 positive 선택됨)
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">' +
      '<span style="font-size:11px;color:#999;flex-shrink:0">Tone</span>' +
      '<button data-tone="positive" style="' + toneBtnStyle + ';border-color:#b8956a;background:#faf5ef;font-weight:600">Positive</button>' +
      '<button data-tone="critic" style="' + toneBtnStyle + '">Critic</button>' +
      '<button data-tone="hold" style="' + toneBtnStyle + '">Hold</button>' +
    '</div>' +
    // 생각 입력 (접힘 — 클릭하면 펼침)
    '<div id="knitting-thought-toggle" style="font-size:11px;color:#6ba3c2;cursor:pointer;margin-bottom:4px">+ Add thought</div>' +
    '<div id="knitting-thought-area" style="display:none">' +
      '<textarea id="knitting-thought" placeholder="What comes to mind..." ' +
        'style="width:100%;min-height:40px;border:1px solid #e0dcd6;border-radius:4px;padding:6px;font-size:12px;font-family:inherit;resize:none;background:#fff"></textarea>' +
    '</div>' +
    // 하단: 탐색기 링크
    '<div style="margin-top:6px;text-align:right">' +
      '<a id="knitting-explore" href="http://localhost:3001/explorer.html#' + fiberId + '" target="_blank" ' +
        'style="font-size:11px;color:#6ba3c2;text-decoration:none">View in explorer &rarr;</a>' +
    '</div>';

  toast.style.cssText =
    'position:fixed;bottom:20px;right:20px;width:280px;padding:14px;' +
    'background:#faf9f7;border:1px solid #e0dcd6;border-radius:8px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:2147483647;' +
    'font-family:-apple-system,Pretendard,sans-serif;font-size:13px;color:#2c2c2c;' +
    'transition:opacity 300ms ease-out';

  document.body.appendChild(toast);

  var selectedTone = 'positive'; // 기본값 — 이미 POST에서 저장됨
  var dirty = false; // 사용자가 기본값을 변경했는지

  // 자동 닫힘 타이머 (10초 — 결/생각 입력 여유)
  var autoCloseTimer = setTimeout(function () { _fadeAndRemove(); }, 10000);

  function _cancelAutoClose() {
    if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
  }

  function _fadeAndRemove() {
    toast.style.opacity = '0';
    setTimeout(function () { toast.remove(); }, 300);
  }

  function _patchAndClose() {
    _cancelAutoClose();
    var thought = '';
    var $thought = document.getElementById('knitting-thought');
    if ($thought) thought = $thought.value.trim();

    var body = {};
    if (selectedTone !== 'positive') body.tone = selectedTone;
    if (thought) body.thought = thought;

    if (Object.keys(body).length === 0) {
      _fadeAndRemove();
      return;
    }

    fetch('http://localhost:3001/api/fibers/' + fiberId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function () {
      toast.innerHTML = '<div style="text-align:center;color:#b8956a;font-weight:600;padding:4px 0">Saved</div>';
      setTimeout(function () { _fadeAndRemove(); }, 800);
    }).catch(function () {
      _fadeAndRemove();
    });
  }

  // X 닫기 — 변경사항 있으면 PATCH 후 닫기
  document.getElementById('knitting-close').addEventListener('click', function () {
    if (dirty) { _patchAndClose(); } else { _cancelAutoClose(); _fadeAndRemove(); }
  });

  // 결 선택 (한 줄 버튼)
  toast.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tone]');
    if (!btn) return;
    _cancelAutoClose();
    selectedTone = btn.dataset.tone;
    dirty = true;
    var buttons = toast.querySelectorAll('[data-tone]');
    for (var i = 0; i < buttons.length; i++) {
      var t = buttons[i].dataset.tone;
      if (t === selectedTone) {
        buttons[i].style.borderColor = toneColors[t];
        buttons[i].style.background = toneBgs[t];
        buttons[i].style.fontWeight = '600';
      } else {
        buttons[i].style.borderColor = '#e0dcd6';
        buttons[i].style.background = '#fff';
        buttons[i].style.fontWeight = 'normal';
      }
    }
  });

  // 생각 토글
  var $toggle = document.getElementById('knitting-thought-toggle');
  var $area = document.getElementById('knitting-thought-area');
  $toggle.addEventListener('click', function () {
    _cancelAutoClose();
    dirty = true;
    $area.style.display = '';
    $toggle.style.display = 'none';
    var $ta = document.getElementById('knitting-thought');
    if ($ta) $ta.focus();
  });

  // Ctrl+Enter → PATCH 후 닫기
  toast.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      _patchAndClose();
    }
  });

  // 탐색기 링크 클릭 시 변경사항 PATCH
  document.getElementById('knitting-explore').addEventListener('click', function () {
    if (dirty) _patchAndClose();
    else { _cancelAutoClose(); _fadeAndRemove(); }
  });
}

// 페이지에 삽입되는 함수: 에러 토스트
function showErrorToast(errMsg) {
  var old = document.getElementById('knitting-toast');
  if (old) old.remove();

  var toast = document.createElement('div');
  toast.id = 'knitting-toast';
  toast.textContent = 'Catch failed: ' + errMsg;
  toast.style.cssText =
    'position:fixed;bottom:20px;right:20px;padding:12px 16px;' +
    'background:#faf0f0;border:1px solid #c26b6b;border-radius:8px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:2147483647;' +
    'font-family:-apple-system,sans-serif;font-size:13px;color:#c26b6b';
  document.body.appendChild(toast);
  setTimeout(function () { toast.remove(); }, 3000);
}

// 팝업에서 올 잡기 요청
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'catch-fiber') {
    fetch(API_BASE + '/fibers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.data)
    })
      .then(r => {
        if (!r.ok) throw new Error('API ' + r.status);
        return r.json();
      })
      .then(fiber => sendResponse({ ok: true, fiber }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'health-check') {
    fetch(API_BASE + '/health')
      .then(r => r.json())
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
