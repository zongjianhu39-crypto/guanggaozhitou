(function attachPlanDashboardState(window) {
  const state = {
    range: { start: '', end: '' },
    loading: false,
    saving: false,
    error: '',
    saveMessage: '',
    summary: {
      range: null,
      kpis: {},
      days: [],
      activities: [],
    },
    drafts: {
      dayPatches: {},
    },
    monthNote: {
      content: '',
      loading: false,
      editing: false,
      saving: false,
      year: null,
      month: null,
    },
    ui: {
      activeDrawerActivityId: '',
      isCreateModalOpen: false,
      selectedMonths: [],
      monthSelectionAnchor: null,
      double11ReferenceExpanded: false,
      timelineExpanded: true,
      rhythmSummaryExpanded: true,
      monthNoteExpanded: true,
    },
  };

  function patchDayDraft(date, patch) {
    const current = state.drafts.dayPatches[date] || {};
    state.drafts.dayPatches[date] = Object.assign({}, current, patch);
  }

  function clearDayDraft(date) {
    delete state.drafts.dayPatches[date];
  }

  function clearAllDrafts() {
    state.drafts.dayPatches = {};
  }

  function getActivityById(id) {
    return (state.summary.activities || []).find((item) => String(item.id) === String(id)) || null;
  }

  window.PlanDashboardState = {
    state,
    patchDayDraft,
    clearDayDraft,
    clearAllDrafts,
    getActivityById,
  };
})(window);
