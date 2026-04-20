#!/usr/bin/env node

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

async function loadScript(relativePath, context) {
  const source = await readFile(path.join(ROOT, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
}

function createContext() {
  const window = {
    addEventListener: () => {},
  };
  const document = {
    getElementById: () => null,
    querySelector: () => null,
  };
  window.document = document;
  const context = vm.createContext({
    window,
    document,
    console,
    Intl,
    CSS: { escape: (value) => String(value) },
    Blob,
    URL,
    setTimeout,
    clearTimeout,
  });
  return { context, window };
}

async function main() {
  const { context, window } = createContext();
  await loadScript('assets/js/plan-dashboard-utils.js', context);
  await loadScript('assets/js/plan-dashboard-state.js', context);
  await loadScript('assets/js/plan-dashboard-render.js', context);
  await loadScript('assets/js/plan-dashboard-page.js', context);

  window.PlanDashboardState.state.summary.days = [
    {
      date: '2026-04-01',
      wanxiang_plan: 100,
      agent_plan: 50,
      actual_cost: 120,
      activity: '默认活动',
      remark: '原始备注',
      activity_source: 'activity',
      activity_type: 'daily',
      reference_amount: 80,
      reference_orders: 12,
      reference_pre_orders: 5,
      reference_gross_profit: 33,
    },
  ];
  window.PlanDashboardState.patchDayDraft('2026-04-01', {
    wanxiang_plan: 180,
    remark: '草稿备注',
  });

  const effectiveDays = window.PlanDashboardRender.getEffectiveDays();
  assert.equal(effectiveDays.length, 1, 'effective days length mismatch');
  assert.equal(effectiveDays[0].wanxiang_plan, 180, 'draft wanxiang plan not applied');
  assert.equal(effectiveDays[0].agent_plan, 50, 'original agent plan should be preserved');
  assert.equal(effectiveDays[0].total_plan_amount, 230, 'total plan should reflect draft values');
  assert.equal(effectiveDays[0].remark, '草稿备注', 'draft remark not applied');

  assert.equal(typeof window.PlanDashboardPage.getInitialMonth, 'function', 'getInitialMonth should be exported');
  assert.equal(window.PlanDashboardPage.getInitialMonth(), 4, 'initial month should fall back to first available month');
  assert.equal(window.PlanDashboardPage.isMonthDisabled(1), true, 'January should be disabled');
  assert.equal(window.PlanDashboardPage.isMonthDisabled(4), false, 'April should be enabled');

  console.log('✓ plan dashboard ui check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
