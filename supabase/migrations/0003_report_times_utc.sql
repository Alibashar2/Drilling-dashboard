-- Report clock times -> real UTC instants (runs once).
--
-- Before this migration the report reader stored the clock time written in a drilling report (rig local time, Asia/Baghdad)
-- as if it were UTC: an entry printed "6:00 PM" was stored as 18:00Z. Timestamps are now stored as real UTC instants and shown
-- in Asia/Baghdad, so the rows imported before are converted once: 18:00Z becomes 15:00Z, which is 18:00 Asia/Baghdad - the
-- time the report shows. The conversion uses PostgreSQL's IANA zone rules (no fixed hour offset).
--
-- Only times that came from the reports (or were typed on the report clock) are converted. Times the database or the browser
-- generated as real UTC are not touched: created_at, updated_at, activity_log.ts, corrected_at, first_shown_at, comments.
-- Report dates (daily_reports.report_date, well dates) are calendar dates and do not change.
--
-- The whole block is one statement, so it is atomic, and the app_settings marker makes it run only once per database
-- (it is applied on every start by the embedded database; on Supabase run it once with the other migrations).
-- Columns with a uniqueness constraint (operations.start_at) are moved in two steps so no row collides with another mid-update.
do $$
declare
  far constant interval := interval '5000 years';
begin
  if exists (select 1 from app_settings where key = 'migration.report_times_utc') then
    return;
  end if;

  update drilling_records      set ts          = (ts          at time zone 'UTC') at time zone 'Asia/Baghdad';
  update drilling_problems     set occurred_at = (occurred_at at time zone 'UTC') at time zone 'Asia/Baghdad' where occurred_at is not null;
  update extracted_parameters  set occurred_at = (occurred_at at time zone 'UTC') at time zone 'Asia/Baghdad' where occurred_at is not null;
  update bha_runs              set start_at    = (start_at    at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   end_at      = (end_at      at time zone 'UTC') at time zone 'Asia/Baghdad';
  update casing_strings        set run_start   = (run_start   at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   run_end     = (run_end     at time zone 'UTC') at time zone 'Asia/Baghdad';
  update operations            set start_at    = start_at + far;
  update operations            set start_at    = ((start_at - far) at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   end_at      = (end_at      at time zone 'UTC') at time zone 'Asia/Baghdad';
  update drilling_tools        set installed_at = (installed_at at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   retrieved_at = (retrieved_at at time zone 'UTC') at time zone 'Asia/Baghdad';
  update cementing_events      set start_at    = (start_at    at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   end_at      = (end_at      at time zone 'UTC') at time zone 'Asia/Baghdad';
  update hole_sections         set drill_start = (drill_start at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   drill_end   = (drill_end   at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   start_at    = (start_at    at time zone 'UTC') at time zone 'Asia/Baghdad',
                                   end_at      = (end_at      at time zone 'UTC') at time zone 'Asia/Baghdad';
  update simulation_sessions   set playhead_ts = (playhead_ts at time zone 'UTC') at time zone 'Asia/Baghdad' where playhead_ts is not null;

  insert into app_settings (key, value)
  values ('migration.report_times_utc', jsonb_build_object('time_zone', 'Asia/Baghdad', 'applied_at', now()));
end $$;
