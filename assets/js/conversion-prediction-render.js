/**
 * 成交预测 - UI渲染模块
 * 负责预测结果的展示和更新
 */

const ConversionPredictionRender = (function() {
    'use strict';

    // 状态
    let currentPredictions = [];
    let currentPage = 1;
    const pageSize = 50;

    /**
     * 显示加载状态
     */
    function showLoading() {
        const stateEl = document.getElementById('prediction-state');
        const summaryEl = document.getElementById('prediction-summary');
        const resultsEl = document.getElementById('prediction-results');

        if (stateEl) {
            stateEl.style.display = 'block';
            stateEl.className = 'prediction-state is-loading';
            stateEl.innerHTML = `
                <div class="state-icon">⏳</div>
                <p>正在运行模型预测，这可能需要几秒钟...</p>
            `;
        }

        if (summaryEl) summaryEl.style.display = 'none';
        if (resultsEl) resultsEl.style.display = 'none';
    }

    /**
     * 显示错误状态
     * @param {string} message - 错误信息
     */
    function showError(message) {
        const stateEl = document.getElementById('prediction-state');
        const summaryEl = document.getElementById('prediction-summary');
        const resultsEl = document.getElementById('prediction-results');

        if (stateEl) {
            stateEl.style.display = 'block';
            stateEl.className = 'prediction-state is-error';
            stateEl.innerHTML = `
                <div class="state-icon">❌</div>
                <p>${message}</p>
            `;
        }

        if (summaryEl) summaryEl.style.display = 'none';
        if (resultsEl) resultsEl.style.display = 'none';
    }

    /**
     * 显示初始状态
     */
    function showInitialState() {
        const stateEl = document.getElementById('prediction-state');
        const summaryEl = document.getElementById('prediction-summary');
        const resultsEl = document.getElementById('prediction-results');

        if (stateEl) {
            stateEl.style.display = 'block';
            stateEl.className = 'prediction-state';
            stateEl.innerHTML = `
                <div class="state-icon">📊</div>
                <p>选择日期范围后点击"运行预测"开始分析</p>
            `;
        }

        if (summaryEl) summaryEl.style.display = 'none';
        if (resultsEl) resultsEl.style.display = 'none';
    }

    /**
     * 渲染预测结果
     * @param {Array} predictions - 预测结果数组
     */
    function renderPredictions(predictions) {
        currentPredictions = predictions || [];
        currentPage = 1;

        if (currentPredictions.length === 0) {
            showError('没有符合条件的预测数据，请尝试调整筛选条件');
            return;
        }

        // 隐藏状态，显示结果
        const stateEl = document.getElementById('prediction-state');
        if (stateEl) stateEl.style.display = 'none';

        // 渲染统计概览
        renderSummary();

        // 渲染表格
        renderTable();

        // 显示结果区域
        const summaryEl = document.getElementById('prediction-summary');
        const resultsEl = document.getElementById('prediction-results');
        if (summaryEl) summaryEl.style.display = 'block';
        if (resultsEl) resultsEl.style.display = 'block';

        // 启用导出按钮
        const exportBtn = document.getElementById('export-csv-btn');
        if (exportBtn) exportBtn.disabled = false;
    }

    /**
     * 渲染统计概览
     */
    function renderSummary() {
        const count = currentPredictions.length;
        const avgProb = currentPredictions.reduce((sum, p) => sum + (p.conv_probability || 0), 0) / count;
        const highProbCount = currentPredictions.filter(p => p.conv_probability >= 0.6).length;
        const totalCost = currentPredictions.reduce((sum, p) => sum + (p.final_cost || 0), 0);

        document.getElementById('summary-count').textContent = count;
        document.getElementById('summary-prob').textContent = ConversionPredictionApi.formatProbability(avgProb);
        document.getElementById('summary-high').textContent = `${highProbCount} 个 (${((highProbCount / count) * 100).toFixed(1)}%)`;
        document.getElementById('summary-cost').textContent = `¥${totalCost.toFixed(2)}`;
    }

    /**
     * 渲染表格（当前页）
     */
    function renderTable() {
        const tbody = document.getElementById('prediction-tbody');
        if (!tbody) return;

        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, currentPredictions.length);
        const pageData = currentPredictions.slice(startIndex, endIndex);

        tbody.innerHTML = pageData.map(pred => {
            const probClass = ConversionPredictionApi.getProbabilityClass(pred.conv_probability);
            const probText = ConversionPredictionApi.formatProbability(pred.conv_probability);

            return `
                <tr>
                    <td>${formatDate(pred.prediction_date)}</td>
                    <td>${escapeHtml(pred.scene_name || '-')}</td>
                    <td>${escapeHtml(pred.audience_name || '-')}</td>
                    <td><span class="prob-badge ${probClass}">${probText}</span></td>
                    <td>¥${(pred.predicted_cost || 0).toFixed(2)}</td>
                    <td><strong>¥${(pred.final_cost || 0).toFixed(2)}</strong></td>
                    <td>¥${(pred.lower_bound || 0).toFixed(2)} - ¥${(pred.upper_bound || 0).toFixed(2)}</td>
                </tr>
            `;
        }).join('');

        // 更新分页信息
        document.getElementById('total-count').textContent = currentPredictions.length;
        document.querySelector('.pagination-info').innerHTML = 
            `显示 ${startIndex + 1}-${endIndex} / 共 ${currentPredictions.length} 条`;

        // 更新按钮状态
        document.getElementById('prev-page-btn').disabled = currentPage === 1;
        document.getElementById('next-page-btn').disabled = endIndex >= currentPredictions.length;
    }

    /**
     * 排序预测结果
     * @param {string} sortBy - 排序规则
     */
    function sortPredictions(sortBy) {
        const sorted = [...currentPredictions];

        switch (sortBy) {
            case 'probability_desc':
                sorted.sort((a, b) => (b.conv_probability || 0) - (a.conv_probability || 0));
                break;
            case 'probability_asc':
                sorted.sort((a, b) => (a.conv_probability || 0) - (b.conv_probability || 0));
                break;
            case 'cost_desc':
                sorted.sort((a, b) => (b.final_cost || 0) - (a.final_cost || 0));
                break;
            case 'cost_asc':
                sorted.sort((a, b) => (a.final_cost || 0) - (b.final_cost || 0));
                break;
            case 'date_asc':
                sorted.sort((a, b) => new Date(a.prediction_date) - new Date(b.prediction_date));
                break;
        }

        currentPredictions = sorted;
        currentPage = 1;
        renderSummary();
        renderTable();
    }

    /**
     * 上一页
     */
    function prevPage() {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    }

    /**
     * 下一页
     */
    function nextPage() {
        const maxPage = Math.ceil(currentPredictions.length / pageSize);
        if (currentPage < maxPage) {
            currentPage++;
            renderTable();
        }
    }

    /**
     * 填充场景筛选器
     * @param {Array} scenes - 场景列表
     */
    function populateSceneFilter(scenes) {
        const select = document.getElementById('scene-filter');
        if (!select) return;

        // 保留"全部场景"选项
        select.innerHTML = '<option value="">全部场景</option>';

        scenes.forEach(scene => {
            const option = document.createElement('option');
            option.value = scene.id || scene.scene_id;
            option.textContent = scene.name || scene.scene_name;
            select.appendChild(option);
        });
    }

    /**
     * 格式化日期
     * @param {string|Date} date - 日期
     * @returns {string} 格式化后的日期
     */
    function formatDate(date) {
        if (!date) return '-';
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * HTML转义
     * @param {string} text - 原始文本
     * @returns {string} 转义后的文本
     */
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return {
        showLoading,
        showError,
        showInitialState,
        renderPredictions,
        sortPredictions,
        prevPage,
        nextPage,
        populateSceneFilter,
    };
})();

// 导出到全局
window.ConversionPredictionRender = ConversionPredictionRender;
