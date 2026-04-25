function logout() {
    if (window.authHelpers && window.authHelpers.logout) {
        window.authHelpers.logout();
        return;
    }
    localStorage.removeItem('feishu_user');
    localStorage.removeItem('feishu_redirect');
    localStorage.removeItem('prompt_admin_token');
    localStorage.removeItem('prompt_admin_expires_at');
    sessionStorage.removeItem('feishu_user');
    sessionStorage.removeItem('feishu_redirect');
    sessionStorage.removeItem('oauth_state');
    document.cookie = 'feishu_user=; path=/; max-age=0';
    window.location.replace('auth/index.html');
}

// Load runtime config from assets/js/config.js
if (typeof CONFIG === 'undefined' || !CONFIG || !CONFIG.SB_URL) {
    console.error('Missing CONFIG (assets/js/config.js). Please provide CONFIG.SB_URL and CONFIG.SUPABASE_ANON_KEY');
}
const SB_URL = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.SB_URL) ? CONFIG.SB_URL : '';
const SB_KEY = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.SUPABASE_ANON_KEY) ? CONFIG.SUPABASE_ANON_KEY : '';

// 模块依赖校验：确保核心模块已加载
const REQUIRED_DASHBOARD_MODULES = ['DashboardState', 'DashboardRender', 'DashboardApi', 'DashboardLoader', 'DashboardEvents'];
const MISSING_MODULES = REQUIRED_DASHBOARD_MODULES.filter((ns) => !window[ns]);
if (MISSING_MODULES.length > 0) {
    console.error(`Dashboard 核心模块缺失: ${MISSING_MODULES.join(', ')}`);
}

const authHelpers = window.authHelpers || {};
const dashboardState = window.DashboardState || {};
const dashboardRender = window.DashboardRender || {};
const dashboardApi = window.DashboardApi || {};
const dashboardLoader = window.DashboardLoader || {};
const dashboardEvents = window.DashboardEvents || {};
const DASHBOARD_FEATURE_SCRIPTS = {
    export: {
        namespace: 'DashboardExport',
        label: '导出',
        url: 'assets/js/dashboard-export.js?v=20260411d',
    },
    ai: {
        namespace: 'DashboardAi',
        label: 'AI 分析',
        url: 'assets/js/dashboard-ai.js?v=20260415c',
    },
};
const dashboardFeatureScriptPromises = new Map();
const {
    setButtonBusy,
    resetButtonState,
    getCurrentDateRangeValue,
    savePendingAIAnalysisRequest,
    getPendingAIAnalysisRequest,
    clearPendingAIAnalysisRequest,
    readDashboardViewState,
    persistDashboardViewState,
    applyDashboardViewState,
    shouldRefreshDashboardCacheEntry,
    readDashboardSummaryFromStorage,
    readDashboardCacheEntryFromStorage,
    setActiveTabState,
    setSectionResponse,
    getSectionResponse,
    getSectionRangeKey,
    setSectionRangeKey,
    setSectionLoading,
    setSectionBackgroundRefreshing,
    setSectionCacheSource,
    getSectionCacheSource,
    setRequestMode,
} = dashboardState;
const {
    escapeHtml,
    classifyDashboardError,
    buildStateMessage,
    setDashboardStatus,
    renderAdsLoadingSkeleton,
    renderCrowdLoadingSkeleton,
    renderSingleLoadingState,
    renderSingleState,
    showLoading,
    hideLoading,
    updateLoading,
    formatNum,
    formatMoney,
    renderTableBodyState,
    showGlobalDashboardError,
    hideGlobalDashboardError,
    renderAdsState,
    renderAdsFromResponse,
    renderCrowdFromResponse,
    renderSingleKpi,
    renderSingleTable,
    toggleCrowdRow,
} = dashboardRender;
const hydrateDashboardSpec = dashboardApi.hydrateDashboardSpec || function() { return Promise.resolve(null); };
const requestDashboardSummary = dashboardApi.fetchDashboardSummary || function() { return Promise.reject(new Error('数据接口未就绪')); };
const {
    loadAds,
    loadCrowd,
    loadSingle: loadSingleSection,
    loadAll,
} = dashboardLoader;
const bindDashboardInteractions = dashboardEvents.bindDashboardInteractions || function() { console.warn('DashboardEvents 模块未加载'); };

function loadDashboardFeatureScript(featureName) {
    const feature = DASHBOARD_FEATURE_SCRIPTS[featureName];
    if (!feature) {
        return Promise.reject(new Error(`未知的数据看板功能模块: ${featureName}`));
    }

    if (window[feature.namespace]) {
        return Promise.resolve(window[feature.namespace]);
    }

    if (dashboardFeatureScriptPromises.has(featureName)) {
        return dashboardFeatureScriptPromises.get(featureName);
    }

    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = feature.url;
        script.async = true;
        script.dataset.dashboardFeature = featureName;

        const loadTimeout = setTimeout(() => {
            script.onerror = null;
            script.onload = null;
            reject(new Error(`${feature.label}模块加载超时，请检查网络后重试`));
        }, 15000);

        script.onload = () => {
            clearTimeout(loadTimeout);
            if (window[feature.namespace]) {
                resolve(window[feature.namespace]);
                return;
            }
            reject(new Error(`${feature.label}模块加载后未完成初始化`));
        };
        script.onerror = () => {
            clearTimeout(loadTimeout);
            reject(new Error(`${feature.label}模块加载失败，请刷新页面后重试`));
        };
        document.head.appendChild(script);
    }).catch((error) => {
        dashboardFeatureScriptPromises.delete(featureName);
        throw error;
    });

    dashboardFeatureScriptPromises.set(featureName, promise);
    return promise;
}

async function runDashboardExportAction(actionName) {
    try {
        const feature = await loadDashboardFeatureScript('export');
        const action = feature?.[actionName];
        if (typeof action !== 'function') {
            throw new Error(`导出模块缺少方法: ${actionName}`);
        }
        return action();
    } catch (error) {
        console.warn('dashboard export module error', error);
        setDashboardStatus('error', error.message || '导出模块加载失败，请刷新页面后重试。', 4200);
        throw error;
    }
}

function downloadAdsCSV() {
    return runDashboardExportAction('downloadAdsCSV');
}

function downloadFullReportCSV() {
    return runDashboardExportAction('downloadFullReportCSV');
}

function downloadSingleCSV() {
    return runDashboardExportAction('downloadSingleCSV');
}

async function openAIAnalysis() {
    try {
        setDashboardStatus('info', '正在加载 AI 分析模块...', 0);
        const feature = await loadDashboardFeatureScript('ai');
        return feature.openAIAnalysis();
    } catch (error) {
        console.warn('dashboard ai module error', error);
        setDashboardStatus('error', error.message || 'AI 分析模块加载失败，请刷新页面后重试。', 4200);
        throw error;
    }
}

function closeAIAnalysis() {
    if (window.DashboardAi?.closeAIAnalysis) {
        window.DashboardAi.closeAIAnalysis();
        return;
    }
    document.getElementById('ai-analysis-modal')?.classList.remove('show');
}

async function refreshAIAnalysis() {
    try {
        const feature = await loadDashboardFeatureScript('ai');
        return feature.refreshAIAnalysis();
    } catch (error) {
        console.warn('dashboard ai refresh error', error);
        setDashboardStatus('error', error.message || 'AI 分析模块加载失败，请刷新页面后重试。', 4200);
        throw error;
    }
}

function openReportCenter() {
    if (window.DashboardAi?.openReportCenter) {
        window.DashboardAi.openReportCenter();
        return;
    }
    window.location.href = 'insights.html';
}

function maybeResumePendingAIAnalysis(pendingRequest) {
    if (!pendingRequest || !getPromptAdminToken()) {
        return;
    }
    loadDashboardFeatureScript('ai')
        .then((feature) => feature.maybeResumePendingAIAnalysis(pendingRequest))
        .catch((error) => {
            console.warn('dashboard ai resume error', error);
            setDashboardStatus('warn', 'AI 分析模块加载失败，未能恢复上次分析请求。', 4200);
        });
}

function syncRangeActionButtons() {
    const adsButton = document.getElementById('load-ads-btn');
    const crowdButton = document.getElementById('load-crowd-btn');
    const singleButton = document.getElementById('load-single-btn');

    if (adsButton && !adsButton.dataset.busy) {
        adsButton.disabled = getCurrentDateRangeValue('ads') === adsButton.dataset.lastRange;
    }
    if (crowdButton && !crowdButton.dataset.busy) {
        crowdButton.disabled = getCurrentDateRangeValue('crowd') === crowdButton.dataset.lastRange;
    }
    if (singleButton && !singleButton.dataset.busy) {
        singleButton.disabled = getCurrentDateRangeValue('single') === singleButton.dataset.lastRange;
    }
}

function getPromptAdminToken() {
    return authHelpers.getPromptAdminToken ? authHelpers.getPromptAdminToken() : '';
}

function applyDashboardDateRange(startDate, endDate) {
    ['ads-start', 'crowd-start', 'single-start'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = startDate;
    });
    ['ads-end', 'crowd-end', 'single-end'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = endDate;
    });
}

function getAIAnalysisContext() {
    const activeTab = document.querySelector('.tab.active')?.dataset.tab ?? 'ads';
    const prefix = activeTab === 'crowd' ? 'crowd' : activeTab === 'single' ? 'single' : 'ads';
    const startDate = document.getElementById(`${prefix}-start`)?.value || '';
    const endDate = document.getElementById(`${prefix}-end`)?.value || '';
    const analysisType = activeTab === 'single' ? 'single' : 'daily';

    return {
        activeTab,
        startDate,
        endDate,
        analysisType,
    };
}

function setActiveTab(tabName, options = {}) {
    const targetTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    const targetPanel = document.getElementById(tabName);
    if (!targetTab || !targetPanel) {
        return;
    }

    tabs.forEach(item => {
        item.classList.remove('active');
        item.setAttribute('aria-selected', 'false');
    });
    tabContents.forEach(item => item.classList.remove('active'));
    targetTab.classList.add('active');
    targetTab.setAttribute('aria-selected', 'true');
    targetPanel.classList.add('active');
    setActiveTabState(tabName);
    persistDashboardViewState();

    if (options.skipAutoLoad) {
        return;
    }

    if (tabName === 'crowd' && !isResponseForRange(getCurrentCrowdResponse(), document.getElementById('crowd-start')?.value, document.getElementById('crowd-end')?.value)) {
        loadCrowd().catch(() => {});
    }
    if (tabName === 'single') {
        const start = (document.getElementById('single-start') || { value: '' }).value;
        const end = (document.getElementById('single-end') || { value: '' }).value;
        if (!isResponseForRange(getCurrentSingleResponse(), start, end) || getSectionRangeKey('single') !== `${start}|${end}`) {
            loadSingleSection().catch(() => {});
        }
    }
}

function redirectToPromptAdminLogin(message) {
    const modal = document.getElementById('ai-analysis-modal');
    const loading = document.getElementById('ai-analysis-loading');
    const body = document.getElementById('ai-analysis-body');
    const text = document.getElementById('ai-analysis-text');

    loading.style.display = 'none';
    body.style.display = 'block';
    text.textContent = `${message}\n\n正在跳转到登录页，请稍候...`;

    localStorage.setItem('feishu_redirect', window.location.href);
    localStorage.removeItem('prompt_admin_token');
    localStorage.removeItem('prompt_admin_expires_at');

    setTimeout(() => {
        modal.classList.remove('show');
        window.location.href = 'auth/index.html?force=1';
    }, 1200);
}

function handleDashboardAuthFailure(message) {
    if (typeof authHelpers.handleReauthRequired === 'function') {
        authHelpers.handleReauthRequired({
            source: 'dashboard',
            targetUrl: window.location.href,
            force: true,
            reason: 'prompt_admin_reauth_required',
            delayMs: 1200,
            message,
            onMessage: (msg) => setDashboardStatus('warn', msg, 0),
        });
        return;
    }
    setDashboardStatus('warn', message, 0);
    authHelpers.redirectToLogin?.({
        targetUrl: window.location.href,
        force: true,
        reason: 'prompt_admin_reauth_required',
        delayMs: 1200,
    });
}

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        setActiveTab(tab.dataset.tab);
    });
});

async function fetchDashboardSummary(startDate, endDate, sections = 'all', options = {}) {
    return requestDashboardSummary(startDate, endDate, sections, {
        ...options,
        onUnauthorized: () => {
            handleDashboardAuthFailure('数据看板登录状态已失效，正在刷新登录...');
        },
    });
}

function hasValidDateRange(start, end) {
    return Boolean(start && end && start <= end);
}

function isResponseForRange(response, start, end) {
    return response && response.range && response.range.start === start && response.range.end === end;
}


function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getRelativeDateInputValue(offsetDays = 0) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offsetDays);
    return formatDateInputValue(date);
}

function initDateRanges() {
    // 默认查询最近一天，避免首次打开拉取过大时间范围。
    // 这里不再写死日期，改为相对当前日期计算，避免页面默认值长期停留在旧日期。
    const adsDefaultDate = getRelativeDateInputValue(-1);
    const crowdDefaultDate = getRelativeDateInputValue(-1);
    const singleDefaultDate = getRelativeDateInputValue(-1);
    const adsStartEl = document.getElementById('ads-start');
    const adsEndEl = document.getElementById('ads-end');
    const crowdStartEl = document.getElementById('crowd-start');
    const crowdEndEl = document.getElementById('crowd-end');
    if (adsStartEl) adsStartEl.value = adsDefaultDate;
    if (adsEndEl) adsEndEl.value = adsDefaultDate;
    if (crowdStartEl) crowdStartEl.value = crowdDefaultDate;
    if (crowdEndEl) crowdEndEl.value = crowdDefaultDate;
    const singleStart = document.getElementById('single-start');
    const singleEnd = document.getElementById('single-end');
    if (singleStart) singleStart.value = singleDefaultDate;
    if (singleEnd) singleEnd.value = singleDefaultDate;
}

async function ensureAdsResponseCurrent() {
    const start = document.getElementById('ads-start')?.value;
    const end = document.getElementById('ads-end')?.value;
    if (!isResponseForRange(getCurrentAdsResponse(), start, end)) {
        setCurrentAdsResponse(await fetchDashboardSummary(start, end, 'ads'), { rangeKey: `${start}|${end}` });
    }
    return getCurrentAdsResponse();
}

async function ensureCrowdResponseCurrent() {
    const start = document.getElementById('crowd-start')?.value;
    const end = document.getElementById('crowd-end')?.value;
    if (!isResponseForRange(getCurrentCrowdResponse(), start, end)) {
        setCurrentCrowdResponse(await fetchDashboardSummary(start, end, 'crowd'), { rangeKey: `${start}|${end}` });
    }
    return getCurrentCrowdResponse();
}

async function ensureSingleResponseCurrent(start, end) {
    const rangeKey = `${start}|${end}`;
    if (!getCurrentSingleResponse() || getSectionRangeKey('single') !== rangeKey) {
        setCurrentSingleResponse(await fetchDashboardSummary(start, end, 'single'), { rangeKey });
    }
    return getCurrentSingleResponse();
}


function getCurrentAdsResponse() {
    return getSectionResponse('ads');
}

function setCurrentAdsResponse(value, options = {}) {
    setSectionResponse('ads', value, options);
}

function getCurrentCrowdResponse() {
    return getSectionResponse('crowd');
}

function setCurrentCrowdResponse(value, options = {}) {
    setSectionResponse('crowd', value, options);
}

function getCurrentSingleResponse() {
    return getSectionResponse('single');
}

function setCurrentSingleResponse(value, options = {}) {
    setSectionResponse('single', value, options);
}

window.DashboardApp = {
    logout,
    setButtonBusy,
    resetButtonState,
    setDashboardStatus,
    buildStateMessage,
    classifyDashboardError,
    hideGlobalDashboardError,
    showGlobalDashboardError,
    renderAdsLoadingSkeleton,
    renderCrowdLoadingSkeleton,
    renderSingleLoadingState,
    renderSingleState,
    renderAdsState,
    renderTableBodyState,
    renderAdsFromResponse,
    renderCrowdFromResponse,
    renderSingleKpi,
    renderSingleTable,
    showLoading,
    hideLoading,
    updateLoading,
    getPromptAdminToken,
    savePendingAIAnalysisRequest,
    getPendingAIAnalysisRequest,
    clearPendingAIAnalysisRequest,
    readDashboardViewState,
    persistDashboardViewState,
    shouldRefreshDashboardCacheEntry,
    readDashboardSummaryFromStorage,
    readDashboardCacheEntryFromStorage,
    hydrateDashboardSpec,
    applyDashboardDateRange,
    applyDashboardViewState,
    setActiveTab,
    getAIAnalysisContext,
    hasValidDateRange,
    isResponseForRange,
    redirectToPromptAdminLogin,
    fetchDashboardSummary,
    ensureAdsResponseCurrent,
    ensureCrowdResponseCurrent,
    ensureSingleResponseCurrent,
    syncRangeActionButtons,
    setSectionLoading,
    setSectionBackgroundRefreshing,
    setSectionCacheSource,
    getSectionCacheSource,
    setRequestMode,
    setCurrentAdsResponse,
    getCurrentAdsResponse,
    setCurrentCrowdResponse,
    getCurrentCrowdResponse,
    setCurrentSingleResponse,
    getCurrentSingleResponse,
    toggleCrowdRow,
    loadAds,
    loadCrowd,
    loadSingle: (options = {}) => loadSingleSection(options),
    downloadAdsCSV,
    downloadFullReportCSV,
    downloadSingleCSV,
    openAIAnalysis,
    closeAIAnalysis,
    refreshAIAnalysis,
    openReportCenter,
    maybeResumePendingAIAnalysis,
    initDateRanges,
    bumpCacheGeneration: dashboardState.bumpCacheGeneration || function() {},
};

document.addEventListener('DOMContentLoaded', () => {
    bindDashboardInteractions();
    loadAll();
});
