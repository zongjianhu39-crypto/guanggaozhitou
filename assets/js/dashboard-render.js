(function attachDashboardRender(window) {
    let dashboardStatusTimer = null;
    let loadingStatusActive = false;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function classifyDashboardError(error) {
        const rawMessage = String(error?.message || error || '').trim();

        if (!rawMessage) {
            return { type: 'error', badge: '请求异常', summary: '请求失败，请稍后重试。', detail: '' };
        }
        if (/CONFIG_MISSING_SUPABASE_URL|CONFIG_MISSING_SUPABASE_REST_KEY|Missing CONFIG/i.test(rawMessage)) {
            return { type: 'error', badge: '配置缺失', summary: '前端配置不完整，当前页面无法请求数据。', detail: rawMessage };
        }
        if (/Invalid API key|Invalid Token or Protected Header formatting|Missing authorization header/i.test(rawMessage)) {
            return { type: 'error', badge: '配置错误', summary: 'Supabase 凭证无效或请求头格式不正确，当前数据源不可用。', detail: rawMessage };
        }
        if (/登录状态已失效|未登录|invalid token|Missing Authorization/i.test(rawMessage)) {
            return { type: 'warn', badge: '权限失效', summary: '当前登录态已失效，需要重新登录后再查询。', detail: rawMessage };
        }
        if (/Failed to fetch|NetworkError|Load failed/i.test(rawMessage)) {
            return { type: 'error', badge: '网络异常', summary: '请求没有成功发出或响应被浏览器拦截，请检查网络或跨域配置。', detail: rawMessage };
        }
        if (/HTTP 50[024]|502|503|504|Bad gateway|网关|数据源请求异常|数据源暂时不可用/i.test(rawMessage)) {
            return { type: 'error', badge: '数据源暂时不可用', summary: '底层数据接口暂时异常，系统已做重试；请稍后刷新或重新查询。', detail: rawMessage };
        }
        if (/无法解析的响应|Unexpected token/i.test(rawMessage)) {
            return { type: 'error', badge: '响应异常', summary: '接口返回格式不符合预期，当前结果无法解析。', detail: rawMessage };
        }
        return { type: 'error', badge: '请求失败', summary: rawMessage, detail: '' };
    }

    function buildStateMessage(error, fallbackSummary) {
        const classified = classifyDashboardError(error);
        const summary = classified.summary || fallbackSummary || '请求失败，请稍后重试。';
        return `${classified.badge}：${summary}`;
    }

    function setDashboardStatus(type, text, autoHideMs = 0) {
        const root = document.getElementById('dashboard-status');
        const badge = document.getElementById('dashboard-status-badge');
        const label = document.getElementById('dashboard-status-text');
        if (!root || !badge || !label) {
            return;
        }
        if (dashboardStatusTimer) {
            clearTimeout(dashboardStatusTimer);
            dashboardStatusTimer = null;
        }
        root.classList.remove('is-info', 'is-success', 'is-warn', 'is-error');
        root.classList.add('show', `is-${type}`);
        badge.textContent = type === 'success'
            ? '已更新'
            : type === 'warn'
                ? '状态提醒'
                : type === 'error'
                    ? '错误'
                    : '后台刷新';
        label.textContent = text;
        if (autoHideMs > 0) {
            dashboardStatusTimer = setTimeout(() => {
                root.classList.remove('show', 'is-info', 'is-success', 'is-warn', 'is-error');
                dashboardStatusTimer = null;
            }, autoHideMs);
        }
    }

    function buildKpiSkeletonCards(count = 8) {
        return Array.from({ length: count }, () => `
            <div class="kpi-card skeleton-card skeleton-shimmer">
                <div class="skeleton-line sm" style="width:46%;margin-bottom:10px"></div>
                <div class="skeleton-line lg" style="width:72%"></div>
            </div>
        `).join('');
    }

    function renderTableLoadingSkeleton(tableSelector, rowCount = 4) {
        const tbody = document.querySelector(`${tableSelector} tbody`);
        const colCount = document.querySelectorAll(`${tableSelector} thead th`).length || 1;
        if (!tbody) {
            return;
        }
        tbody.innerHTML = Array.from({ length: rowCount }, () => `
            <tr>
                <td colspan="${colCount}" class="table-placeholder-cell">
                    <div class="table-placeholder-stack skeleton-shimmer">
                        <div class="skeleton-line" style="width:100%"></div>
                        <div class="skeleton-line sm" style="width:68%"></div>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderAdsLoadingSkeleton() {
        const adsGrid = document.getElementById('ads-kpi-grid');
        if (adsGrid) {
            adsGrid.innerHTML = buildKpiSkeletonCards(12);
        }
        renderTableLoadingSkeleton('#ads-monthly-table', 4);
        renderTableLoadingSkeleton('#ads-weekly-table', 4);
        renderTableLoadingSkeleton('#ads-daily-table', 6);
    }

    function renderCrowdLoadingSkeleton() {
        renderTableLoadingSkeleton('#crowd-summary-table', 6);
    }

    function showLoading() {
        loadingStatusActive = true;
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            overlay.setAttribute('aria-hidden', 'false');
        }
        setDashboardStatus('info', '正在加载数据...', 0);
    }

    function hideLoading() {
        loadingStatusActive = false;
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
        }
    }

    function updateLoading(percent, text, detail) {
        const loadingBar = document.getElementById('loading-bar');
        const loadingText = document.getElementById('loading-text');
        const loadingDetail = document.getElementById('loading-detail');
        if (loadingBar) loadingBar.style.width = percent + '%';
        if (loadingText && text) loadingText.textContent = text;
        if (loadingDetail && detail) loadingDetail.textContent = detail;
        if (loadingStatusActive) {
            const statusText = [text, detail].filter(Boolean).join(' ');
            if (statusText) {
                setDashboardStatus('info', statusText, 0);
            }
        }
    }

    function formatNum(value, dec = 0) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            return '-';
        }
        if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '万';
        return n.toFixed(dec);
    }

    function formatMoney(value) {
        if (Math.abs(value) >= 10000) return (value / 10000).toFixed(2) + '万';
        return Number(value).toFixed(2);
    }

    function isPresentFiniteNumber(value) {
        if (value === null || value === undefined || value === '') {
            return false;
        }
        return Number.isFinite(Number(value));
    }

    function formatFiniteNumber(value, digits = 2, fallback = '-') {
        if (!isPresentFiniteNumber(value)) {
            return fallback;
        }
        const numeric = Number(value);
        return numeric.toFixed(digits);
    }

    function formatFinitePercent(value, digits = 2, fallback = '-') {
        if (!isPresentFiniteNumber(value)) {
            return fallback;
        }
        const numeric = Number(value);
        return `${(numeric * 100).toFixed(digits)}%`;
    }

    function renderTableBodyState(tableSelector, message) {
        const tbody = document.querySelector(`${tableSelector} tbody`);
        if (!tbody) return;
        const colCount = document.querySelectorAll(`${tableSelector} thead th`).length || 1;
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:#86868b;padding:24px 12px">${escapeHtml(message)}</td></tr>`;
    }

    function renderTableEmptyState(tableSelector, message) {
        renderTableBodyState(tableSelector, message);
    }

    function showGlobalDashboardError(error, fallbackSummary) {
        const errorBox = document.getElementById('error-msg');
        if (!errorBox) {
            return;
        }
        const classified = classifyDashboardError(error);
        const lines = [`${classified.badge}：${classified.summary || fallbackSummary || '请求失败，请稍后重试。'}`];
        if (classified.detail && classified.detail !== classified.summary) {
            lines.push(`详情：${classified.detail}`);
        }
        errorBox.textContent = lines.join(' ');
        errorBox.style.display = 'block';
    }

    function hideGlobalDashboardError() {
        const errorBox = document.getElementById('error-msg');
        if (!errorBox) {
            return;
        }
        errorBox.textContent = '';
        errorBox.style.display = 'none';
    }

    function renderAdsState(message) {
        document.getElementById('ads-kpi-grid').innerHTML = `<div class="kpi-card" style="grid-column:1/-1;text-align:center;color:#86868b">${escapeHtml(message)}</div>`;
        renderTableBodyState('#ads-monthly-table', message);
        renderTableBodyState('#ads-weekly-table', message);
        renderTableBodyState('#ads-daily-table', message);
    }

    function getRoiClass(roi) {
        if (roi >= 30) return 'good';
        if (roi < 1) return 'bad';
        return '';
    }

    function getBreakevenRoiClass(roi) {
        const numeric = Number(roi);
        if (!Number.isFinite(numeric)) return '';
        if (numeric >= 1) return 'good';
        if (numeric < 1) return 'bad';
        return '';
    }

    function getAdShareClass(share) {
        if (share >= 0.5) return 'good';
        if (share < 0.1) return 'bad';
        return '';
    }

    function buildTableRow(label, row, showExtraCols) {
        const roiDisplay = row.roi > 0 ? `<span class="${getRoiClass(row.roi)}">${row.roi.toFixed(2)}</span>` : '-';
        const directRoiDisplay = row.directRoi > 0 ? `<span class="${getRoiClass(row.directRoi)}">${row.directRoi.toFixed(2)}</span>` : '-';
        const breakevenRoiDisplay = row.breakevenRoi !== null && Number.isFinite(Number(row.breakevenRoi))
            ? `<span class="${getBreakevenRoiClass(Number(row.breakevenRoi))}">${formatFiniteNumber(row.breakevenRoi)}</span>`
            : '-';
        const adRevenueDisplay = row.adRevenue !== null && Number.isFinite(Number(row.adRevenue))
            ? `¥${formatMoney(row.adRevenue)}`
            : '-';
        const returnRoiDisplay = row.returnRoi > 0 ? `<span class="${getRoiClass(row.returnRoi)}">${row.returnRoi.toFixed(2)}</span>` : '-';
        const adShareDisplay = Number.isFinite(Number(row.adShare))
            ? `<span class="${getAdShareClass(Number(row.adShare))}">${formatFinitePercent(row.adShare)}</span>`
            : '-';
        const taobaoReturnRate = row.taobaoReturnRate > 0 ? (row.taobaoReturnRate * 100).toFixed(2) + '%' : '-';
        let html = `<tr>
            <td>${label}</td>
            <td>¥${formatMoney(row.cost)}</td>
            <td>¥${formatMoney(row.amount)}</td>
            <td>${formatNum(row.orders)}</td>
            <td>${roiDisplay}</td>
            <td>${directRoiDisplay}</td>`;

        if (showExtraCols) {
            html += `<td>${breakevenRoiDisplay}</td>
            <td>${adRevenueDisplay}</td>
            <td>${returnRoiDisplay}</td>
            <td>${adShareDisplay}</td>
            <td>${formatNum(row.computableDays)}</td>
            <td>${formatNum(row.skippedDays)}</td>`;
        }

        html += `<td>${row.viewCost > 0 ? '¥' + row.viewCost.toFixed(2) : '-'}</td>
            <td>${row.orderCost > 0 ? '¥' + row.orderCost.toFixed(2) : '-'}</td>
            <td>${row.cartCost > 0 ? '¥' + row.cartCost.toFixed(2) : '-'}</td>
            <td>${formatNum(row.preOrders)}</td>
            <td>${row.preOrderCost > 0 ? '¥' + row.preOrderCost.toFixed(2) : '-'}</td>
            <td>${row.viewConvertRate > 0 ? row.viewConvertRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.deepInteractRate > 0 ? row.deepInteractRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.viewRate > 0 ? row.viewRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.cpm > 0 ? '¥' + row.cpm.toFixed(2) : '-'}</td>
            <td>¥${formatMoney(row.directAmount)}</td>
            <td>${formatNum(row.cart)}</td>
            <td>${formatNum(row.shows)}</td>`;

        if (showExtraCols) {
            html += `<td>¥${formatMoney(row.finGuarantee)}</td>
            <td>¥${formatMoney(row.finOffline)}</td>
            <td>¥${formatMoney(row.finAgency)}</td>
            <td>¥${formatMoney(row.finRedPacket)}</td>
            <td>¥${formatMoney(row.finYanxuanRed)}</td>
            <td>${formatNum(row.taobaoOrders)}</td>
            <td>${taobaoReturnRate}</td>`;
        }

        html += '</tr>';
        return html;
    }

    function buildCrowdMainRow(label, row) {
        return `<tr class="crowd-row" data-crowd-row="toggle" tabindex="0" role="button" aria-expanded="false">
            <td><span class="expand-icon">▶</span> ${label}</td>
            <td>¥${formatMoney(row.cost)}</td>
            <td>¥${formatMoney(row.amount)}</td>
            <td>${formatNum(row.orders)}</td>
            <td>${row.roi > 0 ? row.roi.toFixed(2) : '-'}</td>
            <td>${row.directRoi > 0 ? row.directRoi.toFixed(2) : '-'}</td>
            <td>${row.viewCost > 0 ? '¥' + row.viewCost.toFixed(2) : '-'}</td>
            <td>${row.orderCost > 0 ? '¥' + row.orderCost.toFixed(2) : '-'}</td>
            <td>${row.cartCost > 0 ? '¥' + row.cartCost.toFixed(2) : '-'}</td>
            <td>${formatNum(row.preOrders)}</td>
            <td>${row.preOrderCost > 0 ? '¥' + row.preOrderCost.toFixed(2) : '-'}</td>
            <td>${row.viewConvertRate > 0 ? row.viewConvertRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.deepInteractRate > 0 ? row.deepInteractRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.viewRate > 0 ? row.viewRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.cpm > 0 ? '¥' + row.cpm.toFixed(2) : '-'}</td>
            <td>¥${formatMoney(row.directAmount)}</td>
            <td>${formatNum(row.cart)}</td>
            <td>${formatNum(row.shows)}</td>
        </tr>`;
    }

    function buildCrowdSubRows(rows) {
        return (rows || []).map(row => `<tr class="sub-row">
            <td>${row.label}</td>
            <td>¥${formatMoney(row.cost)}</td>
            <td>¥${formatMoney(row.amount)}</td>
            <td>${formatNum(row.orders)}</td>
            <td>${row.roi > 0 ? row.roi.toFixed(2) : '-'}</td>
            <td>${row.directRoi > 0 ? row.directRoi.toFixed(2) : '-'}</td>
            <td>${row.viewCost > 0 ? '¥' + row.viewCost.toFixed(2) : '-'}</td>
            <td>${row.orderCost > 0 ? '¥' + row.orderCost.toFixed(2) : '-'}</td>
            <td>${row.cartCost > 0 ? '¥' + row.cartCost.toFixed(2) : '-'}</td>
            <td>${formatNum(row.preOrders)}</td>
            <td>${row.preOrderCost > 0 ? '¥' + row.preOrderCost.toFixed(2) : '-'}</td>
            <td>${row.viewConvertRate > 0 ? row.viewConvertRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.deepInteractRate > 0 ? row.deepInteractRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.viewRate > 0 ? row.viewRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.cpm > 0 ? '¥' + row.cpm.toFixed(2) : '-'}</td>
            <td>¥${formatMoney(row.directAmount)}</td>
            <td>${formatNum(row.cart)}</td>
            <td>${formatNum(row.shows)}</td>
        </tr>`).join('');
    }

    function toggleCrowdRow(row) {
        row.classList.toggle('expanded');
        row.setAttribute('aria-expanded', row.classList.contains('expanded') ? 'true' : 'false');
        let nextRow = row.nextElementSibling;
        while (nextRow && nextRow.classList.contains('sub-row')) {
            nextRow.classList.toggle('visible');
            nextRow = nextRow.nextElementSibling;
        }
    }

    function renderAdsFromResponse(result) {
        const kpi = result.ads?.kpi;
        const monthly = result.ads?.monthly || [];
        const weekly = result.ads?.weekly || [];
        const daily = result.ads?.daily || [];

        if (!kpi) {
            renderAdsState('当前未返回投放聚合结果');
            return;
        }

        document.getElementById('ads-kpi-grid').innerHTML = `
            <div class="kpi-card"><div class="kpi-label">总花费</div><div class="kpi-value orange">¥${formatMoney(kpi.totalCost)}</div></div>
            <div class="kpi-card"><div class="kpi-label">总成交金额</div><div class="kpi-value green">¥${formatMoney(kpi.totalAmount)}</div></div>
            <div class="kpi-card"><div class="kpi-label">总成交笔数</div><div class="kpi-value purple">${formatNum(kpi.totalOrders)}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均ROI</div><div class="kpi-value ${getRoiClass(kpi.avgRoi)}">${kpi.avgRoi > 0 ? kpi.avgRoi.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均直接ROI</div><div class="kpi-value ${getRoiClass(kpi.avgDirectRoi)}">${kpi.avgDirectRoi > 0 ? kpi.avgDirectRoi.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">广告收入（可计算天）</div><div class="kpi-value green">${kpi.totalAdRevenue !== null && Number.isFinite(Number(kpi.totalAdRevenue)) ? '¥' + formatMoney(kpi.totalAdRevenue) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">盈亏平衡ROI（可计算天）</div><div class="kpi-value ${getBreakevenRoiClass(kpi.totalBreakevenRoi)}">${formatFiniteNumber(kpi.totalBreakevenRoi)}</div></div>
            <div class="kpi-card"><div class="kpi-label">可计算天数 / 跳过天数</div><div class="kpi-value blue">${formatNum(kpi.computableDays)} / ${formatNum(kpi.skippedDays)}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均去退ROI</div><div class="kpi-value ${getRoiClass(kpi.totalReturnRoi)}">${kpi.totalReturnRoi > 0 ? kpi.totalReturnRoi.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均广告成交占比</div><div class="kpi-value ${getAdShareClass(kpi.totalAdShare)}">${formatFinitePercent(kpi.totalAdShare)}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均观看成本</div><div class="kpi-value blue">${kpi.avgViewCost > 0 ? '¥' + kpi.avgViewCost.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均订单成本</div><div class="kpi-value blue">${kpi.avgOrderCost > 0 ? '¥' + kpi.avgOrderCost.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均加购成本</div><div class="kpi-value blue">${kpi.avgCartCost > 0 ? '¥' + kpi.avgCartCost.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">总预售成交笔数</div><div class="kpi-value purple">${formatNum(kpi.totalPreOrders)}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均预售订单成本</div><div class="kpi-value blue">${kpi.avgPreOrderCost > 0 ? '¥' + kpi.avgPreOrderCost.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均观看转化率</div><div class="kpi-value green">${kpi.avgViewConvertRate > 0 ? kpi.avgViewConvertRate.toFixed(2) + '%' : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均深度互动率</div><div class="kpi-value purple">${kpi.avgDeepInteractRate > 0 ? kpi.avgDeepInteractRate.toFixed(2) + '%' : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均观看率</div><div class="kpi-value blue">${kpi.avgViewRate > 0 ? kpi.avgViewRate.toFixed(2) + '%' : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">平均千次展现成本</div><div class="kpi-value orange">${kpi.avgCpm > 0 ? '¥' + kpi.avgCpm.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">展现量</div><div class="kpi-value blue">${formatNum(kpi.totalShows)}</div></div>
            <div class="kpi-card"><div class="kpi-label">总购物车数</div><div class="kpi-value blue">${formatNum(kpi.totalCart)}</div></div>
            <div class="kpi-card"><div class="kpi-label">直接成交金额</div><div class="kpi-value green">¥${formatMoney(kpi.totalDirectAmount)}</div></div>
            <div class="kpi-card"><div class="kpi-label">保量佣金</div><div class="kpi-value orange">¥${formatMoney(kpi.finGuarantee)}</div></div>
            <div class="kpi-card"><div class="kpi-label">预估结算线下佣金</div><div class="kpi-value orange">¥${formatMoney(kpi.finOffline)}</div></div>
            <div class="kpi-card"><div class="kpi-label">预估结算机构佣金</div><div class="kpi-value orange">¥${formatMoney(kpi.finAgency)}</div></div>
            <div class="kpi-card"><div class="kpi-label">直播间红包</div><div class="kpi-value orange">¥${formatMoney(kpi.finRedPacket)}</div></div>
            <div class="kpi-card"><div class="kpi-label">严选红包</div><div class="kpi-value orange">¥${formatMoney(kpi.finYanxuanRed)}</div></div>
            <div class="kpi-card"><div class="kpi-label">淘宝直播成交笔数</div><div class="kpi-value purple">${formatNum(kpi.totalTaobaoOrders)}</div></div>
            <div class="kpi-card"><div class="kpi-label">退货率</div><div class="kpi-value purple">${(kpi.totalReturnRate * 100).toFixed(2)}%</div></div>
        `;

        const counts = result.counts || {};
        if (counts.superLive > 0) {
            const warnParts = [];
            if (!counts.taobaoLive) warnParts.push('淘宝直播成交数据缺失（无法计算广告成交占比）');
            if (!counts.financial) warnParts.push('财务佣金数据缺失（无法计算广告收入）');
            if (warnParts.length > 0) {
                const grid = document.getElementById('ads-kpi-grid');
                if (grid) {
                    grid.insertAdjacentHTML('beforeend',
                        `<div style="grid-column:1/-1;padding:10px 14px;background:#fff8f0;border:1px solid #f5d0a8;border-radius:10px;color:#9a3412;font-size:12px;line-height:1.6">` +
                        `<strong>⚠ 广告收入 / 可计算天数 无法显示的原因：</strong> ${escapeHtml(warnParts.join('；'))}。请检查对应日期的数据是否已导入 Supabase。` +
                        `</div>`
                    );
                }
            }
        }

        document.querySelector('#ads-monthly-table tbody').innerHTML = monthly.length
            ? monthly.map(row => buildTableRow(row.label, row, true)).join('')
            : '';
        if (!monthly.length) {
            renderTableEmptyState('#ads-monthly-table', '所选时间范围暂无月度数据');
        }

        document.querySelector('#ads-weekly-table tbody').innerHTML = weekly.length
            ? weekly.map(row => buildTableRow(row.label, row, true)).join('')
            : '';
        if (!weekly.length) {
            renderTableEmptyState('#ads-weekly-table', '所选时间范围暂无周度数据');
        }

        document.querySelector('#ads-daily-table tbody').innerHTML = daily.length
            ? daily.map(row => buildTableRow(row.label, row, true)).join('')
            : '';
        if (!daily.length) {
            renderTableEmptyState('#ads-daily-table', '所选时间范围暂无日度数据');
        }
    }

    function renderCrowdFromResponse(result) {
        const rows = result.crowd?.summary || [];
        if (!rows.length) {
            renderTableBodyState('#crowd-summary-table', '所选时间范围暂无人群数据');
            return;
        }
        document.querySelector('#crowd-summary-table tbody').innerHTML = rows.map(group => {
            return buildCrowdMainRow(group.crowd, group.summary) + buildCrowdSubRows(group.subRows || []);
        }).join('');
    }

    function singleToNum(v) {
        const n = parseFloat(String(v ?? '').replace(/,/g, ''));
        return isFinite(n) ? n : 0;
    }

    function renderSingleLoadingState() {
        const grid = document.getElementById('single-kpi-grid');
        if (grid) {
            grid.innerHTML = buildKpiSkeletonCards(8);
        }
        renderTableLoadingSkeleton('#single-table', 6);
    }

    function renderSingleState(message) {
        const grid = document.getElementById('single-kpi-grid');
        if (grid) {
            grid.innerHTML = '';
        }
        const tbody = document.querySelector('#single-table tbody');
        const colCount = document.querySelectorAll('#single-table thead th').length || 1;
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:#86868b;padding:24px">${escapeHtml(message)}</td></tr>`;
        }
    }

    function renderSingleKpi(products, rowCount) {
        const grid = document.getElementById('single-kpi-grid');
        if (!grid) return;
        const totalCost = products.reduce((sum, product) => sum + singleToNum(product?.花费), 0);
        const totalDirect = products.reduce((sum, product) => sum + singleToNum(product?.直接成交金额), 0);
        const totalProductDirect = products.reduce((sum, product) => sum + singleToNum(product?.['该商品直接成交金额']), 0);
        const totalCart = products.reduce((sum, product) => sum + singleToNum(product?.['该商品加购数']), 0);
        const roi = totalCost > 0 ? totalDirect / totalCost : 0;
        const productRoi = totalCost > 0 ? totalProductDirect / totalCost : 0;
        const cartCost = totalCart > 0 ? totalCost / totalCart : 0;
        grid.innerHTML = `
            <div class="kpi-card"><div class="kpi-label">总花费</div><div class="kpi-value orange">¥${formatMoney(totalCost)}</div></div>
            <div class="kpi-card"><div class="kpi-label">直接成交金额</div><div class="kpi-value green">¥${formatMoney(totalDirect)}</div></div>
            <div class="kpi-card"><div class="kpi-label">商品直接成交金额</div><div class="kpi-value green">¥${formatMoney(totalProductDirect)}</div></div>
            <div class="kpi-card"><div class="kpi-label">直接ROI</div><div class="kpi-value ${getRoiClass(roi)}">${roi > 0 ? roi.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">商品直接ROI</div><div class="kpi-value ${getRoiClass(productRoi)}">${productRoi > 0 ? productRoi.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">总加购数</div><div class="kpi-value purple">${formatNum(totalCart)}</div></div>
            <div class="kpi-card"><div class="kpi-label">加购成本</div><div class="kpi-value blue">${cartCost > 0 ? '¥' + cartCost.toFixed(2) : '-'}</div></div>
            <div class="kpi-card"><div class="kpi-label">商品数 / 数据行</div><div class="kpi-value purple">${products.length} / ${formatNum(rowCount)}</div></div>
        `;
    }

    function renderSingleTable(products) {
        const tbody = document.querySelector('#single-table tbody');
        if (!tbody) return;
        if (!products.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#86868b;padding:24px">所选时间范围暂无数据</td></tr>';
            return;
        }
        tbody.innerHTML = products.map((product) => {
            const cost = singleToNum(product?.花费);
            const directAmount = singleToNum(product?.直接成交金额);
            const productDirectAmount = singleToNum(product?.['该商品直接成交金额']);
            const cartCount = singleToNum(product?.['该商品加购数']);
            const roi = cost > 0 ? directAmount / cost : 0;
            const productRoi = cost > 0 ? productDirectAmount / cost : 0;
            const cartCost = cartCount > 0 ? cost / cartCount : 0;
            const imgUrl = typeof product?.img_url === 'string' ? product.img_url.trim() : '';
            const productName = String(product?.商品名称 || product?.product_name || product?.name || '未命名商品');
            const imgHtml = imgUrl
                ? `<img src="${escapeHtml(imgUrl)}" style="width:44px;height:44px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:8px" loading="lazy">`
                : '<span style="display:inline-block;width:44px;height:44px;background:#f2f2f7;border-radius:4px;vertical-align:middle;margin-right:8px"></span>';
            const nameShort = productName.length > 20 ? productName.slice(0, 20) + '…' : productName;
            return `<tr>
                <td><div style="display:flex;align-items:center">${imgHtml}<span title="${escapeHtml(productName)}">${escapeHtml(nameShort)}</span></div></td>
                <td>¥${formatMoney(cost)}</td>
                <td>${roi > 0 ? `<span class="${getRoiClass(roi)}">${roi.toFixed(2)}</span>` : '-'}</td>
                <td>${productRoi > 0 ? `<span class="${getRoiClass(productRoi)}">${productRoi.toFixed(2)}</span>` : '-'}</td>
                <td>${formatNum(product?.直接成交笔数)}</td>
                <td>${formatNum(product?.['该商品直接成交笔数'])}</td>
                <td>¥${formatMoney(productDirectAmount)}</td>
                <td>${formatNum(cartCount)}</td>
                <td>${cartCost > 0 ? '¥' + cartCost.toFixed(2) : '-'}</td>
                <td>${formatNum(product?.观看人数)}</td>
            </tr>`;
        }).join('');
    }

    window.DashboardRender = {
        escapeHtml,
        classifyDashboardError,
        buildStateMessage,
        setDashboardStatus,
        buildKpiSkeletonCards,
        renderTableLoadingSkeleton,
        renderAdsLoadingSkeleton,
        renderCrowdLoadingSkeleton,
        showLoading,
        hideLoading,
        updateLoading,
        formatNum,
        formatMoney,
        isPresentFiniteNumber,
        formatFiniteNumber,
        formatFinitePercent,
        renderTableBodyState,
        showGlobalDashboardError,
        hideGlobalDashboardError,
        renderAdsState,
        getRoiClass,
        getBreakevenRoiClass,
        getAdShareClass,
        buildTableRow,
        buildCrowdMainRow,
        buildCrowdSubRows,
        toggleCrowdRow,
        renderAdsFromResponse,
        renderCrowdFromResponse,
        singleToNum,
        renderSingleLoadingState,
        renderSingleState,
        renderSingleKpi,
        renderSingleTable,
    };
})(window);
