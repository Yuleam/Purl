/**
 * 뜨개질 Chrome Extension — Popup Script
 */
(function () {
  var $text = document.getElementById('textInput');
  var $source = document.getElementById('sourceDisplay');
  var $sourceField = document.getElementById('sourceField');
  var $status = document.getElementById('status');
  var $saveBtn = document.getElementById('saveBtn');
  var $offline = document.getElementById('offlineMsg');
  var $form = document.getElementById('mainForm');

  var tension = 3;
  var tone = 'positive';
  var source = '';
  var sourceTitle = '';

  // 서버 상태 확인
  chrome.runtime.sendMessage({ type: 'health-check' }, function (res) {
    if (!res || !res.ok) {
      $offline.style.display = '';
      $form.style.opacity = '0.4';
      $form.style.pointerEvents = 'none';
    }
  });

  // 컨텍스트 메뉴에서 넘어온 데이터 확인
  chrome.storage.local.get('pendingFiber', function (result) {
    if (result.pendingFiber) {
      var data = result.pendingFiber;
      if (data.text) $text.value = data.text;
      if (data.source) {
        source = data.source;
        sourceTitle = data.sourceTitle || '';
        $source.textContent = sourceTitle || data.source;
        $sourceField.style.display = '';
      }
      chrome.storage.local.remove('pendingFiber');
    }

    // pendingFiber가 없으면 현재 탭 정보를 출처로 표시
    if (!source) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs && tabs[0] && tabs[0].url) {
          source = tabs[0].url;
          sourceTitle = tabs[0].title || '';
          $source.textContent = sourceTitle || source;
          $sourceField.style.display = '';
        }
      });
    }

    $text.focus();
  });

  // 장력
  document.getElementById('tensionRow').addEventListener('click', function (e) {
    var dot = e.target.closest('.tension-dot');
    if (!dot) return;
    tension = parseInt(dot.dataset.t);
    document.querySelectorAll('.tension-dot').forEach(function (d) {
      d.classList.toggle('is-active', parseInt(d.dataset.t) <= tension);
    });
  });

  // 결
  document.getElementById('toneRow').addEventListener('click', function (e) {
    var btn = e.target.closest('.tone-btn');
    if (!btn) return;
    tone = btn.dataset.tone;
    document.querySelectorAll('.tone-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.tone === tone);
    });
  });

  // 잡기
  $saveBtn.addEventListener('click', function () {
    var text = $text.value.trim();
    if (!text) return;
    $saveBtn.disabled = true;

    chrome.runtime.sendMessage({
      type: 'catch-fiber',
      data: {
        text: text,
        source: source,
        source_note_title: sourceTitle,
        tension: tension,
        tone: tone
      }
    }, function (res) {
      if (res && res.ok) {
        $status.className = 'status status--ok';
        $status.textContent = 'Caught!';
        $status.style.display = '';
        setTimeout(function () { window.close(); }, 800);
      } else {
        $status.className = 'status status--err';
        $status.textContent = 'Failed: ' + (res ? res.error : 'unknown');
        $status.style.display = '';
        $saveBtn.disabled = false;
      }
    });
  });

  // 취소
  document.getElementById('cancelBtn').addEventListener('click', function () {
    window.close();
  });

  // Ctrl+Enter
  $text.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      $saveBtn.click();
    }
  });
})();
