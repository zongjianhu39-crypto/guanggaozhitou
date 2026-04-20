import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule);

const email = process.env.SUPABASE_DASHBOARD_EMAIL;
const password = process.env.SUPABASE_DASHBOARD_PASSWORD;
const projectRef = process.env.SUPABASE_PROJECT_REF || 'qjscsikithbxuxmjyjsp';
const sqlQuery = process.env.SUPABASE_SQL_QUERY || 'select 1 as ok;';
const readOnly = process.env.SUPABASE_SQL_READ_ONLY !== 'false';
const headless = process.env.HEADLESS !== 'false';
const chromeUserDataDir = process.env.CHROME_USER_DATA_DIR || '';
const chromeProfileDir = process.env.CHROME_PROFILE_DIR || '';
const probeUrl = process.env.SUPABASE_PROBE_URL || '';
const probeNetwork = process.env.SUPABASE_PROBE_NETWORK === 'true';
const executeViaUi = process.env.SUPABASE_EXECUTE_VIA_UI === 'true';
const executeViaBrowserApi = process.env.SUPABASE_EXECUTE_VIA_BROWSER_API === 'true';
const sqlFilePath = process.env.SUPABASE_SQL_FILE || '';
const printSqlSplit = process.env.SUPABASE_PRINT_SQL_SPLIT === 'true';
const sqlStatementIndex = Number.parseInt(process.env.SUPABASE_SQL_STATEMENT_INDEX || '', 10);
const sqlStatementStart = Number.parseInt(process.env.SUPABASE_SQL_STATEMENT_START || '', 10);
const sqlStatementEnd = Number.parseInt(process.env.SUPABASE_SQL_STATEMENT_END || '', 10);
const uiStatementDelayMs = Number.parseInt(process.env.SUPABASE_UI_STATEMENT_DELAY_MS || '0', 10);

if ((!email || !password) && (!chromeUserDataDir || !chromeProfileDir)) {
  console.error('Missing dashboard credentials or Chrome profile settings');
  process.exit(2);
}

function extractAccessToken(rawValue) {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue);
    return (
      parsed?.currentSession?.access_token ||
      parsed?.session?.access_token ||
      parsed?.access_token ||
      null
    );
  } catch {
    return null;
  }
}

function formatRequestBody(request) {
  try {
    const data = request.postData();
    if (!data) return '';
    return data.length > 4000 ? `${data.slice(0, 4000)}...` : data;
  } catch {
    return '';
  }
}

function normalizeSql(sqlText) {
  return sqlText.replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

function getRequestSql(request) {
  try {
    const data = request.postData();
    if (!data) return '';
    const parsed = JSON.parse(data);
    return typeof parsed.query === 'string' ? parsed.query : '';
  } catch {
    return '';
  }
}

function isMatchingSqlResponse(response, expectedSql) {
  if (response.request().method() !== 'POST') {
    return false;
  }

  if (!response.url().includes(`/platform/pg-meta/${projectRef}/query`)) {
    return false;
  }

  const requestSql = normalizeSql(getRequestSql(response.request()));
  const normalizedExpectedSql = normalizeSql(expectedSql);

  return requestSql === normalizedExpectedSql || requestSql.startsWith(normalizedExpectedSql);
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let buffer = '';
  let index = 0;
  let state = 'normal';
  let dollarTag = null;

  while (index < sqlText.length) {
    const char = sqlText[index];
    const next = sqlText[index + 1] || '';

    if (state === 'line-comment') {
      buffer += char;
      index += 1;
      if (char === '\n') {
        state = 'normal';
      }
      continue;
    }

    if (state === 'block-comment') {
      buffer += char;
      if (char === '*' && next === '/') {
        buffer += next;
        index += 2;
        state = 'normal';
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'single-quote') {
      buffer += char;
      if (char === "'" && next === "'") {
        buffer += next;
        index += 2;
        continue;
      }
      index += 1;
      if (char === "'") {
        state = 'normal';
      }
      continue;
    }

    if (state === 'double-quote') {
      buffer += char;
      if (char === '"' && next === '"') {
        buffer += next;
        index += 2;
        continue;
      }
      index += 1;
      if (char === '"') {
        state = 'normal';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (dollarTag && sqlText.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
        state = 'normal';
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      buffer += '--';
      index += 2;
      state = 'line-comment';
      continue;
    }

    if (char === '/' && next === '*') {
      buffer += '/*';
      index += 2;
      state = 'block-comment';
      continue;
    }

    if (char === "'") {
      buffer += char;
      index += 1;
      state = 'single-quote';
      continue;
    }

    if (char === '"') {
      buffer += char;
      index += 1;
      state = 'double-quote';
      continue;
    }

    if (char === '$') {
      const rest = sqlText.slice(index);
      const match = rest.match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        buffer += dollarTag;
        index += dollarTag.length;
        state = 'dollar-quote';
        continue;
      }
    }

    if (char === ';') {
      const statement = buffer.trim();
      if (statement) {
        statements.push(statement);
      }
      buffer = '';
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  const tail = buffer.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

async function dumpProbeDetails(page) {
  await page.waitForTimeout(8000);

  const buttonTexts = await page.locator('button').evaluateAll((elements) =>
    elements
      .map((element) => element.textContent?.trim() || '')
      .filter(Boolean)
      .slice(0, 20)
  );
  const inputSummary = await page.locator('input, textarea').evaluateAll((elements) =>
    elements.slice(0, 20).map((element) => ({
      tag: element.tagName,
      type: element.getAttribute('type') || '',
      name: element.getAttribute('name') || '',
      placeholder: element.getAttribute('placeholder') || '',
      ariaLabel: element.getAttribute('aria-label') || '',
    }))
  );
  const textSnippet = (await page.locator('body').innerText()).slice(0, 2000);
  const editorState = await page.evaluate(() => {
    const monaco = globalThis.monaco;
    const models = monaco?.editor?.getModels?.() || [];
    const runButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Run'
    );

    return {
      hasMonaco: Boolean(monaco),
      modelCount: models.length,
      firstModelValueLength: models[0]?.getValue?.()?.length ?? null,
      runButtonDisabled: runButton ? runButton.hasAttribute('disabled') : null,
      runButtonAriaDisabled: runButton?.getAttribute('aria-disabled') ?? null,
    };
  });

  console.log(`PROBE_URL=${page.url()}`);
  console.log(`PROBE_TITLE=${await page.title()}`);
  console.log(`PROBE_BUTTONS=${JSON.stringify(buttonTexts)}`);
  console.log(`PROBE_INPUTS=${JSON.stringify(inputSummary)}`);
  console.log(`PROBE_EDITOR_STATE=${JSON.stringify(editorState)}`);
  console.log(`PROBE_TEXT=${textSnippet.replace(/\s+/g, ' ')}`);
}

async function waitForSqlEditorReady(page) {
  await page.waitForFunction(
    () => {
      const models = globalThis.monaco?.editor?.getModels?.() || [];
      return models.length > 0 || Boolean(document.querySelector('textarea[aria-label="Editor content"]'));
    },
    { timeout: 60000 }
  );
}

async function setSqlInEditor(page, sqlText) {
  return page.evaluate((query) => {
    const monaco = globalThis.monaco;
    const models = monaco?.editor?.getModels?.() || [];

    if (models.length > 0) {
      models[0].setValue(query);
      return {
        mode: 'monaco',
        modelCount: models.length,
        valueLength: models[0].getValue().length,
      };
    }

    const textarea = document.querySelector('textarea[aria-label="Editor content"]');
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.value = query;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        mode: 'textarea',
        modelCount: 0,
        valueLength: textarea.value.length,
      };
    }

    return {
      mode: 'none',
      modelCount: 0,
      valueLength: 0,
    };
  }, sqlText);
}

async function executeSqlViaDashboard(page, sqlText) {
  const editor = page.locator('textarea[aria-label="Editor content"]').first();
  const runButton = page.getByRole('button', { name: 'Run' }).first();

  await waitForSqlEditorReady(page);
  await editor.waitFor({ state: 'visible', timeout: 60000 });
  await runButton.waitFor({ state: 'visible', timeout: 60000 });

  let setResult = await setSqlInEditor(page, sqlText);
  if (setResult.mode === 'none') {
    await page.waitForTimeout(3000);
    await waitForSqlEditorReady(page);
    setResult = await setSqlInEditor(page, sqlText);
  }
  console.log(`EDITOR_SET_RESULT=${JSON.stringify(setResult)}`);

  if (setResult.mode === 'none') {
    await page.screenshot({ path: 'supabase-dashboard-editor-not-ready.png', fullPage: true });
    throw new Error('SQL_EDITOR_NOT_READY');
  }

  const responsePromise = page.waitForResponse((response) => isMatchingSqlResponse(response, sqlText), {
    timeout: 45000,
  });

  await editor.evaluate((element) => element.focus());
  await page.keyboard.press('Meta+Enter');

  let response = null;
  try {
    response = await responsePromise;
  } catch {
    console.log(`RUN_BUTTON_DISABLED=${await runButton.isDisabled()}`);
    await runButton.click({ force: true });
    response = await page.waitForResponse(
      (candidate) => isMatchingSqlResponse(candidate, sqlText),
      { timeout: 45000 }
    );
  }

  const responseText = await response.text();
  console.log(`UI_QUERY_STATUS=${response.status()}`);
  console.log(responseText);

  if (!response.ok()) {
    await page.screenshot({ path: 'supabase-dashboard-ui-query-failure.png', fullPage: true });
    process.exit(7);
  }
}

async function executeSqlViaBrowserApi(page, sqlText, token) {
  const result = await page.evaluate(
    async ({ projectRef: projectReference, query, accessToken }) => {
      const response = await fetch(`https://api.supabase.com/platform/pg-meta/${projectReference}/query`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          query,
          disable_statement_timeout: false,
        }),
      });

      return {
        status: response.status,
        ok: response.ok,
        text: await response.text(),
      };
    },
    {
      projectRef,
      query: sqlText,
      accessToken: token,
    }
  );

  console.log(`BROWSER_API_QUERY_STATUS=${result.status}`);
  console.log(result.text);

  if (!result.ok) {
    process.exit(8);
  }
}

async function main() {
  let browser = null;
  let context = null;
  let page = null;
  let tempUserDataDir = null;
  const sqlText = sqlFilePath ? await readFile(sqlFilePath, 'utf8') : sqlQuery;
  const parsedStatements = splitSqlStatements(sqlText);
  let sqlStatements = parsedStatements;

  if (Number.isInteger(sqlStatementIndex)) {
    sqlStatements = [parsedStatements[sqlStatementIndex - 1]].filter(Boolean);
  } else if (Number.isInteger(sqlStatementStart) || Number.isInteger(sqlStatementEnd)) {
    const startIndex = Number.isInteger(sqlStatementStart) ? Math.max(sqlStatementStart - 1, 0) : 0;
    const endIndex = Number.isInteger(sqlStatementEnd) ? sqlStatementEnd : parsedStatements.length;
    sqlStatements = parsedStatements.slice(startIndex, endIndex);
  }

  if (printSqlSplit) {
    parsedStatements.forEach((statement, statementIndex) => {
      const preview = statement.replace(/\s+/g, ' ').slice(0, 140);
      console.log(`SQL_STATEMENT_${statementIndex + 1}=${preview}`);
    });
    return;
  }

  try {
    if (probeNetwork) {
      page?.on('request', (request) => {
        const resourceType = request.resourceType();
        if (resourceType === 'fetch' || resourceType === 'xhr') {
          console.log(`REQUEST ${request.method()} ${request.url()}`);
        }
      });
      page?.on('response', async (response) => {
        const request = response.request();
        const resourceType = request.resourceType();
        if (resourceType === 'fetch' || resourceType === 'xhr') {
          console.log(`RESPONSE ${response.status()} ${request.method()} ${request.url()}`);
        }
      });
    }

    if (chromeUserDataDir && chromeProfileDir) {
      tempUserDataDir = await mkdtemp(path.join(os.tmpdir(), 'supabase-chrome-profile-'));
      await cp(path.join(chromeUserDataDir, 'Local State'), path.join(tempUserDataDir, 'Local State'));
      await cp(path.join(chromeUserDataDir, chromeProfileDir), path.join(tempUserDataDir, chromeProfileDir), {
        recursive: true,
        force: true,
      });

      context = await chromium.launchPersistentContext(tempUserDataDir, {
        channel: 'chrome',
        headless,
        args: [`--profile-directory=${chromeProfileDir}`],
      });
      page = context.pages()[0] || (await context.newPage());
    } else {
      browser = await chromium.launch({ channel: 'chrome', headless });
      page = await browser.newPage();
    }

    if (probeNetwork) {
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (resourceType === 'fetch' || resourceType === 'xhr') {
          const body = request.url().includes('/platform/pg-meta/') ? formatRequestBody(request) : '';
          console.log(`REQUEST ${request.method()} ${request.url()}`);
          if (body) {
            console.log(`REQUEST_BODY ${body}`);
          }
        }
      });
      page.on('response', (response) => {
        const request = response.request();
        const resourceType = request.resourceType();
        if (resourceType === 'fetch' || resourceType === 'xhr') {
          console.log(`RESPONSE ${response.status()} ${request.method()} ${request.url()}`);
        }
      });
    }

    await page.goto('https://supabase.com/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    if (page.url().includes('/sign-in')) {
      if (!email || !password) {
        await page.screenshot({ path: 'supabase-dashboard-signin-required.png', fullPage: true });
        console.error('LOGIN_REQUIRED_BUT_NO_CREDENTIALS');
        console.error(`PAGE_URL=${page.url()}`);
        process.exit(6);
      }

      const emailInput = page.locator('#email');
      const passwordInput = page.locator('#password');

      await emailInput.waitFor({ state: 'visible', timeout: 30000 });
      await passwordInput.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(1500);

      await emailInput.click();
      await emailInput.fill('');
      await emailInput.type(email, { delay: 50 });

      await passwordInput.click();
      await passwordInput.fill('');
      await passwordInput.type(password, { delay: 50 });

      const emailValue = await emailInput.inputValue();
      const passwordValue = await passwordInput.inputValue();

      if (!emailValue || !passwordValue) {
        await page.screenshot({ path: 'supabase-dashboard-input-failure.png', fullPage: true });
        console.error('LOGIN_INPUT_NOT_FILLED');
        console.error(`EMAIL_LENGTH=${emailValue.length}`);
        console.error(`PASSWORD_LENGTH=${passwordValue.length}`);
        process.exit(5);
      }

      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(8000);
    }

    let token = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const rawToken = await page.evaluate(() => localStorage.getItem('supabase.dashboard.auth.token'));
      token = extractAccessToken(rawToken);
      if (token) break;
      await page.waitForTimeout(2000);
    }

    if (!token) {
      const textSnippet = (await page.locator('body').innerText()).slice(0, 1200);
      await page.screenshot({ path: 'supabase-dashboard-login-failure.png', fullPage: true });
      console.error('LOGIN_TOKEN_NOT_FOUND');
      console.error(`PAGE_URL=${page.url()}`);
      console.error(textSnippet);
      process.exit(3);
    }

    console.log('LOGIN_OK');

    if (probeUrl) {
      await page.goto(probeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      await dumpProbeDetails(page);
      return;
    }

    if (executeViaBrowserApi) {
      await executeSqlViaBrowserApi(page, sqlText, token);
      return;
    }

    if (executeViaUi) {
      for (const [statementIndex, statement] of sqlStatements.entries()) {
        console.log(`UI_QUERY_INDEX=${statementIndex + 1}/${sqlStatements.length}`);
        await page.goto(`https://supabase.com/dashboard/project/${projectRef}/sql/new`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        });
        await executeSqlViaDashboard(page, statement);
        if (uiStatementDelayMs > 0 && statementIndex < sqlStatements.length - 1) {
          await page.waitForTimeout(uiStatementDelayMs);
        }
      }
      return;
    }

    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: sqlQuery,
        read_only: readOnly,
      }),
    });

    const responseText = await response.text();
    console.log(`QUERY_STATUS=${response.status}`);
    console.log(responseText);

    if (!response.ok) {
      process.exit(4);
    }
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
    if (tempUserDataDir) {
      await rm(tempUserDataDir, { recursive: true, force: true });
    }
  }
}

main().catch(async (error) => {
  console.error('UNEXPECTED_ERROR');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});