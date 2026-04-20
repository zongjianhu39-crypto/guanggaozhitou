const denoEnv = globalThis.Deno?.env;

export const SB_URL =
  denoEnv?.get('SB_URL') ??
  denoEnv?.get('SUPABASE_URL') ??
  'https://qjscsikithbxuxmjyjsp.supabase.co';
export const SB_SERVICE_ROLE_KEY =
  denoEnv?.get('SB_SERVICE_ROLE_KEY') ?? denoEnv?.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export function getSupabaseHeaders() {
  if (!SB_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE service role key in environment');
  }
  return {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
  };
}
