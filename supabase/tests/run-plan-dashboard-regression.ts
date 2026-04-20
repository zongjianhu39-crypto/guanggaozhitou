import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const API_PATH = path.join(ROOT, 'assets', 'js', 'plan-dashboard-api.js');

async function loadPlanDashboardApi(fetchFunctionJson: (...args: any[]) => Promise<any>) {
  const source = await readFile(API_PATH, 'utf8');
  const windowStub: Record<string, any> = {
    location: { href: 'https://www.friends.wang/plan-dashboard.html' },
    authHelpers: {
      fetchFunctionJson,
      handleReauthRequired: () => {},
    },
  };
  const context = vm.createContext({
    window: windowStub,
    console,
  });
  windowStub.window = windowStub;
  vm.runInContext(source, context, { filename: API_PATH });
  return windowStub.PlanDashboardApi;
}

async function main() {
  const payload = {
    range: { start: '2026-01-01', end: '2026-01-01' },
    kpis: { total_plan_amount: 1 },
    days: [],
    activities: [],
  };
  const calls: Array<{ name: string; options: Record<string, unknown> }> = [];
  const api = await loadPlanDashboardApi(async (name, options) => {
    calls.push({ name, options });
    return {
      response: { status: 200 },
      data: payload,
      rawText: JSON.stringify(payload),
    };
  });

  const summary = await api.fetchSummary('2026-01-01', '2026-01-01');
  assert.deepEqual(summary, payload, 'fetchSummary should return response data, not auth-helper wrapper');
  assert.equal((summary as Record<string, unknown>).response, undefined, 'summary should not expose wrapper.response');
  assert.equal((summary as Record<string, unknown>).rawText, undefined, 'summary should not expose wrapper.rawText');
  assert.equal(calls[0].name, 'plan-dashboard-summary');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.query)), { start: '2026-01-01', end: '2026-01-01' });

  await api.savePlans([{ date: '2026-01-01', patch: { wanxiang_plan: 100, remark: 'draft' } }], 'tester');
  assert.equal(calls[1].name, 'plan-dashboard-summary');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].options.body)), {
    action: 'save_plans',
    items: [{ date: '2026-01-01', patch: { wanxiang_plan: 100, remark: 'draft' } }],
    updated_by: 'tester',
  });

  console.log(`Plan dashboard regression passed: ${JSON.stringify({ checked: calls.length })}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
