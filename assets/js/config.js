// Frontend config - only public browser-safe values belong in this file.
// Private service-role keys and deployment credentials must stay in environment secrets.
(function configureFrontend(window) {
  'use strict';

  var publishableKey = 'sb_publishable_gKqbiep4QN8aZ92DtQWcMQ_vCs_tsqE';
  var config = window.CONFIG || {};

  config.SB_URL = config.SB_URL || 'https://qjscsikithbxuxmjyjsp.supabase.co';
  config.SUPABASE_PUBLISHABLE_KEY = config.SUPABASE_PUBLISHABLE_KEY || publishableKey;
  config.SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || config.SUPABASE_PUBLISHABLE_KEY;
  config.ALLOWED_ORIGIN = config.ALLOWED_ORIGIN || 'https://www.friends.wang';

  window.CONFIG = config;
})(window);
