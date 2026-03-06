/**
 * Knitting — Bookshelf (책장) Core
 * 노트를 그룹핑하는 폴더 CRUD. DOM 무관 — 순수 데이터 로직.
 * 의존: KnittingStorage
 */
var KnittingBookshelf = (function () {
  'use strict';

  var STORE_KEY = 'bookshelves';
  var bookshelves = [];

  function uid() {
    return 'bs_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  }

  function _save() { KnittingStorage.save(STORE_KEY, bookshelves); }

  function init() {
    bookshelves = KnittingStorage.load(STORE_KEY);
    return bookshelves;
  }

  function getAll() {
    return bookshelves.slice().sort(function (a, b) { return a.order - b.order; });
  }

  function getById(id) {
    return bookshelves.find(function (b) { return b.id === id; });
  }

  function create(title, parentId) {
    var b = {
      id: uid(),
      title: title || '새 책장',
      parentId: parentId || null,
      order: bookshelves.length,
      collapsed: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    bookshelves.push(b);
    _save();
    return b;
  }

  function update(id, fields) {
    var b = getById(id);
    if (!b) return null;
    Object.keys(fields).forEach(function (k) {
      if (k !== 'id' && k !== 'createdAt') b[k] = fields[k];
    });
    b.updatedAt = Date.now();
    _save();
    return b;
  }

  function remove(id) {
    var target = getById(id);
    var parentId = target ? target.parentId || null : null;
    // 하위 폴더들의 parentId를 삭제되는 폴더의 parentId로 올림
    bookshelves.forEach(function (b) {
      if (b.parentId === id) b.parentId = parentId;
    });
    bookshelves = bookshelves.filter(function (b) { return b.id !== id; });
    bookshelves.forEach(function (b, i) { b.order = i; });
    _save();
  }

  function getRoots() {
    return bookshelves
      .filter(function (b) { return !b.parentId; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  function getChildren(parentId) {
    return bookshelves
      .filter(function (b) { return b.parentId === parentId; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  function getDescendantIds(id) {
    var result = [id];
    var children = getChildren(id);
    children.forEach(function (c) {
      result = result.concat(getDescendantIds(c.id));
    });
    return result;
  }

  function toggleCollapsed(id) {
    var b = getById(id);
    if (!b) return null;
    b.collapsed = !b.collapsed;
    _save();
    return b;
  }

  return {
    init: init, getAll: getAll, getById: getById,
    create: create, update: update, remove: remove,
    toggleCollapsed: toggleCollapsed,
    getRoots: getRoots, getChildren: getChildren, getDescendantIds: getDescendantIds
  };
})();
