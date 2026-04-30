(function attachPlanDashboardRender(window) {
  const stateModule = window.PlanDashboardState;
  const shared = window.PlanDashboardRenderShared;
  const references = window.PlanDashboardRenderReferences;
  const rhythm = window.PlanDashboardRenderRhythm;
  const table = window.PlanDashboardRenderTable;

  function renderLoadingSkeleton() {
    references.renderTimelineSkeleton();
    references.renderDouble11Reference();
    references.renderSix18Reference();
    references.renderSix18Rhythm();
    rhythm.renderRhythmSummarySkeleton();
    table.renderMonthNoteSkeleton();
    table.renderTableSkeleton();
  }

  function renderPage() {
    if (stateModule.state.loading) {
      renderLoadingSkeleton();
      table.renderStatus();
      return;
    }
    references.renderTimeline();
    references.renderDouble11Reference();
    references.renderSix18Reference();
    references.renderSix18Rhythm();
    rhythm.renderRhythmSummary();
    table.renderMonthNote();
    table.renderTableFull();
    table.renderDrawer();
    table.renderCreateModal();
    table.renderStatus();
  }

  var debouncedRenderRhythmSummary = shared.debounce(function () {
    rhythm.renderRhythmSummary();
  }, 300);

  function renderDraftUpdate(date) {
    table.updateTableRowInPlace(date);
    table.updateSummaryBar();
    debouncedRenderRhythmSummary();
    table.renderStatus();
  }

  window.PlanDashboardRender = {
    renderPage,
    renderDraftUpdate,
    renderDrawer: table.renderDrawer,
    renderCreateModal: table.renderCreateModal,
    renderStatus: table.renderStatus,
    renderMonthNote: table.renderMonthNote,
    getEffectiveDays: shared.getEffectiveDays,
    getRhythmSummaryExportData: shared.getRhythmSummaryExportData,
    getDouble11ReferenceExportSections: references.getDouble11ReferenceExportSections,
    getSix18ReferenceExportSections: references.getSix18ReferenceExportSections,
  };
})(window);
