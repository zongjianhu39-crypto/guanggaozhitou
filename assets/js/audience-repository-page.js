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

  function resizeImageFile(file, options = {}) {
    const maxSide = options.maxSide || 1600;
    const quality = options.quality || 0.88;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片预览加载失败'));
        img.onload = () => {
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
          resolve(canvas.toDataURL('image/jpeg', quality));
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
      uploads.push({
        dimension,
        file_name: file.name,
        mime_type: 'image/jpeg',
        data_url: await resizeImageFile(file),
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
      summary[`${metric.dimension}_${metric.category}`] = metric.share;
      return summary;
    }, {});
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
      container.innerHTML = '<div class="audience-empty">填写人群信息并上传图片后，点击“AI 解析图片”生成待入库预览。</div>';
      return;
    }

    container.innerHTML = `
      <div class="audience-preview-head">
        <div>
          <div class="audience-id">${escapeHtml(audience.audience_id)}</div>
          <h3>${escapeHtml(audience.audience_name)}</h3>
        </div>
        <span>${formatNumber(metrics.length)} 条维度占比</span>
      </div>
      ${metrics.length ? `
        <div class="audience-table-wrap">
          <table class="audience-table">
            <thead>
              <tr>
                <th>维度</th>
                <th>分类</th>
                <th>分析人群占比</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              ${metrics.map((metric) => `
                <tr>
                  <td>${escapeHtml(metric.dimension)}</td>
                  <td>${escapeHtml(metric.category)}</td>
                  <td>${formatPercent(metric.share)}</td>
                  <td>${escapeHtml(metric.source)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="audience-empty">还没有解析到维度占比，请检查图片是否包含分类和百分比。</div>'}
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
        setStatus(`AI 正在解析图片 ${index + 1}/${images.length}：${image.dimension}`, 'warn');
        try {
          const result = await api.parseImages({ audience_id: audience.audience_id, images: [image] });
          parsedItems.push(...(result.metrics || []));
          (result.parse_errors || []).forEach((item) => failedImages.push(item.dimension || image.dimension));
        } catch (error) {
          failedImages.push(image.dimension);
        }
      }
      const metrics = normalizeParsedMetrics(audience.audience_id, parsedItems);
      audience.image_formula_map = images.reduce((acc, image) => {
        acc[image.dimension] = { image_file: image.file_name, source: 'web_upload' };
        return acc;
      }, {});
      audience.metric_summary = buildMetricSummary(metrics);
      state.draft = { audience, metrics };
      renderDraftPreview();
      const failedText = failedImages.length ? `；未解析成功：${Array.from(new Set(failedImages)).join('、')}` : '';
      setStatus(`已解析 ${metrics.length} 条维度占比${failedText}。`, metrics.length ? (failedImages.length ? 'warn' : 'success') : 'error');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'AI 解析失败', 'error');
    }
  }

  async function handleSave() {
    if (!state.draft.audience) {
      setStatus('没有可入库的数据，请先解析图片。', 'error');
      return;
    }
    try {
      state.saving = true;
      setStatus('正在写入 Supabase...', 'warn');
      const result = await api.importAudiences({
        audiences: [state.draft.audience],
        metrics: state.draft.metrics,
      });
      setStatus(`入库完成：${result.audience_count || 0} 条人群，${result.metric_count || 0} 条维度数据。`, 'success');
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

  function bind() {
    $('parse-audience-btn')?.addEventListener('click', handleAiParse);
    $('save-audience-btn')?.addEventListener('click', handleSave);
    $('refresh-audience-btn')?.addEventListener('click', loadRepository);
    $('audience-search')?.addEventListener('input', () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(loadRepository, 300);
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
