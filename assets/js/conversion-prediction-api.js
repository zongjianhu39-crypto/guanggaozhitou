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
     * 运行货盘人群推荐
     * @param {Object} params - 推荐参数
     * @param {string} params.prediction_date - 推荐日期 YYYY-MM-DD
     * @param {string} [params.scene_name] - 场景名称
     * @param {number} [params.top_n] - 返回数量
     * @param {Array<Object>} params.product_items - 当天货盘商品列表
     * @returns {Promise<Object>} 推荐结果
     */
    async function runRecommendation(params) {
        if (!window.authHelpers || !window.authHelpers.fetchFunctionJson) {
            throw new Error('认证模块未加载');
        }

        const payload = {
            action: 'recommend',
            prediction_date: params.prediction_date,
            scene_name: params.scene_name || undefined,
            top_n: params.top_n || 20,
            target_cpo: params.target_cpo,
            total_budget: params.total_budget,
            product_items: params.product_items || [],
            strategy: params.strategy || 'greedy',
        };

        try {
            const result = await window.authHelpers.fetchFunctionJson('conversion-prediction', {
                method: 'POST',
                body: JSON.stringify(payload),
                parseErrorMessage: '推荐服务返回了无法解析的响应，请稍后重试',
                onUnauthorized: () => {
                    if (window.authHelpers.handleReauthRequired) {
                        window.authHelpers.handleReauthRequired({
                            source: 'conversion-recommendation',
                            targetUrl: window.location.href,
                            force: true,
                            reason: 'recommendation_reauth_required',
                            delayMs: 1200,
                        });
                    }
                },
            });

            return result.data;
        } catch (error) {
            console.warn('Supabase推荐通道不可用，尝试本机模型服务:', error);
            return await runLocalRecommendation(payload);
        }
    }

    async function runLocalRecommendation(payload) {
        const localPayload = { ...payload };
        delete localPayload.action;

        const response = await fetch('http://127.0.0.1:8001/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localPayload),
        });

        if (!response.ok) {
            const message = await response.text().catch(() => '');
            throw new Error(`本机模型服务不可用：${response.status} ${message}`);
        }

        const data = await response.json();
        if (!data || data.success === false) {
            throw new Error(data?.message || data?.error || '本机模型服务返回异常');
        }
        return data;
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
    function exportToCSV(records, filename = '货盘人群推荐.csv') {
        if (!records || records.length === 0) {
            console.warn('没有可导出的数据');
            return;
        }

        let headers;
        let rows;
        if (records[0] && Object.prototype.hasOwnProperty.call(records[0], 'recommended_budget')) {
            headers = ['排名', '人群名称', '场景', '推荐等级', '建议预算', '可承接预算', '测算CPO', '边际CPO', 'CPO区间', '置信度', '建议动作', '推荐理由'];
            rows = records.map(item => [
                item.rank || '',
                item.crowd_name || '',
                item.scene_name || '',
                item.recommendation_level || '',
                item.recommended_budget ?? '',
                item.budget_capacity ?? '',
                item.estimated_cpo ?? '',
                item.marginal_cpo ?? '',
                `${item.cpo_low ?? ''}-${item.cpo_high ?? ''}`,
                item.confidence != null ? `${(item.confidence * 100).toFixed(1)}%` : '',
                item.suggested_action || recommendationAction(item.recommendation_level),
                Array.isArray(item.reasons) ? item.reasons.join('；') : '',
            ]);
        } else if (records[0] && Object.prototype.hasOwnProperty.call(records[0], 'match_score')) {
            headers = ['排名', '人群名称', '场景', '推荐等级', '匹配分', '置信度', '建议动作', '推荐理由'];
            rows = records.map(item => [
                item.rank || '',
                item.crowd_name || '',
                item.scene_name || '',
                item.recommendation_level || '',
                item.match_score ?? '',
                item.confidence != null ? `${(item.confidence * 100).toFixed(1)}%` : '',
                item.suggested_action || recommendationAction(item.recommendation_level),
                Array.isArray(item.reasons) ? item.reasons.join('；') : '',
            ]);
        } else {
            headers = ['日期', '场景', '人群名称', '成交概率', '订单成本', '预测总成本', '置信区间下限', '置信区间上限'];
            rows = records.map(p => [
                p.prediction_date || '',
                p.scene_name || '',
                p.audience_name || '',
                (p.conv_probability * 100).toFixed(2) + '%',
                p.predicted_cost?.toFixed(2) || '',
                p.final_cost?.toFixed(2) || '',
                p.lower_bound?.toFixed(2) || '',
                p.upper_bound?.toFixed(2) || '',
            ]);
        }

        // 添加BOM以支持Excel中文显示
        const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\n');

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

    function escapeCsvCell(value) {
        const text = String(value ?? '');
        if (/[",\n\r]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    function recommendationAction(level) {
        if (level === '强推') return '优先放入首轮测试';
        if (level === '优先测试') return '正常预算测试';
        if (level === '小预算测试') return '小预算探测';
        return '观察备用';
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
        runRecommendation,
        fetchScenes,
        exportToCSV,
        formatProbability,
        getProbabilityClass,
    };
})();

// 导出到全局
window.ConversionPredictionApi = ConversionPredictionApi;
