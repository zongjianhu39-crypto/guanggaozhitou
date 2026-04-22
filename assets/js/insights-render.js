        function stripMarkdown(text) {
            return String(text || '')
                .replace(/```[\s\S]*?```/g, ' ')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/\*([^*]+)\*/g, '$1')
                .replace(/#+\s*/g, '')
                .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
                .replace(/^[\-\d.\s]+/, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function stripThinkBlocks(text) {
            const raw = String(text || '');
            let sanitized = raw
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<\/?think>/gi, '')
                .trim();

            if (sanitized && !/^(好的，我|好的，|首先，我|根据提供的)/.test(sanitized)) {
                return sanitized;
            }

            const sectionTitles = [
                '大盘结论', '高消耗人群分析', '重点人群点名', '财务与退款修正', '明日执行建议',
                '单品整体结论', '高消耗商品分析', '高效率与低效率商品点名', '转化与加购机会',
            ];
            const firstSectionIndex = sectionTitles
                .map((title) => raw.indexOf(title))
                .filter((index) => index >= 0)
                .sort((left, right) => left - right)[0];

            if (Number.isInteger(firstSectionIndex)) {
                sanitized = raw.slice(firstSectionIndex);
            }

            return sanitized
                .replace(/<\/?think>/gi, '')
                .trim();
        }

        function sanitizeReportText(text) {
            return stripThinkBlocks(text)
                .replace(/\r\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        function isGenbiReport(item, payload = {}) {
            return item?.report_type === 'genbi'
                || item?.source_channel === 'genbi'
                || payload?.source?.channel === 'genbi';
        }

        function isWeakSummary(text) {
            const normalized = sanitizeReportText(text).replace(/\s+/g, ' ').trim();
            if (!normalized) return true;

            return [
                normalized.includes('我需要作为'),
                normalized.includes('我需要根据'),
                normalized.includes('首先，我需要'),
                normalized.includes('虽然说是昨日数据'),
                normalized.includes('暂且理解'),
                normalized.includes('不对，'),
                normalized.startsWith('好的，我'),
                normalized.startsWith('好的，')
            ].some(Boolean);
        }

        function buildSummaryFallback(item, payload = {}) {
            if (isGenbiReport(item, payload)) {
                const article = sanitizeReportText(item.raw_markdown || payload.article?.markdown || payload.markdown || '');
                if (article) {
                    return stripMarkdown(article).slice(0, 140);
                }
                return '该 GenBI 洞察已保存，可查看正文、结果表格与参考来源。';
            }

            const metrics = item.overview_metrics || payload.overviewMetrics || {};
            const topRisk = (item.highlights || payload.issues || [])[0];
            const topAction = (item.actions || payload.actions || [])[0];
            const fragments = [];

            if (metrics.returnRate) {
                fragments.push(`退货率 ${metrics.returnRate}`);
            }
            if (metrics.returnRoi) {
                fragments.push(`去退 ROI ${metrics.returnRoi}`);
            }
            if (metrics.finMargin) {
                fragments.push(`毛利率 ${metrics.finMargin}`);
            }
            if (topRisk?.title) {
                fragments.push(`当前核心风险是${topRisk.title}`);
            }
            if (topAction?.title) {
                fragments.push(`优先动作是${topAction.title}`);
            }

            if (fragments.length === 0) {
                return '当前报告已经生成，但首屏摘要质量一般，建议优先看下方的 AI 正式解读和执行动作。';
            }

            return `${fragments.join('，')}。`;
        }

        function getReadableSummary(item, payload = {}) {
            const candidates = [
                item.summary,
                item.executive_summary?.headline,
                payload.executiveSummary?.headline,
            ].map((value) => sanitizeReportText(value));

            const usable = candidates.find((value) => value && !isWeakSummary(value));
            return usable || buildSummaryFallback(item, payload);
        }

        function buildDetailFocusCards(item, payload = {}) {
            if (isGenbiReport(item, payload)) {
                const source = payload.source || {};
                const range = source.range || item.source_range || {};
                const rangeText = range.start && range.end
                    ? `${range.start} 至 ${range.end}`
                    : (range.start || range.end || item.report_date || '--');
                const question = source.question || item.source_question || '未记录原始问题';
                const intent = source.intent || item.source_intent || item.title || '通用问数';

                return [
                    {
                        label: '来源渠道',
                        value: 'GenBI',
                        desc: `保存时间范围：${rangeText}`,
                    },
                    {
                        label: '识别意图',
                        value: intent,
                        desc: item.title || '已按 GenBI 结果生成正式洞察报告。',
                    },
                    {
                        label: '原始问题',
                        value: question,
                        desc: '下面保留了正文、结果表格、参考来源与补充说明。',
                    },
                ].map((card) => `
                    <div class="detail-focus-card">
                        <div class="label">${escapeHtml(card.label)}</div>
                        <div class="value">${escapeHtml(card.value)}</div>
                        <div class="desc">${escapeHtml(card.desc)}</div>
                    </div>
                `).join('');
            }

            const metrics = item.overview_metrics || payload.overviewMetrics || {};
            const topIssue = (item.highlights || payload.issues || [])[0];
            const topAction = (item.actions || payload.actions || [])[0];
            const topCrowd = (item.high_spend_crowds || payload.highSpendCrowds || [])[0];

            const cards = [
                {
                    label: '首要判断',
                    value: item.risk_level ? riskLabel(item.risk_level) : '未评级',
                    desc: topIssue?.impact || buildSummaryFallback(item, payload),
                },
                {
                    label: '当前最大风险',
                    value: topIssue?.title || (metrics.returnRate ? `退货率 ${metrics.returnRate}` : '待补充'),
                    desc: topIssue?.evidence || '优先看真实回报、退款侵蚀和利润修正。',
                },
                {
                    label: '最该先动的对象',
                    value: topAction?.title || topCrowd?.name || '待补充',
                    desc: topAction?.reason || (topCrowd ? `${decisionLabel(topCrowd.decision)}，最近 ROI ${Number(topCrowd.roi || 0).toFixed(2)}` : '优先从高消耗人群和动作建议里挑一条先执行。'),
                },
            ];

            return cards.map((card) => `
                <div class="detail-focus-card">
                    <div class="label">${escapeHtml(card.label)}</div>
                    <div class="value">${escapeHtml(card.value)}</div>
                    <div class="desc">${escapeHtml(card.desc)}</div>
                </div>
            `).join('');
        }

        function buildMetricHint(key, metrics) {
            if (key === 'returnRate') return '越高说明表面成交被退款侵蚀得越明显';
            if (key === 'returnRoi') return '更接近真实回报，优先级高于表面 ROI';
            if (key === 'finMargin') return '利润层面是否还能承接放量';
            if (key === 'roi') return '成交视角的表面效率';
            if (key === 'totalCost') return `总成交 ${metrics.totalAmount || '--'}`;
            if (key === 'totalAmount') return `总订单 ${metrics.totalOrders || '--'}`;
            return '';
        }

        function renderEmpty(message) {
            document.getElementById('list-state').innerHTML = `<div class="list-empty">${escapeHtml(message)}</div>`;
            document.getElementById('report-list').innerHTML = '';
        }


        function renderLoading(message) {
            document.getElementById('list-state').innerHTML = `<div class="loading-box">${escapeHtml(message)}</div>`;
            document.getElementById('report-list').innerHTML = '';
        }


        function renderError(message) {
            document.getElementById('list-state').innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
            document.getElementById('report-list').innerHTML = '';
        }


        function updateStats(items, total) {
            const normalizedItems = Array.isArray(items) ? items : [];
            const latest = normalizedItems[0]?.report_date || '--';
            const highRiskCount = normalizedItems.filter((item) => ['high', 'critical'].includes(item.risk_level)).length;

            document.getElementById('stat-total').textContent = total ?? normalizedItems.length;
            document.getElementById('stat-high-risk').textContent = highRiskCount;
            document.getElementById('stat-latest').textContent = latest;
        }

        function formatReportMetricsLine(metrics) {
            const parts = [];
            if (metrics.roi) parts.push(`ROI ${metrics.roi}`);
            if (metrics.returnRoi) parts.push(`去退 ${metrics.returnRoi}`);
            if (metrics.totalCost) parts.push(`花费 ${metrics.totalCost}`);
            if (metrics.finMargin) parts.push(`毛利 ${metrics.finMargin}`);
            return parts.join(' · ');
        }

        function renderReportCard(item, index) {
            const metrics = item.overview_metrics || {};
            const tags = Array.isArray(item.tags) ? item.tags.slice(0, 4) : [];
            const readableSummary = getReadableSummary(item);
            const isLatest = index === 0;
            const metaLine = formatReportMetricsLine(metrics);
            const genbiReport = isGenbiReport(item, item.raw_payload || {});
            const riskClass = !genbiReport && item.risk_level ? `is-${escapeHtml(item.risk_level)}` : '';
            const badgeLabel = genbiReport ? 'GenBI' : riskLabel(item.risk_level);
            const badgeClass = genbiReport ? 'medium' : escapeHtml(item.risk_level || '');
            const slug = escapeHtml(item.slug || '');

            return `
                <article class="report-card report-entry ${isLatest ? 'report-entry--latest' : ''} ${riskClass}" data-report-slug="${slug}" tabindex="0" role="button" aria-label="查看报告详情">
                    <div class="report-entry-head">
                        <div class="report-entry-head-main">
                            ${isLatest ? '<span class="report-badge-latest">最新</span>' : ''}
                            <h3>${escapeHtml(item.title || '未命名报告')}</h3>
                        </div>
                        <div class="report-entry-meta">
                            <span class="report-entry-date">${escapeHtml(item.report_date || '--')}</span>
                            <span class="risk-pill ${badgeClass}">${escapeHtml(badgeLabel)}</span>
                        </div>
                    </div>
                    <p class="report-entry-summary">${escapeHtml(readableSummary)}</p>
                    ${metaLine ? `<p class="report-entry-metrics">${escapeHtml(metaLine)}</p>` : ''}
                    ${tags.length ? `<div class="chips">${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                    <div class="report-entry-cta-row"><span class="report-entry-cta">查看详情</span></div>
                </article>
            `;
        }

        function renderList(items) {
            const normalizedItems = Array.isArray(items) ? items : [];
            document.getElementById('list-state').innerHTML = '';

            if (normalizedItems.length === 0) {
                renderEmpty('当前筛选下没有报告。若刚在看板跑过 AI 分析，请点击「刷新报告」；若刚在 GenBI 保存结果，请回到 GenBI 点击「保存到洞察中心」后再刷新。');
                return;
            }

            document.getElementById('report-list').innerHTML = normalizedItems.map((item, index) => renderReportCard(item, index)).join('');
        }






        function renderMetricCards(metrics = {}) {
            const metricOrder = ['returnRoi', 'returnRate', 'finMargin', 'roi', 'totalCost', 'totalAmount'];
            const entries = metricOrder
                .filter((key) => metrics[key] !== null && metrics[key] !== undefined && metrics[key] !== '')
                .map((key) => [key, metrics[key]]);

            document.getElementById('detail-primary-metrics').innerHTML = entries
                .map(([key, value]) => `
                    <div class="detail-kpi-card">
                        <div class="label">${escapeHtml(metricLabels[key] || key)}</div>
                        <div class="value">${escapeHtml(value)}</div>
                        <div class="hint">${escapeHtml(buildMetricHint(key, metrics))}</div>
                    </div>
                `)
                .join('');
        }

        function renderListItems(targetId, items, formatter, emptyText) {
            const target = document.getElementById(targetId);
            if (!Array.isArray(items) || items.length === 0) {
                target.innerHTML = `<div class="item-desc">${escapeHtml(emptyText)}</div>`;
                return;
            }
            target.innerHTML = items.map(formatter).join('');
        }

        function renderHighSpend(item) {
            return `
                <div class="list-item">
                    <div class="item-title">${escapeHtml(item.name)} <span class="risk-pill ${escapeHtml(item.decision === 'reduce' ? 'high' : item.decision === 'increase' ? 'low' : 'medium')}">${escapeHtml(item.decision === 'reduce' ? '收缩' : item.decision === 'increase' ? '放量' : '观察')}</span></div>
                    <div class="item-meta">花费 ¥${escapeHtml(Number(item.cost || 0).toFixed(0))}，占比 ${escapeHtml(Number(item.costShare || 0).toFixed(1))}%，ROI ${escapeHtml(Number(item.roi || 0).toFixed(2))}，订单成本 ¥${escapeHtml(Number(item.orderCost || 0).toFixed(1))}</div>
                    <div class="item-desc">${escapeHtml(item.reason || '')}</div>
                </div>
            `;
        }

        function renderAction(item) {
            return `
                <div class="list-item">
                    <div class="item-title">${escapeHtml(item.title || '待执行动作')}</div>
                    <div class="item-meta">优先级 ${escapeHtml(String(item.priority || '').toUpperCase())} · 对象 ${escapeHtml(item.target || '--')}</div>
                    <div class="item-desc">${escapeHtml(item.reason || '')}</div>
                </div>
            `;
        }

        function renderIssue(item) {
            return `
                <div class="list-item">
                    <div class="item-title">${escapeHtml(item.title || '风险项')} <span class="risk-pill ${escapeHtml(item.severity || 'medium')}">${escapeHtml(riskLabel(item.severity))}</span></div>
                    <div class="item-meta">${escapeHtml(item.evidence || '--')}</div>
                    <div class="item-desc">${escapeHtml(item.impact || '')}</div>
                </div>
            `;
        }

        function renderFinance(finance = {}) {
            const items = Array.isArray(finance.costStructure) ? finance.costStructure : [];
            const summary = finance.summary || '暂无财务修正数据';
            return `
                <div class="list-item">
                    <div class="item-title">财务结论</div>
                    <div class="item-desc">${escapeHtml(summary)}</div>
                </div>
                ${items.map((item) => `
                    <div class="list-item">
                        <div class="item-title">${escapeHtml(item.name)}</div>
                        <div class="item-meta">金额 ¥${escapeHtml(Number(item.amount || 0).toFixed(0))} · 占比 ${escapeHtml(Number(item.share || 0).toFixed(1))}%</div>
                    </div>
                `).join('')}
            `;
        }

        function renderSession(item) {
            return `
                <div class="list-item">
                    <div class="item-title">${escapeHtml(item.name || '未命名场次')}</div>
                    <div class="item-meta">成交 ¥${escapeHtml(Number(item.amount || 0).toFixed(0))} · 观看 ${escapeHtml(Math.round(Number(item.views || 0)))} · 成交笔数 ${escapeHtml(Math.round(Number(item.orders || 0)))}</div>
                    <div class="item-desc">买家转化率 ${escapeHtml(Number(item.buyerRate || 0).toFixed(2))}% · 退款率 ${escapeHtml(Number(item.refundRate || 0).toFixed(2))}%</div>
                </div>
            `;
        }

        function getReferenceLabel(sourceType) {
            if (sourceType === 'rules_doc') return '业务规则';
            if (sourceType === 'prompt_template') return 'Prompt 模板';
            if (sourceType === 'ai_report') return '历史报告';
            if (sourceType === 'ai_playbook') return '经验库';
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

        function renderGenbiTable(table) {
            const normalized = normalizeTable(table);
            return `
                <div class="appendix-block">
                    <h4 class="appendix-h">${escapeHtml(normalized.title)}</h4>
                    <div class="article-md-table-wrap">
                        <table class="ai-analysis-table">
                            <thead>
                                <tr>${(normalized.columns.length ? normalized.columns : ['结果']).map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
                            </thead>
                            <tbody>
                                ${normalized.rows.length
                                    ? normalized.rows.map((row) => `<tr>${(normalized.columns.length ? normalized.columns : ['结果']).map((column) => `<td>${escapeHtml(row[column] ?? (column === '结果' ? JSON.stringify(row) : '-'))}</td>`).join('')}</tr>`).join('')
                                    : `<tr><td colspan="${normalized.columns.length || 1}">暂无数据</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        function renderGenbiReference(reference) {
            const href = getReferenceHref(reference);
            const content = `
                <div class="list-item">
                    <div class="item-title">${escapeHtml(reference.title || '参考来源')}</div>
                    <div class="item-meta">${escapeHtml(getReferenceLabel(reference.sourceType))}</div>
                    <div class="item-desc">${escapeHtml(reference.summary || '暂无摘要')}</div>
                </div>
            `;
            return href ? `<a href="${href}" style="text-decoration:none;color:inherit">${content}</a>` : content;
        }

        function renderGenbiAppendix(item, payload = {}) {
            const artifacts = payload.artifacts || {};
            const tables = Array.isArray(artifacts.tables) ? artifacts.tables : [];
            const references = Array.isArray(artifacts.references) ? artifacts.references : [];
            const notes = Array.isArray(artifacts.notes) ? artifacts.notes : [];
            const blocks = [];

            if (tables.length) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">结果表格</h4>${tables.map(renderGenbiTable).join('')}</div>`);
            }
            if (references.length) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">参考来源</h4>${references.map(renderGenbiReference).join('')}</div>`);
            }
            if (notes.length) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">补充说明</h4>${notes.map((note) => `<div class="list-item"><div class="item-desc">${escapeHtml(note)}</div></div>`).join('')}</div>`);
            }

            if (!blocks.length) {
                return '<p class="appendix-empty">该 GenBI 报告未附带额外表格或参考来源。</p>';
            }

            return blocks.join('');
        }

        /** 报告正文：整篇 Markdown 渲染为可读 HTML，不再按固定小标题拆块 */
        function renderReportArticleBody(item, payload = {}) {
            const md = sanitizeReportText(item.raw_markdown || payload.article?.markdown || payload.markdown || '');
            if (!md.trim()) {
                return `<p class="report-lead-fallback">${escapeHtml(getReadableSummary(item, payload))}</p>`;
            }
            const render = window.AiArticleMarkdown && typeof window.AiArticleMarkdown.renderArticleMarkdown === 'function'
                ? window.AiArticleMarkdown.renderArticleMarkdown
                : null;
            if (render) {
                return render(md);
            }
            return `<pre class="report-plain-fallback">${escapeHtml(md)}</pre>`;
        }

        /** 结构化条目合并为一区，默认折叠，需要时展开 */
        function buildStructuredAppendix(item, payload = {}) {
            if (isGenbiReport(item, payload)) {
                return renderGenbiAppendix(item, payload);
            }
            const crowds = item.high_spend_crowds || payload.highSpendCrowds || [];
            const actions = item.actions || payload.actions || [];
            const issues = item.highlights || payload.issues || [];
            const finance = item.finance_adjustment || payload.financeAdjustment || {};
            const sessions = item.live_session_insight?.sessions || payload.liveSessionInsight?.sessions || [];
            const blocks = [];

            if (crowds.length) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">高消耗人群</h4>${crowds.map(renderHighSpend).join('')}</div>`);
            }
            if (actions.length) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">执行动作</h4>${actions.map(renderAction).join('')}</div>`);
            }
            if (issues.length) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">风险与问题</h4>${issues.map(renderIssue).join('')}</div>`);
            }
            const financeHtml = renderFinance(finance);
            if (financeHtml && financeHtml.trim()) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">财务与利润</h4>${financeHtml}</div>`);
            }
            if (sessions.length) {
                blocks.push(`<div class="appendix-block"><h4 class="appendix-h">重点场次</h4>${sessions.map(renderSession).join('')}</div>`);
            }

            if (!blocks.length) {
                return '<p class="appendix-empty">暂无结构化参考数据，可主要阅读上文正文。</p>';
            }
            return blocks.join('');
        }

        function setViewMode(mode) {
            const listView = document.getElementById('list-view');
            const detailView = document.getElementById('detail-view');

            if (mode === 'detail') {
                listView.style.display = 'none';
                detailView.style.display = 'block';
            } else {
                listView.style.display = 'block';
                detailView.style.display = 'none';
            }
        }
