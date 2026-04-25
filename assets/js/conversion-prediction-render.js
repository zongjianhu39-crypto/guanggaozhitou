/**
 * 成交预测 - UI渲染模块
 * 负责预测结果的展示和更新
 */

const ConversionPredictionRender = (function() {
    'use strict';

    // 状态
    let currentPredictions = [];
    let currentMode = 'recommendation';
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
                <p>${currentMode === 'recommendation' ? '正在测算各人群预算档位和CPO...' : '正在运行模型预测，这可能需要几秒钟...'}</p>
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
                <p>${currentMode === 'recommendation' ? '上传或粘贴当天货盘，填写目标CPO和总预算后点击"生成预算"' : '选择日期范围后点击"运行预测"开始分析'}</p>
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
        currentMode = 'prediction';
        currentPredictions = predictions || [];
        window._currentPredictionRecords = currentPredictions;
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
        setExportDisabled(false);
    }

    /**
     * 渲染货盘推荐结果
     * @param {Object} result - 推荐结果
     */
    function renderRecommendations(result) {
        currentMode = 'recommendation';
        currentPredictions = (result && result.recommendations) || [];
        window._currentPredictionRecords = currentPredictions;
        currentPage = 1;

        if (currentPredictions.length === 0) {
            showError('没有生成推荐结果，请检查货盘内容或筛选条件');
            return;
        }

        const stateEl = document.getElementById('prediction-state');
        if (stateEl) stateEl.style.display = 'none';

        renderRecommendationSummary(result);
        renderTable();

        const summaryEl = document.getElementById('prediction-summary');
        const resultsEl = document.getElementById('prediction-results');
        if (summaryEl) summaryEl.style.display = 'block';
        if (resultsEl) resultsEl.style.display = 'block';

        setExportDisabled(false);
    }

    /**
     * 渲染统计概览
     */
    function renderSummary() {
        setPredictionHeaders();
        const count = currentPredictions.length;
        const avgProb = currentPredictions.reduce((sum, p) => sum + (p.conv_probability || 0), 0) / count;
        const highProbCount = currentPredictions.filter(p => p.conv_probability >= 0.6).length;
        const totalCost = currentPredictions.reduce((sum, p) => sum + (p.final_cost || 0), 0);

        document.getElementById('summary-count').textContent = count;
        document.getElementById('summary-prob').textContent = ConversionPredictionApi.formatProbability(avgProb);
        document.getElementById('summary-high').textContent = `${highProbCount} 个 (${((highProbCount / count) * 100).toFixed(1)}%)`;
        document.getElementById('summary-cost').textContent = `¥${totalCost.toFixed(2)}`;
    }

    function renderRecommendationSummary(result) {
        setRecommendationHeaders();
        const count = currentPredictions.length;
        const allocatedBudget = currentPredictions.reduce((sum, item) => sum + (item.recommended_budget || 0), 0);
        const avgCpo = currentPredictions.reduce((sum, item) => sum + (item.estimated_cpo || 0), 0) / count;
        const priorityCount = currentPredictions.filter(item => ['主投承接', '正常投放'].includes(item.recommendation_level)).length;
        const avgConfidence = currentPredictions.reduce((sum, item) => sum + (item.confidence || 0), 0) / count;

        document.getElementById('summary-count-label').textContent = '分配人群数';
        document.getElementById('summary-prob-label').textContent = '已分配预算';
        document.getElementById('summary-high-label').textContent = '主投/正常';
        document.getElementById('summary-cost-label').textContent = '平均置信度';
        document.getElementById('summary-count').textContent = count;
        document.getElementById('summary-prob').textContent = `¥${allocatedBudget.toFixed(0)}`;
        document.getElementById('summary-high').textContent = `${priorityCount} 个`;
        document.getElementById('summary-cost').textContent = `${(avgConfidence * 100).toFixed(0)}% / CPO ${avgCpo.toFixed(1)}`;

        const profile = result && result.assortment_profile;
        if (profile) {
            const stateEl = document.getElementById('prediction-state');
            if (stateEl) stateEl.dataset.profile = JSON.stringify(profile);
        }
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

        if (currentMode === 'recommendation') {
            tbody.innerHTML = pageData.map(item => {
                const levelClass = getLevelClass(item.recommendation_level);
                const reasons = Array.isArray(item.reasons) ? item.reasons.join('；') : '-';
	                return `
	                    <tr>
	                        <td>${item.rank || '-'}</td>
	                        <td>${escapeHtml(item.crowd_name || '-')}</td>
	                        <td><span class="level-badge ${levelClass}">${escapeHtml(item.recommendation_level || '-')}</span></td>
	                        <td><strong>¥${(item.recommended_budget || 0).toFixed(0)}</strong></td>
	                        <td>¥${(item.budget_capacity || 0).toFixed(0)}</td>
	                        <td>¥${(item.estimated_cpo || 0).toFixed(2)}</td>
	                        <td>¥${(item.marginal_cpo || 0).toFixed(2)}</td>
	                        <td>¥${(item.cpo_low || 0).toFixed(2)} - ¥${(item.cpo_high || 0).toFixed(2)}</td>
	                        <td>${((item.confidence || 0) * 100).toFixed(0)}%</td>
	                        <td>${escapeHtml(item.suggested_action || getActionText(item.recommendation_level))}</td>
	                        <td class="reason-cell">${escapeHtml(reasons)}</td>
                    </tr>
                `;
            }).join('');
        } else {
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
        }

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
            case 'score_desc':
                sorted.sort((a, b) => (b.recommended_budget || b.match_score || 0) - (a.recommended_budget || a.match_score || 0));
                break;
            case 'budget_desc':
                sorted.sort((a, b) => (b.recommended_budget || 0) - (a.recommended_budget || 0));
                break;
            case 'capacity_desc':
                sorted.sort((a, b) => (b.budget_capacity || 0) - (a.budget_capacity || 0));
                break;
            case 'cpo_asc':
                sorted.sort((a, b) => (a.estimated_cpo || 999999) - (b.estimated_cpo || 999999));
                break;
            case 'rank_asc':
                sorted.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
                break;
            case 'confidence_desc':
                sorted.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                break;
            case 'probability_desc':
                sorted.sort((a, b) => ((b.conv_probability ?? b.predicted_conv_rate) || 0) - ((a.conv_probability ?? a.predicted_conv_rate) || 0));
                break;
            case 'probability_asc':
                sorted.sort((a, b) => ((a.conv_probability ?? a.predicted_conv_rate) || 0) - ((b.conv_probability ?? b.predicted_conv_rate) || 0));
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
        window._currentPredictionRecords = currentPredictions;
        currentPage = 1;
        if (currentMode === 'recommendation') {
            renderRecommendationSummary({ recommendations: currentPredictions });
        } else {
            renderSummary();
        }
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
        const recommendSelect = document.getElementById('recommendation-scene-filter');

        if (select) {
            select.innerHTML = '<option value="">全部场景</option>';
        }
        if (recommendSelect) {
            recommendSelect.innerHTML = '<option value="">自动选择主场景</option>';
        }

        scenes.forEach(scene => {
            const text = scene.name || scene.scene_name;
            const option = document.createElement('option');
            option.value = scene.id || scene.scene_id;
            option.textContent = text;
            if (select) select.appendChild(option);

            const recommendOption = document.createElement('option');
            recommendOption.value = text;
            recommendOption.textContent = text;
            if (recommendSelect) recommendSelect.appendChild(recommendOption);
        });
    }

    function setMode(mode) {
        currentMode = mode;
        window._currentPredictionRecords = [];
        setExportDisabled(true);
        showInitialState();
    }

    function setRecommendationHeaders() {
        const title = document.getElementById('results-title');
        const thead = document.querySelector('#prediction-table thead tr');
        const sortSelect = document.getElementById('sort-select');
        if (title) title.textContent = '预算分配结果';
        if (thead) {
            thead.innerHTML = `
	                <th>排名</th>
	                <th class="col-crowd">人群名称</th>
	                <th>推荐等级</th>
	                <th>建议预算</th>
	                <th>可承接预算</th>
	                <th>测算CPO</th>
	                <th>边际CPO</th>
	                <th>CPO区间</th>
	                <th>置信度</th>
	                <th>建议动作</th>
	                <th class="col-reasons">推荐理由</th>
            `;
        }
        if (sortSelect) {
            sortSelect.innerHTML = `
	                <option value="budget_desc">建议预算 ↓</option>
	                <option value="capacity_desc">可承接预算 ↓</option>
	                <option value="cpo_asc">测算CPO ↑</option>
	                <option value="confidence_desc">置信度 ↓</option>
	                <option value="rank_asc">推荐排名 ↑</option>
            `;
        }
    }

    function setPredictionHeaders() {
        const title = document.getElementById('results-title');
        const thead = document.querySelector('#prediction-table thead tr');
        const sortSelect = document.getElementById('sort-select');
        if (title) title.textContent = '预测结果';
        if (thead) {
            thead.innerHTML = `
                <th class="col-date">日期</th>
                <th class="col-scene">场景</th>
                <th class="col-crowd">人群名称</th>
                <th class="col-prob">成交概率</th>
                <th class="col-cost">订单成本</th>
                <th class="col-total">预测总成本</th>
                <th class="col-range">置信区间</th>
            `;
        }
        if (sortSelect) {
            sortSelect.innerHTML = `
                <option value="probability_desc">成交概率 ↓</option>
                <option value="probability_asc">成交概率 ↑</option>
                <option value="cost_desc">预测成本 ↓</option>
                <option value="cost_asc">预测成本 ↑</option>
                <option value="date_asc">日期 ↑</option>
            `;
        }
    }

    function getLevelClass(level) {
        if (level === '主投承接' || level === '强推') return 'level-strong';
        if (level === '正常投放' || level === '优先测试') return 'level-priority';
        if (level === '小预算测试' || level === '备用承接') return 'level-test';
        return 'level-watch';
    }

    function getActionText(level) {
        if (level === '主投承接') return '可作为主投人群分配预算';
        if (level === '正常投放') return '按建议预算投放并观察CPO';
        if (level === '强推') return '优先放入首轮测试';
        if (level === '优先测试') return '正常预算测试';
        if (level === '小预算测试') return '小预算探测';
        if (level === '备用承接') return '总预算不足时备用，或加预算后启用';
        return '目标CPO内暂不分配预算';
    }

    function setExportDisabled(disabled) {
        ['export-csv-btn', 'export-csv-btn-legacy'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = disabled;
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
    var escapeHtml = window.sharedUtils && window.sharedUtils.escapeHtml;

    return {
        showLoading,
        showError,
        showInitialState,
        renderPredictions,
        renderRecommendations,
        sortPredictions,
        prevPage,
        nextPage,
        populateSceneFilter,
        setMode,
    };
})();

// 导出到全局
window.ConversionPredictionRender = ConversionPredictionRender;
