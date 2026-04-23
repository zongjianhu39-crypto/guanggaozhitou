(function attachPlanDashboardRender(window) {
  const utils = window.PlanDashboardUtils;
  const stateModule = window.PlanDashboardState;
  const DOUBLE11_REFERENCE_MONTHS = [5, 6];
  const COLLAPSIBLE_SECTIONS = {
    timeline: {
      stateKey: 'timelineExpanded',
      containerId: 'timeline-container',
      toggleId: 'timeline-section-toggle',
      collapsedLabel: '展开时间轴',
      expandedLabel: '收起时间轴',
      collapsedText: '已收起：活动日期、平台节奏、重要场次和运营动作。',
      inlineLabel: '展开查看时间轴',
    },
    rhythmSummary: {
      stateKey: 'rhythmSummaryExpanded',
      containerId: 'rhythm-summary-container',
      toggleId: 'rhythm-summary-section-toggle',
      collapsedLabel: '展开汇总',
      expandedLabel: '收起汇总',
      collapsedText: '已收起：按活动节奏合并后的计划、实际花费、25年参考和增幅指标。',
      inlineLabel: '展开查看汇总',
    },
    monthNote: {
      stateKey: 'monthNoteExpanded',
      containerId: 'month-note-container',
      toggleId: 'month-note-section-toggle',
      collapsedLabel: '展开说明',
      expandedLabel: '收起说明',
      collapsedText: '已收起：当月投放策略、节奏调整说明等关键信息。',
      inlineLabel: '展开查看说明',
    },
  };
  const DOUBLE11_REFERENCE_SUMMARY = [
    { label: '总投放周期', value: '10/1-11/30', helper: '61 天完整双11周期' },
    { label: '广告花费', value: '1,610.6万', helper: '有客代投 + 万相台' },
    { label: '日均花费', value: '26.4万', helper: '全周期日均投放强度' },
    { label: '渠道拆分', value: '772.0万 / 838.6万', helper: '有客代投 / 万相台' },
    { label: '预售成交', value: '127.6万', helper: '万相台总预售成交笔数' },
  ];
  const DOUBLE11_REFERENCE_PHASES = [
    {
      phase: '第一波预热',
      dateRange: '10/1-10/14',
      days: '14',
      dailySpend: '15.6万',
      spendShare: '13.6%',
      totalSpend: '218.3万',
      agentSpend: '155.0万',
      wanxiangSpend: '63.3万',
      views: '242.0万',
      orders: '20.7万',
      directOrders: '8.8万',
      carts: '69.4万',
      presaleOrders: '24.1万',
      viewCost: '0.26',
      orderCost: '3.1',
      directOrderCost: '7.2',
      cartCost: '0.9',
      presaleOrderCost: '2.6',
      viewConversion: '9%',
      focus: '低成本蓄水，订单成本和加购成本为全周期最低。',
    },
    {
      phase: '第一波预售',
      dateRange: '10/15-10/20',
      days: '6',
      dailySpend: '121.8万',
      spendShare: '45.4%',
      totalSpend: '730.9万',
      agentSpend: '272.0万',
      wanxiangSpend: '458.9万',
      views: '1,225.8万',
      orders: '60.9万',
      directOrders: '39.4万',
      carts: '101.8万',
      presaleOrders: '76.8万',
      viewCost: '0.37',
      orderCost: '7.5',
      directOrderCost: '11.7',
      cartCost: '4.5',
      presaleOrderCost: '6.0',
      viewConversion: '5%',
      focus: '主投放高峰，广告花费占比 45.4%，预售成交集中爆发。',
    },
    {
      phase: '第一波尾款',
      dateRange: '10/21-10/24',
      days: '4',
      dailySpend: '22.1万',
      spendShare: '5.5%',
      totalSpend: '88.2万',
      agentSpend: '0.0万',
      wanxiangSpend: '88.2万',
      views: '258.5万',
      orders: '8.1万',
      directOrders: '5.0万',
      carts: '28.4万',
      presaleOrders: '0.3万',
      viewCost: '0.34',
      orderCost: '10.9',
      directOrderCost: '17.8',
      cartCost: '3.1',
      presaleOrderCost: '-',
      viewConversion: '3%',
      focus: '尾款期更偏承接，预售新增少，订单成本抬升。',
    },
    {
      phase: '现货',
      dateRange: '10/25-10/31',
      days: '7',
      dailySpend: '2.8万',
      spendShare: '1.2%',
      totalSpend: '19.5万',
      agentSpend: '0.0万',
      wanxiangSpend: '19.5万',
      views: '69.4万',
      orders: '4.9万',
      directOrders: '2.7万',
      carts: '15.1万',
      presaleOrders: '1.6万',
      viewCost: '0.28',
      orderCost: '3.9',
      directOrderCost: '7.1',
      cartCost: '1.3',
      presaleOrderCost: '-',
      viewConversion: '7%',
      focus: '低投放维持转化，成交效率较高但规模小。',
    },
    {
      phase: '第二波预热',
      dateRange: '11/1-11/6',
      days: '6',
      dailySpend: '22.3万',
      spendShare: '8.3%',
      totalSpend: '133.7万',
      agentSpend: '90.0万',
      wanxiangSpend: '43.7万',
      views: '131.7万',
      orders: '5.0万',
      directOrders: '1.7万',
      carts: '15.8万',
      presaleOrders: '6.0万',
      viewCost: '0.33',
      orderCost: '8.7',
      directOrderCost: '26.4',
      cartCost: '2.8',
      presaleOrderCost: '7.3',
      viewConversion: '4%',
      focus: '第二波前置蓄水，代投占比高于万相台。',
    },
    {
      phase: '第二波预售',
      dateRange: '11/7-11/14',
      days: '8',
      dailySpend: '47.2万',
      spendShare: '23.4%',
      totalSpend: '377.7万',
      agentSpend: '255.0万',
      wanxiangSpend: '122.7万',
      views: '311.6万',
      orders: '17.4万',
      directOrders: '11.0万',
      carts: '32.0万',
      presaleOrders: '18.8万',
      viewCost: '0.39',
      orderCost: '7.0',
      directOrderCost: '11.2',
      cartCost: '3.8',
      presaleOrderCost: '6.5',
      viewConversion: '6%',
      focus: '第二个投放峰值，代投花费集中，规模低于第一波预售。',
    },
    {
      phase: '日常',
      dateRange: '11/15-11/30',
      days: '16',
      dailySpend: '2.6万',
      spendShare: '2.6%',
      totalSpend: '42.3万',
      agentSpend: '0.0万',
      wanxiangSpend: '42.3万',
      views: '70.3万',
      orders: '3.3万',
      directOrders: '2.5万',
      carts: '5.4万',
      presaleOrders: '0.0万',
      viewCost: '0.60',
      orderCost: '12.8',
      directOrderCost: '17.2',
      cartCost: '7.9',
      presaleOrderCost: '-',
      viewConversion: '5%',
      focus: '大促后长尾收口，效率指标明显走弱。',
    },
  ];

  const SIX18_REFERENCE_MONTHS = [5, 6];
  const SIX18_REFERENCE_DAILY = [
    { date: '5/1',  views: 100000000, phase: '蓄水期' },
    { date: '5/2',  views: 102000000, phase: '蓄水期' },
    { date: '5/3',  views: 100000000, phase: '蓄水期' },
    { date: '5/4',  views: 93166379,  phase: '蓄水期' },
    { date: '5/5',  views: 100000000, phase: '蓄水期' },
    { date: '5/6',  views: 100000000, phase: '蓄水期' },
    { date: '5/7',  views: 102000000, phase: '蓄水期' },
    { date: '5/8',  views: 102000000, phase: '蓄水期' },
    { date: '5/9',  views: 102000000, phase: '蓄水期' },
    { date: '5/10', views: 102000000, phase: '蓄水期' },
    { date: '5/11', views: 102000000, phase: '蓄水期' },
    { date: '5/12', views: 105000000, phase: '蓄水期' },
    { date: '5/13', views: 115000000, phase: '蓄水期' },
    { date: '5/14', views: 140000000, phase: '蓄水期' },
    { date: '5/15', views: 175000000, phase: '第一波爆发' },
    { date: '5/16', views: 175000000, phase: '第一波爆发' },
    { date: '5/17', views: 160000000, phase: '第一波爆发' },
    { date: '5/18', views: 165000000, phase: '第一波爆发' },
    { date: '5/19', views: 155000000, phase: '第一波爆发' },
    { date: '5/20', views: 155000000, phase: '第一波爆发' },
    { date: '5/21', views: 155000000, phase: '蓄力期' },
    { date: '5/22', views: 155000000, phase: '蓄力期' },
    { date: '5/23', views: 150000000, phase: '蓄力期' },
    { date: '5/24', views: 152000000, phase: '蓄力期' },
    { date: '5/25', views: 155000000, phase: '蓄力期' },
    { date: '5/26', views: 168000000, phase: '蓄力期' },
    { date: '5/27', views: 168000000, phase: '蓄力期' },
    { date: '5/28', views: 168000000, phase: '蓄力期' },
    { date: '5/29', views: 180000000, phase: '第二波爆发' },
    { date: '5/30', views: 180000000, phase: '第二波爆发' },
    { date: '5/31', views: 175000000, phase: '第二波爆发' },
    { date: '6/1',  views: 175000000, phase: '第二波爆发' },
    { date: '6/2',  views: 194994457, phase: '第二波爆发' },
    { date: '6/3',  views: 180000000, phase: '第二波爆发' },
    { date: '6/4',  views: 175000000, phase: '第二波爆发' },
    { date: '6/5',  views: 175000000, phase: '第二波爆发' },
    { date: '6/6',  views: 170000000, phase: '回落期' },
    { date: '6/7',  views: 165000000, phase: '回落期' },
    { date: '6/8',  views: 155000000, phase: '回落期' },
    { date: '6/9',  views: 150000000, phase: '回落期' },
    { date: '6/10', views: 150000000, phase: '回落期' },
    { date: '6/11', views: 145000000, phase: '回落期' },
    { date: '6/12', views: 135000000, phase: '回落期' },
    { date: '6/13', views: 110000000, phase: '回落期' },
    { date: '6/14', views: 105000000, phase: '回落期' },
    { date: '6/15', views: 105000000, phase: '回落期' },
    { date: '6/16', views: 105000000, phase: '回落期' },
    { date: '6/17', views: 110000000, phase: '回落期' },
    { date: '6/18', views: 105000000, phase: '回落期' },
    { date: '6/19', views: 110000000, phase: '回落期' },
    { date: '6/20', views: 115000000, phase: '回落期' },
    { date: '6/21', views: 110000000, phase: '返场期' },
    { date: '6/22', views: 95000000,  phase: '返场期' },
    { date: '6/23', views: 92000000,  phase: '返场期' },
    { date: '6/24', views: 92000000,  phase: '返场期' },
    { date: '6/25', views: 92000000,  phase: '返场期' },
    { date: '6/26', views: 90000000,  phase: '返场期' },
    { date: '6/27', views: 90507712,  phase: '返场期' },
    { date: '6/28', views: 90000000,  phase: '返场期' },
    { date: '6/29', views: 92000000,  phase: '返场期' },
    { date: '6/30', views: 95000000,  phase: '返场期' },
  ];
  const SIX18_REFERENCE_PHASE_META = [
    { phase: '蓄水期',     color: '#94a3b8', bgColor: 'rgba(148,163,184,0.12)' },
    { phase: '第一波爆发', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.12)' },
    { phase: '蓄力期',     color: '#6366f1', bgColor: 'rgba(99,102,241,0.12)' },
    { phase: '第二波爆发', color: '#ef4444', bgColor: 'rgba(239,68,68,0.12)' },
    { phase: '回落期',     color: '#64748b', bgColor: 'rgba(100,116,139,0.08)' },
    { phase: '返场期',     color: '#0ea5e9', bgColor: 'rgba(14,165,233,0.10)' },
  ];

  function syncCollapsibleSection(sectionKey) {
    const meta = COLLAPSIBLE_SECTIONS[sectionKey];
    if (!meta) return true;
    const el = document.getElementById(meta.containerId);
    const toggle = document.getElementById(meta.toggleId);
    if (!el) return true;
    const isExpanded = stateModule.state.ui[meta.stateKey] !== false;
    const section = el.closest('.plan-section');
    if (section) {
      section.classList.toggle('plan-section-collapsed', !isExpanded);
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(isExpanded));
      toggle.textContent = isExpanded ? meta.expandedLabel : meta.collapsedLabel;
    }
    if (!isExpanded) {
      el.innerHTML = `
        <div class="plan-section-collapsed-note">
          <span>${utils.escapeHtml(meta.collapsedText)}</span>
          <button type="button" class="plan-section-inline-toggle" data-action="toggle-plan-section" data-section="${utils.escapeHtml(sectionKey)}">${utils.escapeHtml(meta.inlineLabel)}</button>
        </div>`;
    }
    return isExpanded;
  }

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

  function getYearMonthIndex(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (!match) return null;
    return (Number(match[1]) * 12) + Number(match[2]) - 1;
  }

  function shouldShowDouble11Reference() {
    const range = stateModule.state.range || {};
    const startIndex = getYearMonthIndex(range.start);
    const endIndex = getYearMonthIndex(range.end);
    if (startIndex == null || endIndex == null || startIndex > endIndex) return false;
    for (let index = startIndex; index <= endIndex && index <= startIndex + 24; index += 1) {
      const month = (index % 12) + 1;
      if (DOUBLE11_REFERENCE_MONTHS.includes(month)) return true;
    }
    return false;
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
        <div class=”double11-ref-note”>
          数据来自”25年双11数据参考.xlsx”。日期列中部分单元格被 Excel 自动转为日期格式，已按阶段和天数还原为 10/1-10/14、11/1-11/6、11/7-11/14，需业务确认时可再校对原表。
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
    var dpr = window.devicePixelRatio || 1;
    var W = container.clientWidth;
    var H = 320;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var data = SIX18_REFERENCE_DAILY;
    var pad = { top: 20, right: 20, bottom: 50, left: 65 };
    var chartW = W - pad.left - pad.right;
    var chartH = H - pad.top - pad.bottom;

    var yMin = 80000000;
    var yMax = 210000000;
    var yRange = yMax - yMin;
    var yScale = function(v) { return pad.top + chartH - ((v - yMin) / yRange) * chartH; };
    var xScale = function(i) { return pad.left + (i / (data.length - 1)) * chartW; };

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
    var yTicks = [90000000, 100000000, 120000000, 140000000, 160000000, 180000000, 200000000];
    yTicks.forEach(function(v) {
      var y = yScale(v);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillText(formatWan(v), pad.left - 8, y + 4);
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
      tooltip.innerHTML = '<strong>' + d.date + '</strong>  展现指数 <strong>' + formatWan(d.views) + '</strong><br><span style=”color:' + meta.color + '”>' + d.phase + '</span>';
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
      el.innerHTML = '<div class=”six18-ref-collapsed-note”>'
        + '<span>已收起：美妆护肤行业618展现指数趋势图（5/1-6/30，60天数据）。</span>'
        + '<button type=”button” class=”six18-ref-inline-toggle” data-action=”toggle-six18-reference”>展开查看趋势</button>'
        + '</div>';
      return;
    }

    var total = SIX18_REFERENCE_DAILY.reduce(function(s, d) { return s + d.views; }, 0);
    var avg = total / SIX18_REFERENCE_DAILY.length;
    var peak = SIX18_REFERENCE_DAILY.reduce(function(m, d) { return d.views > m.views ? d : m; });
    var trough = SIX18_REFERENCE_DAILY.reduce(function(m, d) { return d.views < m.views ? d : m; });
    var peakPhase = getPhaseMeta(peak.phase).phase;
    var troughPhase = getPhaseMeta(trough.phase).phase;

    var summaryCards = [
      { label: '数据周期',     value: '5/1-6/30',              helper: '60天完整618周期' },
      { label: '日均展现指数', value: formatWan(avg),           helper: '全周期日均展现强度' },
      { label: '峰值',         value: formatWan(peak.views),    helper: peak.date + ' ' + peakPhase },
      { label: '谷值',         value: formatWan(trough.views),  helper: trough.date + ' ' + troughPhase },
      { label: '峰谷倍数',     value: (peak.views / trough.views).toFixed(2) + 'x', helper: '峰值 / 谷值' },
    ].map(function(item) {
      return '<div class=”six18-ref-metric”>'
        + '<span>' + utils.escapeHtml(item.label) + '</span>'
        + '<strong>' + utils.escapeHtml(item.value) + '</strong>'
        + '<em>' + utils.escapeHtml(item.helper) + '</em>'
        + '</div>';
    }).join('');

    var legend = SIX18_REFERENCE_PHASE_META.map(function(m) {
      return '<span class=”six18-ref-legend-item”><i style=”background:' + m.color + '”></i>' + utils.escapeHtml(m.phase) + '</span>';
    }).join('');

    el.innerHTML = '<div class=”six18-ref-wrap”>'
      + '<div class=”six18-ref-metrics”>' + summaryCards + '</div>'
      + '<div class=”six18-ref-legend”>' + legend + '</div>'
      + '<div class=”six18-ref-chart-wrap”>'
      +   '<canvas id=”six18-ref-chart” class=”six18-ref-chart”></canvas>'
      +   '<div id=”six18-ref-tooltip” class=”six18-ref-tooltip” style=”display:none”></div>'
      + '</div>'
      + '<div class=”six18-ref-note”>'
      +   '数据来自”美妆护肤618行业流量数据_2025.csv”，为美妆护肤行业大盘展现指数参考，仅用于了解流量走势节奏，不参与计划拆解、保存或任何计算。'
      + '</div>'
      + '</div>';

    drawSix18Chart();
    bindSix18ChartEvents();

    if (window._six18ResizeObs) window._six18ResizeObs.disconnect();
    var chartWrap = el.querySelector('.six18-ref-chart-wrap');
    if (chartWrap) {
      window._six18ResizeObs = new ResizeObserver(function() { drawSix18Chart(); });
      window._six18ResizeObs.observe(chartWrap);
    }
  }

  function buildEditableCell(date, field, value) {
    if (field === 'activity_override') {
      return `<input class="plan-input" data-date="${utils.escapeHtml(date)}" data-field="${field}" value="${utils.escapeHtml(value || '')}" placeholder="留空则跟随活动" />`;
    }
    if (field === 'remark') {
      const text = value || '';
      const truncated = text.length > 12 ? text.slice(0, 12) + '…' : text;
      return `<div class="remark-cell" data-date="${utils.escapeHtml(date)}"><span class="remark-preview">${utils.escapeHtml(truncated || '点击编辑')}</span>${text ? `<div class="remark-tooltip">${utils.escapeHtml(text)}</div>` : ''}<input type="hidden" class="plan-input" data-date="${utils.escapeHtml(date)}" data-field="${field}" value="${utils.escapeHtml(text)}" /></div>`;
    }
    return `<input class="plan-input" type="number" step="0.01" data-date="${utils.escapeHtml(date)}" data-field="${field}" value="${utils.escapeHtml(value || 0)}" />`;
  }

  function getEffectiveDay(day) {
    const draft = stateModule.state.drafts.dayPatches[day.date] || {};
    const hasWanxiangDraft = Object.prototype.hasOwnProperty.call(draft, 'wanxiang_plan');
    const hasAgentDraft = Object.prototype.hasOwnProperty.call(draft, 'agent_plan');
    const wanxiangPlan = hasWanxiangDraft ? utils.toNumber(draft.wanxiang_plan) : utils.toNumber(day.wanxiang_plan);
    const agentPlan = hasAgentDraft ? utils.toNumber(draft.agent_plan) : utils.toNumber(day.agent_plan);
    const totalPlan = wanxiangPlan + agentPlan;
    const actualCost = utils.toNumber(day.actual_cost);
    return Object.assign({}, day, {
      wanxiang_plan: wanxiangPlan,
      agent_plan: agentPlan,
      total_plan_amount: totalPlan,
      activity_override_draft: Object.prototype.hasOwnProperty.call(draft, 'activity_override') ? draft.activity_override : undefined,
      remark: Object.prototype.hasOwnProperty.call(draft, 'remark') ? draft.remark : day.remark,
      completion_rate: totalPlan > 0 ? actualCost / totalPlan : null,
      is_dirty: Object.keys(draft).length > 0,
    });
  }

  function getEffectiveDays() {
    return (stateModule.state.summary.days || []).map(getEffectiveDay);
  }

  function buildActivityCell(day) {
    const inherited = day.activity_source === 'activity' && day.activity;
    if (inherited) {
      const meta = utils.getActivityTypeMeta(day.activity_type);
      return `<div class="activity-inherited"><span class="activity-inherited-tag ${meta.className}">${utils.escapeHtml(meta.label)}</span> ${utils.escapeHtml(day.activity)}</div>`;
    }
    return '<span class="plan-muted">–</span>';
  }

  /* ---- Rhythm Summary helpers ---- */

  function rhythmKey(day) {
    if (day.activity_source === 'activity' && day.activity) {
      return (day.activity_type || 'daily') + '::' + (day.activity || '');
    }
    return 'none';
  }

  function buildRhythmSegments(days) {
    if (!days.length) return [];
    var segs = [];
    var cur = { key: rhythmKey(days[0]), days: [days[0]] };
    for (var i = 1; i < days.length; i++) {
      var k = rhythmKey(days[i]);
      if (k === cur.key) { cur.days.push(days[i]); }
      else { segs.push(cur); cur = { key: k, days: [days[i]] }; }
    }
    segs.push(cur);
    return segs;
  }

  function rhythmLabel(seg) {
    if (seg.key === 'none') return '<span class="plan-muted">\u2013</span>';
    var d = seg.days[0];
    var meta = utils.getActivityTypeMeta(d.activity_type);
    return '<span class="activity-inherited-tag ' + meta.className + '">' + utils.escapeHtml(meta.label) + '</span> ' + utils.escapeHtml(d.activity || '');
  }

  function rhythmLabelText(seg) {
    if (seg.key === 'none') return '-';
    var d = seg.days[0];
    var meta = utils.getActivityTypeMeta(d.activity_type);
    return meta.label + ' ' + (d.activity || '');
  }

  function sDiv(n, d) {
    var num = utils.toNumber(n);
    var den = utils.toNumber(d);
    if (den <= 0 || !Number.isFinite(num)) return null;
    var r = num / den;
    return Number.isFinite(r) ? r : null;
  }

  function fmtC(v) {
    return v != null ? utils.escapeHtml(utils.formatCurrency(v)) : '<span class="plan-muted">-</span>';
  }

  function fmtP(v) {
    if (v == null) return '<span class="plan-muted">-</span>';
    var pct = v * 100;
    return Number.isFinite(pct) ? utils.escapeHtml(pct.toFixed(2) + '%') : '<span class="plan-muted">-</span>';
  }

  function fmtF(v) {
    return v != null ? utils.escapeHtml(Number(v).toFixed(2)) : '<span class="plan-muted">-</span>';
  }

  function fmtRef(v) {
    var n = utils.toNumber(v);
    return n > 0 ? utils.escapeHtml(utils.formatCurrency(n)) : '<span class="plan-muted">-</span>';
  }

  function fmtRefN(v) {
    var n = utils.toNumber(v);
    return n > 0 ? utils.escapeHtml(utils.formatNumber(n)) : '<span class="plan-muted">-</span>';
  }

  function rhythmJudgment(growth) {
    if (growth == null) return '-';
    if (growth > 0.3) return '\u5927\u5e45\u52a0\u6295';
    if (growth > 0.05) return '\u52a0\u6295';
    if (growth >= -0.05) return '\u6301\u5e73';
    if (growth >= -0.3) return '\u51cf\u6295';
    return '\u5927\u5e45\u51cf\u6295';
  }

  function judgmentCls(j) {
    var m = {
      '\u5927\u5e45\u52a0\u6295': 'rhythm-j rhythm-j-strong-up',
      '\u52a0\u6295': 'rhythm-j rhythm-j-up',
      '\u6301\u5e73': 'rhythm-j rhythm-j-flat',
      '\u51cf\u6295': 'rhythm-j rhythm-j-down',
      '\u5927\u5e45\u51cf\u6295': 'rhythm-j rhythm-j-strong-down',
    };
    return m[j] || 'rhythm-j';
  }

  function summarizeRhythmDays(ds, monthTotal) {
    var n = ds.length;
    var wx = utils.sum(ds.map(function(d) { return d.wanxiang_plan; }));
    var ag = utils.sum(ds.map(function(d) { return d.agent_plan; }));
    var tp = utils.sum(ds.map(function(d) { return d.total_plan_amount; }));
    var ac = utils.sum(ds.map(function(d) { return utils.toNumber(d.actual_cost); }));
    var aa = utils.sum(ds.map(function(d) { return utils.toNumber(d.agent_amount); }));
    var ra = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_amount != null ? d.reference_amount : d.reference_2025_amount); }));
    var rwta = ra + aa;
    var rv = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_views); }));
    var ro = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_orders); }));
    var rdo = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_direct_orders); }));
    var rc = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_cart); }));
    var rp = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_pre_orders); }));
    var rt = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_taobao_orders); }));
    var rb = utils.sum(ds.map(function(d) { return utils.toNumber(d.reference_buyers); }));
    return {
      days: n,
      wx: wx,
      ag: ag,
      tp: tp,
      dap: sDiv(tp, n),
      pp: sDiv(tp, monthTotal),
      ac: ac,
      aa: aa,
      cr: sDiv(ac, tp),
      daa: sDiv(ac, n),
      ra: ra,
      rv: rv,
      ro: ro,
      rdo: rdo,
      rc: rc,
      rp: rp,
      rt: rt,
      rb: rb,
      rwta: rwta,
      rwtaShare: null,
      oc: sDiv(ra, ro),
      doc: sDiv(ra, rdo),
      pc: sDiv(ra, rp),
      cc: sDiv(ra, rc),
      asr: sDiv(ro, rt),
      diff: ra > 0 ? tp - ra : null,
      growth: ra > 0 ? sDiv(tp - ra, ra) : null,
    };
  }

  function buildRhythmCells(data, options) {
    var opts = options || {};
    var judgment = opts.judgment || '';
    var judgmentClass = opts.judgmentClass || 'rhythm-j';
    return ''
      + '<td class="plan-date-cell rs-date ' + (opts.dateClass || '') + '">' + utils.escapeHtml(opts.range || '-') + '</td>'
      + '<td class="rs-label">' + (opts.labelHtml || '<span class="plan-muted">-</span>') + '</td>'
      + '<td class="plan-text-cell">' + data.days + '</td>'
      + '<td class="plan-text-cell">' + utils.escapeHtml(utils.formatCurrency(data.wx)) + '</td>'
      + '<td class="plan-text-cell">' + utils.escapeHtml(utils.formatCurrency(data.ag)) + '</td>'
      + '<td class="plan-text-cell">' + utils.escapeHtml(utils.formatCurrency(data.tp)) + '</td>'
      + '<td class="plan-text-cell">' + fmtC(data.dap) + '</td>'
      + '<td class="plan-text-cell">' + fmtP(data.pp) + '</td>'
      + '<td class="plan-text-cell">' + utils.escapeHtml(utils.formatCurrency(data.ac)) + '</td>'
      + '<td class="plan-text-cell">' + fmtP(data.cr) + '</td>'
      + '<td class="plan-text-cell">' + fmtC(data.daa) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRef(data.rwta) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtP(data.rwtaShare) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRef(data.ra) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRef(data.aa) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtF(data.oc) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtF(data.doc) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtF(data.pc) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtF(data.cc) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRefN(data.rv) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRefN(data.ro) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRefN(data.rdo) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRefN(data.rc) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRefN(data.rp) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRefN(data.rt) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtRefN(data.rb) + '</td>'
      + '<td class="plan-text-cell plan-ref-cell">' + fmtP(data.asr) + '</td>'
      + '<td class="plan-text-cell">' + (data.diff != null ? utils.escapeHtml(utils.formatCurrency(data.diff)) : '<span class="plan-muted">-</span>') + '</td>'
      + '<td class="plan-text-cell">' + fmtP(data.growth) + '</td>'
      + '<td class="' + judgmentClass + '">' + utils.escapeHtml(judgment || '-') + '</td>';
  }

  function buildRhythmRow(seg, monthTotal, referenceTotalWithAgent) {
    var ds = seg.days;
    var d0 = ds[0].date;
    var d1 = ds[ds.length - 1].date;
    var range = d0 === d1 ? d0 : d0 + ' ~ ' + d1;
    var data = summarizeRhythmDays(ds, monthTotal);
    data.rwtaShare = sDiv(data.rwta, referenceTotalWithAgent);
    var jt = rhythmJudgment(data.growth);
    var jc = judgmentCls(jt);
    return '<tr>' + buildRhythmCells(data, {
      range: range,
      labelHtml: rhythmLabel(seg),
      judgment: jt,
      judgmentClass: jc,
    }) + '</tr>';
  }

  function buildRhythmTotalRow(days, monthTotal, referenceTotalWithAgent) {
    var data = summarizeRhythmDays(days, monthTotal);
    data.rwtaShare = sDiv(data.rwta, referenceTotalWithAgent);
    return '<tr class="rhythm-summary-total-row">' + buildRhythmCells(data, {
      range: '汇总',
      dateClass: 'rhythm-summary-total-label',
      labelHtml: '<span class="plan-muted">-</span>',
      judgment: '-',
      judgmentClass: 'rhythm-j rhythm-summary-total-blank',
    }) + '</tr>';
  }

  function buildRhythmExportRow(data, range, label, judgment) {
    return [
      range,
      label,
      data.days,
      data.wx,
      data.ag,
      data.tp,
      data.dap,
      data.pp != null ? utils.formatPercent(data.pp) : '--',
      data.ac,
      data.cr != null ? utils.formatPercent(data.cr) : '--',
      data.daa,
      data.rwta,
      data.rwtaShare != null ? utils.formatPercent(data.rwtaShare) : '--',
      data.ra,
      data.aa,
      data.oc,
      data.doc,
      data.pc,
      data.cc,
      data.rv,
      data.ro,
      data.rdo,
      data.rc,
      data.rp,
      data.rt,
      data.rb,
      data.asr != null ? utils.formatPercent(data.asr) : '--',
      data.diff,
      data.growth != null ? utils.formatPercent(data.growth) : '--',
      judgment || '-',
    ];
  }

  function getRhythmSummaryExportData() {
    var days = getEffectiveDays();
    var headers = [
      '时间范围',
      '活动节奏',
      '天数',
      '万相台计划',
      '有客代投计划',
      '总计划金额',
      '日均计划金额',
      '计划占比',
      '实际花费',
      '花费完成率',
      '日均实际花费',
      '25年含代投总花费',
      '25年含代投花费占比',
      '25年花费',
      '25年代投花费',
      '25年订单成本',
      '25年直接成交订单成本',
      '25年预售订单成本',
      '25年加购成本',
      '25年观看次数',
      '25年总成交笔数',
      '25年直接成交笔数',
      '25年总购物车数',
      '25年预售成交笔数',
      '25年淘宝成交笔数',
      '25年成交人数',
      '25年广告成交占比',
      '差额',
      '增幅',
      '节奏判断',
    ];
    if (!days.length) return { headers: headers, rows: [] };
    var segs = buildRhythmSegments(days);
    var monthTotal = utils.sum(days.map(function(d) { return d.total_plan_amount; }));
    var referenceTotalWithAgent = summarizeRhythmDays(days, monthTotal).rwta;
    var rows = segs.map(function(seg) {
      var ds = seg.days;
      var d0 = ds[0].date;
      var d1 = ds[ds.length - 1].date;
      var range = d0 === d1 ? d0 : d0 + ' ~ ' + d1;
      var data = summarizeRhythmDays(ds, monthTotal);
      data.rwtaShare = sDiv(data.rwta, referenceTotalWithAgent);
      var judgment = rhythmJudgment(data.growth);
      return buildRhythmExportRow(data, range, rhythmLabelText(seg), judgment);
    });
    var totalData = summarizeRhythmDays(days, monthTotal);
    totalData.rwtaShare = sDiv(totalData.rwta, referenceTotalWithAgent);
    rows.push(buildRhythmExportRow(totalData, '汇总', '-', '-'));
    return { headers: headers, rows: rows };
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
        rows: [['数据来自“25年双11数据参考.xlsx”。日期列中部分单元格被 Excel 自动转为日期格式，已按阶段和天数还原为 10/1-10/14、11/1-11/6、11/7-11/14，需业务确认时可再校对原表。']],
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

  function renderRhythmSummary() {
    var el = document.getElementById('rhythm-summary-container');
    if (!el) return;
    if (!syncCollapsibleSection('rhythmSummary')) return;
    var days = getEffectiveDays();
    if (!days.length) {
      el.innerHTML = '<div class="rhythm-summary-empty">\u5f53\u524d\u65e5\u671f\u8303\u56f4\u5185\u6682\u65e0\u6570\u636e\uff0c\u65e0\u6cd5\u751f\u6210\u8282\u594f\u6c47\u603b\u3002</div>';
      return;
    }
    var segs = buildRhythmSegments(days);
    var monthTotal = utils.sum(days.map(function(d) { return d.total_plan_amount; }));
    var referenceTotalWithAgent = summarizeRhythmDays(days, monthTotal).rwta;

    el.innerHTML =
      '<div class="table-shell">'
      + '<div class="table-scroll">'
      + '<table class="plan-table rhythm-summary-table">'
      + '<thead><tr>'
      + '<th>\u65f6\u95f4\u8303\u56f4</th>'
      + '<th>\u6d3b\u52a8\u8282\u594f</th>'
      + '<th>\u5929\u6570</th>'
      + '<th>\u4e07\u76f8\u53f0\u8ba1\u5212</th>'
      + '<th>\u6709\u5ba2\u4ee3\u6295\u8ba1\u5212</th>'
      + '<th>\u603b\u8ba1\u5212\u91d1\u989d</th>'
      + '<th>\u65e5\u5747\u8ba1\u5212\u91d1\u989d</th>'
      + '<th>\u8ba1\u5212\u5360\u6bd4</th>'
      + '<th>\u5b9e\u9645\u82b1\u8d39</th>'
      + '<th>\u82b1\u8d39\u5b8c\u6210\u7387</th>'
      + '<th>\u65e5\u5747\u5b9e\u9645\u82b1\u8d39</th>'
      + '<th>25\u5e74\u542b\u4ee3\u6295\u603b\u82b1\u8d39</th>'
      + '<th>25\u5e74\u542b\u4ee3\u6295\u82b1\u8d39\u5360\u6bd4</th>'
      + '<th>25\u5e74\u82b1\u8d39</th>'
      + '<th>25\u5e74\u4ee3\u7406\u82b1\u8d39</th>'
      + '<th>25\u5e74\u8ba2\u5355\u6210\u672c</th>'
      + '<th>25\u5e74\u76f4\u63a5\u6210\u4ea4\u8ba2\u5355\u6210\u672c</th>'
      + '<th>25\u5e74\u9884\u552e\u8ba2\u5355\u6210\u672c</th>'
      + '<th>25\u5e74\u52a0\u8d2d\u6210\u672c</th>'
      + '<th>25\u5e74\u89c2\u770b\u6b21\u6570</th>'
      + '<th>25\u5e74\u603b\u6210\u4ea4\u7b14\u6570</th>'
      + '<th>25\u5e74\u76f4\u63a5\u6210\u4ea4\u7b14\u6570</th>'
      + '<th>25\u5e74\u603b\u8d2d\u7269\u8f66\u6570</th>'
      + '<th>25\u5e74\u9884\u552e\u6210\u4ea4\u7b14\u6570</th>'
      + '<th>25\u5e74\u6dd8\u5b9d\u6210\u4ea4\u7b14\u6570</th>'
      + '<th>25\u5e74\u6210\u4ea4\u4eba\u6570</th>'
      + '<th>25\u5e74\u5e7f\u544a\u6210\u4ea4\u5360\u6bd4</th>'
      + '<th>\u5dee\u989d</th>'
      + '<th>\u589e\u5e45</th>'
      + '<th>\u8282\u594f\u5224\u65ad</th>'
      + '</tr></thead>'
      + '<tbody>'
      + segs.map(function(s) { return buildRhythmRow(s, monthTotal, referenceTotalWithAgent); }).join('')
      + '</tbody>'
      + '<tfoot>'
      + buildRhythmTotalRow(days, monthTotal, referenceTotalWithAgent)
      + '</tfoot>'
      + '</table></div></div>';
  }

  function renderRhythmSummarySkeleton() {
    var el = document.getElementById('rhythm-summary-container');
    if (!el) return;
    if (!syncCollapsibleSection('rhythmSummary')) return;
    var skCols = Array(30).fill('').map(function() { return '<td><div class="skeleton-line" style="width:80%"></div></td>'; }).join('');
    el.innerHTML =
      '<div class="table-shell"><div class="table-scroll">'
      + '<table class="plan-table rhythm-summary-table"><thead><tr>'
      + '<th>\u65f6\u95f4\u8303\u56f4</th><th>\u6d3b\u52a8\u8282\u594f</th><th>\u5929\u6570</th>'
      + '<th>\u4e07\u76f8\u53f0\u8ba1\u5212</th><th>\u6709\u5ba2\u4ee3\u6295\u8ba1\u5212</th><th>\u603b\u8ba1\u5212\u91d1\u989d</th>'
      + '<th>\u65e5\u5747\u8ba1\u5212\u91d1\u989d</th><th>\u8ba1\u5212\u5360\u6bd4</th><th>\u5b9e\u9645\u82b1\u8d39</th>'
      + '<th>\u82b1\u8d39\u5b8c\u6210\u7387</th><th>\u65e5\u5747\u5b9e\u9645\u82b1\u8d39</th>'
      + '<th>25\u5e74\u542b\u4ee3\u6295\u603b\u82b1\u8d39</th><th>25\u5e74\u542b\u4ee3\u6295\u82b1\u8d39\u5360\u6bd4</th><th>25\u5e74\u82b1\u8d39</th><th>25\u5e74\u4ee3\u7406\u82b1\u8d39</th>'
      + '<th>25\u5e74\u8ba2\u5355\u6210\u672c</th><th>25\u5e74\u76f4\u63a5\u6210\u4ea4\u8ba2\u5355\u6210\u672c</th><th>25\u5e74\u9884\u552e\u8ba2\u5355\u6210\u672c</th><th>25\u5e74\u52a0\u8d2d\u6210\u672c</th>'
      + '<th>25\u5e74\u89c2\u770b\u6b21\u6570</th><th>25\u5e74\u603b\u6210\u4ea4\u7b14\u6570</th><th>25\u5e74\u76f4\u63a5\u6210\u4ea4\u7b14\u6570</th>'
      + '<th>25\u5e74\u603b\u8d2d\u7269\u8f66\u6570</th><th>25\u5e74\u9884\u552e\u6210\u4ea4\u7b14\u6570</th>'
      + '<th>25\u5e74\u6dd8\u5b9d\u6210\u4ea4\u7b14\u6570</th><th>25\u5e74\u6210\u4ea4\u4eba\u6570</th>'
      + '<th>25\u5e74\u5e7f\u544a\u6210\u4ea4\u5360\u6bd4</th><th>\u5dee\u989d</th><th>\u589e\u5e45</th><th>\u8282\u594f\u5224\u65ad</th>'
      + '</tr></thead><tbody>'
      + Array(4).fill('').map(function() { return '<tr>' + skCols + '</tr>'; }).join('')
      + '</tbody></table></div></div>';
  }

  /* ---- Month Note ---- */

  function renderMonthNote() {
    var el = document.getElementById('month-note-container');
    if (!el) return;
    if (!syncCollapsibleSection('monthNote')) return;
    var ns = stateModule.state.monthNote;
    var badge = ns.month ? '<span class="month-note-badge">' + utils.escapeHtml(ns.month + '\u6708') + '</span>' : '';

    if (ns.loading) {
      el.innerHTML = '<div class="month-note-body">' + badge + '<div class="skeleton-line lg" style="width:60%"></div><div class="skeleton-line" style="width:40%;margin-top:8px"></div></div>';
      return;
    }

    if (ns.editing) {
      el.innerHTML = '<div class="month-note-body">' + badge
        + '<textarea id="month-note-textarea" class="month-note-textarea" placeholder="\u8f93\u5165\u5f53\u6708\u5173\u952e\u4fe1\u606f\u8bf4\u660e\u2026">' + utils.escapeHtml(ns.content || '') + '</textarea>'
        + '<div class="month-note-actions">'
        + '<button type="button" class="button button-secondary" id="month-note-cancel-btn">\u53d6\u6d88</button>'
        + '<button type="button" class="button button-primary" id="month-note-save-btn"' + (ns.saving ? ' disabled' : '') + '>' + (ns.saving ? '\u4fdd\u5b58\u4e2d\u2026' : '\u4fdd\u5b58\u8bf4\u660e') + '</button>'
        + '</div></div>';
      if (!ns.saving) {
        var ta = document.getElementById('month-note-textarea');
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      }
      return;
    }

    if (!ns.content) {
      el.innerHTML = '<div class="month-note-body month-note-empty">' + badge
        + '<span>\u6682\u65e0\u8bf4\u660e\u5185\u5bb9</span>'
        + '<button type="button" class="button button-secondary" id="month-note-edit-btn">\u6dfb\u52a0\u8bf4\u660e</button>'
        + '</div>';
      return;
    }

    el.innerHTML = '<div class="month-note-body">' + badge
      + '<div class="month-note-content">' + utils.escapeHtml(ns.content).replace(/\n/g, '<br>') + '</div>'
      + '<button type="button" class="button button-secondary month-note-edit-inline" id="month-note-edit-btn">\u7f16\u8f91\u8bf4\u660e</button>'
      + '</div>';
  }

  function renderMonthNoteSkeleton() {
    var el = document.getElementById('month-note-container');
    if (!el) return;
    if (!syncCollapsibleSection('monthNote')) return;
    el.innerHTML = '<div class="month-note-body"><div class="skeleton-line lg" style="width:60%"></div><div class="skeleton-line" style="width:40%;margin-top:8px"></div></div>';
  }

  function renderTableFull() {
    const el = document.getElementById('table-container');
    if (!el) return;
    const days = getEffectiveDays();
    if (!days.length) {
      el.innerHTML = '<div class="table-shell"><div class="plan-status">当前日期范围内暂无明细数据。</div></div>';
      return;
    }
    const totalPlan = utils.sum(days.map((item) => item.total_plan_amount));
    const totalActual = utils.sum(days.map((item) => item.actual_cost));
    const overallCompletion = totalPlan > 0 ? totalActual / totalPlan : null;
    el.innerHTML = `
      <div class="table-shell">
        <div class="table-summary-bar">
          <span>合计：计划 <strong>${utils.escapeHtml(utils.formatCurrency(totalPlan))}</strong></span>
          <span>实际 <strong>${utils.escapeHtml(utils.formatCurrency(totalActual))}</strong></span>
          <span>完成率 <strong>${utils.escapeHtml(utils.formatPercent(overallCompletion))}</strong></span>
        </div>
        <div class="table-scroll">
          <table class="plan-table" id="plan-data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>万相台计划</th>
                <th>有客代投计划</th>
                <th>总计划金额</th>
                <th>活动节奏</th>
                <th>备注</th>
                <th>实际花费</th>
	                <th>25年代投花费</th>
	                <th>25年花费</th>
	                <th>25年观看次数</th>
	                <th>25年总成交笔数</th>
	                <th>25年直接成交笔数</th>
	                <th>25年总购物车数</th>
	                <th>25年预售成交笔数</th>
	                <th>25年成交人数</th>
	                <th>25年淘宝成交笔数</th>
	                <th>25年订单成本</th>
	                <th>25年直接成交订单成本</th>
	                <th>25年预售订单成本</th>
	                <th>25年加购成本</th>
	                <th>25年广告成交占比</th>
                <th>25年保量佣金</th>
                <th>25年预估结算机构佣金</th>
                <th>25年品牌费</th>
              </tr>
            </thead>
            <tbody id="plan-table-body">
              ${days.map((day) => buildTableRow(day)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function buildTableRow(day) {
    const refAmount = utils.toNumber(day.reference_amount ?? day.reference_2025_amount ?? 0);
    return `
      <tr data-row-date="${utils.escapeHtml(day.date)}" class="${day.is_dirty ? 'plan-dirty-row' : ''}">
        <td class="plan-date-cell">${utils.escapeHtml(day.date)}${day.is_dirty ? '<span class="dirty-pill">未保存</span>' : ''}</td>
        <td>${buildEditableCell(day.date, 'wanxiang_plan', day.wanxiang_plan)}</td>
        <td>${buildEditableCell(day.date, 'agent_plan', day.agent_plan)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(utils.formatCurrency(day.total_plan_amount))}</td>
        <td>${buildActivityCell(day)}</td>
        <td>${buildEditableCell(day.date, 'remark', day.remark)}</td>
        <td class="plan-text-cell">${utils.escapeHtml(utils.formatCurrency(day.actual_cost))}</td>
	        <td class="plan-text-cell">${fmtC(day.agent_amount)}</td>
	        <td class="plan-text-cell plan-ref-cell">${refAmount > 0 ? utils.escapeHtml(utils.formatCurrency(refAmount)) : '<span class="plan-muted">-</span>'}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtRefN(day.reference_views)}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtRefN(day.reference_orders)}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtRefN(day.reference_direct_orders)}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtRefN(day.reference_cart)}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtRefN(day.reference_pre_orders)}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtRefN(day.reference_buyers)}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtRefN(day.reference_taobao_orders)}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtF(sDiv(day.reference_amount ?? day.reference_2025_amount, day.reference_orders))}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtF(sDiv(day.reference_amount ?? day.reference_2025_amount, day.reference_direct_orders))}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtF(sDiv(day.reference_amount ?? day.reference_2025_amount, day.reference_pre_orders))}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtF(sDiv(day.reference_amount ?? day.reference_2025_amount, day.reference_cart))}</td>
	        <td class="plan-text-cell plan-ref-cell">${fmtP(sDiv(day.reference_orders, day.reference_taobao_orders))}</td>
        <td class="plan-text-cell plan-ref-cell">${fmtRef(day.reference_financial_guarantee_commission)}</td>
        <td class="plan-text-cell plan-ref-cell">${fmtRef(day.reference_financial_estimated_agency_commission)}</td>
        <td class="plan-text-cell plan-ref-cell">${fmtRef(day.reference_financial_brand_fee)}</td>
      </tr>`;
  }

  function updateTableRowInPlace(date) {
    const row = document.querySelector(`tr[data-row-date="${CSS.escape(date)}"]`);
    if (!row) return;
    const dayData = (stateModule.state.summary.days || []).find((d) => d.date === date);
    if (!dayData) return;
    const day = getEffectiveDay(dayData);
    const temp = document.createElement('tbody');
    temp.innerHTML = buildTableRow(day);
    const newRow = temp.firstElementChild;
    if (!newRow) return;

    row.className = newRow.className;
    const oldCells = row.querySelectorAll('td');
    const newCells = newRow.querySelectorAll('td');
    for (let i = 0; i < oldCells.length; i++) {
      const oldInput = oldCells[i].querySelector('input, select');
      const newInput = newCells[i] ? newCells[i].querySelector('input, select') : null;
      if (oldInput && newInput && document.activeElement === oldInput) {
        continue;
      }
      if (newCells[i]) {
        oldCells[i].innerHTML = newCells[i].innerHTML;
      }
    }
    const dateCell = oldCells[0];
    if (dateCell && newCells[0]) {
      dateCell.innerHTML = newCells[0].innerHTML;
    }
  }

  function updateSummaryBar() {
    const bar = document.querySelector('.table-summary-bar');
    if (!bar) return;
    const days = getEffectiveDays();
    const totalPlan = utils.sum(days.map((item) => item.total_plan_amount));
    const totalActual = utils.sum(days.map((item) => item.actual_cost));
    const overallCompletion = totalPlan > 0 ? totalActual / totalPlan : null;
    bar.innerHTML = `
      <span>合计：计划 <strong>${utils.escapeHtml(utils.formatCurrency(totalPlan))}</strong></span>
      <span>实际 <strong>${utils.escapeHtml(utils.formatCurrency(totalActual))}</strong></span>
      <span>完成率 <strong>${utils.escapeHtml(utils.formatPercent(overallCompletion))}</strong></span>`;
  }

  function buildActivityTypeSelect(selectId, currentType, fieldClass) {
    const options = utils.getActivityTypeOptions();
    const selectedType = String(currentType || 'daily').trim() || 'daily';
    return `<select id="${selectId}" class="${fieldClass}">${options.map((type) => `<option value="${utils.escapeHtml(type)}" ${type === selectedType ? 'selected' : ''}>${utils.escapeHtml(utils.getActivityTypeMeta(type).label)}</option>`).join('')}</select>`;
  }

  function renderTableSkeleton() {
    const el = document.getElementById('table-container');
    if (!el) return;
    el.innerHTML = `<div class="table-shell"><div class="table-scroll">
      <table class="plan-table"><thead><tr>
        <th>日期</th><th>万相台计划</th><th>有客代投计划</th><th>总计划金额</th><th>活动节奏</th><th>备注</th><th>实际花费</th>
	        <th>25年代投花费</th><th>25年花费</th><th>25年观看次数</th><th>25年总成交笔数</th><th>25年直接成交笔数</th><th>25年总购物车数</th><th>25年预售成交笔数</th>
	        <th>25年成交人数</th><th>25年淘宝成交笔数</th><th>25年订单成本</th><th>25年直接成交订单成本</th><th>25年预售订单成本</th><th>25年加购成本</th><th>25年广告成交占比</th>
	        <th>25年保量佣金</th><th>25年预估结算机构佣金</th><th>25年品牌费</th>
	      </tr></thead><tbody>
	        ${Array(8).fill('').map(() => `<tr>${Array(24).fill('').map(() => '<td><div class="skeleton-line" style="width:80%"></div></td>').join('')}</tr>`).join('')}
	      </tbody></table>
	    </div></div>`;
  }

  function renderDrawer() {
    const drawer = document.getElementById('activity-drawer');
    if (!drawer) return;
    const activity = stateModule.getActivityById(stateModule.state.ui.activeDrawerActivityId);
    if (!activity) {
      drawer.classList.add('hidden');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.innerHTML = '';
      return;
    }
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.innerHTML = `
      <div class="drawer-head">
        <h3>编辑活动</h3>
        <button type="button" class="button button-secondary" id="drawer-close-btn">关闭</button>
      </div>
      <div class="drawer-form">
        <label>活动名称<input id="drawer-activity-name" class="drawer-field" value="${utils.escapeHtml(activity.activity_name)}"></label>
        <label>平台节奏
          ${buildActivityTypeSelect('drawer-activity-type', activity.activity_type, 'drawer-field')}
        </label>
        <div class="drawer-row-2col">
          <label>开始日期<input id="drawer-start-date" class="drawer-field" type="date" value="${utils.escapeHtml(activity.start_date)}"></label>
          <label>开始时间<input id="drawer-start-time" class="drawer-field" type="time" value="${utils.escapeHtml(activity.start_time || '')}"></label>
        </div>
        <div class="drawer-row-2col">
          <label>结束日期<input id="drawer-end-date" class="drawer-field" type="date" value="${utils.escapeHtml(activity.end_date)}"></label>
          <label>结束时间<input id="drawer-end-time" class="drawer-field" type="time" value="${utils.escapeHtml(activity.end_time || '')}"></label>
        </div>
        <label>重要场次<input id="drawer-key-sessions" class="drawer-field" value="${utils.escapeHtml(activity.key_sessions || '')}" placeholder="多个用逗号分隔，如 0513罗场,0520罗场"></label>
        <label>运营动作<input id="drawer-operations-action" class="drawer-field" value="${utils.escapeHtml(activity.operations_action || '')}" placeholder="如 发定金红包+100%商品预热"></label>
        <label>活动说明<textarea id="drawer-description" class="drawer-textarea">${utils.escapeHtml(activity.description || '')}</textarea></label>
      </div>
      <div class="drawer-actions">
        <button type="button" class="button button-secondary" id="drawer-delete-btn" data-activity-id="${utils.escapeHtml(activity.id)}">删除活动</button>
        <button type="button" class="button button-primary" id="drawer-save-btn" data-activity-id="${utils.escapeHtml(activity.id)}">保存并同步</button>
      </div>`;
  }

  function renderCreateModal() {
    const modal = document.getElementById('activity-modal');
    if (!modal) return;
    if (!stateModule.state.ui.isCreateModalOpen) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML = '';
      return;
    }
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.innerHTML = `
      <div class="plan-modal-card">
        <div class="modal-head">
          <h3>新增活动</h3>
          <button type="button" class="button button-secondary" id="create-activity-cancel-btn">取消</button>
        </div>
        <div class="modal-form">
          <label>活动名称<input id="create-activity-name" class="modal-field" placeholder="例如：618 第一波预售"></label>
          <label>平台节奏
            ${buildActivityTypeSelect('create-activity-type', 'daily', 'modal-field')}
          </label>
          <div class="modal-row-2col">
            <label>开始日期<input id="create-start-date" class="modal-field" type="date" value="${utils.escapeHtml(stateModule.state.range.start || '')}"></label>
            <label>开始时间<input id="create-start-time" class="modal-field" type="time" placeholder="如 20:00"></label>
          </div>
          <div class="modal-row-2col">
            <label>结束日期<input id="create-end-date" class="modal-field" type="date" value="${utils.escapeHtml(stateModule.state.range.end || '')}"></label>
            <label>结束时间<input id="create-end-time" class="modal-field" type="time" placeholder="如 23:59"></label>
          </div>
          <label>重要场次<input id="create-key-sessions" class="modal-field" placeholder="多个用逗号分隔，如 0513罗场,0520罗场"></label>
          <label>运营动作<input id="create-operations-action" class="modal-field" placeholder="如 发定金红包+100%商品预热"></label>
          <label>活动说明<textarea id="create-activity-description" class="modal-textarea" placeholder="可选：记录活动说明、投放重点等"></textarea></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="button button-secondary" id="create-activity-cancel-btn">取消</button>
          <button type="button" class="button button-primary" id="create-activity-save-btn">创建并同步</button>
        </div>
      </div>`;
  }

  function renderStatus() {
    const status = document.getElementById('page-status');
    if (!status) return;

    if (stateModule.state.error) {
      status.textContent = stateModule.state.error;
      status.className = 'plan-status plan-status-error';
      updateSaveBadge(Object.keys(stateModule.state.drafts.dayPatches || {}).length);
      return;
    }

    if (stateModule.state.loading) {
      status.textContent = '正在加载计划拆解数据…';
      status.className = 'plan-status plan-status-loading';
      updateSaveBadge(Object.keys(stateModule.state.drafts.dayPatches || {}).length);
      return;
    }

    if (stateModule.state.saving) {
      status.textContent = '正在保存修改…';
      status.className = 'plan-status plan-status-loading';
      updateSaveBadge(Object.keys(stateModule.state.drafts.dayPatches || {}).length);
      return;
    }

    if (stateModule.state.saveMessage) {
      status.textContent = stateModule.state.saveMessage;
      status.className = 'plan-status plan-status-success';
      updateSaveBadge(Object.keys(stateModule.state.drafts.dayPatches || {}).length);
      return;
    }

    const dirtyCount = Object.keys(stateModule.state.drafts.dayPatches || {}).length;
    if (dirtyCount > 0) {
      status.textContent = `当前有 ${dirtyCount} 条未保存修改`;
      status.className = 'plan-status plan-status-warn';
      updateSaveBadge(dirtyCount);
      return;
    }

    const range = stateModule.state.range;
    status.textContent = range.start && range.end ? `当前查看范围：${range.start} ~ ${range.end}` : '当前暂无查询范围';
    status.className = 'plan-status';
    updateSaveBadge(0);
  }

  function updateSaveBadge(count) {
    const btn = document.getElementById('save-all-btn');
    if (!btn) return;
    let badge = btn.querySelector('.save-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'save-badge';
        btn.appendChild(badge);
      }
      badge.textContent = String(count);
      btn.classList.add('has-changes');
    } else {
      if (badge) badge.remove();
      btn.classList.remove('has-changes');
    }
  }

  function renderLoadingSkeleton() {
    renderTimelineSkeleton();
    renderDouble11Reference();
    renderSix18Reference();
    renderRhythmSummarySkeleton();
    renderMonthNoteSkeleton();
    renderTableSkeleton();
  }

  function renderPage() {
    if (stateModule.state.loading) {
      renderLoadingSkeleton();
      renderStatus();
      return;
    }
    renderTimeline();
    renderDouble11Reference();
    renderSix18Reference();
    renderRhythmSummary();
    renderMonthNote();
    renderTableFull();
    renderDrawer();
    renderCreateModal();
    renderStatus();
  }

  function renderDraftUpdate(date) {
    updateTableRowInPlace(date);
    updateSummaryBar();
    renderRhythmSummary();
    renderStatus();
  }

  window.PlanDashboardRender = {
    renderPage,
    renderDraftUpdate,
    renderDrawer,
    renderCreateModal,
    renderStatus,
    renderMonthNote,
    getEffectiveDays,
    getRhythmSummaryExportData,
    getDouble11ReferenceExportSections,
    getSix18ReferenceExportSections,
  };
})(window);
