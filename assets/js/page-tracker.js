/**
 * 页面访问埋点 - 轻量级、fire-and-forget
 * 每次页面加载时向 Supabase user_page_views 表写入一条记录
 */
(function initPageTracker() {
  'use strict';

  // 同一页面 3 秒内不重复上报（防刷新抖动）
  var THROTTLE_KEY = '__page_track_ts__';
  var THROTTLE_MS = 3000;

  function shouldSkip() {
    try {
      var last = Number(sessionStorage.getItem(THROTTLE_KEY) || 0);
      if (Date.now() - last < THROTTLE_MS) return true;
      sessionStorage.setItem(THROTTLE_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
    return false;
  }

  function track() {
    if (shouldSkip()) return;

    var helpers = window.authHelpers;
    if (!helpers || !helpers.getStoredUser || !helpers.getSupabaseConfig) return;

    var user = helpers.getStoredUser();
    if (!user || !user.open_id) return;

    var config = helpers.getSupabaseConfig();
    var baseUrl = config.url;
    var apiKey = config.publishableKey || config.anonKey;
    if (!baseUrl || !apiKey) return;

    var page = window.location.pathname || '/';
    // 标准化首页路径
    if (page === '/' || page === '/index.html') page = '/index.html';

    var payload = {
      user_open_id: String(user.open_id),
      user_name: String(user.name || user.en_name || ''),
      user_email: String(user.email || ''),
      page: page,
      referrer: document.referrer ? String(document.referrer).slice(0, 500) : '',
      screen_width: window.innerWidth || 0,
    };

    // Fire-and-forget POST，不阻塞页面
    try {
      fetch(baseUrl + '/rest/v1/user_page_views', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey,
          'Authorization': 'Bearer ' + apiKey,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(payload),
      }).catch(function() { /* 静默忽略 */ });
    } catch (e) { /* 静默忽略 */ }
  }

  // 页面加载后延迟 500ms 上报，避免影响关键渲染
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(track, 500);
    });
  } else {
    setTimeout(track, 500);
  }
})();
