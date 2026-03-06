/**
 * Fiber API Client
 * 올/실/코 API 호출. IIFE 패턴, vanilla fetch().
 * 의존: 없음
 */
var FiberAPI = (function () {
  'use strict';

  var BASE_URL = 'http://localhost:3001/api';

  function _request(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(BASE_URL + path, opts).then(function (res) {
      if (res.status === 204) return null;
      if (!res.ok) throw new Error('API error: ' + res.status);
      return res.json();
    });
  }

  function catchFiber(data) {
    return _request('POST', '/fibers', data);
  }

  function listFibers(params) {
    var qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return _request('GET', '/fibers' + qs);
  }

  function getFiber(id) {
    return _request('GET', '/fibers/' + id);
  }

  function updateFiber(id, data) {
    return _request('PATCH', '/fibers/' + id, data);
  }

  function deleteFiber(id) {
    return _request('DELETE', '/fibers/' + id);
  }

  function getHints(id) {
    return _request('GET', '/fibers/' + id + '/hints');
  }

  function createStitch(data) {
    return _request('POST', '/stitches', data);
  }

  function listStitches(fiberId) {
    var qs = fiberId ? '?fiber_id=' + fiberId : '';
    return _request('GET', '/stitches' + qs);
  }

  function deleteStitch(id) {
    return _request('DELETE', '/stitches/' + id);
  }

  function listReplies(fiberId) {
    return _request('GET', '/fibers/' + fiberId + '/replies');
  }

  function addReply(fiberId, note) {
    return _request('POST', '/fibers/' + fiberId + '/replies', { note: note });
  }

  function deleteReply(fiberId, replyId) {
    return _request('DELETE', '/fibers/' + fiberId + '/replies/' + replyId);
  }

  // ── Knots (매듭) ──

  function createKnot(data) {
    return _request('POST', '/knots', data);
  }

  function listKnots() {
    return _request('GET', '/knots');
  }

  function getKnot(id) {
    return _request('GET', '/knots/' + id);
  }

  function updateKnot(id, data) {
    return _request('PATCH', '/knots/' + id, data);
  }

  function deleteKnot(id) {
    return _request('DELETE', '/knots/' + id);
  }

  function isAvailable() {
    return fetch(BASE_URL + '/health', { method: 'GET' })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  return {
    catchFiber: catchFiber, listFibers: listFibers,
    getFiber: getFiber, updateFiber: updateFiber, deleteFiber: deleteFiber,
    getHints: getHints,
    createStitch: createStitch, listStitches: listStitches, deleteStitch: deleteStitch,
    listReplies: listReplies, addReply: addReply, deleteReply: deleteReply,
    createKnot: createKnot, listKnots: listKnots, getKnot: getKnot,
    updateKnot: updateKnot, deleteKnot: deleteKnot,
    isAvailable: isAvailable
  };
})();
