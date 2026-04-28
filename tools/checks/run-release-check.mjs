#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(__dirname, 'release-check.config.json');
const DEFAULT_SITE_URL = 'https://www.friends.wang';

function parseArgs(argv) {
  const parsed = {
    online: false,
    siteUrl: DEFAULT_SITE_URL,
    dashboardSmoke: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--online') {
      parsed.online = true;
      continue;
    }
    if (arg === '--site-url') {
      parsed.siteUrl = argv[index + 1] || DEFAULT_SITE_URL;
      index += 1;
      continue;
    }
    if (arg === '--dashboard-smoke') {
      parsed.dashboardSmoke = true;
      continue;
    }
    if (arg.startsWith('--site-url=')) {
      parsed.siteUrl = arg.split('=', 2)[1] || DEFAULT_SITE_URL;
    }
  }

  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function runCommand(label, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n[check] ${label}`);
    console.log(`> ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function checkLocalFiles(files) {
  console.log('\n[check] local static files');
  for (const relPath of files) {
    const fullPath = path.join(ROOT, relPath);
    try {
      await access(fullPath, fsConstants.F_OK);
      console.log(`✓ ${relPath}`);
    } catch {
      throw new Error(`missing required file: ${relPath}`);
    }
  }
}

async function checkOnlinePaths(siteUrl, paths) {
  console.log('\n[check] online key paths');
  for (const relPath of paths) {
    const normalized = relPath.startsWith('/') ? relPath.slice(1) : relPath;
    const url = `${siteUrl.replace(/\/$/, '')}/${normalized}`;
    const response = await fetch(url, { redirect: 'manual' });
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`online check failed: ${url} -> ${response.status}`);
    }
    console.log(`✓ ${response.status} ${normalized}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(CONFIG_PATH);
  const smoke = config.dashboardSmoke || {};

  if (!smoke.start || !smoke.end) {
    throw new Error('release-check.config.json missing dashboardSmoke.start/end');
  }

  await checkLocalFiles(config.staticFiles || []);

  await runCommand(
    'Secret scan',
    'bash',
    [path.join(ROOT, 'tools/checks/check-no-keys.sh')],
  );

  await runCommand(
    'GenBI regression',
    'npx',
    ['--yes', 'tsx', path.join(ROOT, 'supabase/tests/run-genbi-regression.ts')],
  );

  await runCommand(
    'GenBI contract',
    'npx',
    ['--yes', 'tsx', path.join(ROOT, 'supabase/tests/run-genbi-contract.ts')],
  );

  await runCommand(
    'GenBI dynamic rule',
    'npx',
    ['--yes', 'tsx', path.join(ROOT, 'supabase/tests/run-genbi-rule-dynamic.ts')],
  );

  await runCommand(
    'Plan dashboard regression',
    'npx',
    ['--yes', 'tsx', path.join(ROOT, 'supabase/tests/run-plan-dashboard-regression.ts')],
  );

  await runCommand(
    'Plan dashboard contract',
    'npx',
    ['--yes', 'tsx', path.join(ROOT, 'supabase/tests/run-plan-dashboard-contract.ts')],
  );

  await runCommand(
    'Plan dashboard UI check',
    'node',
    [path.join(ROOT, 'tools/checks/run-plan-dashboard-ui-check.mjs')],
  );

  await runCommand(
    'Security contract checks',
    'npx',
    ['--yes', 'tsx', path.join(ROOT, 'supabase/tests/run-security-checks.ts')],
  );

  const shouldRunDashboardSmoke = args.dashboardSmoke || args.online || process.env.RELEASE_CHECK_DASHBOARD_SMOKE === '1';
  if (shouldRunDashboardSmoke) {
    await runCommand(
      'Dashboard smoke',
      'node',
      [
        path.join(ROOT, 'tools/debug/dashboard_regression_check.mjs'),
        '--start',
        smoke.start,
        '--end',
        smoke.end,
      ],
    );
  } else {
    console.log('\n[skip] Dashboard smoke (pass --dashboard-smoke, --online, or set RELEASE_CHECK_DASHBOARD_SMOKE=1 to enable)');
  }

  if (args.online) {
    await checkOnlinePaths(args.siteUrl, config.onlinePaths || []);
  }

  console.log('\n[done] release checks passed');
}

main().catch((error) => {
  console.error(`\n[failed] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
