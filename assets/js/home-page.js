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
                const viewConvertRate = views > 0 ? orders / views : 0;
                const orderCost = orders > 0 ? cost / orders : 0;
                const preOrderCost = preOrders > 0 ? cost / preOrders : 0;

                // 计算周的结束日期（周日）
                const start = new Date(w.startDate + 'T00:00:00+08:00');
                const end = new Date(start);
                end.setDate(end.getDate() + 6);

                return {
                    startDate: fmtDate(start),
                    endDate: fmtDate(end),
                    phase: phaseName(w.startDate),
                    cost, liveCost, views, orders, cart, preOrders,
                    planCost: weekPlanCost,
                    viewCost, cartCost, viewConvertRate, orderCost, preOrderCost
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
                tbody.innerHTML = '<tr><td colspan="16" class="table-loading">暂无阶段数据</td></tr>';
                renderKpiSummary([], null);
                return;
            }

            // 累计汇总
            let totalCost = 0, totalViews = 0, totalOrders = 0, totalCart = 0, totalPreOrders = 0, totalLiveCost = 0, totalPlanCost = 0;

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
                    <td class="col-num">${fmtWan(week.orders)}</td>
                    <td class="col-num">${fmtWan(week.cart)}</td>
                    <td class="col-num">${week.cartCost > 0 ? week.cartCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${week.viewCost > 0 ? week.viewCost.toFixed(2) : '--'}</td>
                    <td class="col-num">${week.viewConvertRate > 0 ? (week.viewConvertRate * 100).toFixed(1) + '%' : '--'}</td>
                    <td class="col-num">${week.orderCost > 0 ? week.orderCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${fmtWan(week.preOrders)}</td>
                    <td class="col-num">${week.preOrderCost > 0 ? fmtWan(week.preOrderCost) : '--'}</td>
                </tr>`;
            });

            // 汇总行
            const totalAllCost = totalCost + totalLiveCost;
            const totalCartCost = totalCart > 0 ? totalAllCost / totalCart : 0;
            const totalViewCost = totalViews > 0 ? totalAllCost / totalViews : 0;
            const totalViewRate = totalViews > 0 ? totalOrders / totalViews : 0;
            const totalOrderCost = totalOrders > 0 ? totalAllCost / totalOrders : 0;
            const totalPreOrderCost = totalPreOrders > 0 ? totalAllCost / totalPreOrders : 0;

            html += `<tr class="kpi-summary-row">
                <td class="col-label" colspan="3">汇总</td>
                <td class="col-num">${fmtWan(totalAllCost)}</td>
                <td class="col-num">${totalPlanCost > 0 ? fmtWan(totalPlanCost) : '--'}</td>
                <td class="col-num">${fmtWan(totalLiveCost)}</td>
                <td class="col-num">${fmtWan(totalCost)}</td>
                <td class="col-num">${fmtWan(totalViews)}</td>
                <td class="col-num">${fmtWan(totalOrders)}</td>
                <td class="col-num">${fmtWan(totalCart)}</td>
                <td class="col-num">${totalCartCost > 0 ? totalCartCost.toFixed(1) : '--'}</td>
                <td class="col-num">${totalViewCost > 0 ? totalViewCost.toFixed(2) : '--'}</td>
                <td class="col-num">${totalViewRate > 0 ? (totalViewRate * 100).toFixed(1) + '%' : '--'}</td>
                <td class="col-num">${totalOrderCost > 0 ? totalOrderCost.toFixed(1) : '--'}</td>
                <td class="col-num">${fmtWan(totalPreOrders)}</td>
                <td class="col-num">${totalPreOrderCost > 0 ? fmtWan(totalPreOrderCost) : '--'}</td>
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
            if (tbody) tbody.innerHTML = '<tr><td colspan="16" class="table-loading table-error">数据加载失败</td></tr>';
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
                tbody.innerHTML = '<tr><td colspan="16" class="table-loading">暂无每日数据</td></tr>';
                return;
            }

            const agentPlanMap = homePlanData?.agentPlanByDate || null;
            const planCostMap = homePlanData?.planCostByDate || null;
            const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

            let totalCost = 0, totalLiveCost = 0, totalViews = 0, totalOrders = 0, totalCart = 0, totalPreOrders = 0, totalPlanCost = 0;

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
                const viewCost = views > 0 ? adCost / views : 0;
                const cartCost = cart > 0 ? adCost / cart : 0;
                const viewConvertRate = views > 0 ? orders / views : 0;
                const orderCost = orders > 0 ? adCost / orders : 0;
                const preOrderCost = preOrders > 0 ? adCost / preOrders : 0;

                totalCost += adCost;
                totalLiveCost += liveCost;
                totalViews += views;
                totalOrders += orders;
                totalCart += cart;
                totalPreOrders += preOrders;
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
                    <td class="col-num">${fmtWan(orders)}</td>
                    <td class="col-num">${fmtWan(cart)}</td>
                    <td class="col-num">${cartCost > 0 ? cartCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${viewCost > 0 ? viewCost.toFixed(2) : '--'}</td>
                    <td class="col-num">${viewConvertRate > 0 ? (viewConvertRate * 100).toFixed(1) + '%' : '--'}</td>
                    <td class="col-num">${orderCost > 0 ? orderCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${fmtWan(preOrders)}</td>
                    <td class="col-num">${preOrderCost > 0 ? preOrderCost.toFixed(1) : '--'}</td>
                </tr>`;
            });

            // 汇总行
            const totalAllCost = totalCost + totalLiveCost;
            const avgCartCost = totalCart > 0 ? totalCost / totalCart : 0;
            const avgViewCost = totalViews > 0 ? totalCost / totalViews : 0;
            const avgViewRate = totalViews > 0 ? totalOrders / totalViews : 0;
            const avgOrderCost = totalOrders > 0 ? totalCost / totalOrders : 0;
            const avgPreOrderCost = totalPreOrders > 0 ? totalCost / totalPreOrders : 0;

            html += `<tr class="kpi-summary-row">
                <td class="col-label" colspan="3">7日汇总</td>
                <td class="col-num">${fmtWan(totalAllCost)}</td>
                <td class="col-num">${totalPlanCost > 0 ? fmtWan(totalPlanCost) : '--'}</td>
                <td class="col-num">${fmtWan(totalLiveCost)}</td>
                <td class="col-num">${fmtWan(totalCost)}</td>
                <td class="col-num">${fmtWan(totalViews)}</td>
                <td class="col-num">${fmtWan(totalOrders)}</td>
                <td class="col-num">${fmtWan(totalCart)}</td>
                <td class="col-num">${avgCartCost > 0 ? avgCartCost.toFixed(1) : '--'}</td>
                <td class="col-num">${avgViewCost > 0 ? avgViewCost.toFixed(2) : '--'}</td>
                <td class="col-num">${avgViewRate > 0 ? (avgViewRate * 100).toFixed(1) + '%' : '--'}</td>
                <td class="col-num">${avgOrderCost > 0 ? avgOrderCost.toFixed(1) : '--'}</td>
                <td class="col-num">${fmtWan(totalPreOrders)}</td>
                <td class="col-num">${avgPreOrderCost > 0 ? avgPreOrderCost.toFixed(1) : '--'}</td>
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
                tbody.innerHTML = '<tr><td colspan="15" class="table-loading">暂无同比数据</td></tr>';
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

            // 聚合当年数据
            const curDaily = curData?.daily || [];
            const curAdCost = curDaily.reduce((s, r) => s + (Number(r.cost) || 0), 0);
            const curViews = curDaily.reduce((s, r) => s + (Number(r.views) || 0), 0);
            const curOrders = curDaily.reduce((s, r) => s + (Number(r.orders) || 0), 0);
            const curCart = curDaily.reduce((s, r) => s + (Number(r.cart) || 0), 0);
            const curPreOrders = curDaily.reduce((s, r) => s + (Number(r.preOrders) || 0), 0);

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
            const curViewRate = curViews > 0 ? curOrders / curViews : 0;
            const curOrderCost = curOrders > 0 ? curAdCost / curOrders : 0;
            const curPreOrderCost = curPreOrders > 0 ? curAdCost / curPreOrders : 0;

            // 今年最后数据日期
            const curLastDate = getLastDataDate(curDaily);
            // 提取日部分，构造去年截止日期（确保同比时间范围对齐）
            const curLastDay = curLastDate ? curLastDate.split('-')[2] : dayStr;
            const refCutoffDate = `${refYear}-${YOY_MONTH}-${curLastDay}`;

            // 聚合去年数据（只累加到截止日期）
            const refDaily = refData?.daily || [];
            const refDailyFiltered = refDaily.filter(r => r.label && r.label <= refCutoffDate);
            const refAdCost = refDailyFiltered.reduce((s, r) => s + (Number(r.cost) || 0), 0);
            const refViews = refDailyFiltered.reduce((s, r) => s + (Number(r.views) || 0), 0);
            const refOrders = refDailyFiltered.reduce((s, r) => s + (Number(r.orders) || 0), 0);
            const refCart = refDailyFiltered.reduce((s, r) => s + (Number(r.cart) || 0), 0);
            const refPreOrders = refDailyFiltered.reduce((s, r) => s + (Number(r.preOrders) || 0), 0);

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
            const refViewRate = refViews > 0 ? refOrders / refViews : 0;
            const refOrderCost = refOrders > 0 ? refAdCost / refOrders : 0;
            const refPreOrderCost = refPreOrders > 0 ? refAdCost / refPreOrders : 0;

            // 增涨行负数用括号
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

            // 同比百分比
            function fmtYoyPct(cur, ref) {
                if (ref === 0 || ref == null) return '<span class="yoy-neg">--</span>';
                const pct = ((cur / ref) - 1) * 100;
                const cls = pct < 0 ? 'yoy-neg' : 'yoy-pos';
                return `<span class="${cls}">${pct.toFixed(0)}%</span>`;
            }

            function dataRow(label1, label2, total, plan, live, ad, views, orders, cart, cartCost, vc, vr, oc, po, poc) {
                return `<tr>
                    <td class="col-label">${esc(label1)}</td>
                    <td class="col-label">${esc(label2)}</td>
                    <td class="col-num">${fmtWan(total)}</td>
                    <td class="col-num">${plan > 0 ? fmtWan(plan) : '--'}</td>
                    <td class="col-num">${fmtWan(live)}</td>
                    <td class="col-num">${fmtWan(ad)}</td>
                    <td class="col-num">${fmtWan(views)}</td>
                    <td class="col-num">${fmtWan(orders)}</td>
                    <td class="col-num">${fmtWan(cart)}</td>
                    <td class="col-num">${cartCost > 0 ? cartCost.toFixed(1) : '--'}</td>
                    <td class="col-num">${vc > 0 ? vc.toFixed(2) : '--'}</td>
                    <td class="col-num">${vr > 0 ? (vr * 100).toFixed(1) + '%' : '--'}</td>
                    <td class="col-num">${oc > 0 ? oc.toFixed(1) : '--'}</td>
                    <td class="col-num">${fmtWan(po)}</td>
                    <td class="col-num">${poc > 0 ? poc.toFixed(1) : '--'}</td>
                </tr>`;
            }

            const curRow = dataRow(
                `${curYear}/${Number(YOY_MONTH)}/1`, curLastDate ? fmtDateLabel(curLastDate) : `${curYear}/${Number(YOY_MONTH)}/${Number(dayStr)}`,
                curTotalCost, curPlanCost, curAgentCost, curAdCost,
                curViews, curOrders, curCart,
                curCartCost, curViewCost, curViewRate, curOrderCost,
                curPreOrders, curPreOrderCost
            );
            const refRow = dataRow(
                `${refYear}/${Number(YOY_MONTH)}/1`, curLastDate ? `${refYear}/${Number(curLastDate.split('-')[1])}/${Number(curLastDay)}` : `${refYear}/${Number(YOY_MONTH)}/${Number(dayStr)}`,
                refTotalCost, 0, refAgentCost, refAdCost,
                refViews, refOrders, refCart,
                refCartCost, refViewCost, refViewRate, refOrderCost,
                refPreOrders, refPreOrderCost
            );

            // 增涨行
            const deltaRow = `<tr class="yoy-delta-row">
                <td class="col-label" colspan="2">增涨</td>
                <td class="col-num">${fmtDelta(curTotalCost - refTotalCost)}</td>
                <td class="col-num">--</td>
                <td class="col-num">${fmtDelta(curAgentCost - refAgentCost)}</td>
                <td class="col-num">${fmtDelta(curAdCost - refAdCost)}</td>
                <td class="col-num">${fmtDelta(curViews - refViews)}</td>
                <td class="col-num">${fmtDelta(curOrders - refOrders)}</td>
                <td class="col-num">${fmtDelta(curCart - refCart)}</td>
                <td class="col-num">${fmtDeltaFixed(curCartCost - refCartCost, 1)}</td>
                <td class="col-num">${fmtDeltaFixed(curViewCost - refViewCost, 2)}</td>
                <td class="col-num">${fmtDeltaPct(curViewRate - refViewRate)}</td>
                <td class="col-num">${fmtDeltaFixed(curOrderCost - refOrderCost, 1)}</td>
                <td class="col-num">${fmtDelta(curPreOrders - refPreOrders)}</td>
                <td class="col-num">${fmtDeltaFixed(curPreOrderCost - refPreOrderCost, 1)}</td>
            </tr>`;

            // 同比%行
            const pctRow = `<tr class="yoy-pct-row">
                <td class="col-label" colspan="2">同比%</td>
                <td class="col-num">${fmtYoyPct(curTotalCost, refTotalCost)}</td>
                <td class="col-num">--</td>
                <td class="col-num">${fmtYoyPct(curAgentCost, refAgentCost)}</td>
                <td class="col-num">${fmtYoyPct(curAdCost, refAdCost)}</td>
                <td class="col-num">${fmtYoyPct(curViews, refViews)}</td>
                <td class="col-num">${fmtYoyPct(curOrders, refOrders)}</td>
                <td class="col-num">${fmtYoyPct(curCart, refCart)}</td>
                <td class="col-num">${fmtYoyPct(curCartCost, refCartCost)}</td>
                <td class="col-num">${fmtYoyPct(curViewCost, refViewCost)}</td>
                <td class="col-num">${fmtYoyPct(curViewRate, refViewRate)}</td>
                <td class="col-num">${fmtYoyPct(curOrderCost, refOrderCost)}</td>
                <td class="col-num">${fmtYoyPct(curPreOrders, refPreOrders)}</td>
                <td class="col-num">${fmtYoyPct(curPreOrderCost, refPreOrderCost)}</td>
            </tr>`;

            tbody.innerHTML = curRow + refRow + deltaRow + pctRow;
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
                ['executive',  () => renderExecutiveBanner(latest, prev, alertCount, report)],
                ['kpi-table',  () => renderKpiTable(daily, latest, prev)],
                ['daily-detail', () => renderDailyDetailTable(daily)],
                ['yoy', () => renderYoyTable()],
            ];
            sections.forEach(([name, fn]) => {
                try { fn(); } catch (err) { console.error(`[home] render ${name} failed:`, err); }
            });
        }

        /* ══════════════════════════════════
           数据加载失败时显示错误提示
           ══════════════════════════════════ */
        function showDataLoadError(errors) {
            const banner = document.getElementById('executive-text');
            if (banner) banner.textContent = '数据加载失败，请检查网络或登录状态后刷新页面。';

            // 在各区域显示具体的错误提示
            ['kpi-table-body', 'daily-detail-table-body', 'yoy-table-body'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const cols = id === 'yoy-table-body' ? 15 : 16;
                    el.innerHTML = `<tr><td colspan="${cols}" class="table-loading table-error">数据加载失败，请刷新重试</td></tr>`;
                }
            });

            // 在控制台输出详细错误便于排查
            errors.forEach(e => console.error('[home] API error:', e));
        }

        /* 拉取全部首页数据（纯 IO，不操作 DOM） */
        async function fetchFreshData() {
            const today = shanghaiToday();
            const start = nDaysAgo(14);
            const monthStart = today.slice(0, 8) + '01';
            const monthEnd = today;

            // 同比参数：当年5月全月 + 去年同期
            const curYear = today.slice(0, 4);
            const refYear = String(Number(curYear) - 1);
            const dayStr = today.slice(8, 10); // '12'
            const yoyCurStart = `${curYear}-${YOY_MONTH}-01`;
            const yoyRefStart = `${refYear}-${YOY_MONTH}-01`;
            const yoyRefEnd = `${refYear}-${YOY_MONTH}-${dayStr}`;

            const [dashResult, alertResult, reportResult, planResult, yoyCurResult, yoyRefResult] = await Promise.allSettled([
                authHelpers.fetchFunctionJson('dashboard-data', {
                    query: { sections: 'all', start_date: start, end_date: today },
                    parseErrorMessage: '看板数据读取失败',
                    onUnauthorized: () => { /* noop */ },
                }),
                authHelpers.fetchFunctionJson('ai-reports', { query: { risk_level: 'high', limit: 10 } }),
                authHelpers.fetchFunctionJson('ai-reports', { query: { report_type: 'daily', limit: 1 } }),
                authHelpers.fetchFunctionJson('plan-dashboard-summary', {
                    query: { start: monthStart, end: monthEnd },
                    includePromptAdminToken: true,
                    useSessionToken: true,
                }).catch(e => ({ error: e })),
                // 同比：当年5月全月
                authHelpers.fetchFunctionJson('dashboard-data', {
                    query: { sections: 'ads', start_date: yoyCurStart, end_date: today },
                }).catch(e => ({ error: e })),
                // 同比：去年同期
                authHelpers.fetchFunctionJson('dashboard-data', {
                    query: { sections: 'ads', start_date: yoyRefStart, end_date: yoyRefEnd },
                }).catch(e => ({ error: e })),
            ]);

            const result = { payload: null, dashboardData: null, alertItems: [], reportItem: null, planData: null, yoyCurrent: null, yoyReference: null, errors: [] };

            if (dashResult.status === 'fulfilled') {
                const data = dashResult.value.data || dashResult.value;
                result.payload = data;
                result.dashboardData = data.ads || null;
            } else {
                result.errors.push(dashResult.reason);
                console.error('[home] dashboard-data failed:', dashResult.reason);
            }

            if (alertResult.status === 'fulfilled') {
                result.alertItems = (alertResult.value.data || alertResult.value).items || [];
            } else {
                result.errors.push(alertResult.reason);
            }

            if (reportResult.status === 'fulfilled') {
                const items = (reportResult.value.data || reportResult.value).items || [];
                result.reportItem = items[0] || null;
            } else {
                result.errors.push(reportResult.reason);
            }

            if (planResult.status === 'fulfilled' && planResult.value && !planResult.value.error) {
                try {
                    const planRaw = planResult.value.data || planResult.value;
                    result.planData = parsePlanData(planRaw);
                } catch (e) {
                    console.warn('[home] plan data parse error:', e);
                }
            } else {
                console.warn('[home] plan-dashboard-summary unavailable');
            }

            // 同比数据
            if (yoyCurResult.status === 'fulfilled' && yoyCurResult.value && !yoyCurResult.value.error) {
                const d = yoyCurResult.value.data || yoyCurResult.value;
                result.yoyCurrent = d.ads || d;
            }
            if (yoyRefResult.status === 'fulfilled' && yoyRefResult.value && !yoyRefResult.value.error) {
                const d = yoyRefResult.value.data || yoyRefResult.value;
                result.yoyReference = d.ads || d;
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

            // 确保所有 daily 数据按日期降序排列（最新日期在前）
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

        /* 主入口：stale-while-revalidate 策略 */
        async function loadHomeData() {
            const STALE_MS = 2 * 60 * 1000; // 2 分钟内视为新鲜
            const now = Date.now();

            // ── 有新鲜缓存：立即渲染 + 后台静默刷新 ──
            if (homeDataCache && (now - homeDataCacheTime) < STALE_MS) {
                applyFreshData(homeDataCache);
                renderAll();
                // 后台刷新，成功后用新数据重绘
                fetchFreshData().then(fresh => {
                    if (fresh.payload) {
                        homeDataCache = fresh;
                        homeDataCacheTime = Date.now();
                        applyFreshData(fresh);
                        renderAll();
                    }
                }).catch(() => { /* noop */ }); // 刷新失败不影响已展示数据
                return;
            }

            // ── 无缓存或已过期：正常加载（保持 loading 态） ──
            const fresh = await fetchFreshData();

            if (!fresh.payload) {
                showDataLoadError(fresh.errors);
                return;
            }

            homeDataCache = fresh;
            homeDataCacheTime = Date.now();
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
            return { monthActual, monthTarget: hasTarget ? monthTarget : null, planCostByDate, agentPlanByDate, refAgentByDate };
        }

        function exportWord() {
            const title = document.querySelector('.report-title')?.textContent || '广告投放日报';
            const subtitle = document.querySelector('.report-subtitle')?.textContent || '';
            const genTime = document.getElementById('report-gen-time')?.textContent || '';
            const bodyHTML = document.querySelector('.report-body')?.innerHTML || '';

            const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "PingFang SC","Microsoft YaHei",sans-serif; font-size: 11pt; color: #333; line-height: 1.5; }
  h1 { font-size: 16pt; margin: 0 0 4pt; }
  .subtitle { font-size: 9pt; color: #888; margin-bottom: 12pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 8pt; }
  th, td { border: 1px solid #ccc; padding: 3pt 4pt; text-align: center; }
  th { background: #f5f5f5; font-weight: bold; }
  .col-label, .td-name { text-align: left; }
  .col-num { text-align: right; font-family: "SF Mono","Consolas",monospace; }
  .col-primary { font-weight: bold; }
  .chg-up { color: #d32f2f; font-weight: bold; }
  .chg-down { color: #2e7d32; font-weight: bold; }
  .kpi-summary-row td { font-weight: bold; background: #fafafa; }
  .report-executive-banner { background: #fff3e0; padding: 8pt 12pt; border-left: 4pt solid #ff9800; margin: 8pt 0; font-size: 10pt; }
  .report-section { margin: 12pt 0; }
  .report-section-title { font-size: 11pt; margin: 10pt 0 6pt; border-bottom: 2px solid #ddd; padding-bottom: 4pt; }
  .yoy-badge { background: #e3f2fd; color: #1565c0; padding: 2pt 6pt; border-radius: 3pt; font-size: 8pt; }
  .yoy-delta-row td, .yoy-pct-row td { font-size: 7.5pt; color: #666; }
  .kpi-summary { font-size: 10pt; margin: 6pt 0; }
  .report-footnote { font-size: 8pt; color: #999; margin-top: 12pt; border-top: 1px solid #ddd; padding-top: 6pt; }
  .no-print { display: none; }
  @page { size: A3 landscape; margin: 10mm; }
</style>
</head>
<body>
<h1>${title}</h1>
<div class="subtitle">${subtitle} · 生成时间 ${genTime}</div>
${bodyHTML}
<div class="report-footnote">本报告由广告智投工作台自动生成</div>
</body>
</html>`;

            const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title}_${genTime.replace(/[:\s]/g,'')}.doc`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        /* ── 初始化 ── */
        document.addEventListener('DOMContentLoaded', function() {
            const genTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(',', '');
            setText('report-gen-time', genTime);
            document.getElementById('btn-refresh')?.addEventListener('click', () => location.reload());
            document.getElementById('btn-export-pdf')?.addEventListener('click', () => window.print());
            document.getElementById('btn-export-word')?.addEventListener('click', exportWord);
            loadHomeData();
        });
