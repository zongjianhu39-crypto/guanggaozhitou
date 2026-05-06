-- Add 计划名字 column to dashboard_crowd_daily_summary and update related objects

-- Step 1: Drop the existing primary key constraint
ALTER TABLE public.dashboard_crowd_daily_summary
  DROP CONSTRAINT dashboard_crowd_daily_summary_pkey;

-- Step 2: Add 计划名字 column (nullable first for backfill)
ALTER TABLE public.dashboard_crowd_daily_summary
  ADD COLUMN IF NOT EXISTS "计划名字" text;

-- Step 3: Set default for existing rows (will be refreshed anyway)
UPDATE public.dashboard_crowd_daily_summary
  SET "计划名字" = ''
  WHERE "计划名字" IS NULL;

-- Step 4: Make it NOT NULL
ALTER TABLE public.dashboard_crowd_daily_summary
  ALTER COLUMN "计划名字" SET NOT NULL,
  ALTER COLUMN "计划名字" SET DEFAULT '';

-- Step 5: Add new primary key with 计划名字
ALTER TABLE public.dashboard_crowd_daily_summary
  ADD CONSTRAINT dashboard_crowd_daily_summary_pkey
  PRIMARY KEY ("日期", "人群名字", "计划名字");

-- Step 6: Add index on 计划名字 for plan-type filtering
CREATE INDEX IF NOT EXISTS idx_dashboard_crowd_daily_summary_plan_name
  ON public.dashboard_crowd_daily_summary ("计划名字");

-- Step 7: Update the dashboard_src_super_live view to include 计划id and 计划名字
CREATE OR REPLACE VIEW public.dashboard_src_super_live AS
SELECT t."日期"::date AS "日期",
  to_jsonb(t)->>'花费' AS "花费",
  to_jsonb(t)->>'总成交金额' AS "总成交金额",
  to_jsonb(t)->>'总成交笔数' AS "总成交笔数",
  to_jsonb(t)->>'观看次数' AS "观看次数",
  to_jsonb(t)->>'展现量' AS "展现量",
  to_jsonb(t)->>'直接成交金额' AS "直接成交金额",
  to_jsonb(t)->>'总购物车数' AS "总购物车数",
  to_jsonb(t)->>'总收藏数' AS "总收藏数",
  to_jsonb(t)->>'总预售成交笔数' AS "总预售成交笔数",
  to_jsonb(t)->>'互动量' AS "互动量",
  to_jsonb(t)->>'人群名字' AS "人群名字",
  to_jsonb(t)->>'计划id' AS "计划id",
  to_jsonb(t)->>'计划名字' AS "计划名字"
FROM public.super_live_2025 t
UNION ALL
SELECT t."日期"::date,
  to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数',
  to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额',
  to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数',
  to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字',
  to_jsonb(t)->>'计划id', to_jsonb(t)->>'计划名字'
FROM public.super_live_202601 t
UNION ALL
SELECT t."日期"::date,
  to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数',
  to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额',
  to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数',
  to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字',
  to_jsonb(t)->>'计划id', to_jsonb(t)->>'计划名字'
FROM public.super_live_202602 t
UNION ALL
SELECT t."日期"::date,
  to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数',
  to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额',
  to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数',
  to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字',
  to_jsonb(t)->>'计划id', to_jsonb(t)->>'计划名字'
FROM public.super_live_202603 t
UNION ALL
SELECT t."日期"::date,
  to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数',
  to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额',
  to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数',
  to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字',
  to_jsonb(t)->>'计划id', to_jsonb(t)->>'计划名字'
FROM public.super_live_202604 t
UNION ALL
SELECT t."日期"::date,
  to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数',
  to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额',
  to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数',
  to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字',
  to_jsonb(t)->>'计划id', to_jsonb(t)->>'计划名字'
FROM public.super_live_202605 t
UNION ALL
SELECT t."日期"::date,
  to_jsonb(t)->>'花费', to_jsonb(t)->>'总成交金额', to_jsonb(t)->>'总成交笔数',
  to_jsonb(t)->>'观看次数', to_jsonb(t)->>'展现量', to_jsonb(t)->>'直接成交金额',
  to_jsonb(t)->>'总购物车数', to_jsonb(t)->>'总收藏数', to_jsonb(t)->>'总预售成交笔数',
  to_jsonb(t)->>'互动量', to_jsonb(t)->>'人群名字',
  to_jsonb(t)->>'计划id', to_jsonb(t)->>'计划名字'
FROM public.super_live_202606 t;

-- Step 8: Update the refresh function to include 计划名字
CREATE OR REPLACE FUNCTION public.refresh_dashboard_crowd_summary(p_start_date date, p_end_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at timestamptz := clock_timestamp();
  v_rows integer := 0;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid date range: % ~ %', p_start_date, p_end_date;
  END IF;

  DELETE FROM public.dashboard_crowd_daily_summary WHERE "日期" BETWEEN p_start_date AND p_end_date;

  INSERT INTO public.dashboard_crowd_daily_summary (
    "日期", "人群分类", "人群名字", "计划名字",
    "花费", "总成交金额", "总成交笔数", "观看次数", "展现量",
    "直接成交金额", "总购物车数", "总收藏数", "总预售成交笔数", "互动量",
    source_row_count, updated_at
  )
  SELECT
    "日期",
    public.dashboard_classify_crowd(coalesce(nullif(trim("人群名字"::text), ''), '未命名人群')) AS "人群分类",
    coalesce(nullif(trim("人群名字"::text), ''), '未命名人群') AS "人群名字",
    coalesce(nullif(trim("计划名字"::text), ''), '') AS "计划名字",
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
  FROM public.dashboard_src_super_live
  WHERE "日期" BETWEEN p_start_date AND p_end_date
  GROUP BY "日期", coalesce(nullif(trim("人群名字"::text), ''), '未命名人群'), coalesce(nullif(trim("计划名字"::text), ''), '');

  GET DIAGNOSTICS v_rows = row_count;
  INSERT INTO public.dashboard_summary_refresh_log(module, start_date, end_date, status, row_count, duration_ms)
  VALUES ('crowd', p_start_date, p_end_date, 'success', v_rows, (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.dashboard_summary_refresh_log(module, start_date, end_date, status, duration_ms, error_message)
  VALUES ('crowd', p_start_date, p_end_date, 'failed', (extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer, sqlerrm);
  RAISE;
END;
$$;
