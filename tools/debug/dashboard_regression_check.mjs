#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

let SB_URL = '';
let SB_KEY = '';
const SNAPSHOT_SCHEMA_VERSION = '2026-04-04.2';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.DASHBOARD_SMOKE_TIMEOUT_MS || '20000', 10);
const RETRY_DELAYS_MS = [0, 250, 800];

if (typeof fetch !== 'function') {
    console.error('当前 Node.js 不支持全局 fetch。请使用 Node 18+ 运行。');
    process.exit(1);
}

async function resolveSupabaseConfig() {
    const configPath = path.resolve(process.cwd(), 'assets/js/config.js');
    const frontendConfig = await readFrontendSupabaseConfig(configPath);

    const envUrl = firstPresent([
        ['SUPABASE_URL', process.env.SUPABASE_URL],
        ['SB_URL', process.env.SB_URL],
    ]);
    const envKey = firstPresent([
        ['SUPABASE_ANON_KEY', process.env.SUPABASE_ANON_KEY],
        ['SB_KEY', process.env.SB_KEY],
        ['SUPABASE_PUBLISHABLE_KEY', process.env.SUPABASE_PUBLISHABLE_KEY],
        ['SUPABASE_REST_KEY', process.env.SUPABASE_REST_KEY],
    ]);

    let urlEntry = null;
    let keyEntry = null;
    let ignoredPartialEnv = null;
    if (envUrl && envKey) {
        urlEntry = envUrl;
        keyEntry = envKey;
    } else if (frontendConfig.url && frontendConfig.key) {
        urlEntry = frontendConfig.url;
        keyEntry = frontendConfig.key;
        if (envUrl || envKey) {
            ignoredPartialEnv = [
                envUrl ? envUrl.source : 'missing URL env',
                envKey ? envKey.source : 'missing key env',
            ].join(' + ');
        }
    } else {
        urlEntry = envUrl || frontendConfig.url;
        keyEntry = envKey || frontendConfig.key;
    }

    if (!urlEntry || !keyEntry) {
        throw new Error([
            '缺少 Supabase 配置，Dashboard smoke 无法连接远端数据源。',
            `URL 来源: ${urlEntry ? urlEntry.source : 'missing'}`,
            `key 来源: ${keyEntry ? keyEntry.source : 'missing'}`,
            envUrl || envKey ? `检测到不完整环境变量配置: ${[
                envUrl ? envUrl.source : 'missing SUPABASE_URL/SB_URL',
                envKey ? envKey.source : 'missing SUPABASE_ANON_KEY/SB_KEY/SUPABASE_PUBLISHABLE_KEY',
            ].join(' + ')}` : '',
            '请成对设置 SUPABASE_URL + SUPABASE_ANON_KEY，或确保 assets/js/config.js 中存在 SB_URL + SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY。',
        ].join('\n'));
    }

    const url = normalizeSupabaseUrl(urlEntry.value, urlEntry.source);
    const key = normalizeSupabaseKey(keyEntry.value, keyEntry.source);
    validateSupabaseProjectMatch(url, key, { urlSource: urlEntry.source, keySource: keyEntry.source });

    return {
        key,
        url,
        keySource: keyEntry.source,
        urlSource: urlEntry.source,
        configPath,
        ignoredPartialEnv,
    };
}

async function readFrontendSupabaseConfig(configPath) {
    let raw = '';
    try {
        raw = await readFile(configPath, 'utf8');
    } catch (error) {
        return { url: null, key: null, error };
    }

    const url = firstPresent([
        [`${configPath}:CONFIG.SB_URL`, extractConfigString(raw, 'SB_URL')],
        [`${configPath}:CONFIG.SUPABASE_URL`, extractConfigString(raw, 'SUPABASE_URL')],
    ]);
    const key = firstPresent([
        [`${configPath}:CONFIG.SUPABASE_ANON_KEY`, extractConfigString(raw, 'SUPABASE_ANON_KEY')],
        [`${configPath}:CONFIG.SUPABASE_PUBLISHABLE_KEY`, extractConfigString(raw, 'SUPABASE_PUBLISHABLE_KEY')],
        [`${configPath}:CONFIG.SUPABASE_REST_KEY`, extractConfigString(raw, 'SUPABASE_REST_KEY')],
    ]);
    return { url, key };
}

function extractConfigString(raw, fieldName) {
    const match = raw.match(new RegExp(`${fieldName}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
    return match?.[2]?.trim() || '';
}

function firstPresent(entries) {
    for (const [source, value] of entries) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (normalized) {
            return { source, value: normalized };
        }
    }
    return null;
}

function normalizeSupabaseUrl(value, source) {
    const trimmed = String(value || '').trim().replace(/\/$/, '');
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`Supabase URL 无效: 来源=${source}, value=${trimmed || 'empty'}`);
    }

    if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error(`Supabase URL 协议无效: 来源=${source}, protocol=${parsed.protocol || 'missing'}`);
    }
    if (!parsed.hostname) {
        throw new Error(`Supabase URL 缺少 hostname: 来源=${source}`);
    }
    return parsed.origin;
}

function normalizeSupabaseKey(value, source) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        throw new Error(`Supabase key 为空: 来源=${source}`);
    }
    if (/placeholder|your[-_ ]?key|replace/i.test(trimmed)) {
        throw new Error(`Supabase key 看起来仍是占位符: 来源=${source}`);
    }
    return trimmed;
}

function validateSupabaseProjectMatch(url, key, sources) {
    const payload = decodeJwtPayload(key);
    if (!payload?.ref) {
        return;
    }
    let host = '';
    try {
        host = new URL(url).hostname;
    } catch {
        return;
    }
    const projectRef = host.endsWith('.supabase.co') ? host.slice(0, -'.supabase.co'.length) : '';
    if (projectRef && projectRef !== payload.ref) {
        throw new Error([
            'Supabase URL 与 JWT key 不属于同一个项目。',
            `URL project ref: ${projectRef} (${sources.urlSource})`,
            `key project ref: ${payload.ref} (${sources.keySource})`,
            '请成对设置 SUPABASE_URL + SUPABASE_ANON_KEY，或清理错误的单个 SUPABASE_URL/SB_URL 环境变量。',
        ].join('\n'));
    }
}

function hashSecret(value) {
    return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 10);
}

function decodeJwtPayload(token) {
    const [, payload] = String(token || '').split('.');
    if (!payload) {
        return null;
    }
    try {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch {
        return null;
    }
}

function formatUnixDate(timestamp) {
    if (!Number.isFinite(timestamp)) {
        return 'unknown';
    }
    return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function describeSupabaseKey(key) {
    const value = String(key || '');
    const fingerprint = hashSecret(value);
    if (value.startsWith('sb_publishable_')) {
        return `publishable(length=${value.length}, sha256=${fingerprint})`;
    }

    const payload = decodeJwtPayload(value);
    if (payload) {
        return `jwt(role=${payload.role || 'unknown'}, ref=${payload.ref || 'unknown'}, exp=${formatUnixDate(payload.exp)}, length=${value.length}, sha256=${fingerprint})`;
    }

    return `unknown-format(length=${value.length}, sha256=${fingerprint})`;
}

function printRequestPlan(config, tableGroups) {
    const tables = tableGroups.flatMap((group) => group.map(({ table }) => table));
    console.error('[dashboard-smoke] 远端请求配置');
    console.error(`- base URL: ${config.url} (${config.urlSource})`);
    console.error(`- key: ${describeSupabaseKey(config.key)} (${config.keySource})`);
    if (config.ignoredPartialEnv) {
        console.error(`- ignored partial env config: ${config.ignoredPartialEnv}`);
    }
    console.error('- headers: apikey=<same key>, Authorization=Bearer <same key>');
    console.error(`- timeout/retry: ${REQUEST_TIMEOUT_MS}ms, attempts=${RETRY_DELAYS_MS.length}`);
    console.error(`- target tables: ${tables.join(', ') || 'none'}`);
}

function parseArgs(argv) {
    const parsed = {
        output: '',
        compare: '',
        months: null,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) {
            continue;
        }
        const [rawKey, inlineValue] = arg.split('=', 2);
        const key = rawKey.slice(2);
        const nextValue = inlineValue ?? argv[index + 1];

        switch (key) {
            case 'start':
                parsed.start = nextValue;
                if (inlineValue === undefined) index += 1;
                break;
            case 'end':
                parsed.end = nextValue;
                if (inlineValue === undefined) index += 1;
                break;
            case 'output':
                parsed.output = nextValue;
                if (inlineValue === undefined) index += 1;
                break;
            case 'compare':
                parsed.compare = nextValue;
                if (inlineValue === undefined) index += 1;
                break;
            case 'months':
                parsed.months = nextValue.split(',').map((value) => value.trim()).filter(Boolean);
                if (inlineValue === undefined) index += 1;
                break;
            case 'help':
                parsed.help = true;
                break;
            default:
                throw new Error(`未知参数: --${key}`);
        }
    }

    return parsed;
}

function printHelp() {
    console.log([
        '用法:',
        '  node tools/debug/dashboard_regression_check.mjs --start 2026-03-01 --end 2026-03-31',
        '  node tools/debug/dashboard_regression_check.mjs --start 2026-03-01 --end 2026-03-31 --output /tmp/dashboard-baseline.json',
        '  node tools/debug/dashboard_regression_check.mjs --start 2026-03-01 --end 2026-03-31 --compare /tmp/dashboard-baseline.json',
        '',
        '可选参数:',
        '  --months super_live_202601,super_live_202602（可选；不传时按日期自动选择新表名）',
        '  --output 输出快照 JSON 文件',
        '  --compare 与既有快照做比对，发现差异时返回非 0',
        '',
        `当前快照版本: ${SNAPSHOT_SCHEMA_VERSION}`,
    ].join('\n'));
}

function toNum(value) {
    return Number.parseFloat(value) || 0;
}

function parseDate(value) {
    if (!value) {
        return null;
    }
    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }
    if (normalized.includes('/')) {
        const [year, month, day] = normalized.split('/');
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return normalized;
}

function enumerateDateRange(startDate, endDate) {
    const dates = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    while (cursor <= end) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

function groupDatesByTable(dates, getTable) {
    const tableDates = new Map();
    dates.forEach((date) => {
        const table = getTable(date);
        const existing = tableDates.get(table) || [];
        existing.push(date);
        tableDates.set(table, existing);
    });
    return [...tableDates.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([table, tableDateList]) => ({ table, dates: tableDateList }));
}

function getAnnualTablesForDateRange(prefix, startDate, endDate) {
    return groupDatesByTable(enumerateDateRange(startDate, endDate), (date) => `${prefix}_${date.slice(0, 4)}`);
}

function getSuperLiveTablesForDateRange(startDate, endDate) {
    return groupDatesByTable(enumerateDateRange(startDate, endDate), (date) => {
        if (date.startsWith('2025-')) {
            return 'super_live_2025';
        }
        return `super_live_${date.slice(0, 7).replace('-', '')}`;
    });
}

async function sbQueryRoutedTables(routedTables, dateField) {
    const results = [];
    for (const { table, dates } of routedTables) {
        if (!dates.length) continue;
        console.log(`加载 ${table}...`);
        const rows = await sbQuery(table);
        results.push(...rows.filter((row) => {
            const date = parseDate(row[dateField]);
            return date && date >= dates[0] && date <= dates[dates.length - 1];
        }));
    }
    return results;
}

function getWeekStr(dateString) {
    if (!dateString) {
        return '';
    }

    const normalized = String(dateString).trim();
    let year;
    let month;
    let day;

    if (normalized.includes('/')) {
        [year, month, day] = normalized.split('/');
    } else {
        [year, month, day] = normalized.split('-');
    }

    const date = new Date(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10));
    const jan4 = new Date(date.getFullYear(), 0, 4);
    const weekNum = Math.ceil(((date - jan4) / 86400000 + jan4.getDay() + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function classifyCrowd(name) {
    if (!name) return '未知';
    const normalized = String(name).trim();
    if (normalized === '智能推荐人群' || normalized.startsWith('智能竞争直播间:')) return '纯黑盒';
    if (normalized.startsWith('自定义竞争宝贝:')) return '灰盒_竞争宝贝';
    if (normalized.startsWith('自定义竞争店铺:')) return '灰盒_竞争店铺';
    if (normalized.startsWith('自定义竞争直播间:')) return '灰盒_竞争直播间';
    if (['复购老客', '未通知到人群', '购买人群', '活跃成交', '活跃复购'].some((keyword) => normalized.includes(keyword))) return '老客';
    if (
        normalized.startsWith('粉丝人群:') ||
        normalized.startsWith('喜欢我的直播:') ||
        normalized.startsWith('喜欢我的短视频:') ||
        ['加购人群', '兴趣新客', '访问新客', '浏览'].some((keyword) => normalized.includes(keyword))
    ) {
        return '兴趣新客';
    }
    if (['首购新客', '差老客', '付定人群', '流失', '竞店人群'].some((keyword) => normalized.includes(keyword))) return '新客';
    if (normalized.startsWith('精选人群:') || normalized.startsWith('达摩盘人群:')) {
        if (['活跃复购', '活跃成交', '活跃下降', '即将流失', '差直播间老客', '差老客', '购买人群'].some((keyword) => normalized.includes(keyword))) return '老客';
        if (['加购人群', '兴趣新客', '访问新客', '浏览'].some((keyword) => normalized.includes(keyword))) return '兴趣新客';
        if (['首购新客', '未购', '流失', '竞店人群', '付定人群'].some((keyword) => normalized.includes(keyword))) return '新客';
        if (['宠物清洁', '直播低退', '达人带货品牌'].some((keyword) => normalized.includes(keyword))) return '灰盒_竞争宝贝';
        return '灰盒';
    }
    if (normalized.includes('活跃')) return '新客';
    return '未知';
}

function calcGroup(row) {
    const cost = toNum(row['花费']);
    const amount = toNum(row['总成交金额']);
    const orders = toNum(row['总成交笔数']);
    const views = toNum(row['观看次数']);
    const shows = toNum(row['展现量']);
    const directAmount = toNum(row['直接成交金额']);
    const cart = toNum(row['总购物车数']);
    const preOrders = toNum(row['总预售成交笔数']);
    const interactions = toNum(row['互动量']);

    return {
        cost,
        amount,
        orders,
        views,
        shows,
        directAmount,
        cart,
        preOrders,
        interactions,
        roi: cost > 0 ? amount / cost : 0,
        directRoi: cost > 0 ? directAmount / cost : 0,
        viewCost: views > 0 ? cost / views : 0,
        orderCost: orders > 0 ? cost / orders : 0,
        cartCost: cart > 0 ? cost / cart : 0,
        preOrderCost: preOrders > 0 ? cost / preOrders : 0,
        viewConvertRate: views > 0 ? (orders / views) * 100 : 0,
        deepInteractRate: views > 0 ? (interactions / views) * 100 : 0,
        viewRate: shows > 0 ? (views / shows) * 100 : 0,
        cpm: shows > 0 ? (cost / shows) * 1000 : 0,
    };
}

function buildFinByDate(financialData) {
    const result = {};
    financialData.forEach((row) => {
        const date = parseDate(row['日期']);
        if (date) {
            result[date] = row;
        }
    });
    return result;
}

function buildLiveByDate(taobaoData) {
    const result = {};
    taobaoData.forEach((row) => {
        const date = parseDate(row['日期']);
        if (!date) {
            return;
        }
        if (!result[date]) {
            result[date] = [];
        }
        result[date].push(row);
    });
    return result;
}

function computeFinAndLiveAgg(dates, finByDate, liveByDate) {
    let finNet = 0;
    let taobaoOrders = 0;
    let taobaoSales = 0;
    let taobaoRefunds = 0;

    dates.forEach((date) => {
        const finRecord = finByDate[date];
        if (finRecord) {
            finNet +=
                toNum(finRecord['保量佣金']) +
                toNum(finRecord['预估结算线下佣金']) +
                toNum(finRecord['预估结算机构佣金']) -
                toNum(finRecord['直播间红包']) -
                toNum(finRecord['严选红包']);
        }

        const sessions = liveByDate[date] || [];
        sessions.forEach((row) => {
            taobaoOrders += toNum(row['成交笔数']);
            taobaoSales += toNum(row['成交金额']);
            taobaoRefunds += toNum(row['退款金额']);
        });
    });

    return {
        finNet,
        taobaoOrders,
        taobaoSales,
        taobaoRefunds,
        returnRate: taobaoSales > 0 ? taobaoRefunds / taobaoSales : 0,
    };
}

async function sbQuery(table, params = '') {
    const batchSize = 1000;
    let headQuery = 'select=*';

    if (params) {
        const segments = params.split('&');
        for (const segment of segments) {
            if (segment.startsWith('limit=') || segment.startsWith('offset=')) continue;
            const equalIndex = segment.indexOf('=');
            if (equalIndex > 0) {
                const key = segment.slice(0, equalIndex);
                const value = segment.slice(equalIndex + 1);
                headQuery += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
            }
        }
    }

    const headUrl = `${SB_URL}/rest/v1/${table}?${headQuery}`;
    const headResponse = await fetchWithRetry(headUrl, {
        method: 'HEAD',
        headers: {
            apikey: SB_KEY,
            Authorization: `Bearer ${SB_KEY}`,
            Prefer: 'count=exact',
        },
    }, {
        table,
        phase: 'HEAD count',
    });

    await assertResponseOk(headResponse, { table, phase: 'HEAD count', url: headUrl });

    const contentRange = headResponse.headers.get('content-range') || '';
    const totalMatch = contentRange.match(/\/(\d+)$/);
    const total = totalMatch ? Number.parseInt(totalMatch[1], 10) : batchSize;
    const urls = [];

    for (let offset = 0; offset < total; offset += batchSize) {
        let query = `select=*&limit=${batchSize}&offset=${offset}`;
        if (params) {
            const segments = params.split('&');
            for (const segment of segments) {
                if (segment.startsWith('limit=') || segment.startsWith('offset=')) continue;
                const equalIndex = segment.indexOf('=');
                if (equalIndex > 0) {
                    const key = segment.slice(0, equalIndex);
                    const value = segment.slice(equalIndex + 1);
                    query += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
                }
            }
        }
        urls.push(`${SB_URL}/rest/v1/${table}?${query}`);
    }

    const allRows = [];
    for (let index = 0; index < urls.length; index += 5) {
        const batch = urls.slice(index, index + 5);
        const batchResults = await Promise.all(
            batch.map(async (url) => {
                const response = await fetchWithRetry(url, {
                    headers: {
                        apikey: SB_KEY,
                        Authorization: `Bearer ${SB_KEY}`,
                    },
                }, {
                    table,
                    phase: `GET rows batch ${index / 5 + 1}`,
                });
                await assertResponseOk(response, { table, phase: 'GET rows', url });
                return response.json();
            })
        );
        batchResults.forEach((rows) => allRows.push(...rows));
    }

    return allRows;
}


async function fetchWithRetry(url, options = {}, context = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        try {
            const response = await fetchWithTimeout(url, options);
            if (isRetryableHttpStatus(response.status) && attempt < RETRY_DELAYS_MS.length - 1) {
                await response.body?.cancel?.();
                lastError = new Error(`${getRequestMethod(options)} ${context.table || url} 返回可重试 HTTP ${response.status}`);
                continue;
            }
            return response;
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(formatFetchFailure(lastError, { ...context, url, method: getRequestMethod(options) }));
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, {
            ...options,
            signal: options.signal || controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

function getRequestMethod(options = {}) {
    return String(options.method || 'GET').toUpperCase();
}

function isRetryableHttpStatus(status) {
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function assertResponseOk(response, context) {
    if (response.ok) {
        return;
    }
    const preview = await readResponsePreview(response);
    throw new Error(formatHttpFailure(response, context, preview));
}

async function readResponsePreview(response) {
    if (response.bodyUsed) {
        return '';
    }
    try {
        const text = await response.clone().text();
        return text.replace(/\s+/g, ' ').slice(0, 500);
    } catch {
        return '';
    }
}

function formatHttpFailure(response, context = {}, preview = '') {
    const statusHint = classifyHttpStatus(response.status);
    return [
        `Dashboard smoke 远端 HTTP 请求失败: ${statusHint}`,
        `table: ${context.table || 'unknown'}`,
        `phase: ${context.phase || 'request'}`,
        `url: ${context.url || response.url || 'unknown'}`,
        `content-type: ${response.headers.get('content-type') || 'unknown'}`,
        preview ? `response preview: ${preview}` : '',
    ].filter(Boolean).join('\n');
}

function classifyHttpStatus(status) {
    if (status === 401) {
        return '401 Unauthorized，通常是 SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY 无效、过期，或 Authorization header 不被接受';
    }
    if (status === 403) {
        return '403 Forbidden，通常是表权限/RLS/API 权限不足';
    }
    if (status === 404) {
        return '404 Not Found，通常是 Supabase URL/project ref 错误，或目标表名不存在/未暴露到 REST API';
    }
    if (status === 408) {
        return '408 Request Timeout，远端请求超时';
    }
    if (status === 429) {
        return '429 Rate Limited，远端限流';
    }
    if (status >= 500 && status <= 599) {
        return `${status} Server Error，Supabase/PostgREST/Cloudflare 侧临时失败`;
    }
    return `${status} ${responseStatusLabel(status)}`;
}

function responseStatusLabel(status) {
    if (status >= 400 && status < 500) {
        return 'Client Error';
    }
    if (status >= 300 && status < 400) {
        return 'Redirect';
    }
    return 'HTTP Error';
}

function formatFetchFailure(error, context = {}) {
    const diagnosis = classifyFetchException(error);
    return [
        `Dashboard smoke 远端请求失败: ${diagnosis.kind}`,
        `table: ${context.table || 'unknown'}`,
        `phase: ${context.phase || 'request'}`,
        `method: ${context.method || 'GET'}`,
        `url: ${context.url || 'unknown'}`,
        `detail: ${diagnosis.detail}`,
        diagnosis.causes.length ? `causes: ${diagnosis.causes.join(' <- ')}` : '',
    ].filter(Boolean).join('\n');
}

function classifyFetchException(error) {
    const entries = collectErrorEntries(error);
    const codes = entries.map((entry) => entry.code).filter(Boolean);
    const combined = entries
        .flatMap((entry) => [entry.name, entry.code, entry.message])
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (/failed to parse url|invalid url/.test(combined)) {
        return buildFetchDiagnosis('fetch 初始化失败（URL 无效）', entries);
    }
    if (/abort|timeout|timedout|und_err_connect_timeout|etimedout/.test(combined) || codes.includes('ETIMEDOUT')) {
        return buildFetchDiagnosis(`timeout（超过 ${REQUEST_TIMEOUT_MS}ms）`, entries);
    }
    if (/enotfound|getaddrinfo|eai_again/.test(combined) || codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
        return buildFetchDiagnosis('DNS 解析失败', entries);
    }
    if (/cert|certificate|tls|ssl|unable_to_verify|err_tls/.test(combined)) {
        return buildFetchDiagnosis('TLS/证书握手失败', entries);
    }
    if (/econnrefused|connection refused/.test(combined) || codes.includes('ECONNREFUSED')) {
        return buildFetchDiagnosis('网络连接被拒绝', entries);
    }
    if (/econnreset|socket|epipe|network socket disconnected|und_err_socket/.test(combined)) {
        return buildFetchDiagnosis('网络连接中断', entries);
    }
    if (/fetch failed/.test(combined)) {
        return buildFetchDiagnosis('网络请求失败（Node fetch/undici）', entries);
    }
    if (/typeerror/.test(combined)) {
        return buildFetchDiagnosis('fetch 初始化失败', entries);
    }
    return buildFetchDiagnosis('未知网络错误', entries);
}

function collectErrorEntries(error, seen = new Set()) {
    if (!error || seen.has(error)) {
        return [];
    }
    seen.add(error);

    const entry = {
        name: error.name || '',
        code: error.code || '',
        message: error.message || String(error),
    };
    const nested = [];
    if (error.cause) {
        nested.push(...collectErrorEntries(error.cause, seen));
    }
    if (Array.isArray(error.errors)) {
        error.errors.forEach((inner) => nested.push(...collectErrorEntries(inner, seen)));
    }
    return [entry, ...nested];
}

function buildFetchDiagnosis(kind, entries) {
    const causes = entries
        .map((entry) => [entry.name, entry.code, entry.message].filter(Boolean).join(':'))
        .filter(Boolean)
        .slice(0, 6);
    return {
        kind,
        detail: entries[0]?.message || 'network error',
        causes,
    };
}

function aggregateDaily(filtered, finByDate, liveByDate) {
    const dailyMap = {};

    filtered.forEach((row) => {
        const date = parseDate(row['日期']);
        if (!date) {
            return;
        }
        if (!dailyMap[date]) {
            dailyMap[date] = {
                cost: 0,
                amount: 0,
                orders: 0,
                views: 0,
                shows: 0,
                directAmount: 0,
                cart: 0,
                fav: 0,
                preOrders: 0,
                interactions: 0,
                finGuarantee: 0,
                finOffline: 0,
                finAgency: 0,
                finRedPacket: 0,
                finYanxuanRed: 0,
                taobaoOrders: 0,
                taobaoRefund: 0,
                taobaoAmount: 0,
            };
        }

        const target = dailyMap[date];
        target.cost += toNum(row['花费']);
        target.amount += toNum(row['总成交金额']);
        target.orders += toNum(row['总成交笔数']);
        target.views += toNum(row['观看次数']);
        target.shows += toNum(row['展现量']);
        target.directAmount += toNum(row['直接成交金额']);
        target.cart += toNum(row['总购物车数']);
        target.fav += toNum(row['总收藏数']);
        target.preOrders += toNum(row['总预售成交笔数']);
        target.interactions += toNum(row['互动量']);
    });

    Object.keys(dailyMap).forEach((date) => {
        const target = dailyMap[date];
        const finRecord = finByDate[date];
        if (finRecord) {
            target.finGuarantee += toNum(finRecord['保量佣金']);
            target.finOffline += toNum(finRecord['预估结算线下佣金']);
            target.finAgency += toNum(finRecord['预估结算机构佣金']);
            target.finRedPacket += toNum(finRecord['直播间红包']);
            target.finYanxuanRed += toNum(finRecord['严选红包']);
        }
        const liveRecords = liveByDate[date] || [];
        liveRecords.forEach((row) => {
            target.taobaoOrders += toNum(row['成交笔数']);
            target.taobaoRefund += toNum(row['退款金额']);
            target.taobaoAmount += toNum(row['成交金额']);
        });
    });

    return dailyMap;
}

function rollupByPeriod(filtered, finByDate, liveByDate, keyBuilder) {
    const result = {};
    filtered.forEach((row) => {
        const date = parseDate(row['日期']);
        if (!date) {
            return;
        }
        const key = keyBuilder(date);
        if (!result[key]) {
            result[key] = {
                cost: 0,
                amount: 0,
                orders: 0,
                views: 0,
                shows: 0,
                directAmount: 0,
                cart: 0,
                fav: 0,
                preOrders: 0,
                interactions: 0,
                dates: new Set(),
                finGuarantee: 0,
                finOffline: 0,
                finAgency: 0,
                finRedPacket: 0,
                finYanxuanRed: 0,
                taobaoOrders: 0,
                taobaoRefund: 0,
                taobaoAmount: 0,
            };
        }

        const target = result[key];
        target.cost += toNum(row['花费']);
        target.amount += toNum(row['总成交金额']);
        target.orders += toNum(row['总成交笔数']);
        target.views += toNum(row['观看次数']);
        target.shows += toNum(row['展现量']);
        target.directAmount += toNum(row['直接成交金额']);
        target.cart += toNum(row['总购物车数']);
        target.fav += toNum(row['总收藏数']);
        target.preOrders += toNum(row['总预售成交笔数']);
        target.interactions += toNum(row['互动量']);
        target.dates.add(date);
    });

    Object.keys(result).forEach((key) => {
        const target = result[key];
        target.dates.forEach((date) => {
            const finRecord = finByDate[date];
            if (finRecord) {
                target.finGuarantee += toNum(finRecord['保量佣金']);
                target.finOffline += toNum(finRecord['预估结算线下佣金']);
                target.finAgency += toNum(finRecord['预估结算机构佣金']);
                target.finRedPacket += toNum(finRecord['直播间红包']);
                target.finYanxuanRed += toNum(finRecord['严选红包']);
            }
            const liveRecords = liveByDate[date] || [];
            liveRecords.forEach((row) => {
                target.taobaoOrders += toNum(row['成交笔数']);
                target.taobaoRefund += toNum(row['退款金额']);
                target.taobaoAmount += toNum(row['成交金额']);
            });
        });
    });

    return result;
}

function enrichAggregate(label, aggregate, dates, finByDate, liveByDate) {
    const group = calcGroup({
        '花费': aggregate.cost,
        '总成交金额': aggregate.amount,
        '总成交笔数': aggregate.orders,
        '观看次数': aggregate.views,
        '展现量': aggregate.shows,
        '直接成交金额': aggregate.directAmount,
        '总购物车数': aggregate.cart,
        '总预售成交笔数': aggregate.preOrders,
        '互动量': aggregate.interactions,
    });
    const computed = computeFinAndLiveAgg(dates, finByDate, liveByDate);
    const breakevenRoi = aggregate.cost > 0 && computed.finNet > 0 && computed.taobaoOrders > 0
        ? (computed.finNet * aggregate.orders / computed.taobaoOrders) / aggregate.cost
        : 0;
    const returnRoi = aggregate.cost > 0 ? (aggregate.amount * (1 - computed.returnRate)) / aggregate.cost : 0;
    const adShare = computed.taobaoOrders > 0 ? aggregate.orders / computed.taobaoOrders : 0;

    return {
        label,
        ...group,
        finGuarantee: aggregate.finGuarantee,
        finOffline: aggregate.finOffline,
        finAgency: aggregate.finAgency,
        finRedPacket: aggregate.finRedPacket,
        finYanxuanRed: aggregate.finYanxuanRed,
        taobaoOrders: aggregate.taobaoOrders,
        taobaoRefund: aggregate.taobaoRefund,
        taobaoAmount: aggregate.taobaoAmount,
        taobaoReturnRate: aggregate.taobaoAmount > 0 ? aggregate.taobaoRefund / aggregate.taobaoAmount : 0,
        breakevenRoi,
        returnRoi,
        adShare,
    };
}

function aggregateCrowd(filtered) {
    const crowdMap = {};
    const subCrowdMap = {};

    filtered.forEach((row) => {
        const crowd = classifyCrowd(row['人群名字']);
        const subName = row['人群名字'] || '未知';
        if (!crowdMap[crowd]) {
            crowdMap[crowd] = { cost: 0, amount: 0, orders: 0, views: 0, shows: 0, directAmount: 0, cart: 0, preOrders: 0, interactions: 0 };
        }
        if (!subCrowdMap[crowd]) {
            subCrowdMap[crowd] = {};
        }
        if (!subCrowdMap[crowd][subName]) {
            subCrowdMap[crowd][subName] = { cost: 0, amount: 0, orders: 0, views: 0, shows: 0, directAmount: 0, cart: 0, preOrders: 0, interactions: 0 };
        }

        const targets = [crowdMap[crowd], subCrowdMap[crowd][subName]];
        targets.forEach((target) => {
            target.cost += toNum(row['花费']);
            target.amount += toNum(row['总成交金额']);
            target.orders += toNum(row['总成交笔数']);
            target.views += toNum(row['观看次数']);
            target.shows += toNum(row['展现量']);
            target.directAmount += toNum(row['直接成交金额']);
            target.cart += toNum(row['总购物车数']);
            target.preOrders += toNum(row['总预售成交笔数']);
            target.interactions += toNum(row['互动量']);
        });
    });

    const crowdRows = Object.keys(crowdMap)
        .sort((left, right) => crowdMap[right].cost - crowdMap[left].cost)
        .map((crowd) => {
            const aggregate = crowdMap[crowd];
            const subRows = Object.keys(subCrowdMap[crowd] || {})
                .sort((left, right) => subCrowdMap[crowd][right].cost - subCrowdMap[crowd][left].cost)
                .map((name) => ({ label: name, ...calcGroup({
                    '花费': subCrowdMap[crowd][name].cost,
                    '总成交金额': subCrowdMap[crowd][name].amount,
                    '总成交笔数': subCrowdMap[crowd][name].orders,
                    '观看次数': subCrowdMap[crowd][name].views,
                    '展现量': subCrowdMap[crowd][name].shows,
                    '直接成交金额': subCrowdMap[crowd][name].directAmount,
                    '总购物车数': subCrowdMap[crowd][name].cart,
                    '总预售成交笔数': subCrowdMap[crowd][name].preOrders,
                    '互动量': subCrowdMap[crowd][name].interactions,
                }) }));

            return {
                label: crowd,
                ...calcGroup({
                    '花费': aggregate.cost,
                    '总成交金额': aggregate.amount,
                    '总成交笔数': aggregate.orders,
                    '观看次数': aggregate.views,
                    '展现量': aggregate.shows,
                    '直接成交金额': aggregate.directAmount,
                    '总购物车数': aggregate.cart,
                    '总预售成交笔数': aggregate.preOrders,
                    '互动量': aggregate.interactions,
                }),
                subRows,
            };
        });

    return crowdRows;
}

function buildSnapshot(data, range) {
    const { financialData, taobaoData, superLiveData } = data;
    const finByDate = buildFinByDate(financialData);
    const liveByDate = buildLiveByDate(taobaoData);
    const filtered = superLiveData.filter((row) => {
        const date = parseDate(row['日期']);
        return date && date >= range.start && date <= range.end;
    });

    const totals = {
        totalCost: 0,
        totalAmount: 0,
        totalOrders: 0,
        totalViews: 0,
        totalShows: 0,
        totalDirectAmount: 0,
        totalCart: 0,
        totalFav: 0,
        totalPreOrders: 0,
        totalInteractions: 0,
    };

    filtered.forEach((row) => {
        totals.totalCost += toNum(row['花费']);
        totals.totalAmount += toNum(row['总成交金额']);
        totals.totalOrders += toNum(row['总成交笔数']);
        totals.totalViews += toNum(row['观看次数']);
        totals.totalShows += toNum(row['展现量']);
        totals.totalDirectAmount += toNum(row['直接成交金额']);
        totals.totalCart += toNum(row['总购物车数']);
        totals.totalFav += toNum(row['总收藏数']);
        totals.totalPreOrders += toNum(row['总预售成交笔数']);
        totals.totalInteractions += toNum(row['互动量']);
    });

    const allDates = [...new Set(filtered.map((row) => parseDate(row['日期'])).filter(Boolean))].sort();
    const totalFinAgg = computeFinAndLiveAgg(allDates, finByDate, liveByDate);

    let finGuarantee = 0;
    let finOffline = 0;
    let finAgency = 0;
    let finRedPacket = 0;
    let finYanxuanRed = 0;
    allDates.forEach((date) => {
        const row = finByDate[date];
        if (!row) return;
        finGuarantee += toNum(row['保量佣金']);
        finOffline += toNum(row['预估结算线下佣金']);
        finAgency += toNum(row['预估结算机构佣金']);
        finRedPacket += toNum(row['直播间红包']);
        finYanxuanRed += toNum(row['严选红包']);
    });

    const monthlyMap = rollupByPeriod(filtered, finByDate, liveByDate, (date) => date.slice(0, 7));
    const weeklyMap = rollupByPeriod(filtered, finByDate, liveByDate, getWeekStr);
    const dailyMap = aggregateDaily(filtered, finByDate, liveByDate);

    const snapshot = {
        snapshotVersion: SNAPSHOT_SCHEMA_VERSION,
        range,
        counts: {
            financial: financialData.length,
            taobaoLive: taobaoData.length,
            superLive: superLiveData.length,
            filteredSuperLive: filtered.length,
        },
        kpi: {
            totalCost: totals.totalCost,
            totalAmount: totals.totalAmount,
            totalOrders: totals.totalOrders,
            avgRoi: totals.totalCost > 0 ? totals.totalAmount / totals.totalCost : 0,
            avgDirectRoi: totals.totalCost > 0 ? totals.totalDirectAmount / totals.totalCost : 0,
            totalBreakevenRoi: totals.totalCost > 0 && totalFinAgg.finNet > 0 && totalFinAgg.taobaoOrders > 0
                ? (totalFinAgg.finNet * totals.totalOrders / totalFinAgg.taobaoOrders) / totals.totalCost
                : 0,
            totalReturnRoi: totals.totalCost > 0 ? (totals.totalAmount * (1 - totalFinAgg.returnRate)) / totals.totalCost : 0,
            totalAdShare: totalFinAgg.taobaoOrders > 0 ? totals.totalOrders / totalFinAgg.taobaoOrders : 0,
            avgViewCost: totals.totalViews > 0 ? totals.totalCost / totals.totalViews : 0,
            avgOrderCost: totals.totalOrders > 0 ? totals.totalCost / totals.totalOrders : 0,
            avgCartCost: totals.totalCart > 0 ? totals.totalCost / totals.totalCart : 0,
            avgPreOrderCost: totals.totalPreOrders > 0 ? totals.totalCost / totals.totalPreOrders : 0,
            avgViewConvertRate: totals.totalViews > 0 ? (totals.totalOrders / totals.totalViews) * 100 : 0,
            avgDeepInteractRate: totals.totalViews > 0 ? (totals.totalInteractions / totals.totalViews) * 100 : 0,
            avgViewRate: totals.totalShows > 0 ? (totals.totalViews / totals.totalShows) * 100 : 0,
            avgCpm: totals.totalShows > 0 ? (totals.totalCost / totals.totalShows) * 1000 : 0,
            totalShows: totals.totalShows,
            totalCart: totals.totalCart,
            totalDirectAmount: totals.totalDirectAmount,
            finGuarantee,
            finOffline,
            finAgency,
            finRedPacket,
            finYanxuanRed,
            totalTaobaoOrders: totalFinAgg.taobaoOrders,
            totalReturnRate: totalFinAgg.returnRate,
        },
        monthly: Object.keys(monthlyMap).sort().reverse().map((key) => enrichAggregate(key, monthlyMap[key], [...monthlyMap[key].dates], finByDate, liveByDate)),
        weekly: Object.keys(weeklyMap).sort().reverse().map((key) => enrichAggregate(key, weeklyMap[key], [...weeklyMap[key].dates], finByDate, liveByDate)),
        daily: Object.keys(dailyMap).sort().reverse().map((key) => enrichAggregate(key, dailyMap[key], [key], finByDate, liveByDate)),
        crowd: aggregateCrowd(filtered),
    };

    return snapshot;
}

function diffValues(current, baseline, path, diffs) {
    if (diffs.length >= 50) {
        return;
    }

    const currentType = Array.isArray(current) ? 'array' : typeof current;
    const baselineType = Array.isArray(baseline) ? 'array' : typeof baseline;

    if (currentType !== baselineType) {
        diffs.push(`${path}: 类型不同，当前=${currentType}，基线=${baselineType}`);
        return;
    }

    if (current == null || baseline == null) {
        if (current !== baseline) {
            diffs.push(`${path}: 当前=${String(current)}，基线=${String(baseline)}`);
        }
        return;
    }

    if (typeof current === 'number' && typeof baseline === 'number') {
        if (Math.abs(current - baseline) > 1e-9) {
            diffs.push(`${path}: 当前=${current}，基线=${baseline}`);
        }
        return;
    }

    if (typeof current !== 'object') {
        if (current !== baseline) {
            diffs.push(`${path}: 当前=${String(current)}，基线=${String(baseline)}`);
        }
        return;
    }

    if (Array.isArray(current)) {
        if (current.length !== baseline.length) {
            diffs.push(`${path}: 数组长度不同，当前=${current.length}，基线=${baseline.length}`);
            return;
        }
        for (let index = 0; index < current.length; index += 1) {
            diffValues(current[index], baseline[index], `${path}[${index}]`, diffs);
            if (diffs.length >= 50) return;
        }
        return;
    }

    const keys = [...new Set([...Object.keys(current), ...Object.keys(baseline)])].sort();
    keys.forEach((key) => {
        if (!(key in current)) {
            diffs.push(`${path}.${key}: 当前缺失该字段`);
            return;
        }
        if (!(key in baseline)) {
            diffs.push(`${path}.${key}: 基线缺失该字段`);
            return;
        }
        diffValues(current[key], baseline[key], `${path}.${key}`, diffs);
    });
}

async function main() {
    const fs = await import('node:fs/promises');
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    if (!args.start || !args.end) {
        throw new Error('必须提供 --start 和 --end，格式为 YYYY-MM-DD。');
    }

    const supabaseConfig = await resolveSupabaseConfig();
    SB_KEY = supabaseConfig.key;
    SB_URL = supabaseConfig.url;

    const financialTables = getAnnualTablesForDateRange('financial', args.start, args.end);
    const taobaoTables = getAnnualTablesForDateRange('taobao_live', args.start, args.end);
    const superLiveTables = Array.isArray(args.months)
        ? args.months.map((table) => ({ table, dates: [args.start, args.end] }))
        : getSuperLiveTablesForDateRange(args.start, args.end);

    printRequestPlan(supabaseConfig, [financialTables, taobaoTables, superLiveTables]);

    const financialData = await sbQueryRoutedTables(financialTables, '日期');
    const taobaoData = await sbQueryRoutedTables(taobaoTables, '日期');

    const superLiveData = [];
    for (const { table, dates } of superLiveTables) {
        console.log(`加载 ${table}...`);
        const start = dates[0] || args.start;
        const end = dates[dates.length - 1] || args.end;
        const dateField = '日期';
        const rows = await sbQuery(table);
        superLiveData.push(...rows
            .filter((row) => {
                const date = parseDate(row[dateField]);
                return date && date >= start && date <= end;
            })
            .map((row) => table === 'super_live_2025' ? { ...row, 日期: row.日期 || row.date } : row));
    }

    const snapshot = buildSnapshot({ financialData, taobaoData, superLiveData }, { start: args.start, end: args.end, months: args.months });

    if (args.output) {
        await fs.writeFile(args.output, JSON.stringify(snapshot, null, 2), 'utf8');
        console.log(`已写入快照: ${args.output}`);
    }

    if (args.compare) {
        const baseline = JSON.parse(await fs.readFile(args.compare, 'utf8'));
        const baselineVersion = baseline.snapshotVersion || 'unversioned';
        if (baselineVersion !== SNAPSHOT_SCHEMA_VERSION) {
            console.error(
                `快照版本不一致: 当前=${SNAPSHOT_SCHEMA_VERSION}，基线=${baselineVersion}。请先更新基线快照再做回归比对。`
            );
            process.exit(1);
        }
        const diffs = [];
        diffValues(snapshot, baseline, 'snapshot', diffs);
        if (diffs.length > 0) {
            console.error('发现回归差异:');
            diffs.forEach((diff) => console.error(`- ${diff}`));
            process.exitCode = 1;
        } else {
            console.log('比对通过: 当前结果与基线一致。');
        }
    }

    if (!args.output && !args.compare) {
        console.log(JSON.stringify(snapshot, null, 2));
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
