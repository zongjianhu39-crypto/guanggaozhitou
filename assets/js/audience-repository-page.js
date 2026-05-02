(function attachAudienceRepositoryPage(window) {
  const api = window.AudienceRepositoryApi;
  const FIELD_COLUMNS = [
    '月均消费金额',
    '预测购买力',
    '88会员等级',
    '月均购物频次偏好',
    '月均直播观看场次',
    '月均直播全量观看时长',
    '月均品牌自播间观看时长',
  ];

  const state = {
    parsed: { audiences: [], metrics: [] },
    saved: { audiences: [], metrics: [] },
    loading: false,
    saving: false,
    error: '',
    message: '',
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

  function normalizeHeader(value) {
    return String(value ?? '').trim();
  }

  function getCell(sheet, rowIndex, colIndex) {
    const address = window.XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    return sheet[address] || null;
  }

  function getCellText(sheet, rowIndex, colIndex) {
    const cell = getCell(sheet, rowIndex, colIndex);
    if (!cell) return '';
    if (cell.f) return `=${cell.f}`;
    if (cell.w !== undefined) return String(cell.w).trim();
    if (cell.v !== undefined) return String(cell.v).trim();
    return '';
  }

  function getCellValue(sheet, rowIndex, colIndex) {
    const cell = getCell(sheet, rowIndex, colIndex);
    if (!cell) return '';
    return cell.v !== undefined ? cell.v : getCellText(sheet, rowIndex, colIndex);
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

  function parseImageId(value) {
    const text = String(value || '');
    const quoted = text.match(/DISPIMG\("([^"]+)"/i);
    if (quoted) return quoted[1];
    const id = text.match(/ID_[A-Z0-9]+/i);
    return id ? id[0] : '';
  }

  function parseDateRange(value) {
    const text = String(value || '').trim();
    const dates = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
    return {
      valid_from: dates[0] || null,
      valid_to: dates[1] || null,
      valid_range_text: text || null,
    };
  }

  async function extractImageManifest(buffer) {
    if (!window.JSZip) return {};
    const zip = await window.JSZip.loadAsync(buffer);
    const [cellImagesXml, relsXml] = await Promise.all([
      zip.file('xl/cellimages.xml')?.async('text'),
      zip.file('xl/_rels/cellimages.xml.rels')?.async('text'),
    ]);
    if (!cellImagesXml || !relsXml) return {};

    const relTargetById = {};
    Array.from(relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)).forEach((match) => {
      relTargetById[match[1]] = match[2].replace(/^\/?xl\//, '');
    });

    const manifest = {};
    Array.from(cellImagesXml.matchAll(/<etc:cellImage>[\s\S]*?<xdr:cNvPr[^>]*name="([^"]+)"[\s\S]*?<a:blip[^>]*r:embed="([^"]+)"[\s\S]*?<\/etc:cellImage>/g)).forEach((match) => {
      const imageId = match[1];
      const relId = match[2];
      const target = relTargetById[relId] || '';
      manifest[imageId] = target ? target.split('/').pop() : '';
    });
    return manifest;
  }

  async function readWorkbook(file) {
    if (!file) return { workbook: null, imageManifest: {} };
    if (!window.XLSX) throw new Error('Excel 解析库未加载，请刷新页面后重试');
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, {
      type: 'array',
      cellFormula: true,
      cellNF: false,
      cellText: true,
      cellDates: false,
    });
    const imageManifest = await extractImageManifest(buffer).catch(() => ({}));
    return { workbook, imageManifest };
  }

  function parseMainWorkbook(workbook, filename, imageManifest) {
    if (!workbook) return [];
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet || !sheet['!ref']) return [];
    const range = window.XLSX.utils.decode_range(sheet['!ref']);
    const headers = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      headers.push(normalizeHeader(getCellText(sheet, range.s.r, col)));
    }
    const colByHeader = new Map(headers.map((header, index) => [header, index]));

    const rows = [];
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const id = parseNumber(getCellValue(sheet, row, colByHeader.get('达摩盘人群包ID') ?? 0));
      const name = getCellText(sheet, row, colByHeader.get('达摩盘人群名称') ?? 1);
      if (!id || !name) continue;

      const valid = parseDateRange(getCellText(sheet, row, colByHeader.get('有效日期') ?? 2));
      const imageMap = {};
      const rawRow = {};
      headers.forEach((header, col) => {
        if (header) rawRow[header] = getCellText(sheet, row, col);
      });
      FIELD_COLUMNS.forEach((field) => {
        const col = colByHeader.get(field);
        if (col === undefined) return;
        const rawValue = getCellText(sheet, row, col);
        const imageId = parseImageId(rawValue);
        imageMap[field] = {
          image_id: imageId,
          image_file: imageId ? (imageManifest[imageId] || '') : '',
          raw_formula: rawValue || null,
        };
      });

      rows.push({
        audience_id: id,
        audience_name: name,
        valid_from: valid.valid_from,
        valid_to: valid.valid_to,
        valid_range_text: valid.valid_range_text,
        audience_size: parseNumber(getCellValue(sheet, row, colByHeader.get('人群规模') ?? 3)),
        selection_logic: getCellText(sheet, row, colByHeader.get('圈选逻辑') ?? 4),
        audience_definition: getCellText(sheet, row, colByHeader.get('人群定义') ?? 5),
        image_formula_map: imageMap,
        metric_summary: {},
        raw_row: rawRow,
        source_filename: filename || '',
      });
    }
    return rows;
  }

  function sheetRows(workbook, sheetName) {
    if (!workbook || !sheetName || !workbook.Sheets[sheetName]) return [];
    return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: true });
  }

  function findSheetName(workbook, preferred, fallbackPattern) {
    if (!workbook) return '';
    if (workbook.SheetNames.includes(preferred)) return preferred;
    return workbook.SheetNames.find((name) => fallbackPattern.test(name)) || '';
  }

  function addMetric(metrics, seen, item) {
    const audienceId = parseNumber(item.audience_id);
    const dimension = String(item.dimension || '').trim();
    const category = String(item.category || '').trim();
    const share = parseShare(item.share);
    if (!audienceId || !dimension || !category || share === null) return;
    const key = `${audienceId}::${dimension}::${category}`;
    if (seen.has(key)) return;
    seen.add(key);
    metrics.push({
      audience_id: audienceId,
      dimension,
      category,
      share,
      share_text: item.share_text || formatPercent(share),
      source: item.source || 'image_extract',
    });
  }

  function parseLongMetrics(workbook) {
    const sheetName = findSheetName(workbook, '人群图片数据提取', /图片|提取|长表/);
    const rows = sheetRows(workbook, sheetName);
    const metrics = [];
    const seen = new Set();
    rows.forEach((row) => {
      addMetric(metrics, seen, {
        audience_id: row['人群仓库ID'] || row['达摩盘人群包ID'] || row['人群ID'],
        dimension: row['维度'],
        category: row['分类'],
        share: row['分析人群占比'] || row['占比'],
        source: 'image_extract_long',
      });
    });
    return { metrics, seen };
  }

  function parseWideMetrics(workbook, seen) {
    const sheetName = findSheetName(workbook, '宽表格式', /宽表|wide/i);
    if (!workbook || !sheetName) return [];
    const rows = sheetRows(workbook, sheetName);
    const metrics = [];
    rows.forEach((row) => {
      const audienceId = row['人群仓库ID'] || row['达摩盘人群包ID'] || row['人群ID'];
      Object.entries(row).forEach(([key, value]) => {
        if (['人群仓库ID', '达摩盘人群包ID', '人群ID'].includes(key)) return;
        const splitAt = key.indexOf('_');
        if (splitAt <= 0) return;
        addMetric(metrics, seen, {
          audience_id: audienceId,
          dimension: key.slice(0, splitAt),
          category: key.slice(splitAt + 1),
          share: value,
          source: 'image_extract_wide',
        });
      });
    });
    return metrics;
  }

  function parseExtractWorkbook(workbook) {
    const longParsed = parseLongMetrics(workbook);
    const wideMetrics = parseWideMetrics(workbook, longParsed.seen);
    return longParsed.metrics.concat(wideMetrics);
  }

  function buildMetricSummary(metrics) {
    const summaryByAudience = new Map();
    metrics.forEach((metric) => {
      if (!summaryByAudience.has(metric.audience_id)) summaryByAudience.set(metric.audience_id, {});
      const summary = summaryByAudience.get(metric.audience_id);
      summary[`${metric.dimension}_${metric.category}`] = metric.share;
    });
    return summaryByAudience;
  }

  function renderParsedPreview() {
    const audiences = state.parsed.audiences;
    const metrics = state.parsed.metrics;
    const metricCounts = metrics.reduce((acc, metric) => {
      acc[metric.audience_id] = (acc[metric.audience_id] || 0) + 1;
      return acc;
    }, {});
    const container = $('audience-preview');
    if (!container) return;
    if (!audiences.length) {
      container.innerHTML = '<div class="audience-empty">上传表格后，这里会显示待入库的人群明细。</div>';
      return;
    }
    container.innerHTML = `
      <div class="audience-table-wrap">
        <table class="audience-table">
          <thead>
            <tr>
              <th>人群ID</th>
              <th>人群名称</th>
              <th>有效期</th>
              <th>规模</th>
              <th>图片维度</th>
              <th>圈选逻辑</th>
            </tr>
          </thead>
          <tbody>
            ${audiences.map((item) => `
              <tr>
                <td>${escapeHtml(item.audience_id)}</td>
                <td>${escapeHtml(item.audience_name)}</td>
                <td>${escapeHtml(item.valid_from || '-')}${item.valid_to ? ` 至 ${escapeHtml(item.valid_to)}` : ''}</td>
                <td>${formatNumber(item.audience_size)}</td>
                <td>${formatNumber(metricCounts[item.audience_id] || 0)}</td>
                <td>${escapeHtml(item.selection_logic || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
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

  async function handleParse() {
    try {
      setStatus('正在解析 Excel...', 'warn');
      const mainFile = $('audience-main-file')?.files?.[0] || null;
      const extractFile = $('audience-extract-file')?.files?.[0] || null;
      if (!mainFile) {
        setStatus('请先选择人群仓库主表。', 'error');
        return;
      }
      const [mainWorkbook, extractWorkbook] = await Promise.all([
        readWorkbook(mainFile),
        readWorkbook(extractFile),
      ]);
      const audiences = parseMainWorkbook(mainWorkbook.workbook, mainFile.name, mainWorkbook.imageManifest);
      const metrics = parseExtractWorkbook(extractWorkbook.workbook);
      const summaryByAudience = buildMetricSummary(metrics);
      audiences.forEach((audience) => {
        audience.metric_summary = summaryByAudience.get(audience.audience_id) || {};
      });
      state.parsed = { audiences, metrics };
      renderParsedPreview();
      setStatus(`已解析 ${audiences.length} 条人群、${metrics.length} 条图片维度数据。`, audiences.length ? 'success' : 'warn');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '解析失败', 'error');
    }
  }

  async function handleImport() {
    if (!state.parsed.audiences.length) {
      setStatus('没有可入库的数据，请先解析表格。', 'error');
      return;
    }
    try {
      state.saving = true;
      setStatus('正在写入 Supabase...', 'warn');
      const result = await api.importAudiences(state.parsed);
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
    $('parse-audience-btn')?.addEventListener('click', handleParse);
    $('save-audience-btn')?.addEventListener('click', handleImport);
    $('refresh-audience-btn')?.addEventListener('click', loadRepository);
    $('audience-search')?.addEventListener('input', () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(loadRepository, 300);
    });
  }

  function init() {
    renderParsedPreview();
    renderSavedRepository();
    bind();
    loadRepository();
  }

  window.addEventListener('DOMContentLoaded', init);
})(window);
