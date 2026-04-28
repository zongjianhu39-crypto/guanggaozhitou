create table if not exists public.genbi_query_events (
  id uuid primary key default gen_random_uuid(),
  intent text,
  rule_key text,
  source text,
  primary_metric text,
  secondary_metric text,
  original_count integer,
  filtered_count integer,
  fallback_reason text,
  latency_ms integer,
  ai_enhanced boolean,
  question_prefix text,
  range_start date,
  range_end date,
  semantic_version text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_genbi_query_events_created_at
  on public.genbi_query_events(created_at desc);
create index if not exists idx_genbi_query_events_intent_source
  on public.genbi_query_events(intent, source);

alter table public.genbi_query_events enable row level security;

drop policy if exists allow_select_genbi_query_events_authenticated on public.genbi_query_events;
create policy allow_select_genbi_query_events_authenticated
  on public.genbi_query_events
  for select
  using (auth.role() = 'authenticated');

comment on table public.genbi_query_events is 'GenBI 问数埋点：记录每次意图命中的执行源、过滤结果、延迟，用于后续规则调优与质量分析。';
comment on column public.genbi_query_events.source is '执行源：dynamic / hardcoded / hardcoded_fallback / unsupported';
comment on column public.genbi_query_events.question_prefix is '用户问题前 80 字符，用于排查；敏感信息已截断';
