(function attachPlanDashboardRenderReferences(window) {
  const shared = window.PlanDashboardRenderShared;
  const {
    utils,
    stateModule,
    DOUBLE11_REFERENCE_MONTHS,
    DOUBLE11_REFERENCE_SUMMARY,
    DOUBLE11_REFERENCE_PHASES,
    SIX18_REFERENCE_MONTHS,
    SIX18_RHYTHM_MONTHS,
    SIX18_RHYTHM_PHASES,
    SIX18_REFERENCE_DAILY,
    SIX18_REFERENCE_PHASE_META,
    debounce,
    syncCollapsibleSection,
    getYearMonthIndex,
  } = shared;

  function renderTimeline() {
    const el = document.getElementById('timeline-container');
    if (!el) return;
    if (!syncCollapsibleSection('timeline')) return;
    const activities = stateModule.state.summary.activities || [];
    if (!activities.length) {
      el.innerHTML = '<div class="timeline-empty">当前日期范围内暂无活动节奏，点击"添加活动"即可创建。</div>';
      return;
    }

    const sorted = [...activities].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

    const cols = sorted.map((a) => {
      const meta = utils.getActivityTypeMeta(a.activity_type);
      const startLabel = utils.formatDateTimeLabel(a.start_date, a.start_time);
      const endLabel = utils.formatDateTimeLabel(a.end_date, a.end_time);
      const dateLabel = startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
      const sessions = (a.key_sessions || '').split(',').map((s) => s.trim()).filter(Boolean);
      return { activity: a, meta, dateLabel, sessions };
    });

    el.innerHTML = `
      <div class="tl-table-wrapper">
        <table class="tl-table">
          <tbody>
            <tr class="tl-row-date">
              <th class="tl-row-label">日期</th>
              ${cols.map((col) => `
                <td class="tl-cell" data-activity-id="${utils.escapeHtml(col.activity.id)}" style="border-top:3px solid ${col.meta.color}">
                  <span class="tl-date-text">${utils.escapeHtml(col.dateLabel)}</span>
                </td>
              `).join('')}
            </tr>
            <tr class="tl-row-rhythm">
              <th class="tl-row-label">平台节奏</th>
              ${cols.map((col) => `
                <td class="tl-cell" data-activity-id="${utils.escapeHtml(col.activity.id)}">
                  <span class="tl-rhythm-tag ${col.meta.className}">${utils.escapeHtml(col.meta.label)}</span>
                  <span class="tl-activity-name">${utils.escapeHtml(col.activity.activity_name)}</span>
                </td>
              `).join('')}
            </tr>
            <tr class="tl-row-sessions">
              <th class="tl-row-label">重要场次</th>
              ${cols.map((col) => `
                <td class="tl-cell" data-activity-id="${utils.escapeHtml(col.activity.id)}">
                  ${col.sessions.length
                    ? col.sessions.map((s) => `<span class="tl-session-pill">${utils.escapeHtml(s)}</span>`).join('')
                    : '<span class="tl-empty-hint">–</span>'}
                </td>
              `).join('')}
            </tr>
            <tr class="tl-row-ops">
              <th class="tl-row-label">运营动作</th>
              ${cols.map((col) => `
                <td class="tl-cell" data-activity-id="${utils.escapeHtml(col.activity.id)}">
                  ${col.activity.operations_action
                    ? `<span class="tl-ops-text">${utils.escapeHtml(col.activity.operations_action)}</span>`
                    : '<span class="tl-empty-hint">–</span>'}
                </td>
              `).join('')}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  function renderTimelineSkeleton() {
    const el = document.getElementById('timeline-container');
    if (!el) return;
    if (!syncCollapsibleSection('timeline')) return;
    const skeletonCols = Array(3).fill('').map(() => '<td class="tl-cell"><div class="skeleton-line" style="width:80%"></div></td>').join('');
    el.innerHTML = `
      <div class="tl-table-wrapper">
        <table class="tl-table">
          <tbody>
            ${Array(4).fill('').map((_, i) => `<tr><th class="tl-row-label"><div class="skeleton-line" style="width:50px"></div></th>${skeletonCols}</tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderDouble11Reference() {
    const section = document.getElementById('double11-reference-section');
    const el = document.getElementById('double11-reference-container');
    const toggle = document.getElementById('double11-reference-toggle');
    if (!section || !el) return;
    if (!shouldShowDouble11Reference()) {
      section.classList.add('hidden');
      section.setAttribute('aria-hidden', 'true');
      el.innerHTML = '';
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    section.classList.remove('hidden');
    section.setAttribute('aria-hidden', 'false');
    const isExpanded = Boolean(stateModule.state.ui.double11ReferenceExpanded);
    section.classList.toggle('double11-ref-collapsed', !isExpanded);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(isExpanded));
      toggle.textContent = isExpanded ? '收起参考' : '展开参考';
    }
    if (!isExpanded) {
      el.innerHTML = `
        <div class="double11-ref-collapsed-note">
          <span>已收起：包含 7 个双11阶段的广告花费、成交、直接成交和成本参考指标。</span>
          <button type="button" class="double11-ref-inline-toggle" data-action="toggle-double11-reference">展开查看明细</button>
        </div>`;
      return;
    }

    const summaryCards = DOUBLE11_REFERENCE_SUMMARY.map((item) => `
      <div class="double11-ref-metric">
        <span>${utils.escapeHtml(item.label)}</span>
        <strong>${utils.escapeHtml(item.value)}</strong>
        <em>${utils.escapeHtml(item.helper)}</em>
      </div>
    `).join('');

    const rows = DOUBLE11_REFERENCE_PHASES.map((item) => `
      <tr>
        <td class="double11-ref-phase">${utils.escapeHtml(item.phase)}</td>
        <td>${utils.escapeHtml(item.dateRange)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.days)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.totalSpend)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.dailySpend)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.spendShare)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.agentSpend)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.wanxiangSpend)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.views)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.orders)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.directOrders)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.carts)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.presaleOrders)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.viewCost)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.orderCost)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.directOrderCost)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.cartCost)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.presaleOrderCost)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(item.viewConversion)}</td>
        <td class="double11-ref-focus">${utils.escapeHtml(item.focus)}</td>
      </tr>
    `).join('');

    el.innerHTML = `
      <div class="double11-ref-wrap">
        <div class="double11-ref-metrics">${summaryCards}</div>
        <div class="double11-ref-callouts">
          <span>第一波预售为主投峰值：6 天花费 730.9 万，占全周期 45.4%。</span>
          <span>有客代投集中在预热和两波预售：第一波预售 272.0 万，第二波预售 255.0 万。</span>
          <span>618 对照时重点看预热蓄水效率、预售投放峰值和尾款承接成本。</span>
        </div>
        <div class="table-shell double11-ref-table-shell">
          <div class="table-scroll double11-ref-scroll">
            <table class="plan-table double11-ref-table">
              <thead>
                <tr>
                  <th>双11阶段</th>
                  <th>日期</th>
                  <th>天数</th>
                  <th>广告花费</th>
                  <th>日均花费</th>
                  <th>花费占比</th>
                  <th>有客花费</th>
                  <th>万相台花费</th>
                  <th>观看次数</th>
                  <th>成交笔数</th>
                  <th>直接成交笔数</th>
                  <th>购物车</th>
                  <th>预售成交</th>
                  <th>观看成本</th>
                  <th>订单成本</th>
                  <th>直接订单成交成本</th>
                  <th>加购成本</th>
                  <th>预售订单成本</th>
                  <th>观看转化率</th>
                  <th>参考解读</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <div class="double11-ref-note">
          数据来自"25年双11数据参考.xlsx"。日期列中部分单元格被 Excel 自动转为日期格式，已按阶段和天数还原为 10/1-10/14、11/1-11/6、11/7-11/14，需业务确认时可再校对原表。
        </div>
      </div>`;
  }

  /* ---- 618 Beauty Industry Traffic Reference ---- */

  function shouldShowSix18Reference() {
    var range = stateModule.state.range || {};
    var startIndex = getYearMonthIndex(range.start);
    var endIndex = getYearMonthIndex(range.end);
    if (startIndex == null || endIndex == null || startIndex > endIndex) return false;
    for (var index = startIndex; index <= endIndex && index <= startIndex + 24; index += 1) {
      var month = (index % 12) + 1;
      if (SIX18_REFERENCE_MONTHS.includes(month)) return true;
    }
    return false;
  }

  function formatWan(value) {
    return utils.formatNumber(Math.round(value / 10000)) + '万';
  }

  function getPhaseMeta(phaseName) {
    return SIX18_REFERENCE_PHASE_META.find(function(m) { return m.phase === phaseName; })
      || SIX18_REFERENCE_PHASE_META[0];
  }

  function drawSix18Chart() {
    var canvas = document.getElementById('six18-ref-chart');
    if (!canvas) return;
    var container = canvas.parentElement;
    var W = container.clientWidth;
    
    // 如果容器宽度为0，延迟绘制
    if (W === 0) {
      requestAnimationFrame(function() { drawSix18Chart(); });
      return;
    }
    
    var dpr = window.devicePixelRatio || 1;
    var H = 320;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = '100%';
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    var data = SIX18_REFERENCE_DAILY;
    if (!data || data.length === 0) return;
    
    var pad = { top: 20, right: 20, bottom: 50, left: 65 };
    var chartW = W - pad.left - pad.right;
    var chartH = H - pad.top - pad.bottom;

    // 动态计算Y轴范围
    var views = data.map(function(d) { return d.views; });
    var minView = Math.min.apply(null, views);
    var maxView = Math.max.apply(null, views);
    var yMin = Math.floor(minView / 10000000) * 10000000 - 10000000;
    var yMax = Math.ceil(maxView / 10000000) * 10000000 + 10000000;
    var yRange = yMax - yMin;
    
    var yScale = function(v) { return pad.top + chartH - ((v - yMin) / yRange) * chartH; };
    var xScale = function(i) { return pad.left + (i / (data.length - 1)) * chartW; };

    // 清空画布
    ctx.clearRect(0, 0, W, H);

    // Phase background bands
    var prevPhase = '';
    var phaseStart = 0;
    for (var i = 0; i <= data.length; i++) {
      var phase = i < data.length ? data[i].phase : '';
      if (phase !== prevPhase) {
        if (prevPhase) {
          var meta = getPhaseMeta(prevPhase);
          var x0 = xScale(phaseStart);
          var x1 = xScale(i - 1);
          ctx.fillStyle = meta.bgColor;
          ctx.fillRect(x0, pad.top, x1 - x0 + chartW / (data.length - 1), chartH);
        }
        if (phase) { phaseStart = i; prevPhase = phase; }
      }
    }

    // Y axis grid lines and labels
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    
    // 动态生成Y轴刻度
    var yTicks = [];
    var tickInterval = 20000000;
    for (var v = Math.ceil(yMin / tickInterval) * tickInterval; v <= yMax; v += tickInterval) {
      yTicks.push(v);
    }
    
    yTicks.forEach(function(v) {
      var y = yScale(v);
      if (y >= pad.top && y <= pad.top + chartH) {
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillText(formatWan(v), pad.left - 8, y + 4);
      }
    });

    // X axis labels (every 5 days)
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    data.forEach(function(d, i) {
      if (i % 5 === 0 || i === data.length - 1) {
        var x = xScale(i);
        ctx.fillText(d.date, x, H - pad.bottom + 18);
      }
    });

    // Line
    ctx.beginPath();
    data.forEach(function(d, i) {
      var x = xScale(i);
      var y = yScale(d.views);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Data points colored by phase
    data.forEach(function(d, i) {
      var x = xScale(i);
      var y = yScale(d.views);
      var m = getPhaseMeta(d.phase);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Peak and trough annotations
    var peakItem = data.reduce(function(m, d) { return d.views > m.views ? d : m; });
    var troughItem = data.reduce(function(m, d) { return d.views < m.views ? d : m; });
    [
      { item: peakItem, label: '峰值 ' + formatWan(peakItem.views), color: '#ef4444' },
      { item: troughItem, label: '谷值 ' + formatWan(troughItem.views), color: '#64748b' },
    ].forEach(function(ann) {
      var idx = data.indexOf(ann.item);
      var x = xScale(idx);
      var y = yScale(ann.item.views);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ann.color;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(ann.label, pad.left + 4, y - 6);
    });
  }

  function bindSix18ChartEvents() {
    var canvas = document.getElementById('six18-ref-chart');
    var tooltip = document.getElementById('six18-ref-tooltip');
    if (!canvas || !tooltip) return;

    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var W = rect.width;
      var pad = { left: 65, right: 20 };
      var chartW = W - pad.left - pad.right;
      var data = SIX18_REFERENCE_DAILY;
      var idx = Math.round(((mx - pad.left) / chartW) * (data.length - 1));
      if (idx < 0 || idx >= data.length) { tooltip.style.display = 'none'; return; }
      var d = data[idx];
      var meta = getPhaseMeta(d.phase);
      tooltip.innerHTML = '<strong>' + d.date + '</strong>  展现指数 <strong>' + formatWan(d.views) + '</strong><br><span style="color:' + meta.color + '">' + d.phase + '</span>';
      tooltip.style.display = 'block';
      var tx = Math.min(Math.max(8, mx - 80), W - 180);
      tooltip.style.left = tx + 'px';
      tooltip.style.top = '8px';
    });
    canvas.addEventListener('mouseleave', function() { tooltip.style.display = 'none'; });
  }

  function renderSix18Reference() {
    var section = document.getElementById('six18-reference-section');
    var el = document.getElementById('six18-reference-container');
    var toggle = document.getElementById('six18-reference-toggle');
    if (!section || !el) return;
    if (!shouldShowSix18Reference()) {
      section.classList.add('hidden');
      section.setAttribute('aria-hidden', 'true');
      el.innerHTML = '';
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    section.classList.remove('hidden');
    section.setAttribute('aria-hidden', 'false');
    var isExpanded = Boolean(stateModule.state.ui.six18ReferenceExpanded);
    section.classList.toggle('six18-ref-collapsed', !isExpanded);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(isExpanded));
      toggle.textContent = isExpanded ? '收起参考' : '展开参考';
    }
    if (!isExpanded) {
      el.innerHTML = '<div class="six18-ref-collapsed-note">'
        + '<span>已收起：美妆护肤行业618展现指数趋势图（5/1-6/30，60天数据）。</span>'
        + '<button type="button" class="six18-ref-inline-toggle" data-action="toggle-six18-reference">展开查看趋势</button>'
        + '</div>';
      return;
    }

    var legend = SIX18_REFERENCE_PHASE_META.map(function(m) {
      return '<span class="six18-ref-legend-item"><i style="background:' + m.color + '"></i>' + utils.escapeHtml(m.phase) + '</span>';
    }).join('');

    el.innerHTML = '<div class="six18-ref-wrap">'
      + '<div class="six18-ref-legend">' + legend + '</div>'
      + '<div class="six18-ref-chart-wrap">'
      +   '<canvas id="six18-ref-chart" class="six18-ref-chart"></canvas>'
      +   '<div id="six18-ref-tooltip" class="six18-ref-tooltip" style="display:none"></div>'
      + '</div>'
      + '<div class="six18-ref-note">'
      +   '数据来自"美妆护肤618行业流量数据_2025.csv"，为美妆护肤行业大盘展现指数参考，仅用于了解流量走势节奏，不参与计划拆解、保存或任何计算。'
      + '</div>'
      + '</div>';

    drawSix18Chart();
    bindSix18ChartEvents();

    if (window._six18ResizeObs) window._six18ResizeObs.disconnect();
    var chartWrap = el.querySelector('.six18-ref-chart-wrap');
    if (chartWrap) {
      var debouncedRedraw = debounce(function () { drawSix18Chart(); }, 150);
      window._six18ResizeObs = new ResizeObserver(function () { debouncedRedraw(); });
      window._six18ResizeObs.observe(chartWrap);
    }
  }

  /* ---- 25年618节奏 ---- */

  function shouldShowSix18Rhythm() {
    var range = stateModule.state.range || {};
    var startIndex = getYearMonthIndex(range.start);
    var endIndex = getYearMonthIndex(range.end);
    if (startIndex == null || endIndex == null || startIndex > endIndex) return false;
    for (var index = startIndex; index <= endIndex && index <= startIndex + 24; index += 1) {
      var month = (index % 12) + 1;
      if (SIX18_RHYTHM_MONTHS.includes(month)) return true;
    }
    return false;
  }

  function renderSix18Rhythm() {
    var section = document.getElementById('six18-rhythm-section');
    var el = document.getElementById('six18-rhythm-container');
    var toggle = document.getElementById('six18-rhythm-toggle');
    if (!section || !el) return;
    if (!shouldShowSix18Rhythm()) {
      section.classList.add('hidden');
      section.setAttribute('aria-hidden', 'true');
      el.innerHTML = '';
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    section.classList.remove('hidden');
    section.setAttribute('aria-hidden', 'false');
    var isExpanded = Boolean(stateModule.state.ui.six18RhythmExpanded);
    section.classList.toggle('six18-rhythm-collapsed', !isExpanded);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(isExpanded));
      toggle.textContent = isExpanded ? '收起参考' : '展开参考';
    }
    if (!isExpanded) {
      el.innerHTML = '<div class="six18-rhythm-collapsed-note">'
        + '<span>已收起：25年618节奏参考（5/1-6/30，9个阶段）。</span>'
        + '<button type="button" class="six18-rhythm-inline-toggle" data-action="toggle-six18-rhythm">展开查看节奏</button>'
        + '</div>';
      return;
    }

    // 生成横向表格HTML
    var dateRow = SIX18_RHYTHM_PHASES.map(function(p) {
      return '<td style="border-top:3px solid ' + p.color + '">'
        + '<div class="six18-rhythm-date">' + utils.escapeHtml(p.dateRange) + '</div>'
        + '</td>';
    }).join('');

    var rhythmRow = SIX18_RHYTHM_PHASES.map(function(p) {
      return '<td>'
        + '<span class="six18-rhythm-tag" style="background:' + p.color + '20;color:' + p.color + '">' 
        + utils.escapeHtml(p.platformRhythm) + '</span>'
        + '<div class="six18-rhythm-label">' + utils.escapeHtml(p.rhythmLabel) + '</div>'
        + '</td>';
    }).join('');

    var sessionRow = SIX18_RHYTHM_PHASES.map(function(p) {
      var hasSession = p.keySession && p.keySession !== '–';
      return '<td>'
        + (hasSession 
          ? '<span class="six18-rhythm-session">' + utils.escapeHtml(p.keySession) + '</span>'
          : '<span class="six18-rhythm-empty">–</span>')
        + '</td>';
    }).join('');

    var operationRow = SIX18_RHYTHM_PHASES.map(function(p) {
      return '<td>'
        + '<div class="six18-rhythm-operation">' + utils.escapeHtml(p.operation) + '</div>'
        + '</td>';
    }).join('');

    el.innerHTML = '<div class="six18-rhythm-wrap">'
      + '<div class="six18-rhythm-table-shell">'
      +   '<table class="six18-rhythm-horizontal-table">'
      +     '<tbody>'
      +       '<tr class="six18-rhythm-row"><th class="six18-rhythm-row-label">日期</th>' + dateRow + '</tr>'
      +       '<tr class="six18-rhythm-row"><th class="six18-rhythm-row-label">平台节奏</th>' + rhythmRow + '</tr>'
      +       '<tr class="six18-rhythm-row"><th class="six18-rhythm-row-label">重要场次</th>' + sessionRow + '</tr>'
      +       '<tr class="six18-rhythm-row"><th class="six18-rhythm-row-label">运营动作</th>' + operationRow + '</tr>'
      +     '</tbody>'
      +   '</table>'
      + '</div>'
      + '<div class="six18-rhythm-note">'
      +   '基于25年618投放节奏整理，仅用于阶段对照和预算参考，不参与节奏汇总、保存、导出或任何计算。'
      + '</div>'
      + '</div>';
  }


  function getDouble11ReferenceExportSections() {
    if (!shouldShowDouble11Reference()) return [];
    return [
      {
        title: '25年双11投放节奏参考-摘要',
        headers: ['指标', '数值', '说明'],
        rows: DOUBLE11_REFERENCE_SUMMARY.map(function(item) {
          return [item.label, item.value, item.helper];
        }),
      },
      {
        title: '25年双11投放节奏参考-重点提示',
        headers: ['内容'],
        rows: [
          ['第一波预售为主投峰值：6 天花费 730.9 万，占全周期 45.4%。'],
          ['有客代投集中在预热和两波预售：第一波预售 272.0 万，第二波预售 255.0 万。'],
          ['618 对照时重点看预热蓄水效率、预售投放峰值和尾款承接成本。'],
        ],
      },
      {
        title: '25年双11投放节奏参考-阶段明细',
        headers: [
          '双11阶段',
          '日期',
          '天数',
          '广告花费',
          '日均花费',
          '花费占比',
          '有客花费',
          '万相台花费',
          '观看次数',
          '成交笔数',
          '直接成交笔数',
          '购物车',
          '预售成交',
          '观看成本',
          '订单成本',
          '直接订单成交成本',
          '加购成本',
          '预售订单成本',
          '观看转化率',
          '参考解读',
        ],
        rows: DOUBLE11_REFERENCE_PHASES.map(function(item) {
          return [
            item.phase,
            item.dateRange,
            item.days,
            item.totalSpend,
            item.dailySpend,
            item.spendShare,
            item.agentSpend,
            item.wanxiangSpend,
            item.views,
            item.orders,
            item.directOrders,
            item.carts,
            item.presaleOrders,
            item.viewCost,
            item.orderCost,
            item.directOrderCost,
            item.cartCost,
            item.presaleOrderCost,
            item.viewConversion,
            item.focus,
          ];
        }),
      },
      {
        title: '25年双11投放节奏参考-备注',
        headers: ['内容'],
        rows: [['数据来自"25年双11数据参考.xlsx"。日期列中部分单元格被 Excel 自动转为日期格式，已按阶段和天数还原为 10/1-10/14、11/1-11/6、11/7-11/14，需业务确认时可再校对原表。']],
      },
    ];
  }

  function getSix18ReferenceExportSections() {
    if (!shouldShowSix18Reference()) return [];
    var total = SIX18_REFERENCE_DAILY.reduce(function(s, d) { return s + d.views; }, 0);
    var avg = total / SIX18_REFERENCE_DAILY.length;
    var peak = SIX18_REFERENCE_DAILY.reduce(function(m, d) { return d.views > m.views ? d : m; });
    var trough = SIX18_REFERENCE_DAILY.reduce(function(m, d) { return d.views < m.views ? d : m; });
    return [
      {
        title: '25年618美妆行业流量参考-摘要',
        headers: ['指标', '数值', '说明'],
        rows: [
          ['数据周期', '5/1-6/30', '60天完整618周期'],
          ['日均展现指数', formatWan(avg), '全周期日均展现强度'],
          ['峰值', formatWan(peak.views), peak.date + ' ' + getPhaseMeta(peak.phase).phase],
          ['谷值', formatWan(trough.views), trough.date + ' ' + getPhaseMeta(trough.phase).phase],
          ['峰谷倍数', (peak.views / trough.views).toFixed(2) + 'x', '峰值 / 谷值'],
        ],
      },
      {
        title: '25年618美妆行业流量参考-每日明细',
        headers: ['日期', '展现指数', '阶段'],
        rows: SIX18_REFERENCE_DAILY.map(function(d) {
          return [d.date, d.views, d.phase];
        }),
      },
      {
        title: '25年618美妆行业流量参考-备注',
        headers: ['内容'],
        rows: [['数据来自"美妆护肤618行业流量数据_2025.csv"，为美妆护肤行业大盘展现指数参考，仅用于了解流量走势节奏，不参与计划拆解、保存或任何计算。']],
      },
    ];
  }

  window.PlanDashboardRenderReferences = {
    renderTimeline,
    renderTimelineSkeleton,
    renderDouble11Reference,
    renderSix18Reference,
    renderSix18Rhythm,
    getDouble11ReferenceExportSections,
    getSix18ReferenceExportSections,
  };
})(window);
