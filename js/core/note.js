/**
 * Knitting — Note Core
 * 노트 CRUD. 서버 API 우선, localStorage 폴백.
 * 의존: KnittingStorage (폴백용)
 */
var KnittingNote = (function () {
  'use strict';

  var STORE_KEY = 'notes';
  var API_BASE = 'http://localhost:3001/api/notes';
  var notes = [];
  var _serverAvailable = false;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  }

  // ─── API helpers ───

  function _api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API_BASE + (path || ''), opts).then(function (r) {
      if (r.status === 204) return null;
      if (!r.ok) throw new Error('API ' + r.status);
      return r.json();
    });
  }

  function _toServerFormat(note) {
    return {
      type: note.type || 'blank',
      title: note.title || '',
      content: note.content || '',
      htmlContent: note.htmlContent || '',
      answers: note.answers || null,
      bookshelfId: note.bookshelfId || null
    };
  }

  function _fromServerFormat(n) {
    return {
      id: n.id,
      type: n.type || 'blank',
      title: n.title || '',
      content: n.content || '',
      htmlContent: n.html_content || '',
      answers: n.answers || null,
      bookshelfId: n.bookshelf_id || null,
      createdAt: n.created_at,
      updatedAt: n.updated_at
    };
  }

  // ─── Init (async) ───

  function init() {
    // 동기 로드: localStorage에서 즉시 로드 (깜빡임 방지)
    notes = KnittingStorage.load(STORE_KEY);

    // 비동기: 서버 확인 → 이전 → 서버에서 로드
    _initAsync();

    return notes;
  }

  function _initAsync() {
    _api('GET', '?limit=1').then(function () {
      _serverAvailable = true;

      // localStorage 노트가 있으면 서버로 이전
      var localNotes = KnittingStorage.load(STORE_KEY);
      if (localNotes.length) {
        return _api('POST', '/import', { notes: localNotes }).then(function () {
          KnittingStorage.remove(STORE_KEY);
          console.log('[note] localStorage → 서버 이전 완료');
        });
      }
    }).then(function () {
      if (!_serverAvailable) return;

      // 서버에서 전체 노트 로드
      return _api('GET', '?limit=500&sort=updated_at&order=DESC').then(function (list) {
        if (list) {
          notes = list.map(_fromServerFormat);
          // 외부에서 renderNoteList를 트리거하기 위한 이벤트
          window.dispatchEvent(new CustomEvent('knitting:notes-loaded'));
        }
      });
    }).catch(function (e) {
      console.log('[note] 서버 연결 불가, localStorage 사용:', e.message);
    });
  }

  // ─── CRUD ───

  function getAll() { return notes; }

  function getById(id) {
    return notes.find(function (n) { return n.id === id; });
  }

  function create(data) {
    var note = {
      id: uid(),
      type: data.type || 'blank',
      title: data.title || '',
      content: data.content || '',
      htmlContent: data.htmlContent || '',
      answers: data.answers || null,
      bookshelfId: data.bookshelfId || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    notes.unshift(note);
    _persist(note, 'create');
    return note;
  }

  function update(id, data) {
    var note = getById(id);
    if (!note) return null;
    Object.keys(data).forEach(function (k) {
      if (k !== 'id' && k !== 'createdAt') note[k] = data[k];
    });
    note.updatedAt = Date.now();
    _persist(note, 'update');
    return note;
  }

  function remove(id) {
    notes = notes.filter(function (n) { return n.id !== id; });
    _persist({ id: id }, 'delete');
  }

  function save(id, editorData) {
    if (!editorData.title && !editorData.content && !_hasTemplateContent(editorData)) {
      return null;
    }
    if (id) {
      return update(id, editorData);
    } else {
      return create(editorData);
    }
  }

  function _hasTemplateContent(data) {
    if (data.type !== 'template' || !data.answers) return false;
    return Object.values(data.answers).some(function (v) { return v && v.length > 0; });
  }

  // ─── Persistence ───

  function _persist(note, action) {
    if (_serverAvailable) {
      _persistToServer(note, action);
    } else {
      KnittingStorage.save(STORE_KEY, notes);
    }
  }

  function _persistToServer(note, action) {
    var p;
    if (action === 'create') {
      p = _api('POST', '', _toServerFormat(note)).then(function (created) {
        // 서버가 생성한 ID로 교체 (이미 메모리에 있는 객체 업데이트)
        if (created && created.id !== note.id) {
          note.id = created.id;
        }
      });
    } else if (action === 'update') {
      p = _api('PATCH', '/' + note.id, _toServerFormat(note));
    } else if (action === 'delete') {
      p = _api('DELETE', '/' + note.id);
    }
    if (p) p.catch(function (e) {
      console.error('[note] 서버 저장 실패, localStorage 폴백:', e.message);
      KnittingStorage.save(STORE_KEY, notes);
    });
  }

  // ─── Helpers ───

  function getText(note) {
    if (!note) return '';
    if (note.type === 'blank') return note.content || '';
    if (note.answers) return Object.values(note.answers).filter(Boolean).join('\n\n');
    return '';
  }

  function getPreview(note) {
    if (!note) return '';
    if (note.type === 'blank') return note.content || '';
    if (note.answers) {
      return Object.values(note.answers).filter(Boolean).join(' · ') || '';
    }
    return '';
  }

  return {
    init: init, getAll: getAll, getById: getById,
    create: create, update: update, remove: remove, save: save,
    getText: getText, getPreview: getPreview
  };
})();
