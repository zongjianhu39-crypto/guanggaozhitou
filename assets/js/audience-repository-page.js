(function attachAudienceRepositoryPage(window) {
  const api = window.AudienceRepositoryApi;
  const DEFAULT_DIMENSION = '月均消费金额';
  const METRICS_SHEET_NAME = '人群图片数据提取';
  const LABEL_SHEET_NAME = '人群标签数据';

  const state = {
    draft: { audience: null, metrics: [] },
    saved: { audiences: [], metrics: [] },
    loading: false,
    saving: false,
    searchTimer: null,
    editingAudienceId: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message, type) {
    const el = $('audience-status');
    if (!el) return;
    el.className = `audience-status${type ? ` audience-status-${type}` : ''}`;
    el.textContent = message || '';
  }

  function setBulkStatus(message, type) {
    const el = $('audience-bulk-status');
    if (!el) return;
    el.className = `audience-status${type ? ` audience-status-${type}` : ''}`;
    el.textContent = message || '';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return new Intl.NumberFormat('zh-CN').format(numeric);
  }

  function formatPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return `${(numeric * 100).toFixed(2)}%`;
  }

  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(numeric) ? numeric : null;
  }

  function parseShare(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).trim();
    if (!text) return null;
    const numeric = Number(text.replace('%', '').replace(/,/g, ''));
    if (!Number.isFinite(numeric)) return null;
    return text.includes('%') ? numeric / 100 : numeric;
  }

  function buildValidRangeText(validFrom, validTo) {
    if (validFrom && validTo) return `起：${validFrom}\n止：${validTo}`;
    if (validFrom) return `起：${validFrom}`;
    if (validTo) return `止：${validTo}`;
    return '';
  }

  function normalizeDateText(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 70000) {
      const date = new Date(Math.round((value - 25569) * 86400 * 1000));
      return date.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  function parseValidRange(row) {
    const rawRange = String(getRowValue(row, ['有效日期', '有效期', 'valid_range_text']) || '').trim();
    const explicitFrom = normalizeDateText(getRowValue(row, ['有效期开始', '有效开始', 'valid_from']));
    const explicitTo = normalizeDateText(getRowValue(row, ['有效期结束', '有效结束', 'valid_to']));
    const dateMatches = Array.from(rawRange.matchAll(/(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2})/g)).map((match) => normalizeDateText(match[1])).filter(Boolean);
    const fromMatch = rawRange.match(/起[：:\s]*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2})/);
    const toMatch = rawRange.match(/止[：:\s]*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2})/);
    const validFrom = explicitFrom || normalizeDateText(fromMatch?.[1]) || dateMatches[0] || null;
    const validTo = explicitTo || normalizeDateText(toMatch?.[1]) || dateMatches[1] || null;
    return {
      valid_from: validFrom,
      valid_to: validTo,
      valid_range_text: rawRange || buildValidRangeText(validFrom, validTo),
    };
  }

  function setInputValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value ?? '';
  }

  function updateFormTitle() {
    const title = $('audience-form-title');
    if (!title) return;
    title.textContent = state.editingAudienceId ? '编辑人群' : '新增人群';
  }

  function fillAudienceForm(audience) {
    setInputValue('audience-id', audience?.audience_id || '');
    setInputValue('audience-size', audience?.audience_size || '');
    setInputValue('audience-name', audience?.audience_name || '');
    setInputValue('audience-valid-from', audience?.valid_from || '');
    setInputValue('audience-valid-to', audience?.valid_to || '');
    setInputValue('audience-selection-logic', audience?.selection_logic || '');
    setInputValue('audience-definition', audience?.audience_definition || '');
  }

  function resetAudienceForm() {
    fillAudienceForm({});
    setInputValue('audience-metrics-file', '');
    state.draft = { audience: null, metrics: [] };
    state.editingAudienceId = null;
    updateFormTitle();
    renderDraftPreview();
    setStatus('已清空，可以录入新的人群。', 'success');
  }

  function collectAudienceForm() {
    const audienceId = parseNumber($('audience-id')?.value);
    const audienceName = String($('audience-name')?.value || '').trim();
    if (!audienceId) throw new Error('请填写达摩盘人群包 ID');
    if (!audienceName) throw new Error('请填写达摩盘人群名称');
    const validFrom = $('audience-valid-from')?.value || '';
    const validTo = $('audience-valid-to')?.value || '';
    return {
      audience_id: audienceId,
      audience_name: audienceName,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      valid_range_text: buildValidRangeText(validFrom, validTo),
      audience_size: parseNumber($('audience-size')?.value),
      selection_logic: String($('audience-selection-logic')?.value || '').trim(),
      audience_definition: String($('audience-definition')?.value || '').trim(),
      image_formula_map: {},
      metric_summary: {},
      raw_row: { input_source: 'web_manual_xlsx_upload' },
      source_filename: 'web_manual_xlsx_upload',
    };
  }

  function addMetric(metrics, seen, audienceId, item) {
    const dimension = String(item.dimension || '').trim();
    const category = String(item.category || '').trim();
    const share = parseShare(item.share);
    if (!dimension || !category || share === null) return;
    const key = `${audienceId}::${dimension}::${category}`;
    if (seen.has(key)) return;
    seen.add(key);
    metrics.push({
      audience_id: audienceId,
      dimension,
      category,
      share,
      share_text: item.share_text || formatPercent(share),
      source: item.source || 'ai_image_extract',
    });
  }

  function readWorkbookFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('维度表读取失败'));
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(file);
    });
  }

  function getRowValue(row, keys) {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return '';
  }

  function parseUploadShare(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return value > 1 ? value / 100 : value;
    }
    return parseShare(value);
  }

  function normalizeWorkbookMetric(row, fallbackAudienceId) {
    const rowAudienceId = parseNumber(getRowValue(row, ['达摩盘人群包ID', '达摩盘人群包 ID', '人群仓库ID', '人群包ID', 'audience_id', 'Audience ID']));
    const audienceId = rowAudienceId || fallbackAudienceId;
    const dimension = String(getRowValue(row, ['维度', 'dimension']) || '').trim();
    const category = String(getRowValue(row, ['分类', '类别', '等级', 'category']) || '').trim();
    const share = parseUploadShare(getRowValue(row, ['分析人群占比', '占比', 'share', 'percentage', 'percent']));
    if (!audienceId || !dimension || !category || share === null) return null;
    return {
      audience_id: audienceId,
      dimension,
      category,
      share,
      share_text: formatPercent(share),
      source: 'xlsx_upload',
    };
  }

  function buildAudienceFromLabelRow(row, audienceId, existing, fileName) {
    const validRange = parseValidRange(row);
    const audienceName = String(getRowValue(row, ['达摩盘人群名称', '人群名称', 'audience_name']) || existing?.audience_name || '').trim();
    return {
      audience_id: audienceId,
      audience_name: audienceName,
      valid_from: validRange.valid_from || existing?.valid_from || null,
      valid_to: validRange.valid_to || existing?.valid_to || null,
      valid_range_text: validRange.valid_range_text || existing?.valid_range_text || '',
      audience_size: parseNumber(getRowValue(row, ['人群规模', '覆盖规模', 'audience_size'])) ?? existing?.audience_size ?? null,
      selection_logic: String(getRowValue(row, ['圈选逻辑', 'selection_logic']) || existing?.selection_logic || '').trim(),
      audience_definition: String(getRowValue(row, ['人群定义', 'audience_definition']) || existing?.audience_definition || '').trim(),
      image_formula_map: existing?.image_formula_map || {},
      metric_summary: existing?.metric_summary || {},
      raw_row: existing?.raw_row || Object.assign({ input_source: 'label_extract_workbook' }, row),
      source_filename: fileName,
    };
  }

  function parseLabelExtractionWorkbook(workbook, fileName) {
    const sheetName = workbook.SheetNames.includes(LABEL_SHEET_NAME) ? LABEL_SHEET_NAME : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    const audiencesById = new Map();
    const metrics = [];
    const seenMetrics = new Set();
    let currentAudienceId = null;
    let skippedRows = 0;

    rows.forEach((row) => {
      const rowAudienceId = parseNumber(getRowValue(row, ['达摩盘人群包ID', '达摩盘人群包 ID', '人群仓库ID', '人群包ID', 'audience_id', 'Audience ID']));
      if (rowAudienceId) currentAudienceId = rowAudienceId;
      const audienceId = rowAudienceId || currentAudienceId;
      if (!audienceId) {
        skippedRows += 1;
        return;
      }

      const existingAudience = audiencesById.get(audienceId);
      const audience = buildAudienceFromLabelRow(row, audienceId, existingAudience, fileName);
      audiencesById.set(audienceId, audience);

      const metric = normalizeWorkbookMetric(row, audienceId);
      if (!metric) return;
      metric.source = 'xlsx_label_extract';
      const key = `${metric.audience_id}::${metric.dimension}::${metric.category}`;
      if (seenMetrics.has(key)) return;
      seenMetrics.add(key);
      metrics.push(metric);
    });

    const audiences = Array.from(audiencesById.values())
      .filter((audience) => audience.audience_id && audience.audience_name)
      .map((audience) => {
        const itemMetrics = metrics.filter((metric) => Number(metric.audience_id) === Number(audience.audience_id));
        return Object.assign({}, audience, {
          metric_summary: buildMetricSummary(itemMetrics),
        });
      });

    return {
      audiences,
      metrics: metrics.filter((metric) => audiences.some((audience) => Number(audience.audience_id) === Number(metric.audience_id))),
      skippedRows,
      sheetName,
    };
  }

  function parseLongMetricsSheet(workbook, audienceId) {
    const sheetName = workbook.SheetNames.includes(METRICS_SHEET_NAME) ? METRICS_SHEET_NAME : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const metrics = [];
    const skippedAudienceIds = new Set();
    rows.forEach((row) => {
      const metric = normalizeWorkbookMetric(row, audienceId);
      if (!metric) return;
      if (Number(metric.audience_id) !== Number(audienceId)) {
        skippedAudienceIds.add(metric.audience_id);
        return;
      }
      metrics.push(metric);
    });
    return { metrics, skippedAudienceIds };
  }

  function parseWideMetricsSheet(workbook, audienceId) {
    const sheet = workbook.Sheets['宽表格式'] || workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const metrics = [];
    const skippedAudienceIds = new Set();
    rows.forEach((row) => {
      const rowAudienceId = parseNumber(getRowValue(row, ['人群仓库ID', '人群包ID', 'audience_id', 'Audience ID'])) || audienceId;
      if (Number(rowAudienceId) !== Number(audienceId)) {
        skippedAudienceIds.add(rowAudienceId);
        return;
      }
      Object.entries(row).forEach(([key, value]) => {
        if (!key || key === '人群仓库ID' || key === '人群包ID' || key === 'audience_id' || !key.includes('_')) return;
        const splitIndex = key.indexOf('_');
        const dimension = key.slice(0, splitIndex).trim();
        const category = key.slice(splitIndex + 1).trim();
        const share = parseUploadShare(value);
        if (!dimension || !category || share === null) return;
        metrics.push({
          audience_id: audienceId,
          dimension,
          category,
          share,
          share_text: formatPercent(share),
          source: 'xlsx_upload',
        });
      });
    });
    return { metrics, skippedAudienceIds };
  }

  function dedupeMetrics(metrics, audienceId) {
    const deduped = [];
    const seen = new Set();
    metrics.forEach((metric) => addMetric(deduped, seen, audienceId, metric));
    return deduped;
  }

  function buildMetricSummary(metrics) {
    return metrics.reduce((summary, metric) => {
      if (!metric.dimension || !metric.category || metric.share === null || metric.share === undefined) return summary;
      summary[`${metric.dimension}_${metric.category}`] = metric.share;
      return summary;
    }, {});
  }

  function getMetricsForAudience(audienceId) {
    const id = Number(audienceId);
    return state.saved.metrics
      .filter((metric) => Number(metric.audience_id) === id)
      .map((metric) => ({
        audience_id: id,
        dimension: metric.dimension || '',
        category: metric.category || '',
        share: parseShare(metric.share),
        share_text: metric.share_text || formatPercent(metric.share),
        source: metric.source || 'manual_edit',
      }))
      .filter((metric) => metric.dimension && metric.category && metric.share !== null);
  }

  function renderDraftPreview() {
    const container = $('audience-preview');
    if (!container) return;
    const audience = state.draft.audience;
    const metrics = state.draft.metrics;
    if (!audience) {
      container.innerHTML = '<div class="audience-empty">填写新的人群信息，或点击右侧仓库卡片的“编辑”，再上传维度占比表，这里会显示待保存的数据。</div>';
      return;
    }

    container.innerHTML = `
      <div class="audience-preview-head">
        <div>
          <div class="audience-id">${escapeHtml(audience.audience_id)}</div>
          <h3>${escapeHtml(audience.audience_name)}</h3>
        </div>
        <div class="audience-preview-actions">
          <span>${formatNumber(metrics.length)} 条维度占比</span>
          <button type="button" class="audience-button audience-button-compact" data-action="add-metric">新增维度</button>
        </div>
      </div>
      ${metrics.length ? `
        <div class="audience-table-wrap">
          <table class="audience-table">
            <thead>
              <tr>
                <th>维度</th>
                <th>分类</th>
                <th>分析人群占比(%)</th>
                <th>来源</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${metrics.map((metric, index) => `
                <tr>
                  <td><input class="audience-table-input" data-metric-index="${index}" data-metric-field="dimension" value="${escapeHtml(metric.dimension)}"></td>
                  <td><input class="audience-table-input" data-metric-index="${index}" data-metric-field="category" value="${escapeHtml(metric.category)}"></td>
                  <td><input class="audience-table-input" type="number" step="0.01" min="0" max="100" data-metric-index="${index}" data-metric-field="share" value="${escapeHtml((Number(metric.share) * 100).toFixed(2))}"></td>
                  <td>${escapeHtml(metric.source)}</td>
                  <td><button type="button" class="audience-link-button" data-action="remove-metric" data-metric-index="${index}">删除</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="audience-empty">还没有维度占比，可以上传“人群仓库_图片数据提取.xlsx”，也可以点击“新增维度”手动补充。</div>'}
    `;
  }

  function renderSavedRepository() {
    const audiences = state.saved.audiences;
    const metrics = state.saved.metrics;
    const metricsByAudience = new Map();
    metrics.forEach((metric) => {
      const id = Number(metric.audience_id);
      if (!metricsByAudience.has(id)) metricsByAudience.set(id, []);
      metricsByAudience.get(id).push(metric);
    });

    const stats = $('audience-stats');
    if (stats) {
      const totalSize = audiences.reduce((sum, item) => sum + (Number(item.audience_size) || 0), 0);
      const dimensions = new Set(metrics.map((item) => item.dimension));
      stats.innerHTML = `
        <div><strong>${formatNumber(audiences.length)}</strong><span>人群包</span></div>
        <div><strong>${formatNumber(totalSize)}</strong><span>覆盖规模</span></div>
        <div><strong>${formatNumber(metrics.length)}</strong><span>维度占比</span></div>
        <div><strong>${formatNumber(dimensions.size)}</strong><span>分析维度</span></div>
      `;
    }

    const container = $('audience-list');
    if (!container) return;
    if (state.loading) {
      container.innerHTML = '<div class="audience-empty">正在加载人群仓库...</div>';
      return;
    }
    if (!audiences.length) {
      container.innerHTML = '<div class="audience-empty">Supabase 里还没有人群仓库数据。</div>';
      return;
    }

    container.innerHTML = audiences.map((item) => {
      const itemMetrics = metricsByAudience.get(Number(item.audience_id)) || [];
      const topMetrics = itemMetrics.slice(0, 8);
      return `
        <article class="audience-row">
          <div class="audience-row-main">
            <div>
              <div class="audience-id">${escapeHtml(item.audience_id)}</div>
              <h3>${escapeHtml(item.audience_name)}</h3>
              <p>${escapeHtml(item.audience_definition || item.selection_logic || '-')}</p>
            </div>
            <div class="audience-row-meta">
              <span>${formatNumber(item.audience_size)} 人</span>
              <span>${escapeHtml(item.valid_from || '-')}${item.valid_to ? ` 至 ${escapeHtml(item.valid_to)}` : ''}</span>
              <button type="button" class="audience-link-button" data-action="edit-audience" data-audience-id="${escapeHtml(item.audience_id)}">编辑</button>
            </div>
          </div>
          <div class="audience-tags">
            ${topMetrics.map((metric) => `<span>${escapeHtml(metric.dimension)} / ${escapeHtml(metric.category)} ${formatPercent(metric.share)}</span>`).join('')}
            ${itemMetrics.length > topMetrics.length ? `<span>+${itemMetrics.length - topMetrics.length}</span>` : ''}
          </div>
        </article>
      `;
    }).join('');
  }

  async function handleMetricsImport() {
    try {
      const audience = collectAudienceForm();
      const file = $('audience-metrics-file')?.files?.[0] || null;
      if (!file) {
        setStatus('请先上传“人群仓库_图片数据提取.xlsx”。', 'error');
        return;
      }
      if (!/\.xlsx?$/i.test(file.name)) {
        setStatus('请上传 xlsx/xls 格式的数据表。', 'error');
        return;
      }
      if (!window.XLSX) {
        setStatus('Excel 解析库还没有加载完成，请刷新页面后重试。', 'error');
        return;
      }

      setStatus(`正在读取维度表：${file.name}`, 'warn');
      const buffer = await readWorkbookFile(file);
      const workbook = window.XLSX.read(buffer, { type: 'array' });
      let { metrics, skippedAudienceIds } = parseLongMetricsSheet(workbook, audience.audience_id);
      if (!metrics.length) {
        ({ metrics, skippedAudienceIds } = parseWideMetricsSheet(workbook, audience.audience_id));
      }
      metrics = dedupeMetrics(metrics, audience.audience_id);
      if (!metrics.length) {
        const skipped = skippedAudienceIds.size ? `；表内其他人群ID：${Array.from(skippedAudienceIds).join('、')}` : '';
        setStatus(`没有读取到当前人群 ${audience.audience_id} 的维度占比数据${skipped}。`, 'error');
        return;
      }

      audience.image_formula_map = state.draft.audience?.image_formula_map || {};
      audience.raw_row = state.draft.audience?.raw_row || audience.raw_row;
      audience.source_filename = file.name;
      audience.metric_summary = buildMetricSummary(metrics);
      state.draft = { audience, metrics };
      state.editingAudienceId = audience.audience_id;
      updateFormTitle();
      renderDraftPreview();
      const skipped = skippedAudienceIds.size ? `；已忽略其他人群ID：${Array.from(skippedAudienceIds).join('、')}` : '';
      setStatus(`已导入 ${metrics.length} 条维度占比${skipped}。`, skippedAudienceIds.size ? 'warn' : 'success');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '维度表导入失败', 'error');
    }
  }

  async function handleLabelWorkbookImport() {
    try {
      const file = $('audience-label-file')?.files?.[0] || null;
      if (!file) {
        setBulkStatus('请先选择“人群仓库_标签提取.xlsx”。', 'error');
        return;
      }
      if (!/\.xlsx?$/i.test(file.name)) {
        setBulkStatus('请上传 xlsx/xls 格式的数据表。', 'error');
        return;
      }
      if (!window.XLSX) {
        setBulkStatus('Excel 解析库还没有加载完成，请刷新页面后重试。', 'error');
        return;
      }

      state.saving = true;
      setBulkStatus(`正在读取标签提取表：${file.name}`, 'warn');
      const buffer = await readWorkbookFile(file);
      const workbook = window.XLSX.read(buffer, { type: 'array' });
      const { audiences, metrics, skippedRows, sheetName } = parseLabelExtractionWorkbook(workbook, file.name);
      if (!audiences.length) {
        setBulkStatus(`没有读取到合法人群。请确认 ${sheetName || '表格'} 里包含“达摩盘人群包ID”和“达摩盘人群名称”。`, 'error');
        return;
      }

      setBulkStatus(`已识别 ${audiences.length} 个人群、${metrics.length} 条标签占比，正在覆盖写入 Supabase...`, 'warn');
      const result = await api.importAudiences({ audiences, metrics });
      const skipped = skippedRows ? `；跳过 ${skippedRows} 行缺少人群 ID 的数据` : '';
      setBulkStatus(`导入完成：已覆盖/新增 ${result.audience_count || 0} 个人群，写入 ${result.metric_count || 0} 条标签占比${skipped}。`, 'success');
      await loadRepository();
    } catch (error) {
      setBulkStatus(error instanceof Error ? error.message : '标签提取表导入失败', 'error');
    } finally {
      state.saving = false;
    }
  }

  async function handleSave() {
    try {
      const audience = collectAudienceForm();
      const metrics = state.draft.audience && Number(state.draft.audience.audience_id) === Number(audience.audience_id)
        ? state.draft.metrics
        : [];
      audience.image_formula_map = state.draft.audience?.image_formula_map || audience.image_formula_map;
      audience.raw_row = state.draft.audience?.raw_row || audience.raw_row;
      audience.source_filename = state.draft.audience?.source_filename || audience.source_filename;
      audience.metric_summary = buildMetricSummary(metrics);
      state.draft = { audience, metrics };
      state.saving = true;
      setStatus('正在写入 Supabase...', 'warn');
      const result = await api.importAudiences({
        audiences: [audience],
        metrics,
      });
      setStatus(`入库完成：${result.audience_count || 0} 条人群，${result.metric_count || 0} 条维度数据。`, 'success');
      state.editingAudienceId = audience.audience_id;
      updateFormTitle();
      renderDraftPreview();
      await loadRepository();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '入库失败', 'error');
    } finally {
      state.saving = false;
    }
  }

  async function loadRepository() {
    try {
      state.loading = true;
      renderSavedRepository();
      const q = $('audience-search')?.value || '';
      const result = await api.fetchList({ q, limit: 200 });
      state.saved = {
        audiences: result.audiences || [],
        metrics: result.metrics || [],
      };
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '加载人群仓库失败', 'error');
    } finally {
      state.loading = false;
      renderSavedRepository();
    }
  }

  function handleEditAudience(audienceId) {
    const id = Number(audienceId);
    const audience = state.saved.audiences.find((item) => Number(item.audience_id) === id);
    if (!audience) {
      setStatus('没有找到这条人群数据，请刷新后再试。', 'error');
      return;
    }
    const draftAudience = {
      audience_id: Number(audience.audience_id),
      audience_name: audience.audience_name || '',
      valid_from: audience.valid_from || null,
      valid_to: audience.valid_to || null,
      valid_range_text: audience.valid_range_text || buildValidRangeText(audience.valid_from, audience.valid_to),
      audience_size: parseNumber(audience.audience_size),
      selection_logic: audience.selection_logic || '',
      audience_definition: audience.audience_definition || '',
      image_formula_map: audience.image_formula_map || {},
      metric_summary: audience.metric_summary || {},
      raw_row: audience.raw_row || { input_source: 'web_manual_edit' },
      source_filename: audience.source_filename || 'web_manual_edit',
    };
    state.draft = { audience: draftAudience, metrics: getMetricsForAudience(id) };
    state.editingAudienceId = id;
    fillAudienceForm(draftAudience);
    updateFormTitle();
    renderDraftPreview();
    setStatus(`已载入 ${id}，可以修改基础信息或维度明细后重新写入 Supabase。`, 'success');
    $('audience-form-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleAddMetric() {
    let audience;
    try {
      audience = collectAudienceForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '请先填写人群基础信息', 'error');
      return;
    }
    const metrics = state.draft.audience && Number(state.draft.audience.audience_id) === Number(audience.audience_id)
      ? state.draft.metrics
      : [];
    metrics.push({
      audience_id: audience.audience_id,
      dimension: DEFAULT_DIMENSION,
      category: '',
      share: 0,
      share_text: '0.00%',
      source: 'manual_edit',
    });
    audience.metric_summary = buildMetricSummary(metrics);
    state.draft = { audience, metrics };
    state.editingAudienceId = audience.audience_id;
    updateFormTitle();
    renderDraftPreview();
    setStatus('已新增一行维度明细，填写后可以直接入库。', 'success');
  }

  function handleRemoveMetric(index) {
    if (!state.draft.audience) return;
    state.draft.metrics.splice(index, 1);
    state.draft.audience.metric_summary = buildMetricSummary(state.draft.metrics);
    renderDraftPreview();
    setStatus('已删除该维度明细，保存后会同步覆盖 Supabase。', 'success');
  }

  function handleMetricInput(target) {
    const index = Number(target.dataset.metricIndex);
    const field = target.dataset.metricField;
    const metric = state.draft.metrics[index];
    if (!metric || !field) return;
    if (field === 'share') {
      const numeric = parseShare(`${target.value}%`);
      metric.share = numeric === null ? 0 : numeric;
      metric.share_text = formatPercent(metric.share);
      return;
    }
    metric[field] = target.value;
  }

  function bind() {
    $('import-label-workbook-btn')?.addEventListener('click', handleLabelWorkbookImport);
    $('import-metrics-btn')?.addEventListener('click', handleMetricsImport);
    $('save-audience-btn')?.addEventListener('click', handleSave);
    $('reset-audience-btn')?.addEventListener('click', resetAudienceForm);
    $('refresh-audience-btn')?.addEventListener('click', loadRepository);
    $('audience-search')?.addEventListener('input', () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(loadRepository, 300);
    });
    $('audience-list')?.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-action="edit-audience"]') : null;
      if (!target) return;
      handleEditAudience(target.dataset.audienceId);
    });
    $('audience-preview')?.addEventListener('click', (event) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      const addTarget = eventTarget?.closest('[data-action="add-metric"]');
      if (addTarget) {
        handleAddMetric();
        return;
      }
      const removeTarget = eventTarget?.closest('[data-action="remove-metric"]');
      if (removeTarget) handleRemoveMetric(Number(removeTarget.dataset.metricIndex));
    });
    $('audience-preview')?.addEventListener('input', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-metric-field]') : null;
      if (target) handleMetricInput(target);
    });
  }

  function init() {
    renderDraftPreview();
    renderSavedRepository();
    bind();
    loadRepository();
  }

  window.addEventListener('DOMContentLoaded', init);
})(window);
