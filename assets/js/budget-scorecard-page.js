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
    var SNAPSHOT_KEY = 'bs_suggestion_snapshots';
    var MAX_SNAPSHOTS = 20;
    var REVIEW_ROW_LIMIT = 8;
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
        budgetAllocationRatio: 0.3, // 默认只分配万相台计划的 30%
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

    function getCostChangeClass(n) {
        if (!isFinite(n) || Math.abs(n) < 0.005) return 'neutral';
        return n <= 0 ? 'positive' : 'negative';
    }

    function formatRelativeChange(n) {
        if (!isFinite(n)) return '--';
        if (Math.abs(n) < 0.005) return '持平';
        return (n > 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
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

    function formatDateTime(ts) {
        var d = new Date(ts);
        if (!isFinite(d.getTime())) return '--';
        return formatDateInput(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function getItemKey(item) {
        return String(item.planName || '未标注计划') + '\u0001' + String(item.name || '未命名人群');
    }

    function loadSuggestionSnapshots() {
        try {
            var raw = localStorage.getItem(SNAPSHOT_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.warn('加载建议快照失败:', e);
            return [];
        }
    }

    function saveSuggestionSnapshots() {
        try {
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state.suggestionSnapshots.slice(0, MAX_SNAPSHOTS)));
            return true;
        } catch (e) {
            console.warn('保存建议快照失败:', e);
            return false;
        }
    }

    // ── 状态管理 ──

    var state = {
        loading: false,
        startDate: '',
        endDate: '',
        crowdItems: [],
        scoredCrowds: [],
        budgetDate: '',
        wanxiangPlan: null,
        allocatableBudget: 0,
        planAllocations: [],
        suggestionSnapshots: loadSuggestionSnapshots(),
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

    function getTomorrowDate() {
        return getRelativeDate(1);
    }

    function normalizeBudgetRatio(value) {
        var numeric = parseFloat(value);
        if (!isFinite(numeric)) return DEFAULT_CONFIG.budgetAllocationRatio;
        if (numeric < 0) return 0;
        if (numeric > 1) return 1;
        return Math.round(numeric * 100) / 100;
    }

    function getBudgetRatio() {
        return normalizeBudgetRatio(scoreConfig.budgetAllocationRatio);
    }

    function setBudgetRatioInputs(value) {
        var ratio = normalizeBudgetRatio(value);
        ['bs-budget-ratio', 'cfg-budget-ratio'].forEach(function (id) {
            var input = $(id);
            if (input) input.value = ratio;
        });
    }

    function getSuggestedBudgetAmount(item) {
        var budget = toNum(state.allocatableBudget);
        return budget > 0 && isFinite(item.suggestedSpendPct) ? budget * item.suggestedSpendPct : 0;
    }

    function applySuggestedBudgetAmounts(scored) {
        scored.forEach(function (item) {
            item.suggestedBudgetAmount = getSuggestedBudgetAmount(item);
        });
        return scored;
    }

    function buildPlanAllocations(scored) {
        var byPlan = {};
        scored.forEach(function (item) {
            var key = item.planName || '未标注计划';
            if (!byPlan[key]) {
                byPlan[key] = {
                    planName: key,
                    suggestedSpendPct: 0,
                    suggestedBudgetAmount: 0,
                    crowdCount: 0,
                };
            }
            byPlan[key].suggestedSpendPct += toNum(item.suggestedSpendPct);
            byPlan[key].suggestedBudgetAmount += toNum(item.suggestedBudgetAmount);
            byPlan[key].crowdCount += 1;
        });
        return Object.keys(byPlan).map(function (key) {
            return byPlan[key];
        }).sort(function (a, b) {
            return b.suggestedBudgetAmount - a.suggestedBudgetAmount;
        });
    }

    function updateBudgetAllocations() {
        var ratio = getBudgetRatio();
        var wanxiangPlan = toNum(state.wanxiangPlan);
        state.allocatableBudget = wanxiangPlan * ratio;
        applySuggestedBudgetAmounts(state.scoredCrowds);
        state.planAllocations = buildPlanAllocations(state.scoredCrowds);
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
                id: type + ':' + (item.planName || '') + ':' + item.name,
                name: item.name,
                planName: item.planName || '未标注计划',
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
        return applySuggestedBudgetAmounts(applySuggestedSpendShares(scored));
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
        ['bs-overview', 'bs-allocation-section', 'bs-detail-section'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = '';
        });
        var empty = $('bs-empty');
        if (empty) empty.style.display = 'none';
    }

    function hideContent() {
        ['bs-overview', 'bs-allocation-section', 'bs-detail-section', 'bs-review-section'].forEach(function (id) {
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
            tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--gray-400);padding:var(--space-6);">暂无数据</td></tr>';
            return;
        }

        scored.forEach(function (s) {
            var tr = document.createElement('tr');
            var scorePct = Math.min(s.score, 100);
            tr.innerHTML =
                '<td class="bs-td-grade"><span class="bs-grade-badge ' + s.grade.toLowerCase() + '">' + s.grade + '</span></td>' +
                '<td class="bs-td-plan">' + escapeHtml(s.planName) + '</td>' +
                '<td>' + escapeHtml(s.name) + '</td>' +
                '<td class="bs-td-num">' + formatMoney(s.spend) + '</td>' +
                '<td class="bs-td-num">' + formatPct(s.spendPct) + '</td>' +
                '<td class="bs-td-num bs-td-suggested-share">' + formatPct(s.suggestedSpendPct) + '</td>' +
                '<td class="bs-td-num bs-td-suggested-amount">' + formatMoney(s.suggestedBudgetAmount) + '</td>' +
                '<td class="bs-td-num bs-td-delta ' + getDeltaClass(s.adjustPct) + '">' + formatDeltaPct(s.adjustPct) + '</td>' +
                '<td class="bs-td-num">' + formatInt(s.volume) + '</td>' +
                '<td class="bs-td-num">' + formatOrderCost(s.metricCost) + '</td>' +
                '<td class="bs-td-num"><span class="bs-score-bar"><span class="bs-score-bar-track"><span class="bs-score-bar-fill ' + s.grade.toLowerCase() + '" style="width:' + scorePct + '%"></span></span> ' + s.score.toFixed(1) + '</span></td>' +
                '<td class="bs-td-action"><span class="bs-action-label ' + s.actionClass + '">' + s.action + '</span></td>';
            tbody.appendChild(tr);
        });
    }

    function renderAllocationPanel() {
        var budgetDateInput = $('bs-budget-date');
        var wanxiangEl = $('bs-wanxiang-plan');
        var ratioDisplay = $('bs-budget-ratio-display');
        var allocatableEl = $('bs-allocatable-budget');
        var planCountEl = $('bs-plan-count');
        var hint = $('bs-allocation-hint');
        var tbody = $('bs-plan-allocation-tbody');
        var ratio = getBudgetRatio();

        if (budgetDateInput && !budgetDateInput.value) budgetDateInput.value = state.budgetDate || getTomorrowDate();
        setBudgetRatioInputs(ratio);
        if (wanxiangEl) wanxiangEl.textContent = state.wanxiangPlan === null ? '--' : formatMoney(state.wanxiangPlan);
        if (ratioDisplay) ratioDisplay.textContent = formatPct(ratio);
        if (allocatableEl) allocatableEl.textContent = state.wanxiangPlan === null ? '--' : formatMoney(state.allocatableBudget);
        if (planCountEl) planCountEl.textContent = String(state.planAllocations.length || 0);
        if (hint) {
            var budgetDate = state.budgetDate || (budgetDateInput ? budgetDateInput.value : '');
            hint.textContent = state.wanxiangPlan === null
                ? '预算日期 ' + budgetDate + ' 暂未读取到万相台计划；评分占比仍可查看。'
                : '预算日期 ' + budgetDate + '，按万相台计划 × ' + formatPct(ratio) + ' 计算可分配预算。';
        }
        if (!tbody) return;
        if (!state.planAllocations.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:var(--space-4);">暂无计划分配数据</td></tr>';
            return;
        }
        tbody.innerHTML = state.planAllocations.map(function (row) {
            return '<tr>' +
                '<td class="bs-td-plan">' + escapeHtml(row.planName) + '</td>' +
                '<td class="bs-td-num">' + formatPct(row.suggestedSpendPct) + '</td>' +
                '<td class="bs-td-num bs-td-suggested-amount">' + formatMoney(row.suggestedBudgetAmount) + '</td>' +
                '<td class="bs-td-num">' + formatInt(row.crowdCount) + '</td>' +
                '</tr>';
        }).join('');
    }

    function buildScoreIndex(scored) {
        return scored.reduce(function (map, item) {
            map[getItemKey(item)] = item;
            return map;
        }, {});
    }

    function getReviewStatus(beforePct, suggestedPct, currentPct) {
        var targetMove = suggestedPct - beforePct;
        if (!isFinite(targetMove) || Math.abs(targetMove) < 0.005) {
            return { label: '建议维持', className: 'neutral', progress: 0 };
        }
        var progress = (currentPct - beforePct) / targetMove;
        if (progress >= 0.8) return { label: '基本到位', className: 'good', progress: progress };
        if (progress >= 0.35) return { label: '部分执行', className: 'warn', progress: progress };
        if (progress < -0.2) return { label: '反向变化', className: 'bad', progress: progress };
        return { label: '未明显执行', className: 'neutral', progress: progress };
    }

    function getReviewEffect(snapshotItem, currentItem, status) {
        if (!currentItem) return { label: '当前未匹配', className: 'neutral', costChange: null };

        var beforeCost = toNum(snapshotItem.metricCost);
        var currentCost = toNum(currentItem.metricCost);
        var costChange = beforeCost > 0 && currentCost > 0 ? (currentCost - beforeCost) / beforeCost : null;
        var action = snapshotItem.action || '';

        if (status.className === 'neutral' && status.label === '未明显执行') {
            return { label: '待执行验证', className: 'neutral', costChange: costChange };
        }

        if (action === '提高占比') {
            if (costChange !== null && costChange <= 0.1) {
                return { label: '放量稳定', className: 'good', costChange: costChange };
            }
            return { label: '放量后成本变差', className: 'bad', costChange: costChange };
        }

        if (action === '降低占比' || action === '暂停') {
            if (costChange !== null && costChange <= 0) {
                return { label: '控量且成本改善', className: 'good', costChange: costChange };
            }
            return { label: '已控量待看承接', className: 'warn', costChange: costChange };
        }

        if (action === '观察') {
            if (currentItem.grade !== 'N') {
                return { label: '样本已补足', className: 'good', costChange: costChange };
            }
            return { label: '继续观察', className: 'neutral', costChange: costChange };
        }

        if (costChange !== null && Math.abs(costChange) <= 0.1) {
            return { label: '维持稳定', className: 'good', costChange: costChange };
        }
        return { label: '出现波动', className: 'warn', costChange: costChange };
    }

    function getSnapshotReviewRows(snapshot, currentIndex) {
        return (snapshot.items || []).map(function (item) {
            var current = currentIndex[getItemKey(item)];
            var status = current
                ? getReviewStatus(toNum(item.spendPct), toNum(item.suggestedSpendPct), toNum(current.spendPct))
                : { label: '当前未匹配', className: 'neutral', progress: 0 };
            var effect = getReviewEffect(item, current, status);
            return {
                snapshotItem: item,
                currentItem: current,
                status: status,
                effect: effect,
            };
        }).sort(function (a, b) {
            return Math.abs(toNum(b.snapshotItem.adjustPct)) - Math.abs(toNum(a.snapshotItem.adjustPct));
        });
    }

    function renderSnapshotReviews() {
        var section = $('bs-review-section');
        var list = $('bs-review-list');
        var hint = $('bs-review-hint');
        if (!section || !list) return;

        var currentIndex = buildScoreIndex(state.scoredCrowds);
        var snapshots = state.suggestionSnapshots
            .filter(function (snapshot) { return snapshot.stage === ACTIVE_STAGE; })
            .slice(0, 5);

        if (state.scoredCrowds.length === 0 || snapshots.length === 0) {
            section.style.display = 'none';
            list.innerHTML = '';
            return;
        }

        section.style.display = '';
        if (hint) {
            hint.textContent = '当前对比区间：' + state.startDate + ' 至 ' + state.endDate + '；仅展示' + getStageConfig(ACTIVE_STAGE).label + '快照。';
        }

        list.innerHTML = '';
        snapshots.forEach(function (snapshot) {
            var rows = getSnapshotReviewRows(snapshot, currentIndex);
            var matchedCount = rows.filter(function (row) { return Boolean(row.currentItem); }).length;
            var movedCount = rows.filter(function (row) { return row.status.className === 'good' || row.status.className === 'warn'; }).length;
            var goodCount = rows.filter(function (row) { return row.effect.className === 'good'; }).length;
            var visibleRows = rows.slice(0, REVIEW_ROW_LIMIT);

            var tableRows = visibleRows.map(function (row) {
                var before = row.snapshotItem;
                var current = row.currentItem;
                return '<tr>' +
                    '<td class="bs-td-plan">' + escapeHtml(before.planName) + '</td>' +
                    '<td>' + escapeHtml(before.name) + '</td>' +
                    '<td class="bs-td-num">' + formatPct(before.spendPct) + '</td>' +
                    '<td class="bs-td-num bs-td-suggested-share">' + formatPct(before.suggestedSpendPct) + '</td>' +
                    '<td class="bs-td-num">' + (current ? formatPct(current.spendPct) : '--') + '</td>' +
                    '<td class="bs-td-num">' + formatOrderCost(before.metricCost) + '</td>' +
                    '<td class="bs-td-num">' + (current ? formatOrderCost(current.metricCost) : '--') + '</td>' +
                    '<td class="bs-td-num bs-td-delta ' + (row.effect.costChange === null ? 'neutral' : getCostChangeClass(row.effect.costChange)) + '">' + (row.effect.costChange === null ? '--' : formatRelativeChange(row.effect.costChange)) + '</td>' +
                    '<td><span class="bs-review-pill ' + row.status.className + '">' + escapeHtml(row.status.label) + '</span></td>' +
                    '<td><span class="bs-review-pill ' + row.effect.className + '">' + escapeHtml(row.effect.label) + '</span></td>' +
                '</tr>';
            }).join('');

            var card = document.createElement('div');
            card.className = 'bs-review-card';
            card.innerHTML =
                '<div class="bs-review-card-header">' +
                    '<div>' +
                        '<div class="bs-review-title">' + escapeHtml(snapshot.stageLabel) + '建议快照</div>' +
                        '<div class="bs-review-meta">保存于 ' + escapeHtml(formatDateTime(snapshot.createdAt)) + ' · 建议区间 ' + escapeHtml(snapshot.startDate) + ' 至 ' + escapeHtml(snapshot.endDate) + '</div>' +
                    '</div>' +
                    '<div class="bs-review-summary">' +
                        '<span>匹配 ' + matchedCount + '/' + rows.length + '</span>' +
                        '<span>有执行迹象 ' + movedCount + '</span>' +
                        '<span>表现稳定/改善 ' + goodCount + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="bs-table-wrap bs-review-table-wrap">' +
                    '<table class="bs-table bs-review-table">' +
                        '<thead><tr>' +
                            '<th>计划</th>' +
                            '<th>人群</th>' +
                            '<th class="bs-th-num">建议时占比</th>' +
                            '<th class="bs-th-num">建议占比</th>' +
                            '<th class="bs-th-num">当前占比</th>' +
                            '<th class="bs-th-num">建议时成本</th>' +
                            '<th class="bs-th-num">当前成本</th>' +
                            '<th class="bs-th-num">成本变化</th>' +
                            '<th>执行判断</th>' +
                            '<th>效果判断</th>' +
                        '</tr></thead>' +
                        '<tbody>' + (tableRows || '<tr><td colspan="10" style="text-align:center;color:var(--gray-400);padding:var(--space-4);">暂无可复盘明细</td></tr>') + '</tbody>' +
                    '</table>' +
                '</div>';
            list.appendChild(card);
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

    async function fetchPlanBudgetData(budgetDate) {
        var result;
        try {
            result = await authHelpers.fetchFunctionJson('plan-dashboard-summary', {
                query: {
                    start: budgetDate,
                    end: budgetDate,
                },
                includePromptAdminToken: true,
                useSessionToken: true,
                parseErrorMessage: '计划预算接口返回了无法解析的响应',
                onUnauthorized: function () {
                    setStatus('error', '登录状态已失效，请重新登录');
                },
            });
        } catch (e) {
            console.warn('读取计划预算失败:', e);
            return null;
        }
        return result && result.data ? result.data : null;
    }

    async function refreshPlanBudget(options) {
        options = options || {};
        var budgetDateInput = $('bs-budget-date');
        var ratioInput = $('bs-budget-ratio');
        var budgetDate = budgetDateInput && budgetDateInput.value ? budgetDateInput.value : (state.budgetDate || getTomorrowDate());
        var ratio = normalizeBudgetRatio(ratioInput && ratioInput.value);

        state.budgetDate = budgetDate;
        scoreConfig.budgetAllocationRatio = ratio;
        saveConfig(scoreConfig);
        setBudgetRatioInputs(ratio);

        if (!budgetDate) {
            state.wanxiangPlan = null;
            updateBudgetAllocations();
            renderActiveTab();
            return;
        }

        if (!options.silent) {
            setStatus('', '正在读取 ' + budgetDate + ' 的万相台计划...');
        }

        var planData = await fetchPlanBudgetData(budgetDate);
        var day = planData && Array.isArray(planData.days) ? planData.days[0] : null;
        state.wanxiangPlan = day ? toNum(day.wanxiang_plan) : null;
        updateBudgetAllocations();
        renderActiveTab();

        if (!options.silent) {
            if (state.wanxiangPlan === null) {
                setStatus('warn', '未读取到 ' + budgetDate + ' 的万相台计划，建议金额暂按 0 展示');
            } else {
                setStatus('success', '已按 ' + budgetDate + ' 万相台计划计算建议花费金额');
                setTimeout(hideStatus, 2500);
            }
        }
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
                if (group.subRows && group.subRows.length > 0) {
                    group.subRows.forEach(function (sub) {
                        state.crowdItems.push({
                            name: sub.label || sub.name || '未命名人群',
                            planName: sub.planName || sub.plan || '未标注计划',
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
            await refreshPlanBudget({ silent: true });
            updateBudgetAllocations();

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
        renderAllocationPanel();
        renderScoreTable(scored);
        renderSnapshotReviews();
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

    function initBudgetControls() {
        var budgetDateInput = $('bs-budget-date');
        var ratioInput = $('bs-budget-ratio');
        var refreshBtn = $('bs-budget-refresh-btn');
        var ratio = getBudgetRatio();
        state.budgetDate = getTomorrowDate();
        if (budgetDateInput) budgetDateInput.value = state.budgetDate;
        if (ratioInput) {
            setBudgetRatioInputs(ratio);
            ratioInput.addEventListener('change', function () {
                scoreConfig.budgetAllocationRatio = normalizeBudgetRatio(ratioInput.value);
                saveConfig(scoreConfig);
                setBudgetRatioInputs(scoreConfig.budgetAllocationRatio);
                updateBudgetAllocations();
                renderActiveTab();
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                refreshPlanBudget();
            });
        }
        if (budgetDateInput) {
            budgetDateInput.addEventListener('change', function () {
                refreshPlanBudget();
            });
        }
    }

    function initLoadButton() {
        var btn = $('bs-load-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            if (state.loading) return;
            loadAndScore();
        });
    }

    function createSuggestionSnapshot() {
        var stage = getStageConfig(ACTIVE_STAGE);
        return {
            id: 'snapshot-' + Date.now(),
            createdAt: Date.now(),
            startDate: state.startDate,
            endDate: state.endDate,
            stage: ACTIVE_STAGE,
            stageLabel: stage.label,
            costLabel: stage.costLabel,
            volumeLabel: stage.volumeLabel,
            targetCost: TARGET_COST,
            budgetDate: state.budgetDate,
            budgetAllocationRatio: getBudgetRatio(),
            wanxiangPlan: state.wanxiangPlan,
            allocatableBudget: state.allocatableBudget,
            items: state.scoredCrowds.map(function (item) {
                return {
                    key: getItemKey(item),
                    planName: item.planName,
                    name: item.name,
                    grade: item.grade,
                    spend: item.spend,
                    spendPct: item.spendPct,
                    suggestedSpendPct: item.suggestedSpendPct,
                    suggestedBudgetAmount: item.suggestedBudgetAmount,
                    adjustPct: item.adjustPct,
                    action: item.action,
                    metricCost: item.metricCost,
                    volume: item.volume,
                    score: item.score,
                };
            }),
        };
    }

    function initSaveSnapshotButton() {
        var btn = $('bs-save-snapshot-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            if (!state.scoredCrowds || state.scoredCrowds.length === 0) {
                setStatus('warn', '请先计算评分，再保存建议快照');
                return;
            }

            var snapshot = createSuggestionSnapshot();
            state.suggestionSnapshots = [snapshot].concat(state.suggestionSnapshots || []).slice(0, MAX_SNAPSHOTS);
            if (!saveSuggestionSnapshots()) {
                setStatus('error', '保存失败：浏览器存储不可用');
                return;
            }

            renderSnapshotReviews();
            setStatus('success', '已保存本次建议快照，后续重新计算即可自动复盘');
            setTimeout(hideStatus, 3500);
        });
    }

    function initExport() {
        var btn = $('bs-export-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var scored = state.scoredCrowds;
            if (scored.length === 0) return;

            var stage = getStageConfig(ACTIVE_STAGE);
            var header = '阶段,预算日期,万相台计划,执行预算比例,可分配预算,等级,计划,人群,花费,当前花费占比,建议花费占比,建议花费金额,调整幅度,' + stage.volumeLabel + ',' + stage.costLabel + ',成本健康分,ROI,建议动作\n';
            var rows = scored.map(function (s) {
                return [
                    stage.label,
                    state.budgetDate || '',
                    state.wanxiangPlan === null ? '' : toNum(state.wanxiangPlan).toFixed(2),
                    (getBudgetRatio() * 100).toFixed(1) + '%',
                    toNum(state.allocatableBudget).toFixed(2),
                    s.grade,
                    '"' + String(s.planName || '未标注计划').replace(/"/g, '""') + '"',
                    '"' + String(s.name).replace(/"/g, '""') + '"',
                    s.spend.toFixed(2),
                    (s.spendPct * 100).toFixed(1) + '%',
                    (s.suggestedSpendPct * 100).toFixed(1) + '%',
                    toNum(s.suggestedBudgetAmount).toFixed(2),
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
            updateBudgetAllocations();
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
        var budgetRatioInput = $('cfg-budget-ratio');

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
        if (budgetRatioInput) budgetRatioInput.value = getBudgetRatio();

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
                var budgetRatioValue = normalizeBudgetRatio(budgetRatioInput && budgetRatioInput.value);
                var nextTargetCosts = Object.assign({}, scoreConfig.targetCosts);
                nextTargetCosts[selectedStage] = isFinite(targetCostValue) ? targetCostValue : getTargetCost(selectedStage);
                var newConfig = {
                    analysisStage: selectedStage,
                    targetCosts: nextTargetCosts,
                    minOrdersForDecision: isFinite(minOrdersValue) ? minOrdersValue : 5,
                    gradeAThreshold: isFinite(gradeAValue) ? gradeAValue : 80,
                    gradeBThreshold: isFinite(gradeBValue) ? gradeBValue : 60,
                    gradeCThreshold: isFinite(gradeCValue) ? gradeCValue : 40,
                    budgetAllocationRatio: budgetRatioValue,
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
                setBudgetRatioInputs(budgetRatioValue);

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
                setBudgetRatioInputs(DEFAULT_CONFIG.budgetAllocationRatio);

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
        initBudgetControls();
        initLoadButton();
        initSaveSnapshotButton();
        initExport();
    });

})(window);
