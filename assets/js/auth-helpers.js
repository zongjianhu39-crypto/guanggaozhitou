// Shared frontend auth helpers
function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const resolvedId = user.open_id || user.user_id || user.union_id || user.sub || user.email;
  if (!resolvedId) return null;
  return Object.assign({}, user, { open_id: String(resolvedId) });
}

function getStoredUser() {
  try {
    const parsed = JSON.parse(localStorage.getItem('feishu_user') || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const resolvedId = parsed.open_id || parsed.user_id || parsed.union_id || parsed.sub || parsed.email;
    if (!resolvedId) return null;
    if (!parsed.open_id) parsed.open_id = String(resolvedId);
    return parsed;
  } catch {
    return null;
  }
}

function getPromptAdminTokenExpiresAt() {
  const raw = localStorage.getItem('prompt_admin_expires_at') || '';
  if (!raw) return 0;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 9999999999 ? Math.floor(numeric / 1000) : numeric;
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed / 1000);
  }

  return 0;
}

function isPromptAdminTokenExpired() {
  const expiresAt = getPromptAdminTokenExpiresAt();
  return Boolean(expiresAt) && expiresAt <= Math.floor(Date.now() / 1000);
}

function getPromptAdminToken() {
  const token = localStorage.getItem('prompt_admin_token') || '';
  if (!token) return '';

  if (isPromptAdminTokenExpired()) {
    localStorage.removeItem('prompt_admin_token');
    localStorage.removeItem('prompt_admin_expires_at');
    return '';
  }

  return token;
}

function clearPromptAdminSession(reason = '') {
  localStorage.removeItem('prompt_admin_token');
  localStorage.removeItem('prompt_admin_expires_at');
  if (reason) {
    localStorage.setItem('prompt_admin_reason', reason);
  } else {
    localStorage.removeItem('prompt_admin_reason');
  }
}

function rememberRedirect(targetUrl) {
  const normalized = normalizeRedirectTarget(targetUrl);
  if (!normalized) return;
  localStorage.setItem('feishu_redirect', normalized);
}

function normalizeRedirectTarget(targetUrl) {
  if (!targetUrl) return '';

  try {
    const baseOrigin = window.location.origin;
    const resolved = new URL(String(targetUrl), baseOrigin);
    if (resolved.origin !== baseOrigin) {
      return '';
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return '';
  }
}

function getSafeRedirectUrl(targetUrl, fallbackPath = '/index.html') {
  const normalizedTarget = normalizeRedirectTarget(targetUrl);
  const normalizedFallback = normalizeRedirectTarget(fallbackPath) || '/index.html';
  return window.location.origin + (normalizedTarget || normalizedFallback);
}

function extractAccessToken(rawValue) {
  if (!rawValue) return '';

  try {
    const parsed = JSON.parse(rawValue);
    return parsed?.currentSession?.access_token || parsed?.session?.access_token || parsed?.access_token || '';
  } catch {
    return '';
  }
}

function getSupabaseConfig() {
  const config = (typeof window !== 'undefined' && window.CONFIG && typeof window.CONFIG === 'object')
    ? window.CONFIG
    : {};

  return {
    url: String(config.SB_URL || ''),
    anonKey: String(config.SUPABASE_ANON_KEY || ''),
    publishableKey: String(config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_REST_KEY || ''),
  };
}

function getSupabaseUrl() {
  return getSupabaseConfig().url;
}

function getSupabaseAnonKey() {
  return getSupabaseConfig().anonKey;
}

function getSupabasePublishableKey() {
  return getSupabaseConfig().publishableKey;
}

function getSupabaseSessionAccessToken() {
  const storages = [localStorage, sessionStorage];

  for (const storage of storages) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) || '';
      if (!key || (!key.startsWith('sb-') && !key.includes('auth-token') && !key.includes('supabase'))) {
        continue;
      }

      const token = extractAccessToken(storage.getItem(key));
      if (token) {
        return token;
      }
    }
  }

  return '';
}

function getSupabaseFunctionHeaders(options = {}) {
  const anonKey = String(options.anonKey || getSupabaseAnonKey());
  const useSessionToken = options.useSessionToken !== false;
  const includePromptAdminToken = options.includePromptAdminToken !== false;
  const headers = {};

  if (anonKey) {
    headers.apikey = anonKey;
  }

  const promptAdminToken = includePromptAdminToken ? getPromptAdminToken() : '';
  // Edge Functions use our prompt-admin token for app auth. Keep Authorization on the
  // anon key in that path, otherwise Supabase's gateway can reject unrelated session JWTs
  // before the request reaches the function.
  const sessionToken = useSessionToken && !promptAdminToken ? getSupabaseSessionAccessToken() : '';
  const bearerToken = sessionToken || anonKey;
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  if (promptAdminToken) {
    headers['x-prompt-admin-token'] = promptAdminToken;
  }

  return headers;
}

function getSupabaseRestHeaders(options = {}) {
  const apiKey = String(options.apiKey || getSupabasePublishableKey() || getSupabaseAnonKey());
  const useSessionToken = options.useSessionToken === true;
  const sessionToken = useSessionToken ? getSupabaseSessionAccessToken() : '';
  const headers = {};

  if (apiKey) {
    headers.apikey = apiKey;
  }
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  return headers;
}

function getSupabasePublicFunctionHeaders(options = {}) {
  const anonKey = String(options.anonKey || getSupabaseAnonKey());
  const headers = {};

  if (anonKey) {
    headers.apikey = anonKey;
    headers.Authorization = `Bearer ${anonKey}`;
  }

  return headers;
}

function buildFunctionUrl(name, query = {}) {
  const baseUrl = getSupabaseUrl();
  if (!baseUrl || !name) {
    return '';
  }

  const url = new URL(`${baseUrl}/functions/v1/${name}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || value === 'all') {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function requiresBackendSession(pathname) {
  return pathname === '/prompt-admin.html'
    || pathname === '/genbi-rule-admin.html'
    || pathname === '/plan-dashboard.html';
}

function clearUserSession() {
  localStorage.removeItem('feishu_user');
  localStorage.removeItem('feishu_redirect');
  localStorage.removeItem('oauth_state');
  sessionStorage.removeItem('feishu_user');
  sessionStorage.removeItem('feishu_redirect');
  sessionStorage.removeItem('oauth_state');
  document.cookie = 'feishu_user=; path=/; max-age=0';
}

function clearAuthSession(options = {}) {
  clearUserSession();

  if (options.clearPromptAdmin !== false) {
    clearPromptAdminSession(options.reason || '');
  }
}

function getSessionState(pathname = window.location.pathname) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const user = getStoredUser();
  const sessionToken = getSupabaseSessionAccessToken();
  const promptAdminToken = getPromptAdminToken();
  const backendSession = Boolean(sessionToken || promptAdminToken);
  const requiresBackend = requiresBackendSession(normalizedPath);

  return {
    path: normalizedPath,
    user,
    sessionToken,
    promptAdminToken,
    backendSession,
    requiresBackend,
    isAuthenticated: Boolean(user && (!requiresBackend || backendSession)),
  };
}

function redirectToLogin(options = {}) {
  const targetUrl = options.targetUrl || (window.location.pathname + window.location.search + window.location.hash);
  const redirectTarget = normalizeRedirectTarget(targetUrl) || '/index.html';
  const force = options.force === true;
  const clearPromptAdmin = options.clearPromptAdmin !== false;
  const reason = options.reason || '';
  const delayMs = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 0;

  rememberRedirect(redirectTarget);

  if (clearPromptAdmin) {
    clearPromptAdminSession(reason);
  }

  const loginUrl = `auth/index.html${force ? '?force=1' : ''}`;
  if (delayMs > 0) {
    window.setTimeout(() => {
      window.location.replace(loginUrl);
    }, delayMs);
    return;
  }
  window.location.replace(loginUrl);
}

function logout() {
  clearAuthSession({ clearPromptAdmin: true });
  redirectToLogin({
    targetUrl: '/index.html',
    clearPromptAdmin: false,
  });
}

function handleReauthRequired(options = {}) {
  const source = String(options.source || 'default');
  const lockKey = `__reauth_redirect__${source}`;
  if (window[lockKey]) {
    return true;
  }
  window[lockKey] = true;

  const message = String(options.message || '').trim();
  if (typeof options.onMessage === 'function' && message) {
    options.onMessage(message);
  }
  if (typeof options.onBeforeRedirect === 'function') {
    options.onBeforeRedirect();
  }

  redirectToLogin({
    targetUrl: options.targetUrl || window.location.href,
    force: options.force !== false,
    reason: options.reason || 'reauth_required',
    delayMs: Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 1200,
    clearPromptAdmin: options.clearPromptAdmin !== false,
  });
  return true;
}


function classifyFetchError(error) {
  const rawMessage = String(error?.message || error || '').trim();

  if (!rawMessage) {
    return { type: 'error', badge: '请求异常', summary: '请求失败，请稍后重试。', detail: '' };
  }
  if (/CONFIG_MISSING|Missing CONFIG|缺少运行时配置/i.test(rawMessage)) {
    return { type: 'error', badge: '配置缺失', summary: '前端配置不完整，当前页面无法请求数据。', detail: rawMessage };
  }
  if (/Invalid API key|Invalid Token or Protected Header formatting|Missing authorization header/i.test(rawMessage)) {
    return { type: 'error', badge: '配置错误', summary: 'Supabase 凭证无效或请求头格式不正确，当前数据源不可用。', detail: rawMessage };
  }
  if (/登录状态已失效|未登录|invalid token|Missing Authorization|无效或已过期|权限已过期/i.test(rawMessage)) {
    return { type: 'warn', badge: '权限失效', summary: '当前登录态或授权已失效，需要重新登录后再试。', detail: rawMessage };
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(rawMessage)) {
    return { type: 'error', badge: '网络异常', summary: '请求没有成功发出或响应被浏览器拦截，请检查网络或跨域配置。', detail: rawMessage };
  }
  if (/HTTP 50[024]|502|503|504|Bad gateway|网关|数据源请求异常|数据源暂时不可用/i.test(rawMessage)) {
    return { type: 'error', badge: '数据源暂时不可用', summary: '底层数据接口暂时异常，系统已做重试；请稍后刷新或重新查询。', detail: rawMessage };
  }
  if (/无法解析的响应|Unexpected token/i.test(rawMessage)) {
    return { type: 'error', badge: '响应异常', summary: '接口返回格式不符合预期，当前结果无法解析。', detail: rawMessage };
  }

  return { type: 'error', badge: '请求失败', summary: rawMessage, detail: '' };
}

function describeFetchError(error, fallbackSummary) {
  const classified = classifyFetchError(error);
  return {
    type: classified.type,
    badge: classified.badge,
    summary: classified.summary || fallbackSummary || '请求失败，请稍后重试。',
    detail: classified.detail || '',
    message: `${classified.badge}：${classified.summary || fallbackSummary || '请求失败，请稍后重试。'}`,
  };
}

async function fetchJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const fetchOptions = {
    method,
    headers: options.headers || {},
  };

  if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  if (options.signal) {
    fetchOptions.signal = options.signal;
  }

  if (options.cache) {
    fetchOptions.cache = options.cache;
  }

  const response = await fetch(url, fetchOptions);
  const rawText = await response.text();
  let data = {};

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    if (typeof options.onParseError === 'function') {
      options.onParseError({ response, rawText });
    }
    throw new Error(options.parseErrorMessage || `接口返回了无法解析的响应（HTTP ${response.status}）`);
  }

  const errorMessage = String(data.error || '').trim();
  const unauthorizedPattern = options.unauthorizedPattern;
  const isUnauthorized = response.status === 401
    || (unauthorizedPattern instanceof RegExp && unauthorizedPattern.test(errorMessage));

  if (isUnauthorized) {
    if (typeof options.onUnauthorized === 'function') {
      options.onUnauthorized({ response, data, rawText, errorMessage });
    }
    throw new Error(options.unauthorizedMessage || errorMessage || '登录状态已失效，请重新登录');
  }

  if (!response.ok || errorMessage) {
    throw new Error(errorMessage || `请求失败 (${response.status})`);
  }

  return {
    response,
    data,
    rawText,
  };
}

async function fetchFunctionJson(name, options = {}) {
  const url = buildFunctionUrl(name, options.query || {});
  if (!url) {
    throw new Error('CONFIG_MISSING_SUPABASE_URL');
  }

  const baseHeaders = options.publicAuth
    ? getSupabasePublicFunctionHeaders({ anonKey: options.anonKey })
    : getSupabaseFunctionHeaders({
        anonKey: options.anonKey,
        useSessionToken: options.useSessionToken,
        includePromptAdminToken: options.includePromptAdminToken,
      });

  const headers = Object.assign({}, baseHeaders, options.headers || {});

  return fetchJson(url, {
    method: options.method,
    headers,
    body: options.body,
    signal: options.signal,
    cache: options.cache,
    parseErrorMessage: options.parseErrorMessage,
    unauthorizedPattern: options.unauthorizedPattern,
    unauthorizedMessage: options.unauthorizedMessage,
    onUnauthorized: options.onUnauthorized,
    onParseError: options.onParseError,
  });
}

window.authHelpers = window.authHelpers || {};
window.authHelpers.normalizeUser = normalizeUser;
window.authHelpers.getStoredUser = getStoredUser;
window.authHelpers.getPromptAdminTokenExpiresAt = getPromptAdminTokenExpiresAt;
window.authHelpers.isPromptAdminTokenExpired = isPromptAdminTokenExpired;
window.authHelpers.getPromptAdminToken = getPromptAdminToken;
window.authHelpers.clearPromptAdminSession = clearPromptAdminSession;
window.authHelpers.rememberRedirect = rememberRedirect;
window.authHelpers.normalizeRedirectTarget = normalizeRedirectTarget;
window.authHelpers.getSafeRedirectUrl = getSafeRedirectUrl;
window.authHelpers.extractAccessToken = extractAccessToken;
window.authHelpers.getSupabaseConfig = getSupabaseConfig;
window.authHelpers.getSupabaseUrl = getSupabaseUrl;
window.authHelpers.getSupabaseAnonKey = getSupabaseAnonKey;
window.authHelpers.getSupabasePublishableKey = getSupabasePublishableKey;
window.authHelpers.getSupabaseSessionAccessToken = getSupabaseSessionAccessToken;
window.authHelpers.getSupabaseFunctionHeaders = getSupabaseFunctionHeaders;
window.authHelpers.getSupabaseRestHeaders = getSupabaseRestHeaders;
window.authHelpers.getSupabasePublicFunctionHeaders = getSupabasePublicFunctionHeaders;
window.authHelpers.buildFunctionUrl = buildFunctionUrl;
window.authHelpers.requiresBackendSession = requiresBackendSession;
window.authHelpers.clearUserSession = clearUserSession;
window.authHelpers.clearAuthSession = clearAuthSession;
window.authHelpers.getSessionState = getSessionState;
window.authHelpers.redirectToLogin = redirectToLogin;
window.authHelpers.logout = logout;
window.authHelpers.handleReauthRequired = handleReauthRequired;
window.authHelpers.classifyFetchError = classifyFetchError;
window.authHelpers.describeFetchError = describeFetchError;
window.authHelpers.fetchJson = fetchJson;
window.authHelpers.fetchFunctionJson = fetchFunctionJson;
window.logout = logout;
