(function attachPlanDashboardRenderShared(window) {
  const utils = window.PlanDashboardUtils;
  const stateModule = window.PlanDashboardState;
  const refData = window.PlanDashboardReferenceData || {};
  const DOUBLE11_REFERENCE_MONTHS = refData.DOUBLE11_REFERENCE_MONTHS || [5, 6];

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this;
      var args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, delay);
    };
  }
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
  const DOUBLE11_REFERENCE_SUMMARY = refData.DOUBLE11_REFERENCE_SUMMARY || [
    { label: '总投放周期', value: '10/1-11/30', helper: '61 天完整双11周期' },
    { label: '广告花费', value: '1,610.6万', helper: '有客代投 + 万相台' },
    { label: '日均花费', value: '26.4万', helper: '全周期日均投放强度' },
    { label: '渠道拆分', value: '772.0万 / 838.6万', helper: '有客代投 / 万相台' },
    { label: '预售成交', value: '127.6万', helper: '万相台总预售成交笔数' },
  ];
  var DOUBLE11_REFERENCE_PHASES = refData.DOUBLE11_REFERENCE_PHASES || [];

  const SIX18_REFERENCE_MONTHS = refData.SIX18_REFERENCE_MONTHS || [5, 6];
  const SIX18_RHYTHM_MONTHS = refData.SIX18_RHYTHM_MONTHS || [5, 6];
  const SIX18_RHYTHM_PHASES = refData.SIX18_RHYTHM_PHASES || [];
  const SIX18_REFERENCE_DAILY = refData.SIX18_REFERENCE_DAILY || [];
  const SIX18_REFERENCE_PHASE_META = refData.SIX18_REFERENCE_PHASE_META || [];

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

  window.PlanDashboardRenderShared = {
    utils,
    stateModule,
    refData,
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
    shouldShowDouble11Reference,
    buildEditableCell,
    getEffectiveDay,
    getEffectiveDays,
    buildActivityCell,
    rhythmKey,
    buildRhythmSegments,
    rhythmLabel,
    rhythmLabelText,
    sDiv,
    fmtC,
    fmtP,
    fmtF,
    fmtRef,
    fmtRefN,
    rhythmJudgment,
    judgmentCls,
    summarizeRhythmDays,
    buildRhythmCells,
    buildRhythmRow,
    buildRhythmTotalRow,
    buildRhythmExportRow,
    getRhythmSummaryExportData,
  };
})(window);
