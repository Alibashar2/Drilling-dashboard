-- ============================================================================
-- Supabase-only: link public.users to auth.users, row-level security, storage.
-- Run AFTER 0001_schema.sql in the Supabase SQL editor (or `supabase db push`).
-- Not applied to the embedded PGlite database.
-- ============================================================================

-- public.users.id mirrors auth.users.id
alter table public.users drop constraint if exists users_auth_fk;
alter table public.users
  add constraint users_auth_fk foreign key (id) references auth.users(id) on delete cascade;

-- Create a profile row on sign-up. The very first account becomes Administrator.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when not exists (select 1 from public.users) then 'admin' else 'viewer' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  -- Tables every signed-in user may read; Engineers and Administrators may write.
  foreach t in array array[
    'wells','import_batches','well_sections','formations','formation_intervals',
    'drilling_activities','drilling_records','survey_stations','problem_categories',
    'drilling_problems','corrective_actions','problem_attachments','historical_alerts',
    'daily_reports','offset_comparisons','app_settings','activity_log','term_dictionary','extracted_parameters',
    'operation_categories','operation_types','bha_runs','casing_strings','operations','drilling_tools','cementing_events','hole_sections','simulation_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.app_role() in (''admin'',''engineer'')) with check (public.app_role() in (''admin'',''engineer''))',
      t || '_write', t);
  end loop;
end $$;

-- Only Administrators may delete wells.
drop policy if exists wells_admin_delete on public.wells;
create policy wells_admin_delete on public.wells as restrictive for delete to authenticated
  using (public.app_role() = 'admin');

-- Users: everyone signed in can read; only Administrators can change roles.
alter table public.users enable row level security;
drop policy if exists users_read on public.users;
drop policy if exists users_admin_write on public.users;
create policy users_read on public.users for select to authenticated using (true);
create policy users_admin_write on public.users for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- Simulation sessions: each user owns their own row.
alter table public.simulation_sessions enable row level security;
drop policy if exists sim_own on public.simulation_sessions;
create policy sim_own on public.simulation_sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------ Storage
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists attachments_read on storage.objects;
drop policy if exists attachments_write on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
create policy attachments_write on storage.objects for all to authenticated
  using (bucket_id = 'attachments' and public.app_role() in ('admin','engineer'))
  with check (bucket_id = 'attachments' and public.app_role() in ('admin','engineer'));
