/**
 * 将 AI 常见 Markdown 转为安全 HTML（子集），供看板弹窗、洞察中心等阅读用。
 * 支持：标题、列表、粗体、行内代码、引用、分隔线、**管道表格**（| a | b |）
 * 依赖：无。暴露 window.AiArticleMarkdown
 */
(function initAiArticleMarkdown(global) {
    'use strict';

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function inlineMd(s) {
        let e = escapeHtml(s);
        e = e.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        e = e.replace(/`([^`]+)`/g, '<code>$1</code>');
        return e;
    }

    /** 解析 | a | b | 行为单元格数组（不含两侧空） */
    function parsePipeRow(trimmed) {
        if (!trimmed || !trimmed.includes('|')) return null;
        let s = trimmed.trim();
        if (s.startsWith('|')) s = s.slice(1);
        if (s.endsWith('|')) s = s.slice(0, -1);
        const cells = s.split('|').map((c) => c.trim());
        return cells.length >= 2 ? cells : null;
    }

    /** Markdown 表格分隔行 |---|:---:| */
    function isPipeTableDelimiter(trimmed) {
        if (!trimmed || !trimmed.includes('|')) return false;
        const cells = parsePipeRow(trimmed);
        if (!cells) return false;
        return cells.every((p) => /^[\s:-]+$/.test(p) && /-/.test(p));
    }

    function isPipeTableRow(trimmed) {
        if (!trimmed || !trimmed.includes('|')) return false;
        if (isPipeTableDelimiter(trimmed)) return false;
        return Boolean(parsePipeRow(trimmed));
    }

    function normalizeTableRows(header, body) {
        const colCount = header.length;
        const pad = (row) => {
            const r = row.slice();
            while (r.length < colCount) r.push('');
            if (r.length > colCount) return r.slice(0, colCount);
            return r;
        };
        return {
            header,
            body: body.map(pad),
        };
    }

    function buildTableHtml(header, body) {
        const { header: h, body: b } = normalizeTableRows(header, body);
        const ths = h.map((c) => `<th scope="col">${inlineMd(c)}</th>`).join('');
        const trs = b.map((row) => `<tr>${row.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('');
        return `<div class="article-md-table-wrap"><table class="ai-analysis-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
    }

    function renderArticleMarkdown(raw) {
        if (!raw || !String(raw).trim()) {
            return '<p class="ai-analysis-empty" style="color:#86868b">暂无内容</p>';
        }
        const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
        const out = [];
        let inUl = false;
        let inOl = false;
        const para = [];

        function flushPara() {
            if (!para.length) return;
            const body = para.map((line) => inlineMd(line)).join('<br>');
            out.push(`<p>${body}</p>`);
            para.length = 0;
        }

        function closeLists() {
            if (inUl) {
                out.push('</ul>');
                inUl = false;
            }
            if (inOl) {
                out.push('</ol>');
                inOl = false;
            }
        }

        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const t = line.trim();
            if (!t) {
                closeLists();
                flushPara();
                i += 1;
                continue;
            }

            if (/^[-*_]{3,}$/.test(t)) {
                closeLists();
                flushPara();
                out.push('<hr class="ai-analysis-hr">');
                i += 1;
                continue;
            }

            const h = t.match(/^(#{1,6})\s+(.+)$/);
            if (h) {
                closeLists();
                flushPara();
                const n = Math.min(h[1].length, 6);
                out.push(`<h${n} class="ai-analysis-h${n}">${inlineMd(h[2])}</h${n}>`);
                i += 1;
                continue;
            }

            if (t.startsWith('>')) {
                closeLists();
                flushPara();
                const q = t.replace(/^>\s?/, '');
                out.push(`<blockquote class="ai-analysis-quote">${inlineMd(q)}</blockquote>`);
                i += 1;
                continue;
            }

            const ul = t.match(/^[-*]\s+(.+)$/);
            if (ul) {
                if (inOl) {
                    out.push('</ol>');
                    inOl = false;
                }
                if (!inUl) {
                    out.push('<ul class="ai-analysis-ul">');
                    inUl = true;
                }
                flushPara();
                out.push(`<li>${inlineMd(ul[1])}</li>`);
                i += 1;
                continue;
            }

            const ol = t.match(/^(\d+)[.、]\s*(.+)$/);
            if (ol) {
                if (inUl) {
                    out.push('</ul>');
                    inUl = false;
                }
                if (!inOl) {
                    out.push('<ol class="ai-analysis-ol">');
                    inOl = true;
                }
                flushPara();
                out.push(`<li>${inlineMd(ol[2])}</li>`);
                i += 1;
                continue;
            }

            const nextTrim = i + 1 < lines.length ? lines[i + 1].trim() : '';
            if (isPipeTableRow(t) && isPipeTableDelimiter(nextTrim)) {
                closeLists();
                flushPara();
                const header = parsePipeRow(t);
                if (!header) {
                    para.push(t);
                    i += 1;
                    continue;
                }
                i += 2;
                const body = [];
                while (i < lines.length) {
                    const ln = lines[i].trim();
                    if (!ln) {
                        i += 1;
                        break;
                    }
                    if (!isPipeTableRow(ln)) break;
                    const row = parsePipeRow(ln);
                    if (row) body.push(row);
                    i += 1;
                }
                out.push(buildTableHtml(header, body));
                continue;
            }

            closeLists();
            para.push(t);
            i += 1;
        }
        closeLists();
        flushPara();
        return out.join('\n') || '<p class="ai-analysis-empty" style="color:#86868b">暂无内容</p>';
    }

    global.AiArticleMarkdown = {
        escapeHtml,
        renderArticleMarkdown,
    };
}(typeof window !== 'undefined' ? window : globalThis));
