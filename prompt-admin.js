/**
 * prompt-admin.js  — 简洁 5 分类 Prompt 编辑器
 * 依赖：assets/js/config.js 提供 window.CONFIG
 * 依赖：auth.js 提供 getStoredUser()
 */

// ── 配置 ──────────────────────────────────────────────────────────────────
const authHelpers = window.authHelpers || {};
const SB_URL  = authHelpers.getSupabaseUrl ? authHelpers.getSupabaseUrl() : ((typeof CONFIG !== 'undefined' && CONFIG.SB_URL) ? CONFIG.SB_URL : '');

const CATEGORIES = {
  memory:   { name: '长期记忆',     desc: 'AI 助手的长期记忆与背景知识，包含品牌、产品、历史决策等持久信息。' },
  soul:     { name: '灵魂',         desc: 'AI 助手的核心人格设定、价值观与行为准则，决定 AI 的基础性格。' },
  skills:   { name: '技能',         desc: 'AI 助手的专项技能指令，如写作风格、分析框架、特定任务的执行规范。' },
  daily:    { name: '数据分析',     desc: '数据看板日报 AI 分析模板，面向运营快速复盘与次日动作建议。' },
  single:   { name: '单品广告分析', desc: '单品广告看板 AI 分析模板，面向商品维度效率复盘与投放动作建议。' },
  ops:      { name: '运营业务',     desc: '运营团队编辑的业务需求文档，描述当前阶段的运营目标、策略与执行要点。' },
  redlines: { name: '业务红线',     desc: '明确列出 AI 绝对不能做的事、不能输出的内容、不能触碰的边界，作为最高优先级约束。' },
};

// ── 状态 ──────────────────────────────────────────────────────────────────
let currentKey     = 'memory';  // 当前分类 key
let loadedContent  = '';        // 上次从服务器加载的内容（判断是否有改动用）
let latestDraftId  = '';        // 最新草稿 version_id（用于 publish）
let authRedirectScheduled = false;

const DRAFT_STORAGE_PREFIX = 'prompt_admin_draft_v2';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 草稿有效期 7 天
const DRAFT_CIPHER = { name: 'AES-GCM', length: 256 };

// ── Web Crypto 加密/解密 ──────────────────────────────────────────────────
async function getDraftCryptoKey() {
    const material = `prompt-draft:${window.location.origin}:${navigator.userAgent}`;
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(material));
    return crypto.subtle.importKey('raw', keyMaterial, DRAFT_CIPHER, false, ['encrypt', 'decrypt']);
}

async function encryptDraftContent(plaintext) {
    const key = await getDraftCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: DRAFT_CIPHER.name, iv }, key, encoded);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decryptDraftContent(b64) {
    try {
        const key = await getDraftCryptoKey();
        const combined = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const decrypted = await crypto.subtle.decrypt({ name: DRAFT_CIPHER.name, iv }, key, data);
        return new TextDecoder().decode(decrypted);
    } catch {
        return null;
    }
}

function getDraftStorageKey(templateKey = currentKey) {
    return `${DRAFT_STORAGE_PREFIX}:${templateKey}`;
}

async function readLocalDraft(templateKey = currentKey) {
    try {
        const raw = localStorage.getItem(getDraftStorageKey(templateKey));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.content !== 'string') return null;

        // 过期清理
        if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
            clearLocalDraft(templateKey);
            return null;
        }

        // 兼容旧版明文草稿（无 encrypted 标记）
        if (parsed.encrypted) {
            const decrypted = await decryptDraftContent(parsed.content);
            if (decrypted === null) return null;
            return { content: decrypted, savedAt: parsed.savedAt };
        }
        // 旧版明文 → 迁移为加密格式
        const encrypted = await encryptDraftContent(parsed.content);
        localStorage.setItem(getDraftStorageKey(templateKey), JSON.stringify({
            content: encrypted,
            savedAt: parsed.savedAt,
            encrypted: true,
        }));
        return { content: parsed.content, savedAt: parsed.savedAt };
    } catch {
        return null;
    }
}

async function saveLocalDraft(templateKey = currentKey, content = '') {
    try {
        const encrypted = await encryptDraftContent(content);
        localStorage.setItem(getDraftStorageKey(templateKey), JSON.stringify({
            content: encrypted,
            savedAt: Date.now(),
            encrypted: true,
        }));
    } catch (error) {
        console.warn('failed to persist prompt draft', error);
    }
}

function clearLocalDraft(templateKey = currentKey) {
    localStorage.removeItem(getDraftStorageKey(templateKey));
}

async function syncCurrentDraft() {
    const editor = document.getElementById('prompt-editor');
    if (!editor) return;
    const value = editor.value || '';
    if (!value.trim() || value === loadedContent) {
        clearLocalDraft(currentKey);
        return;
    }
    await saveLocalDraft(currentKey, value);
}

async function maybeRestoreDraft(templateKey, serverContent) {
    const draft = await readLocalDraft(templateKey);
    if (!draft || typeof draft.content !== 'string') {
        return serverContent;
    }
    const draftContent = draft.content;
    if (!draftContent.trim() || draftContent === serverContent) {
        clearLocalDraft(templateKey);
        return serverContent;
    }
    const shouldRestore = window.confirm('检测到该分类有未发布的本地草稿，是否恢复继续编辑？');
    if (!shouldRestore) {
        clearLocalDraft(templateKey);
        return serverContent;
    }
    setStatus('已恢复本地草稿，尚未发布。', 'warn');
    return draftContent;
}

function getRequestedTemplateKey() {
    const templateKey = new URLSearchParams(window.location.search).get('template_key') || '';
    return Object.prototype.hasOwnProperty.call(CATEGORIES, templateKey) ? templateKey : 'memory';
}

// ── 工具函数 ─────────────────────────────────────────────────────────────
function getAdminToken() {
    return authHelpers.getPromptAdminToken ? authHelpers.getPromptAdminToken() : (localStorage.getItem('prompt_admin_token') || '');
}

function getAdminTokenExpiresAt() {
    return authHelpers.getPromptAdminTokenExpiresAt ? authHelpers.getPromptAdminTokenExpiresAt() : 0;
}

function isAdminTokenExpired() {
    return authHelpers.isPromptAdminTokenExpired ? authHelpers.isPromptAdminTokenExpired() : false;
}

function rememberPromptAdminRedirect() {
    const currentUrl = window.location.origin + window.location.pathname + window.location.search + window.location.hash;
    if (authHelpers.rememberRedirect) {
        authHelpers.rememberRedirect(currentUrl);
    } else {
        localStorage.setItem('feishu_redirect', currentUrl);
    }
}

function clearPromptAdminSession(reason = '') {
    if (authHelpers.clearPromptAdminSession) {
        authHelpers.clearPromptAdminSession(reason);
    } else {
        localStorage.removeItem('prompt_admin_token');
        localStorage.removeItem('prompt_admin_expires_at');
        if (reason) {
            localStorage.setItem('prompt_admin_reason', reason);
        } else {
            localStorage.removeItem('prompt_admin_reason');
        }
    }
}

function getPromptAdminReasonMessage() {
    const reason = localStorage.getItem('prompt_admin_reason') || '';
    if (reason === 'prompt_admin_not_allowed') {
        return '当前飞书账号没有 Prompt 管理权限，请联系管理员加入白名单。';
    }
    if (reason === 'prompt_admin_signing_secret_missing') {
        return 'Prompt 管理服务端配置缺失，请联系管理员检查环境变量。';
    }
    if (reason === 'prompt_admin_token_missing') {
        return '当前账号登录成功，但没有拿到 Prompt 管理令牌，请重新授权一次。';
    }
    return '';
}

function redirectToPromptAdminLogin(message) {
    if (authRedirectScheduled) return;
    authRedirectScheduled = true;
    showError(message || 'Prompt 管理权限已失效，正在跳转重新登录。');
    setStatus('权限已失效，正在跳转登录…', 'bad');
    if (typeof authHelpers.handleReauthRequired === 'function') {
        authHelpers.handleReauthRequired({
            source: 'prompt-admin',
            targetUrl: window.location.href,
            force: true,
            reason: 'prompt_admin_reauth_required',
            delayMs: 1200,
        });
        return;
    }
    clearPromptAdminSession('prompt_admin_reauth_required');
    rememberPromptAdminRedirect();
    setTimeout(() => window.location.replace('auth/index.html?force=1'), 1200);
}

function showToast(msg) {
    const el = document.getElementById('page-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function setStatus(msg, kind = '') {
    const el = document.getElementById('save-status');
    el.textContent = msg;
    el.className = 'pa-status' + (kind ? ` ${kind}` : '');
}

function showError(msg) {
    const el = document.getElementById('err-banner');
    el.textContent = msg;
    el.classList.add('show');
}

function hideError() {
    const el = document.getElementById('err-banner');
    el.classList.remove('show');
}

function setEditorLoading(loading) {
    document.getElementById('editor-loading').style.display  = loading ? '' : 'none';
    document.getElementById('prompt-editor').style.display   = loading ? 'none' : '';
    document.getElementById('save-btn').disabled             = loading;
}

function formatDateTime(iso) {
    if (!iso) return '--';
    return new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

// ── API 调用 ──────────────────────────────────────────────────────────────
async function apiRequest(method, body = null, params = '') {
    const token = getAdminToken();
    if (!token || isAdminTokenExpired()) {
        redirectToPromptAdminLogin(token ? 'Prompt 管理权限已过期，正在跳转重新登录。' : '未检测到 Prompt 管理权限，正在跳转授权登录。');
        throw new Error('Prompt 管理权限已失效，请重新登录');
    }

    const query = params ? Object.fromEntries(new URLSearchParams(params).entries()) : {};
    const { data } = await authHelpers.fetchFunctionJson('ai-prompt-admin', {
        method,
        query,
        headers: { 'Content-Type': 'application/json' },
        body,
        useSessionToken: false,
        includePromptAdminToken: true,
        unauthorizedPattern: /无效或已过期/,
        unauthorizedMessage: 'Prompt 管理权限已过期，请重新登录',
        onUnauthorized: () => {
            redirectToPromptAdminLogin('Prompt 管理权限已过期，正在跳转重新登录。');
        },
    });
    if (!data.success) throw new Error(data.error || '请求失败');
    return data;
}

// ── 加载分类内容 ──────────────────────────────────────────────────────────
async function loadCategory(key) {
    setEditorLoading(true);
    setStatus('');
    hideError();

    try {
        const data = await apiRequest('GET', null, `template_key=${key}`);

        // 身份
        if (data.editor_identity) {
            const name = data.editor_identity.name || data.editor_identity.email || '';
            document.getElementById('identity-chip').textContent = name ? `编辑身份：${name}` : '';
        }

        // 内容：优先取已发布版本，其次用草稿
        const content = data.published_version?.content ?? data.drafts?.[0]?.content ?? '';
        loadedContent = content;
        latestDraftId = '';

        document.getElementById('prompt-editor').value = await maybeRestoreDraft(key, content);

        // 版本元数据
        const pv = data.published_version;
        if (pv) {
            const versionLabel = document.createElement('strong');
            versionLabel.textContent = pv.version_label || pv.id?.slice(0,8) || '';
            const metaEl = document.getElementById('version-meta');
            metaEl.textContent = '';
            metaEl.append('线上版本：', versionLabel, `\u00a0\u00a0更新于 ${formatDateTime(pv.published_at || pv.created_at)}`);
        } else {
            document.getElementById('version-meta').textContent = '暂无已发布版本';
        }

        setEditorLoading(false);
    } catch (err) {
        setEditorLoading(false);
        if (!authRedirectScheduled) {
            const errorState = authHelpers.describeFetchError
                ? authHelpers.describeFetchError(err, 'Prompt 内容加载失败，请稍后重试。')
                : { message: `加载失败：${err.message}`, badge: '加载失败' };
            showError(errorState.message);
            setStatus(errorState.badge || '加载失败', 'bad');
        }
    }
}

// ── 切换分类 ──────────────────────────────────────────────────────────────
async function switchTab(btn) {
    // 检查未保存改动
    const editor = document.getElementById('prompt-editor');
    if (editor.value !== loadedContent) {
        await syncCurrentDraft();
        if (!confirm('当前有未保存的修改，已自动暂存到本地草稿。切换分类后继续？')) return;
    }

    // 高亮
    document.querySelectorAll('.pa-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    const key = btn.dataset.key;
    currentKey = key;

    // 更新标题和描述
    const cat = CATEGORIES[key] || {};
    document.getElementById('cat-title').textContent = cat.name || key;
    document.getElementById('cat-desc').textContent  = cat.desc || '';

    loadCategory(key);
}

// ── 保存并发布 ────────────────────────────────────────────────────────────
async function saveAndPublish() {
    const btn     = document.getElementById('save-btn');
    const content = document.getElementById('prompt-editor').value.trim();
    if (!content) { showToast('内容不能为空'); return; }

    // 输入验证
    if (content.length > 5000) {
        showToast(`内容过长（${content.length} 字符），最大允许 5000 字符`);
        return;
    }
    if (/<\s*script|javascript\s*:|on\w+\s*=/i.test(content)) {
        showToast('内容包含潜在的不安全字符，请修改后保存');
        return;
    }

    btn.disabled = true;
    setStatus('保存中…', 'warn');

    try {
        // 1. 保存草稿
        const draftData = await apiRequest('POST', {
            action:        'save_draft',
            template_key:  currentKey,
            content,
            change_note:   '运营直接保存',
        });
        const versionId = draftData.version?.id;
        if (!versionId) throw new Error('保存草稿成功但未返回 version_id');

        // 2. 立即发布
        const pubData = await apiRequest('POST', {
            action:       'publish_version',
            template_key: currentKey,
            version_id:   versionId,
        });

        loadedContent = content;
        latestDraftId = '';
        clearLocalDraft(currentKey);

        // 更新版本元数据
        const pv = pubData.published_version;
        if (pv) {
            const versionLabel = document.createElement('strong');
            versionLabel.textContent = pv.version_label || pv.id?.slice(0,8) || '';
            const metaEl = document.getElementById('version-meta');
            metaEl.textContent = '';
            metaEl.append('线上版本：', versionLabel, `\u00a0\u00a0更新于 ${formatDateTime(pv.published_at || pv.created_at)}`);
        }

        setStatus('已保存并发布 ✓', 'good');
        showToast(`「${CATEGORIES[currentKey]?.name || currentKey}」已保存并发布`);
    } catch (err) {
        const errorState = authHelpers.describeFetchError
            ? authHelpers.describeFetchError(err, 'Prompt 保存失败，请稍后重试。')
            : { message: `保存失败：${err.message}` };
        setStatus(errorState.message, 'bad');
        showToast(errorState.message);
    } finally {
        btn.disabled = false;
    }
}

function bindPromptAdminInteractions() {
    document.querySelectorAll('[data-action="logout"]').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            if (window.authHelpers && window.authHelpers.logout) {
                window.authHelpers.logout();
            } else {
                window.location.replace('auth/index.html');
            }
        });
    });

    document.querySelectorAll('.pa-tab').forEach((button) => {
        button.addEventListener('click', () => {
            switchTab(button);
        });
    });

    const saveButton = document.getElementById('save-btn');
    if (saveButton) {
        saveButton.addEventListener('click', saveAndPublish);
    }

    const editor = document.getElementById('prompt-editor');
    if (editor) {
        editor.addEventListener('input', () => {
            syncCurrentDraft(); // fire-and-forget, encryption is fast enough
            if (editor.value !== loadedContent) {
                setStatus('有未发布的本地修改', 'warn');
            }
        });
    }

    window.addEventListener('beforeunload', (event) => {
        const currentValue = editor?.value || '';
        if (currentValue !== loadedContent) {
            syncCurrentDraft(); // fire-and-forget
            event.preventDefault();
            event.returnValue = '';
        }
    });
}

// ── 初始化 ────────────────────────────────────────────────────────────────
(function init() {
    bindPromptAdminInteractions();

    currentKey = getRequestedTemplateKey();

    if (!SB_URL) {
        showError('缺少运行时配置 (config.js)，请联系管理员。');
        return;
    }

    const token = getAdminToken();
    if (!token || isAdminTokenExpired()) {
        const reasonMessage = getPromptAdminReasonMessage();
        if (reasonMessage.includes('没有 Prompt 管理权限') || reasonMessage.includes('服务端配置缺失')) {
            clearPromptAdminSession(localStorage.getItem('prompt_admin_reason') || '');
            showError(reasonMessage);
            setStatus('无法加载', 'bad');
            return;
        }

        redirectToPromptAdminLogin(reasonMessage || (token
            ? 'Prompt 管理权限已过期，正在跳转重新登录。'
            : '未检测到 Prompt 管理权限，正在跳转授权登录。'));
        return;
    }

    // 初始加载第一个分类（长期记忆）
    document.querySelectorAll('.pa-tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.key === currentKey);
    });
    const cat = CATEGORIES[currentKey];
    document.getElementById('cat-title').textContent = cat.name;
    document.getElementById('cat-desc').textContent  = cat.desc;
    loadCategory(currentKey);
})();
