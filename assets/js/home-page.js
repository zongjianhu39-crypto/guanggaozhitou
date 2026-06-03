const authHelpers = window.authHelpers || {};

        // ===== 同比配置 =====
        const YOY_MONTH = '05'; // 同比对比月份（如618大促=05）

        let homeInsightsAuthRedirectScheduled = false;
        let homeDashboardData = null;
        let homeFullPayload = null;
        let homeReportItem = null;   // 最新一篇 AI 报告（完整对象）
        let homeAlertItems = [];
        let homePlanData = null;     // 计划目标数据
        let homeYoyCurrent = null;   // 当年5月累计
        let homeYoyReference = null; // 去年5月累计
        let homeDataCache = null;    // stale-while-revalidate 缓存
        let homeDataCacheTime = 0;
        let homeCrowdRuleData = null;  // 人群分层（直播间计划·规则）本月数据

        /* ══════════════════════════════════
           工具函数
           ══════════════════════════════════ */
        function esc(v) {
            return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        }

        function fmtCurrency(v) {
            if (v == null || isNaN(v)) return '--';
            return v >= 10000 ? '¥' + (v / 10000).toFixed(1) + '万' : '¥' + Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
        }
        function fmtInt(v) { return (v == null || isNaN(v)) ? '--' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 }); }

        function changePct(cur, prev) {
            if (prev == null || prev === 0 || cur == null) return { text: '--', cls: 'neutral' };
            const pct = ((cur - prev) / Math.abs(prev)) * 100;
            return { text: (pct > 0 ? '+' : '') + pct.toFixed(1) + '%', cls: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral' };
        }

        function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

        function shanghaiToday() {
            return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
        }
        function nDaysAgo(n) {
            const d = new Date(Date.now() - n * 86400000);
            return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(d);
        }

        function formatDateLabel(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr + 'T00:00:00+08:00');
            const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wd[d.getDay()]}`;
        }

        /** 增涨行格式化（负数用括号） */
        function fmtDelta(v) {
            if (v == null || isNaN(v)) return '--';
            const n = Number(v);
            if (n < 0) return `(${fmtWan(Math.abs(n))})`;
            return fmtWan(n);
        }
        function fmtDeltaFixed(v, digits) {
            if (v == null || isNaN(v)) return '--';
            const n = Number(v);
            if (n < 0) return `(${Math.abs(n).toFixed(digits)})`;
            return n.toFixed(digits);
        }
        function fmtDeltaPct(v) {
            if (v == null || isNaN(v)) return '--';
            const n = Number(v) * 100;
            if (n < 0) return `(${Math.abs(n).toFixed(1)}%)`;
            return n.toFixed(1) + '%';
        }

        /** 同比/环比百分比 */
        function fmtYoyPct(cur, ref) {
            if (ref === 0 || ref == null) return '<span class="yoy-neg">--</span>';
            const pct = ((cur / ref) - 1) * 100;
            const cls = pct < 0 ? 'yoy-neg' : 'yoy-pos';
            return `<span class="${cls}">${pct.toFixed(0)}%</span>`;
        }

        /* ══════════════════════════════════
           渲染：一句话结论
           ══════════════════════════════════ */
        function renderExecutiveBanner(latest, prev, alertCount, aiReport) {
            const el = document.getElementById('executive-text');
            if (!el) return;

            // 优先使用 AI 报告的 executive_summary
            const aiHeadline = aiReport?.executive_summary?.headline
                || aiReport?.executive_summary
                || '';
            if (typeof aiHeadline === 'string' && aiHeadline.length > 5) {
                el.textContent = aiHeadline;
                return;
            }

            // 降级：根据数据自动生成
            if (!latest) { el.textContent = '今日数据暂未同步，建议稍后刷新。'; return; }
            const parts = [];
            parts.push(`花费 ${fmtCurrency(latest.cost)}`);
            parts.push(`加购 ${fmtInt(latest.cart)}`);
            parts.push(`成交 ${fmtInt(latest.orders)} 笔`);
            if (prev) {
                const costDelta = changePct(latest.cost, prev.cost);
                parts.push(`花费较前日 ${costDelta.text}`);
            }
            if (alertCount > 0) parts.push(`${alertCount} 条风险告警需处理`);
            el.textContent = '今日大盘：' + parts.join('，') + '。';
        }

       /* ══════════════════════════════════
           渲染：核心KPI阶段表（按周分组）
           ══════════════════════════════════ */

        /** 格式化为"万"单位 */
        function fmtWan(v) {
            if (v == null || isNaN(v)) return '--';
            const n = Number(v);
            if (n === 0) return '0.0万';
            if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
            if (Math.abs(n) >= 1000) return (n / 10000).toFixed(2) + '万';
            return n.toFixed(1);
        }

        /** 获取 ISO 周一日期 */
        function getMonday(d) {
            const dt = new Date(d);
            const day = dt.getDay();
            const diff = day === 0 ? -6 : 1 - day;
            dt.setDate(dt.getDate() + diff);
            return dt;
        }

        /** 格式化日期为 yyyy/M/d */
        function fmtDate(d) {
            const dt = typeof d === 'string' ? new Date(d + 'T00:00:00+08:00') : d;
            return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
        }

        /** 生成阶段名（如 '4月最后一周'、'5月第1周'） */
        function phaseName(startDate) {
            const dt = typeof startDate === 'string' ? new Date(startDate + 'T00:00:00+08:00') : new Date(startDate);
            const month = dt.getMonth() + 1;
            const dayOfMonth = dt.getDate();
            // 计算是当月第几周
            const firstOfMonth = new Date(dt.getFullYear(), dt.getMonth(), 1);
            const firstMonday = getMonday(firstOfMonth);
            if (firstMonday.getMonth() < dt.getMonth()) firstMonday.setDate(firstMonday.getDate() + 7);
            const weekIdx = Math.floor((dayOfMonth - 1) / 7) + 1;
            // 判断是否是最后一周（下周一已到下月）
            const nextMonday = new Date(dt);
            nextMonday.setDate(nextMonday.getDate() + 7);
            if (nextMonday.getMonth() + 1 !== month) {
                return `${month}月最后一周`;
            }
            return `${month}月第${weekIdx}周`;
        }

        /** 将 daily 数据按自然周（周一~周日）分组 */
        function groupByWeek(daily, agentPlanMap, planCostMap) {
            if (!daily || !daily.length) return [];
            const weekMap = new Map();
            // daily 按日期降序排列（最新在前），遍历全部
            daily.forEach(row => {
                if (!row.label) return;
                const monday = getMonday(new Date(row.label + 'T00:00:00+08:00'));
                const key = monday.toISOString().slice(0, 10);
                if (!weekMap.has(key)) {
                    weekMap.set(key, { startDate: key, rows: [] });
                }
                weekMap.get(key).rows.push(row);
            });

            // 将 Map 转为数组并排序（旧的在前）
            const weeks = Array.from(weekMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));

            return weeks.map(w => {
                const rows = w.rows;
                const cost = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
                const views = rows.reduce((s, r) => s + (Number(r.views) || 0), 0);
                const orders = rows.reduce((s, r) => s + (Number(r.orders) || 0), 0);
                const cart = rows.reduce((s, r) => s + (Number(r.cart) || 0), 0);
                const preOrders = rows.reduce((s, r) => s + (Number(r.preOrders) || 0), 0);
                const directOrders = rows.reduce((s, r) => s + (Number(r.directOrders) || 0), 0);
                const directPreOrders = rows.reduce((s, r) => s + (Number(r.directPreOrders) || 0), 0);
                // 有客代投花费：按日期从 agentPlanMap 取值累加
                const liveCost = agentPlanMap ? rows.reduce((s, r) => {
                    return s + (agentPlanMap.get(r.label) || 0);
                }, 0) : 0;
                // 计划花费：按日期从 planCostMap 取值累加
                const weekPlanCost = planCostMap ? rows.reduce((s, r) => {
                    return s + (planCostMap.get(r.label) || 0);
                }, 0) : 0;
                const viewCost = views > 0 ? cost / views : 0;
                const cartCost = cart > 0 ? cost / cart : 0;
                const viewConvertRate = views > 0 ? directOrders / views : 0;
                const orderCost = orders > 0 ? cost / orders : 0;
                const preOrderCost = preOrders > 0 ? cost / preOrders : 0;
                const directOrderCost = directOrders > 0 ? cost / directOrders : 0;
                const directPreOrderCost = directPreOrders > 0 ? cost / directPreOrders : 0;

                // 计算周的结束日期（周日）
                const start = new Date(w.startDate + 'T00:00:00+08:00');
                const end = new Date(start);
                end.setDate(end.getDate() + 6);

                return {
                    startDate: fmtDate(start),
                    endDate: fmtDate(end),
                    phase: phaseName(w.startDate),
                    cost, liveCost, views, orders, cart, preOrders, directOrders, directPreOrders,
                    planCost: weekPlanCost,
                    viewCost, cartCost, viewConvertRate, orderCost, preOrderCost, directOrderCost, directPreOrderCost
                };
            });
        }

        function renderKpiTable(daily, latest, prev) {
            const tbody = document.getElementById('kpi-table-body');
            if (!tbody) return;

            // 构建有客代投花费的日期映射
            const agentPlanMap = homePlanData?.agentPlanByDate || null;
            const planCostMap = homePlanData?.planCostByDate || null;
            const weeks = groupByWeek(daily, agentPlanMap, planCostMap);

            if (!weeks.length) {
                tbody.innerHTML = '<tr><td colspan="18" class="table-loading">暂无阶段数据</td></tr>';
                renderKpiSummary([], null);
                return;
            }

            // 累计汇总
            let totalCost = 0, totalViews = 0, totalOrders = 0, totalCart = 0, totalPreOrders = 0, totalLiveCost = 0, totalPlanCost = 0;
            let totalDirectOrders = 0, totalDirectPreOrders = 0;

            let html = '';
            weeks.forEach(week => {
                const adCost = week.cost;
                const liveCost = week.liveCost || 0;
                const allCost = adCost + liveCost;
                totalCost += adCost;
                totalLiveCost += liveCost;
                totalViews += week.views;
                totalOrders += week.orders;
                totalCart += week.cart;
                totalPreOrders += week.preOrders;
                totalDirectOrders += week.directOrders || 0;
                totalDirectPreOrders += week.directPreOrders || 0;
                totalPlanCost += week.planCost || 0;

                html += `<tr>
                    <td class="col-label">${esc(week.startDate)}</td>
                    <td class="col-label">${esc(week.endDate)}</td>
                    <td class="col-label">${esc(week.phase)}</td>
                    <td class="col-num">${fmtWan(allCost)}</td>
                    <td class="col-num">${week.planCost > 0 ? fmtWan(week.planCost) : '--'}</td>
                    <td class="col-num">${fmtWan(liveCost)}</td>
                    <td class="col-num">${fmtWan(adCost)}</td>
                    <td class="col-num">${fmtWan(week.views)}</td>
                    <td class="col-num">${fmtWan(week.directOrders)}</td>
                    <td class="col-num">${fmtWan(week.cart)}</td>
                    <td class="col-num">${week.cartCost > 0 ? week.cartCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${week.viewCost > 0 ? week.viewCost.toFixed(2) : '--'}</td>
                    <td class="col-num">${week.viewConvertRate > 0 ? (week.viewConvertRate * 100).toFixed(1) + '%' : '--'}</td>
                    <td class="col-num">${fmtWan(week.preOrders)}</td>
                    <td class="col-num">${fmtWan(week.directPreOrders)}</td>
                    <td class="col-num">${week.preOrderCost > 0 ? fmtWan(week.preOrderCost) : '--'}</td>
                    <td class="col-num">${week.directOrderCost > 0 ? week.directOrderCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${week.directPreOrderCost > 0 ? fmtWan(week.directPreOrderCost) : '--'}</td>
                </tr>`;
            });

            // 汇总行
            const totalAllCost = totalCost + totalLiveCost;
            const totalCartCost = totalCart > 0 ? totalAllCost / totalCart : 0;
            const totalViewCost = totalViews > 0 ? totalAllCost / totalViews : 0;
            const totalViewRate = totalViews > 0 ? totalDirectOrders / totalViews : 0;
            const totalOrderCost = totalOrders > 0 ? totalAllCost / totalOrders : 0;
            const totalPreOrderCost = totalPreOrders > 0 ? totalAllCost / totalPreOrders : 0;
            const totalDirectOrderCost = totalDirectOrders > 0 ? totalAllCost / totalDirectOrders : 0;
            const totalDirectPreOrderCost = totalDirectPreOrders > 0 ? totalAllCost / totalDirectPreOrders : 0;

            html += `<tr class="kpi-summary-row">
                <td class="col-label" colspan="3">汇总</td>
                <td class="col-num">${fmtWan(totalAllCost)}</td>
                <td class="col-num">${totalPlanCost > 0 ? fmtWan(totalPlanCost) : '--'}</td>
                <td class="col-num">${fmtWan(totalLiveCost)}</td>
                <td class="col-num">${fmtWan(totalCost)}</td>
                <td class="col-num">${fmtWan(totalViews)}</td>
                <td class="col-num">${fmtWan(totalDirectOrders)}</td>
                <td class="col-num">${fmtWan(totalCart)}</td>
                <td class="col-num">${totalCartCost > 0 ? totalCartCost.toFixed(1) : '--'}</td>
                <td class="col-num">${totalViewCost > 0 ? totalViewCost.toFixed(2) : '--'}</td>
                <td class="col-num">${totalViewRate > 0 ? (totalViewRate * 100).toFixed(1) + '%' : '--'}</td>
                <td class="col-num">${fmtWan(totalPreOrders)}</td>
                <td class="col-num">${fmtWan(totalDirectPreOrders)}</td>
                <td class="col-num">${totalPreOrderCost > 0 ? fmtWan(totalPreOrderCost) : '--'}</td>
                <td class="col-num">${totalDirectOrderCost > 0 ? totalDirectOrderCost.toFixed(1) : '--'}</td>
                <td class="col-num">${totalDirectPreOrderCost > 0 ? fmtWan(totalDirectPreOrderCost) : '--'}</td>
            </tr>`;

            tbody.innerHTML = html;

            // 渲染一句话总结
            renderKpiSummary(weeks, { cost: totalCost, views: totalViews, orders: totalOrders, cart: totalCart, preOrders: totalPreOrders });
        }

        /** 一句话总结 */
        function renderKpiSummary(weeks, total) {
            const el = document.getElementById('kpi-summary-text');
            if (!el) return;
            if (!weeks.length) { el.innerHTML = ''; return; }

            const lastWeek = weeks[weeks.length - 1];
            const parts = [];

            parts.push(`自投本周花 <strong>${fmtWan(lastWeek.cost)}</strong>`);
            if (lastWeek.viewConvertRate > 0) {
                parts.push(`观看转化率 <strong>${(lastWeek.viewConvertRate * 100).toFixed(1)}%</strong>`);
            }
            if (lastWeek.orderCost > 0) {
                parts.push(`订单成本 <strong>${lastWeek.orderCost.toFixed(1)}</strong> 元`);
            }
            if (lastWeek.cartCost > 0) {
                parts.push(`加购成本 <strong>${lastWeek.cartCost.toFixed(1)}</strong> 元`);
            }

            if (total) {
                const today = new Date();
                const monthDay = today.getDate();
                parts.push(`${today.getMonth() + 1}月累计（截至 ${today.getMonth() + 1}/${monthDay}）：花 <strong>${fmtWan(total.cost)}</strong>，成交 <strong>${fmtWan(total.orders)}</strong> 笔`);
            }

            el.innerHTML = parts.join('，') + '。';
        }

        function renderKpiError() {
            const tbody = document.getElementById('kpi-table-body');
            if (tbody) tbody.innerHTML = '<tr><td colspan="18" class="table-loading table-error">数据加载失败</td></tr>';
        }

        /* ══════════════════════════════════
           渲染：人群分层（直播间计划·规则）
           ══════════════════════════════════ */
        function renderCrowdRuleSection(crowdResult) {
            const tbody = document.getElementById('crowd-rule-table-body');
            if (!tbody) return;

            const rows = crowdResult?.summary || [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="13" class="table-loading">本月暂无人群数据（含"规则"的计划）</td></tr>';
                return;
            }

            let totalCost = 0, totalOrders = 0, totalCart = 0, totalViews = 0, totalPreOrders = 0;
            let totalDirectOrders = 0, totalDirectPreOrders = 0;
            let html = '';

            function crowdCells(s) {
                const viewCost      = s.viewCost      > 0 ? s.viewCost.toFixed(2)         : '--';
                const cartCost      = s.cartCost      > 0 ? s.cartCost.toFixed(1)         : '--';
                const vConvRate     = s.views > 0 ? (s.directOrders / s.views) * 100 : 0;
                const viewRate      = vConvRate > 0 ? vConvRate.toFixed(1) + '%' : '--';
                const orderCost     = s.orderCost     > 0 ? s.orderCost.toFixed(1)        : '--';
                const preOrderCost  = s.preOrderCost  > 0 ? s.preOrderCost.toFixed(1)     : '--';
                const directOrderCost    = s.directOrders    > 0 ? (s.cost / s.directOrders).toFixed(1)    : '--';
                const directPreOrderCost = s.directPreOrders > 0 ? (s.cost / s.directPreOrders).toFixed(1) : '--';
                return `<td class="col-num">${fmtWan(s.cost)}</td>
                    <td class="col-num">${fmtWan(s.views)}</td>
                    <td class="col-num">${fmtWan(s.directOrders)}</td>
                    <td class="col-num">${fmtWan(s.cart)}</td>
                    <td class="col-num">${cartCost}</td>
                    <td class="col-num">${viewCost}</td>
                    <td class="col-num">${viewRate}</td>
                    <td class="col-num">${fmtWan(s.preOrders)}</td>
                    <td class="col-num">${fmtWan(s.directPreOrders)}</td>
                    <td class="col-num">${preOrderCost}</td>
                    <td class="col-num">${directOrderCost}</td>
                    <td class="col-num">${directPreOrderCost}</td>`;
            }

            rows.forEach((layerRow, idx) => {
                const s = layerRow.summary;
                totalCost       += s.cost       || 0;
                totalOrders     += s.orders     || 0;
                totalCart       += s.cart       || 0;
                totalViews      += s.views      || 0;
                totalPreOrders  += s.preOrders  || 0;
                totalDirectOrders    += s.directOrders    || 0;
                totalDirectPreOrders += s.directPreOrders || 0;

                const layerId  = `cr-layer-${idx}`;
                const subCount = layerRow.subRows?.length || 0;

                html += `<tr class="crowd-rule-layer-row" data-layer-id="${layerId}">
                    <td class="col-label">
                        <span class="crowd-rule-expand-icon">▶</span>${esc(layerRow.crowd)}<span class="crowd-rule-count">${subCount}个定向</span>
                    </td>
                    ${crowdCells(s)}
                </tr>`;

                (layerRow.subRows || []).forEach(sub => {
                    html += `<tr class="crowd-rule-sub-row" data-parent-layer="${layerId}">
                        <td class="col-label crowd-rule-sub-label">
                            ${esc(sub.label)}<span class="crowd-rule-plan-name">${esc(sub.planName)}</span>
                        </td>
                        ${crowdCells(sub)}
                    </tr>`;
                });
            });

            // 汇总行
            const totViewCost      = totalViews      > 0 ? (totalCost / totalViews).toFixed(2)      : '--';
            const totCartCost      = totalCart       > 0 ? (totalCost / totalCart).toFixed(1)       : '--';
            const totViewRate      = totalDirectOrders > 0 ? ((totalDirectOrders / totalViews) * 100).toFixed(1) + '%' : '--';
            const totOrderCost     = totalOrders     > 0 ? (totalCost / totalOrders).toFixed(1)     : '--';
            const totPreOrderCost  = totalPreOrders  > 0 ? (totalCost / totalPreOrders).toFixed(1)  : '--';
            const totDirectOrderCost    = totalDirectOrders    > 0 ? (totalCost / totalDirectOrders).toFixed(1)    : '--';
            const totDirectPreOrderCost = totalDirectPreOrders > 0 ? (totalCost / totalDirectPreOrders).toFixed(1) : '--';
            html += `<tr class="kpi-summary-row">
                <td class="col-label">汇总</td>
                <td class="col-num">${fmtWan(totalCost)}</td>
                <td class="col-num">${fmtWan(totalViews)}</td>
                <td class="col-num">${fmtWan(totalDirectOrders)}</td>
                <td class="col-num">${fmtWan(totalCart)}</td>
                <td class="col-num">${totCartCost}</td>
                <td class="col-num">${totViewCost}</td>
                <td class="col-num">${totViewRate}</td>
                <td class="col-num">${fmtWan(totalPreOrders)}</td>
                <td class="col-num">${fmtWan(totalDirectPreOrders)}</td>
                <td class="col-num">${totPreOrderCost}</td>
                <td class="col-num">${totDirectOrderCost}</td>
                <td class="col-num">${totDirectPreOrderCost}</td>
            </tr>`;

            tbody.innerHTML = html;

            // 绑定展开/收起
            tbody.querySelectorAll('.crowd-rule-layer-row').forEach(row => {
                row.addEventListener('click', () => {
                    const lid = row.dataset.layerId;
                    const isExpanded = row.classList.toggle('crowd-rule-expanded');
                    tbody.querySelectorAll(`[data-parent-layer="${lid}"]`).forEach(sub => {
                        sub.classList.toggle('crowd-rule-sub-visible', isExpanded);
                    });
                    const icon = row.querySelector('.crowd-rule-expand-icon');
                    if (icon) icon.textContent = isExpanded ? '▼' : '▶';
                });
            });
        }

        /* ══════════════════════════════════
           渲染：近7天每日明细
           ══════════════════════════════════ */
        function renderDailyDetailTable(daily) {
            const tbody = document.getElementById('daily-detail-table-body');
            if (!tbody) return;

            // 取近7天数据（daily 按日期降序，取前7条，再翻转为升序）
            const last7 = (daily || []).slice(0, 7).reverse();

            if (!last7.length) {
                tbody.innerHTML = '<tr><td colspan="18" class="table-loading">暂无每日数据</td></tr>';
                return;
            }

            const agentPlanMap = homePlanData?.agentPlanByDate || null;
            const planCostMap = homePlanData?.planCostByDate || null;
            const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

            let totalCost = 0, totalLiveCost = 0, totalViews = 0, totalOrders = 0, totalCart = 0, totalPreOrders = 0, totalPlanCost = 0;
            let totalDirectOrders = 0, totalDirectPreOrders = 0;

            let html = '';
            last7.forEach(row => {
                const date = row.label || '';
                const dt = new Date(date + 'T00:00:00+08:00');
                const weekDay = weekDays[dt.getDay()];

                const adCost = Number(row.cost || 0);
                const liveCost = agentPlanMap instanceof Map ? (agentPlanMap.get(date) || 0) : (agentPlanMap?.[date] || 0);
                const planCost = planCostMap instanceof Map ? (planCostMap.get(date) || 0) : (planCostMap?.[date] || 0);
                const allCost = adCost + liveCost;
                const views = Number(row.views || 0);
                const orders = Number(row.orders || 0);
                const cart = Number(row.cart || 0);
                const preOrders = Number(row.preOrders || 0);
                const directOrders = Number(row.directOrders || 0);
                const directPreOrders = Number(row.directPreOrders || 0);
                const viewCost = views > 0 ? adCost / views : 0;
                const cartCost = cart > 0 ? adCost / cart : 0;
                const viewConvertRate = views > 0 ? directOrders / views : 0;
                const orderCost = orders > 0 ? adCost / orders : 0;
                const preOrderCost = preOrders > 0 ? adCost / preOrders : 0;
                const directOrderCost = directOrders > 0 ? adCost / directOrders : 0;
                const directPreOrderCost = directPreOrders > 0 ? adCost / directPreOrders : 0;

                totalCost += adCost;
                totalLiveCost += liveCost;
                totalViews += views;
                totalOrders += orders;
                totalCart += cart;
                totalPreOrders += preOrders;
                totalDirectOrders += directOrders;
                totalDirectPreOrders += directPreOrders;
                totalPlanCost += planCost;

                html += `<tr>
                    <td class="col-label">${esc(fmtDate(date))}</td>
                    <td class="col-label">${esc(weekDay)}</td>
                    <td class="col-label">--</td>
                    <td class="col-num">${fmtWan(allCost)}</td>
                    <td class="col-num">${planCost > 0 ? fmtWan(planCost) : '--'}</td>
                    <td class="col-num">${fmtWan(liveCost)}</td>
                    <td class="col-num">${fmtWan(adCost)}</td>
                    <td class="col-num">${fmtWan(views)}</td>
                    <td class="col-num">${fmtWan(directOrders)}</td>
                    <td class="col-num">${fmtWan(cart)}</td>
                    <td class="col-num">${cartCost > 0 ? cartCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${viewCost > 0 ? viewCost.toFixed(2) : '--'}</td>
                    <td class="col-num">${viewConvertRate > 0 ? (viewConvertRate * 100).toFixed(1) + '%' : '--'}</td>
                    <td class="col-num">${fmtWan(preOrders)}</td>
                    <td class="col-num">${fmtWan(directPreOrders)}</td>
                    <td class="col-num">${preOrderCost > 0 ? preOrderCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${directOrderCost > 0 ? directOrderCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${directPreOrderCost > 0 ? directPreOrderCost.toFixed(1) : '--'}</td>
                </tr>`;
            });

            // 汇总行
            const totalAllCost = totalCost + totalLiveCost;
            const avgCartCost = totalCart > 0 ? totalCost / totalCart : 0;
            const avgViewCost = totalViews > 0 ? totalCost / totalViews : 0;
            const avgViewRate = totalViews > 0 ? totalDirectOrders / totalViews : 0;
            const avgOrderCost = totalOrders > 0 ? totalCost / totalOrders : 0;
            const avgPreOrderCost = totalPreOrders > 0 ? totalCost / totalPreOrders : 0;
            const avgDirectOrderCost = totalDirectOrders > 0 ? totalCost / totalDirectOrders : 0;
            const avgDirectPreOrderCost = totalDirectPreOrders > 0 ? totalCost / totalDirectPreOrders : 0;

            html += `<tr class="kpi-summary-row">
                <td class="col-label" colspan="3">7日汇总</td>
                <td class="col-num">${fmtWan(totalAllCost)}</td>
                <td class="col-num">${totalPlanCost > 0 ? fmtWan(totalPlanCost) : '--'}</td>
                <td class="col-num">${fmtWan(totalLiveCost)}</td>
                <td class="col-num">${fmtWan(totalCost)}</td>
                <td class="col-num">${fmtWan(totalViews)}</td>
                <td class="col-num">${fmtWan(totalDirectOrders)}</td>
                <td class="col-num">${fmtWan(totalCart)}</td>
                <td class="col-num">${avgCartCost > 0 ? avgCartCost.toFixed(1) : '--'}</td>
                <td class="col-num">${avgViewCost > 0 ? avgViewCost.toFixed(2) : '--'}</td>
                <td class="col-num">${avgViewRate > 0 ? (avgViewRate * 100).toFixed(1) + '%' : '--'}</td>
                <td class="col-num">${fmtWan(totalPreOrders)}</td>
                <td class="col-num">${fmtWan(totalDirectPreOrders)}</td>
                <td class="col-num">${avgPreOrderCost > 0 ? avgPreOrderCost.toFixed(1) : '--'}</td>
                <td class="col-num">${avgDirectOrderCost > 0 ? avgDirectOrderCost.toFixed(1) : '--'}</td>
                <td class="col-num">${avgDirectPreOrderCost > 0 ? avgDirectPreOrderCost.toFixed(1) : '--'}</td>
            </tr>`;

            tbody.innerHTML = html;
        }

        /* [已删除] renderFindings / renderRisks / renderCrowdTable / renderProductTable / renderHistoryTable / renderAiAnalysis / renderActionItems / renderHomeChart */

        /* ════════════════════════════════
           渲染：同比去年对比表
           ════════════════════════════════ */
        function renderYoyTable() {
            const tbody = document.getElementById('yoy-table-body');
            if (!tbody) return;

            const curData = homeYoyCurrent;
            const refData = homeYoyReference;

            if (!curData && !refData) {
                tbody.innerHTML = '<tr><td colspan="17" class="table-loading">暂无同比数据</td></tr>';
                return;
            }

            const today = shanghaiToday();
            const curYear = today.slice(0, 4);
            const refYear = String(Number(curYear) - 1);
            const dayStr = today.slice(8, 10);

            // 从 daily 数组中取实际最后数据日期
            function getLastDataDate(dailyArr) {
                if (!dailyArr || dailyArr.length === 0) return null;
                const dates = dailyArr.map(r => r.label).filter(Boolean).sort();
                return dates[dates.length - 1] || null;
            }
            // 格式化为 "YYYY/M/D" 显示格式
            function fmtDateLabel(dateStr) {
                if (!dateStr) return '--';
                const parts = dateStr.split('-');
                return `${parts[0]}/${Number(parts[1])}/${Number(parts[2])}`;
            }

            // 聚合当年数据：同比从 YOY_MONTH-01（5/1）起算，覆盖跨月大促（5→6月），
            // 今年侧取该日期之后的全部数据（剔除主区间带进来的「上月」数据），
            // 截止日由 curLastDate 决定、去年按同月同日对齐。
            const curDaily = (curData?.daily || []).filter(r => r.label && r.label >= `${curYear}-${YOY_MONTH}-01`);
            const curAdCost = curDaily.reduce((s, r) => s + (Number(r.cost) || 0), 0);
            const curViews = curDaily.reduce((s, r) => s + (Number(r.views) || 0), 0);
            const curOrders = curDaily.reduce((s, r) => s + (Number(r.orders) || 0), 0);
            const curCart = curDaily.reduce((s, r) => s + (Number(r.cart) || 0), 0);
            const curPreOrders = curDaily.reduce((s, r) => s + (Number(r.preOrders) || 0), 0);
            const curDirectOrders = curDaily.reduce((s, r) => s + (Number(r.directOrders) || 0), 0);
            const curDirectPreOrders = curDaily.reduce((s, r) => s + (Number(r.directPreOrders) || 0), 0);

            // 有客代投 - 当年
            const agentMap = homePlanData?.agentPlanByDate;
            let curAgentCost = 0;
            if (agentMap) {
                curDaily.forEach(r => {
                    if (r.label) {
                        const v = agentMap instanceof Map ? agentMap.get(r.label) : (agentMap[r.label] || 0);
                        curAgentCost += Number(v || 0);
                    }
                });
            }
            const curTotalCost = curAdCost + curAgentCost; // 总花费 = 广告 + 有客
            // 今年对应日期的计划花费
            const planCostByDate = homePlanData?.planCostByDate;
            let curPlanCost = 0;
            if (planCostByDate) {
                curDaily.forEach(r => { if (r.label) curPlanCost += planCostByDate.get(r.label) || 0; });
            }
            const curCartCost = curCart > 0 ? curAdCost / curCart : 0;
            const curViewCost = curViews > 0 ? curAdCost / curViews : 0;
            const curViewRate = curViews > 0 ? curDirectOrders / curViews : 0;
            const curOrderCost = curOrders > 0 ? curAdCost / curOrders : 0;
            const curPreOrderCost = curPreOrders > 0 ? curAdCost / curPreOrders : 0;
            const curDirectOrderCost = curDirectOrders > 0 ? curAdCost / curDirectOrders : 0;
            const curDirectPreOrderCost = curDirectPreOrders > 0 ? curAdCost / curDirectPreOrders : 0;

            // 今年最后数据日期
            const curLastDate = getLastDataDate(curDaily);
            const curLastDay = curLastDate ? curLastDate.split('-')[2] : dayStr;
            // 去年截止日 = 去年的「今年最新数据日同月同日」，支持跨月对齐（如今年到 6/10 → 去年到 2025-06-10）。
            const refStart = `${refYear}-${YOY_MONTH}-01`;
            const refCutoffDate = curLastDate ? `${refYear}-${curLastDate.slice(5)}` : `${refYear}-${YOY_MONTH}-${dayStr}`;

            // 聚合去年数据（区间：refStart..refCutoffDate，与今年同期对齐）
            const refDaily = refData?.daily || [];
            const refDailyFiltered = refDaily.filter(r => r.label && r.label >= refStart && r.label <= refCutoffDate);
            const refAdCost = refDailyFiltered.reduce((s, r) => s + (Number(r.cost) || 0), 0);
            const refViews = refDailyFiltered.reduce((s, r) => s + (Number(r.views) || 0), 0);
            const refOrders = refDailyFiltered.reduce((s, r) => s + (Number(r.orders) || 0), 0);
            const refCart = refDailyFiltered.reduce((s, r) => s + (Number(r.cart) || 0), 0);
            const refPreOrders = refDailyFiltered.reduce((s, r) => s + (Number(r.preOrders) || 0), 0);
            const refDirectOrders = refDailyFiltered.reduce((s, r) => s + (Number(r.directOrders) || 0), 0);
            const refDirectPreOrders = refDailyFiltered.reduce((s, r) => s + (Number(r.directPreOrders) || 0), 0);

            // 有客代投 - 去年
            let refAgentCost = 0;
            const refAgentMap = homePlanData?.refAgentByDate;
            if (refAgentMap) {
                refDailyFiltered.forEach(r => {
                    if (r.label) {
                        const v = refAgentMap instanceof Map ? refAgentMap.get(r.label) : (refAgentMap[r.label] || 0);
                        refAgentCost += Number(v || 0);
                    }
                });
            }
            const refTotalCost = refAdCost + refAgentCost;
            const refCartCost = refCart > 0 ? refAdCost / refCart : 0;
            const refViewCost = refViews > 0 ? refAdCost / refViews : 0;
            const refViewRate = refViews > 0 ? refDirectOrders / refViews : 0;
            const refOrderCost = refOrders > 0 ? refAdCost / refOrders : 0;
            const refPreOrderCost = refPreOrders > 0 ? refAdCost / refPreOrders : 0;
            const refDirectOrderCost = refDirectOrders > 0 ? refAdCost / refDirectOrders : 0;
            const refDirectPreOrderCost = refDirectPreOrders > 0 ? refAdCost / refDirectPreOrders : 0;

            function dataRow(label1, label2, total, plan, live, ad, views, orders, directOrders, cart, cartCost, vc, vr, oc, po, directPreOrders, poc, doc, dpoc) {
                return `<tr>
                    <td class="col-label">${esc(label1)}</td>
                    <td class="col-label">${esc(label2)}</td>
                    <td class="col-num">${fmtWan(total)}</td>
                    <td class="col-num">${plan > 0 ? fmtWan(plan) : '--'}</td>
                    <td class="col-num">${fmtWan(live)}</td>
                    <td class="col-num">${fmtWan(ad)}</td>
                    <td class="col-num">${fmtWan(views)}</td>
                    <td class="col-num">${fmtWan(directOrders)}</td>
                    <td class="col-num">${fmtWan(cart)}</td>
                    <td class="col-num">${cartCost > 0 ? cartCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${vc > 0 ? vc.toFixed(2) : '--'}</td>
                    <td class="col-num">${vr > 0 ? (vr * 100).toFixed(1) + '%' : '--'}</td>
                    <td class="col-num">${fmtWan(po)}</td>
                    <td class="col-num">${fmtWan(directPreOrders)}</td>
                    <td class="col-num">${poc > 0 ? poc.toFixed(1) : '--'}</td>
                    <td class="col-num">${doc > 0 ? doc.toFixed(1) : '--'}</td>
                    <td class="col-num">${dpoc > 0 ? dpoc.toFixed(1) : '--'}</td>
                </tr>`;
            }

            const curRow = dataRow(
                `${curYear}/${Number(YOY_MONTH)}/1`, curLastDate ? fmtDateLabel(curLastDate) : `${curYear}/${Number(YOY_MONTH)}/${Number(dayStr)}`,
                curTotalCost, curPlanCost, curAgentCost, curAdCost,
                curViews, curOrders, curDirectOrders, curCart,
                curCartCost, curViewCost, curViewRate, curOrderCost,
                curPreOrders, curDirectPreOrders, curPreOrderCost,
                curDirectOrderCost, curDirectPreOrderCost
            );
            const refRow = dataRow(
                `${refYear}/${Number(YOY_MONTH)}/1`, curLastDate ? `${refYear}/${Number(curLastDate.split('-')[1])}/${Number(curLastDay)}` : `${refYear}/${Number(YOY_MONTH)}/${Number(dayStr)}`,
                refTotalCost, 0, refAgentCost, refAdCost,
                refViews, refOrders, refDirectOrders, refCart,
                refCartCost, refViewCost, refViewRate, refOrderCost,
                refPreOrders, refDirectPreOrders, refPreOrderCost,
                refDirectOrderCost, refDirectPreOrderCost
            );

            // 增涨行
            const deltaRow = `<tr class="yoy-delta-row">
                <td class="col-label" colspan="2">增涨</td>
                <td class="col-num">${fmtDelta(curTotalCost - refTotalCost)}</td>
                <td class="col-num">--</td>
                <td class="col-num">${fmtDelta(curAgentCost - refAgentCost)}</td>
                <td class="col-num">${fmtDelta(curAdCost - refAdCost)}</td>
                <td class="col-num">${fmtDelta(curViews - refViews)}</td>
                <td class="col-num">${fmtDelta(curDirectOrders - refDirectOrders)}</td>
                <td class="col-num">${fmtDelta(curCart - refCart)}</td>
                <td class="col-num">${fmtDeltaFixed(curCartCost - refCartCost, 1)}</td>
                <td class="col-num">${fmtDeltaFixed(curViewCost - refViewCost, 2)}</td>
                <td class="col-num">${fmtDeltaPct(curViewRate - refViewRate)}</td>
                <td class="col-num">${fmtDelta(curPreOrders - refPreOrders)}</td>
                <td class="col-num">${fmtDelta(curDirectPreOrders - refDirectPreOrders)}</td>
                <td class="col-num">${fmtDeltaFixed(curPreOrderCost - refPreOrderCost, 1)}</td>
                <td class="col-num">${fmtDeltaFixed(curDirectOrderCost - refDirectOrderCost, 1)}</td>
                <td class="col-num">${fmtDeltaFixed(curDirectPreOrderCost - refDirectPreOrderCost, 1)}</td>
            </tr>`;

            // 同比%行
            const pctRow = `<tr class="yoy-pct-row">
                <td class="col-label" colspan="2">同比%</td>
                <td class="col-num">${fmtYoyPct(curTotalCost, refTotalCost)}</td>
                <td class="col-num">--</td>
                <td class="col-num">${fmtYoyPct(curAgentCost, refAgentCost)}</td>
                <td class="col-num">${fmtYoyPct(curAdCost, refAdCost)}</td>
                <td class="col-num">${fmtYoyPct(curViews, refViews)}</td>
                <td class="col-num">${fmtYoyPct(curDirectOrders, refDirectOrders)}</td>
                <td class="col-num">${fmtYoyPct(curCart, refCart)}</td>
                <td class="col-num">${fmtYoyPct(curCartCost, refCartCost)}</td>
                <td class="col-num">${fmtYoyPct(curViewCost, refViewCost)}</td>
                <td class="col-num">${fmtYoyPct(curViewRate, refViewRate)}</td>
                <td class="col-num">${fmtYoyPct(curPreOrders, refPreOrders)}</td>
                <td class="col-num">${fmtYoyPct(curDirectPreOrders, refDirectPreOrders)}</td>
                <td class="col-num">${fmtYoyPct(curPreOrderCost, refPreOrderCost)}</td>
                <td class="col-num">${fmtYoyPct(curDirectOrderCost, refDirectOrderCost)}</td>
                <td class="col-num">${fmtYoyPct(curDirectPreOrderCost, refDirectPreOrderCost)}</td>
            </tr>`;

            tbody.innerHTML = curRow + refRow + deltaRow + pctRow;
        }

        /* ══════════════════════════════════
           渲染：节奏对比表（按活动节奏分组）
           ══════════════════════════════════ */

        // 活动类型元数据
        const ACTIVITY_TYPE_META = {
            daily: { label: '日常期', color: '#64748b' },
            presale_warmup: { label: '预售预热期', color: '#f59e0b' },
            presale_deposit: { label: '预售付定金期', color: '#ef4444' },
            presale_balance: { label: '预售付尾款期', color: '#8b5cf6' },
            spot_warmup: { label: '现货预热期', color: '#06b6d4' },
            spot_burst: { label: '现货爆发期', color: '#ec4899' },
        };

        function getActivityMeta(type) {
            return ACTIVITY_TYPE_META[type] || { label: type || '未分类', color: '#94a3b8' };
        }

        /** 节奏分组的 key */
        function rhythmKey(day) {
            if (day.activity_source === 'activity' && day.activity) {
                return (day.activity_type || 'daily') + '::' + (day.activity || '');
            }
            if (day.activity_source === 'override' && day.activity) {
                return 'override::' + (day.activity_type || 'daily') + '::' + (day.activity || '');
            }
            return 'none';
        }

        /** 按连续相同节奏分组 */
        function buildRhythmSegments(days) {
            if (!days || !days.length) return [];
            const segs = [];
            let cur = { key: rhythmKey(days[0]), days: [days[0]] };
            for (let i = 1; i < days.length; i++) {
                const k = rhythmKey(days[i]);
                if (k === cur.key) { cur.days.push(days[i]); }
                else { segs.push(cur); cur = { key: k, days: [days[i]] }; }
            }
            segs.push(cur);
            return segs;
        }

        /** 聚合一段节奏天数的数据 */
        function summarizeRhythmSegment(segDays) {
            const n = segDays.length;
            let wxPlan = 0, agPlan = 0, totalPlan = 0, actualCost = 0;
            let refAmount = 0, refAgentAmount = 0, refViews = 0, refOrders = 0;
            let refDirectOrders = 0, refCart = 0, refPreOrders = 0;

            segDays.forEach(d => {
                wxPlan += Number(d.wanxiang_plan || 0);
                agPlan += Number(d.agent_plan || 0);
                totalPlan += Number(d.total_plan_amount || 0);
                actualCost += Number(d.actual_cost || 0);
                refAmount += Number(d.reference_amount || 0);
                refAgentAmount += Number(d.agent_amount || 0);
                refViews += Number(d.reference_views || 0);
                refOrders += Number(d.reference_orders || 0);
                refDirectOrders += Number(d.reference_direct_orders || 0);
                refCart += Number(d.reference_cart || 0);
                refPreOrders += Number(d.reference_pre_orders || 0);
            });

            const refTotalWithAgent = refAmount + refAgentAmount;
            const completionRate = totalPlan > 0 ? actualCost / totalPlan : null;
            const diff = refTotalWithAgent > 0 ? totalPlan - refTotalWithAgent : null;
            const growth = refTotalWithAgent > 0 ? (totalPlan - refTotalWithAgent) / refTotalWithAgent : null;

            return {
                days: n,
                wxPlan, agPlan, totalPlan,
                dailyPlan: n > 0 ? totalPlan / n : 0,
                actualCost,
                dailyActual: n > 0 ? actualCost / n : 0,
                completionRate,
                refAmount,
                refAgentAmount,
                refTotalWithAgent,
                refViews, refOrders, refDirectOrders, refCart, refPreOrders,
                refOrderCost: refOrders > 0 ? refAmount / refOrders : 0,
                refCartCost: refCart > 0 ? refAmount / refCart : 0,
                diff,
                growth,
            };
        }

        /** 节奏判断 */
        function rhythmJudgment(growth) {
            if (growth == null) return { text: '-', cls: 'rhythm-j-flat' };
            if (growth > 0.3) return { text: '大幅加投', cls: 'rhythm-j-strong-up' };
            if (growth > 0.05) return { text: '加投', cls: 'rhythm-j-up' };
            if (growth >= -0.05) return { text: '持平', cls: 'rhythm-j-flat' };
            if (growth >= -0.3) return { text: '减投', cls: 'rhythm-j-down' };
            return { text: '大幅减投', cls: 'rhythm-j-strong-down' };
        }

        /** 渲染节奏对比表 */
        function renderRhythmComparisonTable() {
            const tbody = document.getElementById('rhythm-table-body');
            if (!tbody) return;

            const days = homePlanData?.rhythmDays || [];
            if (!days.length) {
                tbody.innerHTML = '<tr><td colspan="15" class="table-loading">暂无节奏数据</td></tr>';
                return;
            }

            const segs = buildRhythmSegments(days);
            const monthTotal = days.reduce((s, d) => s + (Number(d.total_plan_amount) || 0), 0);

            let html = '';
            // 汇总用
            let sumPlan = 0, sumActual = 0, sumRef = 0, sumRefAgent = 0;

            segs.forEach(seg => {
                const ds = seg.days;
                const d0 = ds[0].date;
                const d1 = ds[ds.length - 1].date;
                const range = d0 === d1 ? fmtDateShort(d0) : fmtDateShort(d0) + ' ~ ' + fmtDateShort(d1);

                const data = summarizeRhythmSegment(ds);
                const planShare = monthTotal > 0 ? data.totalPlan / monthTotal : 0;
                const jt = rhythmJudgment(data.growth);

                sumPlan += data.totalPlan;
                sumActual += data.actualCost;
                sumRef += data.refAmount;
                sumRefAgent += data.refAgentAmount;

                // 活动标签
                let labelHtml;
                if (seg.key === 'none') {
                    labelHtml = '<span class="plan-muted">\u2013</span>';
                } else {
                    const meta = getActivityMeta(ds[0].activity_type);
                    labelHtml = '<span class="rhythm-tag" style="background:' + meta.color + '20;color:' + meta.color + '">' + esc(meta.label) + '</span> ' + esc(ds[0].activity || '');
                }

                html += '<tr>'
                    + '<td class="col-label">' + esc(range) + '</td>'
                    + '<td class="col-label rs-label">' + labelHtml + '</td>'
                    + '<td class="col-num">' + data.days + '</td>'
                    + '<td class="col-num">' + fmtWan(data.totalPlan) + '</td>'
                    + '<td class="col-num">' + fmtWan(data.actualCost) + '</td>'
                    + '<td class="col-num">' + (data.completionRate != null ? (data.completionRate * 100).toFixed(1) + '%' : '--') + '</td>'
                    + '<td class="col-num">' + fmtWan(data.dailyPlan) + '</td>'
                    + '<td class="col-num">' + fmtWan(data.dailyActual) + '</td>'
                    + '<td class="col-num">' + (planShare > 0 ? (planShare * 100).toFixed(1) + '%' : '--') + '</td>'
                    + '<td class="col-num plan-ref-cell">' + fmtWan(data.refTotalWithAgent) + '</td>'
                    + '<td class="col-num plan-ref-cell">' + fmtWan(data.refAmount) + '</td>'
                    + '<td class="col-num plan-ref-cell">' + fmtWan(data.refAgentAmount) + '</td>'
                    + '<td class="col-num plan-ref-cell">' + (data.refOrderCost > 0 ? data.refOrderCost.toFixed(1) : '--') + '</td>'
                    + '<td class="col-num plan-ref-cell">' + (data.refCartCost > 0 ? data.refCartCost.toFixed(2) : '--') + '</td>'
                    + '<td class="col-num">' + (data.diff != null ? (data.diff >= 0 ? '+' : '') + fmtWan(data.diff) : '--') + '</td>'
                    + '<td class="col-num">' + (data.growth != null ? (data.growth >= 0 ? '+' : '') + (data.growth * 100).toFixed(1) + '%' : '--') + '</td>'
                    + '<td class="col-num"><span class="' + jt.cls + '">' + esc(jt.text) + '</span></td>'
                    + '</tr>';
            });

            // 汇总行
            const sumRefTotal = sumRef + sumRefAgent;
            const sumCompletion = sumPlan > 0 ? sumActual / sumPlan : 0;
            const sumDiff = sumRefTotal > 0 ? sumPlan - sumRefTotal : null;
            const sumGrowth = sumRefTotal > 0 ? (sumPlan - sumRefTotal) / sumRefTotal : null;
            const sumJt = rhythmJudgment(sumGrowth);

            html += '<tr class="kpi-summary-row">'
                + '<td class="col-label" colspan="2">汇总</td>'
                + '<td class="col-num">' + days.length + '</td>'
                + '<td class="col-num">' + fmtWan(sumPlan) + '</td>'
                + '<td class="col-num">' + fmtWan(sumActual) + '</td>'
                + '<td class="col-num">' + (sumCompletion > 0 ? (sumCompletion * 100).toFixed(1) + '%' : '--') + '</td>'
                + '<td class="col-num">' + fmtWan(days.length > 0 ? sumPlan / days.length : 0) + '</td>'
                + '<td class="col-num">' + fmtWan(days.length > 0 ? sumActual / days.length : 0) + '</td>'
                + '<td class="col-num">100%</td>'
                + '<td class="col-num plan-ref-cell">' + fmtWan(sumRefTotal) + '</td>'
                + '<td class="col-num plan-ref-cell">' + fmtWan(sumRef) + '</td>'
                + '<td class="col-num plan-ref-cell">' + fmtWan(sumRefAgent) + '</td>'
                + '<td class="col-num plan-ref-cell">--</td>'
                + '<td class="col-num plan-ref-cell">--</td>'
                + '<td class="col-num">' + (sumDiff != null ? (sumDiff >= 0 ? '+' : '') + fmtWan(sumDiff) : '--') + '</td>'
                + '<td class="col-num">' + (sumGrowth != null ? (sumGrowth >= 0 ? '+' : '') + (sumGrowth * 100).toFixed(1) + '%' : '--') + '</td>'
                + '<td class="col-num"><span class="' + sumJt.cls + '">' + esc(sumJt.text) + '</span></td>'
                + '</tr>';

            tbody.innerHTML = html;
        }

        /** 渲染节奏投放效果表：按活动节奏阶段汇总实际投放效果 */
        function renderRhythmDeliveryTable() {
            const tbody = document.getElementById('rhythm-delivery-table-body');
            if (!tbody) return;

            const days = homePlanData?.rhythmDays || [];
            const daily = homeDashboardData?.daily || [];
            const agentPlanMap = homePlanData?.agentPlanByDate || null;
            const planCostMap = homePlanData?.planCostByDate || null;

            if (!days.length || !daily.length) {
                tbody.innerHTML = '<tr><td colspan="18" class="table-loading">暂无 2026 节奏投放效果数据（需同时有节奏计划和投放日报数据）</td></tr>';
                return;
            }

            // 构建 日期 → rhythmPhase 映射
            const datePhaseMap = new Map();
            days.forEach(d => {
                if (d.date) datePhaseMap.set(d.date, d);
            });

            // 构建 daily 日期的数据映射
            const dailyMap = new Map();
            daily.forEach(r => {
                if (r.label) dailyMap.set(r.label, r);
            });

            // 按 rhythmKey 分组 daily 数据
            const phaseDailyMap = new Map();
            dailyMap.forEach((row, date) => {
                const phaseInfo = datePhaseMap.get(date);
                const key = phaseInfo ? rhythmKey(phaseInfo) : 'none';
                if (!phaseDailyMap.has(key)) {
                    phaseDailyMap.set(key, { key, rows: [] });
                }
                phaseDailyMap.get(key).rows.push(row);
            });

            // 构建 segment 列表（按 rhythmDays 顺序）
            const segs = buildRhythmSegments(days);

            const phaseRows = [];
            segs.forEach(seg => {
                const ds = seg.days;
                const entry = phaseDailyMap.get(seg.key);
                const rows = entry?.rows || [];
                const n = rows.length;

                // 时间范围与天数按「实际有投放数据」的日期截断，避免出现
                // 「节奏计划排到 6/1，但日报数据只到 5/30」时仍显示 5/27~6/1、6 天的误导。
                // 无数据的阶段（整段在最新数据日之后）回退到计划窗口并标注「无投放数据」。
                const planStart = ds[0].date;
                const planEnd = ds[ds.length - 1].date;
                const dataDates = rows.map(r => r.label).filter(Boolean).sort();
                const hasAnyData = dataDates.length > 0;
                const rStart = hasAnyData ? dataDates[0] : planStart;
                const rEnd = hasAnyData ? dataDates[dataDates.length - 1] : planEnd;
                const range = rStart === rEnd ? fmtDateShort(rStart) : fmtDateShort(rStart) + ' ~ ' + fmtDateShort(rEnd);
                const displayDays = hasAnyData ? dataDates.length : ds.length;

                if (n === 0) {
                    phaseRows.push({
                        range, label: seg.key, days: displayDays,
                        cost: 0, liveCost: 0, planCost: 0,
                        views: 0, orders: 0, directOrders: 0, cart: 0, preOrders: 0, directPreOrders: 0,
                        cartCost: 0, viewCost: 0, viewRate: 0, orderCost: 0, preOrderCost: 0,
                        directOrderCost: 0, directPreOrderCost: 0,
                        hasData: false,
                        activityType: ds[0].activity_type,
                        activity: ds[0].activity
                    });
                    return;
                }

                let adCost = 0, views = 0, orders = 0, cart = 0, preOrders = 0;
                let directOrders = 0, directPreOrders = 0;
                let liveCost = 0, planCost = 0;
                rows.forEach(r => {
                    adCost += Number(r.cost || 0);
                    views += Number(r.views || 0);
                    orders += Number(r.orders || 0);
                    directOrders += Number(r.directOrders || 0);
                    cart += Number(r.cart || 0);
                    preOrders += Number(r.preOrders || 0);
                    directPreOrders += Number(r.directPreOrders || 0);
                    const date = r.label;
                    if (agentPlanMap instanceof Map) {
                        liveCost += Number(agentPlanMap.get(date) || 0);
                    } else if (agentPlanMap) {
                        liveCost += Number(agentPlanMap[date] || 0);
                    }
                    if (planCostMap instanceof Map) {
                        planCost += Number(planCostMap.get(date) || 0);
                    } else if (planCostMap) {
                        planCost += Number(planCostMap[date] || 0);
                    }
                });
                const allCost = adCost + liveCost;
                const cartCost = cart > 0 ? adCost / cart : 0;
                const viewCost = views > 0 ? adCost / views : 0;
                const viewRate = views > 0 ? directOrders / views : 0;
                const orderCost = orders > 0 ? adCost / orders : 0;
                const preOrderCost = preOrders > 0 ? adCost / preOrders : 0;
                const directOrderCost = directOrders > 0 ? adCost / directOrders : 0;
                const directPreOrderCost = directPreOrders > 0 ? adCost / directPreOrders : 0;

                phaseRows.push({
                    range, label: seg.key, days: displayDays,
                    cost: adCost, liveCost, planCost,
                    views, orders, directOrders, cart, preOrders, directPreOrders,
                    cartCost, viewCost, viewRate, orderCost, preOrderCost,
                    directOrderCost, directPreOrderCost,
                    hasData: true,
                    activityType: ds[0].activity_type,
                    activity: ds[0].activity
                });
            });

            if (!phaseRows.length) {
                tbody.innerHTML = '<tr><td colspan="18" class="table-loading">暂无节奏投放效果数据</td></tr>';
                return;
            }

            let sumCost = 0, sumLive = 0, sumPlan = 0, sumViews = 0, sumOrders = 0, sumCart = 0, sumPreOrders = 0;
            let sumDirectOrders = 0, sumDirectPreOrders = 0;

            let html = '';
            phaseRows.forEach(pr => {
                sumCost += pr.cost; sumLive += pr.liveCost; sumPlan += pr.planCost;
                sumViews += pr.views; sumOrders += pr.orders; sumCart += pr.cart; sumPreOrders += pr.preOrders;
                sumDirectOrders += pr.directOrders; sumDirectPreOrders += pr.directPreOrders;

                let labelHtml;
                if (pr.key === 'none') {
                    labelHtml = '<span class="plan-muted">\u2013</span>';
                } else {
                    const meta = getActivityMeta(pr.activityType);
                    labelHtml = '<span class="rhythm-tag" style="background:' + meta.color + '20;color:' + meta.color + '">' + esc(meta.label) + '</span> ' + esc(pr.activity || '');
                }

                const dataDaysLabel = pr.hasData ? '' : ' <span class="rhythm-delivery-no-data">(无投放数据)</span>';

                html += '<tr>'
                    + '<td class="col-label">' + esc(pr.range) + '</td>'
                    + '<td class="col-label rs-label">' + labelHtml + '</td>'
                    + '<td class="col-num">' + pr.days + dataDaysLabel + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.cost + pr.liveCost) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.planCost > 0 ? fmtWan(pr.planCost) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.liveCost > 0 ? fmtWan(pr.liveCost) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.cost) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.views) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.directOrders) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.cart) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.cartCost > 0 ? pr.cartCost.toFixed(1) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.viewCost > 0 ? pr.viewCost.toFixed(2) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.viewRate > 0 ? (pr.viewRate * 100).toFixed(1) + '%' : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.preOrders) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.directPreOrders) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.preOrderCost > 0 ? pr.preOrderCost.toFixed(1) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.directOrderCost > 0 ? pr.directOrderCost.toFixed(1) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.directPreOrderCost > 0 ? pr.directPreOrderCost.toFixed(1) : '--') + '</td>'
                    + '</tr>';
            });

            const sumAllCost = sumCost + sumLive;
            const sumCartCost = sumCart > 0 ? sumCost / sumCart : 0;
            const sumViewCost = sumViews > 0 ? sumCost / sumViews : 0;
            const sumViewRate = sumViews > 0 ? sumDirectOrders / sumViews : 0;
            const sumOrderCost = sumOrders > 0 ? sumCost / sumOrders : 0;
            const sumPreOrderCost = sumPreOrders > 0 ? sumCost / sumPreOrders : 0;
            const sumDirectOrderCost = sumDirectOrders > 0 ? sumCost / sumDirectOrders : 0;
            const sumDirectPreOrderCost = sumDirectPreOrders > 0 ? sumCost / sumDirectPreOrders : 0;

            html += '<tr class="kpi-summary-row">'
                + '<td class="col-label" colspan="3">汇总</td>'
                + '<td class="col-num">' + fmtWan(sumAllCost) + '</td>'
                + '<td class="col-num">' + (sumPlan > 0 ? fmtWan(sumPlan) : '--') + '</td>'
                + '<td class="col-num">' + fmtWan(sumLive) + '</td>'
                + '<td class="col-num">' + fmtWan(sumCost) + '</td>'
                + '<td class="col-num">' + fmtWan(sumViews) + '</td>'
                + '<td class="col-num">' + fmtWan(sumDirectOrders) + '</td>'
                + '<td class="col-num">' + fmtWan(sumCart) + '</td>'
                + '<td class="col-num">' + (sumCartCost > 0 ? sumCartCost.toFixed(1) : '--') + '</td>'
                + '<td class="col-num">' + (sumViewCost > 0 ? sumViewCost.toFixed(2) : '--') + '</td>'
                + '<td class="col-num">' + (sumViewRate > 0 ? (sumViewRate * 100).toFixed(1) + '%' : '--') + '</td>'
                + '<td class="col-num">' + fmtWan(sumPreOrders) + '</td>'
                + '<td class="col-num">' + fmtWan(sumDirectPreOrders) + '</td>'
                + '<td class="col-num">' + (sumPreOrderCost > 0 ? sumPreOrderCost.toFixed(1) : '--') + '</td>'
                + '<td class="col-num">' + (sumDirectOrderCost > 0 ? sumDirectOrderCost.toFixed(1) : '--') + '</td>'
                + '<td class="col-num">' + (sumDirectPreOrderCost > 0 ? sumDirectPreOrderCost.toFixed(1) : '--') + '</td>'
                + '</tr>';

            tbody.innerHTML = html;
        }

        /** 渲染 2025 节奏投放效果表：按 SIX18_RHYTHM_PHASES 的 25 年 618 节奏分组 */
        function renderRhythm2025DeliveryTable() {
            const tbody = document.getElementById('rhythm-delivery-2025-table-body');
            if (!tbody) return;

            const allDays = homePlanData?.rhythmDays || [];
            // 与 2026 节奏表保持一致的时间范围：截到 2026 实际有投放数据的最后一天。
            // 否则 rhythmDays 计划窗口会把 2025 表铺到 6/1，而 2026 只到 5/30，两表不一致。
            const daily2026 = homeDashboardData?.daily || [];
            const lastData2026 = daily2026.map(r => r.label).filter(Boolean).sort().pop() || null;
            const days = lastData2026 ? allDays.filter(d => d.date && d.date <= lastData2026) : allDays;
            if (!days.length) {
                tbody.innerHTML = '<tr><td colspan="17" class="table-loading">暂无 2025 节奏投放效果数据</td></tr>';
                return;
            }

            // 25 年有客代投花费按 2025 日期映射（resource 包采买，计划=实际）
            const refAgentByDate = homePlanData?.refAgentByDate;

            // 从 plan-dashboard-reference-data.js 获取 25 年 618 节奏阶段定义
            const refData = window.PlanDashboardReferenceData || {};
            const rhythmPhases = refData.SIX18_RHYTHM_PHASES || [];
            if (!rhythmPhases.length) {
                tbody.innerHTML = '<tr><td colspan="17" class="table-loading">未加载 2025 年 618 节奏配置</td></tr>';
                return;
            }

            // 解析 shortDate "5/1-5/5" → { startDate, endDate } 并展开每天日期列表
            // 顺序遍历各阶段，后面阶段覆盖前面（处理日期跨阶段重叠）
            const datePhaseMap = new Map(); // "2025-05-01" → phase index
            rhythmPhases.forEach((phase, idx) => {
                const parts = phase.shortDate.split('-');
                // parts: ["5/1", "5/5"] 或 ["5/27", "6/5"]
                const parseShort = s => {
                    const [m, d] = s.split('/');
                    return '2025-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
                };
                const startStr = parseShort(parts[0]);
                const endStr = parseShort(parts[1]);
                const cursor = new Date(startStr + 'T00:00:00Z');
                const endDate = new Date(endStr + 'T00:00:00Z');
                while (cursor <= endDate) {
                    datePhaseMap.set(cursor.toISOString().slice(0, 10), idx);
                    cursor.setUTCDate(cursor.getUTCDate() + 1);
                }
            });

            // 把 rhythmDays 转 2025 日期，查找所属节奏阶段
            const mapped = [];
            days.forEach(d => {
                const refDate = d.date.replace(/^\d{4}/, '2025');
                const phaseIdx = datePhaseMap.get(refDate);
                if (phaseIdx == null) return;
                const agentCost = refAgentByDate
                    ? Number((refAgentByDate instanceof Map ? refAgentByDate.get(refDate) : refAgentByDate[refDate]) || 0)
                    : 0;
                mapped.push({
                    refDate,
                    phaseIdx,
                    agentCost,
                    cost: Number(d.reference_amount || 0),
                    views: Number(d.reference_views || 0),
                    orders: Number(d.reference_orders || 0),
                    directOrders: Number(d.reference_direct_orders || 0),
                    cart: Number(d.reference_cart || 0),
                    preOrders: Number(d.reference_pre_orders || 0),
                    directPreOrders: Number(d.reference_direct_pre_orders || 0),
                });
            });

            if (!mapped.length) {
                tbody.innerHTML = '<tr><td colspan="17" class="table-loading">当前日期范围在 2025 节奏数据之外</td></tr>';
                return;
            }

            // 按连续相同 phaseIdx 分组
            const segs = [];
            let cur = { phaseIdx: mapped[0].phaseIdx, items: [mapped[0]] };
            for (let i = 1; i < mapped.length; i++) {
                if (mapped[i].phaseIdx === cur.phaseIdx) {
                    cur.items.push(mapped[i]);
                } else {
                    segs.push(cur);
                    cur = { phaseIdx: mapped[i].phaseIdx, items: [mapped[i]] };
                }
            }
            segs.push(cur);

            const phaseRows = [];
            segs.forEach(seg => {
                const phase = rhythmPhases[seg.phaseIdx];
                const items = seg.items;
                const d0 = items[0].refDate;
                const d1 = items[items.length - 1].refDate;
                const range = d0 === d1 ? fmtDateShort(d0) : fmtDateShort(d0) + ' ~ ' + fmtDateShort(d1);

                let cost = 0, views = 0, orders = 0, cart = 0, preOrders = 0;
                let directOrders = 0, directPreOrders = 0, agentCost = 0;
                let hasData = false;
                items.forEach(it => {
                    cost += it.cost;
                    agentCost += it.agentCost;
                    views += it.views;
                    orders += it.orders;
                    directOrders += it.directOrders;
                    cart += it.cart;
                    preOrders += it.preOrders;
                    directPreOrders += it.directPreOrders;
                    if (it.cost > 0) hasData = true;
                });

                phaseRows.push({
                    range, days: items.length,
                    platformRhythm: phase.platformRhythm,
                    rhythmLabel: phase.rhythmLabel,
                    color: phase.color || '#94a3b8',
                    agentCost,
                    cost, views, orders, directOrders, cart, preOrders, directPreOrders,
                    cartCost: cart > 0 ? cost / cart : 0,
                    viewCost: views > 0 ? cost / views : 0,
                    viewRate: views > 0 ? directOrders / views : 0,
                    orderCost: orders > 0 ? cost / orders : 0,
                    preOrderCost: preOrders > 0 ? cost / preOrders : 0,
                    directOrderCost: directOrders > 0 ? cost / directOrders : 0,
                    directPreOrderCost: directPreOrders > 0 ? cost / directPreOrders : 0,
                    hasData,
                });
            });

            let sumCost = 0, sumViews = 0, sumOrders = 0, sumCart = 0, sumPreOrders = 0;
            let sumDirectOrders = 0, sumDirectPreOrders = 0, sumAgentCost = 0;
            let html = '';
            phaseRows.forEach(pr => {
                sumCost += pr.cost; sumViews += pr.views; sumOrders += pr.orders;
                sumCart += pr.cart; sumPreOrders += pr.preOrders;
                sumDirectOrders += pr.directOrders; sumDirectPreOrders += pr.directPreOrders;
                sumAgentCost += pr.agentCost;

                const labelHtml = '<span class="rhythm-tag" style="background:' + pr.color + '20;color:' + pr.color + '">'
                    + esc(pr.platformRhythm) + '</span> ' + esc(pr.rhythmLabel);
                const dataDaysLabel = pr.hasData ? '' : ' <span class="rhythm-delivery-no-data">(无投放数据)</span>';

                html += '<tr>'
                    + '<td class="col-label">' + esc(pr.range) + '</td>'
                    + '<td class="col-label rs-label">' + labelHtml + '</td>'
                    + '<td class="col-num">' + pr.days + dataDaysLabel + '</td>'
                    + '<td class="col-num">' + ((pr.hasData || pr.agentCost > 0) ? fmtWan(pr.cost + pr.agentCost) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.agentCost > 0 ? fmtWan(pr.agentCost) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.cost) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.views) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.directOrders) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.cart) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.cartCost > 0 ? pr.cartCost.toFixed(1) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.viewCost > 0 ? pr.viewCost.toFixed(2) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.viewRate > 0 ? (pr.viewRate * 100).toFixed(1) + '%' : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.preOrders) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.hasData ? fmtWan(pr.directPreOrders) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.preOrderCost > 0 ? pr.preOrderCost.toFixed(1) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.directOrderCost > 0 ? pr.directOrderCost.toFixed(1) : '--') + '</td>'
                    + '<td class="col-num">' + (pr.directPreOrderCost > 0 ? pr.directPreOrderCost.toFixed(1) : '--') + '</td>'
                    + '</tr>';
            });

            const sumCartCost = sumCart > 0 ? sumCost / sumCart : 0;
            const sumViewCost = sumViews > 0 ? sumCost / sumViews : 0;
            const sumViewRate = sumViews > 0 ? sumDirectOrders / sumViews : 0;
            const sumOrderCost = sumOrders > 0 ? sumCost / sumOrders : 0;
            const sumPreOrderCost = sumPreOrders > 0 ? sumCost / sumPreOrders : 0;
            const sumDirectOrderCost = sumDirectOrders > 0 ? sumCost / sumDirectOrders : 0;
            const sumDirectPreOrderCost = sumDirectPreOrders > 0 ? sumCost / sumDirectPreOrders : 0;

            html += '<tr class="kpi-summary-row">'
                + '<td class="col-label" colspan="3">汇总</td>'
                + '<td class="col-num">' + fmtWan(sumCost + sumAgentCost) + '</td>'
                + '<td class="col-num">' + (sumAgentCost > 0 ? fmtWan(sumAgentCost) : '--') + '</td>'
                + '<td class="col-num">' + fmtWan(sumCost) + '</td>'
                + '<td class="col-num">' + fmtWan(sumViews) + '</td>'
                + '<td class="col-num">' + fmtWan(sumDirectOrders) + '</td>'
                + '<td class="col-num">' + fmtWan(sumCart) + '</td>'
                + '<td class="col-num">' + (sumCartCost > 0 ? sumCartCost.toFixed(1) : '--') + '</td>'
                + '<td class="col-num">' + (sumViewCost > 0 ? sumViewCost.toFixed(2) : '--') + '</td>'
                + '<td class="col-num">' + (sumViewRate > 0 ? (sumViewRate * 100).toFixed(1) + '%' : '--') + '</td>'
                + '<td class="col-num">' + fmtWan(sumPreOrders) + '</td>'
                + '<td class="col-num">' + fmtWan(sumDirectPreOrders) + '</td>'
                + '<td class="col-num">' + (sumPreOrderCost > 0 ? sumPreOrderCost.toFixed(1) : '--') + '</td>'
                + '<td class="col-num">' + (sumDirectOrderCost > 0 ? sumDirectOrderCost.toFixed(1) : '--') + '</td>'
                + '<td class="col-num">' + (sumDirectPreOrderCost > 0 ? sumDirectPreOrderCost.toFixed(1) : '--') + '</td>'
                + '</tr>';

            tbody.innerHTML = html;
        }

        /** 格式化短日期 M/D */
        function fmtDateShort(dateStr) {
            if (!dateStr) return '';
            const parts = dateStr.split('-');
            return Number(parts[1]) + '/' + Number(parts[2]);
        }

        /* ══════════════════════════════════
           数据加载
           ══════════════════════════════════ */
        function rememberRedirect() {
            const url = window.location.href;
            if (authHelpers.rememberRedirect) authHelpers.rememberRedirect(url);
            else try { localStorage.setItem('feishu_redirect', url); } catch { /* noop */ }
        }

        function redirectToLogin(msg) {
            if (homeInsightsAuthRedirectScheduled) return;
            homeInsightsAuthRedirectScheduled = true;
            if (typeof authHelpers.handleReauthRequired === 'function') {
                authHelpers.handleReauthRequired({ source: 'home', targetUrl: window.location.href, force: true, reason: 'reauth_required', delayMs: 1200 });
                return;
            }
            rememberRedirect();
            setTimeout(() => window.location.replace('auth/index.html?force=1'), 1200);
        }

        /* 主渲染：拿到所有数据后统一渲染 */
        function renderAll() {
            const ads = homeDashboardData;
            const daily = ads?.daily || [];
            const latest = daily[0] || null;
            const prev = daily[1] || null;
            const report = homeReportItem;
            const alertCount = (homeAlertItems || []).length;

            // 报头
            const latestDate = latest?.label || shanghaiToday();
            const isToday = latestDate === shanghaiToday();
            setText('daily-date-label', isToday ? `${formatDateLabel(latestDate)} · 今日日报` : `${formatDateLabel(latestDate)} · 日报`);
            setText('daily-freshness', latest ? `数据更新至 ${latestDate}` : '暂无可用数据');

            // 各区域独立渲染，一个出错不影响其他
            const sections = [
                ['kpi-table',  () => renderKpiTable(daily, latest, prev)],
                ['daily-detail', () => renderDailyDetailTable(daily)],
                ['yoy', () => renderYoyTable()],
                ['rhythm-delivery', () => renderRhythmDeliveryTable()],
                ['rhythm-delivery-2025', () => renderRhythm2025DeliveryTable()],
                ['crowd-rule', () => renderCrowdRuleSection(homeCrowdRuleData)],
            ];
            sections.forEach(([name, fn]) => {
                try { fn(); } catch (err) { console.error(`[home] render ${name} failed:`, err); }
            });
        }

        /* ══════════════════════════════════
           数据加载失败时显示错误提示
           ══════════════════════════════════ */
        function showDataLoadError(errors) {
            // 在各区域显示具体的错误提示
            ['kpi-table-body', 'daily-detail-table-body', 'yoy-table-body', 'rhythm-delivery-table-body', 'rhythm-delivery-2025-table-body', 'crowd-rule-table-body'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const cols = id === 'yoy-table-body' ? 17 : (id === 'rhythm-delivery-2025-table-body' ? 15 : (id === 'crowd-rule-table-body' ? 13 : 18));
                    el.innerHTML = `<tr><td colspan="${cols}" class="table-loading table-error">数据加载失败，请刷新重试</td></tr>`;
                }
            });

            // 在控制台输出详细错误便于排查
            errors.forEach(e => console.error('[home] API error:', e));
        }

        /* ── localStorage 持久缓存 ── */
        const HOME_STORAGE_KEY = 'home_data_cache';
        const HOME_STORAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

        function readHomeStorageCache() {
            try {
                const raw = localStorage.getItem(HOME_STORAGE_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.data || !parsed.cachedAt) return null;
                if (Date.now() - parsed.cachedAt > HOME_STORAGE_MAX_AGE_MS) {
                    localStorage.removeItem(HOME_STORAGE_KEY);
                    return null;
                }
                return parsed;
            } catch { return null; }
        }

        function writeHomeStorageCache(data) {
            try {
                localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify({ data, cachedAt: Date.now() }));
            } catch { /* quota exceeded — ignore */ }
        }

        /* 解析 home-data 合并接口的响应为内部 result 格式 */
        function parseHomeDataResponse(payload) {
            const result = { payload: null, dashboardData: null, alertItems: [], reportItem: null, planData: null, yoyCurrent: null, yoyReference: null, crowdRule: null, errors: [] };

            const mainData = payload.main;
            if (mainData && !mainData.error) {
                result.payload = mainData;
                result.dashboardData = mainData.ads || null;
            } else {
                result.errors.push(mainData?.error || 'main data unavailable');
            }

            const planRaw = payload.plan;
            if (planRaw && !planRaw.error) {
                try { result.planData = parsePlanData(planRaw); } catch (e) { console.warn('[home] plan parse error:', e); }
            }

            const yoyCurData = payload.yoyCur;
            if (yoyCurData && !yoyCurData.error) {
                result.yoyCurrent = yoyCurData.ads || yoyCurData;
            }

            const yoyRefData = payload.yoyRef;
            if (yoyRefData && !yoyRefData.error) {
                result.yoyReference = yoyRefData.ads || yoyRefData;
            }

            const crowdRuleData = payload.crowdRule;
            if (crowdRuleData && !crowdRuleData.error) {
                result.crowdRule = crowdRuleData.crowd || null;
            }

            return result;
        }

        /* 拉取全部首页数据（单请求合并接口，回退到多请求） */
        async function fetchFreshData() {
            const today = shanghaiToday();

            // 优先使用合并接口 home-data
            try {
                const resp = await authHelpers.fetchFunctionJson('home-data', {
                    query: { today: today, yoy_month: YOY_MONTH },
                    parseErrorMessage: '首页数据读取失败',
                    includePromptAdminToken: true,
                    useSessionToken: true,
                    onUnauthorized: () => {
                        if (!homeInsightsAuthRedirectScheduled) {
                            homeInsightsAuthRedirectScheduled = true;
                            authHelpers.handleReauthRequired();
                        }
                    },
                });
                const payload = resp.data || resp;
                if (payload && payload.success) {
                    return parseHomeDataResponse(payload);
                }
            } catch (e) {
                console.warn('[home] home-data endpoint failed, falling back to multi-request:', e.message || e);
            }

            // 回退：原有多请求逻辑
            return fetchFreshDataLegacy();
        }

        /* 原有多请求逻辑（作为回退） */
        async function fetchFreshDataLegacy() {
            const today = shanghaiToday();
            const monthEnd = today;
            const windowStart = (() => {
                let y = Number(today.slice(0, 4));
                let m = Number(today.slice(5, 7)) - 1;
                if (m === 0) { m = 12; y -= 1; }
                return `${y}-${String(m).padStart(2, '0')}-01`;
            })();
            const curYear = today.slice(0, 4);
            const refYear = String(Number(curYear) - 1);
            const yoyCurStart = `${curYear}-${YOY_MONTH}-01`;
            const yoyRefStart = `${refYear}-${YOY_MONTH}-01`;
            const yoyRefEnd = `${refYear}-${today.slice(5)}`;
            const canReuseMainForYoy = windowStart === yoyCurStart;

            const requests = [
                authHelpers.fetchFunctionJson('dashboard-data', {
                    query: { sections: 'ads', start_date: windowStart, end_date: today },
                    parseErrorMessage: '看板数据读取失败',
                    onUnauthorized: () => { /* noop */ },
                }),
                authHelpers.fetchFunctionJson('plan-dashboard-summary', {
                    query: { start: windowStart, end: monthEnd },
                    includePromptAdminToken: true,
                    useSessionToken: true,
                }).catch(e => ({ error: e })),
                authHelpers.fetchFunctionJson('dashboard-data', {
                    query: { sections: 'ads', start_date: yoyRefStart, end_date: yoyRefEnd },
                }).catch(e => ({ error: e })),
                authHelpers.fetchFunctionJson('dashboard-data', {
                    query: { sections: 'crowd', start_date: windowStart, end_date: monthEnd, crowd_plan_name_includes: '规则' },
                }).catch(e => ({ error: e })),
            ];
            if (!canReuseMainForYoy) {
                requests.push(
                    authHelpers.fetchFunctionJson('dashboard-data', {
                        query: { sections: 'ads', start_date: yoyCurStart, end_date: today },
                    }).catch(e => ({ error: e }))
                );
            }

            const settled = await Promise.allSettled(requests);
            const [dashResult, planResult, yoyRefResult, crowdRuleResult] = settled;
            const yoyCurResult = canReuseMainForYoy ? dashResult : settled[4];

            const result = { payload: null, dashboardData: null, alertItems: [], reportItem: null, planData: null, yoyCurrent: null, yoyReference: null, crowdRule: null, errors: [] };

            if (dashResult.status === 'fulfilled') {
                const data = dashResult.value.data || dashResult.value;
                result.payload = data;
                result.dashboardData = data.ads || null;
            } else {
                result.errors.push(dashResult.reason);
            }

            if (planResult.status === 'fulfilled' && planResult.value && !planResult.value.error) {
                try { result.planData = parsePlanData(planResult.value.data || planResult.value); } catch (e) { console.warn('[home] plan parse error:', e); }
            }
            if (yoyCurResult.status === 'fulfilled' && yoyCurResult.value && !yoyCurResult.value.error) {
                const d = yoyCurResult.value.data || yoyCurResult.value;
                result.yoyCurrent = d.ads || d;
            }
            if (yoyRefResult.status === 'fulfilled' && yoyRefResult.value && !yoyRefResult.value.error) {
                const d = yoyRefResult.value.data || yoyRefResult.value;
                result.yoyReference = d.ads || d;
            }
            if (crowdRuleResult.status === 'fulfilled' && crowdRuleResult.value && !crowdRuleResult.value.error) {
                const d = crowdRuleResult.value.data || crowdRuleResult.value;
                result.crowdRule = d.crowd || null;
            }

            return result;
        }

        /* 将拉取结果写入全局变量 */
        function applyFreshData(fresh) {
            homeFullPayload = fresh.payload;
            homeDashboardData = fresh.dashboardData;
            homeAlertItems = fresh.alertItems;
            homeReportItem = fresh.reportItem;
            homePlanData = fresh.planData;
            homeYoyCurrent = fresh.yoyCurrent;
            homeYoyReference = fresh.yoyReference;
            homeCrowdRuleData = fresh.crowdRule || null;

            if (homeDashboardData && homeDashboardData.daily) {
                homeDashboardData.daily.sort((a, b) => (b.label || '').localeCompare(a.label || ''));
            }
            if (homeYoyCurrent && homeYoyCurrent.daily) {
                homeYoyCurrent.daily.sort((a, b) => (b.label || '').localeCompare(a.label || ''));
            }
            if (homeYoyReference && homeYoyReference.daily) {
                homeYoyReference.daily.sort((a, b) => (b.label || '').localeCompare(a.label || ''));
            }
        }

        /* 主入口：stale-while-revalidate + localStorage 先渲染 */
        async function loadHomeData() {
            const STALE_MS = 2 * 60 * 1000;
            const now = Date.now();

            // ── 1. 内存缓存新鲜：立即渲染 + 后台刷新 ──
            if (homeDataCache && (now - homeDataCacheTime) < STALE_MS) {
                applyFreshData(homeDataCache);
                renderAll();
                fetchFreshData().then(fresh => {
                    if (fresh.payload) {
                        homeDataCache = fresh;
                        homeDataCacheTime = Date.now();
                        writeHomeStorageCache(fresh);
                        applyFreshData(fresh);
                        renderAll();
                    }
                }).catch(() => {});
                return;
            }

            // ── 2. localStorage 有数据（即使过期）：先渲染旧数据，后台拉新 ──
            const stored = readHomeStorageCache();
            if (stored && stored.data && stored.data.payload) {
                applyFreshData(stored.data);
                renderAll();
                // 后台静默刷新
                fetchFreshData().then(fresh => {
                    if (fresh.payload) {
                        homeDataCache = fresh;
                        homeDataCacheTime = Date.now();
                        writeHomeStorageCache(fresh);
                        applyFreshData(fresh);
                        renderAll();
                    }
                }).catch(() => {});
                return;
            }

            // ── 3. 完全无缓存：等待请求完成 ──
            const fresh = await fetchFreshData();
            if (!fresh.payload) {
                showDataLoadError(fresh.errors);
                return;
            }
            homeDataCache = fresh;
            homeDataCacheTime = Date.now();
            writeHomeStorageCache(fresh);
            applyFreshData(fresh);
            renderAll();
        }

        /**
         * 解析计划数据，提取月度目标和本月累计实际值
         * planRaw 是 plan-dashboard-summary 返回的原始数据
         */
        function parsePlanData(planRaw) {
            if (!planRaw) return null;
            const days = planRaw.days || planRaw.daily || [];
            if (!days.length) return null;

            // 累加本月实际值
            const monthActual = { cost: 0, cart: 0, preOrders: 0, directOrders: 0, orders: 0 };
            // 累加月计划目标
            const monthTarget = { cost: 0, cart: 0, preOrders: 0, directOrders: 0, orders: 0 };

            // 按日期保存计划花费（总计划金额 = 万相台 + 有客代投）
            const planCostByDate = new Map();
            // 按日期保存有客代投花费（优先实际值 agent_cost，回退到计划值 agent_plan）
            const agentPlanByDate = new Map();
            // 25年有客代投花费按日期映射
            const refAgentByDate = new Map();

            days.forEach(d => {
                // 实际值
                const actual = d.actual || d;
                monthActual.cost += Number(actual.cost || actual.wanxiang_cost || 0);
                monthActual.cart += Number(actual.cart || 0);
                monthActual.preOrders += Number(actual.preOrders || actual.pre_orders || 0);
                monthActual.directOrders += Number(actual.directOrders || actual.direct_orders || 0);
                monthActual.orders += Number(actual.orders || 0);

                // 计划目标
                const plan = d.plan || d;
                monthTarget.cost += Number(plan.wanxiang_plan || plan.plan_cost || 0);
                monthTarget.cart += Number(plan.plan_cart || 0);
                monthTarget.preOrders += Number(plan.plan_preOrders || plan.plan_pre_orders || 0);
                monthTarget.directOrders += Number(plan.plan_directOrders || plan.plan_direct_orders || 0);
                monthTarget.orders += Number(plan.plan_orders || 0);

                // 有客代投花费：优先 agent_cost（实际），回退 agent_plan（计划）
                const dateKey = d.date || d.label || '';
                if (dateKey) {
                    const planCost = Number(plan.wanxiang_plan || plan.plan_cost || 0) + Number(plan.agent_plan || 0);
                    if (planCost > 0) planCostByDate.set(dateKey, planCost);
                    const agentVal = Number(d.agent_cost || d.agent_actual || d.agent_plan || 0);
                    if (agentVal > 0) agentPlanByDate.set(dateKey, agentVal);
                }

                // 25年有客代投花费（agent_amount 字段）
                if (dateKey && d.agent_amount != null) {
                    const refDate = dateKey.replace(/^\d{4}/, String(Number(dateKey.slice(0, 4)) - 1));
                    refAgentByDate.set(refDate, Number(d.agent_amount || 0));
                }
            });

            // 成本类指标不累加，计算均值或用总量比
            monthActual.cartCost = monthActual.cart > 0 ? monthActual.cost / monthActual.cart : null;
            monthActual.preOrderCost = monthActual.preOrders > 0 ? monthActual.cost / monthActual.preOrders : null;
            monthTarget.cartCost = monthTarget.cart > 0 ? monthTarget.cost / monthTarget.cart : null;
            monthTarget.preOrderCost = monthTarget.preOrders > 0 ? monthTarget.cost / monthTarget.preOrders : null;

            // 如果没有任何计划目标数据，返回 null
            const hasTarget = Object.values(monthTarget).some(v => v > 0);
            return { monthActual, monthTarget: hasTarget ? monthTarget : null, planCostByDate, agentPlanByDate, refAgentByDate, rhythmDays: days };
        }

        function exportWord() {
            const title = document.querySelector('.report-title')?.textContent || '广告投放日报';
            const subtitle = (document.querySelector('.report-subtitle')?.textContent || '').trim();
            const genTime = document.getElementById('report-gen-time')?.textContent || '';

            // 克隆 report-body，不改动真实 DOM
            const bodyEl = document.querySelector('.report-body');
            if (!bodyEl) return;
            const clone = bodyEl.cloneNode(true);

            // 移除打印无用元素
            clone.querySelectorAll('.no-print, .report-actions, .crowd-stages-toolbar, .skeleton-row, .skeleton-block').forEach(function(el) { el.remove(); });

            // 把 ECharts canvas 替换为 PNG 图片
            if (csChart) {
                try {
                    const dataUrl = csChart.getDataURL({ type: 'png', pixelRatio: 1.5, backgroundColor: '#ffffff' });
                    const chartDiv = clone.querySelector('#crowd-stages-chart');
                    if (chartDiv) {
                        const img = document.createElement('img');
                        img.src = dataUrl;
                        img.style.cssText = 'width:100%;max-height:300pt;display:block;margin:6pt 0;';
                        chartDiv.parentNode.replaceChild(img, chartDiv);
                    }
                } catch (_e) {
                    const chartDiv = clone.querySelector('#crowd-stages-chart');
                    if (chartDiv) chartDiv.remove();
                }
            } else {
                const chartDiv = clone.querySelector('#crowd-stages-chart');
                if (chartDiv) chartDiv.remove();
            }

            const bodyHTML = clone.innerHTML;

            const css = [
                'body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:10pt;color:#222;line-height:1.5;}',
                'h1{font-size:15pt;margin:0 0 3pt;}',
                '.subtitle{font-size:9pt;color:#888;margin-bottom:10pt;}',
                'table{border-collapse:collapse;width:100%;margin:6pt 0;font-size:7.5pt;}',
                'th,td{border:1px solid #ccc;padding:2pt 3pt;text-align:center;white-space:nowrap;}',
                'th{background:#f0f0f0 !important;font-weight:bold;font-size:7pt;}',
                '.col-label,.td-name{text-align:left;}',
                '.col-num{text-align:right;}',
                '.chg-up{color:#c0392b;font-weight:600;}',
                '.chg-down{color:#27ae60;font-weight:600;}',
                '.kpi-summary-row td{font-weight:bold;background:#f9f9f9 !important;}',
                '.yoy-pct-row td,.yoy-delta-row td{font-size:6.5pt;color:#666;}',
                '.report-section{margin:10pt 0;}',
                '.report-section-title{font-size:10pt;font-weight:600;border-bottom:1.5pt solid #ddd;padding-bottom:3pt;margin:8pt 0 5pt;}',
                '.yoy-badge,.rhythm-delivery-badge{background:#e8f0fe;color:#1a56db;padding:1pt 5pt;border-radius:3pt;font-size:7.5pt;}',
                '.kpi-summary{font-size:9pt;margin:4pt 0;}',
                '.crowd-rule-sub-row{background:#fafafa !important;}',
                '.crowd-rule-plan-name{font-size:7pt;color:#888;display:block;}',
                '.table-scroll-wrapper{overflow:visible;}',
                '.report-card{margin-bottom:8pt;}',
                '.report-footnote{font-size:8pt;color:#999;margin-top:10pt;border-top:1pt solid #ddd;padding-top:4pt;}',
                '.no-print,.navbar,.report-actions,button,.skeleton-row,.crowd-stages-toolbar{display:none !important;}',
                '@page{size:A3 landscape;margin:10mm;}',
            ].join('\n');

            const html = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<style>\n'
                + css + '\n</style>\n</head>\n<body>\n'
                + '<h1>' + esc(title) + '</h1>\n'
                + '<div class="subtitle">' + esc(subtitle) + ' · 生成时间 ' + esc(genTime) + '</div>\n'
                + bodyHTML + '\n'
                + '<div class="report-footnote">报告生成时间：' + esc(genTime) + ' · 交个朋友控股 · 广告业务组内部文件</div>\n'
                + '</body>\n</html>';

            const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = title + '_' + genTime.replace(/[:\s]/g, '') + '.doc';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

                function exportCSV() {
            const daily = homeDashboardData?.daily || [];
            const agentPlanMap = homePlanData?.agentPlanByDate || null;
            const planCostMap = homePlanData?.planCostByDate || null;
            const refAgentMap = homePlanData?.refAgentByDate || null;
            const yoyCur = homeYoyCurrent;
            const yoyRef = homeYoyReference;
            const crowdRule = homeCrowdRuleData;

            if (!daily.length && !crowdRule?.summary?.length && !yoyCur && !yoyRef) {
                alert('暂无数据，请等待数据加载完成后重试。');
                return;
            }

            const today = shanghaiToday();
            const genTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(',', '');
            const title = document.querySelector('.report-title')?.textContent || '广告投放日报';

            function csvEsc(v) { return String(v ?? '').replace(/"/g, '""'); }
            function csvCell(v) { return '"' + csvEsc(v) + '"'; }
            // fmtMoney: 使用页面一致的 fmtCurrency 显示格式
            function fmtMoney(v) { return v > 0 ? fmtCurrency(v) : ''; }
            function fmtCount(v) { return fmtInt(v); }
            // fmtUnitCost: 单位成本（单价类），保留1位小数
            function fmtUnitCost(v, prefix) { return v > 0 ? (prefix || '¥') + v.toFixed(1) : ''; }
            // fmtPct: 百分比
            function fmtPct(v) { return v > 0 ? (v * 100).toFixed(1) + '%' : ''; }
            // fmtRate: 速率/比值
            function fmtRate(v) { return v > 0 ? v.toFixed(2) : ''; }

            let csv = '\ufeff';  // BOM for Excel UTF-8 compatibility

            // ============ 1. 核心KPI阶段表（按周） ============
            if (daily.length) {
                csv += '"核心KPI阶段表（按周汇总）"\n';
                csv += '开始日期,结束日期,阶段,总花费,计划花费,有客花费(直播),广告花费(万相台),观看次数,成交笔数,总购物车,加购成本,观看成本,观看转化率,订单成本,预售订单量,预售订单成本\n';

                const weeks = groupByWeek(daily, agentPlanMap, planCostMap);
                weeks.forEach(w => {
                    csv += [
                        w.startDate, w.endDate, w.phase,
                        fmtMoney(w.cost + w.liveCost),
                        fmtMoney(w.planCost),
                        fmtMoney(w.liveCost),
                        fmtMoney(w.cost),
                        fmtCount(w.views), fmtCount(w.orders), fmtCount(w.cart),
                        fmtUnitCost(w.cartCost),
                        fmtUnitCost(w.viewCost),
                        fmtPct(w.viewConvertRate),
                        fmtUnitCost(w.orderCost),
                        fmtCount(w.preOrders),
                        fmtUnitCost(w.preOrderCost)
                    ].map(csvCell).join(',') + '\n';
                });
                csv += '\n';
            }

            // ============ 2. 近7天每日明细 ============
            if (daily.length) {
                csv += '"近7天每日明细"\n';
                csv += '日期,星期,总花费,计划花费,有客花费(直播),广告花费(万相台),观看次数,成交笔数,总购物车,加购成本,观看成本,观看转化率,订单成本,预售订单量,预售订单成本\n';
                const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                const recent7 = daily.slice(0, 7).reverse();
                recent7.forEach(row => {
                    const date = row.label || '';
                    const dt = new Date(date + 'T00:00:00+08:00');
                    const wd = weekDays[dt.getDay()];
                    const adCost = Number(row.cost || 0);
                    const liveCost = agentPlanMap instanceof Map ? (agentPlanMap.get(date) || 0) : (agentPlanMap?.[date] || 0);
                    const planCost = planCostMap instanceof Map ? (planCostMap.get(date) || 0) : (planCostMap?.[date] || 0);
                    const allCost = adCost + liveCost;
                    const views = Number(row.views || 0);
                    const orders = Number(row.orders || 0);
                    const directOrders = Number(row.directOrders || 0);
                    const cart = Number(row.cart || 0);
                    const preOrders = Number(row.preOrders || 0);
                    csv += [
                        date, wd,
                        fmtMoney(allCost),
                        fmtMoney(planCost),
                        fmtMoney(liveCost),
                        fmtMoney(adCost),
                        fmtCount(views), fmtCount(orders), fmtCount(cart),
                        fmtUnitCost(cart > 0 ? adCost / cart : 0),
                        fmtUnitCost(views > 0 ? adCost / views : 0),
                        fmtPct(views > 0 ? directOrders / views : 0),
                        fmtUnitCost(orders > 0 ? adCost / orders : 0),
                        fmtCount(preOrders),
                        fmtUnitCost(preOrders > 0 ? adCost / preOrders : 0)
                    ].map(csvCell).join(',') + '\n';
                });
                csv += '\n';
            }

            // ============ 3. 同比去年 ============
            if (yoyCur || yoyRef) {
                csv += '"同比去年对比"\n';
                const curYear = today.slice(0, 4);
                // 同比从 YOY_MONTH-01（5/1）起算、覆盖跨月大促，今年侧取该日之后全部数据。
                const curDaily = (yoyCur?.daily || []).filter(r => r.label && r.label >= `${curYear}-${YOY_MONTH}-01`);
                const refDaily = yoyRef?.daily || [];
                const refYear = String(Number(curYear) - 1);
                const dayStr = today.slice(8, 10);

                const getLastDataDate = (arr) => {
                    const dates = arr.map(r => r.label).filter(Boolean).sort();
                    return dates[dates.length - 1] || null;
                };
                const curLastDate = getLastDataDate(curDaily);
                const curLastDay = curLastDate ? curLastDate.split('-')[2] : dayStr;
                // 去年截止日 = 去年的「今年最新数据日同月同日」，跨月对齐。
                const refStart = `${refYear}-${YOY_MONTH}-01`;
                const refCutoff = curLastDate ? `${refYear}-${curLastDate.slice(5)}` : `${refYear}-${YOY_MONTH}-${dayStr}`;
                const refFiltered = refDaily.filter(r => r.label && r.label >= refStart && r.label <= refCutoff);

                const sum = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
                const curAdCost = sum(curDaily, 'cost');
                const curViews = sum(curDaily, 'views');
                const curOrders = sum(curDaily, 'orders');
                const curCart = sum(curDaily, 'cart');
                const curPreOrders = sum(curDaily, 'preOrders');
                let curAgentCost = 0;
                if (agentPlanMap) {
                    curDaily.forEach(r => {
                        if (r.label) curAgentCost += Number(agentPlanMap instanceof Map ? agentPlanMap.get(r.label) || 0 : agentPlanMap[r.label] || 0);
                    });
                }

                const refAdCost = sum(refFiltered, 'cost');
                const refViews = sum(refFiltered, 'views');
                const refOrders = sum(refFiltered, 'orders');
                const refCart = sum(refFiltered, 'cart');
                const refPreOrders = sum(refFiltered, 'preOrders');
                let refAgentCost = 0;
                if (refAgentMap) {
                    refFiltered.forEach(r => {
                        if (r.label) refAgentCost += Number(refAgentMap instanceof Map ? refAgentMap.get(r.label) || 0 : refAgentMap[r.label] || 0);
                    });
                }

                function yoyPct(cur, ref) {
                    if (!ref || ref === 0) return '--';
                    return ((cur / ref - 1) * 100).toFixed(0) + '%';
                }

                csv += '指标,今年同期,去年同比,增涨,同比%\n';
                csv += `总花费(含直播),${fmtMoney(curAdCost + curAgentCost)},${fmtMoney(refAdCost + refAgentCost)},${fmtMoney(curAdCost + curAgentCost - refAdCost - refAgentCost)},${yoyPct(curAdCost + curAgentCost, refAdCost + refAgentCost)}\n`;
                csv += `广告花费,${fmtMoney(curAdCost)},${fmtMoney(refAdCost)},${fmtMoney(curAdCost - refAdCost)},${yoyPct(curAdCost, refAdCost)}\n`;
                csv += `直播花费,${fmtMoney(curAgentCost)},${fmtMoney(refAgentCost)},${fmtMoney(curAgentCost - refAgentCost)},${yoyPct(curAgentCost, refAgentCost)}\n`;
                csv += `观看次数,${fmtCount(curViews)},${fmtCount(refViews)},${fmtCount(curViews - refViews)},${yoyPct(curViews, refViews)}\n`;
                csv += `成交笔数,${fmtCount(curOrders)},${fmtCount(refOrders)},${fmtCount(curOrders - refOrders)},${yoyPct(curOrders, refOrders)}\n`;
                csv += `总购物车,${fmtCount(curCart)},${fmtCount(refCart)},${fmtCount(curCart - refCart)},${yoyPct(curCart, refCart)}\n`;
                csv += `预售订单量,${fmtCount(curPreOrders)},${fmtCount(refPreOrders)},${fmtCount(curPreOrders - refPreOrders)},${yoyPct(curPreOrders, refPreOrders)}\n`;
                csv += '\n';
            }

            // ============ 4. 人群分层（直播间计划·规则） ============
            const crowdRows = crowdRule?.summary;
            if (crowdRows?.length) {
                csv += '"人群分层（直播间计划·含规则·本月）"\n';
                csv += '人群分层/定向,花费,观看次数,成交笔数,总购物车,加购成本,观看成本,观看转化率,订单成本,预售订单量,预售订单成本,ROI\n';

                crowdRows.forEach(layer => {
                    const s = layer.summary;
                    csv += [
                        layer.crowd,
                        fmtMoney(s.cost), fmtCount(s.views), fmtCount(s.orders), fmtCount(s.cart),
                        fmtUnitCost(s.cartCost),
                        fmtUnitCost(s.viewCost),
                        fmtPct(s.views > 0 ? s.directOrders / s.views : 0),
                        fmtUnitCost(s.orderCost),
                        fmtCount(s.preOrders),
                        fmtUnitCost(s.preOrderCost),
                        fmtRate(s.roi)
                    ].map(csvCell).join(',') + '\n';

                    (layer.subRows || []).forEach(sub => {
                        csv += [
                            '  ' + sub.label + ' (' + sub.planName + ')',
                            fmtMoney(sub.cost), fmtCount(sub.views), fmtCount(sub.orders), fmtCount(sub.cart),
                            fmtUnitCost(sub.cartCost),
                            fmtUnitCost(sub.viewCost),
                            fmtPct(sub.views > 0 ? sub.directOrders / sub.views : 0),
                            fmtUnitCost(sub.orderCost),
                            fmtCount(sub.preOrders),
                            fmtUnitCost(sub.preOrderCost),
                            fmtRate(sub.roi)
                        ].map(csvCell).join(',') + '\n';
                    });
                });
                csv += '\n';
            }

            // ============ 5. 从 DOM 读取已渲染的节奏投放效果表 ============
            function domTableToCSV(tbodyId) {
                const tbody = document.getElementById(tbodyId);
                if (!tbody) return '';
                let rows = '';
                Array.from(tbody.querySelectorAll('tr')).forEach(function(tr) {
                    if (tr.querySelector('.skeleton-block') || tr.querySelector('.table-loading')) return;
                    const cells = Array.from(tr.querySelectorAll('td')).map(function(td) {
                        return '"' + td.textContent.trim().replace(/"/g, '""') + '"';
                    });
                    if (cells.length && cells.some(function(c) { return c !== '""'; })) {
                        rows += cells.join(',') + '\n';
                    }
                });
                return rows;
            }

            const rhythm2026CSV = domTableToCSV('rhythm-delivery-table-body');
            if (rhythm2026CSV) {
                csv += '"2026 节奏投放效果"\n';
                csv += '时间范围,活动节奏,天数,总花费,计划花费,有客花费,广告花费,观看次数,直接成交笔数,总购物车,加购成本,观看成本,观看转化率,预售订单量,直接预售成交笔数,预售订单成本,直接成交笔数成本,直接预售成交笔数成本\n';
                csv += rhythm2026CSV;
                csv += '\n';
            }

            const rhythm2025CSV = domTableToCSV('rhythm-delivery-2025-table-body');
            if (rhythm2025CSV) {
                csv += '"2025 节奏投放效果（618 同比参考）"\n';
                csv += '时间范围,活动节奏,天数,总花费,有客代投花费,广告花费,观看次数,直接成交笔数,总购物车,加购成本,观看成本,观看转化率,预售订单量,直接预售成交笔数,预售订单成本,直接成交笔数成本,直接预售成交笔数成本\n';
                csv += rhythm2025CSV;
                csv += '\n';
            }

            // ============ 6. 人群分层趋势数据 ============
            if (csRows && csRows.length) {
                csv += '"投放人群分层趋势"\n';
                csv += '日期,新访问认知,高潜,活跃成交,活跃下降,即将流失,已流失,首单,复购\n';
                csRows.forEach(function(r) {
                    csv += [r['日期'], r['新访问认知'], r['高潜'], r['活跃成交'], r['活跃下降'], r['即将流失'], r['已流失'], r['首单'], r['复购']]
                        .map(function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; })
                        .join(',') + '\n';
                });
                csv += '\n';
            }

            csv += `"报告生成时间",${genTime}\n`;
            csv += '"数据来源","交个朋友·广告智投工作台"\n';

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title}_数据表格_${genTime.replace(/[:\s]/g, '')}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        /* ══════════════════════════════════
           投放人群分层趋势图（ECharts）
           ══════════════════════════════════ */
        const CS_SERIES_DEFS = [
            { key: '新访问认知', color: '#4ea1ff', is5: true },
            { key: '高潜',       color: '#7c5cff', is5: true },
            { key: '活跃成交',   color: '#22c55e', is5: false },
            { key: '活跃下降',   color: '#f59e0b', is5: true },
            { key: '即将流失',   color: '#ef4444', is5: true },
            { key: '已流失',     color: '#94a3b8', is5: true },
            { key: '首单',       color: '#06b6d4', is5: false },
            { key: '复购',       color: '#ec4899', is5: false },
        ];
        const CS_DEFAULT_ON = new Set(['新访问认知', '活跃成交', '首单']);
        let csChart = null;
        let csRows = [];
        let csYScale = 'raw';

        function csGetActive() {
            return Array.from(document.querySelectorAll('#crowd-stages-legend input:checked')).map(i => i.dataset.key);
        }

        // 把 hex 颜色转成 rgba（用于面积渐变）
        function csHexToRgba(hex, a) {
            const h = hex.replace('#', '');
            const r = parseInt(h.slice(0, 2), 16);
            const g = parseInt(h.slice(2, 4), 16);
            const b = parseInt(h.slice(4, 6), 16);
            return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
        }

        function csBuildSeries() {
            const active = csGetActive();
            const defs = CS_SERIES_DEFS.filter(d => active.includes(d.key));
            // 选中线条较少时填充面积，帮助区分；线条多时关闭面积避免互相遮挡
            const showArea = defs.length > 0 && defs.length <= 3;
            return defs.map(def => ({
                name: def.key,
                type: 'line',
                smooth: 0.35,
                symbol: 'circle',
                symbolSize: 6,
                showSymbol: true,
                itemStyle: { color: def.color },
                lineStyle: {
                    color: def.color,
                    width: 2.5,
                    shadowColor: csHexToRgba(def.color, 0.35),
                    shadowBlur: 6,
                    shadowOffsetY: 2,
                },
                areaStyle: showArea ? {
                    opacity: 1,
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: csHexToRgba(def.color, 0.28) },
                            { offset: 1, color: csHexToRgba(def.color, 0.01) },
                        ],
                    },
                } : undefined,
                emphasis: { focus: 'series', lineStyle: { width: 3.5 } },
                blur: { lineStyle: { opacity: 0.12 }, areaStyle: { opacity: 0 } },
                data: csRows.map(r => Number(r[def.key]) || 0),
            }));
        }

        function csRender() {
            if (!csChart || !csRows.length) return;
            const dates = csRows.map(r => { const d = r['日期']; return d ? d.slice(5).replace('-', '/') : ''; });
            const manyDates = dates.length > 20;
            csChart.setOption({
                backgroundColor: 'transparent',
                textStyle: { color: '#e6e8ec' },
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(20,22,28,0.95)',
                    borderColor: '#2a313c',
                    textStyle: { color: '#e6e8ec', fontSize: 12 },
                    padding: [10, 12],
                    extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.45)',
                    axisPointer: {
                        type: 'line',
                        lineStyle: { color: '#4ea1ff', width: 1, type: 'dashed' },
                        label: { backgroundColor: '#2a313c', color: '#e6e8ec', fontSize: 11 },
                    },
                    formatter: function(params) {
                        if (!params || !params.length) return '';
                        const idx = params[0].dataIndex;
                        const date = csRows[idx]['日期'] || '';
                        // 按数值从高到低排序，便于阅读
                        params = params.slice().sort(function(a, b) { return Number(b.value) - Number(a.value); });
                        let html = '<div style="font-weight:600;margin-bottom:6px">' + esc(date) + '</div>';
                        params.forEach(function(p) {
                            html += '<div style="display:flex;align-items:center;gap:8px;margin:2px 0">'
                                + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + p.color + '"></span>'
                                + '<span style="flex:1">' + esc(p.seriesName) + '</span>'
                                + '<span style="font-weight:600">' + Number(p.value).toLocaleString() + '</span>'
                                + '</div>';
                        });
                        return html;
                    }
                },
                legend: { show: false },
                grid: { left: 58, right: 24, top: 24, bottom: manyDates ? 70 : 48 },
                dataZoom: manyDates ? [
                    { type: 'inside', start: 0, end: 100, minValueSpan: 5 },
                    {
                        type: 'slider', height: 18, bottom: 12,
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        borderColor: '#2a313c',
                        fillerColor: 'rgba(78,161,255,0.15)',
                        handleStyle: { color: '#4ea1ff', borderColor: '#4ea1ff' },
                        moveHandleStyle: { color: '#4ea1ff' },
                        dataBackground: { lineStyle: { color: '#3a4250' }, areaStyle: { color: 'rgba(78,161,255,0.08)' } },
                        selectedDataBackground: { lineStyle: { color: '#4ea1ff' }, areaStyle: { color: 'rgba(78,161,255,0.18)' } },
                        textStyle: { color: '#8a93a3', fontSize: 10 },
                    },
                ] : undefined,
                xAxis: {
                    type: 'category',
                    boundaryGap: false,
                    data: dates,
                    axisLine: { lineStyle: { color: '#2a313c' } },
                    axisTick: { show: false },
                    axisLabel: { color: '#8a93a3', fontSize: 11, interval: 'auto', rotate: manyDates ? 35 : 0, hideOverlap: true },
                    splitLine: { show: false },
                },
                yAxis: {
                    type: csYScale === 'log' ? 'log' : 'value',
                    logBase: 10,
                    name: '人数',
                    nameTextStyle: { color: '#6b7280', fontSize: 11, padding: [0, 0, 0, 6], align: 'right' },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                        color: '#8a93a3',
                        formatter: function(v) {
                            if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿';
                            if (v >= 10000) return (v / 10000).toFixed(0) + 'w';
                            if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
                            return v;
                        }
                    },
                    splitLine: { lineStyle: { color: '#1f2530', type: 'dashed' } },
                },
                series: csBuildSeries(),
            }, true);
        }

        function csInitLegend() {
            const container = document.getElementById('crowd-stages-legend');
            if (!container) return;
            container.innerHTML = '';
            CS_SERIES_DEFS.forEach(function(def) {
                const label = document.createElement('label');
                const checked = CS_DEFAULT_ON.has(def.key);
                label.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:#1e242e;border:1px solid #2a313c;color:#cfd5df;font-size:12px;cursor:pointer;user-select:none;transition:all .15s';
                if (checked) { label.style.background = '#1d2a3a'; label.style.borderColor = '#4ea1ff'; label.style.color = '#fff'; }
                label.innerHTML = '<input type="checkbox" ' + (checked ? 'checked' : '') + ' data-key="' + esc(def.key) + '" style="accent-color:#4ea1ff;cursor:pointer">'
                    + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + def.color + '"></span>'
                    + esc(def.key);
                label.addEventListener('click', function() {
                    setTimeout(function() {
                        const cb = label.querySelector('input');
                        if (cb.checked) { label.style.background = '#1d2a3a'; label.style.borderColor = '#4ea1ff'; label.style.color = '#fff'; }
                        else { label.style.background = '#1e242e'; label.style.borderColor = '#2a313c'; label.style.color = '#cfd5df'; }
                        csRender();
                    }, 0);
                });
                container.appendChild(label);
            });
        }

        function csBindButtons() {
            document.getElementById('cs-btn-default')?.addEventListener('click', function() {
                document.querySelectorAll('#crowd-stages-legend input').forEach(function(i) {
                    const on = CS_DEFAULT_ON.has(i.dataset.key);
                    i.checked = on;
                    const lbl = i.parentElement;
                    if (on) { lbl.style.background = '#1d2a3a'; lbl.style.borderColor = '#4ea1ff'; lbl.style.color = '#fff'; }
                    else { lbl.style.background = '#1e242e'; lbl.style.borderColor = '#2a313c'; lbl.style.color = '#cfd5df'; }
                });
                csRender();
            });
            document.getElementById('cs-btn-all')?.addEventListener('click', function() {
                document.querySelectorAll('#crowd-stages-legend input').forEach(function(i) {
                    i.checked = true;
                    const lbl = i.parentElement;
                    lbl.style.background = '#1d2a3a'; lbl.style.borderColor = '#4ea1ff'; lbl.style.color = '#fff';
                });
                csRender();
            });
            document.getElementById('cs-btn-scale')?.addEventListener('click', function() {
                csYScale = csYScale === 'raw' ? 'log' : 'raw';
                this.textContent = 'Y 轴：' + (csYScale === 'raw' ? '原始' : '对数');
                csRender();
            });
        }

        async function loadCrowdStagesChart() {
            const chartEl = document.getElementById('crowd-stages-chart');
            if (!chartEl || typeof echarts === 'undefined') return;

            csChart = /* global echarts */ window.echarts.init(chartEl);
            window.addEventListener('resize', function() { csChart && csChart.resize(); });
            csInitLegend();
            csBindButtons();

            // 从 Supabase 拉数据
            try {
                const cfg = authHelpers.getSupabaseConfig ? authHelpers.getSupabaseConfig() : {};
                const headers = authHelpers.getSupabaseRestHeaders ? authHelpers.getSupabaseRestHeaders() : {};
                const url = (cfg.url || '') + '/rest/v1/crowd_stages_2026?select=*&order=日期.asc';
                const resp = await fetch(url, { headers: headers, credentials: 'omit' });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                csRows = await resp.json();
                if (csRows.length) csRender();
                else { chartEl.innerHTML = '<div style="text-align:center;padding:60px 0;color:#8a93a3">暂无人群分层数据</div>'; }
            } catch (e) {
                console.error('[home] crowd stages chart load failed:', e);
                chartEl.innerHTML = '<div style="text-align:center;padding:60px 0;color:#8a93a3">人群分层趋势图加载失败</div>';
            }
        }

        /* ── 初始化 ── */
        document.addEventListener('DOMContentLoaded', function() {
            const genTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(',', '');
            setText('report-gen-time', genTime);
            document.getElementById('btn-refresh')?.addEventListener('click', () => location.reload());
            // PDF 打印前把 ECharts canvas 转为 img（canvas 在打印中为空白）
            window.addEventListener('beforeprint', function() {
                const chartEl = document.getElementById('crowd-stages-chart');
                if (chartEl && csChart) {
                    try {
                        const url = csChart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
                        const img = document.createElement('img');
                        img.src = url;
                        img.style.cssText = 'width:100%;max-height:260px;object-fit:contain;display:block;';
                        img.dataset.chartPlaceholder = '1';
                        chartEl.style.display = 'none';
                        chartEl.parentNode.insertBefore(img, chartEl);
                    } catch (_e) { /* ignore */ }
                }
            });
            window.addEventListener('afterprint', function() {
                const chartEl = document.getElementById('crowd-stages-chart');
                if (chartEl) { chartEl.style.display = ''; }
                document.querySelectorAll('[data-chart-placeholder]').forEach(function(el) { el.remove(); });
            });
            document.getElementById('btn-export-pdf')?.addEventListener('click', () => window.print());
            document.getElementById('btn-export-word')?.addEventListener('click', exportWord);
            document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
            loadHomeData();
            loadCrowdStagesChart();
        });
