create extension if not exists pgcrypto;

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.ai_report_runs (
  id uuid primary key default gen_random_uuid(),
  analysis_type text not null default 'daily',
  source_tab text not null default 'ads',
  start_date date not null,
  end_date date not null,
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  title text,
  summary text,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high', 'critical')),
  model_name text,
  prompt_version text,
  overview_metrics jsonb not null default '{}'::jsonb,
  report_payload jsonb not null default '{}'::jsonb,
  input_snapshot jsonb not null default '{}'::jsonb,
  raw_markdown text,
  raw_response text,
  error_message text,
  created_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_report_runs(id) on delete set null,
  slug text not null unique,
  title text not null,
  report_type text not null default 'daily',
  report_date date not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  visibility text not null default 'team' check (visibility in ('private', 'team', 'public')),
  summary text not null,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high', 'critical')),
  executive_summary jsonb not null default '{}'::jsonb,
  overview_metrics jsonb not null default '{}'::jsonb,
  highlights jsonb not null default '[]'::jsonb,
  high_spend_crowds jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  finance_adjustment jsonb not null default '{}'::jsonb,
  live_session_insight jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  raw_markdown text,
  raw_payload jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_playbooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  scenario text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  confidence_score numeric(5,2) not null default 0,
  trigger_conditions jsonb not null default '[]'::jsonb,
  recommended_actions jsonb not null default '[]'::jsonb,
  expected_outcome text,
  source_report_slugs text[] not null default '{}',
  source_tags text[] not null default '{}',
  notes text,
  created_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_ai_report_runs_created_at on public.ai_report_runs(created_at desc);
create index if not exists idx_ai_report_runs_date_range on public.ai_report_runs(start_date, end_date);
create index if not exists idx_ai_report_runs_status on public.ai_report_runs(status);

create index if not exists idx_ai_reports_report_date on public.ai_reports(report_date desc);
create index if not exists idx_ai_reports_status on public.ai_reports(status);
create index if not exists idx_ai_reports_visibility on public.ai_reports(visibility);
create index if not exists idx_ai_reports_risk_level on public.ai_reports(risk_level);
create index if not exists idx_ai_reports_tags on public.ai_reports using gin(tags);

create index if not exists idx_ai_playbooks_status on public.ai_playbooks(status);
create index if not exists idx_ai_playbooks_priority on public.ai_playbooks(priority);
create index if not exists idx_ai_playbooks_source_tags on public.ai_playbooks using gin(source_tags);

drop trigger if exists trg_ai_report_runs_updated_at on public.ai_report_runs;
create trigger trg_ai_report_runs_updated_at
before update on public.ai_report_runs
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists trg_ai_reports_updated_at on public.ai_reports;
create trigger trg_ai_reports_updated_at
before update on public.ai_reports
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists trg_ai_playbooks_updated_at on public.ai_playbooks;
create trigger trg_ai_playbooks_updated_at
before update on public.ai_playbooks
for each row
execute function public.set_updated_at_timestamp();

alter table public.ai_report_runs enable row level security;
alter table public.ai_reports enable row level security;
alter table public.ai_playbooks enable row level security;

-- Row Level Security policies: require authenticated Supabase user for access
-- Note: service_role bypasses RLS. These policies prevent anonymous public access.
create policy if not exists allow_select_ai_report_runs_authenticated
  on public.ai_report_runs
  for select
  using (auth.role() = 'authenticated');

create policy if not exists allow_crud_ai_report_runs_authenticated
  on public.ai_report_runs
  for insert
  with check (auth.role() = 'authenticated');

create policy if not exists allow_update_ai_report_runs_authenticated
  on public.ai_report_runs
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy if not exists allow_delete_ai_report_runs_authenticated
  on public.ai_report_runs
  for delete
  using (auth.role() = 'authenticated');

create policy if not exists allow_select_ai_reports_authenticated
  on public.ai_reports
  for select
  using (auth.role() = 'authenticated');

create policy if not exists allow_crud_ai_reports_authenticated
  on public.ai_reports
  for insert
  with check (auth.role() = 'authenticated');

create policy if not exists allow_update_ai_reports_authenticated
  on public.ai_reports
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy if not exists allow_delete_ai_reports_authenticated
  on public.ai_reports
  for delete
  using (auth.role() = 'authenticated');

create policy if not exists allow_select_ai_playbooks_authenticated
  on public.ai_playbooks
  for select
  using (auth.role() = 'authenticated');

create policy if not exists allow_crud_ai_playbooks_authenticated
  on public.ai_playbooks
  for insert
  with check (auth.role() = 'authenticated');

create policy if not exists allow_update_ai_playbooks_authenticated
  on public.ai_playbooks
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy if not exists allow_delete_ai_playbooks_authenticated
  on public.ai_playbooks
  for delete
  using (auth.role() = 'authenticated');

comment on table public.ai_report_runs is '记录每次 AI 分析运行结果，适合留痕和复现';
comment on table public.ai_reports is '记录已发布到洞察中心的业务可见报告';
comment on table public.ai_playbooks is '记录可复用的策略卡和经验库';