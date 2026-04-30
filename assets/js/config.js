// Frontend config - only public browser-safe values belong in this file.
// Private service-role keys and deployment credentials must stay in environment secrets.
// NOTE: SUPABASE_ANON_KEY is a JWT-format key with role=anon, designed to be public.
// Security is enforced by RLS policies, not by hiding the anon key.
// Only service_role keys (role=service_role) are real secrets and must never appear here.
(function configureFrontend(window) {
  'use strict';

  var anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqc2NzaWtpdGhieHV4bWp5anNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5Mjc5ODYsImV4cCI6MjA4OTUwMzk4Nn0.NiFpwmdhIuFtzSBqyTHQGohxf3UR3l5U0wtW06o-9p4';
  var config = window.CONFIG || {};

  config.SB_URL = config.SB_URL || 'https://qjscsikithbxuxmjyjsp.supabase.co';
  config.SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || anonKey;
  config.SUPABASE_PUBLISHABLE_KEY = config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY;
  config.ALLOWED_ORIGIN = config.ALLOWED_ORIGIN || 'https://www.friends.wang';

  window.CONFIG = config;
})(window);
