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
        const jsonEl = document.getElementById('rule-json');
        if (!jsonEl) return;
        jsonEl.value = JSON.stringify(currentConfig, null, 2);
    }

    function renderRuleList() {
        const el = document.getElementById('rule-list');
        if (!el) return;
        el.innerHTML = rules.map((rule) => {
            const intentText = Array.isArray(rule.intents) && rule.intents.length
                ? rule.intents.map((item) => item.label || item.intent).join('、')
                : rule.rule_key;
            
            // 判断规则类型
            let typeLabel = '';
            let typeColor = '';
            if (rule.source === 'database') {
                const hasIntentKey = rule.config && rule.config.intentKey;
                typeLabel = hasIntentKey ? '动态规则' : '配置模板';
                typeColor = hasIntentKey ? '#18794e' : '#667085';
            } else {
                typeLabel = '专用处理器';
                typeColor = '#4f46e5';
            }
            
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
            el.innerHTML = '<div class="ra-small-note">这个规则暂无可视化输出参数，可在高级 JSON 中编辑。</div>';
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

    function renderCurrentRule() {
        const rule = rules.find((item) => item.rule_key === currentRuleKey);
        if (!rule) return;
        currentConfig = cloneConfig(rule.config);

        const intentText = Array.isArray(rule.intents) && rule.intents.length
            ? rule.intents.map((item) => item.label || item.intent).join('、')
            : rule.rule_key;
        
        // 判断规则类型
        let typeBadge = '';
        if (rule.source === 'database') {
            const hasIntentKey = rule.config && rule.config.intentKey;
            typeBadge = hasIntentKey 
                ? '<span style="background:#dcfce7;color:#18794e;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;">动态规则</span>'
                : '<span style="background:#f2f4f7;color:#667085;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;">配置模板</span>';
        } else {
            typeBadge = '<span style="background:#eef2ff;color:#4f46e5;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;">专用处理器</span>';
        }
        
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

        const jsonEl = document.getElementById('rule-json');
        jsonEl.addEventListener('blur', () => {
            try {
                currentConfig = JSON.parse(jsonEl.value || '{}');
                renderScopes();
                renderMetrics();
                renderOutputFields();
                document.getElementById('rule-label').value = String(currentConfig.label || '');
                setStatus('JSON 已同步到表单', 'good');
            } catch {
                setStatus('JSON 格式不正确，保存前需要修正', 'bad');
            }
        });

        document.getElementById('rule-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const saveButton = document.getElementById('save-btn');
            try {
                currentConfig = JSON.parse(jsonEl.value || '{}');
            } catch {
                setStatus('JSON 格式不正确，无法保存', 'bad');
                return;
            }

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
