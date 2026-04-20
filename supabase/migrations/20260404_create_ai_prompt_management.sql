create table if not exists public.ai_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  description text,
  analysis_type text not null default 'daily',
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ai_prompt_templates(id) on delete cascade,
  version_no integer not null,
  version_label text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  content text not null,
  change_note text,
  based_on_version_id uuid references public.ai_prompt_versions(id) on delete set null,
  published_at timestamptz,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (template_id, version_no)
);

create index if not exists idx_ai_prompt_templates_analysis_type on public.ai_prompt_templates(analysis_type);
create index if not exists idx_ai_prompt_templates_active on public.ai_prompt_templates(is_active);
create index if not exists idx_ai_prompt_versions_template_status on public.ai_prompt_versions(template_id, status, version_no desc);
create unique index if not exists idx_ai_prompt_versions_one_published_per_template
  on public.ai_prompt_versions(template_id)
  where status = 'published';

drop trigger if exists trg_ai_prompt_templates_updated_at on public.ai_prompt_templates;
create trigger trg_ai_prompt_templates_updated_at
before update on public.ai_prompt_templates
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists trg_ai_prompt_versions_updated_at on public.ai_prompt_versions;
create trigger trg_ai_prompt_versions_updated_at
before update on public.ai_prompt_versions
for each row
execute function public.set_updated_at_timestamp();

alter table public.ai_prompt_templates enable row level security;
alter table public.ai_prompt_versions enable row level security;

-- Row Level Security policies for prompts: require authenticated Supabase user
create policy if not exists allow_select_ai_prompt_templates_authenticated
  on public.ai_prompt_templates
  for select
  using (auth.role() = 'authenticated');

create policy if not exists allow_crud_ai_prompt_templates_authenticated
  on public.ai_prompt_templates
  for insert
  with check (auth.role() = 'authenticated');

create policy if not exists allow_update_ai_prompt_templates_authenticated
  on public.ai_prompt_templates
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy if not exists allow_delete_ai_prompt_templates_authenticated
  on public.ai_prompt_templates
  for delete
  using (auth.role() = 'authenticated');

create policy if not exists allow_select_ai_prompt_versions_authenticated
  on public.ai_prompt_versions
  for select
  using (auth.role() = 'authenticated');

create policy if not exists allow_crud_ai_prompt_versions_authenticated
  on public.ai_prompt_versions
  for insert
  with check (auth.role() = 'authenticated');

create policy if not exists allow_update_ai_prompt_versions_authenticated
  on public.ai_prompt_versions
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy if not exists allow_delete_ai_prompt_versions_authenticated
  on public.ai_prompt_versions
  for delete
  using (auth.role() = 'authenticated');

comment on table public.ai_prompt_templates is 'AI Prompt 模板主表，按分析类型或场景管理模板';
comment on table public.ai_prompt_versions is 'AI Prompt 版本表，支持草稿、发布和回滚';

alter table public.ai_report_runs
  add column if not exists prompt_template_key text,
  add column if not exists prompt_version_id uuid references public.ai_prompt_versions(id) on delete set null,
  add column if not exists prompt_snapshot text,
  add column if not exists rendered_prompt text;

insert into public.ai_prompt_templates (
  template_key,
  name,
  description,
  analysis_type,
  is_active,
  created_by
)
values (
  'daily',
  '日报分析 Prompt',
  '数据看板日报 AI 分析模板，面向运营快速复盘与次日动作建议。',
  'daily',
  true,
  'system'
)
on conflict (template_key) do update
set name = excluded.name,
    description = excluded.description,
    analysis_type = excluded.analysis_type,
    is_active = excluded.is_active;

insert into public.ai_prompt_versions (
  template_id,
  version_no,
  version_label,
  status,
  content,
  change_note,
  published_at,
  created_by,
  created_by_name
)
select
  t.id,
  1,
  'v2-high-spend-ops',
  'published',
  $prompt$【角色】你是一位专业的直播带货广告数据分析师，隶属于交个朋友·广告智投工作台。

【分析类型】日报分析（昨日数据）

【数据范围】{{dateRange}}

【核心投放数据】
- 总花费：¥{{totalCost}}
- 总成交金额：¥{{totalAmount}}
- 总成交笔数：{{totalOrders}}
- ROI：{{roi}}
- 直接ROI：{{directRoi}}
- 盈亏平衡ROI：{{breakevenRoi}}
- 去退ROI：{{returnRoi}}
- 退货率：{{returnRate}}
- 观看次数：{{totalViews}}
- 展现量：{{totalShows}}
- 观看率：{{viewRate}}
- 观看转化率：{{viewConvertRate}}
- 深度互动率：{{deepInteractRate}}
- 总购物车数：{{totalCart}}
- 总预售成交笔数：{{totalPreOrders}}
- 观看成本：¥{{viewCost}}/次
- 订单成本：¥{{orderCost}}/单
- 加购成本：¥{{cartCost}}/次
- 预售订单成本：¥{{preOrderCost}}/单
- 千次展现成本：¥{{cpm}}
- 广告成交占比：{{adOrderRatio}}

【财务数据】
- 业务口径收入：¥{{finRevenue}}
- 成本合计：¥{{finCost}}
- 毛利：¥{{finProfit}}
- 毛利率：{{finMargin}}
- 保量佣金：¥{{finGuarantee}}
- 预估结算线下佣金：¥{{finOffline}}
- 预估结算机构佣金：¥{{finAgency}}
- 直播间红包：¥{{finRedPacket}}
- 严选红包：¥{{finYanxuanRed}}
- 成本结构摘要：{{costStructureSummary}}

【高消耗人群摘要】
- 人群分类：{{highSpendCrowdSummary}}
- 关键具体人群：{{highSpendCrowdNames}}

【淘宝直播参考】
- 成交笔数：{{taobaoOrders}}
- 观看人数：{{taobaoViews}}
- 成交金额：¥{{taobaoGMV}}
- 退款金额：¥{{refundAmount}}
- 场次摘要：{{liveSessionSummary}}

【同比数据（上一天同期）】
- 花费变化：{{yoyCost}}
- 成交金额变化：{{yoyAmount}}
- ROI变化：{{yoyRoi}}

【分析要求】
请按以下顺序输出（使用 Markdown 格式）：
1. **大盘结论**：用2-3句话总结整体表现，明确指出 ROI、去退ROI、毛利率是否健康。
2. **高消耗人群分析**：优先分析花费最高的 1-3 个人群分类，分别判断是“建议增投 / 继续观察 / 建议降投”，并说明原因。
3. **重点人群点名**：结合具体人群名字，点出 2-3 个最关键对象，说明谁值得放量、谁需要收缩。
4. **财务与退款修正**：结合佣金、红包、退款/去退ROI，判断表面 ROI 与真实经营结果是否一致。
5. **明日执行建议**：给出 3-5 条具体动作建议，每条建议要包含“动作 + 对象 + 原因”，优先覆盖预算分配、人群调整和直播承接。

【额外要求】
- 优先关注高消耗人群，低消耗人群只作补充。
- 结论尽量引用已给出的数据，不要空泛。
- 如果某维度数据不足，请明确写“数据不足，暂不下结论”。
- 请用中文输出，结论明确，风格偏运营可执行。$prompt$,
  '内置默认模板初始化。',
  timezone('utc', now()),
  'system',
  'system'
from public.ai_prompt_templates t
where t.template_key = 'daily'
  and not exists (
    select 1
    from public.ai_prompt_versions v
    where v.template_id = t.id
  );