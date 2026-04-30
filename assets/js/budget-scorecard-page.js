/**
 * 预算效率评分卡 — 页面逻辑
 *
 * 核心流程:
 *  1. 调用 dashboard-data API 获取单品+人群数据
 *  2. 计算 ROI 达标率 × 花费权重 → 效率分
 *  3. A/B/C/D 分级 + 再分配建议
 *  4. 建议追踪 (localStorage)
 */
(function (window) {
    'use strict';

    var authHelpers = window.authHelpers || {};
    var STORAGE_KEY = 'bs_track_items';
    var ROI_TARGET = 2.0;

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

    function formatRoi(n) {
        if (!isFinite(n) || n === 0) return '--';
        return n.toFixed(2);
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
        singleItems: [],
        crowdItems: [],
        scoredSingles: [],
        scoredCrowds: [],
        activeTab: 'single',
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
     * 效率分 = ROI达标率 × 花费权重
     *
     * ROI达标率 = min(actualROI / targetROI, 2.0)
     * 花费权重   = log(1 + spend / 1000) / log(1 + totalSpend / 1000)
     *
     * 最终得分范围 ~ 0–100+
     */
    function computeEfficiencyScore(actualROI, targetROI, spend, totalSpend) {
        if (spend <= 0 || totalSpend <= 0) return 0;
        var roiRatio = Math.min(actualROI / targetROI, 2.0);
        var spendWeight = Math.log(1 + spend / 1000) / Math.log(1 + totalSpend / 1000);
        return roiRatio * spendWeight * 100;
    }

    function getGrade(score) {
        if (score >= 70) return 'A';
        if (score >= 40) return 'B';
        if (score >= 15) return 'C';
        return 'D';
    }

    function getActionForGrade(grade) {
        switch (grade) {
            case 'A': return '加预算';
            case 'B': return '维持';
            case 'C': return '减预算';
            case 'D': return '暂停';
            default: return '--';
        }
    }

    function getActionClass(grade) {
        switch (grade) {
            case 'A': return 'increase';
            case 'B': return 'maintain';
            case 'C': return 'decrease';
            case 'D': return 'pause';
            default: return '';
        }
    }

    function scoreItems(items, type) {
        var totalSpend = items.reduce(function (s, item) { return s + toNum(item.spend); }, 0);
        if (totalSpend <= 0) return [];

        return items.map(function (item) {
            var roi = toNum(item.roi);
            var spend = toNum(item.spend);
            var score = computeEfficiencyScore(roi, ROI_TARGET, spend, totalSpend);
            var grade = getGrade(score);
            return {
                id: type + ':' + item.name,
                name: item.name,
                type: type,
                roi: roi,
                spend: spend,
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
        var receivers = scored.filter(function (s) { return s.grade === 'A'; });
        if (donors.length === 0 || receivers.length === 0) return [];

        var totalReallocatable = donors.reduce(function (s, d) {
            var cutPct = d.grade === 'D' ? 0.6 : 0.3;
            return s + d.spend * cutPct;
        }, 0);

        if (totalReallocatable <= 0) return [];

        var totalReceiverSpend = receivers.reduce(function (s, r) { return s + r.spend; }, 0);
        if (totalReceiverSpend <= 0) return [];

        var suggestions = [];
        receivers.forEach(function (receiver) {
            var share = receiver.spend / totalReceiverSpend;
            var addAmount = totalReallocatable * share;

            var fromItems = donors.map(function (d) {
                return {
                    name: d.name,
                    grade: d.grade,
                    cutPct: d.grade === 'D' ? 0.6 : 0.3,
                    amount: d.spend * (d.grade === 'D' ? 0.6 : 0.3),
                };
            });

            suggestions.push({
                fromItems: fromItems,
                toItem: receiver.name,
                toGrade: receiver.grade,
                toRoi: receiver.roi,
                addAmount: addAmount,
                totalReallocatable: totalReallocatable,
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
        ['bs-overview', 'bs-tabs-section', 'bs-detail-section', 'bs-realloc-section', 'bs-track-section'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = '';
        });
        var empty = $('bs-empty');
        if (empty) empty.style.display = 'none';
    }

    function hideContent() {
        ['bs-overview', 'bs-tabs-section', 'bs-detail-section', 'bs-realloc-section'].forEach(function (id) {
            var el = $(id);
            if (el) el.style.display = 'none';
        });
        var empty = $('bs-empty');
        if (empty) empty.style.display = '';
    }

    function renderOverview(scored) {
        var counts = { A: 0, B: 0, C: 0, D: 0 };
        var spends = { A: 0, B: 0, C: 0, D: 0 };
        var total = scored.length;

        scored.forEach(function (s) {
            counts[s.grade]++;
            spends[s.grade] += s.spend;
        });

        var totalSpend = scored.reduce(function (sum, s) { return sum + s.spend; }, 0);

        ['A', 'B', 'C', 'D'].forEach(function (grade) {
            var countEl = $('grade-' + grade.toLowerCase() + '-count');
            var pctEl = $('grade-' + grade.toLowerCase() + '-pct');
            if (countEl) countEl.textContent = counts[grade];
            if (pctEl) pctEl.textContent = total > 0 ? (counts[grade] / total * 100).toFixed(0) + '%' : '0%';
        });

        var bar = $('bs-budget-bar');
        if (bar) {
            bar.innerHTML = '';
            ['A', 'B', 'C', 'D'].forEach(function (grade) {
                if (spends[grade] <= 0) return;
                var seg = document.createElement('div');
                seg.className = 'bs-budget-bar-seg grade-' + grade.toLowerCase();
                seg.style.width = (spends[grade] / totalSpend * 100) + '%';
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
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:var(--space-6);">暂无数据</td></tr>';
            return;
        }

        scored.forEach(function (s) {
            var tr = document.createElement('tr');
            var scorePct = Math.min(s.score, 100);
            tr.innerHTML =
                '<td class="bs-td-grade"><span class="bs-grade-badge ' + s.grade.toLowerCase() + '">' + s.grade + '</span></td>' +
                '<td>' + escapeHtml(s.name) + '</td>' +
                '<td class="bs-td-num">' + formatMoney(s.spend) + '</td>' +
                '<td class="bs-td-num">' + formatRoi(s.roi) + '</td>' +
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
            list.innerHTML = '<div class="bs-track-empty">当前评分数据无需再分配，或没有可加预算的 A 级单元。</div>';
            if (summary) summary.textContent = '';
            return;
        }

        var totalRealloc = suggestions.length > 0 ? suggestions[0].totalReallocatable : 0;
        if (summary) summary.textContent = '可再分配总额 ' + formatMoney(totalRealloc);

        suggestions.forEach(function (sug, idx) {
            var fromNames = sug.fromItems.map(function (f) { return f.name; }).join('、');
            var fromCutDescs = sug.fromItems.map(function (f) { return f.name + '(-' + (f.cutPct * 100).toFixed(0) + '%)'; }).join('、');
            var fromTotalCut = sug.fromItems.reduce(function (s, f) { return s + f.amount; }, 0);

            var card = document.createElement('div');
            card.className = 'bs-realloc-card';
            card.innerHTML =
                '<div class="bs-realloc-from">' +
                    '<div class="bs-realloc-label">削减来源 (C/D 级)</div>' +
                    '<div class="bs-realloc-name">' + escapeHtml(fromNames) + '</div>' +
                    '<div class="bs-realloc-amount">-' + formatMoney(fromTotalCut) + '</div>' +
                    '<div class="bs-realloc-meta">' + escapeHtml(fromCutDescs) + '</div>' +
                '</div>' +
                '<div class="bs-realloc-arrow">&#10132;</div>' +
                '<div class="bs-realloc-to">' +
                    '<div class="bs-realloc-label">增加去向 (A 级)</div>' +
                    '<div class="bs-realloc-name">' + escapeHtml(sug.toItem) + '</div>' +
                    '<div class="bs-realloc-amount">+' + formatMoney(sug.addAmount) + '</div>' +
                    '<div class="bs-realloc-meta">当前 ROI ' + formatRoi(sug.toRoi) + '</div>' +
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

            if (item.status === 'verified' && item.effectRoi !== null && item.effectRoi !== undefined) {
                effectText = 'ROI ' + (item.effectRoi >= 0 ? '+' : '') + item.effectRoi.toFixed(2);
                effectClass = item.effectRoi >= 0 ? 'positive' : 'negative';
            } else if (item.status === 'rejected') {
                effectText = '已驳回';
                effectClass = 'negative';
            } else if (item.status === 'verifying') {
                effectText = '等待确认效果';
            } else if (needsVerify) {
                effectText = '已满 ' + daysSince + ' 天，请验证效果';
            } else if (item.status === 'executed') {
                effectText = '执行第 ' + daysSince + ' 天（满 7 天验证）';
            } else {
                effectText = '待执行';
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
                query: { start_date: startDate, end_date: endDate, sections: 'crowd,single' },
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

            // 解析单品数据
            var singleRaw = data && data.single && data.single.items ? data.single.items : [];
            state.singleItems = singleRaw.map(function (item) {
                return {
                    name: item.name || item['商品名称'] || '未命名单品',
                    roi: toNum(item.roi),
                    spend: toNum(item.spend || item['花费']),
                };
            }).filter(function (item) { return item.spend > 0; });

            // 解析人群数据
            var crowdRaw = data && data.crowd && data.crowd.summary ? data.crowd.summary : [];
            state.crowdItems = [];
            crowdRaw.forEach(function (group) {
                if (group.crowd && group.summary) {
                    state.crowdItems.push({
                        name: group.crowd,
                        roi: toNum(group.summary.roi),
                        spend: toNum(group.summary.cost || group.summary['花费']),
                    });
                }
                if (group.subRows && group.subRows.length > 0) {
                    group.subRows.forEach(function (sub) {
                        state.crowdItems.push({
                            name: sub.label || sub.name || '未命名人群',
                            roi: toNum(sub.roi),
                            spend: toNum(sub.cost || sub['花费']),
                        });
                    });
                }
            });
            state.crowdItems = state.crowdItems.filter(function (item) { return item.spend > 0; });

            // 评分
            state.scoredSingles = scoreItems(state.singleItems, 'single');
            state.scoredCrowds = scoreItems(state.crowdItems, 'crowd');

            // 渲染
            showContent();
            renderActiveTab();
            setStatus('success', '评分完成，共 ' + (state.scoredSingles.length + state.scoredCrowds.length) + ' 个投放单元');
        } catch (err) {
            setStatus('error', '数据加载失败：' + (err.message || '请稍后重试'));
            hideContent();
        } finally {
            state.loading = false;
        }
    }

    function renderActiveTab() {
        var scored = state.activeTab === 'crowd' ? state.scoredCrowds : state.scoredSingles;
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

    function initTabs() {
        var tabs = document.querySelectorAll('.bs-tab');
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                tabs.forEach(function (t) {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                state.activeTab = tab.dataset.tab;
                renderActiveTab();
            });
        });
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
            var scored = state.activeTab === 'crowd' ? state.scoredCrowds : state.scoredSingles;
            var suggestions = generateReallocations(scored);
            var sug = suggestions[idx];
            if (!sug) return;

            var trackItem = {
                id: 'rec-' + Date.now(),
                title: sug.fromItems.map(function (f) { return f.name; }).join('、') + ' → ' + sug.toItem,
                amount: formatMoney(sug.addAmount),
                status: 'pending',
                statusText: '待执行',
                adoptedAt: Date.now(),
                adoptedDate: formatDateInput(new Date()),
                toRoi: sug.toRoi,
                effectRoi: null,
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
                    item.effectRoi = item.toRoi - ROI_TARGET;
                    break;
                case 'reject':
                    item.status = 'rejected';
                    item.statusText = '已验证无效';
                    item.effectRoi = item.toRoi - ROI_TARGET;
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
            var scored = state.activeTab === 'crowd' ? state.scoredCrowds : state.scoredSingles;
            if (scored.length === 0) return;

            var header = '等级,名称,花费,ROI,效率分,花费占比,建议动作\n';
            var rows = scored.map(function (s) {
                return [s.grade, '"' + s.name + '"', s.spend.toFixed(2), s.roi.toFixed(4), s.score.toFixed(1), (s.spendPct * 100).toFixed(1) + '%', s.action].join(',');
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

    // ── 初始化 ──

    document.addEventListener('DOMContentLoaded', function () {
        initDatePresets();
        initTabs();
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
