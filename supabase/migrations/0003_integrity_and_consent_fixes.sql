-- CSOD Survey integrity and consent follow-up fixes.
-- Additive only. Do not edit 0001_initial_schema.sql or 0002_database_hardening.sql.

create type public.consent_event as enum ('granted', 'declined', 'withdrawn');

create sequence public.consent_event_sequence
  as bigint
  start with 1
  increment by 1
  no cycle;

alter table public.consent_records
  drop constraint if exists consent_records_status_timestamps_consistent;

alter table public.consent_records
  add column consent_event public.consent_event,
  add column event_sequence bigint;

-- Existing rows cannot reliably distinguish a historical decline from a
-- withdrawal when both were stored as consent_status=false. A non-null
-- withdrawn_at is the only available evidence, so only those rows are mapped
-- to withdrawn; all other false rows are preserved as declined.
update public.consent_records
   set consent_event = case
     when consent_status and withdrawn_at is null then 'granted'::public.consent_event
     when not consent_status and withdrawn_at is not null then 'withdrawn'::public.consent_event
     else 'declined'::public.consent_event
   end
 where consent_event is null;

with ordered_events as (
  select id,
         row_number() over (order by created_at, id)::bigint as sequence_value
    from public.consent_records
)
update public.consent_records records
   set event_sequence = ordered_events.sequence_value
  from ordered_events
 where records.id = ordered_events.id
   and records.event_sequence is null;

select setval(
  'public.consent_event_sequence'::regclass,
  greatest(coalesce((select max(event_sequence) from public.consent_records), 0), 1),
  coalesce((select max(event_sequence) from public.consent_records), 0) > 0
);

alter table public.consent_records
  alter column consent_event set not null,
  alter column event_sequence set default nextval('public.consent_event_sequence'::regclass),
  alter column event_sequence set not null,
  add constraint consent_records_event_sequence_positive
    check (event_sequence > 0),
  add constraint consent_records_event_sequence_unique
    unique (event_sequence),
  add constraint consent_records_event_status_consistent
    check (
      consent_status = (consent_event = 'granted')
      and (
        (consent_event = 'withdrawn' and withdrawn_at is not null)
        or (consent_event <> 'withdrawn' and withdrawn_at is null)
      )
    );

create index consent_records_stream_order_idx
  on public.consent_records (
    participant_id,
    submission_id,
    consent_type,
    event_sequence desc
  );

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

  select consent_event
    into latest_event
    from public.consent_records
   where participant_id = new.participant_id
     and submission_id is not distinct from new.submission_id
     and consent_type = new.consent_type
   order by event_sequence desc
   limit 1;

  if new.consent_event = 'withdrawn' and latest_event is distinct from 'granted' then
    raise exception 'Consent can be withdrawn only after a granted event';
  end if;

  new.consent_status := (new.consent_event = 'granted');
  if new.consent_event = 'granted' then
    new.consented_at := coalesce(new.consented_at, clock_timestamp());
    new.withdrawn_at := null;
  elsif new.consent_event = 'declined' then
    new.consented_at := null;
    new.withdrawn_at := null;
  else
    new.consented_at := null;
    new.withdrawn_at := coalesce(new.withdrawn_at, clock_timestamp());
  end if;

  return new;
end;
$$;

drop trigger if exists consent_records_validate_relationship
  on public.consent_records;
create trigger consent_records_validate_relationship
before insert on public.consent_records
for each row execute function public.validate_consent_event();

create or replace function public.enforce_public_visibility_consent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  latest_event public.consent_event;
begin
  perform public.lock_consent_stream(
    new.participant_id,
    new.id,
    'public_display'
  );

  if new.public_visibility then
    select consent_event
      into latest_event
      from public.consent_records
     where participant_id = new.participant_id
       and submission_id = new.id
       and consent_type = 'public_display'
     order by event_sequence desc
     limit 1;

    if new.moderation_status <> 'approved'
       or latest_event is distinct from 'granted' then
      raise exception 'Public visibility requires approved moderation and latest granted public-display consent';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists survey_submissions_enforce_public_consent
  on public.survey_submissions;
create trigger survey_submissions_enforce_public_consent
before insert or update of participant_id, public_visibility, moderation_status
on public.survey_submissions
for each row execute function public.enforce_public_visibility_consent();

create or replace function public.revoke_public_visibility_on_consent_event()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  latest_event public.consent_event;
begin
  if new.submission_id is not null and new.consent_type = 'public_display' then
    select consent_event
      into latest_event
      from public.consent_records
     where participant_id = new.participant_id
       and submission_id = new.submission_id
       and consent_type = 'public_display'
     order by event_sequence desc
     limit 1;

    if latest_event is distinct from 'granted' then
      update public.survey_submissions
         set public_visibility = false
       where id = new.submission_id
         and public_visibility;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists consent_records_revoke_public_visibility
  on public.consent_records;
create trigger consent_records_revoke_public_visibility
after insert on public.consent_records
for each row execute function public.revoke_public_visibility_on_consent_event();

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
    new.question_text is distinct from old.question_text
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

  if not exists (
    select 1 from public.participants
     where id = new.participant_id
       and email_verified
       and email_verified_at is not null
  ) then
    raise exception 'A verified participant email is required for submissions';
  end if;

  if not exists (
    select 1 from public.cities
     where id = new.city_id and is_active
  ) then
    raise exception 'Submission city does not exist or is inactive';
  end if;

  return new;
end;
$$;

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
  select city_id, survey_version into submission_city, submission_version
    from public.survey_submissions
   where id = new.submission_id
   for share;

  select city_id, survey_version into question_city, question_version
    from public.survey_questions
   where id = new.question_id and is_active
   for share;

  if not found then
    raise exception 'Answer question does not exist or is inactive';
  end if;
  if submission_city is null then
    raise exception 'Answer submission does not exist';
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

create or replace function public.next_participant_id(p_city_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  city_code_value text;
  maximum_existing numeric;
  allocated_value bigint;
begin
  select city_code
    into city_code_value
    from public.cities
   where id = p_city_id and is_active
   for update;
  if city_code_value is null then
    raise exception 'Cannot allocate participant ID for inactive or unknown city';
  end if;

  if exists (
    select 1
      from public.participants
     where city_id = p_city_id
       and (
         public_participant_id !~ '^CSOD-[A-Za-z0-9]+-[0-9]+$'
         or split_part(public_participant_id, '-', 2) <> city_code_value
         or length(split_part(public_participant_id, '-', 3)) > 18
       )
  ) then
    raise exception 'Cannot allocate participant ID: an existing participant ID cannot be parsed safely';
  end if;

  select coalesce(max(substring(public_participant_id from '([0-9]+)$')::numeric), 0)
    into maximum_existing
    from public.participants
   where city_id = p_city_id;
  if maximum_existing >= 9223372036854775806 then
    raise exception 'Participant ID sequence exceeds bigint range';
  end if;

  insert into public.participant_city_sequences (city_id, next_value)
  values (p_city_id, greatest(1, maximum_existing + 1)::bigint + 1)
  on conflict (city_id) do update
    set next_value = greatest(
      public.participant_city_sequences.next_value,
      excluded.next_value - 1
    ) + 1
  returning next_value - 1 into allocated_value;

  return 'CSOD-' || city_code_value || '-' || lpad(allocated_value::text, 5, '0');
end;
$$;

alter function public.next_participant_id(uuid) owner to postgres;
alter function public.next_submission_number(uuid) owner to postgres;
alter function public.is_admin() owner to postgres;

revoke all on function public.next_participant_id(uuid) from public, anon, authenticated;
revoke all on function public.next_submission_number(uuid) from public, anon, authenticated;
grant execute on function public.next_participant_id(uuid) to service_role;
grant execute on function public.next_submission_number(uuid) to service_role;
revoke all on sequence public.consent_event_sequence from public, anon, authenticated;
grant usage, select on sequence public.consent_event_sequence to service_role;

create index participants_city_id_idx on public.participants (city_id);
create index city_zones_city_id_idx on public.city_zones (city_id);
create index survey_submissions_participant_id_idx
  on public.survey_submissions (participant_id);
create index consent_records_participant_submission_idx
  on public.consent_records (participant_id, submission_id);

revoke truncate on table
  public.cities,
  public.city_zones,
  public.participants,
  public.participant_city_sequences,
  public.participant_submission_sequences,
  public.survey_questions,
  public.survey_submissions,
  public.survey_answers,
  public.consent_records,
  public.admin_users
from public, anon, authenticated;

alter table public.consent_records force row level security;
alter table public.survey_questions force row level security;
alter table public.survey_submissions force row level security;
alter table public.survey_answers force row level security;
