(function attachDashboardEvents(window) {
    function bindDashboardInteractions() {
        document.querySelectorAll('[data-action="logout"]').forEach((link) => {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                window.DashboardApp?.logout();
            });
        });

        const bindings = [
            ['ai-analysis-btn', () => window.DashboardApp?.openAIAnalysis()],
            ['download-full-report-btn', () => window.DashboardApp?.downloadFullReportCSV()],
            ['load-ads-btn', () => window.DashboardApp?.loadAds({ forceRefresh: true })],
            ['download-ads-csv-btn', () => window.DashboardApp?.downloadAdsCSV()],
            ['load-single-btn', () => window.DashboardApp?.loadSingle({ forceRefresh: true })],
            ['download-single-csv-btn', () => window.DashboardApp?.downloadSingleCSV()],
            ['load-crowd-btn', () => window.DashboardApp?.loadCrowd({ forceRefresh: true })],
            ['close-ai-analysis-btn', () => window.DashboardApp?.closeAIAnalysis()],
            ['ai-report-link-btn', () => window.DashboardApp?.openReportCenter()],
            ['refresh-ai-analysis-btn', () => window.DashboardApp?.refreshAIAnalysis()],
            ['close-ai-analysis-footer-btn', () => window.DashboardApp?.closeAIAnalysis()],
        ];

        bindings.forEach(([id, handler]) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('click', handler);
            }
        });

        document.querySelectorAll('.date-preset-btn[data-range-target][data-range-preset]').forEach((button) => {
            button.addEventListener('click', () => {
                window.DashboardApp?.applyPresetDateRange(button.dataset.rangeTarget, button.dataset.rangePreset);
            });
        });

        const crowdTableBody = document.querySelector('#crowd-summary-table tbody');
        if (crowdTableBody) {
            crowdTableBody.addEventListener('click', (event) => {
                const row = event.target.closest('[data-crowd-row="toggle"]');
                if (!row) return;
                window.DashboardApp?.toggleCrowdRow(row);
            });
            crowdTableBody.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const row = event.target.closest('[data-crowd-row="toggle"]');
                if (!row) return;
                event.preventDefault();
                window.DashboardApp?.toggleCrowdRow(row);
            });
        }

        const singleProductSearch = document.getElementById('single-product-search');
        if (singleProductSearch) {
            singleProductSearch.addEventListener('input', () => {
                window.DashboardApp?.renderCurrentSingleTable();
            });
        }

        document.querySelectorAll('.crowd-plan-filter-btn[data-crowd-plan-type]').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.crowd-plan-filter-btn[data-crowd-plan-type]').forEach((item) => {
                    item.classList.toggle('active', item === button);
                });
                window.DashboardApp?.renderCurrentCrowdTable();
            });
        });

        const crowdPlanSelect = document.getElementById('crowd-plan-select');
        if (crowdPlanSelect) {
            crowdPlanSelect.addEventListener('change', () => {
                window.DashboardApp?.renderCurrentCrowdTable();
            });
        }

        ['ads-start', 'ads-end', 'crowd-start', 'crowd-end', 'single-start', 'single-end'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('change', () => {
                    window.DashboardApp?.persistDashboardViewState();
                    window.DashboardApp?.syncRangeActionButtons();
                });
            }
        });

        window.DashboardApp?.syncRangeActionButtons();
    }

    window.DashboardEvents = {
        bindDashboardInteractions,
    };
})(window);
