create table if not exists public.audience_repository (
  audience_id bigint primary key,
  audience_name text not null,
  valid_from date,
  valid_to date,
  valid_range_text text,
  audience_size bigint,
  selection_logic text,
  audience_definition text,
  image_formula_map jsonb not null default '{}'::jsonb,
  metric_summary jsonb not null default '{}'::jsonb,
  raw_row jsonb not null default '{}'::jsonb,
  source_filename text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audience_repository_metrics (
  id uuid primary key default gen_random_uuid(),
  audience_id bigint not null references public.audience_repository(audience_id) on delete cascade,
  dimension text not null,
  category text not null,
  share numeric(12, 8),
  share_text text,
  source text not null default 'image_extract',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint audience_repository_metrics_unique unique (audience_id, dimension, category)
);

create index if not exists idx_audience_repository_name on public.audience_repository using gin (to_tsvector('simple', coalesce(audience_name, '') || ' ' || coalesce(selection_logic, '') || ' ' || coalesce(audience_definition, '')));
create index if not exists idx_audience_repository_valid_range on public.audience_repository(valid_from, valid_to);
create index if not exists idx_audience_repository_metrics_audience on public.audience_repository_metrics(audience_id);
create index if not exists idx_audience_repository_metrics_dimension on public.audience_repository_metrics(dimension, category);

drop trigger if exists trg_audience_repository_updated_at on public.audience_repository;
create trigger trg_audience_repository_updated_at
before update on public.audience_repository
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists trg_audience_repository_metrics_updated_at on public.audience_repository_metrics;
create trigger trg_audience_repository_metrics_updated_at
before update on public.audience_repository_metrics
for each row
execute function public.set_updated_at_timestamp();

alter table public.audience_repository enable row level security;
alter table public.audience_repository_metrics enable row level security;

drop policy if exists allow_select_audience_repository_authenticated on public.audience_repository;
drop policy if exists allow_select_audience_repository_metrics_authenticated on public.audience_repository_metrics;

create policy allow_select_audience_repository_authenticated
  on public.audience_repository for select
  using (auth.role() = 'authenticated');

create policy allow_select_audience_repository_metrics_authenticated
  on public.audience_repository_metrics for select
  using (auth.role() = 'authenticated');

comment on table public.audience_repository is '人群仓库基础信息表，写入由 audience-repository Edge Function 统一处理';
comment on table public.audience_repository_metrics is '人群仓库图片/标签解析后的维度占比长表，用于后续分析和调用';
