(function attachDashboardState(window) {
    const PENDING_AI_ANALYSIS_KEY = 'pending_ai_analysis_request';
    const DASHBOARD_VIEW_STATE_KEY = 'dashboard_view_state_v3';
    const DASHBOARD_CACHE_PREFIX = 'dashboard_summary_cache_v5';
    const DASHBOARD_CACHE_TTL_MS = 20 * 60 * 1000;
    const DASHBOARD_HISTORICAL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
    const DASHBOARD_BACKGROUND_REFRESH_AFTER_MS = 5 * 60 * 1000;
    const DASHBOARD_HISTORICAL_BACKGROUND_REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
    const CACHE_BACKENDS = [
        { storage: localStorage, label: 'localStorage' },
        { storage: sessionStorage, label: 'sessionStorage' },
    ];
    const dashboardDataCache = new Map();
    const dashboardRequestsInFlight = new Map();
    const buttonLabelStore = new WeakMap();
    const dashboardRuntimeState = {
        activeTab: 'ads',
        requestMode: 'idle',
        sectionState: {
            ads: { response: null, rangeKey: '', loading: false, backgroundRefreshing: false, lastCacheSource: '' },
            crowd: { response: null, rangeKey: '', loading: false, backgroundRefreshing: false, lastCacheSource: '' },
            single: { response: null, rangeKey: '', loading: false, backgroundRefreshing: false, lastCacheSource: '' },
        },
    };

    function getButtonDefaultLabel(button) {
        if (!button) {
            return '';
        }
        if (!buttonLabelStore.has(button)) {
            buttonLabelStore.set(button, button.textContent || '');
        }
        return buttonLabelStore.get(button) || '';
    }

    function setButtonBusy(button, busyText) {
        if (!button) {
            return;
        }
        const defaultLabel = getButtonDefaultLabel(button);
        button.disabled = true;
        button.textContent = busyText || defaultLabel;
        button.dataset.busy = 'true';
    }

    function resetButtonState(button) {
        if (!button) {
            return;
        }
        button.disabled = false;
        button.textContent = getButtonDefaultLabel(button);
        delete button.dataset.busy;
    }

    function getCurrentDateRangeValue(prefix) {
        const start = document.getElementById(`${prefix}-start`)?.value || '';
        const end = document.getElementById(`${prefix}-end`)?.value || '';
        return `${start}|${end}`;
    }

    function savePendingAIAnalysisRequest(payload) {
        localStorage.setItem(PENDING_AI_ANALYSIS_KEY, JSON.stringify({
            activeTab: payload.activeTab,
            startDate: payload.startDate,
            endDate: payload.endDate,
            createdAt: Date.now(),
        }));
    }

    function getPendingAIAnalysisRequest() {
        try {
            const raw = localStorage.getItem(PENDING_AI_ANALYSIS_KEY);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                localStorage.removeItem(PENDING_AI_ANALYSIS_KEY);
                return null;
            }

            const createdAt = Number(parsed.createdAt || 0);
            if (!createdAt || Date.now() - createdAt > 15 * 60 * 1000) {
                localStorage.removeItem(PENDING_AI_ANALYSIS_KEY);
                return null;
            }

            if (!parsed.startDate || !parsed.endDate) {
                localStorage.removeItem(PENDING_AI_ANALYSIS_KEY);
                return null;
            }

            const activeTab = parsed.activeTab === 'crowd' || parsed.activeTab === 'single'
                ? parsed.activeTab
                : 'ads';

            return {
                activeTab,
                startDate: parsed.startDate,
                endDate: parsed.endDate,
            };
        } catch {
            localStorage.removeItem(PENDING_AI_ANALYSIS_KEY);
            return null;
        }
    }

    function clearPendingAIAnalysisRequest() {
        localStorage.removeItem(PENDING_AI_ANALYSIS_KEY);
    }

    function readDashboardViewState() {
        try {
            const raw = localStorage.getItem(DASHBOARD_VIEW_STATE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                localStorage.removeItem(DASHBOARD_VIEW_STATE_KEY);
                return null;
            }

            const activeTab = parsed.activeTab === 'crowd' || parsed.activeTab === 'single'
                ? parsed.activeTab
                : 'ads';

            return {
                activeTab,
                ranges: {
                    ads: {
                        start: String(parsed.ranges?.ads?.start || ''),
                        end: String(parsed.ranges?.ads?.end || ''),
                    },
                    crowd: {
                        start: String(parsed.ranges?.crowd?.start || ''),
                        end: String(parsed.ranges?.crowd?.end || ''),
                    },
                    single: {
                        start: String(parsed.ranges?.single?.start || ''),
                        end: String(parsed.ranges?.single?.end || ''),
                    },
                },
            };
        } catch {
            localStorage.removeItem(DASHBOARD_VIEW_STATE_KEY);
            return null;
        }
    }

    function collectDashboardViewState() {
        return {
            activeTab: document.querySelector('.tab.active')?.dataset.tab || dashboardRuntimeState.activeTab || 'ads',
            ranges: {
                ads: {
                    start: document.getElementById('ads-start')?.value || '',
                    end: document.getElementById('ads-end')?.value || '',
                },
                crowd: {
                    start: document.getElementById('crowd-start')?.value || '',
                    end: document.getElementById('crowd-end')?.value || '',
                },
                single: {
                    start: document.getElementById('single-start')?.value || '',
                    end: document.getElementById('single-end')?.value || '',
                },
            },
        };
    }

    function persistDashboardViewState() {
        try {
            localStorage.setItem(DASHBOARD_VIEW_STATE_KEY, JSON.stringify(collectDashboardViewState()));
        } catch (error) {
            console.warn('Failed to persist dashboard view state', error);
        }
    }

    function applyDashboardViewState(viewState) {
        if (!viewState || !viewState.ranges) {
            return;
        }

        [
            ['ads-start', viewState.ranges.ads?.start],
            ['ads-end', viewState.ranges.ads?.end],
            ['crowd-start', viewState.ranges.crowd?.start],
            ['crowd-end', viewState.ranges.crowd?.end],
            ['single-start', viewState.ranges.single?.start],
            ['single-end', viewState.ranges.single?.end],
        ].forEach(([id, value]) => {
            const input = document.getElementById(id);
            if (input && value) {
                input.value = value;
            }
        });
        setActiveTabState(viewState.activeTab || 'ads');
    }

    function getDashboardCacheKey(startDate, endDate, sections = 'all') {
        return `${sections}:${startDate}:${endDate}`;
    }

    function getDashboardStorageKey(startDate, endDate, sections = 'all') {
        return `${DASHBOARD_CACHE_PREFIX}:${getDashboardCacheKey(startDate, endDate, sections)}`;
    }

    function getTodayInputValue() {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function isHistoricalDashboardRange(endDate) {
        return Boolean(endDate && endDate < getTodayInputValue());
    }

    function getDashboardCacheTtlMs(endDate) {
        return isHistoricalDashboardRange(endDate)
            ? DASHBOARD_HISTORICAL_CACHE_TTL_MS
            : DASHBOARD_CACHE_TTL_MS;
    }

    function getDashboardBackgroundRefreshAfterMs(endDate) {
        return isHistoricalDashboardRange(endDate)
            ? DASHBOARD_HISTORICAL_BACKGROUND_REFRESH_AFTER_MS
            : DASHBOARD_BACKGROUND_REFRESH_AFTER_MS;
    }

    function shouldRefreshDashboardCacheEntry(cacheEntry, endDate) {
        if (!cacheEntry || !cacheEntry.cachedAt) {
            return true;
        }
        return Date.now() - Number(cacheEntry.cachedAt) > getDashboardBackgroundRefreshAfterMs(endDate);
    }

    function removeDashboardStorageKey(storageKey) {
        CACHE_BACKENDS.forEach(({ storage }) => {
            try {
                storage.removeItem(storageKey);
            } catch {
                // noop
            }
        });
    }

    function readDashboardCacheEntryFromStorage(startDate, endDate, sections = 'all') {
        const storageKey = getDashboardStorageKey(startDate, endDate, sections);
        for (const { storage, label } of CACHE_BACKENDS) {
            try {
                const raw = storage.getItem(storageKey);
                if (!raw) {
                    continue;
                }
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || !parsed.data || !parsed.cachedAt) {
                    storage.removeItem(storageKey);
                    continue;
                }
                if (Date.now() - Number(parsed.cachedAt) > getDashboardCacheTtlMs(endDate)) {
                    storage.removeItem(storageKey);
                    continue;
                }
                return {
                    data: parsed.data,
                    cachedAt: Number(parsed.cachedAt),
                    source: label,
                };
            } catch {
                try {
                    storage.removeItem(storageKey);
                } catch {
                    // noop
                }
            }
        }
        return null;
    }

    function readDashboardSummaryFromStorage(startDate, endDate, sections = 'all') {
        return readDashboardCacheEntryFromStorage(startDate, endDate, sections)?.data || null;
    }

    function getCachedDashboardSummaryEntry(startDate, endDate, sections = 'all') {
        const cacheKey = getDashboardCacheKey(startDate, endDate, sections);
        if (dashboardDataCache.has(cacheKey)) {
            return {
                data: dashboardDataCache.get(cacheKey),
                cachedAt: Date.now(),
                source: 'memory',
            };
        }
        const stored = readDashboardCacheEntryFromStorage(startDate, endDate, sections);
        if (stored) {
            dashboardDataCache.set(cacheKey, stored.data);
            return stored;
        }
        return null;
    }

    function getCachedDashboardSummary(startDate, endDate, sections = 'all') {
        return getCachedDashboardSummaryEntry(startDate, endDate, sections)?.data || null;
    }

    function writeDashboardSummaryToStorage(startDate, endDate, sections, data) {
        const payload = JSON.stringify({
            cachedAt: Date.now(),
            data,
        });
        CACHE_BACKENDS.forEach(({ storage }) => {
            try {
                storage.setItem(getDashboardStorageKey(startDate, endDate, sections), payload);
            } catch (error) {
                console.warn('Failed to cache dashboard summary', error);
            }
        });
    }

    function ensureSectionState(section) {
        if (!dashboardRuntimeState.sectionState[section]) {
            dashboardRuntimeState.sectionState[section] = {
                response: null,
                rangeKey: '',
                loading: false,
                backgroundRefreshing: false,
                lastCacheSource: '',
            };
        }
        return dashboardRuntimeState.sectionState[section];
    }

    function getSectionState(section) {
        return ensureSectionState(section);
    }

    function setSectionResponse(section, response, options = {}) {
        const target = ensureSectionState(section);
        target.response = response || null;
        target.rangeKey = options.rangeKey || (response?.range ? `${response.range.start}|${response.range.end}` : target.rangeKey);
        if (typeof options.lastCacheSource === 'string') {
            target.lastCacheSource = options.lastCacheSource;
        }
        return target;
    }

    function getSectionResponse(section) {
        return ensureSectionState(section).response;
    }

    function getSectionRangeKey(section) {
        return ensureSectionState(section).rangeKey || '';
    }

    function setSectionRangeKey(section, rangeKey) {
        ensureSectionState(section).rangeKey = rangeKey || '';
    }

    function setSectionLoading(section, loading) {
        ensureSectionState(section).loading = Boolean(loading);
    }

    function setSectionBackgroundRefreshing(section, refreshing) {
        ensureSectionState(section).backgroundRefreshing = Boolean(refreshing);
    }

    function setSectionCacheSource(section, source) {
        ensureSectionState(section).lastCacheSource = source || '';
    }

    function getSectionCacheSource(section) {
        return ensureSectionState(section).lastCacheSource || '';
    }

    function setActiveTabState(tab) {
        dashboardRuntimeState.activeTab = tab === 'crowd' || tab === 'single' ? tab : 'ads';
    }

    function setRequestMode(mode) {
        dashboardRuntimeState.requestMode = mode || 'idle';
    }

    function getDashboardRuntimeState() {
        return dashboardRuntimeState;
    }

    function clearDashboardCaches() {
        dashboardDataCache.clear();
        try {
            Object.keys(localStorage).filter((key) => key.startsWith(DASHBOARD_CACHE_PREFIX)).forEach((key) => localStorage.removeItem(key));
            Object.keys(sessionStorage).filter((key) => key.startsWith(DASHBOARD_CACHE_PREFIX)).forEach((key) => sessionStorage.removeItem(key));
        } catch {
            // noop
        }
    }

    window.DashboardState = {
        setButtonBusy,
        resetButtonState,
        getButtonDefaultLabel,
        getCurrentDateRangeValue,
        savePendingAIAnalysisRequest,
        getPendingAIAnalysisRequest,
        clearPendingAIAnalysisRequest,
        readDashboardViewState,
        collectDashboardViewState,
        persistDashboardViewState,
        applyDashboardViewState,
        getDashboardCacheKey,
        getDashboardStorageKey,
        shouldRefreshDashboardCacheEntry,
        getCachedDashboardSummary,
        getCachedDashboardSummaryEntry,
        writeDashboardSummaryToStorage,
        readDashboardSummaryFromStorage,
        readDashboardCacheEntryFromStorage,
        removeDashboardStorageKey,
        dashboardRequestsInFlight,
        dashboardDataCache,
        getDashboardRuntimeState,
        getSectionState,
        setSectionResponse,
        getSectionResponse,
        getSectionRangeKey,
        setSectionRangeKey,
        setSectionLoading,
        setSectionBackgroundRefreshing,
        setSectionCacheSource,
        getSectionCacheSource,
        setActiveTabState,
        setRequestMode,
        clearDashboardCaches,
    };
})(window);
