(function attachPlanDashboardRenderTable(window) {
  const shared = window.PlanDashboardRenderShared;
  const {
    utils,
    stateModule,
    syncCollapsibleSection,
    getEffectiveDays,
    getEffectiveDay,
    buildEditableCell,
    buildActivityCell,
    sDiv,
    fmtC,
    fmtP,
    fmtF,
    fmtRef,
    fmtRefN,
  } = shared;

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
    el.innerHTML = `
      <div class="table-shell">
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

  window.PlanDashboardRenderTable = {
    renderMonthNote,
    renderMonthNoteSkeleton,
    renderTableFull,
    renderTableSkeleton,
    renderDrawer,
    renderCreateModal,
    renderStatus,
    updateTableRowInPlace,
    updateSummaryBar,
  };
})(window);
