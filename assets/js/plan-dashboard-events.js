(function attachPlanDashboardEvents(window) {
  const stateModule = window.PlanDashboardState;
  const api = window.PlanDashboardApi;
  const render = window.PlanDashboardRender;
  const utils = window.PlanDashboardUtils;

  function hasDirtyDrafts() {
    return Object.keys(stateModule.state.drafts.dayPatches || {}).length > 0;
  }

  function setMessage(message, isError) {
    stateModule.state.error = isError ? message : '';
    stateModule.state.saveMessage = isError ? '' : message;
    render.renderPage();
  }

  async function saveAllDays() {
    const items = Object.entries(stateModule.state.drafts.dayPatches).map(([date, patch]) => ({ date, patch }));
    if (!items.length) {
      setMessage('当前没有待保存修改', false);
      return;
    }
    stateModule.state.saving = true;
    render.renderStatus();
    try {
      await api.savePlans(items, utils.buildCurrentUserLabel());
      stateModule.clearAllDrafts();
      await window.PlanDashboardPage.reloadSummary(false);
      setMessage('全部修改已保存', false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量保存失败', true);
    } finally {
      stateModule.state.saving = false;
      render.renderStatus();
    }
  }

  function exportCSV() {
    const days = typeof render.getEffectiveDays === 'function'
      ? render.getEffectiveDays()
      : (stateModule.state.summary.days || []);
    const range = stateModule.state.range;
    const activities = [...(stateModule.state.summary.activities || [])]
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    const csvRows = [];

    function addSection(title, headers, rows) {
      csvRows.push([title]);
      if (headers && headers.length) csvRows.push(headers);
      if (rows && rows.length) {
        rows.forEach((row) => csvRows.push(row));
      } else {
        csvRows.push(['暂无数据']);
      }
      csvRows.push([]);
    }

    function csvSafeDivide(numerator, denominator, decimals) {
      const n = utils.toNumber(numerator);
      const d = utils.toNumber(denominator);
      if (d <= 0 || !Number.isFinite(n)) return '--';
      const result = n / d;
      return Number.isFinite(result) ? result.toFixed(decimals) : '--';
    }
    function csvPercent(numerator, denominator) {
      const n = utils.toNumber(numerator);
      const d = utils.toNumber(denominator);
      if (d <= 0 || !Number.isFinite(n)) return '--';
      const pct = (n / d) * 100;
      return Number.isFinite(pct) ? pct.toFixed(2) + '%' : '--';
    }
    function csvOptionalAmount(value) {
      return value == null ? '--' : value;
    }

    addSection('页面信息', ['字段', '内容'], [
      ['导出页面', '计划拆解'],
      ['日期范围', range.start && range.end ? `${range.start} ~ ${range.end}` : '当前暂无查询范围'],
      ['数据明细行数', days.length],
      ['活动数量', activities.length],
    ]);

    addSection('关键信息说明', ['字段', '内容'], [
      ['月份', stateModule.state.monthNote.month ? `${stateModule.state.monthNote.month}月` : ''],
      ['说明内容', stateModule.state.monthNote.content || '暂无说明内容'],
    ]);

    addSection('活动时间轴', [
      '日期范围',
      '活动名称',
      '平台节奏',
      '重要场次',
      '运营动作',
      '活动说明',
    ], activities.map((activity) => {
      const meta = utils.getActivityTypeMeta(activity.activity_type);
      const startLabel = utils.formatDateTimeLabel(activity.start_date, activity.start_time);
      const endLabel = utils.formatDateTimeLabel(activity.end_date, activity.end_time);
      return [
        startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`,
        activity.activity_name || '',
        meta.label,
        activity.key_sessions || '',
        activity.operations_action || '',
        activity.description || '',
      ];
    }));

    const double11Sections = typeof render.getDouble11ReferenceExportSections === 'function'
      ? render.getDouble11ReferenceExportSections()
      : [];
    double11Sections.forEach((section) => {
      addSection(section.title, section.headers, section.rows);
    });

    const rhythmSummary = typeof render.getRhythmSummaryExportData === 'function'
      ? render.getRhythmSummaryExportData()
      : { headers: [], rows: [] };
    addSection('节奏汇总', rhythmSummary.headers, rhythmSummary.rows);

    const totalPlan = utils.sum(days.map((day) => day.total_plan_amount));
    const totalActual = utils.sum(days.map((day) => utils.toNumber(day.actual_cost)));
    addSection('数据明细表-汇总', ['指标', '数值'], [
      ['计划合计', totalPlan],
      ['实际合计', totalActual],
      ['完成率', totalPlan > 0 ? utils.formatPercent(totalActual / totalPlan) : '--'],
    ]);

    const headers = [
      '日期',
      '万相台计划',
      '有客代投计划',
      '总计划金额',
      '活动节奏',
      '备注',
      '实际花费',
      '25年代投花费',
      '25年花费',
      '25年观看次数',
      '25年总成交笔数',
      '25年总购物车数',
      '25年预售成交笔数',
      '25年成交人数',
      '25年淘宝成交笔数',
      '25年订单成本',
      '25年预售订单成本',
      '25年加购成本',
      '25年广告成交占比',
      '25年保量佣金',
      '25年预估结算机构佣金',
      '25年品牌费',
    ];
    const rows = days.map((day) => {
      const totalPlan = utils.toNumber(day.wanxiang_plan) + utils.toNumber(day.agent_plan);
      const refAmount = day.reference_amount ?? day.reference_2025_amount ?? 0;
      return [
        day.date,
        day.wanxiang_plan,
        day.agent_plan,
        totalPlan,
        day.activity || '',
        day.remark || '',
        day.actual_cost,
        csvOptionalAmount(day.agent_amount),
        refAmount,
        day.reference_views ?? 0,
        day.reference_orders ?? 0,
        day.reference_cart ?? 0,
        day.reference_pre_orders ?? 0,
        day.reference_buyers ?? 0,
        day.reference_taobao_orders ?? 0,
        csvSafeDivide(refAmount, day.reference_orders, 2),
        csvSafeDivide(refAmount, day.reference_pre_orders, 2),
        csvSafeDivide(refAmount, day.reference_cart, 2),
        csvPercent(day.reference_orders, day.reference_taobao_orders),
        day.reference_financial_guarantee_commission ?? 0,
        day.reference_financial_estimated_agency_commission ?? 0,
        day.reference_financial_brand_fee ?? 0,
      ];
    });

    addSection('数据明细表', headers, rows);

    const bom = '\uFEFF';
    const csv = bom + csvRows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `计划拆解_${range.start}_${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function closeAllRemarkPopovers() {
    document.querySelectorAll('.remark-popover').forEach((popover) => popover.remove());
  }

  function openRemarkPopover(cell) {
    closeAllRemarkPopovers();
    const date = cell.getAttribute('data-date') || '';
    const hiddenInput = cell.querySelector('input[data-field="remark"]');
    const currentValue = hiddenInput ? hiddenInput.value : '';
    const popover = document.createElement('div');
    popover.className = 'remark-popover';
    popover.innerHTML = `<textarea class="remark-textarea" rows="5" placeholder="输入投放备注…">${utils.escapeHtml(currentValue)}</textarea><div class="remark-popover-footer"><span class="remark-char-count">${currentValue.length} 字</span><button type="button" class="button button-primary remark-popover-done">完成</button></div>`;
    document.body.appendChild(popover);
    const rect = cell.getBoundingClientRect();
    const popH = 180;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow >= popH) {
      popover.style.top = `${rect.bottom + 4}px`;
    } else {
      popover.style.top = `${Math.max(4, rect.top - popH - 4)}px`;
    }
    popover.style.left = `${Math.min(rect.left, window.innerWidth - 316)}px`;
    const textarea = popover.querySelector('.remark-textarea');
    const charCount = popover.querySelector('.remark-char-count');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    function syncValue() {
      const value = textarea.value;
      if (hiddenInput) hiddenInput.value = value;
      charCount.textContent = `${value.length} 字`;
      stateModule.patchDayDraft(date, { remark: value });
      const preview = cell.querySelector('.remark-preview');
      if (preview) {
        const truncated = value.length > 12 ? value.slice(0, 12) + '…' : value;
        preview.textContent = truncated || '点击编辑';
        preview.title = value;
      }
    }

    function closePopover() {
      syncValue();
      popover.remove();
      render.renderDraftUpdate(date);
    }

    textarea.addEventListener('input', syncValue);
    popover.querySelector('.remark-popover-done').addEventListener('click', (event) => {
      event.stopPropagation();
      closePopover();
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closePopover();
      }
    });
    setTimeout(() => {
      function outsideClick(event) {
        if (!popover.contains(event.target)) {
          closePopover();
          document.removeEventListener('mousedown', outsideClick);
        }
      }
      document.addEventListener('mousedown', outsideClick);
    }, 0);
  }

  function bind() {
    document.getElementById('save-all-btn')?.addEventListener('click', () => {
      saveAllDays();
    });

    document.getElementById('create-activity-btn')?.addEventListener('click', () => {
      stateModule.state.ui.isCreateModalOpen = true;
      render.renderCreateModal();
    });

    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
      exportCSV();
    });

    document.addEventListener('input', (event) => {
      const input = event.target.closest('.plan-input');
      if (!input) return;
      const date = input.getAttribute('data-date');
      const field = input.getAttribute('data-field');
      if (!date || !field) return;

      let value = input.value;
      if (field === 'wanxiang_plan' || field === 'agent_plan') {
        value = utils.toNumber(value);
      }
      stateModule.patchDayDraft(date, { [field]: value });
      render.renderDraftUpdate(date);
    });

    document.addEventListener('click', async (event) => {
      const target = event.target.closest('button, .remark-cell, .tl-cell[data-activity-id]');
      if (!target) return;

      if (target.classList.contains('remark-cell')) {
        event.stopPropagation();
        openRemarkPopover(target);
        return;
      }

      const timelineCell = target.closest('.tl-cell[data-activity-id]');
      if (timelineCell) {
        stateModule.state.ui.activeDrawerActivityId = timelineCell.getAttribute('data-activity-id') || '';
        render.renderDrawer();
        return;
      }

      if (target.id === 'double11-reference-toggle' || target.dataset.action === 'toggle-double11-reference') {
        stateModule.state.ui.double11ReferenceExpanded = !stateModule.state.ui.double11ReferenceExpanded;
        render.renderPage();
        return;
      }

      if (target.dataset.action === 'toggle-plan-section') {
        const section = target.dataset.section || '';
        const stateKeyBySection = {
          timeline: 'timelineExpanded',
          rhythmSummary: 'rhythmSummaryExpanded',
          monthNote: 'monthNoteExpanded',
        };
        const stateKey = stateKeyBySection[section];
        if (stateKey) {
          stateModule.state.ui[stateKey] = stateModule.state.ui[stateKey] === false;
          render.renderPage();
        }
        return;
      }

      if (target.id === 'drawer-close-btn') {
        stateModule.state.ui.activeDrawerActivityId = '';
        render.renderDrawer();
        return;
      }

      if (target.id === 'create-activity-cancel-btn') {
        stateModule.state.ui.isCreateModalOpen = false;
        render.renderCreateModal();
        return;
      }

      if (target.id === 'drawer-save-btn') {
        const id = target.getAttribute('data-activity-id') || '';
        stateModule.state.saving = true;
        render.renderStatus();
        try {
          await api.saveActivity({
            id,
            activity_name: document.getElementById('drawer-activity-name')?.value || '',
            activity_type: document.getElementById('drawer-activity-type')?.value || 'daily',
            start_date: document.getElementById('drawer-start-date')?.value || '',
            end_date: document.getElementById('drawer-end-date')?.value || '',
            start_time: document.getElementById('drawer-start-time')?.value || '',
            end_time: document.getElementById('drawer-end-time')?.value || '',
            key_sessions: document.getElementById('drawer-key-sessions')?.value || '',
            operations_action: document.getElementById('drawer-operations-action')?.value || '',
            description: document.getElementById('drawer-description')?.value || '',
          }, utils.buildCurrentUserLabel());
          stateModule.state.ui.activeDrawerActivityId = '';
          setMessage('活动已保存', false);
          await window.PlanDashboardPage.reloadSummary(false);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '保存活动失败', true);
        } finally {
          stateModule.state.saving = false;
          render.renderStatus();
        }
        return;
      }

      if (target.id === 'drawer-delete-btn') {
        const id = target.getAttribute('data-activity-id') || '';
        if (!id) return;
        stateModule.state.saving = true;
        render.renderStatus();
        try {
          await api.deleteActivity(id, utils.buildCurrentUserLabel());
          stateModule.state.ui.activeDrawerActivityId = '';
          setMessage('活动已删除', false);
          await window.PlanDashboardPage.reloadSummary(false);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '删除活动失败', true);
        } finally {
          stateModule.state.saving = false;
          render.renderStatus();
        }
        return;
      }

      if (target.id === 'month-note-edit-btn') {
        stateModule.state.monthNote.editing = true;
        render.renderMonthNote();
        return;
      }

      if (target.id === 'month-note-cancel-btn') {
        stateModule.state.monthNote.editing = false;
        render.renderMonthNote();
        return;
      }

      if (target.id === 'month-note-save-btn') {
        var ns = stateModule.state.monthNote;
        var noteTextarea = document.getElementById('month-note-textarea');
        var newContent = noteTextarea ? noteTextarea.value : '';
        ns.saving = true;
        render.renderMonthNote();
        try {
          await api.saveMonthNote(ns.year, ns.month, newContent);
          ns.content = newContent;
          ns.editing = false;
        } catch (err) {
          setMessage(err instanceof Error ? err.message : '保存说明失败', true);
        } finally {
          ns.saving = false;
          render.renderMonthNote();
        }
        return;
      }

      if (target.id === 'create-activity-save-btn') {
        stateModule.state.saving = true;
        render.renderStatus();
        try {
          await api.saveActivity({
            activity_name: document.getElementById('create-activity-name')?.value || '',
            activity_type: document.getElementById('create-activity-type')?.value || 'daily',
            start_date: document.getElementById('create-start-date')?.value || '',
            end_date: document.getElementById('create-end-date')?.value || '',
            start_time: document.getElementById('create-start-time')?.value || '',
            end_time: document.getElementById('create-end-time')?.value || '',
            key_sessions: document.getElementById('create-key-sessions')?.value || '',
            operations_action: document.getElementById('create-operations-action')?.value || '',
            description: document.getElementById('create-activity-description')?.value || '',
          }, utils.buildCurrentUserLabel());
          stateModule.state.ui.isCreateModalOpen = false;
          setMessage('活动已创建', false);
          await window.PlanDashboardPage.reloadSummary(false);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : '创建活动失败', true);
        } finally {
          stateModule.state.saving = false;
          render.renderCreateModal();
          render.renderStatus();
        }
        return;
      }
    });

    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (!hasDirtyDrafts()) return;
        event.preventDefault();
        saveAllDays();
      }
      if (event.key === 'Escape') {
        closeAllRemarkPopovers();
        if (stateModule.state.ui.activeDrawerActivityId) {
          stateModule.state.ui.activeDrawerActivityId = '';
          render.renderDrawer();
        }
        if (stateModule.state.ui.isCreateModalOpen) {
          stateModule.state.ui.isCreateModalOpen = false;
          render.renderCreateModal();
        }
      }
    });
  }

  window.PlanDashboardEvents = { bind, saveAllDays, exportCSV };
})(window);
