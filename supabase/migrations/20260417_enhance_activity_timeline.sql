-- Enhance ad_plan_activities with hour-level precision, key sessions, and operations actions.

-- Add new columns
alter table public.ad_plan_activities
  add column if not exists start_time text default null,
  add column if not exists end_time text default null,
  add column if not exists key_sessions text default null,
  add column if not exists operations_action text default null;

comment on column public.ad_plan_activities.start_time is 'HH:MM start time within start_date, e.g. 20:00';
comment on column public.ad_plan_activities.end_time is 'HH:MM end time within end_date, e.g. 23:59';
comment on column public.ad_plan_activities.key_sessions is 'Important sessions, e.g. 0513罗场,0520罗场';
comment on column public.ad_plan_activities.operations_action is 'Operations actions, e.g. 发定金红包+100%商品预热';

-- Drop ALL old activity_type constraints so UPDATE can write new values
alter table public.ad_plan_activities
  drop constraint if exists ad_plan_activities_type_allowed,
  drop constraint if exists ad_plan_activities_type_check,
  drop constraint if exists ad_plan_activities_activity_type_check;

-- Migrate existing activity_type values to new naming
update public.ad_plan_activities set activity_type = 'presale_warmup' where activity_type = 'presale';
update public.ad_plan_activities set activity_type = 'presale_balance' where activity_type = 'tail_payment';
update public.ad_plan_activities set activity_type = 'spot_burst' where activity_type = 'special_event';

-- Add new constraint with updated allowed values
alter table public.ad_plan_activities
  add constraint ad_plan_activities_type_allowed check (
    activity_type in (
      'daily',
      'presale_warmup',
      'presale_deposit',
      'presale_balance',
      'spot_warmup',
      'spot_burst'
    )
  );
