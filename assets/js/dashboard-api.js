(function attachDashboardApi(window) {
    const DASHBOARD_SPEC_URL = 'assets/data/dashboard-spec.json?v=20260412a';
    const IN_FLIGHT_TIMEOUT_MS = 30000; // 30 秒超时清理挂起的请求
    let dashboardSpecPromise = null;

    async function loadDashboardSpec() {
        const response = await fetch(DASHBOARD_SPEC_URL, { cache: 'force-cache' });
        if (!response.ok) {
            throw new Error(`dashboard spec request failed (${response.status})`);
        }
        return response.json();
    }

    async function hydrateDashboardSpec() {
        if (!dashboardSpecPromise) {
            dashboardSpecPromise = loadDashboardSpec()
                .catch((error) => {
                    console.warn('Failed to load dashboard spec, fallback to built-in formulas', error);
                    return null;
                })
                .then((spec) => spec);
        }

        return dashboardSpecPromise;
    }

    async function fetchDashboardSummary(startDate, endDate, sections = 'all', options = {}) {
        const state = window.DashboardState;
        const authHelpers = window.authHelpers || {};
        const cacheKey = state.getDashboardCacheKey(startDate, endDate, sections);
        const forceRefresh = Boolean(options.forceRefresh);
        const includeMeta = options.includeMeta === true;
        if (!forceRefresh) {
            const cachedEntry = state.getCachedDashboardSummaryEntry(startDate, endDate, sections);
            if (cachedEntry) {
                return includeMeta ? cachedEntry : cachedEntry.data;
            }
        }

        const inFlightRequest = state.dashboardRequestsInFlight.get(cacheKey);
        if (inFlightRequest) {
            try {
                const resolved = await inFlightRequest;
                return includeMeta ? { data: resolved, source: 'network', cachedAt: Date.now() } : resolved;
            } catch {
                // 挂起的请求已失败或超时，清理后继续发起新请求
                state.dashboardRequestsInFlight.delete(cacheKey);
            }
        }

        const requestPromise = (async () => {
            const query = { start_date: startDate, end_date: endDate };
            if (sections !== 'all') {
                query.sections = sections;
            }

            const result = await authHelpers.fetchFunctionJson('dashboard-data', {
                query,
                cache: 'no-store',
                parseErrorMessage: '数据看板接口返回了无法解析的响应，请稍后重试',
                unauthorizedPattern: /未登录|invalid token|Missing Authorization/i,
                onUnauthorized: () => {
                    if (typeof options.onUnauthorized === 'function') {
                        options.onUnauthorized();
                    }
                },
            }).then(({ data }) => data);

            state.dashboardDataCache.set(cacheKey, result);
            state.writeDashboardSummaryToStorage(startDate, endDate, sections, result);
            return result;
        })();

        state.dashboardRequestsInFlight.set(cacheKey, requestPromise);

        // 超时清理：如果请求在超时时间内未完成，主动清理 in-flight 记录
        const cleanupTimer = setTimeout(() => {
            if (state.dashboardRequestsInFlight.get(cacheKey) === requestPromise) {
                state.dashboardRequestsInFlight.delete(cacheKey);
            }
        }, IN_FLIGHT_TIMEOUT_MS);

        try {
            const data = await requestPromise;
            return includeMeta ? { data, source: 'network', cachedAt: Date.now() } : data;
        } finally {
            clearTimeout(cleanupTimer);
            state.dashboardRequestsInFlight.delete(cacheKey);
        }
    }

    window.DashboardApi = {
        hydrateDashboardSpec,
        fetchDashboardSummary,
    };
})(window);
