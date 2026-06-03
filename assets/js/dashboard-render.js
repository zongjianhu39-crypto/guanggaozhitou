(function attachDashboardRender(window) {
    const ROI_WARNING_THRESHOLD = 1;
    const AD_SHARE_WARNING_THRESHOLD = 30;

    let dashboardStatusTimer = null;
    let loadingStatusActive = false;

    var escapeHtml = window.sharedUtils && window.sharedUtils.escapeHtml;

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
        renderTableBodyState('#ads-monthly-table', message);
        renderTableBodyState('#ads-weekly-table', message);
        renderTableBodyState('#ads-daily-table', message);
    }

    function getRoiClass(roi) {
        if (roi >= AD_SHARE_WARNING_THRESHOLD) return 'good';
        if (roi < ROI_WARNING_THRESHOLD) return 'bad';
        return '';
    }

    function getBreakevenRoiClass(roi) {
        const numeric = Number(roi);
        if (!Number.isFinite(numeric)) return '';
        if (numeric >= ROI_WARNING_THRESHOLD) return 'good';
        if (numeric < ROI_WARNING_THRESHOLD) return 'bad';
        return '';
    }

    function getAdShareClass(share) {
        if (share >= 0.5) return 'good';
        if (share < 0.1) return 'bad';
        return '';
    }

    // 把区间聚合 kpi 映射成 buildTableRow 可用的行结构（比率由后端按原始量重算，最准）。
    function kpiToRow(kpi) {
        const k = kpi || {};
        return {
            cost: k.totalCost || 0,
            liveCost: k.totalLiveCost || 0,
            amount: k.totalAmount || 0,
            directAmount: k.totalDirectAmount || 0,
            roi: k.avgRoi || 0,
            directRoi: k.avgDirectRoi || 0,
            adShare: k.totalAdShare || 0,
            orders: k.totalOrders || 0,
            preOrders: k.totalPreOrders || 0,
            directOrders: k.totalDirectOrders || 0,
            directPreOrders: k.totalDirectPreOrders || 0,
            taobaoOrders: k.totalTaobaoOrders || 0,
            orderCost: k.avgOrderCost || 0,
            preOrderCost: k.avgPreOrderCost || 0,
            viewCost: k.avgViewCost || 0,
            cartCost: k.avgCartCost || 0,
            viewConvertRate: k.avgViewConvertRate || 0,
            viewRate: k.avgViewRate || 0,
            cart: k.totalCart || 0,
            taobaoReturnRate: k.totalReturnRate || 0,
        };
    }

    function buildTableRow(label, row, showExtraCols, rowClass = '') {
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
        const directOrderCost = row.directOrders > 0 ? row.cost / row.directOrders : 0;
        const directPreOrderCost = row.directPreOrders > 0 ? row.cost / row.directPreOrders : 0;
        // 列顺序（自定义）：标识 → 花费 → 成交金额(总/直接) → 成交量(总/预售/直接预售/淘宝) → 订单成本 → ROI/直接ROI/广告占比 → 直接成本/预售成本/直接预售成本 → 观看/加购成本 → 转化率/观看率 → 购物车 → 退货率
        // 已隐藏字段（保留数据未渲染，便于恢复）：
        //   财务更新不及时: 盈亏平衡ROI breakevenRoi / 广告收入 adRevenue / 去退ROI returnRoi
        //                  保量佣金 finGuarantee / 预估结算线下佣金 finOffline / 预估结算机构佣金 finAgency / 直播间红包 finRedPacket / 严选红包 finYanxuanRed
        //   非重要指标:    可计算天数 computableDays / 跳过天数 skippedDays / 深度互动率 deepInteractRate / 千次展现成本 cpm / 展现量 shows
        let html = `<tr${rowClass ? ` class="${rowClass}"` : ''}>
            <td>${escapeHtml(label)}</td>
            <td>¥${formatMoney(row.cost)}</td>
            <td>${row.liveCost > 0 ? '¥' + formatMoney(row.liveCost) : '-'}</td>
            <td>¥${formatMoney(row.amount)}</td>
            <td>¥${formatMoney(row.directAmount)}</td>
            <td>${formatNum(row.orders)}</td>
            <td>${formatNum(row.preOrders)}</td>
            <td>${formatNum(row.directPreOrders)}</td>`;

        if (showExtraCols) {
            html += `<td>${formatNum(row.taobaoOrders)}</td>`;
        }

        html += `<td>${row.orderCost > 0 ? '¥' + row.orderCost.toFixed(2) : '-'}</td>
            <td>${roiDisplay}</td>
            <td>${directRoiDisplay}</td>`;

        if (showExtraCols) {
            html += `<td>${adShareDisplay}</td>`;
        }

        html += `<td>${directOrderCost > 0 ? '¥' + directOrderCost.toFixed(2) : '-'}</td>
            <td>${row.preOrderCost > 0 ? '¥' + row.preOrderCost.toFixed(2) : '-'}</td>
            <td>${directPreOrderCost > 0 ? '¥' + directPreOrderCost.toFixed(2) : '-'}</td>
            <td>${row.viewCost > 0 ? '¥' + row.viewCost.toFixed(2) : '-'}</td>
            <td>${row.cartCost > 0 ? '¥' + row.cartCost.toFixed(2) : '-'}</td>
            <td>${row.viewConvertRate > 0 ? row.viewConvertRate.toFixed(2) + '%' : '-'}</td>
            <td>${row.viewRate > 0 ? row.viewRate.toFixed(2) + '%' : '-'}</td>
            <td>${formatNum(row.cart)}</td>`;

        if (showExtraCols) {
            html += `<td>${taobaoReturnRate}</td>`;
        }

        html += '</tr>';
        return html;
    }

    function buildCrowdMainRow(label, row) {
        return `<tr class="crowd-row" data-crowd-row="toggle" tabindex="0" role="button" aria-expanded="false">
            <td><span class="expand-icon">▶</span> ${escapeHtml(label)}</td>
            <td>${escapeHtml(label)}</td>
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
            <td>${escapeHtml(row.label)}${row.planName ? `<span class="sub-row-plan">${escapeHtml(row.planName)}</span>` : ''}</td>
            <td class="layer-cell"><span class="layer-value">${escapeHtml(String(row.layer || '').trim() || '-')}</span><button class="layer-edit-btn" data-audience="${escapeHtml(row.label || '')}" title="编辑分层">✏️</button></td>
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

    function buildCrowdAudienceRow(row) {
        const label = String(row.label || '').trim();
        const isMissingAudienceName = !label || label === '0' || label === '定向人群名称未回传';
        const audienceLabel = isMissingAudienceName ? '定向人群名称未回传' : label;
        const layerLabel = String(row.layer || '').trim() || '-';
        return `<tr class="crowd-audience-row">
            <td>${escapeHtml(audienceLabel)}${row.planName ? `<span class="sub-row-plan">${escapeHtml(row.planName)}</span>` : ''}</td>
            <td class="layer-cell"><span class="layer-value">${escapeHtml(layerLabel)}</span><button class="layer-edit-btn" data-audience="${escapeHtml(audienceLabel)}" title="编辑分层">✏️</button></td>
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

    async function saveAudienceLayer(audienceName, layer) {
        const authHelpers = window.authHelpers || {};
        if (typeof authHelpers.fetchFunctionJson !== 'function') {
            throw new Error('缺少 authHelpers.fetchFunctionJson');
        }
        const result = await authHelpers.fetchFunctionJson('update-audience-layer', {
            method: 'POST',
            body: JSON.stringify({ audience_name: audienceName, layer }),
        });
        if (result.error) throw new Error(result.error);
        return result;
    }

    function getCrowdLayerSuggestions() {
        // 从页面已渲染的分层值中收集已有选项，去重排序
        const layers = new Set(['A', 'I', 'P', 'L']);
        document.querySelectorAll('.layer-value').forEach((span) => {
            const text = (span.textContent || '').trim();
            if (text && text !== '-') layers.add(text);
        });
        return [...layers].sort();
    }

    function showLayerEditor(button) {
        const audienceName = button.dataset.audience || '';
        if (!audienceName) return;

        const td = button.closest('td.layer-cell');
        if (!td) return;

        const valueSpan = td.querySelector('.layer-value');
        const currentLayer = (valueSpan?.textContent || '').trim();

        // 移除按钮，放置输入框 + 建议列表
        button.style.display = 'none';

        const wrapper = document.createElement('span');
        wrapper.className = 'layer-edit-wrapper';

        const datalistId = 'layer-suggestions-' + Date.now();
        const datalist = document.createElement('datalist');
        datalist.id = datalistId;
        const suggestions = getCrowdLayerSuggestions();
        suggestions.forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt;
            datalist.appendChild(o);
        });

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'layer-input';
        input.value = currentLayer === '-' ? '' : currentLayer;
        input.setAttribute('list', datalistId);
        input.placeholder = '输入分层名称';

        let saving = false;
        const doSave = async () => {
            if (saving) return;
            const newLayer = input.value.trim();
            if (!newLayer || newLayer === currentLayer) {
                cancelEdit();
                return;
            }
            saving = true;
            input.disabled = true;
            input.style.opacity = '0.6';
            try {
                await saveAudienceLayer(audienceName, newLayer);
                if (valueSpan) valueSpan.textContent = newLayer;
                // 还原为 span
                const parent = wrapper.parentNode;
                if (parent) {
                    parent.replaceChild(valueSpan || document.createTextNode(newLayer), wrapper);
                    button.style.display = '';
                }
            } catch (err) {
                input.value = currentLayer;
                input.disabled = false;
                input.style.opacity = '1';
                input.focus();
                saving = false;
                alert('保存失败: ' + (err.message || '未知错误'));
            }
        };

        const cancelEdit = () => {
            if (saving) return;
            const parent = wrapper.parentNode;
            if (parent) {
                parent.replaceChild(valueSpan || document.createTextNode(currentLayer), wrapper);
                button.style.display = '';
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSave();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (wrapper.parentNode && !saving) {
                    cancelEdit();
                }
            }, 150);
        });

        wrapper.appendChild(input);
        wrapper.appendChild(datalist);
        td.insertBefore(wrapper, button);
        input.focus();
        input.select();
    }

    function isLiveRoomPlanName(planName) {
        return String(planName || '').includes('规则');
    }

    function getCrowdPlanType() {
        const active = document.querySelector('.crowd-plan-filter-btn.active');
        const type = active?.dataset?.crowdPlanType || 'all';
        return type === 'live' || type === 'product' ? type : 'all';
    }

    function getCrowdSelectedPlanName() {
        return String(document.getElementById('crowd-plan-select')?.value || '').trim();
    }

    function collectCrowdPlanOptions(rows) {
        const planMap = new Map();
        (rows || []).forEach((group) => {
            (group.subRows || []).forEach((row) => {
                const planName = String(row.planName || '').trim();
                if (!planName) return;
                const current = planMap.get(planName) || {
                    name: planName,
                    cost: 0,
                    type: isLiveRoomPlanName(planName) ? 'live' : 'product',
                };
                current.cost += Number(row.cost) || 0;
                planMap.set(planName, current);
            });
        });
        return Array.from(planMap.values()).sort((left, right) => right.cost - left.cost);
    }

    function getPlanOptionsForType(options, type) {
        if (type === 'live') return options.filter((item) => item.type === 'live');
        if (type === 'product') return options.filter((item) => item.type === 'product');
        return options;
    }

    function syncCrowdPlanSelect(rows) {
        const select = document.getElementById('crowd-plan-select');
        if (!select) return;
        const previousValue = select.value;
        const allPlanOptions = collectCrowdPlanOptions(rows);
        const hasPlanDimension = allPlanOptions.length > 0;
        document.querySelectorAll('.crowd-plan-filter-btn[data-crowd-plan-type]').forEach((button) => {
            const disabled = !hasPlanDimension && button.dataset.crowdPlanType !== 'all';
            button.disabled = disabled;
            if (disabled) button.classList.remove('active');
        });
        if (!hasPlanDimension) {
            const allButton = document.querySelector('.crowd-plan-filter-btn[data-crowd-plan-type="all"]');
            if (allButton) allButton.classList.add('active');
        }
        const type = getCrowdPlanType();
        const planOptions = getPlanOptionsForType(allPlanOptions, type);
        const defaultLabel = type === 'live'
            ? '全部直播间计划'
            : type === 'product'
                ? '全部单品计划'
                : '全部计划';
        const optionsHtml = [
            `<option value="">${defaultLabel}</option>`,
            ...planOptions.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`),
        ].join('');
        select.innerHTML = optionsHtml;
        select.disabled = !hasPlanDimension || planOptions.length === 0;
        if (planOptions.some((item) => item.name === previousValue)) {
            select.value = previousValue;
        } else {
            select.value = '';
        }
    }

    function shouldIncludeCrowdSubRow(row, type, selectedPlanName) {
        const planName = String(row.planName || '').trim();
        if (selectedPlanName && planName !== selectedPlanName) return false;
        if (type === 'live') return isLiveRoomPlanName(planName);
        if (type === 'product') return planName ? !isLiveRoomPlanName(planName) : false;
        return true;
    }

    function getVisibleCrowdRows(rows) {
        const normalizedRows = Array.isArray(rows) ? rows : [];
        const type = getCrowdPlanType();
        const selectedPlanName = getCrowdSelectedPlanName();
        return normalizedRows
            .flatMap((group) => group.subRows || [])
            .filter((row) => shouldIncludeCrowdSubRow(row, type, selectedPlanName))
            .sort((left, right) => (Number(right.cost) || 0) - (Number(left.cost) || 0));
    }

    function updateCrowdFilterSummary(sourceRows, visibleRows) {
        const summaryEl = document.getElementById('crowd-plan-filter-summary');
        if (!summaryEl) return;
        const type = getCrowdPlanType();
        const selectedPlanName = getCrowdSelectedPlanName();
        const allPlans = collectCrowdPlanOptions(sourceRows);
        const visiblePlans = new Set();
        let missingAudienceNameCount = 0;
        (visibleRows || []).forEach((row) => {
            if (row.planName) {
                visiblePlans.add(row.planName);
            }
            const label = String(row.label || '').trim();
            if (!label || label === '0' || label === '定向人群名称未回传') {
                missingAudienceNameCount += 1;
            }
        });
        const typeLabel = selectedPlanName
            ? `具体计划：${selectedPlanName}`
            : type === 'live'
                ? '直播间计划（名称含“规则”）'
                : type === 'product'
                    ? '单品计划（名称不含“规则”）'
                    : '全部计划';
        const liveCount = allPlans.filter((item) => item.type === 'live').length;
        const productCount = allPlans.filter((item) => item.type === 'product').length;
        const missingHint = missingAudienceNameCount > 0
            ? ` ${missingAudienceNameCount} 行缺少真实定向名称，请重新导入包含人群名称的源数据。`
            : '';
        const planHint = allPlans.length
            ? `当前显示 ${visiblePlans.size} 个计划、${visibleRows.length} 个定向人群。直播间 ${liveCount} 个，单品 ${productCount} 个。`
            : `当前显示 ${visibleRows.length} 个定向人群。当前汇总数据未包含计划名称，计划类型筛选不可用。`;
        summaryEl.textContent = `${typeLabel}，${planHint}${missingHint}`;
    }

    function buildCrowdSummaryRow(groups) {
        var totalCost = 0, totalAmount = 0, totalOrders = 0;
        var totalDirectAmount = 0, totalCart = 0, totalShows = 0, totalPreOrders = 0;

        groups.forEach(function (g) {
            var s = g.summary || g || {};
            totalCost += Number(s.cost) || 0;
            totalAmount += Number(s.amount) || 0;
            totalOrders += Number(s.orders) || 0;
            totalDirectAmount += Number(s.directAmount) || 0;
            totalCart += Number(s.cart) || 0;
            totalShows += Number(s.shows) || 0;
            totalPreOrders += Number(s.preOrders) || 0;
        });

        var roi = totalCost > 0 ? totalAmount / totalCost : 0;
        var directRoi = totalCost > 0 ? totalDirectAmount / totalCost : 0;
        var viewCost = totalCost; // 观看成本需要 views，但 crowd summary 没有 views 字段，暂用总花费占位
        var orderCost = totalOrders > 0 ? totalCost / totalOrders : 0;
        var cartCost = totalCart > 0 ? totalCost / totalCart : 0;
        var preOrderCost = totalPreOrders > 0 ? totalCost / totalPreOrders : 0;
        var cpm = totalShows > 0 ? (totalCost / totalShows) * 1000 : 0;

        return '<tr class="crowd-summary-row">'
            + '<td><strong>汇总</strong></td>'
            + '<td>-</td>'
            + '<td><strong>¥' + formatMoney(totalCost) + '</strong></td>'
            + '<td><strong>¥' + formatMoney(totalAmount) + '</strong></td>'
            + '<td><strong>' + formatNum(totalOrders) + '</strong></td>'
            + '<td><strong>' + (roi > 0 ? roi.toFixed(2) : '-') + '</strong></td>'
            + '<td><strong>' + (directRoi > 0 ? directRoi.toFixed(2) : '-') + '</strong></td>'
            + '<td>' + '-' + '</td>'
            + '<td><strong>' + (orderCost > 0 ? '¥' + orderCost.toFixed(2) : '-') + '</strong></td>'
            + '<td><strong>' + (cartCost > 0 ? '¥' + cartCost.toFixed(2) : '-') + '</strong></td>'
            + '<td><strong>' + formatNum(totalPreOrders) + '</strong></td>'
            + '<td><strong>' + (preOrderCost > 0 ? '¥' + preOrderCost.toFixed(2) : '-') + '</strong></td>'
            + '<td>' + '-' + '</td>'
            + '<td>' + '-' + '</td>'
            + '<td>' + '-' + '</td>'
            + '<td><strong>' + (cpm > 0 ? '¥' + cpm.toFixed(2) : '-') + '</strong></td>'
            + '<td><strong>¥' + formatMoney(totalDirectAmount) + '</strong></td>'
            + '<td><strong>' + formatNum(totalCart) + '</strong></td>'
            + '<td><strong>' + formatNum(totalShows) + '</strong></td>'
            + '</tr>';
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

        // 已移除「广告收入 / 可计算天数 数据缺失」提示横幅（用户要求不再弹出）。

        document.querySelector('#ads-monthly-table tbody').innerHTML = monthly.length
            ? monthly.map(row => buildTableRow(row.label, row, true)).join('')
              + buildTableRow('汇总', kpiToRow(kpi), true, 'dash-summary-row')
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
            syncCrowdPlanSelect([]);
            updateCrowdFilterSummary([], []);
            return;
        }
        syncCrowdPlanSelect(rows);
        const visibleRows = getVisibleCrowdRows(rows);
        if (!visibleRows.length) {
            renderTableBodyState('#crowd-summary-table', '当前计划筛选下暂无人群数据');
            updateCrowdFilterSummary(rows, []);
            return;
        }
        var bodyHtml = visibleRows.map((row) => buildCrowdAudienceRow(row)).join('');
        bodyHtml += buildCrowdSummaryRow(visibleRows);
        document.querySelector('#crowd-summary-table tbody').innerHTML = bodyHtml;
        updateCrowdFilterSummary(rows, visibleRows);
    }

    function singleToNum(v) {
        const n = parseFloat(String(v ?? '').replace(/,/g, ''));
        return isFinite(n) ? n : 0;
    }

    function renderSingleLoadingState() {
        renderTableLoadingSkeleton('#single-table', 6);
    }

    function renderSingleState(message) {
        const tbody = document.querySelector('#single-table tbody');
        const colCount = document.querySelectorAll('#single-table thead th').length || 1;
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:#86868b;padding:24px">${escapeHtml(message)}</td></tr>`;
        }
    }

    function renderSingleKpi(products, rowCount) {
        // KPI 卡片已移除，保留空函数避免调用方报错
    }

    function getSingleProductName(product) {
        return String(product?.商品名称 || product?.product_name || product?.name || '未命名商品');
    }

    function getSingleProductSearchKeyword() {
        return String(document.getElementById('single-product-search')?.value || '').trim().toLowerCase();
    }

    function renderSingleTable(products) {
        const tbody = document.querySelector('#single-table tbody');
        if (!tbody) return;
        const allProducts = Array.isArray(products) ? products : [];
        const keyword = getSingleProductSearchKeyword();
        const visibleProducts = keyword
            ? allProducts.filter((product) => getSingleProductName(product).toLowerCase().includes(keyword))
            : allProducts;
        if (!allProducts.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#86868b;padding:24px">所选时间范围暂无数据</td></tr>';
            return;
        }
        if (!visibleProducts.length) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#86868b;padding:24px">未找到包含“${escapeHtml(keyword)}”的商品</td></tr>`;
            return;
        }
        tbody.innerHTML = visibleProducts.map((product) => {
            const cost = singleToNum(product?.花费);
            const directAmount = singleToNum(product?.直接成交金额);
            const productDirectAmount = singleToNum(product?.['该商品直接成交金额']);
            const cartCount = singleToNum(product?.['该商品加购数']);
            const roi = cost > 0 ? directAmount / cost : 0;
            const productRoi = cost > 0 ? productDirectAmount / cost : 0;
            const cartCost = cartCount > 0 ? cost / cartCount : 0;
            const imgUrl = typeof product?.img_url === 'string' ? product.img_url.trim() : '';
            const productName = getSingleProductName(product);
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
        buildCrowdAudienceRow,
        buildCrowdSummaryRow,
        getVisibleCrowdRows,
        toggleCrowdRow,
        renderAdsFromResponse,
        renderCrowdFromResponse,
        saveAudienceLayer,
        showLayerEditor,
        singleToNum,
        renderSingleLoadingState,
        renderSingleState,
        renderSingleKpi,
        getSingleProductName,
        renderSingleTable,
    };
})(window);
