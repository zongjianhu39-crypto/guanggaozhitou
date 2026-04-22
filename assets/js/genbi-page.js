(function attachGenbiPage(window) {
    const authHelpers = window.authHelpers || {};
    let lastResultPayload = null;
    let lastSavedReportSlug = '';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getReferenceLabel(sourceType) {
        if (sourceType === 'rules_doc') return '业务规则';
        if (sourceType === 'prompt_template') return 'Prompt 模板';
        if (sourceType === 'ai_report') return '历史报告';
        return '参考来源';
    }

    function getReferenceHref(reference) {
        const pointer = String(reference?.pointer || '');
        if (!pointer) return '';
        if (reference?.sourceType === 'rules_doc') {
            return `metric-rules.html?query=${encodeURIComponent(pointer.split('/').pop() || pointer)}`;
        }
        if (reference?.sourceType === 'prompt_template') {
            const templateKey = pointer.split('/')[1] || '';
            return templateKey ? `prompt-admin.html?template_key=${encodeURIComponent(templateKey)}` : 'prompt-admin.html';
        }
        if (reference?.sourceType === 'ai_report') {
            const slug = pointer.split('/')[1] || '';
            return slug ? `insights.html?slug=${encodeURIComponent(slug)}` : 'insights.html';
        }        return '';
    }

    function renderReferences(references) {
        const items = Array.isArray(references) ? references : [];
        if (!items.length) return '';
        return `
            <strong>参考来源：</strong>
            <div style="margin-top:8px">
                ${items.map((item) => {
                    const href = getReferenceHref(item);
                    const typeLabel = escapeHtml(getReferenceLabel(item.sourceType));
                    const title = escapeHtml(item.title);
                    const summary = item.summary ? escapeHtml(item.summary) : '';
                    const sourceLink = href
                        ? `<a href="${href}" style="margin-left:8px;color:#4f46e5;text-decoration:none;font-weight:600">查看来源</a>`
                        : '';
                    return `
                        <div style="margin:0 0 10px">
                            <span style="font-weight:600;color:#475467">${typeLabel}：</span>
                            <span style="font-weight:600;color:#1f2937">${title}</span>
                            ${sourceLink}
                            ${summary ? `<div style="margin-top:2px;color:#667085">${summary}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function normalizeTable(table) {
        const safeTable = table && typeof table === 'object' ? table : {};
        const rows = Array.isArray(safeTable.rows) ? safeTable.rows.filter((row) => row && typeof row === 'object') : [];
        let columns = Array.isArray(safeTable.columns) ? safeTable.columns.filter((column) => typeof column === 'string' && column.trim()) : [];
        if (!columns.length && rows.length) {
            columns = Object.keys(rows[0]);
        }
        return {
            title: typeof safeTable.title === 'string' && safeTable.title.trim() ? safeTable.title : '结果表',
            columns,
            rows,
        };
    }

    function renderTable(table) {
        const normalized = normalizeTable(table);
        const rows = normalized.rows;
        const columns = normalized.columns;
        return `
            <section class="table-card">
                <h3>${escapeHtml(normalized.title)}</h3>
                <div class="table-scroll">
                    <table class="result-table">
                        <thead>
                            <tr>${columns.length ? columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('') : '<th>结果</th>'}</tr>
                        </thead>
                        <tbody>
                            ${rows.length ? rows.map((row) => `<tr>${(columns.length ? columns : ['result']).map((column) => `<td>${escapeHtml(row[column] ?? (column === 'result' ? JSON.stringify(row) : '-'))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length || 1}">暂无数据</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function setStatus(message, type = '') {
        const el = document.getElementById('genbi-status');
        if (!el) return;
        el.className = `genbi-status ${type}`.trim();
        el.textContent = message;
    }

    function sanitizeReportText(text) {
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<\/?think>/gi, '')
            .replace(/```thinking[\s\S]*?```/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function renderAnswerContent(answer) {
        const el = document.getElementById('genbi-result-answer');
        if (!el) return;
        const text = sanitizeReportText(answer);
        const render = window.AiArticleMarkdown && typeof window.AiArticleMarkdown.renderArticleMarkdown === 'function'
            ? window.AiArticleMarkdown.renderArticleMarkdown
            : null;

        if (render && text) {
            el.className = 'result-answer report-article-prose';
            el.innerHTML = render(text);
            return;
        }

        el.className = 'result-answer';
        el.textContent = text;
    }

    function setSaveStatus(message, type = '') {
        const el = document.getElementById('genbi-save-status');
        if (!el) return;
        el.className = `genbi-save-status ${type}`.trim();
        el.textContent = message;
    }

    function toggleSaveActions(payload) {
        const saveButton = document.getElementById('genbi-save-btn');
        const openButton = document.getElementById('genbi-open-insights-btn');
        const canSave = Boolean(payload && payload.intent && payload.intent !== 'unsupported' && String(payload.answer || '').trim());
        if (saveButton) {
            saveButton.style.display = canSave ? 'inline-flex' : 'none';
            saveButton.disabled = false;
            saveButton.textContent = '保存到洞察中心';
        }
        if (openButton) {
            openButton.style.display = lastSavedReportSlug ? 'inline-flex' : 'none';
        }
    }

    function renderResult(payload) {
        const safePayload = payload && typeof payload === 'object' ? payload : {};
        lastResultPayload = safePayload;
        lastSavedReportSlug = '';
        const resultSection = document.getElementById('genbi-result-section');
        if (resultSection) {
            resultSection.style.display = 'block';
        }
        document.getElementById('genbi-result').style.display = 'block';
        const isAiEnhanced = Boolean(safePayload.ai_enhanced);
        document.getElementById('genbi-result-title').textContent = typeof safePayload.title === 'string' && safePayload.title.trim() ? safePayload.title : '问数结果';
        document.getElementById('genbi-result-range').textContent = safePayload.range?.start
            ? `分析范围：${safePayload.range.start} 至 ${safePayload.range.end || safePayload.range.start}${isAiEnhanced ? ' · AI 增强分析' : ''}`
            : '分析范围：未提供';
        renderAnswerContent(typeof safePayload.answer === 'string' ? safePayload.answer : '');
        const highlights = Array.isArray(safePayload.highlights) ? safePayload.highlights.filter((item) => typeof item === 'string' && item.trim()) : [];
        const notes = Array.isArray(safePayload.notes) ? safePayload.notes.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).filter(Boolean) : [];
        const tables = Array.isArray(safePayload.tables) ? safePayload.tables : [];
        document.getElementById('genbi-highlight-tags').innerHTML = highlights.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('');
        document.getElementById('genbi-result-tables').innerHTML = tables.map(renderTable).join('');
        document.getElementById('genbi-result-references').innerHTML = renderReferences(safePayload.references || []);
        document.getElementById('genbi-result-notes').innerHTML = notes.length
            ? `<strong>补充说明：</strong><br>${notes.map((item) => escapeHtml(item)).join('<br>')}`
            : '';
        setSaveStatus('', '');
        toggleSaveActions(safePayload);
    }

    function openSavedInsight() {
        const target = lastSavedReportSlug
            ? `insights.html?slug=${encodeURIComponent(lastSavedReportSlug)}`
            : 'insights.html';
        window.location.href = target;
    }

    async function saveToInsights() {
        if (!lastResultPayload || !lastResultPayload.intent || lastResultPayload.intent === 'unsupported') {
            setSaveStatus('当前结果不支持保存到洞察中心。', 'error');
            return;
        }

        const question = document.getElementById('genbi-question')?.value?.trim() || '';
        if (!question) {
            setSaveStatus('缺少原始问题，无法保存。', 'error');
            return;
        }

        const confirmed = window.confirm('保存后会在洞察中心生成一条正式报告，团队成员可查看。是否继续？');
        if (!confirmed) {
            return;
        }

        const button = document.getElementById('genbi-save-btn');
        if (button) {
            button.disabled = true;
            button.textContent = '保存中...';
        }
        setSaveStatus('正在写入洞察中心...', '');

        try {
            const { data } = await authHelpers.fetchFunctionJson('save-insight-report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': (window.crypto && typeof window.crypto.randomUUID === 'function')
                        ? window.crypto.randomUUID()
                        : `genbi-${Date.now()}`,
                },
                body: {
                    source_channel: 'genbi',
                    save_mode: 'published',
                    question,
                    result: lastResultPayload,
                },
                useSessionToken: true,
                includePromptAdminToken: true,
                parseErrorMessage: '保存接口返回了无法解析的响应，请稍后重试',
                unauthorizedPattern: /未登录|invalid token|Missing Authorization/i,
                onUnauthorized: () => {
                    if (typeof authHelpers.handleReauthRequired === 'function') {
                        authHelpers.handleReauthRequired({
                            source: 'genbi-save',
                            targetUrl: window.location.href,
                            force: true,
                            delayMs: 800,
                            reason: 'prompt_admin_reauth_required',
                        });
                    } else if (authHelpers.redirectToLogin) {
                        authHelpers.redirectToLogin({
                            targetUrl: window.location.href,
                            force: true,
                            delayMs: 800,
                        });
                    } else {
                        window.location.href = 'auth/index.html?force=1';
                    }
                },
            });

            lastSavedReportSlug = data?.report_slug || '';
            setSaveStatus(lastSavedReportSlug ? '已保存到洞察中心，可直接查看详情。' : '已保存到洞察中心。', 'success');
            toggleSaveActions(lastResultPayload);
        } catch (error) {
            setSaveStatus(`保存失败：${error.message || '请稍后重试'}`, 'error');
            if (button) {
                button.disabled = false;
                button.textContent = '保存到洞察中心';
            }
        }
    }

    async function submitQuestion() {
        const textarea = document.getElementById('genbi-question');
        const button = document.getElementById('genbi-submit');
        const question = textarea?.value?.trim() || '';
        if (!question) {
            setStatus('请先输入问题。', 'error');
            return;
        }

        button.disabled = true;
        button.textContent = '分析中...';
        setStatus('正在调用 AI 分析真实数据，预计需要 10-30 秒...', '');

        try {
            const { data } = await authHelpers.fetchFunctionJson('genbi-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { question },
                useSessionToken: true,
                includePromptAdminToken: true,
                parseErrorMessage: 'GenBI 接口返回了无法解析的响应，请稍后重试',
                unauthorizedPattern: /未登录|invalid token|Missing Authorization/i,
                onUnauthorized: () => {
                    if (typeof authHelpers.handleReauthRequired === 'function') {
                        authHelpers.handleReauthRequired({
                            source: 'genbi',
                            targetUrl: window.location.href,
                            force: true,
                            delayMs: 800,
                            reason: 'prompt_admin_reauth_required',
                        });
                    } else if (authHelpers.redirectToLogin) {
                        authHelpers.redirectToLogin({
                            targetUrl: window.location.href,
                            force: true,
                            delayMs: 800,
                        });
                    } else {
                        window.location.href = 'auth/index.html?force=1';
                    }
                },
            });
            renderResult(data);
            setStatus('分析完成。', 'success');
        } catch (error) {
            setStatus(`分析失败：${error.message || '请稍后重试'}`, 'error');
        } finally {
            button.disabled = false;
            button.textContent = '开始分析';
        }
    }

    function bindExamples() {
        document.querySelectorAll('#genbi-example-list .example-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const textarea = document.getElementById('genbi-question');
                if (textarea) {
                    textarea.value = button.textContent || '';
                    textarea.focus();
                }
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindExamples();
        document.getElementById('genbi-submit')?.addEventListener('click', submitQuestion);
        document.getElementById('genbi-save-btn')?.addEventListener('click', saveToInsights);
        document.getElementById('genbi-open-insights-btn')?.addEventListener('click', openSavedInsight);
    });
})(window);
