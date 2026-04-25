/**
 * 成交预测 - 事件处理模块
 * 负责用户交互事件绑定和处理
 */

const ConversionPredictionEvents = (function() {
    'use strict';

    /**
     * 初始化事件监听
     */
    function init() {
        const recommendationTab = document.getElementById('mode-recommendation-btn');
        const predictionTab = document.getElementById('mode-prediction-btn');
        if (recommendationTab) recommendationTab.addEventListener('click', () => switchMode('recommendation'));
        if (predictionTab) predictionTab.addEventListener('click', () => switchMode('prediction'));

        const recommendationBtn = document.getElementById('run-recommendation-btn');
        if (recommendationBtn) {
            recommendationBtn.addEventListener('click', handleRunRecommendation);
        }

        // 运行预测按钮
        const runBtn = document.getElementById('run-prediction-btn');
        if (runBtn) {
            runBtn.addEventListener('click', handleRunPrediction);
        }

        // 导出CSV按钮
        const exportBtn = document.getElementById('export-csv-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', handleExportCSV);
        }
        const legacyExportBtn = document.getElementById('export-csv-btn-legacy');
        if (legacyExportBtn) {
            legacyExportBtn.addEventListener('click', handleExportCSV);
        }

        // 排序选择器
        const sortSelect = document.getElementById('sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', handleSort);
        }

        // 分页按钮
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');
        if (prevBtn) prevBtn.addEventListener('click', handlePrevPage);
        if (nextBtn) nextBtn.addEventListener('click', handleNextPage);
    }

    function switchMode(mode) {
        const isRecommendation = mode === 'recommendation';
        const recommendationControls = document.getElementById('recommendation-controls');
        const predictionControls = document.getElementById('legacy-prediction-controls');
        const recommendationTab = document.getElementById('mode-recommendation-btn');
        const predictionTab = document.getElementById('mode-prediction-btn');

        if (recommendationControls) recommendationControls.style.display = isRecommendation ? 'block' : 'none';
        if (predictionControls) predictionControls.style.display = isRecommendation ? 'none' : 'block';
        if (recommendationTab) recommendationTab.classList.toggle('is-active', isRecommendation);
        if (predictionTab) predictionTab.classList.toggle('is-active', !isRecommendation);

        const sortSelect = document.getElementById('sort-select');
        if (sortSelect) sortSelect.value = isRecommendation ? 'budget_desc' : 'probability_desc';

        ConversionPredictionRender.setMode(mode);
    }

    async function handleRunRecommendation() {
        const predictionDate = document.getElementById('recommendation-date').value;
        const sceneSelect = document.getElementById('recommendation-scene-filter');
        const sceneName = sceneSelect ? sceneSelect.value : '';
        const topN = Number(document.getElementById('recommendation-top-n').value || 20);
        const totalBudget = Number(document.getElementById('total-budget')?.value || 0);
        const targetCpo = Number(document.getElementById('target-cpo')?.value || 0);

        if (!predictionDate) {
            ConversionPredictionRender.showError('请选择推荐日期');
            return;
        }
        if (!targetCpo || targetCpo <= 0) {
            ConversionPredictionRender.showError('请填写大于 0 的目标 CPO');
            return;
        }

        let productItems = [];
        try {
            productItems = await readProductItems();
        } catch (error) {
            ConversionPredictionRender.showError(error.message || '货盘解析失败');
            return;
        }

        if (productItems.length === 0) {
            ConversionPredictionRender.showError('请上传或粘贴当天货盘 CSV');
            return;
        }

        ConversionPredictionRender.showLoading();

        const runBtn = document.getElementById('run-recommendation-btn');
        if (runBtn) runBtn.disabled = true;

        try {
            const result = await ConversionPredictionApi.runRecommendation({
                prediction_date: predictionDate,
                scene_name: sceneName || undefined,
                top_n: topN,
                total_budget: totalBudget,
                target_cpo: targetCpo,
                product_items: productItems,
            });

            if (result && result.recommendations) {
                ConversionPredictionRender.renderRecommendations(result);
            } else {
                ConversionPredictionRender.showError('推荐结果格式异常');
            }
        } catch (error) {
            console.error('推荐失败:', error);
            ConversionPredictionRender.showError(formatRequestError(error, '推荐失败，请稍后重试'));
        } finally {
            if (runBtn) runBtn.disabled = false;
        }
    }

    /**
     * 处理运行预测
     */
    async function handleRunPrediction() {
        // 获取参数
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        const crowdName = document.getElementById('crowd-filter').value.trim();
        const sceneId = document.getElementById('scene-filter').value;

        // 验证
        if (!startDate || !endDate) {
            ConversionPredictionRender.showError('请选择日期范围');
            return;
        }

        if (new Date(startDate) > new Date(endDate)) {
            ConversionPredictionRender.showError('开始日期不能晚于结束日期');
            return;
        }

        // 显示加载状态
        ConversionPredictionRender.showLoading();

        // 禁用按钮
        const runBtn = document.getElementById('run-prediction-btn');
        if (runBtn) runBtn.disabled = true;

        try {
            // 调用API
            const result = await ConversionPredictionApi.runPrediction({
                start_date: startDate,
                end_date: endDate,
                crowd_name: crowdName || undefined,
                scene_id: sceneId || undefined,
            });

            // 渲染结果
            if (result && result.predictions) {
                ConversionPredictionRender.renderPredictions(result.predictions);
            } else {
                ConversionPredictionRender.showError('预测结果格式异常');
            }
        } catch (error) {
            console.error('预测失败:', error);
            ConversionPredictionRender.showError(formatRequestError(error, '预测失败，请稍后重试'));
        } finally {
            // 恢复按钮
            if (runBtn) runBtn.disabled = false;
        }
    }

    /**
     * 处理导出CSV
     */
    function handleExportCSV() {
        // 获取当前显示的预测数据（从全局状态获取）
        const predictions = window._currentPredictionRecords || [];

        if (predictions.length === 0) {
            alert('没有可导出的预测数据');
            return;
        }

        // 生成文件名（包含日期）
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const filename = `货盘人群推荐_${timestamp}.csv`;

        ConversionPredictionApi.exportToCSV(predictions, filename);
    }

    /**
     * 处理排序
     */
    function handleSort(event) {
        const sortBy = event.target.value;
        ConversionPredictionRender.sortPredictions(sortBy);
    }

    /**
     * 处理上一页
     */
    function handlePrevPage() {
        ConversionPredictionRender.prevPage();
    }

    /**
     * 处理下一页
     */
    function handleNextPage() {
        ConversionPredictionRender.nextPage();
    }

    async function readProductItems() {
        const fileInput = document.getElementById('product-csv-file');
        const textInput = document.getElementById('product-csv-text');
        let csvText = '';

        if (fileInput && fileInput.files && fileInput.files[0]) {
            csvText = await fileInput.files[0].text();
        } else if (textInput && textInput.value.trim()) {
            csvText = textInput.value.trim();
        }

        if (!csvText) return [];
        return parseCsv(csvText);
    }

    function formatRequestError(error, fallbackSummary) {
        if (window.authHelpers && window.authHelpers.describeFetchError) {
            const described = window.authHelpers.describeFetchError(error, fallbackSummary);
            return described.message || fallbackSummary;
        }
        return fallbackSummary || error.message || '请求失败，请稍后重试';
    }

    function parseCsv(csvText) {
        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const next = csvText[i + 1];

            if (char === '"' && inQuotes && next === '"') {
                cell += '"';
                i++;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(cell);
                cell = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && next === '\n') i++;
                row.push(cell);
                if (row.some(value => value.trim() !== '')) rows.push(row);
                row = [];
                cell = '';
            } else {
                cell += char;
            }
        }

        row.push(cell);
        if (row.some(value => value.trim() !== '')) rows.push(row);

        if (rows.length < 2) {
            throw new Error('货盘 CSV 至少需要表头和一行商品数据');
        }

        const headers = rows[0].map(header => header.replace(/^\uFEFF/, '').trim());
        return rows.slice(1).map(values => {
            const item = {};
            headers.forEach((header, index) => {
                item[header] = (values[index] || '').trim();
            });
            return item;
        }).filter(item => Object.values(item).some(value => value !== ''));
    }

    return {
        init,
    };
})();

// 导出到全局
window.ConversionPredictionEvents = ConversionPredictionEvents;
