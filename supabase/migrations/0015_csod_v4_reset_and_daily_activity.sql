-- CSOD Survey v4 reset and normalized daily-activity schedule.
-- This migration runs after pending migration 0014 (which executes first)
-- and establishes the final canonical v4 question state.
--
-- Drops application-owned participant and submission data while retaining
-- cities, zones, question definitions, and admin role assignments.
--
-- IMPORTANT RESTRICTIONS APPLIED:
-- - Recreates all publication, withdrawal, and moderation triggers against new tables.
-- - Provides serialized, interval-based schedule overlap validation with submission locks.
-- - Enforces minute-level time precision and exact overnight duration calculation.
-- - Preserves JSON schedule-entry ordering deterministically via array ordinality.
-- - Safely creates and activates only the canonical v4 survey question set.
-- - Strengthens submission validation for payload structure, question membership,
--   checkbox constraints, allowed values, and permitted schedule categories.
-- - Enforces row-level security and strict service-role permissions.

begin;

-- =========================================================================
-- §1  Drop obsolete triggers and data tables (CASCADE removes dependent constraints)
-- =========================================================================

drop table if exists public.participant_sessions cascade;
drop table if exists public.participant_verification_tokens cascade;
drop table if exists public.participant_verification_rate_limits cascade;
drop table if exists public.submission_email_notifications cascade;
drop table if exists public.daily_activity_entries cascade;
drop table if exists public.survey_answers cascade;
drop table if exists public.consent_records cascade;
drop table if exists public.survey_submissions cascade;
drop table if exists public.participant_submission_sequences cascade;
drop table if exists public.participant_city_sequences cascade;
drop table if exists public.participants cascade;

-- Drop legacy sequence and enum types if they exist
drop sequence if exists public.consent_event_sequence cascade;
drop type if exists public.consent_event cascade;
drop type if exists public.consent_event_provenance cascade;

-- =========================================================================
-- §2  Drop obsolete functions
-- =========================================================================

drop function if exists public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean) cascade;
drop function if exists public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean, jsonb) cascade;
drop function if exists public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean, boolean, jsonb) cascade;
drop function if exists public.admin_hide_submission(uuid) cascade;
drop function if exists public.admin_restore_submission(uuid) cascade;
drop function if exists public.admin_set_moderation(uuid, public.moderation_status) cascade;
drop function if exists public.register_participant(text, uuid, uuid, text, timestamptz) cascade;
drop function if exists public.next_participant_id(uuid) cascade;
drop function if exists public.next_submission_number(uuid) cascade;
drop function if exists public.consume_participant_verification_token(text, text, timestamptz) cascade;
drop function if exists public.consume_participant_verification_rate_limit(text, integer, integer) cascade;
drop function if exists public.validate_submission_zone() cascade;
drop function if exists public.validate_submission_relationships() cascade;
drop function if exists public.validate_answer_relationships() cascade;
drop function if exists public.validate_consent_relationship() cascade;
drop function if exists public.validate_consent_event() cascade;
drop function if exists public.enforce_public_visibility_consent() cascade;
drop function if exists public.revoke_public_visibility_on_withdrawal() cascade;
drop function if exists public.revoke_public_visibility_on_consent_event() cascade;
drop function if exists public.auto_publish_on_consent_grant() cascade;
drop function if exists public.sync_public_visibility_on_consent_event() cascade;
drop function if exists public.prevent_answered_question_delete() cascade;
drop function if exists public.prevent_question_definition_mutation() cascade;
drop function if exists public.prevent_question_scope_change() cascade;
drop function if exists public.lock_consent_stream(uuid, uuid, public.consent_type) cascade;
drop function if exists public.validate_linear_scale_answer() cascade;
drop function if exists public.validate_daily_activity_entry() cascade;
drop function if exists public.prevent_consent_history_mutation() cascade;

-- =========================================================================
-- §3  Recreate core data tables
-- =========================================================================

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  public_participant_id text not null unique,
  email text not null unique,
  email_verified boolean not null default false,
  email_verified_at timestamptz,
  city_id uuid references public.cities(id) on delete restrict,
  contact_opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participants_email_not_blank check (btrim(email) <> '')
);

create table public.participant_city_sequences (
  city_id uuid primary key references public.cities(id) on delete cascade,
  next_value bigint not null default 1 check (next_value > 0)
);

create table public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.survey_submissions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  city_id uuid not null references public.cities(id) on delete restrict,
  zone_id uuid not null references public.city_zones(id) on delete restrict,
  submission_date date not null,
  submission_number integer not null check (submission_number > 0),
  survey_version text not null,
  moderation_status public.moderation_status not null default 'approved',
  public_visibility boolean not null default false,
  admin_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (participant_id, submission_number)
);

create table public.participant_submission_sequences (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  next_value bigint not null default 1 check (next_value > 0)
);

create table public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.survey_submissions(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete restrict,
  answer jsonb not null,
  created_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create type public.consent_event as enum ('granted', 'declined', 'withdrawn');
create type public.consent_event_provenance as enum ('legacy_ambiguous', 'legacy_migrated', 'new_event');

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  submission_id uuid references public.survey_submissions(id) on delete cascade,
  consent_type public.consent_type not null,
  consent_version text not null,
  consent_event public.consent_event not null,
  event_provenance public.consent_event_provenance not null default 'new_event',
  event_sequence bigint generated always as identity unique,
  created_at timestamptz not null default now()
);

create table public.daily_activity_entries (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.survey_submissions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  start_time time not null,
  end_time time not null,
  location_category text not null,
  location_other text,
  activity_category text not null,
  activity_other text,
  duration_minutes integer generated always as (
    case
      when end_time > start_time
        then (
          extract(hour from end_time)::integer * 60
          + extract(minute from end_time)::integer
          - extract(hour from start_time)::integer * 60
          - extract(minute from start_time)::integer
        )
      else (
        1440
        - extract(hour from start_time)::integer * 60
        - extract(minute from start_time)::integer
        + extract(hour from end_time)::integer * 60
        + extract(minute from end_time)::integer
      )
    end
  ) stored,
  created_at timestamptz not null default now(),
  unique (submission_id, sequence),
  constraint daily_activity_minute_precision check (
    extract(second from start_time) = 0
    and extract(second from end_time) = 0
  ),
  constraint daily_activity_times_differ check (start_time <> end_time),
  constraint daily_activity_location check (
    location_category in (
      'Home', 'Road / Commuting', 'Office / Workplace',
      'School / College', 'Outdoor public space / Park',
      'Market / Commercial area', 'Industrial / Construction area', 'Other'
    )
  ),
  constraint daily_activity_location_other check (
    location_category <> 'Other' or nullif(btrim(location_other), '') is not null
  ),
  constraint daily_activity_activity check (
    activity_category in (
      'Sleeping / Resting', 'Indoor work / Studying', 'Commuting',
      'Walking / Exercising', 'Outdoor work', 'Shopping / Errands',
      'Household activities', 'Other'
    )
  ),
  constraint daily_activity_activity_other check (
    activity_category <> 'Other' or nullif(btrim(activity_other), '') is not null
  )
);

create table public.submission_email_notifications (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.survey_submissions(id) on delete cascade,
  status text not null check (status in ('pending', 'sending', 'sent', 'failed')) default 'pending',
  attempt_count integer not null default 0,
  provider_email_id text,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  sending_started_at timestamptz
);

-- =========================================================================
-- §4  Indexes
-- =========================================================================

create index participant_sessions_lookup_idx
  on public.participant_sessions (session_token_hash, expires_at)
  where revoked_at is null;
create index participants_city_id_idx
  on public.participants (city_id);
create index survey_submissions_city_date_idx
  on public.survey_submissions (city_id, submission_date);
create index survey_submissions_public_idx
  on public.survey_submissions (public_visibility, moderation_status);
create index survey_submissions_participant_id_idx
  on public.survey_submissions (participant_id);
create index survey_answers_submission_idx
  on public.survey_answers (submission_id);
create index survey_answers_question_submission_idx
  on public.survey_answers (question_id, submission_id);
create index consent_records_participant_submission_idx
  on public.consent_records (participant_id, submission_id, event_sequence desc);
create index daily_activity_entries_submission_idx
  on public.daily_activity_entries (submission_id, sequence);
create index idx_submission_email_notifications_status_created
  on public.submission_email_notifications (status, created_at);

-- =========================================================================
-- §5  Advisory lock helper for consent streams
-- =========================================================================

create or replace function public.lock_consent_stream(
  p_participant_id uuid,
  p_submission_id uuid,
  p_consent_type public.consent_type
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      'csod-consent:' ||
      p_participant_id::text || ':' ||
      coalesce(p_submission_id::text, 'participant') || ':' ||
      p_consent_type::text,
      0
    )
  );
end;
$$;

-- =========================================================================
-- §6  Schedule overlap validation with parent-submission locking
-- =========================================================================

create or replace function public.validate_daily_activity_entry()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  locked_submission_id uuid;
  new_start_min integer;
  new_end_min integer;
  new_wraps boolean;
  existing record;
  ex_start_min integer;
  ex_end_min integer;
  ex_wraps boolean;
  is_overlapping boolean;
begin
  -- 1. Acquire transaction-level row lock on parent submission to serialize
  -- all concurrent modifications for this submission's schedule.
  select id
    into locked_submission_id
    from public.survey_submissions
   where id = new.submission_id
   for update;

  if locked_submission_id is null then
    raise exception 'Daily activity submission does not exist';
  end if;

  -- 2. Advisory lock for cross-connection safety
  perform pg_advisory_xact_lock(
    hashtextextended('csod-schedule:' || new.submission_id::text, 0)
  );

  -- 3. Reject non-zero or fractional seconds (exact minute precision)
  if extract(second from new.start_time) <> 0
     or extract(second from new.end_time) <> 0 then
    raise exception 'Daily activity times must have minute precision (zero seconds)';
  end if;

  new_start_min := extract(hour from new.start_time)::integer * 60
                  + extract(minute from new.start_time)::integer;
  new_end_min   := extract(hour from new.end_time)::integer * 60
                  + extract(minute from new.end_time)::integer;

  -- 4. Reject identical start and end times
  if new_start_min = new_end_min then
    raise exception 'Start and end times cannot be identical';
  end if;

  new_wraps := new_end_min < new_start_min;

  -- 5. Efficient closed-form interval overlap comparison
  for existing in
    select e.id, e.start_time, e.end_time
      from public.daily_activity_entries e
     where e.submission_id = new.submission_id
       and (new.id is null or e.id <> new.id)
  loop
    ex_start_min := extract(hour from existing.start_time)::integer * 60
                   + extract(minute from existing.start_time)::integer;
    ex_end_min   := extract(hour from existing.end_time)::integer * 60
                   + extract(minute from existing.end_time)::integer;
    ex_wraps     := ex_end_min < ex_start_min;

    if not new_wraps and not ex_wraps then
      -- Daytime vs Daytime: overlap iff new_start < ex_end and ex_start < new_end
      is_overlapping := (new_start_min < ex_end_min and ex_start_min < new_end_min);
    elsif new_wraps and not ex_wraps then
      -- Wrapping vs Daytime: overlap iff new_start < ex_end or ex_start < new_end
      is_overlapping := (new_start_min < ex_end_min or ex_start_min < new_end_min);
    elsif not new_wraps and ex_wraps then
      -- Daytime vs Wrapping: overlap iff ex_start < new_end or new_start < ex_end
      is_overlapping := (ex_start_min < new_end_min or new_start_min < ex_end_min);
    else
      -- Both wrap midnight: they unconditionally share overnight minutes
      is_overlapping := true;
    end if;

    if is_overlapping then
      raise exception 'Daily activity entries cannot overlap';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists daily_activity_entries_no_overlap
  on public.daily_activity_entries;
create trigger daily_activity_entries_no_overlap
before insert or update of submission_id, start_time, end_time
on public.daily_activity_entries
for each row execute function public.validate_daily_activity_entry();

-- =========================================================================
-- §7  Triggers on retained tables (survey_questions definition protection)
-- =========================================================================

create or replace function public.prevent_question_definition_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
      from public.survey_answers
     where question_id = old.id
  ) and (
    new.question_key is distinct from old.question_key
    or new.question_text is distinct from old.question_text
    or new.question_type is distinct from old.question_type
    or new.options is distinct from old.options
    or new.is_required is distinct from old.is_required
    or new.validation_rules is distinct from old.validation_rules
    or new.visibility_rule is distinct from old.visibility_rule
    or new.display_order is distinct from old.display_order
    or new.section is distinct from old.section
  ) then
    raise exception 'Answered survey question definitions are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_answered_question_delete()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
      from public.survey_answers
     where question_id = old.id
  ) then
    raise exception 'Answered survey questions cannot be deleted';
  end if;
  return old;
end;
$$;

create or replace function public.prevent_question_scope_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if (new.city_id is distinct from old.city_id
      or new.survey_version is distinct from old.survey_version)
     and exists (
       select 1
         from public.survey_answers
        where question_id = old.id
     ) then
    raise exception 'Cannot change question city or survey version after answers exist';
  end if;
  return new;
end;
$$;

drop trigger if exists survey_questions_prevent_definition_mutation
  on public.survey_questions;
create trigger survey_questions_prevent_definition_mutation
before update on public.survey_questions
for each row execute function public.prevent_question_definition_mutation();

drop trigger if exists survey_questions_prevent_answered_delete
  on public.survey_questions;
create trigger survey_questions_prevent_answered_delete
before delete on public.survey_questions
for each row execute function public.prevent_answered_question_delete();

drop trigger if exists survey_questions_prevent_scope_change
  on public.survey_questions;
create trigger survey_questions_prevent_scope_change
before update of city_id, survey_version
on public.survey_questions
for each row execute function public.prevent_question_scope_change();

-- =========================================================================
-- §8  Submission relationships & linear scale validation triggers
-- =========================================================================

create or replace function public.validate_submission_relationships()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and new.participant_id is distinct from old.participant_id
     and (
       exists (select 1 from public.survey_answers where submission_id = old.id)
       or exists (select 1 from public.consent_records where submission_id = old.id)
     ) then
    raise exception 'Cannot change submission participant after answers or consent records exist';
  end if;

  if tg_op = 'UPDATE'
     and new.city_id is distinct from old.city_id
     and exists (
       select 1 from public.survey_answers where submission_id = old.id
     ) then
    raise exception 'Cannot change submission city after answers exist';
  end if;

  if tg_op = 'UPDATE'
     and new.survey_version is distinct from old.survey_version
     and exists (
       select 1 from public.survey_answers where submission_id = old.id
     ) then
    raise exception 'Cannot change submission survey version after answers exist';
  end if;

  if not exists (
    select 1
      from public.participants
     where id = new.participant_id
  ) then
    raise exception 'A valid participant session is required for submissions';
  end if;

  if not exists (
    select 1
      from public.cities
     where id = new.city_id
       and is_active
  ) then
    raise exception 'Submission city does not exist or is inactive';
  end if;

  return new;
end;
$$;

drop trigger if exists survey_submissions_validate_relationships
  on public.survey_submissions;
create trigger survey_submissions_validate_relationships
before insert or update of participant_id, city_id, survey_version
on public.survey_submissions
for each row execute function public.validate_submission_relationships();

create or replace function public.validate_answer_relationships()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  submission_city uuid;
  submission_version text;
  question_city uuid;
  question_version text;
begin
  select city_id, survey_version
    into submission_city, submission_version
    from public.survey_submissions
   where id = new.submission_id
   for share;

  if submission_city is null then
    raise exception 'Answer submission does not exist';
  end if;

  select sq.city_id, sq.survey_version
    into question_city, question_version
    from public.survey_questions sq
   where sq.id = new.question_id
     and sq.is_active
   for share;

  if not found then
    raise exception 'Answer question does not exist or is inactive';
  end if;

  if question_version <> submission_version then
    raise exception 'Answer question version does not match submission version';
  end if;

  if question_city is not null and question_city <> submission_city then
    raise exception 'City-specific question does not match submission city';
  end if;

  return new;
end;
$$;

drop trigger if exists survey_answers_validate_relationships
  on public.survey_answers;
create trigger survey_answers_validate_relationships
before insert or update of submission_id, question_id
on public.survey_answers
for each row execute function public.validate_answer_relationships();

create or replace function public.validate_linear_scale_answer()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  question_record public.survey_questions;
  numeric_value integer;
  minimum integer;
  maximum integer;
  step integer;
begin
  select *
    into question_record
    from public.survey_questions
   where id = new.question_id;

  if question_record.question_type <> 'linear_scale' then
    return new;
  end if;

  if (new.answer #>> '{}' !~ '^[0-9]+$') then
    raise exception 'Linear scale answers must be integers';
  end if;

  numeric_value := (new.answer #>> '{}')::integer;
  minimum := (question_record.validation_rules->>'min')::integer;
  maximum := (question_record.validation_rules->>'max')::integer;
  step := (question_record.validation_rules->>'step')::integer;

  if numeric_value < minimum
     or numeric_value > maximum
     or step is null
     or mod(numeric_value - minimum, step) <> 0 then
    raise exception 'Linear scale answer is outside the allowed range';
  end if;

  return new;
end;
$$;

drop trigger if exists survey_answers_validate_linear_scale
  on public.survey_answers;
create trigger survey_answers_validate_linear_scale
before insert or update of question_id, answer
on public.survey_answers
for each row execute function public.validate_linear_scale_answer();

-- =========================================================================
-- §9  Consent lifecycle, publication synchronization, and moderation guards
-- =========================================================================

-- Consent validation (before insert on consent_records)
create or replace function public.validate_consent_event()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  latest_event public.consent_event;
  submission_participant uuid;
begin
  if new.submission_id is not null then
    select participant_id
      into submission_participant
      from public.survey_submissions
     where id = new.submission_id
     for update;

    if submission_participant is null then
      raise exception 'Consent submission does not exist';
    end if;

    if submission_participant <> new.participant_id then
      raise exception 'Consent participant does not match submission participant';
    end if;
  end if;

  perform public.lock_consent_stream(
    new.participant_id,
    new.submission_id,
    new.consent_type
  );

  select cr.consent_event
    into latest_event
    from public.consent_records cr
   where cr.participant_id = new.participant_id
     and cr.submission_id is not distinct from new.submission_id
     and cr.consent_type = new.consent_type
   order by cr.event_sequence desc, cr.id desc
   limit 1;

  if new.consent_event = 'withdrawn' and latest_event is distinct from 'granted' then
    raise exception 'Consent can be withdrawn only after a granted event';
  end if;

  new.event_provenance := 'new_event';
  return new;
end;
$$;

drop trigger if exists consent_records_validate_event
  on public.consent_records;
create trigger consent_records_validate_event
before insert on public.consent_records
for each row execute function public.validate_consent_event();

-- Prevent consent history mutation (append-only)
create or replace function public.prevent_consent_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Consent records are append-only';
end;
$$;

drop trigger if exists consent_records_append_only_update
  on public.consent_records;
create trigger consent_records_append_only_update
before update or delete on public.consent_records
for each row execute function public.prevent_consent_history_mutation();

-- Enforce public visibility consent policy on survey_submissions
create or replace function public.enforce_public_visibility_consent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  latest_event public.consent_event;
  latest_provenance public.consent_event_provenance;
begin
  -- 1. Ensure generic service operations cannot accidentally clear an administrator's hide decision:
  -- If submission was already admin_hidden, preserve admin_hidden unless explicitly set to false.
  if tg_op = 'UPDATE' and old.admin_hidden is true and new.admin_hidden is not false then
    new.admin_hidden := true;
  end if;

  -- 2. Rejection or pending moderation keeps public_visibility false
  if new.moderation_status <> 'approved' then
    new.public_visibility := false;
  end if;

  -- 3. If admin_hidden is set, visibility MUST be false
  if coalesce(new.admin_hidden, false) then
    new.public_visibility := false;
  end if;

  -- 4. When public_visibility is true, strictly verify approval, no admin hide, and valid consent
  if new.public_visibility then
    if new.moderation_status <> 'approved' or coalesce(new.admin_hidden, false) then
      raise exception 'Public visibility requires approved moderation and no administrator hide';
    end if;

    select cr.consent_event, cr.event_provenance
      into latest_event, latest_provenance
      from public.consent_records cr
     where cr.participant_id = new.participant_id
       and cr.submission_id = new.id
       and cr.consent_type = 'public_display'
     order by cr.event_sequence desc, cr.id desc
     limit 1;

    if latest_event is distinct from 'granted'
       or latest_provenance = 'legacy_ambiguous' then
      raise exception 'Public visibility requires approved moderation and latest granted public-display consent';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists survey_submissions_enforce_public_consent
  on public.survey_submissions;
create trigger survey_submissions_enforce_public_consent
before insert or update of participant_id, public_visibility, moderation_status, admin_hidden
on public.survey_submissions
for each row execute function public.enforce_public_visibility_consent();

-- Authoritative synchronization trigger on consent_records:
-- 1. Granted consent auto-publishes IF submission is approved AND not admin_hidden.
-- 2. Declined or Withdrawn consent immediately hides the response.
-- 3. If an administrator set moderation_status to 'rejected' or 'pending' or hid the response,
--    subsequent consent events NEVER override the moderation decision.
create or replace function public.sync_public_visibility_on_consent_event()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  latest_event public.consent_event;
  latest_provenance public.consent_event_provenance;
  sub_moderation public.moderation_status;
  sub_visibility boolean;
  sub_admin_hidden boolean;
begin
  if new.submission_id is not null and new.consent_type = 'public_display' then
    select s.moderation_status, s.public_visibility, s.admin_hidden
      into sub_moderation, sub_visibility, sub_admin_hidden
      from public.survey_submissions s
     where s.id = new.submission_id;

    select cr.consent_event, cr.event_provenance
      into latest_event, latest_provenance
      from public.consent_records cr
     where cr.participant_id = new.participant_id
       and cr.submission_id = new.submission_id
       and cr.consent_type = 'public_display'
     order by cr.event_sequence desc, cr.id desc
     limit 1;

    if latest_event = 'granted'
       and latest_provenance <> 'legacy_ambiguous'
       and sub_moderation = 'approved'
       and not coalesce(sub_admin_hidden, false) then
      -- Auto-publish approved submission upon granted consent ONLY IF not admin_hidden
      if not sub_visibility then
        update public.survey_submissions
           set public_visibility = true
         where id = new.submission_id;
      end if;
    else
      -- Withdrawal, decline, unapproved moderation, or admin_hidden immediately revokes visibility
      if sub_visibility then
        update public.survey_submissions
           set public_visibility = false
         where id = new.submission_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists consent_records_sync_visibility
  on public.consent_records;
create trigger consent_records_sync_visibility
after insert on public.consent_records
for each row execute function public.sync_public_visibility_on_consent_event();

-- =========================================================================
-- §10  Participant & submission helpers
-- =========================================================================

create or replace function public.normalize_email(value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$ select lower(btrim(value)) $$;

create or replace function public.set_participant_email()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.email := public.normalize_email(new.email);
  return new;
end;
$$;

drop trigger if exists participants_normalize_email on public.participants;
create trigger participants_normalize_email
before insert or update of email on public.participants
for each row execute function public.set_participant_email();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists participants_set_updated_at on public.participants;
create trigger participants_set_updated_at
before update on public.participants
for each row execute function public.touch_updated_at();

create or replace function public.next_participant_id(p_city_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  city_code text;
  next_number bigint;
begin
  select cities.city_code into city_code
    from public.cities
   where cities.id = p_city_id and cities.is_active
   for update;
  if city_code is null then raise exception 'Selected city is unavailable'; end if;
  insert into public.participant_city_sequences(city_id)
  values (p_city_id)
  on conflict (city_id) do nothing;
  update public.participant_city_sequences
     set next_value = next_value + 1
   where participant_city_sequences.city_id = p_city_id
  returning next_value - 1 into next_number;
  return format('CSOD-%s-%s', city_code, lpad(next_number::text, 5, '0'));
end;
$$;

create or replace function public.next_submission_number(p_participant_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare next_number bigint;
begin
  insert into public.participant_submission_sequences(participant_id)
  values (p_participant_id)
  on conflict (participant_id) do nothing;
  update public.participant_submission_sequences
     set next_value = next_value + 1
   where participant_submission_sequences.participant_id = p_participant_id
  returning next_value - 1 into next_number;
  return next_number::integer;
end;
$$;

create or replace function public.register_participant(
  p_email text,
  p_city_id uuid,
  p_zone_id uuid,
  p_session_token_hash text,
  p_session_expires_at timestamptz
)
returns table (participant_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare new_id uuid;
begin
  if public.normalize_email(p_email) = '' then raise exception 'Participant email is required'; end if;
  if p_session_token_hash is null or p_session_token_hash = '' then
    raise exception 'Participant session is required';
  end if;
  if p_session_expires_at <= clock_timestamp() then
    raise exception 'Participant session expiry must be in the future';
  end if;
  if not exists (select 1 from public.cities where id = p_city_id and is_active) then
    raise exception 'Selected city is unavailable';
  end if;
  if not exists (
    select 1 from public.city_zones where id = p_zone_id and city_id = p_city_id and is_active
  ) then raise exception 'Selected zone is unavailable for this city'; end if;
  insert into public.participants(public_participant_id, email, city_id)
  values (public.next_participant_id(p_city_id), public.normalize_email(p_email), p_city_id)
  returning id into new_id;
  insert into public.participant_sessions(participant_id, session_token_hash, expires_at)
  values (new_id, p_session_token_hash, p_session_expires_at);
  return query select new_id;
end;
$$;

-- =========================================================================
-- §11  Authoritative participant survey submission RPC
-- =========================================================================

create or replace function public.submit_participant_survey(
  p_participant_id uuid,
  p_city_id uuid,
  p_zone_id uuid,
  p_answers jsonb,
  p_research_participation boolean,
  p_public_display boolean,
  p_future_communication boolean,
  p_daily_activities jsonb
)
returns table (
  submission_id uuid,
  public_participant_id text,
  submission_number integer,
  survey_version text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  participant_record public.participants;
  v_survey_version text;
  version_count integer;
  new_submission_id uuid;
  allocated_number integer;
  ans_rec record;
  q_rec record;
  opt_count integer;
  max_items integer;
  min_items integer;
  mut_exclusive jsonb;
  scale_val integer;
  scale_min integer;
  scale_max integer;
  scale_step integer;
  v_str_val text;
  max_len integer;
  min_len integer;
  num_val numeric;
  num_min numeric;
  num_max numeric;
begin
  -- 1. Validate participant session
  select participants.* into participant_record
    from public.participants
   where participants.id = p_participant_id
   for update;
  if not found then raise exception 'A valid participant session is required'; end if;

  -- 2. Validate city and zone
  if not exists (select 1 from public.cities where id = p_city_id and is_active) then
    raise exception 'Selected city is unavailable';
  end if;
  if not exists (select 1 from public.city_zones where id = p_zone_id and city_id = p_city_id and is_active) then
    raise exception 'Selected zone is unavailable for this city';
  end if;

  -- 2b. Explicit affirmative research participation consent is strictly required
  if not coalesce(p_research_participation, false) then
    raise exception 'Research participation consent is required to submit the survey';
  end if;

  -- 3. Resolve active questionnaire version
  select count(distinct questions.survey_version),
         min(questions.survey_version)
    into version_count, v_survey_version
    from public.survey_questions questions
   where questions.is_active
     and (questions.city_id is null or questions.city_id = p_city_id);

  if version_count <> 1 or v_survey_version is null or v_survey_version <> 'v4' then
    raise exception 'The active questionnaire is not consistently versioned';
  end if;

  -- 4. Validate payload JSON structure
  if jsonb_typeof(coalesce(p_answers, 'null'::jsonb)) <> 'array' then
    raise exception 'Answers must be supplied as a JSON array';
  end if;

  if jsonb_typeof(coalesce(p_daily_activities, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_daily_activities) = 0 then
    raise exception 'At least one daily activity is required';
  end if;

  -- 5. Reject duplicate answers
  if exists (
    select 1
      from jsonb_to_recordset(p_answers) as supplied(question_id uuid, answer jsonb)
     group by supplied.question_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate survey answers are not allowed';
  end if;

  -- 6. Validate question membership: all supplied answers must match active questions
  if exists (
    select 1
      from jsonb_to_recordset(p_answers) as supplied(question_id uuid, answer jsonb)
      left join public.survey_questions questions
        on questions.id = supplied.question_id
       and questions.is_active
       and questions.survey_version = v_survey_version
       and (questions.city_id is null or questions.city_id = p_city_id)
     where questions.id is null or supplied.answer is null
  ) then
    raise exception 'Survey answers do not match the active questionnaire';
  end if;

  -- 7. Validate that every required question is answered with a non-empty value
  if exists (
    select 1
      from public.survey_questions questions
     where questions.is_active
       and questions.is_required
       and questions.survey_version = v_survey_version
       and (questions.city_id is null or questions.city_id = p_city_id)
       and not exists (
         select 1
           from jsonb_to_recordset(p_answers) as supplied(question_id uuid, answer jsonb)
          where supplied.question_id = questions.id
            and supplied.answer is not null
            and case
                  when questions.question_type = 'checkboxes'
                    then jsonb_typeof(supplied.answer) = 'array' and jsonb_array_length(supplied.answer) > 0
                  else nullif(btrim(supplied.answer #>> '{}'), '') is not null
                end
       )
  ) then
    raise exception 'Required survey answers are missing';
  end if;

  -- 8. Deep answer validation against question rules
  for ans_rec in
    select supplied.question_id, supplied.answer
      from jsonb_to_recordset(p_answers) as supplied(question_id uuid, answer jsonb)
  loop
    select * into q_rec
      from public.survey_questions
     where id = ans_rec.question_id;

    -- Checkboxes: array of strings, no duplicate selections, min/max, allowed options, mutual exclusivity
    if q_rec.question_type = 'checkboxes' then
      if jsonb_typeof(ans_rec.answer) <> 'array' then
        raise exception 'Checkbox answer must be a JSON array for %', q_rec.question_key;
      end if;

      if exists (
        select 1
          from jsonb_array_elements(ans_rec.answer) as elem
         where jsonb_typeof(elem) <> 'string'
      ) then
        raise exception 'Checkbox options must be JSON strings for %', q_rec.question_key;
      end if;

      if (
        select count(*)
          from jsonb_array_elements_text(ans_rec.answer) as elem(val)
      ) <> (
        select count(distinct elem.val)
          from jsonb_array_elements_text(ans_rec.answer) as elem(val)
      ) then
        raise exception 'Duplicate checkbox options selected for %', q_rec.question_key;
      end if;

      opt_count := jsonb_array_length(ans_rec.answer);
      min_items := (q_rec.validation_rules->>'min_items')::integer;
      max_items := (q_rec.validation_rules->>'max_items')::integer;
      mut_exclusive := q_rec.validation_rules->'mutually_exclusive';

      if q_rec.is_required and opt_count = 0 then
        raise exception 'Select at least one option for %', q_rec.question_key;
      end if;

      if min_items is not null and opt_count < min_items then
        raise exception 'Select at least % option(s) for %', min_items, q_rec.question_key;
      end if;

      if max_items is not null and opt_count > max_items then
        raise exception 'Select no more than % option(s) for %', max_items, q_rec.question_key;
      end if;

      -- Check allowed values
      if exists (
        select 1
          from jsonb_array_elements_text(ans_rec.answer) as elem(val)
         where not (q_rec.options @> to_jsonb(elem.val))
      ) then
        raise exception 'Invalid checkbox option for %', q_rec.question_key;
      end if;

      -- Check mutually exclusive choices
      if mut_exclusive is not null and jsonb_array_length(mut_exclusive) > 0 then
        if exists (
          select 1
            from jsonb_array_elements_text(ans_rec.answer) as elem(val)
           where mut_exclusive @> to_jsonb(elem.val)
        ) and opt_count > 1 then
          raise exception 'Mutually exclusive option cannot be combined with other options for %', q_rec.question_key;
        end if;
      end if;

    -- Multiple choice & Dropdown: string, required non-empty, allowed options
    elsif q_rec.question_type in ('multiple_choice', 'dropdown') then
      if jsonb_typeof(ans_rec.answer) <> 'string' then
        raise exception 'Answer for % must be a JSON string', q_rec.question_key;
      end if;

      v_str_val := btrim(ans_rec.answer #>> '{}');
      if q_rec.is_required and v_str_val = '' then
        raise exception 'Answer for % cannot be empty', q_rec.question_key;
      end if;

      if v_str_val <> '' and not (q_rec.options @> to_jsonb(v_str_val)) then
        raise exception 'Invalid option selected for %', q_rec.question_key;
      end if;

    -- Short text & Long text: string, max_length, min_length
    elsif q_rec.question_type in ('short_text', 'long_text') then
      if jsonb_typeof(ans_rec.answer) <> 'string' then
        raise exception 'Answer for % must be a JSON string', q_rec.question_key;
      end if;

      v_str_val := btrim(ans_rec.answer #>> '{}');
      if q_rec.is_required and v_str_val = '' then
        raise exception 'Answer for % cannot be empty', q_rec.question_key;
      end if;

      max_len := (q_rec.validation_rules->>'max_length')::integer;
      min_len := (q_rec.validation_rules->>'min_length')::integer;

      if max_len is not null and length(v_str_val) > max_len then
        raise exception 'Answer for % exceeds maximum allowed length of % characters', q_rec.question_key, max_len;
      end if;

      if min_len is not null and v_str_val <> '' and length(v_str_val) < min_len then
        raise exception 'Answer for % is below minimum required length of % characters', q_rec.question_key, min_len;
      end if;

    -- Number: valid numeric value, min, max
    elsif q_rec.question_type = 'number' then
      if jsonb_typeof(ans_rec.answer) not in ('number', 'string') then
        raise exception 'Answer for % must be a numeric value', q_rec.question_key;
      end if;

      v_str_val := btrim(ans_rec.answer #>> '{}');
      if q_rec.is_required and v_str_val = '' then
        raise exception 'Answer for % cannot be empty', q_rec.question_key;
      end if;

      if v_str_val <> '' then
        if v_str_val !~ '^-?[0-9]+(\.[0-9]+)?$' then
          raise exception 'Answer for % must be a valid number', q_rec.question_key;
        end if;

        num_val := v_str_val::numeric;
        num_min := (q_rec.validation_rules->>'min')::numeric;
        num_max := (q_rec.validation_rules->>'max')::numeric;

        if num_min is not null and num_val < num_min then
          raise exception 'Answer for % cannot be less than %', q_rec.question_key, num_min;
        end if;

        if num_max is not null and num_val > num_max then
          raise exception 'Answer for % cannot be greater than %', q_rec.question_key, num_max;
        end if;
      end if;

    -- Linear scale: integer, min, max, step
    elsif q_rec.question_type = 'linear_scale' then
      if jsonb_typeof(ans_rec.answer) not in ('number', 'string') then
        raise exception 'Linear scale answer for % must be a number', q_rec.question_key;
      end if;

      v_str_val := btrim(ans_rec.answer #>> '{}');
      if q_rec.is_required and v_str_val = '' then
        raise exception 'Linear scale answer for % cannot be empty', q_rec.question_key;
      end if;

      if v_str_val <> '' then
        if v_str_val !~ '^[0-9]+$' then
          raise exception 'Linear scale answer for % must be an integer', q_rec.question_key;
        end if;

        scale_val := v_str_val::integer;
        scale_min := (q_rec.validation_rules->>'min')::integer;
        scale_max := (q_rec.validation_rules->>'max')::integer;
        scale_step := coalesce((q_rec.validation_rules->>'step')::integer, 1);

        if scale_min is not null and scale_val < scale_min then
          raise exception 'Linear scale answer for % is below minimum (%)', q_rec.question_key, scale_min;
        end if;

        if scale_max is not null and scale_val > scale_max then
          raise exception 'Linear scale answer for % exceeds maximum (%)', q_rec.question_key, scale_max;
        end if;

        if scale_step is not null and scale_min is not null and mod(scale_val - scale_min, scale_step) <> 0 then
          raise exception 'Linear scale answer for % does not match step size (%)', q_rec.question_key, scale_step;
        end if;
      end if;

    -- Date: string, YYYY-MM-DD
    elsif q_rec.question_type = 'date' then
      if jsonb_typeof(ans_rec.answer) <> 'string' then
        raise exception 'Date answer for % must be a JSON string', q_rec.question_key;
      end if;

      v_str_val := btrim(ans_rec.answer #>> '{}');
      if q_rec.is_required and v_str_val = '' then
        raise exception 'Date answer for % cannot be empty', q_rec.question_key;
      end if;

      if v_str_val <> '' and v_str_val !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Date answer for % must be in YYYY-MM-DD format', q_rec.question_key;
      end if;
    end if;
  end loop;

  -- 9. Allocate submission number and insert submission
  allocated_number := public.next_submission_number(p_participant_id);

  insert into public.survey_submissions
    (participant_id, city_id, zone_id, submission_date, submission_number,
     survey_version, moderation_status, public_visibility, admin_hidden)
  values (p_participant_id, p_city_id, p_zone_id, current_date, allocated_number,
          v_survey_version, 'approved', false, false)
  returning id into new_submission_id;

  -- 10. Persist survey answers
  insert into public.survey_answers(submission_id, question_id, answer)
  select new_submission_id, supplied.question_id, supplied.answer
    from jsonb_to_recordset(p_answers)
      as supplied(question_id uuid, answer jsonb);

  -- 11. Deterministically persist daily activity schedule preserving input array ordering
  insert into public.daily_activity_entries
    (submission_id, sequence, start_time, end_time, location_category,
     location_other, activity_category, activity_other)
  select new_submission_id,
         arr.ordinality::integer,
         (arr.value->>'start_time')::time,
         (arr.value->>'end_time')::time,
         arr.value->>'location_category',
         nullif(btrim(arr.value->>'location_other'), ''),
         arr.value->>'activity_category',
         nullif(btrim(arr.value->>'activity_other'), '')
    from jsonb_array_elements(p_daily_activities) with ordinality as arr(value, ordinality);

  -- 12. Persist consent records. Each consent dimension is strictly independent.
  -- The sync_public_visibility_on_consent_event trigger automatically publishes
  -- the submission when p_public_display is true and approved without admin hide!
  insert into public.consent_records
    (participant_id, submission_id, consent_type, consent_version, consent_event)
  values
    (p_participant_id, new_submission_id, 'research_participation', v_survey_version, 'granted'::public.consent_event),
    (p_participant_id, new_submission_id, 'public_display', v_survey_version,
      case when p_public_display then 'granted'::public.consent_event else 'declined'::public.consent_event end),
    (p_participant_id, new_submission_id, 'future_communication', v_survey_version,
      case when p_future_communication then 'granted'::public.consent_event else 'declined'::public.consent_event end);

  -- 13. Enqueue durable email notification outbox record
  insert into public.submission_email_notifications
    (submission_id, status)
  values
    (new_submission_id, 'pending');

  return query select new_submission_id, participant_record.public_participant_id,
    allocated_number, v_survey_version;
end;
$$;

-- =========================================================================
-- §12  Admin helper functions & actions
-- =========================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$ select exists (
  select 1 from public.admin_users
   where auth_user_id = (select auth.uid())
     and role = 'super_admin'
) $$;

-- Admin explicit hide action
create or replace function public.admin_hide_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.survey_submissions
     set admin_hidden = true,
         public_visibility = false
   where id = p_submission_id;

  if not found then
    raise exception 'Submission not found';
  end if;
end;
$$;

-- Admin explicit restore action
create or replace function public.admin_restore_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sub_moderation public.moderation_status;
  sub_participant_id uuid;
  latest_event public.consent_event;
  latest_prov public.consent_event_provenance;
begin
  select moderation_status, participant_id
    into sub_moderation, sub_participant_id
    from public.survey_submissions
   where id = p_submission_id;

  if not found then
    raise exception 'Submission not found';
  end if;

  select cr.consent_event, cr.event_provenance
    into latest_event, latest_prov
    from public.consent_records cr
   where cr.participant_id = sub_participant_id
     and cr.submission_id = p_submission_id
     and cr.consent_type = 'public_display'
   order by cr.event_sequence desc, cr.id desc
   limit 1;

  if sub_moderation = 'approved'
     and latest_event = 'granted'
     and latest_prov <> 'legacy_ambiguous' then
    update public.survey_submissions
       set admin_hidden = false,
           public_visibility = true
     where id = p_submission_id;
  else
    update public.survey_submissions
       set admin_hidden = false,
           public_visibility = false
     where id = p_submission_id;
  end if;
end;
$$;

-- Admin explicit moderation status action
create or replace function public.admin_set_moderation(
  p_submission_id uuid,
  p_status public.moderation_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  sub_participant_id uuid;
  sub_admin_hidden boolean;
  latest_event public.consent_event;
  latest_prov public.consent_event_provenance;
begin
  select participant_id, admin_hidden
    into sub_participant_id, sub_admin_hidden
    from public.survey_submissions
   where id = p_submission_id;

  if not found then
    raise exception 'Submission not found';
  end if;

  if p_status <> 'approved' then
    update public.survey_submissions
       set moderation_status = p_status,
           public_visibility = false
     where id = p_submission_id;
  else
    select cr.consent_event, cr.event_provenance
      into latest_event, latest_prov
      from public.consent_records cr
     where cr.participant_id = sub_participant_id
       and cr.submission_id = p_submission_id
       and cr.consent_type = 'public_display'
     order by cr.event_sequence desc, cr.id desc
     limit 1;

    if latest_event = 'granted'
       and latest_prov <> 'legacy_ambiguous'
       and not coalesce(sub_admin_hidden, false) then
      update public.survey_submissions
         set moderation_status = p_status,
             public_visibility = true
       where id = p_submission_id;
    else
      update public.survey_submissions
         set moderation_status = p_status,
             public_visibility = false
       where id = p_submission_id;
    end if;
  end if;
end;
$$;

-- =========================================================================
-- §13  Canonical v4 Survey Question Version Activation
-- =========================================================================

-- Step 1: Deactivate all prior survey question versions (v1, v2, v3)
update public.survey_questions
   set is_active = false
 where survey_version <> 'v4';

-- Step 2: Insert or update canonical v4 common questions
insert into public.survey_questions
  (question_key, question_text, question_type, section, city_id, options,
   validation_rules, visibility_rule, is_required, display_order,
   survey_version, is_active)
values
  ('environment_setting', 'Which setting best describes where you spend most of your time?', 'multiple_choice', 'Your environment', null,
   '["Residential area","Commercial area","Industrial area","Mixed residential and commercial area","Peri-urban or rural edge"]'::jsonb,
   '{"allowed_values":["Residential area","Commercial area","Industrial area","Mixed residential and commercial area","Peri-urban or rural edge"]}'::jsonb,
   null, true, 10, 'v4', true),
  ('main_transport_mode', 'What is your main mode of transportation on a typical day?', 'multiple_choice', 'Daily travel', null,
   '["Walk","Bicycle","Two-wheeler","Car","Auto-rickshaw","Bus","Metro or local train","Work from home or no regular travel"]'::jsonb,
   '{"allowed_values":["Walk","Bicycle","Two-wheeler","Car","Auto-rickshaw","Bus","Metro or local train","Work from home or no regular travel"]}'::jsonb,
   null, true, 20, 'v4', true),
  ('daily_travel_duration', 'How much time do you usually spend travelling each day?', 'multiple_choice', 'Daily travel', null,
   '["I do not travel regularly","Less than 30 minutes","30–60 minutes","1–2 hours","More than 2 hours"]'::jsonb,
   '{"allowed_values":["I do not travel regularly","Less than 30 minutes","30–60 minutes","1–2 hours","More than 2 hours"]}'::jsonb,
   null, true, 30, 'v4', true),
  ('daily_outdoor_time', 'How much time do you typically spend outdoors on a usual day?', 'multiple_choice', 'Your environment', null,
   '["Less than 30 minutes","30 minutes–1 hour","1–3 hours","3–6 hours","More than 6 hours"]'::jsonb,
   '{"allowed_values":["Less than 30 minutes","30 minutes–1 hour","1–3 hours","3–6 hours","More than 6 hours"]}'::jsonb,
   null, true, 40, 'v4', true),
  ('traffic_exposure', 'How often are you close to heavy traffic or congested roads?', 'multiple_choice', 'Pollution exposure', null,
   '["Never","Rarely","Sometimes","Often","Almost every day"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Almost every day"]}'::jsonb,
   null, true, 50, 'v4', true),
  ('roadside_pollution', 'How often do you notice smoke, dust, or strong exhaust near roads you use?', 'multiple_choice', 'Pollution observations', null,
   '["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]'::jsonb,
   '{"allowed_values":["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]}'::jsonb,
   null, true, 60, 'v4', true),
  ('nearby_industry', 'Are there industrial facilities or large workshops near places you regularly visit?', 'multiple_choice', 'Local sources', null,
   '["Yes","No","Not sure"]'::jsonb,
   '{"allowed_values":["Yes","No","Not sure"]}'::jsonb,
   null, true, 70, 'v4', true),
  ('construction_activity', 'How often do you notice dust or activity from construction near you?', 'multiple_choice', 'Local sources', null,
   '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb,
   null, true, 80, 'v4', true),
  ('waste_burning', 'How often do you see waste or other material being burned outdoors?', 'multiple_choice', 'Local sources', null,
   '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb,
   null, true, 90, 'v4', true),
  ('observed_pollution_sources', 'Which pollution sources do you commonly observe? Select all that apply.', 'checkboxes', 'Local sources', null,
   '["Vehicle exhaust","Road dust","Construction dust","Industrial emissions","Waste burning","Diesel generators","Household solid-fuel smoke","Agricultural or seasonal burning","I do not notice these sources","Not sure"]'::jsonb,
   '{"allowed_values":["Vehicle exhaust","Road dust","Construction dust","Industrial emissions","Waste burning","Diesel generators","Household solid-fuel smoke","Agricultural or seasonal burning","I do not notice these sources","Not sure"],"min_items":1,"max_items":10,"mutually_exclusive":["I do not notice these sources","Not sure"]}'::jsonb,
   null, true, 100, 'v4', true),
  ('perceived_air_quality', 'How would you rate the air quality where you are most often?', 'linear_scale', 'Air-quality perception', null,
   '["1","2","3","4","5"]'::jsonb,
   '{"min":1,"max":5,"step":1,"labels":{"1":"Very poor","5":"Very good"}}'::jsonb,
   null, true, 110, 'v4', true),
  ('aqi_awareness', 'Before today, had you heard of the Air Quality Index (AQI)?', 'multiple_choice', 'Air-quality awareness', null,
   '["Yes","No","Not sure"]'::jsonb,
   '{"allowed_values":["Yes","No","Not sure"]}'::jsonb,
   null, true, 120, 'v4', true),
  ('aqi_check_frequency', 'How often do you check or receive information about AQI?', 'multiple_choice', 'Air-quality awareness', null,
   '["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]'::jsonb,
   '{"allowed_values":["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]}'::jsonb,
   null, true, 130, 'v4', true),
  ('pollution_observation_frequency', 'How often do you notice air pollution in your surroundings?', 'multiple_choice', 'Pollution observations', null,
   '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb,
   null, true, 140, 'v4', true),
  ('public_transport_awareness', 'How aware are you of public-transport options that could reduce traffic-related pollution?', 'linear_scale', 'Air-quality awareness', null,
   '["1","2","3","4","5"]'::jsonb,
   '{"min":1,"max":5,"step":1,"labels":{"1":"Not aware","5":"Very aware"}}'::jsonb,
   null, true, 150, 'v4', true),
  ('pollution_change', 'Compared with one year ago, how does the air quality around you seem?', 'multiple_choice', 'Air-quality perception', null,
   '["Much worse","Somewhat worse","About the same","Somewhat better","Much better","Not sure"]'::jsonb,
   '{"allowed_values":["Much worse","Somewhat worse","About the same","Somewhat better","Much better","Not sure"]}'::jsonb,
   null, true, 160, 'v4', true),
  ('air_quality_observation', 'What is one air-quality change or pollution event you have noticed recently?', 'long_text', 'Your observations', null,
   '[]'::jsonb,
   '{"max_length":1000}'::jsonb,
   null, false, 180, 'v4', true),
  ('improvement_priority', 'Which action would most improve air quality where you live or travel?', 'multiple_choice', 'Your observations', null,
   '["Cleaner public transport","Better traffic management","Dust control at construction sites","Stronger industrial controls","Prevention of open waste burning","More trees and green spaces","Better air-quality information","Not sure"]'::jsonb,
   '{"allowed_values":["Cleaner public transport","Better traffic management","Dust control at construction sites","Stronger industrial controls","Prevention of open waste burning","More trees and green spaces","Better air-quality information","Not sure"]}'::jsonb,
   null, true, 190, 'v4', true)
on conflict (question_key, survey_version) where city_id is null do update
set question_text = excluded.question_text,
    question_type = excluded.question_type,
    section = excluded.section,
    options = excluded.options,
    validation_rules = excluded.validation_rules,
    visibility_rule = excluded.visibility_rule,
    is_required = excluded.is_required,
    display_order = excluded.display_order,
    is_active = true;

-- Step 3: Insert or update canonical v4 city-specific questions
with city_questions (slug, question_key, question_text, question_type, section,
                     options, validation_rules, is_required, display_order) as (
  values
    ('bhubaneswar', 'bbs_seasonal_dust_and_burning', 'During dry or hot periods, how often do you notice dust or outdoor burning affecting your area?', 'multiple_choice', 'Bhubaneswar observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 201),
    ('bhubaneswar', 'bbs_traffic_growth_exposure', 'How often do traffic growth or road works make your usual route feel more polluted?', 'multiple_choice', 'Bhubaneswar observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 202),
    ('mumbai', 'mum_traffic_corridor_exposure', 'How often do you spend time near a major traffic corridor, flyover, or busy junction?', 'multiple_choice', 'Mumbai observations',
     '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb, false, 211),
    ('mumbai', 'mum_construction_dust', 'How often do you notice construction or demolition dust in your neighbourhood?', 'multiple_choice', 'Mumbai observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 212),
    ('bengaluru', 'blr_traffic_idling', 'How often do you experience long vehicle idling or congestion on your regular routes?', 'multiple_choice', 'Bengaluru observations',
     '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb, false, 221),
    ('bengaluru', 'blr_road_dust', 'How often do you notice road dust near active roadworks or unpaved shoulders?', 'multiple_choice', 'Bengaluru observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 222),
    ('jamshedpur', 'jsp_industrial_emissions', 'How often do you notice smoke, dust, or odour that you associate with nearby industrial activity?', 'multiple_choice', 'Jamshedpur observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 231),
    ('jamshedpur', 'jsp_mining_or_material_dust', 'How often do you notice dust from heavy vehicles, material handling, or mining-related movement?', 'multiple_choice', 'Jamshedpur observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 232),
    ('patna', 'pat_road_dust_congestion', 'How often do congestion and road dust affect the air on your regular routes?', 'multiple_choice', 'Patna observations',
     '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb, false, 241),
    ('patna', 'pat_seasonal_burning', 'How often do you notice smoke that may be related to seasonal or outdoor burning near your area?', 'multiple_choice', 'Patna observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 242)
)
insert into public.survey_questions
  (question_key, question_text, question_type, section, city_id, options,
   validation_rules, visibility_rule, is_required, display_order,
   survey_version, is_active)
select city_questions.question_key,
       city_questions.question_text,
       city_questions.question_type::public.question_type,
       city_questions.section,
       cities.id,
       city_questions.options,
       city_questions.validation_rules,
       null,
       city_questions.is_required,
       city_questions.display_order,
       'v4',
       true
  from city_questions
  join public.cities on cities.slug = city_questions.slug
on conflict (city_id, question_key, survey_version) where city_id is not null do update
set question_text = excluded.question_text,
    question_type = excluded.question_type,
    section = excluded.section,
    options = excluded.options,
    validation_rules = excluded.validation_rules,
    visibility_rule = excluded.visibility_rule,
    is_required = excluded.is_required,
    display_order = excluded.display_order,
    is_active = true;

-- Step 4: Verification assertion: exactly one active version ('v4') per active city
do $$
declare
  city_record record;
  active_vers text;
  v_count integer;
begin
  for city_record in select id, name, slug from public.cities where is_active loop
    select min(survey_version), count(distinct survey_version)
      into active_vers, v_count
      from public.survey_questions
     where is_active and (city_id is null or city_id = city_record.id);

    if v_count <> 1 or active_vers <> 'v4' then
      raise exception 'City % (%) failed single active v4 questionnaire assertion (found % versions, min %)',
        city_record.name, city_record.slug, v_count, active_vers;
    end if;
  end loop;
end;
$$;

-- =========================================================================
-- §14  Permissions and Row Level Security
-- =========================================================================

-- Revoke all table privileges from anon and authenticated
revoke all on table
  public.cities, public.city_zones, public.participants,
  public.participant_city_sequences, public.participant_sessions,
  public.participant_submission_sequences, public.survey_questions,
  public.survey_submissions, public.survey_answers, public.consent_records,
  public.daily_activity_entries, public.submission_email_notifications,
  public.admin_users
from public, anon, authenticated;

-- Grant all table privileges to service_role
grant all on table
  public.cities, public.city_zones, public.participants,
  public.participant_city_sequences, public.participant_sessions,
  public.participant_submission_sequences, public.survey_questions,
  public.survey_submissions, public.survey_answers, public.consent_records,
  public.daily_activity_entries, public.submission_email_notifications,
  public.admin_users
to service_role;

-- Revoke truncate unconditionally from all roles
revoke truncate on table
  public.cities, public.city_zones, public.participants,
  public.participant_city_sequences, public.participant_sessions,
  public.participant_submission_sequences, public.survey_questions,
  public.survey_submissions, public.survey_answers, public.consent_records,
  public.daily_activity_entries, public.submission_email_notifications,
  public.admin_users
from public, anon, authenticated, service_role;

-- Function execution grants
revoke all on function public.register_participant(text, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_participant(text, uuid, uuid, text, timestamptz)
  to service_role;

revoke all on function public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean, boolean, jsonb)
  to service_role;

revoke all on function public.admin_hide_submission(uuid) from public, anon, authenticated;
grant execute on function public.admin_hide_submission(uuid) to service_role;

revoke all on function public.admin_restore_submission(uuid) from public, anon, authenticated;
grant execute on function public.admin_restore_submission(uuid) to service_role;

revoke all on function public.admin_set_moderation(uuid, public.moderation_status) from public, anon, authenticated;
grant execute on function public.admin_set_moderation(uuid, public.moderation_status) to service_role;

revoke all on function public.next_participant_id(uuid), public.next_submission_number(uuid)
  from public, anon, authenticated;
grant execute on function public.next_participant_id(uuid), public.next_submission_number(uuid)
  to service_role;

revoke all on function public.lock_consent_stream(uuid, uuid, public.consent_type)
  from public, anon, authenticated;
grant execute on function public.lock_consent_stream(uuid, uuid, public.consent_type)
  to service_role;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Enable and force row level security across all application tables
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'cities', 'city_zones', 'participants', 'participant_city_sequences',
    'participant_sessions', 'participant_submission_sequences',
    'survey_questions', 'survey_submissions', 'survey_answers',
    'consent_records', 'daily_activity_entries',
    'submission_email_notifications', 'admin_users'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('alter table public.%I force row level security', tbl);
  end loop;
end;
$$;

commit;
