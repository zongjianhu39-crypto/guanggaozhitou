(function attachDashboardAi(window) {
    let currentReportSlug = '';
    let currentAbortController = null;

    function renderAiAnalysisHtml(raw) {
        const fn = window.AiArticleMarkdown?.renderArticleMarkdown;
        if (fn) return fn(raw);
        const esc = String(raw ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return `<p>${esc || '暂无内容'}</p>`;
    }

    function setAnalysisContent(textEl, content, { asPlainText = false } = {}) {
        if (!textEl) return;
        if (asPlainText) {
            textEl.innerHTML = '';
            textEl.textContent = content ?? '';
            return;
        }
        textEl.innerHTML = renderAiAnalysisHtml(content);
    }

    function updateAIReportLink(result) {
        const button = document.getElementById('ai-report-link-btn');
        currentReportSlug = result?.report_slug || '';
        if (button) {
            button.style.display = currentReportSlug ? 'inline-flex' : 'none';
        }
    }

    function openReportCenter() {
        const target = currentReportSlug ? `insights.html?slug=${encodeURIComponent(currentReportSlug)}` : 'insights.html';
        window.location.href = target;
    }

    async function openAIAnalysis() {
        const app = window.DashboardApp;
        const authHelpers = window.authHelpers || {};
        const button = document.getElementById('ai-analysis-btn');
        if (!button || button.disabled) return;
        const { activeTab, startDate, endDate, analysisType } = app.getAIAnalysisContext();
        const pendingRequest = { activeTab, startDate, endDate };
        if (!app.hasValidDateRange(startDate, endDate)) {
            alert('请先选择有效的日期范围');
            return;
        }

        // v3：旧缓存可能没有 report_slug，会导致用户以为已发布但洞察列表无条目；仅在有 slug 时写入缓存
        const cacheKey = `ai_analysis_v3_${activeTab}_${startDate}_${endDate}_${analysisType}`;
        const cached = sessionStorage.getItem(cacheKey);
        const modal = document.getElementById('ai-analysis-modal');
        const loading = document.getElementById('ai-analysis-loading');
        const body = document.getElementById('ai-analysis-body');
        const text = document.getElementById('ai-analysis-text');
        const range = document.getElementById('ai-analysis-range');
        if (!modal || !loading || !body || !text) return;

        modal.classList.add('show');
        loading.style.display = 'flex';
        body.style.display = 'none';
        setAnalysisContent(text, '', { asPlainText: true });
        if (range) range.textContent = `分析范围：${startDate} 至 ${endDate}`;
        updateAIReportLink(null);
        showPersistWarning(text, '');
        app.setButtonBusy(button, '分析中...');

        if (cached) {
            let parsed;
            try { parsed = JSON.parse(cached); } catch { sessionStorage.removeItem(cacheKey); parsed = null; }
            if (parsed && parsed.report_slug) {
                loading.style.display = 'none';
                body.style.display = 'block';
                setAnalysisContent(text, parsed.analysis || '缓存分析完成。');
                showPromptViewer(parsed);
                updateAIReportLink(parsed);
                showPersistWarning(text, parsed.report_persist_error || '');
                app.resetButtonState(button);
                return;
            }
            if (parsed && !parsed.report_slug) {
                sessionStorage.removeItem(cacheKey);
            }
        }

        const promptAdminToken = app.getPromptAdminToken();
        if (!promptAdminToken) {
            app.savePendingAIAnalysisRequest(pendingRequest);
            app.redirectToPromptAdminLogin('当前登录会话缺少 AI 分析权限令牌，通常是旧登录会话导致的。');
            app.resetButtonState(button);
            return;
        }

        currentAbortController = new AbortController();
        const timeout = setTimeout(() => currentAbortController.abort(), 150000);
        try {
            const requestBody = {
                start_date: startDate,
                end_date: endDate,
                analysis_type: analysisType,
                source_tab: activeTab,
                publish: true,
            };
            const result = await authHelpers.fetchFunctionJson('ai-analysis', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: requestBody,
                useSessionToken: true,
                includePromptAdminToken: true,
                signal: currentAbortController.signal,
                parseErrorMessage: 'AI 分析接口返回了无法解析的响应，请稍后重试',
                unauthorizedPattern: /Missing Authorization header or invalid token/i,
                unauthorizedMessage: 'AI 分析权限已失效，请重新登录',
                onUnauthorized: () => {
                    app.savePendingAIAnalysisRequest(pendingRequest);
                    app.redirectToPromptAdminLogin('当前登录会话没有携带有效的 AI 分析权限令牌。');
                },
            }).then(({ data }) => data);

            if (result.report_slug) {
                sessionStorage.setItem(cacheKey, JSON.stringify(result));
            }
            loading.style.display = 'none';
            body.style.display = 'block';
            setAnalysisContent(text, result.analysis || '分析完成，但未返回内容。');
            showPromptViewer(result);
            updateAIReportLink(result);
            showPersistWarning(text, result.report_persist_error || (!result.report_slug ? '接口未返回 report_slug' : ''));
        } catch (error) {
            showPersistWarning(text, '');
            loading.style.display = 'none';
            body.style.display = 'block';
            if (error.name === 'AbortError') {
                setAnalysisContent(text, '请求超时（150秒），请稍后重试。', { asPlainText: true });
            } else if (window.__dashboardAuthRedirecting || (error.message || '').includes('AI 分析权限已失效')) {
                setAnalysisContent(text, '当前登录会话缺少 AI 分析权限令牌，正在跳转重新登录...', { asPlainText: true });
            } else {
                setAnalysisContent(text, '分析失败：' + error.message + '\n\n请稍后重试。', { asPlainText: true });
            }
        } finally {
            clearTimeout(timeout);
            currentAbortController = null;
            app.resetButtonState(button);
        }
    }

    function showPersistWarning(textEl, message) {
        const body = document.getElementById('ai-analysis-body');
        if (!body || !textEl) return;
        let el = document.getElementById('ai-analysis-persist-warning');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ai-analysis-persist-warning';
            el.setAttribute('role', 'status');
            body.insertBefore(el, textEl.nextSibling);
        }
        const trimmed = String(message || '').trim();
        if (!trimmed) {
            el.textContent = '';
            el.style.display = 'none';
            return;
        }
        el.className = 'ai-analysis-persist-warning';
        el.textContent = '未写入洞察中心列表：' + trimmed + '。可点击「重新分析」重试，或联系管理员检查数据库 ai_reports。';
        el.style.display = 'block';
    }

    function showPromptViewer(result) {
        const viewer = document.getElementById('ai-prompt-viewer');
        const systemEl = document.getElementById('ai-prompt-system');
        const renderedEl = document.getElementById('ai-prompt-rendered');
        if (!viewer || !systemEl || !renderedEl) return;

        const hasPrompt = result.rendered_prompt || result.system_prompt;
        if (!hasPrompt) { viewer.style.display = 'none'; return; }

        systemEl.textContent = result.system_prompt || '（无 system prompt）';
        renderedEl.textContent = result.rendered_prompt || '（无 user prompt）';
        viewer.style.display = '';
        viewer.removeAttribute('open');
    }

    function closeAIAnalysis() {
        document.getElementById('ai-analysis-modal')?.classList.remove('show');
        currentAbortController?.abort();
    }

    function refreshAIAnalysis() {
        const app = window.DashboardApp;
        const { activeTab, startDate, endDate, analysisType } = app.getAIAnalysisContext();
        sessionStorage.removeItem(`ai_analysis_v3_${activeTab}_${startDate}_${endDate}_${analysisType}`);
        void openAIAnalysis().catch((e) => console.warn('refreshAIAnalysis failed:', e));
    }

    function maybeResumePendingAIAnalysis(pendingRequest) {
        const app = window.DashboardApp;
        if (!pendingRequest || !app.getPromptAdminToken()) {
            return;
        }

        app.clearPendingAIAnalysisRequest();
        app.applyDashboardDateRange(pendingRequest.startDate, pendingRequest.endDate);
        app.setActiveTab(pendingRequest.activeTab);

        setTimeout(() => {
            openAIAnalysis();
        }, 500);
    }

    window.DashboardAi = {
        updateAIReportLink,
        openReportCenter,
        openAIAnalysis,
        closeAIAnalysis,
        refreshAIAnalysis,
        maybeResumePendingAIAnalysis,
    };
})(window);
