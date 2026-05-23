-- 将短直联动数据并入 dashboard 汇总视图和刷新函数
-- 短直联动与超级直播同属万相台，应在 ads 和 crowd 汇总中合并统计

-- 1. 增加短直联动行数追踪列
alter table public.dashboard_ads_daily_summary
  add column if not exists source_short_live_rows integer not null default 0;

-- 2. 创建短直联动源数据视图（列名映射到 super_live 标准）
create or replace view public.dashboard_src_short_live_link as
select
  t."日期"::date as "日期",
  to_jsonb(t)->>'花费' as "花费",
  to_jsonb(t)->>'直播总观看次数' as "观看次数",
  to_jsonb(t)->>'内容展现次数' as "展现量",
  to_jsonb(t)->>'总成交金额' as "总成交金额",
  to_jsonb(t)->>'总成交笔数' as "总成交笔数",
  to_jsonb(t)->>'直接成交金额' as "直接成交金额",
  to_jsonb(t)->>'总购物车数' as "总购物车数",
  to_jsonb(t)->>'总收藏数' as "总收藏数",
  to_jsonb(t)->>'总预售成交笔数' as "总预售成交笔数",
  to_jsonb(t)->>'互动量' as "互动量",
  coalesce(to_jsonb(t)->>'人群名字', '') as "人群名字"
from public.short_live_link_2026 t;

-- 3. 重建 ads 汇总刷新函数，加入短直联动
create or replace function public.refresh_dashboard_ads_summary(p_start_date date, p_end_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_rows integer := 0;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'invalid date range: % ~ %', p_start_date, p_end_date;
  end if;

  delete from public.dashboard_ads_daily_summary where "日期" between p_start_date and p_end_date;

  with super_daily as (
    select "日期",
      sum(public.dashboard_to_numeric("花费"::text)) as cost,
      sum(public.dashboard_to_numeric("总成交金额"::text)) as amount,
      sum(public.dashboard_to_numeric("总成交笔数"::text)) as orders,
      sum(public.dashboard_to_numeric("观看次数"::text)) as views,
      sum(public.dashboard_to_numeric("展现量"::text)) as shows,
      sum(public.dashboard_to_numeric("直接成交金额"::text)) as direct_amount,
      sum(public.dashboard_to_numeric("总购物车数"::text)) as cart,
      sum(public.dashboard_to_numeric("总收藏数"::text)) as fav,
      sum(public.dashboard_to_numeric("总预售成交笔数"::text)) as pre_orders,
      sum(public.dashboard_to_numeric("互动量"::text)) as interactions,
      count(*)::integer as source_rows
    from public.dashboard_src_super_live
    where "日期" between p_start_date and p_end_date
    group by "日期"
  ),
  short_live_daily as (
    select "日期",
      sum(public.dashboard_to_numeric("花费"::text)) as cost,
      sum(public.dashboard_to_numeric("总成交金额"::text)) as amount,
      sum(public.dashboard_to_numeric("总成交笔数"::text)) as orders,
      sum(public.dashboard_to_numeric("观看次数"::text)) as views,
      sum(public.dashboard_to_numeric("展现量"::text)) as shows,
      sum(public.dashboard_to_numeric("直接成交金额"::text)) as direct_amount,
      sum(public.dashboard_to_numeric("总购物车数"::text)) as cart,
      sum(public.dashboard_to_numeric("总收藏数"::text)) as fav,
      sum(public.dashboard_to_numeric("总预售成交笔数"::text)) as pre_orders,
      sum(public.dashboard_to_numeric("互动量"::text)) as interactions,
      count(*)::integer as source_rows
    from public.dashboard_src_short_live_link
    where "日期" between p_start_date and p_end_date
    group by "日期"
  ),
  financial_daily as (
    select "日期",
      sum(public.dashboard_to_numeric("保量佣金"::text)) as guarantee,
      sum(public.dashboard_to_numeric("预估结算线下佣金"::text)) as offline,
      sum(public.dashboard_to_numeric("预估结算机构佣金"::text)) as agency,
      sum(public.dashboard_to_numeric("直播间红包"::text)) as red_packet,
      sum(public.dashboard_to_numeric("严选红包"::text)) as yanxuan_red,
      count(*)::integer as source_rows
    from public.dashboard_src_financial
    where "日期" between p_start_date and p_end_date
    group by "日期"
  ),
  taobao_daily as (
    select "日期",
      sum(public.dashboard_to_numeric("成交笔数"::text)) as taobao_orders,
      sum(public.dashboard_to_numeric("成交金额"::text)) as taobao_amount,
      sum(public.dashboard_to_numeric("退款金额"::text)) as taobao_refund,
      count(*)::integer as source_rows
    from public.dashboard_src_taobao_live
    where "日期" between p_start_date and p_end_date
    group by "日期"
  ),
  all_dates as (
    select "日期" from super_daily
    union select "日期" from short_live_daily
    union select "日期" from financial_daily
    union select "日期" from taobao_daily
  )
  insert into public.dashboard_ads_daily_summary (
    "日期", "花费", "总成交金额", "总成交笔数", "观看次数", "展现量", "直接成交金额", "总购物车数", "总收藏数", "总预售成交笔数", "互动量",
    "保量佣金", "预估结算线下佣金", "预估结算机构佣金", "直播间红包", "严选红包",
    "淘宝直播成交笔数", "淘宝直播成交金额", "淘宝直播退款金额",
    source_super_live_rows, source_short_live_rows, source_financial_rows, source_taobao_rows, updated_at
  )
  select d."日期",
    coalesce(s.cost, 0) + coalesce(sl.cost, 0),
    coalesce(s.amount, 0) + coalesce(sl.amount, 0),
    coalesce(s.orders, 0) + coalesce(sl.orders, 0),
    coalesce(s.views, 0) + coalesce(sl.views, 0),
    coalesce(s.shows, 0) + coalesce(sl.shows, 0),
    coalesce(s.direct_amount, 0) + coalesce(sl.direct_amount, 0),
    coalesce(s.cart, 0) + coalesce(sl.cart, 0),
    coalesce(s.fav, 0) + coalesce(sl.fav, 0),
    coalesce(s.pre_orders, 0) + coalesce(sl.pre_orders, 0),
    coalesce(s.interactions, 0) + coalesce(sl.interactions, 0),
    coalesce(f.guarantee, 0), coalesce(f.offline, 0), coalesce(f.agency, 0), coalesce(f.red_packet, 0), coalesce(f.yanxuan_red, 0),
    coalesce(t.taobao_orders, 0), coalesce(t.taobao_amount, 0), coalesce(t.taobao_refund, 0),
    coalesce(s.source_rows, 0), coalesce(sl.source_rows, 0), coalesce(f.source_rows, 0), coalesce(t.source_rows, 0), now()
  from all_dates d
  left join super_daily s using ("日期")
  left join short_live_daily sl using ("日期")
  left join financial_daily f using ("日期")
  left join taobao_daily t using ("日期");

  get diagnostics v_rows = row_count;
  insert into public.dashboard_summary_refresh_log(module, start_date, end_date, status, row_count, duration_ms)
  values ('ads', p_start_date, p_end_date, 'success', v_rows, (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer);
exception when others then
  insert into public.dashboard_summary_refresh_log(module, start_date, end_date, status, duration_ms, error_message)
  values ('ads', p_start_date, p_end_date, 'failed', (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer, sqlerrm);
  raise;
end;
$$;

-- 4. 重建 crowd 汇总刷新函数，加入短直联动
create or replace function public.refresh_dashboard_crowd_summary(p_start_date date, p_end_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_rows integer := 0;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'invalid date range: % ~ %', p_start_date, p_end_date;
  end if;

  delete from public.dashboard_crowd_daily_summary where "日期" between p_start_date and p_end_date;

  insert into public.dashboard_crowd_daily_summary (
    "日期", "人群分类", "人群名字", "花费", "总成交金额", "总成交笔数", "观看次数", "展现量", "直接成交金额", "总购物车数", "总收藏数", "总预售成交笔数", "互动量", source_row_count, updated_at
  )
  select
    "日期",
    public.dashboard_classify_crowd(coalesce(nullif(trim("人群名字"::text), ''), '未命名人群')) as "人群分类",
    coalesce(nullif(trim("人群名字"::text), ''), '未命名人群') as "人群名字",
    sum(public.dashboard_to_numeric("花费"::text)),
    sum(public.dashboard_to_numeric("总成交金额"::text)),
    sum(public.dashboard_to_numeric("总成交笔数"::text)),
    sum(public.dashboard_to_numeric("观看次数"::text)),
    sum(public.dashboard_to_numeric("展现量"::text)),
    sum(public.dashboard_to_numeric("直接成交金额"::text)),
    sum(public.dashboard_to_numeric("总购物车数"::text)),
    sum(public.dashboard_to_numeric("总收藏数"::text)),
    sum(public.dashboard_to_numeric("总预售成交笔数"::text)),
    sum(public.dashboard_to_numeric("互动量"::text)),
    count(*)::integer,
    now()
  from (
    select "日期", "花费", "总成交金额", "总成交笔数", "观看次数", "展现量", "直接成交金额", "总购物车数", "总收藏数", "总预售成交笔数", "互动量", "人群名字"
    from public.dashboard_src_super_live
    where "日期" between p_start_date and p_end_date
    union all
    select "日期", "花费", "总成交金额", "总成交笔数", "观看次数", "展现量", "直接成交金额", "总购物车数", "总收藏数", "总预售成交笔数", "互动量", "人群名字"
    from public.dashboard_src_short_live_link
    where "日期" between p_start_date and p_end_date
  ) combined
  group by "日期", coalesce(nullif(trim("人群名字"::text), ''), '未命名人群');

  get diagnostics v_rows = row_count;
  insert into public.dashboard_summary_refresh_log(module, start_date, end_date, status, row_count, duration_ms)
  values ('crowd', p_start_date, p_end_date, 'success', v_rows, (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer);
exception when others then
  insert into public.dashboard_summary_refresh_log(module, start_date, end_date, status, duration_ms, error_message)
  values ('crowd', p_start_date, p_end_date, 'failed', (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer, sqlerrm);
  raise;
end;
$$;
