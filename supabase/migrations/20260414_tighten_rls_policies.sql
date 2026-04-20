-- Tighten RLS: all CRUD goes through Edge Functions (service_role, bypasses RLS).
-- Drop overly permissive "any authenticated user" policies and replace with
-- read-only access for authenticated users + no direct write access.
-- This prevents direct PostgREST abuse if someone obtains a Supabase user JWT.

-- === ai_report_runs ===
drop policy if exists allow_select_ai_report_runs_authenticated on public.ai_report_runs;
drop policy if exists allow_crud_ai_report_runs_authenticated on public.ai_report_runs;
drop policy if exists allow_update_ai_report_runs_authenticated on public.ai_report_runs;
drop policy if exists allow_delete_ai_report_runs_authenticated on public.ai_report_runs;

create policy allow_select_ai_report_runs_authenticated
  on public.ai_report_runs for select
  using (auth.role() = 'authenticated');

-- === ai_reports ===
drop policy if exists allow_select_ai_reports_authenticated on public.ai_reports;
drop policy if exists allow_crud_ai_reports_authenticated on public.ai_reports;
drop policy if exists allow_update_ai_reports_authenticated on public.ai_reports;
drop policy if exists allow_delete_ai_reports_authenticated on public.ai_reports;

create policy allow_select_ai_reports_authenticated
  on public.ai_reports for select
  using (auth.role() = 'authenticated');

-- === ai_playbooks ===
drop policy if exists allow_select_ai_playbooks_authenticated on public.ai_playbooks;
drop policy if exists allow_crud_ai_playbooks_authenticated on public.ai_playbooks;
drop policy if exists allow_update_ai_playbooks_authenticated on public.ai_playbooks;
drop policy if exists allow_delete_ai_playbooks_authenticated on public.ai_playbooks;

create policy allow_select_ai_playbooks_authenticated
  on public.ai_playbooks for select
  using (auth.role() = 'authenticated');

-- === ai_prompt_templates ===
drop policy if exists allow_select_ai_prompt_templates_authenticated on public.ai_prompt_templates;
drop policy if exists allow_crud_ai_prompt_templates_authenticated on public.ai_prompt_templates;
drop policy if exists allow_update_ai_prompt_templates_authenticated on public.ai_prompt_templates;
drop policy if exists allow_delete_ai_prompt_templates_authenticated on public.ai_prompt_templates;

create policy allow_select_ai_prompt_templates_authenticated
  on public.ai_prompt_templates for select
  using (auth.role() = 'authenticated');

-- === ai_prompt_versions ===
drop policy if exists allow_select_ai_prompt_versions_authenticated on public.ai_prompt_versions;
drop policy if exists allow_crud_ai_prompt_versions_authenticated on public.ai_prompt_versions;
drop policy if exists allow_update_ai_prompt_versions_authenticated on public.ai_prompt_versions;
drop policy if exists allow_delete_ai_prompt_versions_authenticated on public.ai_prompt_versions;

create policy allow_select_ai_prompt_versions_authenticated
  on public.ai_prompt_versions for select
  using (auth.role() = 'authenticated');

-- === ad_plans ===
drop policy if exists allow_select_ad_plans_authenticated on public.ad_plans;
drop policy if exists allow_insert_ad_plans_authenticated on public.ad_plans;
drop policy if exists allow_update_ad_plans_authenticated on public.ad_plans;
drop policy if exists allow_delete_ad_plans_authenticated on public.ad_plans;

create policy allow_select_ad_plans_authenticated
  on public.ad_plans for select
  using (auth.role() = 'authenticated');

-- === ad_plan_activities ===
drop policy if exists allow_select_ad_plan_activities_authenticated on public.ad_plan_activities;
drop policy if exists allow_insert_ad_plan_activities_authenticated on public.ad_plan_activities;
drop policy if exists allow_update_ad_plan_activities_authenticated on public.ad_plan_activities;
drop policy if exists allow_delete_ad_plan_activities_authenticated on public.ad_plan_activities;

create policy allow_select_ad_plan_activities_authenticated
  on public.ad_plan_activities for select
  using (auth.role() = 'authenticated');
