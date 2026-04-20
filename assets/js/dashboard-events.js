(function attachDashboardEvents(window) {
    function bindDashboardInteractions() {
        const app = window.DashboardApp;
        document.querySelectorAll('[data-action="logout"]').forEach((link) => {
            link.addEventListener('click', (event) => {
                event.preventDefault();
                app.logout();
            });
        });

        const bindings = [
            ['ai-analysis-btn', app.openAIAnalysis],
            ['download-full-report-btn', app.downloadFullReportCSV],
            ['load-ads-btn', () => app.loadAds({ forceRefresh: true })],
            ['download-ads-csv-btn', app.downloadAdsCSV],
            ['load-single-btn', () => app.loadSingle({ forceRefresh: true })],
            ['download-single-csv-btn', app.downloadSingleCSV],
            ['load-crowd-btn', () => app.loadCrowd({ forceRefresh: true })],
            ['close-ai-analysis-btn', app.closeAIAnalysis],
            ['ai-report-link-btn', app.openReportCenter],
            ['refresh-ai-analysis-btn', app.refreshAIAnalysis],
            ['close-ai-analysis-footer-btn', app.closeAIAnalysis],
        ];

        bindings.forEach(([id, handler]) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('click', handler);
            }
        });

        const crowdTableBody = document.querySelector('#crowd-summary-table tbody');
        if (crowdTableBody) {
            crowdTableBody.addEventListener('click', (event) => {
                const row = event.target.closest('[data-crowd-row="toggle"]');
                if (!row) return;
                app.toggleCrowdRow(row);
            });
            crowdTableBody.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const row = event.target.closest('[data-crowd-row="toggle"]');
                if (!row) return;
                event.preventDefault();
                app.toggleCrowdRow(row);
            });
        }

        ['ads-start', 'ads-end', 'crowd-start', 'crowd-end', 'single-start', 'single-end'].forEach((id) => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('change', () => {
                    app.persistDashboardViewState();
                    app.syncRangeActionButtons();
                });
            }
        });

        app.syncRangeActionButtons();
    }

    window.DashboardEvents = {
        bindDashboardInteractions,
    };
})(window);
