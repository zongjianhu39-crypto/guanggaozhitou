import assert from 'node:assert/strict';
import { isPromptAdminAllowed, verifyPromptAdminToken, issuePromptAdminSession } from '../functions/_shared/prompt-admin-auth.ts';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  }).catch((err) => {
    failed += 1;
    console.error(`  ✗ ${name}: ${err.message}`);
  });
}

console.log('\n=== Security contract tests ===\n');

// --- prompt-admin-auth: empty allowlist should deny ---
await test('empty allowlist denies all users', () => {
  const originalEmails = Deno.env.get('PROMPT_ADMIN_EMAILS');
  const originalOpenIds = Deno.env.get('PROMPT_ADMIN_OPEN_IDS');
  Deno.env.delete('PROMPT_ADMIN_EMAILS');
  Deno.env.delete('PROMPT_ADMIN_OPEN_IDS');

  try {
    const result = isPromptAdminAllowed({ open_id: 'test_user', email: 'test@example.com' });
    assert.equal(result, false, 'empty allowlist should return false (deny by default)');
  } finally {
    if (originalEmails !== undefined) Deno.env.set('PROMPT_ADMIN_EMAILS', originalEmails);
    if (originalOpenIds !== undefined) Deno.env.set('PROMPT_ADMIN_OPEN_IDS', originalOpenIds);
  }
});

await test('allowlist with matching email allows user', () => {
  const originalEmails = Deno.env.get('PROMPT_ADMIN_EMAILS');
  Deno.env.set('PROMPT_ADMIN_EMAILS', 'admin@example.com,test@example.com');
  try {
    const result = isPromptAdminAllowed({ open_id: 'test_user', email: 'test@example.com' });
    assert.equal(result, true);
  } finally {
    if (originalEmails !== undefined) Deno.env.set('PROMPT_ADMIN_EMAILS', originalEmails);
    else Deno.env.delete('PROMPT_ADMIN_EMAILS');
  }
});

await test('allowlist with non-matching email denies user', () => {
  const originalEmails = Deno.env.get('PROMPT_ADMIN_EMAILS');
  Deno.env.set('PROMPT_ADMIN_EMAILS', 'admin@example.com');
  try {
    const result = isPromptAdminAllowed({ open_id: 'test_user', email: 'hacker@evil.com' });
    assert.equal(result, false);
  } finally {
    if (originalEmails !== undefined) Deno.env.set('PROMPT_ADMIN_EMAILS', originalEmails);
    else Deno.env.delete('PROMPT_ADMIN_EMAILS');
  }
});

// --- verify invalid tokens ---
await test('verifyPromptAdminToken rejects empty token', async () => {
  const result = await verifyPromptAdminToken('');
  assert.equal(result, null);
});

await test('verifyPromptAdminToken rejects malformed token', async () => {
  const result = await verifyPromptAdminToken('not.a.valid.token');
  assert.equal(result, null);
});

await test('verifyPromptAdminToken rejects tampered payload', async () => {
  const result = await verifyPromptAdminToken('eyJzdWIiOiJ0ZXN0In0.invalidsignature');
  assert.equal(result, null);
});

// --- issuePromptAdminSession: missing secret ---
await test('issuePromptAdminSession returns disabled when secret missing', async () => {
  const originalSecret = Deno.env.get('PROMPT_ADMIN_SIGNING_SECRET');
  const originalFeishuSecret = Deno.env.get('FEISHU_APP_SECRET');
  Deno.env.delete('PROMPT_ADMIN_SIGNING_SECRET');
  Deno.env.delete('FEISHU_APP_SECRET');
  try {
    const session = await issuePromptAdminSession({ open_id: 'test_user', email: 'test@example.com' });
    assert.equal(session.enabled, false);
    assert.equal(session.reason, 'prompt_admin_signing_secret_missing');
  } finally {
    if (originalSecret !== undefined) Deno.env.set('PROMPT_ADMIN_SIGNING_SECRET', originalSecret);
    if (originalFeishuSecret !== undefined) Deno.env.set('FEISHU_APP_SECRET', originalFeishuSecret);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  Deno.exit(1);
}
