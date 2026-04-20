-- Dashboard summary tables and refresh functions.
-- Run this in Supabase SQL Editor before switching dashboard-data to summary tables.

create or replace function public.dashboard_to_numeric(value text)
returns numeric
language sql
immutable
as $$
  with cleaned as (
    select regexp_replace(coalesce(value, ''), '[^0-9.\-]', '', 'g') as value
  )
  select case
    when value ~ '^-?[0-9]+(\.[0-9]+)?$' then value::numeric
    else 0
  end
  from cleaned;
$$;

create table if not exists public.dashboard_ads_daily_summary (
  "日期" date primary key,
  "花费" numeric not null default 0,
  "总成交金额" numeric not null default 0,
  "总成交笔数" numeric not null default 0,
  "观看次数" numeric not null default 0,
  "展现量" numeric not null default 0,
  "直接成交金额" numeric not null default 0,
  "总购物车数" numeric not null default 0,
  "总收藏数" numeric not null default 0,
  "总预售成交笔数" numeric not null default 0,
  "互动量" numeric not null default 0,
  "保量佣金" numeric not null default 0,
  "预估结算线下佣金" numeric not null default 0,
  "预估结算机构佣金" numeric not null default 0,
  "直播间红包" numeric not null default 0,
  "严选红包" numeric not null default 0,
  "淘宝直播成交笔数" numeric not null default 0,
  "淘宝直播成交金额" numeric not null default 0,
  "淘宝直播退款金额" numeric not null default 0,
  source_super_live_rows integer not null default 0,
  source_financial_rows integer not null default 0,
  source_taobao_rows integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.dashboard_crowd_daily_summary (
  "日期" date not null,
  "人群分类" text not null,
  "人群名字" text not null,
  "花费" numeric not null default 0,
  "总成交金额" numeric not null default 0,
  "总成交笔数" numeric not null default 0,
  "观看次数" numeric not null default 0,
  "展现量" numeric not null default 0,
  "直接成交金额" numeric not null default 0,
  "总购物车数" numeric not null default 0,
  "总收藏数" numeric not null default 0,
  "总预售成交笔数" numeric not null default 0,
  "互动量" numeric not null default 0,
  source_row_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key ("日期", "人群名字")
);

create index if not exists idx_dashboard_crowd_daily_summary_category
  on public.dashboard_crowd_daily_summary ("人群分类");

create table if not exists public.dashboard_single_product_daily_summary (
  "日期" date not null,
  "商品id" text not null,
  "商品名称" text,
  img_url text,
  "花费" numeric not null default 0,
  "直接成交笔数" numeric not null default 0,
  "直接成交金额" numeric not null default 0,
  "该商品直接成交笔数" numeric not null default 0,
  "该商品直接成交金额" numeric not null default 0,
  "该商品加购数" numeric not null default 0,
  "该商品收藏数" numeric not null default 0,
  "观看人数" numeric not null default 0,
  source_row_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key ("日期", "商品id")
);

create index if not exists idx_dashboard_single_product_daily_summary_name
  on public.dashboard_single_product_daily_summary ("商品名称");

create table if not exists public.dashboard_summary_refresh_log (
  id bigserial primary key,
  module text not null,
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('success', 'failed')),
  row_count integer not null default 0,
  duration_ms integer not null default 0,
  error_message text,
  refreshed_at timestamptz not null default now()
);

create or replace view public.dashboard_src_super_live as
select t."日期"::date as "日期", to_jsonb(t)->>'花费' as "花费", to_jsonb(t)->>'总成交金额' as "总成交金额", to_jsonb(t)->>'总成交笔数' as "总成交笔数", to_jsonb(t)->>'观看次数' as "观看次数", to_jsonb(t)->>'展现量' as "展现量", to_jsonb(t)->>'直接成交金额' as "直接成交金额", to_jsonb(t)->>'总购物车数' as "总购物车数", to_jsonb(t)->>'总收藏数' as "总收藏数", to_jsonb(t)->>'总预售成交笔数' as "总预售成交笔数", to_jsonb(t)->>'互动量' as "互动量", to_jsonb(t)->>'人群名字' as "人群名字" from public.super_live_2025 t
union all select t."日期"::date, to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数', to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额', to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数', to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字' from public.super_live_202601 t
union all select t."日期"::date, to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数', to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额', to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数', to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字' from public.super_live_202602 t
union all select t."日期"::date, to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数', to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额', to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数', to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字' from public.super_live_202603 t
union all select t."日期"::date, to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数', to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额', to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数', to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字' from public.super_live_202604 t
union all select t."日期"::date, to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数', to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额', to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数', to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字' from public.super_live_202605 t
union all select t."日期"::date, to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数', to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额', to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数', to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字' from public.super_live_202606 t;

create or replace view public.dashboard_src_financial as
select t."日期"::date as "日期", to_jsonb(t)->>'保量佣金' as "保量佣金", to_jsonb(t)->>'预估结算线下佣金' as "预估结算线下佣金", to_jsonb(t)->>'预估结算机构佣金' as "预估结算机构佣金", to_jsonb(t)->>'直播间红包' as "直播间红包", to_jsonb(t)->>'严选红包' as "严选红包" from public.financial_2025 t
union all select t."日期"::date, to_jsonb(t)->>'保量佣金', to_jsonb(t)->>'预估结算线下佣金', to_jsonb(t)->>'预估结算机构佣金', to_jsonb(t)->>'直播间红包', to_jsonb(t)->>'严选红包' from public.financial_2026 t;

create or replace view public.dashboard_src_taobao_live as
select t."日期"::date as "日期", to_jsonb(t)->>'成交笔数' as "成交笔数", to_jsonb(t)->>'退款金额' as "退款金额", to_jsonb(t)->>'成交金额' as "成交金额" from public.taobao_live_2025 t
union all select t."日期"::date, to_jsonb(t)->>'成交笔数', to_jsonb(t)->>'退款金额', to_jsonb(t)->>'成交金额' from public.taobao_live_2026 t;

create or replace view public.dashboard_src_single_product_ad as
select t."日期"::date as "日期", to_jsonb(t)->>'商品id' as "商品id", to_jsonb(t)->>'商品名称' as "商品名称", to_jsonb(t)->>'img_url' as img_url, to_jsonb(t)->>'花费' as "花费", to_jsonb(t)->>'直接成交笔数' as "直接成交笔数", to_jsonb(t)->>'直接成交金额' as "直接成交金额", to_jsonb(t)->>'该商品直接成交笔数' as "该商品直接成交笔数", to_jsonb(t)->>'该商品直接成交金额' as "该商品直接成交金额", to_jsonb(t)->>'该商品加购数' as "该商品加购数", to_jsonb(t)->>'该商品收藏数' as "该商品收藏数", to_jsonb(t)->>'观看人数' as "观看人数" from public.single_product_ad_2025 t
union all select t."日期"::date, to_jsonb(t)->>'商品id', to_jsonb(t)->>'商品名称', to_jsonb(t)->>'img_url', to_jsonb(t)->>'花费', to_jsonb(t)->>'直接成交笔数', to_jsonb(t)->>'直接成交金额', to_jsonb(t)->>'该商品直接成交笔数', to_jsonb(t)->>'该商品直接成交金额', to_jsonb(t)->>'该商品加购数', to_jsonb(t)->>'该商品收藏数', to_jsonb(t)->>'观看人数' from public.single_product_ad_2026 t;

create or replace function public.dashboard_classify_crowd(crowd_name text)
returns text
language sql
immutable
as $$
  with source as (select trim(coalesce(crowd_name, '')) as name)
  select case
    when name = '' then '未知'
    when name = '智能推荐人群' or name like '智能竞争直播间:%' then '纯黑盒'
    when name like '自定义竞争宝贝:%' then '灰盒_竞争宝贝'
    when name like '自定义竞争店铺:%' then '灰盒_竞争店铺'
    when name like '自定义竞争直播间:%' then '灰盒_竞争直播间'
    when name like '%复购老客%' or name like '%未通知到人群%' or name like '%购买人群%' or name like '%活跃成交%' or name like '%活跃复购%' then '老客'
    when name like '粉丝人群:%' or name like '喜欢我的直播:%' or name like '喜欢我的短视频:%' or name like '%加购人群%' or name like '%兴趣新客%' or name like '%访问新客%' or name like '%浏览%' then '兴趣新客'
    when name like '%首购新客%' or name like '%差老客%' or name like '%付定人群%' or name like '%流失%' or name like '%竞店人群%' then '新客'
    when name like '精选人群:%' or name like '达摩盘人群:%' then
      case
        when name like '%活跃复购%' or name like '%活跃成交%' or name like '%活跃下降%' or name like '%即将流失%' or name like '%差直播间老客%' or name like '%差老客%' or name like '%购买人群%' then '老客'
        when name like '%加购人群%' or name like '%兴趣新客%' or name like '%访问新客%' or name like '%浏览%' then '兴趣新客'
        when name like '%首购新客%' or name like '%未购%' or name like '%流失%' or name like '%竞店人群%' or name like '%付定人群%' then '新客'
        when name like '%宠物清洁%' or name like '%直播低退%' or name like '%达人带货品牌%' then '灰盒_竞争宝贝'
        else '灰盒'
      end
    when name like '%活跃%' then '新客'
    else '未知'
  end
  from source;
$$;

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
    union select "日期" from financial_daily
    union select "日期" from taobao_daily
  )
  insert into public.dashboard_ads_daily_summary (
    "日期", "花费", "总成交金额", "总成交笔数", "观看次数", "展现量", "直接成交金额", "总购物车数", "总收藏数", "总预售成交笔数", "互动量",
    "保量佣金", "预估结算线下佣金", "预估结算机构佣金", "直播间红包", "严选红包",
    "淘宝直播成交笔数", "淘宝直播成交金额", "淘宝直播退款金额",
    source_super_live_rows, source_financial_rows, source_taobao_rows, updated_at
  )
  select d."日期",
    coalesce(s.cost, 0), coalesce(s.amount, 0), coalesce(s.orders, 0), coalesce(s.views, 0), coalesce(s.shows, 0),
    coalesce(s.direct_amount, 0), coalesce(s.cart, 0), coalesce(s.fav, 0), coalesce(s.pre_orders, 0), coalesce(s.interactions, 0),
    coalesce(f.guarantee, 0), coalesce(f.offline, 0), coalesce(f.agency, 0), coalesce(f.red_packet, 0), coalesce(f.yanxuan_red, 0),
    coalesce(t.taobao_orders, 0), coalesce(t.taobao_amount, 0), coalesce(t.taobao_refund, 0),
    coalesce(s.source_rows, 0), coalesce(f.source_rows, 0), coalesce(t.source_rows, 0), now()
  from all_dates d
  left join super_daily s using ("日期")
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
  from public.dashboard_src_super_live
  where "日期" between p_start_date and p_end_date
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

create or replace function public.refresh_dashboard_single_product_summary(p_start_date date, p_end_date date)
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

  delete from public.dashboard_single_product_daily_summary where "日期" between p_start_date and p_end_date;

  with raw as (
    select
      "日期",
      coalesce(nullif(trim("商品id"::text), ''), nullif(trim("商品名称"::text), ''), 'unknown') as product_id,
      nullif(trim("商品名称"::text), '') as product_name,
      nullif(trim(img_url::text), '') as product_img_url,
      "花费", "直接成交笔数", "直接成交金额", "该商品直接成交笔数", "该商品直接成交金额", "该商品加购数", "该商品收藏数", "观看人数"
    from public.dashboard_src_single_product_ad
    where "日期" between p_start_date and p_end_date
  )
  insert into public.dashboard_single_product_daily_summary (
    "日期", "商品id", "商品名称", img_url, "花费", "直接成交笔数", "直接成交金额", "该商品直接成交笔数", "该商品直接成交金额", "该商品加购数", "该商品收藏数", "观看人数", source_row_count, updated_at
  )
  select
    "日期",
    product_id,
    max(product_name),
    max(product_img_url),
    sum(public.dashboard_to_numeric("花费"::text)),
    sum(public.dashboard_to_numeric("直接成交笔数"::text)),
    sum(public.dashboard_to_numeric("直接成交金额"::text)),
    sum(public.dashboard_to_numeric("该商品直接成交笔数"::text)),
    sum(public.dashboard_to_numeric("该商品直接成交金额"::text)),
    sum(public.dashboard_to_numeric("该商品加购数"::text)),
    sum(public.dashboard_to_numeric("该商品收藏数"::text)),
    sum(public.dashboard_to_numeric("观看人数"::text)),
    count(*)::integer,
    now()
  from raw
  group by "日期", product_id;

  get diagnostics v_rows = row_count;
  insert into public.dashboard_summary_refresh_log(module, start_date, end_date, status, row_count, duration_ms)
  values ('single', p_start_date, p_end_date, 'success', v_rows, (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer);
exception when others then
  insert into public.dashboard_summary_refresh_log(module, start_date, end_date, status, duration_ms, error_message)
  values ('single', p_start_date, p_end_date, 'failed', (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer, sqlerrm);
  raise;
end;
$$;

create or replace function public.refresh_dashboard_summary(
  p_start_date date,
  p_end_date date,
  p_module text default 'all'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module text := lower(coalesce(nullif(trim(p_module), ''), 'all'));
begin
  if v_module not in ('all', 'ads', 'crowd', 'single') then
    raise exception 'invalid dashboard summary module: %', p_module;
  end if;

  if v_module in ('all', 'ads') then
    perform public.refresh_dashboard_ads_summary(p_start_date, p_end_date);
  end if;

  if v_module in ('all', 'crowd') then
    perform public.refresh_dashboard_crowd_summary(p_start_date, p_end_date);
  end if;

  if v_module in ('all', 'single') then
    perform public.refresh_dashboard_single_product_summary(p_start_date, p_end_date);
  end if;
end;
$$;

-- Backfill examples:
-- select public.refresh_dashboard_summary('2025-01-01', '2025-12-31', 'all');
-- select public.refresh_dashboard_summary('2026-01-01', '2026-04-16', 'all');
--
-- Check results:
-- select * from public.dashboard_summary_refresh_log order by refreshed_at desc limit 20;
-- select count(*) from public.dashboard_ads_daily_summary;
-- select count(*) from public.dashboard_crowd_daily_summary;
-- select count(*) from public.dashboard_single_product_daily_summary;
