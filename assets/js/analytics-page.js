(function attachAnalyticsPage(window) {
  'use strict';

  var helpers = window.authHelpers || {};
  var esc = (window.sharedUtils && window.sharedUtils.escapeHtml)
    ? window.sharedUtils.escapeHtml
    : function (v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      };

  var MAX_ROWS = 5000;
  var state = { range: 7, rows: [] };

  // 路径 → 友好页面名
  var PAGE_NAMES = {
    '/index.html': '首页 · 数据日报',
    '/plan-dashboard.html': '计划拆解',
    '/supabase-dashboard.html': '数据看板',
    '/budget-scorecard.html': '人群评分',
    '/metric-rules.html': '指标与规则台',
    '/analytics.html': '访问统计',
  };

  function pageName(path) {
    if (!path) return '(未知)';
    return PAGE_NAMES[path] || path;
  }

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function setStats(stats) {
    var grid = document.getElementById('stats-grid');
    if (!grid) return;
    var cards = [
      { value: stats.users, label: '访问用户数' },
      { value: stats.views, label: '总访问次数' },
      { value: stats.pages, label: '覆盖页面数' },
      { value: stats.today, label: '今日访问' },
    ];
    grid.innerHTML = cards.map(function (c) {
      return '<div class="stat-card"><strong>' + c.value + '</strong><span>' + c.label + '</span></div>';
    }).join('');
  }

  function renderUserTable(rows) {
    var wrap = document.getElementById('user-table-wrap');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = '<div class="state-box">该时间范围内暂无访问记录</div>'; return; }

    var map = {};
    rows.forEach(function (r) {
      var key = r.user_open_id || r.user_name || '(未知)';
      if (!map[key]) {
        map[key] = { name: r.user_name || r.user_email || '(未命名)', visits: 0, pages: {}, last: 0 };
      }
      map[key].visits += 1;
      map[key].pages[r.page || ''] = true;
      var t = new Date(r.created_at).getTime();
      if (t > map[key].last) map[key].last = t;
    });

    var list = Object.keys(map).map(function (k) {
      var u = map[k];
      return { name: u.name, visits: u.visits, pages: Object.keys(u.pages).length, last: u.last };
    }).sort(function (a, b) { return b.visits - a.visits; });

    var maxVisits = list[0] ? list[0].visits : 1;
    var body = list.map(function (u) {
      var pct = Math.max(6, Math.round((u.visits / maxVisits) * 100));
      return '<tr>'
        + '<td>' + esc(u.name) + '</td>'
        + '<td class="num"><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div><span>' + u.visits + '</span></div></td>'
        + '<td class="num">' + u.pages + '</td>'
        + '<td class="muted">' + fmtTime(new Date(u.last).toISOString()) + '</td>'
        + '</tr>';
    }).join('');

    wrap.innerHTML = '<table class="data-table"><thead><tr>'
      + '<th>用户</th><th>访问次数</th><th>覆盖页面</th><th>最近访问</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function renderPageTable(rows) {
    var wrap = document.getElementById('page-table-wrap');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = '<div class="state-box">该时间范围内暂无访问记录</div>'; return; }

    var map = {};
    rows.forEach(function (r) {
      var p = r.page || '(未知)';
      if (!map[p]) map[p] = { views: 0, users: {} };
      map[p].views += 1;
      map[p].users[r.user_open_id || r.user_name || ''] = true;
    });

    var list = Object.keys(map).map(function (p) {
      return { page: p, views: map[p].views, users: Object.keys(map[p].users).length };
    }).sort(function (a, b) { return b.views - a.views; });

    var maxViews = list[0] ? list[0].views : 1;
    var body = list.map(function (p) {
      var pct = Math.max(6, Math.round((p.views / maxViews) * 100));
      return '<tr>'
        + '<td><span class="page-chip">' + esc(pageName(p.page)) + '</span></td>'
        + '<td class="num"><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div><span>' + p.views + '</span></div></td>'
        + '<td class="num">' + p.users + '</td>'
        + '</tr>';
    }).join('');

    wrap.innerHTML = '<table class="data-table"><thead><tr>'
      + '<th>页面</th><th>访问次数</th><th>访问用户</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function renderRecentTable(rows) {
    var wrap = document.getElementById('recent-table-wrap');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = '<div class="state-box">该时间范围内暂无访问记录</div>'; return; }

    var recent = rows.slice().sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }).slice(0, 100);

    var body = recent.map(function (r) {
      return '<tr>'
        + '<td class="muted">' + fmtTime(r.created_at) + '</td>'
        + '<td>' + esc(r.user_name || r.user_email || '(未命名)') + '</td>'
        + '<td><span class="page-chip">' + esc(pageName(r.page)) + '</span></td>'
        + '</tr>';
    }).join('');

    wrap.innerHTML = '<table class="data-table"><thead><tr>'
      + '<th>时间</th><th>用户</th><th>页面</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function renderAll() {
    var rows = state.rows;
    var now = Date.now();
    var filtered = rows;
    if (state.range > 0) {
      var cutoff = now - state.range * 24 * 60 * 60 * 1000;
      filtered = rows.filter(function (r) { return new Date(r.created_at).getTime() >= cutoff; });
    }

    var users = {};
    var pages = {};
    var todayStart = startOfToday();
    var todayCount = 0;
    filtered.forEach(function (r) {
      users[r.user_open_id || r.user_name || ''] = true;
      pages[r.page || ''] = true;
      if (new Date(r.created_at).getTime() >= todayStart) todayCount += 1;
    });

    setStats({
      users: Object.keys(users).length,
      views: filtered.length,
      pages: Object.keys(pages).length,
      today: todayCount,
    });
    renderUserTable(filtered);
    renderPageTable(filtered);
    renderRecentTable(filtered);
  }

  function showError(msg) {
    ['user-table-wrap', 'page-table-wrap', 'recent-table-wrap'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="state-box error">' + esc(msg) + '</div>';
    });
  }

  async function loadData() {
    var cfg = helpers.getSupabaseConfig ? helpers.getSupabaseConfig() : null;
    if (!cfg || !cfg.url) { showError('未找到 Supabase 配置'); return; }

    var headers = helpers.getSupabaseRestHeaders ? helpers.getSupabaseRestHeaders() : {};
    var url = cfg.url + '/rest/v1/user_page_views'
      + '?select=user_name,user_open_id,user_email,page,referrer,created_at'
      + '&order=created_at.desc&limit=' + MAX_ROWS;

    ['user-table-wrap', 'page-table-wrap', 'recent-table-wrap'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="state-box">加载中…</div>';
    });

    try {
      var resp = await fetch(url, { headers: headers, credentials: 'omit' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      state.rows = Array.isArray(data) ? data : [];
      renderAll();
    } catch (e) {
      showError('加载失败：' + (e && e.message ? e.message : e));
    }
  }

  function bindToolbar() {
    var tabs = document.getElementById('range-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.range-tab');
        if (!btn) return;
        state.range = Number(btn.getAttribute('data-range'));
        tabs.querySelectorAll('.range-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderAll();
      });
    }
    var refresh = document.getElementById('refresh-btn');
    if (refresh) refresh.addEventListener('click', loadData);
  }

  function init() {
    bindToolbar();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
