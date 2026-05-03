(function attachAudienceRepositoryPage(window) {
  const api = window.AudienceRepositoryApi;
  const DIMENSIONS = [
    '月均消费金额',
    '预测购买力',
    '88会员等级',
    '月均购物频次偏好',
    '月均直播观看场次',
    '月均直播全量观看时长',
    '月均品牌自播间观看时长',
  ];

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
    document.querySelectorAll('#audience-image-grid input[type="file"]').forEach((input) => {
      input.value = '';
    });
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
      raw_row: { input_source: 'web_manual_image_upload' },
      source_filename: 'web_manual_image_upload',
    };
  }

  function estimateDataUrlBytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  }

  function renderImageToDataUrl(img, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  function resizeImageFile(file) {
    const targetBytes = 850 * 1024;
    const attempts = [
      { maxSide: 1200, quality: 0.78 },
      { maxSide: 1000, quality: 0.72 },
      { maxSide: 850, quality: 0.68 },
      { maxSide: 720, quality: 0.64 },
      { maxSide: 640, quality: 0.6 },
    ];
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片预览加载失败'));
        img.onload = () => {
          let selected = '';
          for (const attempt of attempts) {
            selected = renderImageToDataUrl(img, attempt.maxSide, attempt.quality);
            if (estimateDataUrlBytes(selected) <= targetBytes) break;
          }
          resolve(selected);
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  async function collectImageUploads() {
    const uploads = [];
    for (const dimension of DIMENSIONS) {
      const input = document.querySelector(`input[data-dimension="${dimension}"]`);
      const file = input?.files?.[0] || null;
      if (!file) continue;
      if (!/^image\//.test(file.type)) throw new Error(`${dimension} 上传的不是图片文件`);
      setStatus(`正在压缩图片：${dimension}`, 'warn');
      const dataUrl = await resizeImageFile(file);
      uploads.push({
        dimension,
        file_name: file.name,
        mime_type: 'image/jpeg',
        data_url: dataUrl,
        compressed_kb: Math.round(estimateDataUrlBytes(dataUrl) / 1024),
      });
    }
    return uploads;
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

  function normalizeParsedMetrics(audienceId, parsedItems) {
    const metrics = [];
    const seen = new Set();
    (parsedItems || []).forEach((item) => addMetric(metrics, seen, audienceId, item));
    return metrics;
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

  function renderImageUploadGrid() {
    const container = $('audience-image-grid');
    if (!container) return;
    container.innerHTML = DIMENSIONS.map((dimension) => `
      <label class="audience-image-card">
        <span>${escapeHtml(dimension)}</span>
        <input type="file" accept="image/*" data-dimension="${escapeHtml(dimension)}">
        <small>上传该维度截图</small>
      </label>
    `).join('');
  }

  function renderDraftPreview() {
    const container = $('audience-preview');
    if (!container) return;
    const audience = state.draft.audience;
    const metrics = state.draft.metrics;
    if (!audience) {
      container.innerHTML = '<div class="audience-empty">填写新的人群信息，或点击右侧仓库卡片的“编辑”，这里会显示待保存的数据。</div>';
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
      ` : '<div class="audience-empty">还没有维度占比，可以上传图片 AI 解析，也可以点击“新增维度”手动补充。</div>'}
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

  async function handleAiParse() {
    try {
      const audience = collectAudienceForm();
      const images = await collectImageUploads();
      if (!images.length) {
        setStatus('请至少上传一张维度截图。', 'error');
        return;
      }
      const parsedItems = [];
      const failedImages = [];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        setStatus(`AI 正在解析图片 ${index + 1}/${images.length}：${image.dimension}（约 ${image.compressed_kb || '-'}KB）`, 'warn');
        try {
          const result = await api.parseImages({ audience_id: audience.audience_id, images: [image] });
          parsedItems.push(...(result.metrics || []));
          (result.parse_errors || []).forEach((item) => {
            const detail = item.message ? `${item.dimension || image.dimension}（${item.message}）` : (item.dimension || image.dimension);
            failedImages.push(detail);
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : '请求失败';
          failedImages.push(`${image.dimension}（${message}）`);
        }
      }
      const metrics = normalizeParsedMetrics(audience.audience_id, parsedItems);
      audience.image_formula_map = images.reduce((acc, image) => {
        acc[image.dimension] = { image_file: image.file_name, source: 'web_upload' };
        return acc;
      }, {});
      audience.metric_summary = buildMetricSummary(metrics);
      state.draft = { audience, metrics };
      state.editingAudienceId = audience.audience_id;
      updateFormTitle();
      renderDraftPreview();
      const failedText = failedImages.length ? `；未解析成功：${Array.from(new Set(failedImages)).join('、')}` : '';
      setStatus(`已解析 ${metrics.length} 条维度占比${failedText}。`, metrics.length ? (failedImages.length ? 'warn' : 'success') : 'error');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'AI 解析失败', 'error');
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
      dimension: DIMENSIONS[0],
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
    $('parse-audience-btn')?.addEventListener('click', handleAiParse);
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
    renderImageUploadGrid();
    renderDraftPreview();
    renderSavedRepository();
    bind();
    loadRepository();
  }

  window.addEventListener('DOMContentLoaded', init);
})(window);
