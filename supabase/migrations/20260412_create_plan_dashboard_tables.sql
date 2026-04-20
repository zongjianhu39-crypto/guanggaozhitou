create table if not exists public.ad_plans (
  plan_date date primary key,
  wanxiang_plan numeric(14, 2) not null default 0 check (wanxiang_plan >= 0),
  agent_plan numeric(14, 2) not null default 0 check (agent_plan >= 0),
  activity_override text,
  remark text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ad_plan_activities (
  id uuid primary key default gen_random_uuid(),
  activity_name text not null,
  activity_type text not null default 'daily' check (activity_type in ('presale', 'tail_payment', 'special_event', 'daily')),
  start_date date not null,
  end_date date not null,
  description text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ad_plan_activities_date_order check (start_date <= end_date)
);

create index if not exists idx_ad_plan_activities_date_range on public.ad_plan_activities(start_date, end_date);
create index if not exists idx_ad_plan_activities_type on public.ad_plan_activities(activity_type, start_date);

alter table public.ad_plans
  add column if not exists wanxiang_plan numeric(14, 2) not null default 0,
  add column if not exists agent_plan numeric(14, 2) not null default 0,
  add column if not exists activity_override text,
  add column if not exists remark text,
  add column if not exists updated_by text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.ad_plan_activities
  add column if not exists activity_name text,
  add column if not exists activity_type text not null default 'daily',
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists description text,
  add column if not exists updated_by text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.ad_plans
set wanxiang_plan = 0
where wanxiang_plan is null;

update public.ad_plans
set agent_plan = 0
where agent_plan is null;

alter table public.ad_plans
  alter column wanxiang_plan set default 0,
  alter column wanxiang_plan set not null,
  alter column agent_plan set default 0,
  alter column agent_plan set not null;

alter table public.ad_plans
  drop constraint if exists ad_plans_wanxiang_plan_nonnegative,
  add constraint ad_plans_wanxiang_plan_nonnegative check (wanxiang_plan >= 0),
  drop constraint if exists ad_plans_agent_plan_nonnegative,
  add constraint ad_plans_agent_plan_nonnegative check (agent_plan >= 0);

alter table public.ad_plan_activities
  alter column activity_name set not null,
  alter column activity_type set default 'daily',
  alter column activity_type set not null,
  alter column start_date set not null,
  alter column end_date set not null;

alter table public.ad_plan_activities
  drop constraint if exists ad_plan_activities_date_order,
  add constraint ad_plan_activities_date_order check (start_date <= end_date),
  drop constraint if exists ad_plan_activities_type_allowed,
  add constraint ad_plan_activities_type_allowed check (activity_type in ('presale', 'tail_payment', 'special_event', 'daily'));

drop trigger if exists trg_ad_plans_updated_at on public.ad_plans;
create trigger trg_ad_plans_updated_at
before update on public.ad_plans
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists trg_ad_plan_activities_updated_at on public.ad_plan_activities;
create trigger trg_ad_plan_activities_updated_at
before update on public.ad_plan_activities
for each row
execute function public.set_updated_at_timestamp();

alter table public.ad_plans enable row level security;
alter table public.ad_plan_activities enable row level security;

drop policy if exists allow_select_ad_plans_authenticated on public.ad_plans;
drop policy if exists allow_insert_ad_plans_authenticated on public.ad_plans;
drop policy if exists allow_update_ad_plans_authenticated on public.ad_plans;
drop policy if exists allow_delete_ad_plans_authenticated on public.ad_plans;

create policy allow_select_ad_plans_authenticated
  on public.ad_plans
  for select
  using (auth.role() = 'authenticated');

create policy allow_insert_ad_plans_authenticated
  on public.ad_plans
  for insert
  with check (auth.role() = 'authenticated');

create policy allow_update_ad_plans_authenticated
  on public.ad_plans
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy allow_delete_ad_plans_authenticated
  on public.ad_plans
  for delete
  using (auth.role() = 'authenticated');

drop policy if exists allow_select_ad_plan_activities_authenticated on public.ad_plan_activities;
drop policy if exists allow_insert_ad_plan_activities_authenticated on public.ad_plan_activities;
drop policy if exists allow_update_ad_plan_activities_authenticated on public.ad_plan_activities;
drop policy if exists allow_delete_ad_plan_activities_authenticated on public.ad_plan_activities;

create policy allow_select_ad_plan_activities_authenticated
  on public.ad_plan_activities
  for select
  using (auth.role() = 'authenticated');

create policy allow_insert_ad_plan_activities_authenticated
  on public.ad_plan_activities
  for insert
  with check (auth.role() = 'authenticated');

create policy allow_update_ad_plan_activities_authenticated
  on public.ad_plan_activities
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy allow_delete_ad_plan_activities_authenticated
  on public.ad_plan_activities
  for delete
  using (auth.role() = 'authenticated');

comment on table public.ad_plans is '计划拆解模块按日计划主表';
comment on table public.ad_plan_activities is '计划拆解模块活动节奏表；当前约定活动日期范围不允许重叠';
