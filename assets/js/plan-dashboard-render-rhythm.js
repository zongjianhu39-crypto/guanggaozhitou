(function attachPlanDashboardRenderRhythm(window) {
  const shared = window.PlanDashboardRenderShared;
  const {
    utils,
    syncCollapsibleSection,
    getEffectiveDays,
    buildRhythmSegments,
    summarizeRhythmDays,
    buildRhythmRow,
    buildRhythmTotalRow,
  } = shared;

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

  window.PlanDashboardRenderRhythm = {
    renderRhythmSummary,
    renderRhythmSummarySkeleton,
  };
})(window);
