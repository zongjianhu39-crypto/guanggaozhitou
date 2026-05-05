alter table public.audience_repository
  add column if not exists audience_type text not null default 'master',
  add column if not exists parent_audience_id bigint references public.audience_repository(audience_id) on delete set null;

update public.audience_repository
set audience_type = 'master'
where audience_type is null or audience_type not in ('master', 'split');

update public.audience_repository
set parent_audience_id = null
where audience_type = 'master';

alter table public.audience_repository
  drop constraint if exists audience_repository_audience_type_check,
  add constraint audience_repository_audience_type_check
    check (audience_type in ('master', 'split'));

alter table public.audience_repository
  drop constraint if exists audience_repository_split_parent_check,
  add constraint audience_repository_split_parent_check
    check (audience_type = 'master' or parent_audience_id is not null);

alter table public.audience_repository
  drop constraint if exists audience_repository_parent_not_self_check,
  add constraint audience_repository_parent_not_self_check
    check (parent_audience_id is null or parent_audience_id <> audience_id);

create index if not exists idx_audience_repository_type_parent
  on public.audience_repository(audience_type, parent_audience_id);

comment on column public.audience_repository.audience_type is '人群包类型：master=主人群包，split=分裂子人群包';
comment on column public.audience_repository.parent_audience_id is '分裂子人群包所属的主人群包 ID；主人群包为空';
