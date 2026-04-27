alter table public.ai_report_runs
  add column if not exists source_channel text not null default 'dashboard_ai',
  add column if not exists source_question text,
  add column if not exists source_intent text,
  add column if not exists source_range jsonb not null default '{}'::jsonb;

alter table public.ai_reports
  add column if not exists source_channel text not null default 'dashboard_ai',
  add column if not exists source_question text,
  add column if not exists source_intent text,
  add column if not exists source_range jsonb not null default '{}'::jsonb;

create index if not exists idx_ai_report_runs_source_channel on public.ai_report_runs(source_channel);
create index if not exists idx_ai_report_runs_source_intent on public.ai_report_runs(source_intent);
create index if not exists idx_ai_reports_source_channel on public.ai_reports(source_channel);
create index if not exists idx_ai_reports_source_intent on public.ai_reports(source_intent);

comment on column public.ai_report_runs.source_channel is '报告来源渠道，如 dashboard_ai 或 genbi';
comment on column public.ai_report_runs.source_question is '触发本次生成的原始问题或入口描述';
comment on column public.ai_report_runs.source_intent is '来源系统识别出的意图，如 weekly_report、crowd_budget';
comment on column public.ai_report_runs.source_range is '来源系统提交的原始时间范围快照';

comment on column public.ai_reports.source_channel is '洞察报告来源渠道，如 dashboard_ai 或 genbi';
comment on column public.ai_reports.source_question is '生成该洞察报告时的原始问题或入口描述';
comment on column public.ai_reports.source_intent is '来源系统识别出的意图，如 weekly_report、crowd_budget';
comment on column public.ai_reports.source_range is '洞察报告对应的原始时间范围快照';
