(function attachDashboardLoader(window) {
    const SECTION_CONFIG = {
        ads: {
            prefix: 'ads',
            loadMethod: 'loadAds',
            getResponse: (app) => app.getCurrentAdsResponse(),
            setResponse: (app, value, options = {}) => app.setCurrentAdsResponse(value, options),
            renderCached: (app, cached) => app.renderAdsFromResponse(cached),
            renderEmptyState: (app, message) => app.renderAdsState(message),
            renderSkeleton: (app) => app.renderAdsLoadingSkeleton(),
            loadingText: '正在加载投放聚合结果...',
            loadingDetail: '首次进入会稍慢，后续会优先显示缓存',
            cacheReadyText: (sourceLabel) => `已先显示${sourceLabel}结果，正在后台刷新最新数据...`,
            refreshedText: '投放分析已刷新到最新结果。',
            refreshFailedText: '已显示缓存结果，投放分析后台刷新失败，请稍后重试。',
        },
        crowd: {
            prefix: 'crowd',
            loadMethod: 'loadCrowd',
            getResponse: (app) => app.getCurrentCrowdResponse(),
            setResponse: (app, value, options = {}) => app.setCurrentCrowdResponse(value, options),
            renderCached: (app, cached) => app.renderCrowdFromResponse(cached),
            renderEmptyState: (app, message) => app.renderTableBodyState('#crowd-summary-table', message),
            renderSkeleton: (app) => app.renderCrowdLoadingSkeleton(),
            loadingText: '正在加载人群聚合结果...',
            loadingDetail: '首次进入会稍慢，后续会优先显示缓存',
            cacheReadyText: (sourceLabel) => `已先显示${sourceLabel}结果，正在后台刷新最新数据...`,
            refreshedText: '人群分层已刷新到最新结果。',
            refreshFailedText: '已显示缓存结果，人群分层后台刷新失败，请稍后重试。',
        },
        single: {
            prefix: 'single',
            loadMethod: 'loadSingle',
            getResponse: (app) => app.getCurrentSingleResponse(),
            setResponse: (app, value, options = {}) => app.setCurrentSingleResponse(value, options),
            renderCached: (app, cached) => {
                const products = Array.isArray(cached?.single?.items) ? cached.single.items : [];
                const rowCount = Number(cached?.single?.kpi?.sourceRowCount || cached?.single?.exportRows?.length || 0);
                app.renderSingleKpi(products, rowCount);
                app.renderSingleTable(products);
            },
            renderEmptyState: (app, message) => app.renderSingleState(message),
            renderSkeleton: (app) => app.renderSingleLoadingState(),
            loadingText: '正在加载单品广告结果...',
            loadingDetail: '首次进入会稍慢，后续会优先显示缓存',
            cacheReadyText: (sourceLabel) => `已先显示${sourceLabel}结果，正在后台刷新最新数据...`,
            refreshedText: '单品广告已刷新到最新结果。',
            refreshFailedText: '已显示缓存结果，单品广告后台刷新失败，请稍后重试。',
        },
    };

    function getSectionConfig(section) {
        return SECTION_CONFIG[section] || SECTION_CONFIG.ads;
    }

    function getSectionRange(section) {
        const prefix = getSectionConfig(section).prefix;
        return {
            start: document.getElementById(`${prefix}-start`)?.value || '',
            end: document.getElementById(`${prefix}-end`)?.value || '',
        };
    }

    function getSectionRangeKey(section) {
        const { start, end } = getSectionRange(section);
        return `${start}|${end}`;
    }

    function getCacheSourceLabel(source) {
        if (source === 'memory') return '内存缓存';
        if (source === 'localStorage') return '本地缓存';
        if (source === 'sessionStorage') return '会话缓存';
        return '最近一次';
    }

    async function runBackgroundRefresh(section) {
        const app = window.DashboardApp;
        const config = getSectionConfig(section);
        app.setSectionBackgroundRefreshing(section, true);
        try {
            await app[config.loadMethod]({ mode: 'background_refresh', forceRefresh: true, preserveExistingView: true, silent: true });
            app.setDashboardStatus('success', config.refreshedText, 2600);
        } catch (error) {
            console.warn(error);
            app.setDashboardStatus('warn', config.refreshFailedText, 4200);
        } finally {
            app.setSectionBackgroundRefreshing(section, false);
        }
    }

    async function renderSectionFromCacheThenRefresh(section, cacheEntry) {
        const app = window.DashboardApp;
        const config = getSectionConfig(section);
        const { end } = getSectionRange(section);
        const rangeKey = getSectionRangeKey(section);
        config.setResponse(app, cacheEntry.data, { rangeKey, lastCacheSource: cacheEntry.source });
        app.setSectionCacheSource(section, cacheEntry.source);
        config.renderCached(app, cacheEntry.data);
        app.hideLoading();
        if (app.shouldRefreshDashboardCacheEntry(cacheEntry, end)) {
            app.setDashboardStatus('info', config.cacheReadyText(getCacheSourceLabel(cacheEntry.source)), 0);
            void runBackgroundRefresh(section);
            return;
        }
        app.setDashboardStatus('success', `已显示${getCacheSourceLabel(cacheEntry.source)}结果，可点击查询刷新最新数据。`, 2600);
    }

    async function loadInitialSection(section) {
        const app = window.DashboardApp;
        const config = getSectionConfig(section);
        const { start, end } = getSectionRange(section);
        const cacheEntry = app.readDashboardCacheEntryFromStorage(start, end, section);
        if (cacheEntry) {
            return renderSectionFromCacheThenRefresh(section, cacheEntry);
        }

        app.showLoading();
        app.updateLoading(18, config.loadingText, config.loadingDetail);
        await app[config.loadMethod]({ mode: 'initial', forceRefresh: true, silent: true });
        app.hideLoading();
        app.setDashboardStatus('success', '已获取最新数据。', 2200);
    }

    async function loadAds(options = {}) {
        const app = window.DashboardApp;
        const start = document.getElementById('ads-start')?.value;
        const end = document.getElementById('ads-end')?.value;
        const button = document.getElementById('load-ads-btn');
        const requestMode = options.mode || (options.silent ? 'background_refresh' : 'user_query');
        app.setRequestMode(requestMode);
        app.setSectionLoading('ads', true);
        if (!app.hasValidDateRange(start, end)) {
            app.renderAdsState('请选择有效的开始和结束日期');
            app.setSectionLoading('ads', false);
            return;
        }
        if (!options.silent) {
            app.hideGlobalDashboardError();
        }

        if (!options.silent && button && !button.dataset.busy && button.dataset.lastRange === `${start}|${end}` && app.isResponseForRange(app.getCurrentAdsResponse(), start, end)) {
            app.setDashboardStatus('info', '投放分析日期范围未变化，无需重复查询。', 2200);
            app.setSectionLoading('ads', false);
            return;
        }

        if (!options.preserveExistingView && !app.getCurrentAdsResponse()) {
            app.renderAdsLoadingSkeleton();
        }

        if (!options.silent) {
            app.setButtonBusy(button, '查询中...');
            app.showLoading();
            app.updateLoading(24, '正在查询投放聚合结果...', `${start} 至 ${end}`);
        }

        try {
            const result = await app.fetchDashboardSummary(start, end, 'ads', { forceRefresh: options.forceRefresh });
            app.setCurrentAdsResponse(result, { rangeKey: `${start}|${end}`, lastCacheSource: options.forceRefresh ? '' : 'network' });
            app.renderAdsFromResponse(result);
            if (!options.silent) {
                if (button) {
                    button.dataset.lastRange = `${start}|${end}`;
                }
                app.persistDashboardViewState();
                app.setDashboardStatus('success', `投放分析已更新至 ${start} 至 ${end}。`, 2200);
            }
        } catch (error) {
            const stateMessage = app.buildStateMessage(error, '投放聚合结果加载失败，请稍后重试。');
            if (!options.preserveExistingView) {
                app.renderAdsState(stateMessage);
            }
            if (!options.silent) {
                const classified = app.classifyDashboardError(error);
                app.setDashboardStatus(classified.type, stateMessage, 4200);
                app.showGlobalDashboardError(error, '投放分析查询失败，请稍后重试。');
            }
            throw error;
        } finally {
            app.setSectionLoading('ads', false);
            app.setRequestMode('idle');
            if (!options.silent) {
                app.hideLoading();
                app.resetButtonState(button);
                app.syncRangeActionButtons();
            }
        }
    }


    async function loadSingle(options = {}) {
        const app = window.DashboardApp;
        const start = document.getElementById('single-start')?.value || '';
        const end = document.getElementById('single-end')?.value || '';
        const tbody = document.querySelector('#single-table tbody');
        const button = document.getElementById('load-single-btn');
        const rangeKey = `${start}|${end}`;
        const requestMode = options.mode || (options.silent ? 'background_refresh' : 'user_query');
        if (!tbody) return;
        app.setRequestMode(requestMode);
        app.setSectionLoading('single', true);
        if (!options.silent) {
            app.hideGlobalDashboardError();
        }

        if (!app.hasValidDateRange(start, end)) {
            app.renderSingleState('请选择有效的开始和结束日期');
            app.setSectionLoading('single', false);
            return;
        }

        if (!options.forceRefresh && button && !button.dataset.busy && button.dataset.lastRange === rangeKey && app.getSectionRangeKey('single') === rangeKey && app.getCurrentSingleResponse()) {
            app.setDashboardStatus('info', '单品广告日期范围未变化，无需重复查询。', 2200);
            app.setSectionLoading('single', false);
            return;
        }

        if (!options.preserveExistingView && !app.getCurrentSingleResponse()) {
            app.renderSingleLoadingState();
        }
        if (!options.silent) {
            app.setButtonBusy(button, '查询中...');
            app.showLoading();
            app.updateLoading(24, '正在查询单品广告结果...', `${start} 至 ${end}`);
        }

        try {
            const result = await app.fetchDashboardSummary(start, end, 'single', {
                forceRefresh: Boolean(options.forceRefresh),
            });
            const products = Array.isArray(result?.single?.items) ? result.single.items : [];
            const rowCount = Number(result?.single?.kpi?.sourceRowCount || result?.single?.exportRows?.length || 0);
            app.setCurrentSingleResponse(result, { rangeKey, lastCacheSource: options.forceRefresh ? '' : 'network' });
            app.renderSingleKpi(products, rowCount);
            app.renderSingleTable(products);
            if (button) {
                button.dataset.lastRange = rangeKey;
            }
            if (!options.silent) {
                app.persistDashboardViewState();
                app.setDashboardStatus('success', `单品广告已更新至 ${start} 至 ${end}。`, 2200);
            }
        } catch (error) {
            const stateMessage = app.buildStateMessage(error, '单品广告查询失败，请稍后重试。');
            const classified = app.classifyDashboardError(error);
            if (!options.preserveExistingView) {
                app.renderSingleState(stateMessage);
            }
            if (!options.silent) {
                app.setDashboardStatus(classified.type, stateMessage, 4200);
                app.showGlobalDashboardError(error, '单品广告查询失败，请稍后重试。');
            }
            console.warn('loadSingle error', error);
            throw error;
        } finally {
            app.setSectionLoading('single', false);
            app.setRequestMode('idle');
            if (!options.silent) {
                app.resetButtonState(button);
                app.hideLoading();
                app.syncRangeActionButtons();
            }
        }
    }

    async function loadCrowd(options = {}) {
        const app = window.DashboardApp;
        const start = document.getElementById('crowd-start')?.value;
        const end = document.getElementById('crowd-end')?.value;
        const button = document.getElementById('load-crowd-btn');
        const requestMode = options.mode || (options.silent ? 'background_refresh' : 'user_query');
        app.setRequestMode(requestMode);
        app.setSectionLoading('crowd', true);
        if (!app.hasValidDateRange(start, end)) {
            app.renderTableBodyState('#crowd-summary-table', '请选择有效的开始和结束日期');
            app.setSectionLoading('crowd', false);
            return;
        }
        if (!options.silent) {
            app.hideGlobalDashboardError();
        }

        if (!options.silent
            && button
            && !button.dataset.busy
            && button.dataset.lastRange === `${start}|${end}`
            && app.isResponseForRange(app.getCurrentCrowdResponse(), start, end)) {
            app.setDashboardStatus('info', '人群分层日期范围未变化，无需重复查询。', 2200);
            app.setSectionLoading('crowd', false);
            return;
        }

        if (!options.preserveExistingView && !app.getCurrentCrowdResponse()) {
            app.renderCrowdLoadingSkeleton();
        }

        if (!options.silent) {
            app.setButtonBusy(button, '查询中...');
            app.showLoading();
            app.updateLoading(24, '正在查询人群聚合结果...', `${start} 至 ${end}`);
        }

        try {
            const result = await app.fetchDashboardSummary(start, end, 'crowd', { forceRefresh: options.forceRefresh });
            app.setCurrentCrowdResponse(result, { rangeKey: `${start}|${end}`, lastCacheSource: options.forceRefresh ? '' : 'network' });
            app.renderCrowdFromResponse(result);
            if (!options.silent) {
                if (button) {
                    button.dataset.lastRange = `${start}|${end}`;
                }
                app.persistDashboardViewState();
                app.setDashboardStatus('success', `人群分层已更新至 ${start} 至 ${end}。`, 2200);
            }
        } catch (error) {
            const stateMessage = app.buildStateMessage(error, '人群聚合结果加载失败，请稍后重试。');
            if (!options.preserveExistingView) {
                app.renderTableBodyState('#crowd-summary-table', stateMessage);
            }
            if (!options.silent) {
                const classified = app.classifyDashboardError(error);
                app.setDashboardStatus(classified.type, stateMessage, 4200);
                app.showGlobalDashboardError(error, '人群分层查询失败，请稍后重试。');
            }
            throw error;
        } finally {
            app.setSectionLoading('crowd', false);
            app.setRequestMode('idle');
            if (!options.silent) {
                app.hideLoading();
                app.resetButtonState(button);
                app.syncRangeActionButtons();
            }
        }
    }

    async function loadAll() {
        const app = window.DashboardApp;
        const pendingAIAnalysis = app.getPendingAIAnalysisRequest();
        const savedViewState = app.readDashboardViewState();
        app.hydrateDashboardSpec();
        try {
            app.hideGlobalDashboardError();
            app.initDateRanges();
            app.applyDashboardViewState(savedViewState);
            if (pendingAIAnalysis) {
                app.applyDashboardDateRange(pendingAIAnalysis.startDate, pendingAIAnalysis.endDate);
            }
            const initialTab = pendingAIAnalysis?.activeTab === 'crowd' || pendingAIAnalysis?.activeTab === 'single'
                ? pendingAIAnalysis.activeTab
                : (savedViewState?.activeTab === 'crowd' || savedViewState?.activeTab === 'single' ? savedViewState.activeTab : 'ads');

            document.getElementById('load-ads-btn')?.setAttribute('data-last-range', `${document.getElementById('ads-start')?.value}|${document.getElementById('ads-end')?.value}`);
            document.getElementById('load-crowd-btn')?.setAttribute('data-last-range', `${document.getElementById('crowd-start')?.value}|${document.getElementById('crowd-end')?.value}`);
            document.getElementById('load-single-btn')?.setAttribute('data-last-range', `${document.getElementById('single-start')?.value || ''}|${document.getElementById('single-end')?.value || ''}`);
            app.syncRangeActionButtons();

            if (initialTab !== 'ads') {
                app.setActiveTab(initialTab, { skipAutoLoad: true });
            }

            getSectionConfig(initialTab).renderSkeleton(app);
            await loadInitialSection(initialTab);
            app.persistDashboardViewState();
            app.maybeResumePendingAIAnalysis(pendingAIAnalysis);
        } catch (error) {
            app.updateLoading(0, '加载失败', error.message);
            const stateMessage = app.buildStateMessage(error, '当前数据加载失败，请稍后重试。');
            const classified = app.classifyDashboardError(error);
            app.showGlobalDashboardError(error, '当前数据加载失败，请稍后重试。');
            app.setDashboardStatus(classified.type, stateMessage, 4000);
            setTimeout(app.hideLoading, 1000);
        }
    }

    window.DashboardLoader = {
        loadAds,
        loadCrowd,
        loadSingle,
        loadAll,
    };
})(window);
