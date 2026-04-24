/**
 * 成交预测 - API调用模块
 * 负责与后端Edge Function通信，获取预测结果
 */

const ConversionPredictionApi = (function() {
    'use strict';

    /**
     * 运行预测
     * @param {Object} params - 预测参数
     * @param {string} params.start_date - 开始日期 YYYY-MM-DD
     * @param {string} params.end_date - 结束日期 YYYY-MM-DD
     * @param {string} [params.crowd_name] - 人群名称（可选）
     * @param {string} [params.scene_id] - 场景ID（可选）
     * @returns {Promise<Object>} 预测结果
     */
    async function runPrediction(params) {
        if (!window.authHelpers || !window.authHelpers.fetchFunctionJson) {
            throw new Error('认证模块未加载');
        }

        const query = {
            start_date: params.start_date,
            end_date: params.end_date,
        };

        if (params.crowd_name) {
            query.crowd_name = params.crowd_name;
        }

        if (params.scene_id) {
            query.scene_id = params.scene_id;
        }

        const result = await window.authHelpers.fetchFunctionJson('conversion-prediction', {
            method: 'POST',
            body: JSON.stringify(query),
            parseErrorMessage: '预测服务返回了无法解析的响应，请稍后重试',
            onUnauthorized: () => {
                if (window.authHelpers.handleReauthRequired) {
                    window.authHelpers.handleReauthRequired({
                        source: 'conversion-prediction',
                        targetUrl: window.location.href,
                        force: true,
                        reason: 'prediction_reauth_required',
                        delayMs: 1200,
                    });
                }
            },
        });

        return result.data;
    }

    /**
     * 获取场景列表（用于筛选器）
     * @returns {Promise<Array>} 场景列表
     */
    async function fetchScenes() {
        if (!window.authHelpers || !window.authHelpers.fetchFunctionJson) {
            throw new Error('认证模块未加载');
        }

        const result = await window.authHelpers.fetchFunctionJson('conversion-prediction', {
            query: { action: 'list_scenes' },
            parseErrorMessage: '获取场景列表失败',
        });

        return result.data.scenes || [];
    }

    /**
     * 导出预测结果为CSV
     * @param {Array} predictions - 预测结果数组
     * @param {string} filename - 文件名
     */
    function exportToCSV(predictions, filename = '成交预测结果.csv') {
        if (!predictions || predictions.length === 0) {
            console.warn('没有可导出的预测数据');
            return;
        }

        // 构建CSV内容
        const headers = ['日期', '场景', '人群名称', '成交概率', '订单成本', '预测总成本', '置信区间下限', '置信区间上限'];
        const rows = predictions.map(p => [
            p.prediction_date || '',
            p.scene_name || '',
            p.audience_name || '',
            (p.conv_probability * 100).toFixed(2) + '%',
            p.predicted_cost?.toFixed(2) || '',
            p.final_cost?.toFixed(2) || '',
            p.lower_bound?.toFixed(2) || '',
            p.upper_bound?.toFixed(2) || '',
        ]);

        // 添加BOM以支持Excel中文显示
        const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');

        // 创建下载链接
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * 格式化概率显示
     * @param {number} prob - 概率值 0-1
     * @returns {string} 格式化后的概率
     */
    function formatProbability(prob) {
        const percentage = (prob * 100).toFixed(1);
        return `${percentage}%`;
    }

    /**
     * 获取概率等级样式
     * @param {number} prob - 概率值 0-1
     * @returns {string} CSS类名
     */
    function getProbabilityClass(prob) {
        if (prob >= 0.6) return 'prob-high';
        if (prob >= 0.3) return 'prob-medium';
        return 'prob-low';
    }

    return {
        runPrediction,
        fetchScenes,
        exportToCSV,
        formatProbability,
        getProbabilityClass,
    };
})();

// 导出到全局
window.ConversionPredictionApi = ConversionPredictionApi;
