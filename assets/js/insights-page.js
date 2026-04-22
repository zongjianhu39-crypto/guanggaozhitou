        const authHelpers = window.authHelpers || {};
        const SB_URL = authHelpers.getSupabaseUrl
            ? authHelpers.getSupabaseUrl()
            : ((typeof CONFIG !== 'undefined' && CONFIG && CONFIG.SB_URL) ? CONFIG.SB_URL : 'https://qjscsikithbxuxmjyjsp.supabase.co');
        let currentDetailItem = null;
        let authRedirectScheduled = false;
        let reportListCache = {
            key: '',
            result: null,
        };

        const metricLabels = {
            totalCost: '总花费',
            totalAmount: '总成交',
            totalOrders: '总订单',
            roi: 'ROI',
            returnRoi: '去退 ROI',
            finMargin: '毛利率',
            returnRate: '退货率',
            yoyRoi: 'ROI 同比'
        };

        function getDetailSubtitle(item) {
            if (item.report_type === 'genbi' || item.source_channel === 'genbi' || item.raw_payload?.source?.channel === 'genbi') {
                return `GenBI 洞察 · ${item.report_date || '--'}`;
            }
            return `${item.report_type === 'daily' ? '日报洞察' : '经营洞察'} · ${item.report_date || '--'}`;
        }

        function rememberInsightRedirect() {
            const currentUrl = window.location.origin + window.location.pathname + window.location.search + window.location.hash;
            if (authHelpers.rememberRedirect) {
                authHelpers.rememberRedirect(currentUrl);
            } else {
                localStorage.setItem('feishu_redirect', currentUrl);
            }
        }

        function redirectToInsightLogin(message) {
            if (authRedirectScheduled) return;
            authRedirectScheduled = true;

            if (authHelpers.redirectToLogin) {
                authHelpers.redirectToLogin({
                    targetUrl: window.location.href,
                    force: true,
                    reason: 'prompt_admin_reauth_required',
                    delayMs: 1200,
                });
                return;
            }

            rememberInsightRedirect();
            localStorage.removeItem('prompt_admin_token');
            localStorage.removeItem('prompt_admin_expires_at');
            setTimeout(() => {
                window.location.replace('auth/index.html?force=1');
            }, 1200);
        }


        function riskWeight(level) {
            const map = {
                low: 1,
                medium: 2,
                high: 3,
                critical: 4,
            };
            return map[level] || 0;
        }

        function decisionLabel(decision) {
            if (decision === 'reduce') return '收缩';
            if (decision === 'increase') return '放量';
            return '观察';
        }

        function normalizeExperienceKey(value) {
            return String(value || '')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, ' ');
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function riskLabel(level) {
            const map = {
                low: '低风险',
                medium: '中风险',
                high: '高风险',
                critical: '严重风险'
            };
            return map[level] || '未评级';
        }

        function buildListRequestParams() {
            return { limit: 24 };
        }

        async function fetchFunction(path, params = {}) {
            const { data } = await authHelpers.fetchFunctionJson(path, {
                query: params,
                parseErrorMessage: '洞察服务返回了无法解析的响应，请稍后重试',
                onUnauthorized: () => {
                    redirectToInsightLogin('洞察中心登录状态已失效，正在跳转重新登录…');
                },
            });
            return data;
        }

        async function loadReportCollection(force = false) {
            const params = buildListRequestParams();
            const key = JSON.stringify(params);
            if (!force && reportListCache.key === key && reportListCache.result) {
                return reportListCache.result;
            }

            const result = await fetchFunction('ai-reports', params);
            reportListCache = { key, result };
            updateStats(result.items || [], result.pagination?.total ?? null);
            return result;
        }

async function loadList(force = false) {
            setViewMode('reports');
            renderLoading('正在读取洞察报告...');

            const result = await loadReportCollection(force);

            renderList(result.items || []);
        }


        function renderMissingDetail(message) {
            currentDetailItem = null;
            document.getElementById('detail-subtitle').textContent = '报告详情';
            document.getElementById('detail-title').textContent = message || '报告不存在';
            document.getElementById('detail-summary').textContent = '当前链接对应的报告不存在，可能已被删除或尚未生成。';
            document.getElementById('detail-tags').innerHTML = '';
            document.getElementById('detail-focus-points').innerHTML = '';
            document.getElementById('detail-primary-metrics').innerHTML = '';
            document.getElementById('detail-story').innerHTML = '<div class="list-empty">请返回报告列表重新选择。</div>';
            document.getElementById('detail-structured-appendix').innerHTML = '<p class="appendix-empty">暂无结构化参考数据。</p>';
            document.getElementById('detail-markdown').textContent = '暂无原始文本';
        }

        async function loadDetail(slug) {
            setViewMode('detail');
            const result = await fetchFunction('ai-reports', { slug });
            const item = result?.item;
            if (!item) {
                renderMissingDetail('报告不存在');
                return;
            }
            const payload = item.raw_payload || {};
            const readableSummary = getReadableSummary(item, payload);
            const cleanedMarkdown = sanitizeReportText(item.raw_markdown || payload.markdown || '');
            currentDetailItem = item;

            document.getElementById('detail-subtitle').textContent = getDetailSubtitle(item);
            document.getElementById('detail-title').textContent = item.title || '未命名报告';
            document.getElementById('detail-summary').textContent = readableSummary;
            const tags = Array.isArray(item.tags) ? item.tags : [];
            document.getElementById('detail-tags').innerHTML = tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('');
            document.getElementById('detail-focus-points').innerHTML = buildDetailFocusCards(item, payload);

            renderMetricCards(item.overview_metrics || payload.overviewMetrics || {});
            document.getElementById('detail-story').innerHTML = renderReportArticleBody(item, payload);
            document.getElementById('detail-structured-appendix').innerHTML = buildStructuredAppendix(item, payload);
            document.getElementById('detail-markdown').textContent = cleanedMarkdown || '暂无原始文本';
        }
        async function loadCurrentView(force = false) {
            const params = new URLSearchParams(window.location.search);
            const slug = params.get('slug');
            currentDetailItem = null;

            try {
                if (slug) {
                    await loadDetail(slug);
                } else {
                    await loadList(force);
                }
            } catch (error) {
                const errorState = authHelpers.describeFetchError
                    ? authHelpers.describeFetchError(error, '洞察内容加载失败，请稍后重试。')
                    : { message: error.message || '加载失败，请稍后重试' };
                setViewMode('reports');
                renderError(errorState.message);
            }
        }

        function openReport(slug) {
            if (!slug) return;
            const url = new URL(window.location.href);
            url.searchParams.set('slug', slug);
            history.pushState({}, '', url);
            loadCurrentView();
        }

        function bindReportCardInteractions() {
            const activate = (event) => {
                const card = event.target.closest('[data-report-slug]');
                if (!card) return;
                const slug = card.dataset.reportSlug || '';
                if (!slug) return;
                openReport(slug);
            };

            const handleKeydown = (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const card = event.target.closest('[data-report-slug]');
                if (!card) return;
                event.preventDefault();
                const slug = card.dataset.reportSlug || '';
                if (!slug) return;
                openReport(slug);
            };

            document.getElementById('report-list').addEventListener('click', activate);
            document.getElementById('report-list').addEventListener('keydown', handleKeydown);
        }

        function openReportList() {
            const url = new URL(window.location.href);
            url.searchParams.delete('slug');
            history.pushState({}, '', url);
            loadCurrentView();
        }

        function reloadReports() {
            reportListCache = { key: '', result: null };
            loadCurrentView(true);
        }

        function bindPageActions() {
            document.querySelectorAll('[data-action="logout"]').forEach((link) => {
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    if (authHelpers.logout) {
                        authHelpers.logout();
                    } else {
                        window.location.replace('auth/index.html');
                    }
                });
            });

            document.getElementById('reload-reports-btn').addEventListener('click', reloadReports);
            document.getElementById('detail-back-btn').addEventListener('click', openReportList);
        }

        window.addEventListener('popstate', () => loadCurrentView(false));

        bindPageActions();
        bindReportCardInteractions();
        loadCurrentView();
