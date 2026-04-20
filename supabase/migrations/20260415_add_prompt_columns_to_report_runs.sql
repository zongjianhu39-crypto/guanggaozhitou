-- 给 ai_report_runs 加上实际发送给 AI 的完整提示词字段
alter table public.ai_report_runs
  add column if not exists rendered_prompt text,
  add column if not exists system_prompt text,
  add column if not exists prompt_snapshot text,
  add column if not exists prompt_template_key text,
  add column if not exists prompt_version_id uuid;

comment on column public.ai_report_runs.rendered_prompt is '实际发送给 AI 的 user message（数据+指令）';
comment on column public.ai_report_runs.system_prompt is '实际发送给 AI 的 system message（灵魂/红线/记忆/技能/运营）';
comment on column public.ai_report_runs.prompt_snapshot is 'DB 模板原始内容快照';
comment on column public.ai_report_runs.prompt_template_key is '使用的模板 key（daily/single）';
comment on column public.ai_report_runs.prompt_version_id is '使用的模板版本 ID';
