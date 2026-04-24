/**
 * 成交预测 - 页面初始化模块
 * 负责页面加载时的初始化和配置
 */

(function() {
    'use strict';

    // 页面加载完成后初始化
    document.addEventListener('DOMContentLoaded', function() {
        initializePage();
    });

    /**
     * 初始化页面
     */
    async function initializePage() {
        console.log('[成交预测] 页面初始化开始');

        // 设置默认日期范围（本月）
        setDefaultDates();

        // 加载场景列表
        try {
            await loadScenes();
        } catch (error) {
            console.warn('[成交预测] 加载场景列表失败:', error);
        }

        // 初始化事件监听
        ConversionPredictionEvents.init();

        console.log('[成交预测] 页面初始化完成');
    }

    /**
     * 设置默认日期范围
     */
    function setDefaultDates() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        // 本月第一天
        const firstDay = new Date(year, month, 1);
        const startDateStr = formatDate(firstDay);

        // 今天
        const endDateStr = formatDate(now);

        const startDateInput = document.getElementById('start-date');
        const endDateInput = document.getElementById('end-date');

        if (startDateInput) startDateInput.value = startDateStr;
        if (endDateInput) endDateInput.value = endDateStr;
    }

    /**
     * 加载场景列表
     */
    async function loadScenes() {
        const scenes = await ConversionPredictionApi.fetchScenes();
        ConversionPredictionRender.populateSceneFilter(scenes);
    }

    /**
     * 格式化日期为 YYYY-MM-DD
     * @param {Date} date - 日期对象
     * @returns {string} 格式化后的日期
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
})();
