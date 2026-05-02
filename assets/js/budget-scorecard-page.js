/**
 * 人群预算评分卡 — 页面逻辑
 *
 * 核心流程:
 *  1. 调用 dashboard-data API 获取人群数据
 *  2. 按阶段基于加购成本/预售订单成本/订单成本计算成本健康分
 *  3. A/B/C/D/N 分级 + 建议花费占比
 */
(function (window) {
    'use strict';

    var authHelpers = window.authHelpers || {};
    var CONFIG_KEY = 'bs_score_config';
    var STAGE_CONFIG = {
        warmup: {
            label: '预热期',
            costKey: 'cartCost',
            volumeKey: 'cart',
            costLabel: '加购成本',
            volumeLabel: '加购数',
            targetLabel: '目标加购成本',
            targetHint: '期望每个加购的花费（元）',
        },
        presale: {
            label: '预售付定',
            costKey: 'preOrderCost',
            volumeKey: 'preOrders',
            costLabel: '预售订单成本',
            volumeLabel: '预售成交笔数',
            targetLabel: '目标预售订单成本',
            targetHint: '期望每个预售付定订单的花费（元）',
        },
        spot: {
            label: '现货期',
            costKey: 'orderCost',
            volumeKey: 'orders',
            costLabel: '订单成本',
            volumeLabel: '成交笔数',
            targetLabel: '目标订单成本',
            targetHint: '期望每成交一单的花费（元）',
        },
    };

    // 默认评分配置
    var DEFAULT_CONFIG = {
        analysisStage: 'spot',
        targetCosts: {
            warmup: 20,
            presale: 80,
            spot: 80,
        },
        minOrdersForDecision: 5, // 最低成交样本
        gradeAThreshold: 80,    // A级阈值
        gradeBThreshold: 60,    // B级阈值
        gradeCThreshold: 40,    // C级阈值
    };

    // 加载配置
    function loadConfig() {
        try {
            var saved = localStorage.getItem(CONFIG_KEY);
            if (saved) {
                var parsed = JSON.parse(saved);
                var merged = Object.assign({}, DEFAULT_CONFIG, parsed);
                merged.targetCosts = Object.assign({}, DEFAULT_CONFIG.targetCosts, parsed.targetCosts || {});
                if (parsed.orderCostTarget !== undefined && parsed.targetCosts === undefined) {
                    merged.targetCosts.spot = parsed.orderCostTarget;
                }
                if (!STAGE_CONFIG[merged.analysisStage]) merged.analysisStage = DEFAULT_CONFIG.analysisStage;
                return merged;
            }
        } catch (e) {
            console.warn('加载评分配置失败:', e);
        }
        return Object.assign({}, DEFAULT_CONFIG);
    }

    // 保存配置
    function saveConfig(config) {
        try {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        } catch (e) {
            console.warn('保存评分配置失败:', e);
        }
    }

    var scoreConfig = loadConfig();
    var ACTIVE_STAGE = scoreConfig.analysisStage;
    var TARGET_COST = getTargetCost(ACTIVE_STAGE);

    // ── 工具函数 ──

    function toNum(v) {
        return parseFloat(String(v || '').replace(/,/g, '')) || 0;
    }

    function formatMoney(n) {
        if (!isFinite(n)) return '--';
        if (n >= 10000) return '¥' + (n / 10000).toFixed(1) + '万';
        return '¥' + n.toFixed(0);
    }

    function formatPct(n) {
        if (!isFinite(n)) return '--';
        return (n * 100).toFixed(1) + '%';
    }

    function formatDeltaPct(n) {
        if (!isFinite(n)) return '--';
        var pct = n * 100;
        if (Math.abs(pct) < 0.05) return '持平';
        return (pct > 0 ? '+' : '') + pct.toFixed(1) + 'pct';
    }

    function getDeltaClass(n) {
        if (!isFinite(n) || Math.abs(n * 100) < 0.05) return 'neutral';
        return n > 0 ? 'positive' : 'negative';
    }

    function formatInt(n) {
        if (!isFinite(n)) return '--';
        return String(Math.round(n));
    }

    function formatOrderCost(n) {
        if (!isFinite(n) || n <= 0) return '--';
        return formatMoney(n);
    }

    function getStageConfig(stage) {
        return STAGE_CONFIG[stage] || STAGE_CONFIG.spot;
    }

    function getTargetCost(stage) {
        var stageKey = STAGE_CONFIG[stage] ? stage : DEFAULT_CONFIG.analysisStage;
        var value = scoreConfig.targetCosts && scoreConfig.targetCosts[stageKey];
        return isFinite(value) && value > 0 ? value : DEFAULT_CONFIG.targetCosts[stageKey];
    }

    function escapeHtml(v) {
        return String(v || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDateInput(d) {
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function getRelativeDate(offset) {
        var d = new Date();
        d.setHours(12, 0, 0, 0);
        d.setDate(d.getDate() + offset);
        return formatDateInput(d);
    }

    // ── 状态管理 ──

    var state = {
        loading: false,
        startDate: '',
        endDate: '',
        crowdItems: [],
        scoredCrowds: [],
    };

    // ── 评分算法 ──

    /**
     * 成本健康分 = min(目标订单成本 / 实际订单成本, 1.25) / 1.25 × 100
     *
     * 达到目标成本时约为 80 分；成本越低分越高，最高封顶 100。
     */
    function computeCostHealthScore(orderCost, targetCost) {
        if (orderCost <= 0 || targetCost <= 0) return 0;
        var ratio = targetCost / orderCost;
        return Math.min(ratio, 1.25) / 1.25 * 100;
    }

    function getGrade(score, orders, spend) {
        if (spend > 0 && orders <= 0) return 'D';
        if (orders < scoreConfig.minOrdersForDecision) return 'N';
        if (score >= scoreConfig.gradeAThreshold) return 'A';
        if (score >= scoreConfig.gradeBThreshold) return 'B';
        if (score >= scoreConfig.gradeCThreshold) return 'C';
        return 'D';
    }

    function getSuggestedShareMultiplier(item) {
        var minVolume = Math.max(scoreConfig.minOrdersForDecision, 1);
        var confidence = Math.min(item.volume / minVolume, 1);

        switch (item.grade) {
            case 'A':
                return (1.25 + Math.min(Math.max((item.score - scoreConfig.gradeAThreshold) / 100, 0), 0.25)) * (0.9 + confidence * 0.1);
            case 'B':
                return 1;
            case 'C':
                return 0.65;
            case 'D':
                return item.volume <= 0 ? 0.05 : 0.25;
            case 'N':
                return Math.min(0.75, 0.5 + confidence * 0.25);
            default:
                return 1;
        }
    }

    function getActionForSuggestion(item) {
        if (item.grade === 'D' && item.volume <= 0) return '暂停';
        if (item.grade === 'N') return '观察';
        if (item.adjustPct >= 0.02) return '提高占比';
        if (item.adjustPct <= -0.02) return '降低占比';
        return '维持';
    }

    function getActionClassForSuggestion(item) {
        if (item.grade === 'D' && item.volume <= 0) return 'pause';
        if (item.grade === 'N') return 'observe';
        if (item.adjustPct >= 0.02) return 'increase';
        if (item.adjustPct <= -0.02) return 'decrease';
        return 'maintain';
    }

    function applySuggestedSpendShares(scored) {
        var totalWeight = scored.reduce(function (sum, item) {
            item.suggestedWeight = item.spendPct * getSuggestedShareMultiplier(item);
            return sum + item.suggestedWeight;
        }, 0);

        scored.forEach(function (item) {
            item.suggestedSpendPct = totalWeight > 0 ? item.suggestedWeight / totalWeight : item.spendPct;
            item.adjustPct = item.suggestedSpendPct - item.spendPct;
            item.action = getActionForSuggestion(item);
            item.actionClass = getActionClassForSuggestion(item);
        });

        return scored;
    }

    function scoreItems(items, type) {
        var totalSpend = items.reduce(function (s, item) { return s + toNum(item.spend); }, 0);
        if (totalSpend <= 0) return [];
        var stage = getStageConfig(ACTIVE_STAGE);

        var scored = items.map(function (item) {
            var roi = toNum(item.roi);
            var spend = toNum(item.spend);
            var volume = toNum(item[stage.volumeKey]);
            var metricCost = toNum(item[stage.costKey]) || (volume > 0 ? spend / volume : 0);
            var score = computeCostHealthScore(metricCost, TARGET_COST);
            var grade = getGrade(score, volume, spend);
            return {
                id: type + ':' + item.name,
                name: item.name,
                type: type,
                roi: roi,
                spend: spend,
                volume: volume,
                metricCost: metricCost,
                metricCostLabel: stage.costLabel,
                volumeLabel: stage.volumeLabel,
                orders: toNum(item.orders),
                orderCost: toNum(item.orderCost),
                cart: toNum(item.cart),
                cartCost: toNum(item.cartCost),
                preOrders: toNum(item.preOrders),
                preOrderCost: toNum(item.preOrderCost),
                amount: toNum(item.amount),
                spendPct: spend / totalSpend,
                score: score,
                grade: grade,
                action: '--',
                actionClass: '',
            };
        }).sort(function (a, b) { return b.score - a.score; });
        return applySuggestedSpendShares(scored);
    }

    // ── UI 渲染 ──

    function $(id) { return document.getElementById(id); }

    function setStatus(type, text) {
        var el = $('bs-status');
        var badge = $('bs-status-badge');
        var textEl = $('bs-status-text');
        if (!el) return;
        el.style.display = 'flex';
        el.className = 'bs-status' + (type ? ' is-' + type : '');
        badge.textContent = type === 'error' ? '错误' : type === 'success' ? '完成' : type === 'warn' ? '注意' : '处理中';
        textEl.textContent = text || '';
    }

    function hideStatus() {
        var el = $('bs-status');
        if (el) el.style.display = 'none';
    }

    function showContent() {
        ['bs-overview', 'bs-detail-section'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = '';
        });
        var empty = $('bs-empty');
        if (empty) empty.style.display = 'none';
    }

    function hideContent() {
        ['bs-overview', 'bs-detail-section'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = 'none';
        });
        var empty = $('bs-empty');
        if (empty) empty.style.display = '';
    }

    function updateStageCopy() {
        var stage = getStageConfig(ACTIVE_STAGE);
        var targetLabel = $('cfg-target-label');
        var targetHint = $('cfg-target-hint');
        var targetInput = $('cfg-target-cost');
        var minVolumeLabel = $('cfg-min-volume-label');
        var minVolumeHint = $('cfg-min-volume-hint');
        var overviewTitle = $('bs-overview-title');
        var volumeTh = $('bs-volume-th');
        var costTh = $('bs-cost-th');

        if (targetLabel) targetLabel.textContent = stage.targetLabel;
        if (targetHint) targetHint.textContent = stage.targetHint;
        if (targetInput) targetInput.value = getTargetCost(ACTIVE_STAGE);
        if (minVolumeLabel) minVolumeLabel.textContent = '最低样本量（' + stage.volumeLabel + '）';
        if (minVolumeHint) minVolumeHint.textContent = '低于该样本量标记为观察';
        if (overviewTitle) overviewTitle.textContent = stage.label + '人群成本健康总览';
        if (volumeTh) volumeTh.textContent = stage.volumeLabel;
        if (costTh) costTh.textContent = stage.costLabel;
    }

    function renderOverview(scored) {
        var counts = { A: 0, B: 0, C: 0, D: 0, N: 0 };
        var spends = { A: 0, B: 0, C: 0, D: 0, N: 0 };
        var total = scored.length;

        scored.forEach(function (s) {
            if (!Object.prototype.hasOwnProperty.call(counts, s.grade)) return;
            counts[s.grade]++;
            spends[s.grade] += s.spend;
        });

        var totalSpend = scored.reduce(function (sum, s) { return sum + s.spend; }, 0);

        ['A', 'B', 'C', 'D', 'N'].forEach(function (grade) {
            var countEl = $('grade-' + grade.toLowerCase() + '-count');
            var pctEl = $('grade-' + grade.toLowerCase() + '-pct');
            if (countEl) countEl.textContent = counts[grade];
            if (pctEl) pctEl.textContent = total > 0 ? (counts[grade] / total * 100).toFixed(0) + '%' : '0%';
        });

        var bar = $('bs-budget-bar');
        if (bar) {
            bar.innerHTML = '';
            ['A', 'B', 'C', 'D', 'N'].forEach(function (grade) {
                if (spends[grade] <= 0) return;
                var seg = document.createElement('div');
                seg.className = 'bs-budget-bar-seg grade-' + grade.toLowerCase();
                seg.style.width = totalSpend > 0 ? (spends[grade] / totalSpend * 100) + '%' : '0%';
                seg.title = grade + ' 级花费 ' + formatMoney(spends[grade]);
                bar.appendChild(seg);
            });
        }
    }

    function renderScoreTable(scored) {
        var tbody = $('bs-score-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (scored.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--gray-400);padding:var(--space-6);">暂无数据</td></tr>';
            return;
        }

        scored.forEach(function (s) {
            var tr = document.createElement('tr');
            var scorePct = Math.min(s.score, 100);
            tr.innerHTML =
                '<td class="bs-td-grade"><span class="bs-grade-badge ' + s.grade.toLowerCase() + '">' + s.grade + '</span></td>' +
                '<td>' + escapeHtml(s.name) + '</td>' +
                '<td class="bs-td-num">' + formatMoney(s.spend) + '</td>' +
                '<td class="bs-td-num">' + formatPct(s.spendPct) + '</td>' +
                '<td class="bs-td-num bs-td-suggested-share">' + formatPct(s.suggestedSpendPct) + '</td>' +
                '<td class="bs-td-num bs-td-delta ' + getDeltaClass(s.adjustPct) + '">' + formatDeltaPct(s.adjustPct) + '</td>' +
                '<td class="bs-td-num">' + formatInt(s.volume) + '</td>' +
                '<td class="bs-td-num">' + formatOrderCost(s.metricCost) + '</td>' +
                '<td class="bs-td-num"><span class="bs-score-bar"><span class="bs-score-bar-track"><span class="bs-score-bar-fill ' + s.grade.toLowerCase() + '" style="width:' + scorePct + '%"></span></span> ' + s.score.toFixed(1) + '</span></td>' +
                '<td class="bs-td-action"><span class="bs-action-label ' + s.actionClass + '">' + s.action + '</span></td>';
            tbody.appendChild(tr);
        });
    }

    // ── 数据获取 ──

    async function fetchScorecardData(startDate, endDate) {
        var result;
        try {
            result = await authHelpers.fetchFunctionJson('dashboard-data', {
                query: {
                    start_date: startDate,
                    end_date: endDate,
                    sections: 'crowd',
                    force_raw_crowd: '1',
                    crowd_plan_name_includes: '规则',
                },
                parseErrorMessage: '数据接口返回了无法解析的响应',
                onUnauthorized: function () {
                    setStatus('error', '登录状态已失效，请重新登录');
                },
            });
        } catch (e) {
            setStatus('error', '请求失败：' + (e.message || '请稍后重试'));
            return null;
        }
        if (!result) return null;
        return result.data ? result.data : null;
    }

    // ── 主流程 ──

    async function loadAndScore() {
        var startEl = $('bs-start');
        var endEl = $('bs-end');
        var startDate = startEl ? startEl.value : '';
        var endDate = endEl ? endEl.value : '';

        if (!startDate || !endDate) {
            setStatus('warn', '请选择日期范围');
            return;
        }
        if (startDate > endDate) {
            setStatus('warn', '开始日期不能晚于结束日期');
            return;
        }

        state.startDate = startDate;
        state.endDate = endDate;
        state.loading = true;
        setStatus('', '正在加载数据并计算评分...');

        try {
            var data = await fetchScorecardData(startDate, endDate);
            if (!data) {
                hideContent();
                return;
            }

            // 解析人群数据
            var crowdRaw = data && data.crowd && data.crowd.summary ? data.crowd.summary : [];
            state.crowdItems = [];
            crowdRaw.forEach(function (group) {
                if (group.crowd && group.summary) {
                    state.crowdItems.push({
                        name: group.crowd,
                        roi: toNum(group.summary.roi),
                        spend: toNum(group.summary.cost || group.summary['花费']),
                        orders: toNum(group.summary.orders),
                        orderCost: toNum(group.summary.orderCost),
                        cart: toNum(group.summary.cart),
                        cartCost: toNum(group.summary.cartCost),
                        preOrders: toNum(group.summary.preOrders),
                        preOrderCost: toNum(group.summary.preOrderCost),
                        amount: toNum(group.summary.amount),
                    });
                }
                if (group.subRows && group.subRows.length > 0) {
                    group.subRows.forEach(function (sub) {
                        state.crowdItems.push({
                            name: sub.label || sub.name || '未命名人群',
                            roi: toNum(sub.roi),
                            spend: toNum(sub.cost || sub['花费']),
                            orders: toNum(sub.orders),
                            orderCost: toNum(sub.orderCost),
                            cart: toNum(sub.cart),
                            cartCost: toNum(sub.cartCost),
                            preOrders: toNum(sub.preOrders),
                            preOrderCost: toNum(sub.preOrderCost),
                            amount: toNum(sub.amount),
                        });
                    });
                }
            });
            state.crowdItems = state.crowdItems.filter(function (item) { return item.spend > 0; });

            // 评分
            state.scoredCrowds = scoreItems(state.crowdItems, 'crowd');

            // 渲染
            showContent();
            renderActiveTab();
            setStatus('success', '评分完成，共 ' + state.scoredCrowds.length + ' 个人群单元');
        } catch (err) {
            setStatus('error', '数据加载失败：' + (err.message || '请稍后重试'));
            hideContent();
        } finally {
            state.loading = false;
        }
    }

    function renderActiveTab() {
        updateStageCopy();
        var scored = state.scoredCrowds;
        renderOverview(scored);
        renderScoreTable(scored);
    }

    // ── 事件绑定 ──

    function initDatePresets() {
        var presets = {
            yesterday: function () { var d = getRelativeDate(-1); return { start: d, end: d }; },
            last7: function () { return { start: getRelativeDate(-7), end: getRelativeDate(-1) }; },
            thisMonth: function () {
                var d = new Date();
                return { start: formatDateInput(new Date(d.getFullYear(), d.getMonth(), 1)), end: formatDateInput(d) };
            },
        };

        var btns = document.querySelectorAll('.bs-preset-btn');
        btns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                btns.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var p = presets[btn.dataset.preset];
                if (p) {
                    var range = p();
                    var startEl2 = $('bs-start');
                    var endEl2 = $('bs-end');
                    if (startEl2) startEl2.value = range.start;
                    if (endEl2) endEl2.value = range.end;
                }
            });
        });

        // 默认本月
        var thisMonthRange = presets.thisMonth();
        var startEl3 = $('bs-start');
        var endEl3 = $('bs-end');
        if (startEl3) startEl3.value = thisMonthRange.start;
        if (endEl3) endEl3.value = thisMonthRange.end;
    }

    function initLoadButton() {
        var btn = $('bs-load-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            if (state.loading) return;
            loadAndScore();
        });
    }

    function initExport() {
        var btn = $('bs-export-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var scored = state.scoredCrowds;
            if (scored.length === 0) return;

            var stage = getStageConfig(ACTIVE_STAGE);
            var header = '阶段,等级,人群,花费,当前花费占比,建议花费占比,调整幅度,' + stage.volumeLabel + ',' + stage.costLabel + ',成本健康分,ROI,建议动作\n';
            var rows = scored.map(function (s) {
                return [
                    stage.label,
                    s.grade,
                    '"' + String(s.name).replace(/"/g, '""') + '"',
                    s.spend.toFixed(2),
                    (s.spendPct * 100).toFixed(1) + '%',
                    (s.suggestedSpendPct * 100).toFixed(1) + '%',
                    formatDeltaPct(s.adjustPct),
                    s.volume.toFixed(0),
                    s.metricCost.toFixed(2),
                    s.score.toFixed(1),
                    s.roi.toFixed(4),
                    s.action,
                ].join(',');
            }).join('\n');

            var csv = '\uFEFF' + header + rows;
            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'budget_scorecard_' + state.startDate + '_' + state.endDate + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    // ── 配置面板 ──

    function applyConfig(newConfig) {
        scoreConfig = newConfig;
        ACTIVE_STAGE = newConfig.analysisStage;
        TARGET_COST = getTargetCost(ACTIVE_STAGE);
        saveConfig(newConfig);
        updateStageCopy();
    }

    // 基于当前已加载数据重新计算(不重新请求API)
    function recomputeScores() {
        var hasData = false;
        if (state.crowdItems && state.crowdItems.length > 0) {
            state.scoredCrowds = scoreItems(state.crowdItems, 'crowd');
            hasData = true;
        }
        if (hasData) {
            renderActiveTab();
            return true;
        }
        return false;
    }

    function initConfigPanel() {
        var toggle = $('bs-config-toggle');
        var body = $('bs-config-body');
        var section = $('bs-config-section');
        var saveBtn = $('bs-config-save');
        var resetBtn = $('bs-config-reset');
        var stageInput = $('cfg-analysis-stage');
        var targetCostInput = $('cfg-target-cost');
        var minOrdersInput = $('cfg-min-orders');
        var aInput = $('cfg-grade-a');
        var bInput = $('cfg-grade-b');
        var cInput = $('cfg-grade-c');

        if (!toggle || !body || !section) {
            console.warn('[budget-scorecard] 配置面板DOM元素未找到');
            return;
        }

        // 填充当前配置
        if (stageInput) stageInput.value = ACTIVE_STAGE;
        updateStageCopy();
        if (minOrdersInput) minOrdersInput.value = scoreConfig.minOrdersForDecision;
        if (aInput) aInput.value = scoreConfig.gradeAThreshold;
        if (bInput) bInput.value = scoreConfig.gradeBThreshold;
        if (cInput) cInput.value = scoreConfig.gradeCThreshold;

        // 展开/收起 (只响应 header 点击,避免冒泡问题)
        toggle.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var isExpanded = section.classList.toggle('expanded');
            body.style.display = isExpanded ? '' : 'none';
        });

        if (stageInput) {
            stageInput.addEventListener('change', function () {
                var nextStage = STAGE_CONFIG[stageInput.value] ? stageInput.value : DEFAULT_CONFIG.analysisStage;
                var nextConfig = Object.assign({}, scoreConfig, {
                    analysisStage: nextStage,
                    targetCosts: Object.assign({}, scoreConfig.targetCosts),
                });
                applyConfig(nextConfig);
                recomputeScores();
                setStatus('success', '已切换到' + getStageConfig(nextStage).label + '，评分口径已更新');
                setTimeout(hideStatus, 2500);
            });
        }

        // 保存配置并重新计算
        if (saveBtn) {
            saveBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();

                var selectedStage = stageInput && STAGE_CONFIG[stageInput.value] ? stageInput.value : ACTIVE_STAGE;
                var targetCostValue = parseFloat(targetCostInput.value);
                var minOrdersValue = parseInt(minOrdersInput.value, 10);
                var gradeAValue = parseInt(aInput.value, 10);
                var gradeBValue = parseInt(bInput.value, 10);
                var gradeCValue = parseInt(cInput.value, 10);
                var nextTargetCosts = Object.assign({}, scoreConfig.targetCosts);
                nextTargetCosts[selectedStage] = isFinite(targetCostValue) ? targetCostValue : getTargetCost(selectedStage);
                var newConfig = {
                    analysisStage: selectedStage,
                    targetCosts: nextTargetCosts,
                    minOrdersForDecision: isFinite(minOrdersValue) ? minOrdersValue : 5,
                    gradeAThreshold: isFinite(gradeAValue) ? gradeAValue : 80,
                    gradeBThreshold: isFinite(gradeBValue) ? gradeBValue : 60,
                    gradeCThreshold: isFinite(gradeCValue) ? gradeCValue : 40,
                };

                // 验证阈值逻辑
                if (newConfig.gradeAThreshold <= newConfig.gradeBThreshold) {
                    setStatus('error', 'A级阈值必须大于B级阈值');
                    return;
                }
                if (newConfig.gradeBThreshold <= newConfig.gradeCThreshold) {
                    setStatus('error', 'B级阈值必须大于C级阈值');
                    return;
                }
                if (newConfig.targetCosts[selectedStage] <= 0) {
                    setStatus('error', getStageConfig(selectedStage).targetLabel + '必须大于 0');
                    return;
                }
                if (newConfig.minOrdersForDecision <= 0) {
                    setStatus('error', '最低样本量必须大于 0');
                    return;
                }

                applyConfig(newConfig);

                // 如果已有数据,立即重新计算
                var recomputed = recomputeScores();
                if (recomputed) {
                    setStatus('success', '配置已保存，评分已按新标准重新计算');
                } else {
                    setStatus('success', '配置已保存，点击"计算评分"按新标准生成结果');
                }
                setTimeout(hideStatus, 3500);
            });
        }

        // 恢复默认
        if (resetBtn) {
            resetBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();

                applyConfig(Object.assign({}, DEFAULT_CONFIG));

                if (stageInput) stageInput.value = DEFAULT_CONFIG.analysisStage;
                if (targetCostInput) targetCostInput.value = DEFAULT_CONFIG.targetCosts[DEFAULT_CONFIG.analysisStage];
                if (minOrdersInput) minOrdersInput.value = DEFAULT_CONFIG.minOrdersForDecision;
                if (aInput) aInput.value = DEFAULT_CONFIG.gradeAThreshold;
                if (bInput) bInput.value = DEFAULT_CONFIG.gradeBThreshold;
                if (cInput) cInput.value = DEFAULT_CONFIG.gradeCThreshold;

                var recomputed = recomputeScores();
                if (recomputed) {
                    setStatus('success', '已恢复默认配置，评分已重新计算');
                } else {
                    setStatus('success', '已恢复默认配置');
                }
                setTimeout(hideStatus, 3500);
            });
        }
    }

    // ── 初始化 ──

    document.addEventListener('DOMContentLoaded', function () {
        initConfigPanel();
        initDatePresets();
        initLoadButton();
        initExport();
    });

})(window);
