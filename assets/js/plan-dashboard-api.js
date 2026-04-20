(function attachPlanDashboardApi(window) {
  const authHelpers = window.authHelpers || {};

  function getFunctionName() {
    return 'plan-dashboard-summary';
  }

  async function request(method, body, query) {
    if (typeof authHelpers.fetchFunctionJson !== 'function') {
      throw new Error('缺少 authHelpers.fetchFunctionJson');
    }
    const { data } = await authHelpers.fetchFunctionJson(getFunctionName(), {
      method,
      body,
      query,
      includePromptAdminToken: true,
      useSessionToken: true,
      unauthorizedMessage: '登录状态已失效，请重新登录后再试。',
      onUnauthorized: () => {
        if (typeof authHelpers.handleReauthRequired === 'function') {
          authHelpers.handleReauthRequired({
            source: 'plan_dashboard',
            targetUrl: window.location.href,
            reason: 'plan_dashboard_reauth_required',
            message: '登录状态已失效，正在跳转重新登录…',
          });
        }
      },
    });
    return data;
  }

  async function fetchSummary(start, end) {
    return request('GET', undefined, { start, end });
  }

  async function savePlan(date, patch, updatedBy) {
    return request('POST', { action: 'save_plan', date, patch, updated_by: updatedBy });
  }

  async function savePlans(items, updatedBy) {
    return request('POST', { action: 'save_plans', items, updated_by: updatedBy });
  }

  async function saveActivity(payload, updatedBy) {
    return request('POST', { action: 'save_activity', payload, updated_by: updatedBy });
  }

  async function deleteActivity(id, updatedBy) {
    return request('POST', { action: 'delete_activity', id, updated_by: updatedBy });
  }

  async function fetchMonthNote(year, month) {
    return request('POST', { action: 'fetch_month_note', year: year, month: month, note_type: 'rhythm_summary_note' });
  }

  async function saveMonthNote(year, month, content) {
    return request('POST', { action: 'save_month_note', year: year, month: month, note_type: 'rhythm_summary_note', content: content });
  }

  window.PlanDashboardApi = {
    fetchSummary,
    savePlan,
    savePlans,
    saveActivity,
    deleteActivity,
    fetchMonthNote,
    saveMonthNote,
  };
})(window);
