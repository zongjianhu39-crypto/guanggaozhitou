-- Pipeline table clearing function.
-- Called from the CSV upload pipeline via supabase-py rpc().
-- Only whitelisted CSV data tables can be cleared.

create or replace function public.clear_pipeline_table(
  p_table_name text,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_exists boolean;
  v_deleted_count bigint;
  v_mode text;
begin
  -- 1. Whitelist: only pipeline data tables are allowed
  if p_table_name !~ '^(super_live_|financial_|short_live_link_|live_ad_agent_|single_product_ad_|taobao_live_)\d{4,6}$' then
    return jsonb_build_object(
      'ok', false,
      'error', format('table name ''%s'' not in pipeline whitelist', p_table_name)
    );
  end if;

  -- 2. Table existence check
  select exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = p_table_name
      and n.nspname = 'public'
      and c.relkind = 'r'
  ) into v_table_exists;

  if not v_table_exists then
    return jsonb_build_object(
      'ok', false,
      'error', format('table ''%s'' does not exist', p_table_name)
    );
  end if;

  -- 3. Execute DELETE
  if p_start_date is not null and p_end_date is not null then
    if p_start_date > p_end_date then
      return jsonb_build_object(
        'ok', false,
        'error', format('invalid date range: %s > %s', p_start_date, p_end_date)
      );
    end if;
    execute format('delete from public.%I where "日期" between %L and %L', p_table_name, p_start_date, p_end_date);
    v_mode := 'date_range';
  else
    execute format('delete from public.%I', p_table_name);
    v_mode := 'full';
  end if;

  get diagnostics v_deleted_count = row_count;

  -- 4. Return success
  return jsonb_build_object(
    'ok', true,
    'table', p_table_name,
    'deleted_rows', v_deleted_count,
    'mode', v_mode
  );

exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', sqlerrm
  );
end;
$$;

-- Only service_role should be able to call this function
revoke execute on function public.clear_pipeline_table(text, date, date) from anon, authenticated;

comment on function public.clear_pipeline_table is 'Pipeline table clearing function. Only whitelisted CSV data tables can be cleared. Called from the CSV upload pipeline via supabase-py rpc().';
