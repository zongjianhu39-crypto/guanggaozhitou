const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type PromptAdminUser = {
  open_id: string;
  email?: string | null;
  name?: string | null;
};

export type PromptAdminTokenPayload = {
  sub: string;
  email: string;
  name: string;
  scope: 'prompt:admin';
  exp: number;
};

export type PromptAdminSession = {
  enabled: boolean;
  token: string | null;
  expires_at: number | null;
  reason: string | null;
};

function normalizeCsvList(value: string | null): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBase64Url(input: Uint8Array): string {
  let binary = '';
  input.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function getPromptAdminSigningSecret(): string {
  return Deno.env.get('PROMPT_ADMIN_SIGNING_SECRET') ?? Deno.env.get('FEISHU_APP_SECRET') ?? '';
}

function isPromptAdminAllowed(user: PromptAdminUser): boolean {
  const allowedEmails = normalizeCsvList(Deno.env.get('PROMPT_ADMIN_EMAILS'));
  const allowedOpenIds = normalizeCsvList(Deno.env.get('PROMPT_ADMIN_OPEN_IDS'));

  if (!allowedEmails.length && !allowedOpenIds.length) {
    return false;
  }

  const email = String(user.email ?? '').trim().toLowerCase();
  const openId = String(user.open_id ?? '').trim();
  if (email && allowedEmails.map((item) => item.toLowerCase()).includes(email)) {
    return true;
  }
  if (openId && allowedOpenIds.includes(openId)) {
    return true;
  }
  return false;
}

export async function issuePromptAdminSession(user: PromptAdminUser, expiresInSeconds = 8 * 60 * 60): Promise<PromptAdminSession & { is_admin: boolean }> {
  const secret = getPromptAdminSigningSecret();
  if (!secret) {
    return {
      enabled: false,
      is_admin: false,
      token: null,
      expires_at: null,
      reason: 'prompt_admin_signing_secret_missing',
    };
  }

  const isAdmin = isPromptAdminAllowed(user);

  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload: PromptAdminTokenPayload = {
    sub: user.open_id,
    email: String(user.email ?? ''),
    name: String(user.name ?? ''),
    scope: 'prompt:admin',
    exp,
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signValue(encodedPayload, secret);

  return {
    enabled: true,
    is_admin: isAdmin,
    token: `${encodedPayload}.${signature}`,
    expires_at: exp,
    reason: isAdmin ? null : 'prompt_admin_not_allowed',
  };
}

export async function verifyPromptAdminToken(token: string): Promise<PromptAdminTokenPayload | null> {
  const secret = getPromptAdminSigningSecret();
  if (!secret || !token) return null;

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSignature = await signValue(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(encodedPayload))) as PromptAdminTokenPayload;
    if (!payload?.sub || payload.scope !== 'prompt:admin' || !payload.exp) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function requirePromptAdminToken(token: string): Promise<PromptAdminTokenPayload> {
  const payload = await verifyPromptAdminToken(token);
  if (!payload) {
    throw new Error('无效或已过期的 Prompt 管理令牌');
  }
  if (!isPromptAdminAllowed({ open_id: payload.sub, email: payload.email, name: payload.name })) {
    throw new Error('无 Prompt 管理权限');
  }
  return payload;
}