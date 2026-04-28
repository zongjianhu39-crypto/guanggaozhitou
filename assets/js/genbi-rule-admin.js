(function attachGenbiRuleAdmin(window) {
    const authHelpers = window.authHelpers || {};

    const DATA_SCOPES = [
        { key: 'ads', label: '整体广告' },
        { key: 'crowd', label: '人群数据' },
        { key: 'single', label: '单品广告' },
    ];

    let rules = [];
    let metrics = {};
    let currentRuleKey = '';
    let currentConfig = {};
    let authRedirectScheduled = false;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function cloneConfig(value) {
        return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {}));
    }

    function showError(message) {
        const el = document.getElementById('err-banner');
        if (!el) return;
        el.textContent = message;
        el.classList.add('show');
    }

    function hideError() {
        const el = document.getElementById('err-banner');
        if (!el) return;
        el.classList.remove('show');
    }

    function setStatus(message, kind = '') {
        const el = document.getElementById('save-status');
        if (!el) return;
        el.textContent = message;
        el.className = 'ra-status' + (kind ? ` ${kind}` : '');
    }

    function getDefaultPreviewRange() {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 6);
        const fmt = (d) => d.toISOString().slice(0, 10);
        return { start: fmt(start), end: fmt(end) };
    }

    function ensurePreviewDateDefaults() {
        const startEl = document.getElementById('preview-start');
        const endEl = document.getElementById('preview-end');
        if (!startEl || !endEl) return { start: '', end: '' };
        const defaults = getDefaultPreviewRange();
        if (!startEl.value) startEl.value = defaults.start;
        if (!endEl.value) endEl.value = defaults.end;
        return { start: startEl.value, end: endEl.value };
    }

    function renderPreviewPanel(meta, preview, errorMessage) {
        const panel = document.getElementById('preview-panel');
        if (!panel) return;
        panel.classList.add('show');

        if (errorMessage) {
            panel.innerHTML = `<div class="ra-preview-head"><h3>试跑预览</h3></div>`
                + `<div class="ra-preview-answer" style="color:#b91c1c">${escapeHtml(errorMessage)}</div>`;
            return;
        }

        const envelope = preview || {};
        const headline = envelope.headline || '无标题';
        const answer = envelope.answer || '';
        const tables = Array.isArray(envelope.tables) ? envelope.tables : [];
        const notes = Array.isArray(envelope.notes) ? envelope.notes : [];
        const insights = Array.isArray(envelope.insights) ? envelope.insights : [];
        const execution = envelope.rule_execution || {};
        const range = (meta && meta.range) || {};

        const metaLines = [
            `规则 Key：${escapeHtml(meta?.rule_key || '-')}`,
            `意图：${escapeHtml(meta?.intent || '-')}`,
            `日期范围：${escapeHtml(range.start || '-')} 至 ${escapeHtml(range.end || '-')}`,
            `耗时：${meta?.duration_ms ?? '-'} ms`,
        ];
        if (execution && typeof execution === 'object') {
            if (execution.source) metaLines.push(`执行源：${escapeHtml(String(execution.source))}`);
            if (execution.primaryMetric) metaLines.push(`主指标：${escapeHtml(String(execution.primaryMetric))}`);
            if (execution.secondaryMetric) metaLines.push(`次指标：${escapeHtml(String(execution.secondaryMetric))}`);
            if (execution.originalCount !== undefined) {
                metaLines.push(`数据流水：${execution.originalCount} → ${execution.filteredCount ?? '-'}`);
            }
        }

        let tablesHtml = '';
        tables.forEach((table, idx) => {
            if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return;
            const cols = table.columns.map((c) => String(c));
            const rowsHtml = table.rows.slice(0, 20).map((row) => {
                return '<tr>' + cols.map((col) => `<td>${escapeHtml(row?.[col] ?? '')}</td>`).join('') + '</tr>';
            }).join('');
            const extra = table.rows.length > 20 ? `<div class="ra-small-note">（仅展示前 20 行，共 ${table.rows.length} 行）</div>` : '';
            tablesHtml += `
                <div class="ra-preview-section">
                    <h4>${escapeHtml(table.title || `表格 ${idx + 1}`)}</h4>
                    <table class="ra-preview-table">
                        <thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
                        <tbody>${rowsHtml || `<tr><td colspan="${cols.length}">无数据</td></tr>`}</tbody>
                    </table>
                    ${extra}
                </div>`;
        });

        const insightsHtml = insights.length
            ? `<div class="ra-preview-section"><h4>洞察</h4><ul style="margin:0;padding-left:18px;color:#344054;font-size:13px;line-height:1.7;">${insights.map((i) => `<li>${escapeHtml(String(i))}</li>`).join('')}</ul></div>`
            : '';
        const notesHtml = notes.length
            ? `<div class="ra-preview-section"><h4>备注</h4><ul style="margin:0;padding-left:18px;color:#475467;font-size:12px;line-height:1.7;">${notes.map((n) => `<li>${escapeHtml(String(n))}</li>`).join('')}</ul></div>`
            : '';

        panel.innerHTML = `
            <div class="ra-preview-head">
                <h3>${escapeHtml(headline)}</h3>
                <div class="ra-preview-meta">${metaLines.map((line) => `<div>${line}</div>`).join('')}</div>
            </div>
            ${answer ? `<div class="ra-preview-section"><h4>回答</h4><div class="ra-preview-answer">${escapeHtml(answer)}</div></div>` : ''}
            ${tablesHtml}
            ${insightsHtml}
            ${notesHtml}
        `;
    }

    async function runPreview() {
        const previewBtn = document.getElementById('preview-btn');
        if (!currentRuleKey) {
            setStatus('请先选择或新建一条规则', 'warn');
            return;
        }
        const rule = rules.find((item) => item.rule_key === currentRuleKey);
        if (!rule) return;
        const range = ensurePreviewDateDefaults();
        if (!range.start || !range.end) {
            setStatus('请设定试跑日期范围', 'warn');
            return;
        }

        previewBtn.disabled = true;
        setStatus('试跑中…', 'warn');
        try {
            const data = await apiRequest('POST', {
                action: 'preview_rule',
                rule_key: currentRuleKey,
                label: String(currentConfig.label || rule.label || currentRuleKey),
                intent: String(currentConfig.intentKey || '').trim(),
                config: currentConfig,
                range,
            });
            renderPreviewPanel(data.preview_meta, data.preview, null);
            setStatus(`试跑完成（${data?.preview_meta?.duration_ms ?? '-'} ms）`, 'good');
        } catch (error) {
            const errorState = authHelpers.describeFetchError
                ? authHelpers.describeFetchError(error, '试跑失败，请稍后重试。')
                : { message: `试跑失败：${error.message}` };
            renderPreviewPanel({ rule_key: currentRuleKey }, null, errorState.message);
            setStatus(errorState.message, 'bad');
        } finally {
            previewBtn.disabled = false;
        }
    }

    function getAdminToken() {
        return authHelpers.getPromptAdminToken ? authHelpers.getPromptAdminToken() : (localStorage.getItem('prompt_admin_token') || '');
    }

    function isAdminTokenExpired() {
        return authHelpers.isPromptAdminTokenExpired ? authHelpers.isPromptAdminTokenExpired() : false;
    }

    function redirectToPromptAdminLogin(message) {
        if (authRedirectScheduled) return;
        authRedirectScheduled = true;
        showError(message || '规则管理权限已失效，正在跳转重新登录。');
        if (typeof authHelpers.handleReauthRequired === 'function') {
            authHelpers.handleReauthRequired({
                source: 'genbi-rule-admin',
                targetUrl: window.location.href,
                force: true,
                reason: 'prompt_admin_reauth_required',
                delayMs: 1200,
            });
            return;
        }
        setTimeout(() => window.location.replace('auth/index.html?force=1'), 1200);
    }

    async function apiRequest(method, body = null) {
        const token = getAdminToken();
        if (!token || isAdminTokenExpired()) {
            redirectToPromptAdminLogin(token ? '规则管理权限已过期，正在跳转重新登录。' : '未检测到规则管理权限，正在跳转授权登录。');
            throw new Error('规则管理权限已失效，请重新登录');
        }

        const { data } = await authHelpers.fetchFunctionJson('genbi-rule-admin', {
            method,
            headers: { 'Content-Type': 'application/json' },
            body,
            useSessionToken: false,
            includePromptAdminToken: true,
            unauthorizedPattern: /无效或已过期/,
            unauthorizedMessage: '规则管理权限已过期，请重新登录',
            onUnauthorized: () => {
                redirectToPromptAdminLogin('规则管理权限已过期，正在跳转重新登录。');
            },
        });
        if (!data.success) throw new Error(data.error || '请求失败');
        return data;
    }

    function getMetricLabel(key) {
        const item = metrics[key] && typeof metrics[key] === 'object' ? metrics[key] : {};
        return String(item.label || key);
    }

    function getSelectedMetrics(config = currentConfig) {
        const strategy = config.strategy && typeof config.strategy === 'object' ? config.strategy : {};
        const selected = Array.isArray(strategy.metrics) ? strategy.metrics.map(String) : [];
        const primary = strategy.primaryMetric ? [String(strategy.primaryMetric)] : [];
        const secondary = strategy.secondaryMetric ? [String(strategy.secondaryMetric)] : [];
        return Array.from(new Set([...selected, ...primary, ...secondary].filter(Boolean)));
    }

    function syncJsonTextarea() {
        // JSON 编辑区已移除，所有配置通过可视化表单编辑
    }

    function renderRuleList() {
        const el = document.getElementById('rule-list');
        if (!el) return;
        el.innerHTML = rules.map((rule) => {
            const intentText = Array.isArray(rule.intents) && rule.intents.length
                ? rule.intents.map((item) => item.label || item.intent).join('、')
                : rule.rule_key;
            
            // 所有规则都是动态规则（已完全迁移）
            const typeLabel = '动态规则';
            const typeColor = '#18794e';
            
            return `
                <button class="ra-rule-btn${rule.rule_key === currentRuleKey ? ' active' : ''}" type="button" data-rule-key="${escapeHtml(rule.rule_key)}">
                    ${escapeHtml(rule.label || rule.rule_key)}
                    <span class="ra-rule-source">
                        ${escapeHtml(intentText)} · 
                        <span style="color:${typeColor};font-weight:600;">${typeLabel}</span>
                    </span>
                </button>
            `;
        }).join('');
        el.querySelectorAll('.ra-rule-btn').forEach((button) => {
            button.addEventListener('click', () => selectRule(button.dataset.ruleKey));
        });
    }

    async function createNewRule() {
        const label = prompt('请输入新规则的名称：');
        if (!label || !label.trim()) return;

        const ruleKey = 'rule_' + Date.now();
        const config = {
            label: label.trim(),
            intentKey: '',
            dataScope: [],
            strategy: { metrics: [] },
            output: {},
        };

        try {
            setStatus('创建中...', 'warn');
            const data = await apiRequest('POST', {
                action: 'create_rule',
                rule_key: ruleKey,
                label: label.trim(),
                config,
            });
            rules = Array.isArray(data.rules) ? data.rules : [];
            metrics = data.metrics && typeof data.metrics === 'object' ? data.metrics : {};
            currentRuleKey = ruleKey;
            renderRuleList();
            renderCurrentRule();
            setStatus('新规则已创建，请继续编辑', 'good');
        } catch (error) {
            const errorState = authHelpers.describeFetchError
                ? authHelpers.describeFetchError(error, '创建失败，请稍后重试。')
                : { message: `创建失败：${error.message}` };
            setStatus(errorState.message, 'bad');
        }
    }

    async function deleteCurrentRule() {
        const rule = rules.find((item) => item.rule_key === currentRuleKey);
        if (!rule) return;

        const confirmed = confirm(`确定要删除规则 "${rule.label || rule.rule_key}" 吗？\n\n此操作将停用该规则，但不会删除历史数据。`);
        if (!confirmed) return;

        const deleteButton = document.getElementById('delete-btn');
        deleteButton.disabled = true;
        setStatus('删除中...', 'warn');

        try {
            const data = await apiRequest('POST', {
                action: 'delete_rule',
                rule_key: currentRuleKey,
            });
            rules = Array.isArray(data.rules) ? data.rules : [];
            metrics = data.metrics && typeof data.metrics === 'object' ? data.metrics : {};

            if (rules.length > 0) {
                currentRuleKey = rules[0].rule_key;
                renderRuleList();
                renderCurrentRule();
            } else {
                currentRuleKey = '';
                renderRuleList();
                document.getElementById('rule-title').textContent = '暂无规则';
                document.getElementById('rule-desc').textContent = '请添加新规则开始使用。';
                document.getElementById('rule-form').style.display = 'none';
            }
            setStatus('规则已删除', 'good');
        } catch (error) {
            const errorState = authHelpers.describeFetchError
                ? authHelpers.describeFetchError(error, '删除失败，请稍后重试。')
                : { message: `删除失败：${error.message}` };
            setStatus(errorState.message, 'bad');
        } finally {
            deleteButton.disabled = false;
        }
    }

    function renderScopes() {
        const selected = new Set(Array.isArray(currentConfig.dataScope) ? currentConfig.dataScope.map(String) : []);
        const el = document.getElementById('scope-fields');
        el.innerHTML = DATA_SCOPES.map((scope) => `
            <label class="ra-check">
                <input type="checkbox" value="${scope.key}" ${selected.has(scope.key) ? 'checked' : ''}>
                <span>${scope.label}</span>
            </label>
        `).join('');
        el.querySelectorAll('input').forEach((input) => {
            input.addEventListener('change', () => {
                currentConfig.dataScope = Array.from(el.querySelectorAll('input:checked')).map((item) => item.value);
                syncJsonTextarea();
            });
        });
    }

    function renderMetrics() {
        const selected = new Set(getSelectedMetrics());
        const metricEntries = Object.entries(metrics);
        const el = document.getElementById('metric-fields');
        el.innerHTML = metricEntries.map(([key]) => `
            <label class="ra-check">
                <input type="checkbox" value="${escapeHtml(key)}" ${selected.has(key) ? 'checked' : ''}>
                <span>${escapeHtml(getMetricLabel(key))}</span>
            </label>
        `).join('');
        el.querySelectorAll('input').forEach((input) => {
            input.addEventListener('change', () => {
                if (!currentConfig.strategy || typeof currentConfig.strategy !== 'object') currentConfig.strategy = {};
                currentConfig.strategy.metrics = Array.from(el.querySelectorAll('input:checked')).map((item) => item.value);
                syncJsonTextarea();
            });
        });
    }

    function renderOutputFields() {
        const output = currentConfig.output && typeof currentConfig.output === 'object' ? currentConfig.output : {};
        currentConfig.output = output;
        const entries = Object.entries(output).filter(([, value]) => typeof value === 'number' || typeof value === 'string');
        const el = document.getElementById('output-fields');
        if (!entries.length) {
            el.innerHTML = '<div class="ra-small-note">这个规则暂无可视化输出参数。</div>';
            return;
        }
        el.innerHTML = entries.map(([key, value]) => `
            <div class="ra-field">
                <label for="out-${escapeHtml(key)}">${escapeHtml(key)}</label>
                <input id="out-${escapeHtml(key)}" class="ra-input" data-output-key="${escapeHtml(key)}" value="${escapeHtml(value)}">
            </div>
        `).join('');
        el.querySelectorAll('[data-output-key]').forEach((input) => {
            input.addEventListener('input', () => {
                const key = input.dataset.outputKey;
                const original = output[key];
                const value = input.value.trim();
                const numericValue = Number(value || 0);
                output[key] = typeof original === 'number' && Number.isFinite(numericValue) ? numericValue : value;
                syncJsonTextarea();
            });
        });
    }

    // 新增：渲染策略配置（可视化）
    function renderStrategyFields() {
        const strategy = currentConfig.strategy || {};
        
        const primarySelect = document.getElementById('strategy-primary');
        if (primarySelect) {
            primarySelect.value = strategy.primaryMetric || '';
            primarySelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.primaryMetric = primarySelect.value || undefined;
                if (!currentConfig.strategy.primaryMetric) delete currentConfig.strategy.primaryMetric;
                syncJsonTextarea();
            });
        }
        
        const secondarySelect = document.getElementById('strategy-secondary');
        if (secondarySelect) {
            secondarySelect.value = strategy.secondaryMetric || '';
            secondarySelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.secondaryMetric = secondarySelect.value || undefined;
                if (!currentConfig.strategy.secondaryMetric) delete currentConfig.strategy.secondaryMetric;
                syncJsonTextarea();
            });
        }
        
        const increaseSelect = document.getElementById('strategy-increase');
        if (increaseSelect) {
            increaseSelect.value = strategy.increaseSort || '';
            increaseSelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.increaseSort = increaseSelect.value || undefined;
                if (!currentConfig.strategy.increaseSort) delete currentConfig.strategy.increaseSort;
                syncJsonTextarea();
            });
        }
        
        const decreaseSelect = document.getElementById('strategy-decrease');
        if (decreaseSelect) {
            decreaseSelect.value = strategy.decreaseSort || '';
            decreaseSelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.decreaseSort = decreaseSelect.value || undefined;
                if (!currentConfig.strategy.decreaseSort) delete currentConfig.strategy.decreaseSort;
                syncJsonTextarea();
            });
        }
        
        // 高级排序模式
        const sortModeSelect = document.getElementById('strategy-sort-mode');
        if (sortModeSelect) {
            // 根据现有的 sort 数组判断使用哪种模式
            const sortArray = Array.isArray(strategy.sort) ? strategy.sort : [];
            let currentMode = '';
            
            if (sortArray.includes('roi_x_gmv_desc')) {
                currentMode = 'roi_x_gmv_desc';
            } else if (sortArray.includes('primary_asc') && sortArray.includes('secondary_desc') && sortArray.includes('cost_desc')) {
                currentMode = 'primary_asc_secondary_desc_cost_desc';
            }
            
            sortModeSelect.value = currentMode;
            sortModeSelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                const mode = sortModeSelect.value;
                
                if (mode === 'roi_x_gmv_desc') {
                    currentConfig.strategy.sort = ['roi_x_gmv_desc'];
                } else if (mode === 'primary_asc_secondary_desc_cost_desc') {
                    currentConfig.strategy.sort = ['primary_asc', 'secondary_desc', 'cost_desc'];
                } else {
                    delete currentConfig.strategy.sort;
                }
                syncJsonTextarea();
            });
        }

        // 对比人群分层
        const comparisonLayersInput = document.getElementById('strategy-comparison-layers');
        if (comparisonLayersInput) {
            const layers = Array.isArray(strategy.comparisonLayers) ? strategy.comparisonLayers.join(',') : '';
            comparisonLayersInput.value = layers;
            comparisonLayersInput.addEventListener('input', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                const value = comparisonLayersInput.value.trim();
                if (value) {
                    currentConfig.strategy.comparisonLayers = value.split(',').map(s => s.trim()).filter(s => s);
                } else {
                    delete currentConfig.strategy.comparisonLayers;
                }
                syncJsonTextarea();
            });
        }

        // 对比模式
        const comparisonModeSelect = document.getElementById('strategy-comparison-mode');
        if (comparisonModeSelect) {
            comparisonModeSelect.value = strategy.comparisonMode || '';
            comparisonModeSelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.comparisonMode = comparisonModeSelect.value || undefined;
                if (!currentConfig.strategy.comparisonMode) delete currentConfig.strategy.comparisonMode;
                syncJsonTextarea();
            });
        }

        // 匹配模式
        const matchModeSelect = document.getElementById('strategy-match-mode');
        if (matchModeSelect) {
            matchModeSelect.value = strategy.matchMode || '';
            matchModeSelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.matchMode = matchModeSelect.value || undefined;
                if (!currentConfig.strategy.matchMode) delete currentConfig.strategy.matchMode;
                syncJsonTextarea();
            });
        }

        // 人群排序
        const crowdSortSelect = document.getElementById('strategy-crowd-sort');
        if (crowdSortSelect) {
            crowdSortSelect.value = strategy.crowdSort || '';
            crowdSortSelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.crowdSort = crowdSortSelect.value || undefined;
                if (!currentConfig.strategy.crowdSort) delete currentConfig.strategy.crowdSort;
                syncJsonTextarea();
            });
        }

        // 商品排序
        const productSortSelect = document.getElementById('strategy-product-sort');
        if (productSortSelect) {
            productSortSelect.value = strategy.productSort || '';
            productSortSelect.addEventListener('change', () => {
                currentConfig.strategy = currentConfig.strategy || {};
                currentConfig.strategy.productSort = productSortSelect.value || undefined;
                if (!currentConfig.strategy.productSort) delete currentConfig.strategy.productSort;
                syncJsonTextarea();
            });
        }
    }

    // 新增：渲染过滤条件（可视化）
    function renderFilterFields() {
        const filters = currentConfig.filters || {};
        
        const minCostShareInput = document.getElementById('filter-min-cost-share');
        if (minCostShareInput) {
            minCostShareInput.value = filters.minCostShare ?? '';
            minCostShareInput.addEventListener('input', () => {
                currentConfig.filters = currentConfig.filters || {};
                const value = parseFloat(minCostShareInput.value);
                if (Number.isFinite(value) && value > 0) {
                    currentConfig.filters.minCostShare = value;
                } else {
                    delete currentConfig.filters.minCostShare;
                }
                syncJsonTextarea();
            });
        }
        
        const excludeLayersInput = document.getElementById('filter-exclude-layers');
        if (excludeLayersInput) {
            const layers = Array.isArray(filters.excludeLayers) ? filters.excludeLayers.join(',') : '';
            excludeLayersInput.value = layers;
            excludeLayersInput.addEventListener('input', () => {
                currentConfig.filters = currentConfig.filters || {};
                const value = excludeLayersInput.value.trim();
                if (value) {
                    currentConfig.filters.excludeLayers = value.split(',').map(s => s.trim()).filter(s => s);
                } else {
                    delete currentConfig.filters.excludeLayers;
                }
                syncJsonTextarea();
            });
        }
        
        const requireFiniteCheckbox = document.getElementById('filter-require-finite');
        if (requireFiniteCheckbox) {
            requireFiniteCheckbox.checked = !!filters.requireFinitePrimaryMetric;
            requireFiniteCheckbox.addEventListener('change', () => {
                currentConfig.filters = currentConfig.filters || {};
                if (requireFiniteCheckbox.checked) {
                    currentConfig.filters.requireFinitePrimaryMetric = true;
                } else {
                    delete currentConfig.filters.requireFinitePrimaryMetric;
                }
                syncJsonTextarea();
            });
        }
        
        // FocusPool 配置
        const minFocusPoolInput = document.getElementById('filter-min-focus-pool');
        if (minFocusPoolInput) {
            minFocusPoolInput.value = filters.minFocusPoolSize ?? '';
            minFocusPoolInput.addEventListener('input', () => {
                currentConfig.filters = currentConfig.filters || {};
                const value = parseInt(minFocusPoolInput.value);
                if (Number.isFinite(value) && value > 0) {
                    currentConfig.filters.minFocusPoolSize = value;
                } else {
                    delete currentConfig.filters.minFocusPoolSize;
                }
                syncJsonTextarea();
            });
        }
        
        const focusPoolCoverageInput = document.getElementById('filter-focus-pool-coverage');
        if (focusPoolCoverageInput) {
            focusPoolCoverageInput.value = filters.focusPoolCostCoverage ?? '';
            focusPoolCoverageInput.addEventListener('input', () => {
                currentConfig.filters = currentConfig.filters || {};
                const value = parseFloat(focusPoolCoverageInput.value);
                if (Number.isFinite(value) && value > 0 && value <= 1) {
                    currentConfig.filters.focusPoolCostCoverage = value;
                } else {
                    delete currentConfig.filters.focusPoolCostCoverage;
                }
                syncJsonTextarea();
            });
        }
        
        const requirePositiveCostCheckbox = document.getElementById('filter-require-positive-cost');
        if (requirePositiveCostCheckbox) {
            requirePositiveCostCheckbox.checked = !!filters.requirePositiveCost;
            requirePositiveCostCheckbox.addEventListener('change', () => {
                currentConfig.filters = currentConfig.filters || {};
                if (requirePositiveCostCheckbox.checked) {
                    currentConfig.filters.requirePositiveCost = true;
                } else {
                    delete currentConfig.filters.requirePositiveCost;
                }
                syncJsonTextarea();
            });
        }
        
        const requirePositiveOrdersCheckbox = document.getElementById('filter-require-positive-orders');
        if (requirePositiveOrdersCheckbox) {
            requirePositiveOrdersCheckbox.checked = !!filters.requirePositiveOrders;
            requirePositiveOrdersCheckbox.addEventListener('change', () => {
                currentConfig.filters = currentConfig.filters || {};
                if (requirePositiveOrdersCheckbox.checked) {
                    currentConfig.filters.requirePositiveOrders = true;
                } else {
                    delete currentConfig.filters.requirePositiveOrders;
                }
                syncJsonTextarea();
            });
        }
    }

    function renderCurrentRule() {
        const rule = rules.find((item) => item.rule_key === currentRuleKey);
        if (!rule) return;
        currentConfig = cloneConfig(rule.config);

        const intentText = Array.isArray(rule.intents) && rule.intents.length
            ? rule.intents.map((item) => item.label || item.intent).join('、')
            : rule.rule_key;
        
        // 所有规则都是动态规则（已完全迁移）
        const typeBadge = '<span style="background:#dcfce7;color:#18794e;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;">动态规则</span>';
        
        document.getElementById('rule-title').textContent = rule.label || rule.rule_key;
        document.getElementById('rule-desc').innerHTML = `对应意图：${escapeHtml(intentText)}。类型：${typeBadge}`;
        document.getElementById('rule-label').value = String(currentConfig.label || rule.label || '');
        document.getElementById('rule-intent').value = String(currentConfig.intentKey || '');
        document.getElementById('rule-form').style.display = '';

        const deleteButton = document.getElementById('delete-btn');
        if (rule.source === 'default') {
            deleteButton.style.display = 'none';
        } else {
            deleteButton.style.display = '';
        }

        renderScopes();
        renderMetrics();
        renderOutputFields();
        renderStrategyFields();  // 新增：渲染策略配置
        renderFilterFields();    // 新增：渲染过滤条件
        syncJsonTextarea();
        setStatus('');
        renderRuleList();
    }

    function selectRule(ruleKey) {
        if (!ruleKey || ruleKey === currentRuleKey) return;
        currentRuleKey = ruleKey;
        renderCurrentRule();
        const url = new URL(window.location.href);
        url.searchParams.set('rule_key', ruleKey);
        window.history.replaceState(null, '', url.toString());
    }

    async function loadRules() {
        hideError();
        setStatus('加载中…', 'warn');
        try {
            const data = await apiRequest('GET');
            rules = Array.isArray(data.rules) ? data.rules : [];
            metrics = data.metrics && typeof data.metrics === 'object' ? data.metrics : {};
            if (data.editor_identity) {
                const name = data.editor_identity.name || data.editor_identity.email || '';
                document.getElementById('identity-chip').textContent = name ? `编辑身份：${name}` : '';
            }

            const requested = new URLSearchParams(window.location.search).get('rule_key') || '';
            currentRuleKey = rules.some((rule) => rule.rule_key === requested)
                ? requested
                : (rules[0]?.rule_key || '');
            renderRuleList();
            if (currentRuleKey) renderCurrentRule();
            setStatus('');
        } catch (error) {
            if (!authRedirectScheduled) {
                const errorState = authHelpers.describeFetchError
                    ? authHelpers.describeFetchError(error, 'GenBI 规则加载失败，请稍后重试。')
                    : { message: `加载失败：${error.message}` };
                showError(errorState.message);
                setStatus(errorState.badge || '加载失败', 'bad');
            }
        }
    }

    function bindInteractions() {
        document.querySelectorAll('[data-action="logout"]').forEach((link) => {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                if (authHelpers.logout) authHelpers.logout();
                else window.location.replace('auth/index.html');
            });
        });

        document.getElementById('add-rule-btn').addEventListener('click', createNewRule);
        document.getElementById('delete-btn').addEventListener('click', deleteCurrentRule);
        const previewBtn = document.getElementById('preview-btn');
        if (previewBtn) previewBtn.addEventListener('click', runPreview);
        ensurePreviewDateDefaults();

        const labelEl = document.getElementById('rule-label');
        labelEl.addEventListener('input', () => {
            currentConfig.label = labelEl.value.trim();
            syncJsonTextarea();
        });

        const intentEl = document.getElementById('rule-intent');
        intentEl.addEventListener('input', () => {
            currentConfig.intentKey = intentEl.value.trim();
            syncJsonTextarea();
        });

        document.getElementById('rule-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const saveButton = document.getElementById('save-btn');

            const rule = rules.find((item) => item.rule_key === currentRuleKey);
            if (!rule) return;
            saveButton.disabled = true;
            setStatus('保存中…', 'warn');

            try {
                const data = await apiRequest('POST', {
                    action: 'save_rule',
                    rule_key: currentRuleKey,
                    label: String(currentConfig.label || rule.label || currentRuleKey),
                    config: currentConfig,
                });
                rules = Array.isArray(data.rules) ? data.rules : rules;
                metrics = data.metrics && typeof data.metrics === 'object' ? data.metrics : metrics;
                const nextRule = rules.find((item) => item.rule_key === currentRuleKey);
                if (nextRule) currentConfig = cloneConfig(nextRule.config);
                renderCurrentRule();
                setStatus('已保存，问数接口会在短时间内使用新规则', 'good');
            } catch (error) {
                const errorState = authHelpers.describeFetchError
                    ? authHelpers.describeFetchError(error, '保存失败，请稍后重试。')
                    : { message: `保存失败：${error.message}` };
                setStatus(errorState.message, 'bad');
            } finally {
                saveButton.disabled = false;
            }
        });
    }

    (function init() {
        bindInteractions();
        if (!authHelpers.getSupabaseUrl || !authHelpers.getSupabaseUrl()) {
            showError('缺少运行时配置，请联系管理员。');
            return;
        }
        loadRules();
    })();
})(window);
