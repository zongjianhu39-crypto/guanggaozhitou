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
            ConversionPredictionRender.showError(`预测失败：${error.message || '未知错误'}`);
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
        const predictions = window._currentPredictions || [];

        if (predictions.length === 0) {
            alert('没有可导出的预测数据');
            return;
        }

        // 生成文件名（包含日期）
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const filename = `成交预测结果_${timestamp}.csv`;

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

    return {
        init,
    };
})();

// 导出到全局
window.ConversionPredictionEvents = ConversionPredictionEvents;
