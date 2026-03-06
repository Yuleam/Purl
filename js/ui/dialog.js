/**
 * Knitting UI — Custom Dialog
 * alert, confirm, prompt 대체. 크롬 네이티브 팝업 제거용.
 */
var KnittingDialog = (function () {
  'use strict';

  var $overlay, $dialog, $title, $message, $input, $actions;
  var _cleanup = null;

  function _ensureDOM() {
    if ($overlay) return;
    $overlay = document.getElementById('customDialog');
    $dialog = $overlay.querySelector('.dialog');
    $title = document.getElementById('customDialogTitle');
    $message = document.getElementById('customDialogMessage');
    $input = document.getElementById('customDialogInput');
    $actions = document.getElementById('customDialogActions');
  }

  function _open(opts) {
    _ensureDOM();
    $title.textContent = opts.title || '';
    $title.style.display = opts.title ? '' : 'none';
    $message.textContent = opts.message || '';
    $message.style.display = opts.message ? '' : 'none';

    if (opts.input) {
      $input.style.display = '';
      $input.value = opts.inputValue || '';
      $input.placeholder = opts.placeholder || '';
    } else {
      $input.style.display = 'none';
    }

    // danger mode
    $dialog.classList.toggle('dialog--danger', !!opts.danger);

    // build buttons
    $actions.innerHTML = '';
    (opts.buttons || []).forEach(function (btn) {
      var el = document.createElement('button');
      el.className = 'dialog__btn ' + (btn.cls || '');
      el.textContent = btn.label;
      el.addEventListener('click', function () { _close(); btn.onClick(); });
      $actions.appendChild(el);
    });

    $overlay.classList.add('is-open');

    // focus input or primary button
    if (opts.input) {
      setTimeout(function () { $input.focus(); }, 50);
    }

    // Enter key
    var onKey = function (e) {
      if (e.key === 'Escape') {
        _close();
        if (opts.onCancel) opts.onCancel();
      }
      if (e.key === 'Enter' && opts.onEnter) {
        _close();
        opts.onEnter();
      }
    };
    document.addEventListener('keydown', onKey);

    // overlay click = cancel
    var onOverlay = function (e) {
      if (e.target === $overlay) {
        _close();
        if (opts.onCancel) opts.onCancel();
      }
    };
    $overlay.addEventListener('click', onOverlay);

    _cleanup = function () {
      document.removeEventListener('keydown', onKey);
      $overlay.removeEventListener('click', onOverlay);
    };
  }

  function _close() {
    if ($overlay) $overlay.classList.remove('is-open');
    if (_cleanup) { _cleanup(); _cleanup = null; }
  }

  /**
   * alert 대체
   * KnittingDialog.alert('메시지')
   * KnittingDialog.alert('제목', '메시지')
   */
  function alert(titleOrMsg, msg) {
    var title = msg ? titleOrMsg : '';
    var message = msg || titleOrMsg;
    _open({
      title: title,
      message: message,
      buttons: [
        { label: '확인', cls: 'dialog__btn--save', onClick: function () {} }
      ],
      onEnter: function () {},
      onCancel: function () {}
    });
  }

  /**
   * confirm 대체
   * KnittingDialog.confirm('메시지', function() { ... })
   * KnittingDialog.confirm({ title, message, confirmLabel, danger }, onConfirm)
   */
  function confirm(optsOrMsg, onConfirm) {
    var opts = typeof optsOrMsg === 'string'
      ? { message: optsOrMsg }
      : optsOrMsg;

    _open({
      title: opts.title || '',
      message: opts.message || '',
      danger: opts.danger || false,
      buttons: [
        { label: '취소', cls: 'dialog__btn--cancel', onClick: function () {} },
        {
          label: opts.confirmLabel || '확인',
          cls: opts.danger ? 'dialog__btn--danger' : 'dialog__btn--save',
          onClick: function () { if (onConfirm) onConfirm(); }
        }
      ],
      onEnter: function () { if (onConfirm) onConfirm(); },
      onCancel: function () {}
    });
  }

  /**
   * prompt 대체
   * KnittingDialog.prompt({ title, message, placeholder, value }, function(val) { ... })
   */
  function prompt(opts, onSubmit) {
    _open({
      title: opts.title || '',
      message: opts.message || '',
      input: true,
      inputValue: opts.value || '',
      placeholder: opts.placeholder || '',
      buttons: [
        { label: '취소', cls: 'dialog__btn--cancel', onClick: function () {} },
        {
          label: opts.submitLabel || '확인',
          cls: 'dialog__btn--save',
          onClick: function () { if (onSubmit) onSubmit($input.value); }
        }
      ],
      onEnter: function () { if (onSubmit) onSubmit($input.value); },
      onCancel: function () {}
    });
  }

  return { alert: alert, confirm: confirm, prompt: prompt };
})();
