/**
 * 人群预算评分卡 — 页面逻辑
 *
 * 核心流程:
 *  1. 调用 dashboard-data API 获取人群数据
 *  2. 基于订单成本计算成本健康分
 *  3. A/B/C/D 分级 + 再分配建议
 *  4. 建议追踪 (localStorage)
 */
(function (window) {
    'use strict';

    var authHelpers = window.authHelpers || {};
    var STORAGE_KEY = 'bs_track_items';
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
        trackedItems: loadTrackedItems(),
    };

    // ── 追踪数据持久化 (localStorage) ──

    function loadTrackedItems() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveTrackedItems() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trackedItems));
        } catch (e) {
            // ignore
        }
    }

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

    function getActionForGrade(grade) {
        switch (grade) {
            case 'A': return '加预算';
            case 'B': return '维持';
            case 'C': return '减预算';
            case 'D': return '暂停';
            case 'N': return '观察';
            default: return '--';
        }
    }

    function getActionClass(grade) {
        switch (grade) {
            case 'A': return 'increase';
            case 'B': return 'maintain';
            case 'C': return 'decrease';
            case 'D': return 'pause';
            case 'N': return 'observe';
            default: return '';
        }
    }

    function scoreItems(items, type) {
        var totalSpend = items.reduce(function (s, item) { return s + toNum(item.spend); }, 0);
        if (totalSpend <= 0) return [];
        var stage = getStageConfig(ACTIVE_STAGE);

        return items.map(function (item) {
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
                action: getActionForGrade(grade),
                actionClass: getActionClass(grade),
            };
        }).sort(function (a, b) { return b.score - a.score; });
    }

    // ── 再分配建议生成 ──

    function generateReallocations(scored) {
        var donors = scored.filter(function (s) { return s.grade === 'C' || s.grade === 'D'; });
        var receivers = scored.filter(function (s) {
            return s.grade === 'A' && s.volume >= scoreConfig.minOrdersForDecision;
        });
        if (donors.length === 0 || receivers.length === 0) return [];

        var totalReallocatable = donors.reduce(function (s, d) {
            var cutPct = d.grade === 'D' ? 0.6 : 0.25;
            return s + d.spend * cutPct;
        }, 0);

        if (totalReallocatable <= 0) return [];

        var totalReceiverVolume = receivers.reduce(function (s, r) { return s + r.volume; }, 0);
        var totalReceiverSpend = receivers.reduce(function (s, r) { return s + r.spend; }, 0);
        if (totalReceiverVolume <= 0 && totalReceiverSpend <= 0) return [];

        // 按来源分组:每个C/D级人群是一个建议项。
        var suggestions = [];
        donors.forEach(function (donor) {
            var cutPct = donor.grade === 'D' ? 0.6 : 0.25;
            var cutAmount = donor.spend * cutPct;

            // 优先按接收方当前阶段有效量占比分配；无有效量时才退回花费占比。
            var toItems = receivers.map(function (receiver) {
                var share = totalReceiverVolume > 0 ? receiver.volume / totalReceiverVolume : receiver.spend / totalReceiverSpend;
                return {
                    name: receiver.name,
                    grade: receiver.grade,
                    roi: receiver.roi,
                    volume: receiver.volume,
                    metricCost: receiver.metricCost,
                    metricCostLabel: receiver.metricCostLabel,
                    volumeLabel: receiver.volumeLabel,
                    addAmount: cutAmount * share,
                };
            });

            suggestions.push({
                fromItem: {
                    name: donor.name,
                    grade: donor.grade,
                    roi: donor.roi,
                    spend: donor.spend,
                    volume: donor.volume,
                    metricCost: donor.metricCost,
                    metricCostLabel: donor.metricCostLabel,
                    volumeLabel: donor.volumeLabel,
                    cutPct: cutPct,
                    cutAmount: cutAmount,
                },
                toItems: toItems,
                totalCutAmount: cutAmount,
            });
        });

        return suggestions;
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
        ['bs-overview', 'bs-detail-section', 'bs-realloc-section', 'bs-track-section'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = '';
        });
        var empty = $('bs-empty');
        if (empty) empty.style.display = 'none';
    }

    function hideContent() {
        ['bs-overview', 'bs-detail-section', 'bs-realloc-section'].forEach(function (id) {
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
        var overviewTitle = $('bs-overview-title');
        var volumeTh = $('bs-volume-th');
        var costTh = $('bs-cost-th');
        var trackHint = $('bs-track-hint');

        if (targetLabel) targetLabel.textContent = stage.targetLabel;
        if (targetHint) targetHint.textContent = stage.targetHint;
        if (targetInput) targetInput.value = getTargetCost(ACTIVE_STAGE);
        if (overviewTitle) overviewTitle.textContent = stage.label + '人群成本健康总览';
        if (volumeTh) volumeTh.textContent = stage.volumeLabel;
        if (costTh) costTh.textContent = stage.costLabel;
        if (trackHint) trackHint.textContent = '标记建议状态后，7天复盘' + stage.costLabel + '变化';
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
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:var(--space-6);">暂无数据</td></tr>';
            return;
        }

        scored.forEach(function (s) {
            var tr = document.createElement('tr');
            var scorePct = Math.min(s.score, 100);
            tr.innerHTML =
                '<td class="bs-td-grade"><span class="bs-grade-badge ' + s.grade.toLowerCase() + '">' + s.grade + '</span></td>' +
                '<td>' + escapeHtml(s.name) + '</td>' +
                '<td class="bs-td-num">' + formatMoney(s.spend) + '</td>' +
                '<td class="bs-td-num">' + formatInt(s.volume) + '</td>' +
                '<td class="bs-td-num">' + formatOrderCost(s.metricCost) + '</td>' +
                '<td class="bs-td-num"><span class="bs-score-bar"><span class="bs-score-bar-track"><span class="bs-score-bar-fill ' + s.grade.toLowerCase() + '" style="width:' + scorePct + '%"></span></span> ' + s.score.toFixed(1) + '</span></td>' +
                '<td class="bs-td-num">' + formatPct(s.spendPct) + '</td>' +
                '<td class="bs-td-action"><span class="bs-action-label ' + s.actionClass + '">' + s.action + '</span></td>';
            tbody.appendChild(tr);
        });
    }

    function renderReallocations(suggestions) {
        var list = $('bs-realloc-list');
        var summary = $('bs-realloc-summary');
        if (!list) return;
        list.innerHTML = '';

        if (suggestions.length === 0) {
            list.innerHTML = '<div class="bs-track-empty">当前评分数据无需再分配，或没有成交样本足够的 A 级人群。</div>';
            if (summary) summary.textContent = '';
            return;
        }

        var totalRealloc = suggestions.reduce(function (sum, s) { return sum + s.totalCutAmount; }, 0);
        if (summary) summary.textContent = '共 ' + suggestions.length + ' 个高成本人群可优化，总计可再分配 ' + formatMoney(totalRealloc);

        suggestions.forEach(function (sug, idx) {
            var fromItem = sug.fromItem;
            var gradeLabel = fromItem.grade === 'D' ? '低效' : '成本偏高';
            var cutLabel = fromItem.grade === 'D' ? '削减 60%' : '削减 25%';
            var volumeLabel = fromItem.volumeLabel || getStageConfig(ACTIVE_STAGE).volumeLabel;
            var metricCostLabel = fromItem.metricCostLabel || getStageConfig(ACTIVE_STAGE).costLabel;

            // 构建分配目标列表
            var toItemsHtml = sug.toItems.map(function (to) {
                return '<div class="bs-realloc-to-item">' +
                    '<span class="bs-realloc-to-name">' + escapeHtml(to.name) + '</span>' +
                    '<span class="bs-realloc-to-amount">+' + formatMoney(to.addAmount) + '</span>' +
                    '<span class="bs-realloc-to-meta">' + escapeHtml(to.volumeLabel || volumeLabel) + ' ' + formatInt(to.volume) + ' · ' + escapeHtml(to.metricCostLabel || metricCostLabel) + ' ' + formatOrderCost(to.metricCost) + '</span>' +
                    '</div>';
            }).join('');

            var card = document.createElement('div');
            card.className = 'bs-realloc-card';
            card.innerHTML =
                '<div class="bs-realloc-from">' +
                    '<div class="bs-realloc-from-header">' +
                        '<span class="bs-realloc-grade-badge ' + fromItem.grade.toLowerCase() + '">' + fromItem.grade + ' ' + gradeLabel + '</span>' +
                        '<div class="bs-realloc-name">' + escapeHtml(fromItem.name) + '</div>' +
                    '</div>' +
                    '<div class="bs-realloc-from-body">' +
                        '<div class="bs-realloc-row">' +
                            '<span class="bs-realloc-row-label">当前花费</span>' +
                            '<span class="bs-realloc-row-value">' + formatMoney(fromItem.spend) + '</span>' +
                        '</div>' +
                        '<div class="bs-realloc-row">' +
                            '<span class="bs-realloc-row-label">' + escapeHtml(volumeLabel) + '</span>' +
                            '<span class="bs-realloc-row-value">' + formatInt(fromItem.volume) + '</span>' +
                        '</div>' +
                        '<div class="bs-realloc-row">' +
                            '<span class="bs-realloc-row-label">' + escapeHtml(metricCostLabel) + '</span>' +
                            '<span class="bs-realloc-row-value">' + formatOrderCost(fromItem.metricCost) + '</span>' +
                        '</div>' +
                        '<div class="bs-realloc-row">' +
                            '<span class="bs-realloc-row-label">建议削减</span>' +
                            '<span class="bs-realloc-row-value cut">-' + formatMoney(fromItem.cutAmount) + ' (' + cutLabel + ')</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="bs-realloc-arrow">&#10132;</div>' +
                '<div class="bs-realloc-to">' +
                    '<div class="bs-realloc-to-header">分配至 A 级人群</div>' +
                    '<div class="bs-realloc-to-list">' + toItemsHtml + '</div>' +
                '</div>' +
                '<div class="bs-realloc-actions">' +
                    '<button class="bs-adopt-btn" data-idx="' + idx + '" type="button">采纳</button>' +
                '</div>';
            list.appendChild(card);
        });
    }

    function renderTracking() {
        var list = $('bs-track-list');
        var empty = $('bs-track-empty');
        if (!list) return;

        var items = state.trackedItems;
        if (items.length === 0) {
            if (empty) empty.style.display = '';
            list.innerHTML = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        list.innerHTML = '';

        items.forEach(function (item, idx) {
            var card = document.createElement('div');
            card.className = 'bs-track-card';

            var daysSince = Math.floor((Date.now() - item.adoptedAt) / 86400000);
            var needsVerify = item.status === 'executed' && daysSince >= 7;
            var effectText = '';
            var effectClass = 'neutral';

            if (item.status === 'verified') {
                effectText = '已确认成本改善';
                effectClass = 'positive';
            } else if (item.status === 'rejected') {
                effectText = '已确认无效';
                effectClass = 'negative';
            } else if (item.status === 'verifying') {
                effectText = '等待复盘订单成本';
            } else if (needsVerify) {
                effectText = '已满 ' + daysSince + ' 天，请验证效果';
            } else if (item.status === 'executed') {
                effectText = '执行第 ' + daysSince + ' 天（满 7 天验证）';
            } else {
                effectText = '执行前' + escapeHtml(item.metricCostLabel || '成本') + ' ' + formatOrderCost(item.fromMetricCost);
            }

            var verifyBtnHtml = '';
            if (item.status === 'executed' && needsVerify) {
                verifyBtnHtml = '<button class="bs-track-btn" data-track-idx="' + idx + '" data-action="verify">验证效果</button>';
            } else if (item.status === 'verifying') {
                verifyBtnHtml =
                    '<button class="bs-track-btn" data-track-idx="' + idx + '" data-action="confirm">确认有效</button>' +
                    '<button class="bs-track-btn" data-track-idx="' + idx + '" data-action="reject">确认无效</button>';
            }

            var executeBtnHtml = '';
            if (item.status === 'pending') {
                executeBtnHtml = '<button class="bs-track-btn" data-track-idx="' + idx + '" data-action="execute">标记已执行</button>';
            }

            card.innerHTML =
                '<div class="bs-track-status ' + item.status + '"></div>' +
                '<div class="bs-track-info">' +
                    '<div class="bs-track-title">' + escapeHtml(item.title) + '</div>' +
                    '<div class="bs-track-meta">采纳于 ' + escapeHtml(item.adoptedDate) + ' · ' + escapeHtml(item.statusText) + '</div>' +
                '</div>' +
                '<div class="bs-track-effect ' + effectClass + '">' + effectText + '</div>' +
                '<div class="bs-track-actions">' +
                    executeBtnHtml +
                    verifyBtnHtml +
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
        renderReallocations(generateReallocations(scored));
        renderTracking();
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

    function initAdoptButtons() {
        document.addEventListener('click', function (e) {
            var adoptBtn = e.target.closest('.bs-adopt-btn');
            if (!adoptBtn || adoptBtn.classList.contains('adopted')) return;

            var idx = parseInt(adoptBtn.dataset.idx, 10);
            var scored = state.scoredCrowds;
            var suggestions = generateReallocations(scored);
            var sug = suggestions[idx];
            if (!sug) return;

            var fromItem = sug.fromItem;
            var toNames = sug.toItems.map(function (t) { return t.name; }).join('、');
            var totalAdd = sug.toItems.reduce(function (sum, t) { return sum + t.addAmount; }, 0);

            var trackItem = {
                id: 'rec-' + Date.now(),
                title: fromItem.name + ' → ' + toNames,
                amount: formatMoney(totalAdd),
                status: 'pending',
                statusText: '待执行',
                adoptedAt: Date.now(),
                adoptedDate: formatDateInput(new Date()),
                stage: ACTIVE_STAGE,
                metricCostLabel: fromItem.metricCostLabel,
                volumeLabel: fromItem.volumeLabel,
                fromMetricCost: fromItem.metricCost,
                fromVolume: fromItem.volume,
                targetCost: TARGET_COST,
                startDate: state.startDate,
                endDate: state.endDate,
            };

            state.trackedItems.unshift(trackItem);
            saveTrackedItems();
            adoptBtn.textContent = '已采纳';
            adoptBtn.classList.add('adopted');
            renderTracking();

            var trackSection = $('bs-track-section');
            if (trackSection) trackSection.style.display = '';
        });
    }

    function initTrackButtons() {
        document.addEventListener('click', function (e) {
            var trackBtn = e.target.closest('.bs-track-btn');
            if (!trackBtn) return;

            var idx = parseInt(trackBtn.dataset.trackIdx, 10);
            var action = trackBtn.dataset.action;
            if (!state.trackedItems[idx]) return;

            var item = state.trackedItems[idx];

            switch (action) {
                case 'execute':
                    item.status = 'executed';
                    item.statusText = '已执行，7天后验证';
                    break;
                case 'verify':
                    item.status = 'verifying';
                    item.statusText = '验证中，请确认效果';
                    break;
                case 'confirm':
                    item.status = 'verified';
                    item.statusText = '已验证有效';
                    break;
                case 'reject':
                    item.status = 'rejected';
                    item.statusText = '已验证无效';
                    break;
            }

            saveTrackedItems();
            renderTracking();
        });
    }

    function initExport() {
        var btn = $('bs-export-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var scored = state.scoredCrowds;
            if (scored.length === 0) return;

            var stage = getStageConfig(ACTIVE_STAGE);
            var header = '阶段,等级,人群,花费,' + stage.volumeLabel + ',' + stage.costLabel + ',成本健康分,花费占比,ROI,建议动作\n';
            var rows = scored.map(function (s) {
                return [
                    stage.label,
                    s.grade,
                    '"' + String(s.name).replace(/"/g, '""') + '"',
                    s.spend.toFixed(2),
                    s.volume.toFixed(0),
                    s.metricCost.toFixed(2),
                    s.score.toFixed(1),
                    (s.spendPct * 100).toFixed(1) + '%',
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
                    setStatus('error', '最低成交样本必须大于 0');
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
        initAdoptButtons();
        initTrackButtons();
        initExport();

        if (state.trackedItems.length > 0) {
            var trackSection = $('bs-track-section');
            if (trackSection) trackSection.style.display = '';
            renderTracking();
        }
    });

})(window);
