/**
 * Knitting — Storage Layer
 * localStorage 래퍼. 향후 API 백엔드로 교체 가능하도록 인터페이스 통일.
 */
var KnittingStorage = (function () {
  'use strict';

  var PREFIX = 'knitting_';

  function _key(name) { return PREFIX + name; }

  function load(name) {
    try {
      var d = localStorage.getItem(_key(name));
      return d ? JSON.parse(d) : [];
    } catch (e) { return []; }
  }

  function save(name, data) {
    try { localStorage.setItem(_key(name), JSON.stringify(data)); } catch (e) {}
  }

  function remove(name) {
    try { localStorage.removeItem(_key(name)); } catch (e) {}
  }

  function getFlag(name) {
    return localStorage.getItem(_key(name));
  }

  function setFlag(name, val) {
    localStorage.setItem(_key(name), val);
  }

  return { load: load, save: save, remove: remove, getFlag: getFlag, setFlag: setFlag };
})();
