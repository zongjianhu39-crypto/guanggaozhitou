(function attachGenbiPage(window) {
    const authHelpers = window.authHelpers || {};
    let lastResultPayload = null;
    let lastSavedReportSlug = '';
    let isSubmitting = false;

    var escapeHtml = window.sharedUtils && window.sharedUtils.escapeHtml;

    var EXAMPLE_LS_KEY = 'genbi_example_questions';
    var MAX_CSV_BYTES = 512 * 1024;
    var MAX_CSV_ROWS = 200;
    var MAX_CSV_COLUMNS = 40;
    var DEFAULT_EXAMPLES = [
        '哪些具体人群效果好需要增加预算，哪些人群差需要降低预算',
        '单品广告里哪些商品花费高但回报差',
        '老客和新客的占比情况如何，是否合理',
        '哪些商品适合冲销售额',
        '帮我整理一下上周的周报需要有近期周环比',
        '帮我整理一下上月的月报需要有近期月环比',
        '为什么昨日的花费下降了，在人群上有什么变化',
        '为什么上周的花费盈亏ROI低于 1 是亏钱的，亏在了哪里',
        '帮我根据货盘推荐合适的超级直播投放人群',
        '这个货盘适合哪些人群投放，预算怎么分配',
    ];

    function getExamples() {
        try {
            var raw = localStorage.getItem(EXAMPLE_LS_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return DEFAULT_EXAMPLES.slice();
    }

    function saveExamples(list) {
        try {
            localStorage.setItem(EXAMPLE_LS_KEY, JSON.stringify(list));
        } catch (e) {}
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
        }
        return '';
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

    function setStatus(message, type) {
        var el = document.getElementById('genbi-status');
        if (!el) return;
        el.className = 'genbi-status' + (type ? ' ' + type : '');
        el.textContent = message;
    }

    function sanitizeReportText(text) {
        return String(text || '')
            .replace(/\r\n/g, '\n')
            .replace(/<think[\s\S]*?<\/think>/gi, '')
            .replace(/```think[\s\S]*?```/gi, '')
            .replace(/<\/?think>/gi, '')
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

    function setSaveStatus(message, type) {
        var el = document.getElementById('genbi-save-status');
        if (!el) return;
        el.className = 'genbi-save-status' + (type ? ' ' + type : '');
        el.textContent = message;
    }

    function toggleSaveActions(payload) {
        var saveButton = document.getElementById('genbi-save-btn');
        var openButton = document.getElementById('genbi-open-insights-btn');
        var canSave = Boolean(payload && payload.intent && payload.intent !== 'unsupported' && String(payload.answer || '').trim());
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
        var safePayload = payload && typeof payload === 'object' ? payload : {};
        lastResultPayload = safePayload;
        lastSavedReportSlug = '';
        var resultSection = document.getElementById('genbi-result-section');
        if (resultSection) {
            resultSection.style.display = 'block';
        }
        document.getElementById('genbi-result').style.display = 'block';
        var isAiEnhanced = Boolean(safePayload.ai_enhanced);
        var isAssortment = Boolean(safePayload.assortment_mode);
        document.getElementById('genbi-result-title').textContent = typeof safePayload.title === 'string' && safePayload.title.trim()
            ? safePayload.title
            : (isAssortment ? '🎯 货盘人群推荐' : '问数结果');
        document.getElementById('genbi-result-range').textContent = safePayload.range?.start
            ? `分析范围：${safePayload.range.start} 至 ${safePayload.range.end || safePayload.range.start}${isAiEnhanced ? ' · AI 增强分析' : ''}`
            : (isAssortment ? `分析 ${safePayload.product_count || 0} 个商品 · AI 增强分析` : '分析范围：未提供');
        // 思考过程（可折叠）
        var thinkingEl = document.getElementById('genbi-result-thinking');
        if (thinkingEl) {
            var thinkingText = typeof safePayload.thinking === 'string' && safePayload.thinking.trim()
                ? safePayload.thinking
                : '';
            if (thinkingText) {
                thinkingEl.style.display = 'block';
                // 用 markdown 渲染思考过程
                var render = window.AiArticleMarkdown && typeof window.AiArticleMarkdown.renderArticleMarkdown === 'function'
                    ? window.AiArticleMarkdown.renderArticleMarkdown
                    : null;
                var thinkingContent = document.getElementById('genbi-thinking-content');
                if (thinkingContent) {
                    thinkingContent.innerHTML = render ? render(thinkingText) : '<p>' + escapeHtml(thinkingText) + '</p>';
                }
            } else {
                thinkingEl.style.display = 'none';
            }
        }

        renderAnswerContent(typeof safePayload.answer === 'string' ? safePayload.answer : '');
        var highlights = Array.isArray(safePayload.highlights) ? safePayload.highlights.filter(function(item) { return typeof item === 'string' && item.trim(); }) : [];
        var notes = Array.isArray(safePayload.notes) ? safePayload.notes.map(function(item) { return typeof item === 'string' ? item : JSON.stringify(item); }).filter(Boolean) : [];
        var tables = Array.isArray(safePayload.tables) ? safePayload.tables : [];
        document.getElementById('genbi-highlight-tags').innerHTML = highlights.map(function(item) { return '<span class="tag">' + escapeHtml(item) + '</span>'; }).join('');
        document.getElementById('genbi-result-tables').innerHTML = tables.map(renderTable).join('');
        document.getElementById('genbi-result-references').innerHTML = renderReferences(safePayload.references || []);
        document.getElementById('genbi-result-notes').innerHTML = notes.length
            ? '<strong>补充说明：</strong><br>' + notes.map(function(item) { return escapeHtml(item); }).join('<br>')
            : '';
        setSaveStatus('', '');
        toggleSaveActions(safePayload);
    }

    function openSavedInsight() {
        var target = lastSavedReportSlug
            ? 'insights.html?slug=' + encodeURIComponent(lastSavedReportSlug)
            : 'insights.html';
        window.location.href = target;
    }

    async function saveToInsights() {
        if (!lastResultPayload || !lastResultPayload.intent || lastResultPayload.intent === 'unsupported') {
            setSaveStatus('当前结果不支持保存到洞察中心。', 'error');
            return;
        }

        var question = document.getElementById('genbi-question')?.value?.trim() || '';
        if (!question) {
            setSaveStatus('缺少原始问题，无法保存。', 'error');
            return;
        }

        var confirmed = window.confirm('保存后会在洞察中心生成一条正式报告，团队成员可查看。是否继续？');
        if (!confirmed) {
            return;
        }

        var button = document.getElementById('genbi-save-btn');
        if (button) {
            button.disabled = true;
            button.textContent = '保存中...';
        }
        setSaveStatus('正在写入洞察中心...', '');

        try {
            var result = await authHelpers.fetchFunctionJson('save-insight-report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': (window.crypto && typeof window.crypto.randomUUID === 'function')
                        ? window.crypto.randomUUID()
                        : 'genbi-' + Date.now(),
                },
                body: {
                    source_channel: 'genbi',
                    save_mode: 'published',
                    question: question,
                    result: lastResultPayload,
                },
                useSessionToken: true,
                includePromptAdminToken: true,
                parseErrorMessage: '保存接口返回了无法解析的响应，请稍后重试',
                unauthorizedPattern: /未登录|invalid token|Missing Authorization/i,
                onUnauthorized: function() {
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

            lastSavedReportSlug = result.data?.report_slug || '';
            setSaveStatus(lastSavedReportSlug ? '已保存到洞察中心，可直接查看详情。' : '已保存到洞察中心。', 'success');
            toggleSaveActions(lastResultPayload);
        } catch (error) {
            setSaveStatus('保存失败：' + (error.message || '请稍后重试'), 'error');
            if (button) {
                button.disabled = false;
                button.textContent = '保存到洞察中心';
            }
        }
    }

    // ============ CSV 解析 ============

    function parseCsv(csvText) {
        var rows = [];
        var row = [];
        var cell = '';
        var inQuotes = false;
        for (var i = 0; i < csvText.length; i++) {
            var ch = csvText[i];
            var next = csvText[i + 1];
            if (ch === '"' && inQuotes && next === '"') { cell += '"'; i++; }
            else if (ch === '"') { inQuotes = !inQuotes; }
            else if (ch === ',' && !inQuotes) { row.push(cell); cell = ''; }
            else if ((ch === '\n' || ch === '\r') && !inQuotes) {
                if (ch === '\r' && next === '\n') i++;
                row.push(cell);
                if (row.some(function(v) { return v.trim() !== ''; })) rows.push(row);
                row = [];
                cell = '';
            } else { cell += ch; }
        }
        if (inQuotes) throw new Error('CSV 存在未闭合的引号，请检查文件格式');
        row.push(cell);
        if (row.some(function(v) { return v.trim() !== ''; })) rows.push(row);
        if (rows.length < 2) throw new Error('CSV 至少需要表头和一行数据');
        var headers = rows[0].map(function(h) { return h.replace(/^\uFEFF/, '').trim(); });
        if (headers.length > MAX_CSV_COLUMNS) throw new Error('CSV 列数过多，请保留必要字段后再上传');
        if (rows.length - 1 > MAX_CSV_ROWS) throw new Error('CSV 商品行数过多，最多支持 ' + MAX_CSV_ROWS + ' 行');
        var seenHeaders = new Set();
        headers.forEach(function(header, index) {
            if (!header) throw new Error('CSV 第 ' + (index + 1) + ' 列表头为空');
            if (seenHeaders.has(header)) throw new Error('CSV 存在重复表头：' + header);
            seenHeaders.add(header);
        });
        return {
            headers: headers,
            items: rows.slice(1).map(function(values, rowIndex) {
                if (values.length > headers.length) {
                    throw new Error('CSV 第 ' + (rowIndex + 2) + ' 行列数超过表头，请检查逗号或引号');
                }
                var item = {};
                headers.forEach(function(header, index) { item[header] = (values[index] || '').trim(); });
                return item;
            }).filter(function(item) { return Object.values(item).some(function(v) { return v !== ''; }); }),
        };
    }

    async function readCsvFile() {
        var fileInput = document.getElementById('genbi-csv-file');
        if (!fileInput || !fileInput.files || !fileInput.files[0]) return null;
        if (fileInput.files[0].size > MAX_CSV_BYTES) {
            throw new Error('CSV 文件过大，最多支持 512KB');
        }
        var csvText = await fileInput.files[0].text();
        if (!csvText || !csvText.trim()) return null;
        var parsed = parseCsv(csvText);
        if (!parsed.items.length) throw new Error('CSV 没有可分析的商品行');
        return parsed;
    }

    function updateAttachUI(fileName) {
        var btn = document.getElementById('genbi-attach-btn');
        var clearBtn = document.getElementById('genbi-attach-clear');
        if (fileName) {
            if (btn) { btn.textContent = '📄 ' + (fileName.length > 18 ? fileName.slice(0, 18) + '...' : fileName); btn.classList.add('has-file'); }
            if (clearBtn) clearBtn.style.display = 'inline';
        } else {
            if (btn) { btn.textContent = '📎 上传货盘CSV'; btn.classList.remove('has-file'); }
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    function clearAttach() {
        var fileInput = document.getElementById('genbi-csv-file');
        if (fileInput) fileInput.value = '';
        updateAttachUI(null);
    }

    // ============ 提交 ============

    async function submitQuestion() {
        var textarea = document.getElementById('genbi-question');
        var button = document.getElementById('genbi-submit');
        if (isSubmitting) return;
        isSubmitting = true;
        if (button) {
            button.disabled = true;
            button.textContent = '分析中...';
        }
        var question = textarea?.value?.trim() || '';
        var csvResult = null;
        try {
            csvResult = await readCsvFile();
        } catch (e) {
            setStatus('货盘 CSV 解析失败：' + (e.message || '请检查文件格式'), 'error');
            isSubmitting = false;
            if (button) {
                button.disabled = false;
                button.textContent = '开始分析';
            }
            return;
        }
        var productItems = csvResult ? csvResult.items : null;

        if (!question && !productItems) {
            setStatus('请输入问题或上传货盘 CSV 文件。', 'error');
            isSubmitting = false;
            if (button) {
                button.disabled = false;
                button.textContent = '开始分析';
            }
            return;
        }

        // 只上传了文件没输入问题，自动补一个默认问题
        if (!question && productItems) {
            question = '帮我根据货盘推荐合适的超级直播投放人群';
            if (textarea) textarea.value = question;
        }

        var statusMsg = productItems
            ? '正在调用 MiniMax 2.7 分析 ' + productItems.length + ' 个商品并推荐人群，预计 20-40 秒...'
            : '正在调用 AI 分析真实数据，预计需要 10-30 秒...';
        setStatus(statusMsg, '');

        try {
            var body = productItems
                ? { question: question, product_items: productItems }
                : { question: question };

            var response = await authHelpers.fetchFunctionJson('genbi-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
                useSessionToken: true,
                includePromptAdminToken: true,
                parseErrorMessage: 'GenBI 接口返回了无法解析的响应，请稍后重试',
                unauthorizedPattern: /未登录|invalid token|Missing Authorization/i,
                onUnauthorized: function() {
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
            renderResult(response.data);
            setStatus('分析完成。', 'success');
        } catch (error) {
            setStatus('分析失败：' + (error.message || '请稍后重试'), 'error');
        } finally {
            isSubmitting = false;
            if (button) {
                button.disabled = false;
                button.textContent = '开始分析';
            }
        }
    }

    // ============ 事件绑定 ============

    function renderExampleList() {
        var container = document.getElementById('genbi-example-list');
        if (!container) return;
        var examples = getExamples();
        var html = '';
        examples.forEach(function(text, index) {
            var escaped = escapeHtml ? escapeHtml(text) : text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += '<div class="example-btn-row">'
                + '<button class="example-btn" type="button" data-index="' + index + '">' + escaped + '</button>'
                + '<button class="example-btn-del" type="button" data-index="' + index + '" title="删除此示例">×</button>'
                + '</div>';
        });
        container.innerHTML = html;
    }

    function bindExamples() {
        renderExampleList();

        var listEl = document.getElementById('genbi-example-list');
        if (listEl) {
            listEl.addEventListener('click', function(e) {
                var target = e.target;
                // 点击删除按钮
                if (target.classList.contains('example-btn-del')) {
                    e.stopPropagation();
                    var idx = parseInt(target.getAttribute('data-index'), 10);
                    if (isNaN(idx)) return;
                    var examples = getExamples();
                    if (idx >= 0 && idx < examples.length) {
                        examples.splice(idx, 1);
                        saveExamples(examples);
                        renderExampleList();
                    }
                    return;
                }
                // 点击问题按钮
                var btn = target.closest('.example-btn');
                if (btn) {
                    var textarea = document.getElementById('genbi-question');
                    if (textarea) {
                        textarea.value = btn.textContent || '';
                        textarea.focus();
                    }
                }
            });
        }

        // 添加按钮
        var addBtn = document.getElementById('genbi-add-example');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                var newText = window.prompt('请输入新的示例问题：');
                if (!newText || !newText.trim()) return;
                var examples = getExamples();
                examples.push(newText.trim());
                saveExamples(examples);
                renderExampleList();
            });
        }
    }

    function bindFileUpload() {
        var attachBtn = document.getElementById('genbi-attach-btn');
        var fileInput = document.getElementById('genbi-csv-file');
        var clearBtn = document.getElementById('genbi-attach-clear');

        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', function() { fileInput.click(); });
        }
        if (fileInput) {
            fileInput.addEventListener('change', function() {
                if (fileInput.files && fileInput.files[0]) {
                    updateAttachUI(fileInput.files[0].name);
                } else {
                    updateAttachUI(null);
                }
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', clearAttach);
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        bindExamples();
        bindFileUpload();
        document.getElementById('genbi-submit')?.addEventListener('click', submitQuestion);
        document.getElementById('genbi-save-btn')?.addEventListener('click', saveToInsights);
        document.getElementById('genbi-open-insights-btn')?.addEventListener('click', openSavedInsight);
    });
})(window);
