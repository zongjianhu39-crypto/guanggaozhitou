import { verifyPromptAdminToken } from './prompt-admin-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from './supabase-client.ts';

type PromptAdminAuth = {
  type: 'prompt_admin';
  payload: Record<string, unknown>;
};

type SupabaseUserAuth = {
  type: 'supabase_user';
  user: Record<string, unknown>;
};

export type EdgeAuthResult = PromptAdminAuth | SupabaseUserAuth;

type AuthenticateRequestOptions = {
  allowPromptAdmin?: boolean;
  allowSupabaseUser?: boolean;
};

export async function authenticateEdgeRequest(
  req: Request,
  options: AuthenticateRequestOptions = {},
): Promise<EdgeAuthResult | null> {
  const allowPromptAdmin = options.allowPromptAdmin !== false;
  const allowSupabaseUser = options.allowSupabaseUser !== false;

  if (allowPromptAdmin) {
    const promptToken = req.headers.get('x-prompt-admin-token') || '';
    if (promptToken) {
      try {
        const payload = await verifyPromptAdminToken(promptToken);
        if (payload) return { type: 'prompt_admin', payload };
      } catch {
        // fall through to user session auth
      }
    }
  }

  if (!allowSupabaseUser) {
    return null;
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const response = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SB_SERVICE_ROLE_KEY,
      },
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.id) return { type: 'supabase_user', user: body };
  } catch {
    return null;
  }

  return null;
}
