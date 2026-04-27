create table if not exists public.genbi_rule_configs (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  label text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  updated_by text,
  updated_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_genbi_rule_configs_active
  on public.genbi_rule_configs(is_active);

drop trigger if exists trg_genbi_rule_configs_updated_at on public.genbi_rule_configs;
create trigger trg_genbi_rule_configs_updated_at
before update on public.genbi_rule_configs
for each row
execute function public.set_updated_at_timestamp();

alter table public.genbi_rule_configs enable row level security;

drop policy if exists allow_select_genbi_rule_configs_authenticated on public.genbi_rule_configs;
create policy allow_select_genbi_rule_configs_authenticated
  on public.genbi_rule_configs
  for select
  using (auth.role() = 'authenticated');

comment on table public.genbi_rule_configs is 'GenBI 意图规则配置，保存每个规则使用的数据表、指标、阈值和输出设置。';
