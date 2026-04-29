(function attachPlanDashboardPage(window) {
  const stateModule = window.PlanDashboardState;
  const api = window.PlanDashboardApi;
  const render = window.PlanDashboardRender;
  const events = window.PlanDashboardEvents;

  const PLAN_YEAR = 2026;
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const PLAN_BREAKDOWN_START_MONTH = 4;
  const PLAN_BREAKDOWN_AVAILABLE_MONTHS = MONTHS.filter((month) => month >= PLAN_BREAKDOWN_START_MONTH);
  const PLAN_BREAKDOWN_UNAVAILABLE_REASON = '1–3 月暂无计划拆解';

  function pad2(n) { return String(n).padStart(2, '0'); }

  function localDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function monthRange(year, startMonth, endMonth = startMonth) {
    return {
      start: `${year}-${pad2(startMonth)}-01`,
      end: localDateStr(new Date(year, endMonth, 0)),
    };
  }

  function currentMonth() {
    const now = new Date();
    return now.getFullYear() === PLAN_YEAR ? now.getMonth() + 1 : PLAN_BREAKDOWN_START_MONTH;
  }

  function isMonthDisabled(month) {
    return !PLAN_BREAKDOWN_AVAILABLE_MONTHS.includes(month);
  }

  function normalizeSelectedMonths(months) {
    return Array.from(new Set((months || [])
      .map((month) => Number(month))
      .filter((month) => Number.isFinite(month) && !isMonthDisabled(month))))
      .sort((left, right) => left - right);
  }

  function getFullAvailableRange() {
    return monthRange(
      PLAN_YEAR,
      PLAN_BREAKDOWN_AVAILABLE_MONTHS[0],
      PLAN_BREAKDOWN_AVAILABLE_MONTHS[PLAN_BREAKDOWN_AVAILABLE_MONTHS.length - 1],
    );
  }

  function buildContinuousMonths(startMonth, endMonth) {
    const rangeStart = Math.min(startMonth, endMonth);
    const rangeEnd = Math.max(startMonth, endMonth);
    return MONTHS.filter((month) => month >= rangeStart && month <= rangeEnd && !isMonthDisabled(month));
  }

  function formatSelectedMonthsLabel(selectedMonths) {
    if (!selectedMonths.length) return '';
    if (selectedMonths.length === 1) return `${selectedMonths[0]} 月`;
    return `${selectedMonths[0]}–${selectedMonths[selectedMonths.length - 1]} 月`;
  }

  function renderMonthPicker(selectedMonths) {
    const container = document.getElementById('month-picker');
    if (!container) return;
    const selectedSet = new Set(selectedMonths || []);
    const now = new Date();
    const nowMonth = now.getFullYear() === PLAN_YEAR ? now.getMonth() + 1 : 0;
    container.innerHTML = MONTHS.map((month) => {
      const isActive = selectedSet.has(month);
      const isFuture = month > nowMonth && nowMonth > 0;
      const isDisabled = isMonthDisabled(month);
      const disabledAttrs = isDisabled
        ? ` disabled title="${PLAN_BREAKDOWN_UNAVAILABLE_REASON}" aria-label="${month}月（${PLAN_BREAKDOWN_UNAVAILABLE_REASON}）"`
        : '';
      return `<button type="button" class="month-btn${isActive ? ' month-btn-active' : ''}${isFuture ? ' month-btn-future' : ''}${isDisabled ? ' month-btn-disabled' : ''}" data-month="${month}"${disabledAttrs}>${month}月</button>`;
    }).join('');
  }

  function renderMonthPickerNote(selectedMonths, start, end) {
    const note = document.getElementById('month-picker-note');
    if (!note) return;
    if (!selectedMonths.length) {
      note.textContent = `${PLAN_BREAKDOWN_UNAVAILABLE_REASON}。当前未选月份，按 ${start} ~ ${end} 全范围查询；点击任意月份开始筛选，再次点击已选月份可取消该月。`;
      return;
    }
    const label = formatSelectedMonthsLabel(selectedMonths);
    note.textContent = `${PLAN_BREAKDOWN_UNAVAILABLE_REASON}。当前已选 ${label}（按 ${start} ~ ${end} 连续区间查询）；点击其他月份可扩展范围，点击已选月份可取消该月。`;
  }

  function getInitialMonth() {
    const month = currentMonth();
    return isMonthDisabled(month) ? PLAN_BREAKDOWN_AVAILABLE_MONTHS[0] : month;
  }

  function getSelectedMonths() {
    return normalizeSelectedMonths(stateModule.state.ui.selectedMonths);
  }

  function applySelectedMonths(months, options = {}) {
    const selectedMonths = normalizeSelectedMonths(months);
    const { start, end } = selectedMonths.length
      ? monthRange(PLAN_YEAR, selectedMonths[0], selectedMonths[selectedMonths.length - 1])
      : getFullAvailableRange();
    const startInput = document.getElementById('range-start');
    const endInput = document.getElementById('range-end');
    if (startInput) startInput.value = start;
    if (endInput) endInput.value = end;
    stateModule.state.range = { start, end };
    stateModule.state.ui.selectedMonths = selectedMonths;
    stateModule.state.ui.monthSelectionAnchor = options.anchorMonth ?? selectedMonths[0] ?? null;
    renderMonthPicker(selectedMonths);
    renderMonthPickerNote(selectedMonths, start, end);
    if (options.reload !== false) {
      reloadSummary(true);
    }
  }

  function handleMonthSelection(month) {
    if (isMonthDisabled(month)) return;
    const selectedMonths = getSelectedMonths();
    if (selectedMonths.includes(month)) {
      const remainingMonths = selectedMonths.filter((selectedMonth) => selectedMonth !== month);
      const nextAnchor = remainingMonths.includes(stateModule.state.ui.monthSelectionAnchor)
        ? stateModule.state.ui.monthSelectionAnchor
        : remainingMonths[0] ?? null;
      applySelectedMonths(remainingMonths, { anchorMonth: nextAnchor });
      return;
    }
    if (!selectedMonths.length) {
      applySelectedMonths([month], { anchorMonth: month });
      return;
    }
    const anchor = Number(stateModule.state.ui.monthSelectionAnchor);
    const validAnchor = Number.isFinite(anchor) && !isMonthDisabled(anchor) ? anchor : selectedMonths[0];
    applySelectedMonths(buildContinuousMonths(validAnchor, month), { anchorMonth: validAnchor });
  }

  async function loadMonthNote() {
    const ns = stateModule.state.monthNote;
    try {
      const result = await api.fetchMonthNote(ns.year, ns.month);
      ns.content = (result && result.note && result.note.content) || '';
    } catch (_) {
      ns.content = '';
    } finally {
      ns.loading = false;
    }
  }

  async function reloadSummary(showLoading = true) {
    const start = document.getElementById('range-start')?.value || stateModule.state.range.start;
    const end = document.getElementById('range-end')?.value || stateModule.state.range.end;
    stateModule.state.range = { start, end };
    stateModule.state.error = '';
    if (showLoading) {
      stateModule.state.saveMessage = '';
    }
    stateModule.state.loading = showLoading;

    const selectedMonths = getSelectedMonths();
    const noteMonth = selectedMonths.length ? selectedMonths[0] : getInitialMonth();
    stateModule.state.monthNote.loading = true;
    stateModule.state.monthNote.editing = false;
    stateModule.state.monthNote.saving = false;
    stateModule.state.monthNote.year = PLAN_YEAR;
    stateModule.state.monthNote.month = noteMonth;

    render.renderPage();
    try {
      const [summary] = await Promise.all([
        api.fetchSummary(start, end),
        loadMonthNote(),
      ]);
      stateModule.state.summary = summary;
      if (showLoading) {
        stateModule.clearAllDrafts();
      }
    } catch (error) {
      stateModule.state.error = error instanceof Error ? error.message : '加载计划拆解失败，请刷新页面后重试';
    } finally {
      stateModule.state.loading = false;
      render.renderPage();
    }
  }

  function init() {
    const month = getInitialMonth();
    applySelectedMonths([month], { reload: false, anchorMonth: month });

    document.getElementById('month-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.month-btn');
      if (!btn) return;
      const selectedMonth = Number(btn.dataset.month);
      if (selectedMonth) handleMonthSelection(selectedMonth);
    });

    events.bind();
    reloadSummary(true);
  }

  window.PlanDashboardPage = {
    getInitialMonth,
    isMonthDisabled,
    init,
    reloadSummary,
  };
  window.addEventListener('DOMContentLoaded', init);
})(window);
