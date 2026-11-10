-- CSOD Survey final integrity corrections.
-- Additive only. Do not edit 0001, 0002, or 0003.

create type public.consent_event_provenance as enum (
  'legacy_ambiguous',
  'legacy_migrated',
  'new_event'
);

alter table public.consent_records
  add column event_provenance public.consent_event_provenance;

-- 0002 wrote withdrawn_at for every false record. Therefore every existing
-- withdrawn-shaped row is conservatively ambiguous; the old schema cannot
-- prove whether it was a refusal or a genuine withdrawal.
update public.consent_records
   set event_provenance = case
     when consent_event = 'withdrawn' then
       'legacy_ambiguous'::public.consent_event_provenance
     else
       'legacy_migrated'::public.consent_event_provenance
   end
 where event_provenance is null;

alter table public.consent_records
  alter column event_provenance set default 'new_event'::public.consent_event_provenance,
  alter column event_provenance set not null;

alter table public.consent_records
  drop constraint if exists consent_records_event_provenance_consistent;

alter table public.consent_records
  add constraint consent_records_event_provenance_consistent
  check (
    event_provenance <> 'legacy_ambiguous'
    or consent_event = 'withdrawn'
  );

-- The trigger now owns sequence allocation. No caller-supplied value or
-- sequence default can run before the consent-stream lock.
alter table public.consent_records
  alter column event_sequence drop default;

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
  perform public.lock_consent_stream(
    new.participant_id,
    new.submission_id,
    new.consent_type
  );

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

  select consent_event
    into latest_event
    from public.consent_records
   where participant_id = new.participant_id
     and submission_id is not distinct from new.submission_id
     and consent_type = new.consent_type
   order by event_sequence desc
   limit 1;

  if new.consent_event = 'withdrawn'
     and latest_event is distinct from 'granted' then
    raise exception 'Consent can be withdrawn only after a granted event';
  end if;

  -- The database assigns the sequence only after the stream lock.
  new.event_sequence := nextval('public.consent_event_sequence'::regclass);
  new.event_provenance := 'new_event';
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
  latest_provenance public.consent_event_provenance;
begin
  perform public.lock_consent_stream(
    new.participant_id,
    new.id,
    'public_display'
  );

  if new.public_visibility then
    select consent_event, event_provenance
      into latest_event, latest_provenance
      from public.consent_records
     where participant_id = new.participant_id
       and submission_id = new.id
       and consent_type = 'public_display'
     order by event_sequence desc
     limit 1;

    if new.moderation_status <> 'approved'
       or latest_event is distinct from 'granted'
       or latest_provenance = 'legacy_ambiguous' then
      raise exception 'Public visibility requires approved moderation and an unambiguous latest granted consent';
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

create or replace function public.validate_submission_relationships()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and new.city_id is distinct from old.city_id
     and exists (
       select 1
         from public.survey_answers
        where submission_id = old.id
     ) then
    raise exception 'Cannot change submission city after answers exist';
  end if;

  if tg_op = 'UPDATE'
     and new.survey_version is distinct from old.survey_version
     and exists (
       select 1
         from public.survey_answers
        where submission_id = old.id
     ) then
    raise exception 'Cannot change submission survey version after answers exist';
  end if;

  if tg_op = 'UPDATE'
     and new.participant_id is distinct from old.participant_id
     and (
       exists (
         select 1
           from public.survey_answers
          where submission_id = old.id
       )
       or exists (
         select 1
           from public.consent_records
          where submission_id = old.id
       )
     ) then
    raise exception 'Cannot change submission participant after answers or consent records exist';
  end if;

  if not exists (
    select 1
      from public.participants
     where id = new.participant_id
       and email_verified
       and email_verified_at is not null
  ) then
    raise exception 'A verified participant email is required for submissions';
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

revoke all on function public.lock_consent_stream(uuid, uuid, public.consent_type)
  from public, anon, authenticated;
grant execute on function public.lock_consent_stream(uuid, uuid, public.consent_type)
  to service_role;

revoke all on function public.next_participant_id(uuid)
  from public, anon, authenticated;
revoke all on function public.next_submission_number(uuid)
  from public, anon, authenticated;
grant execute on function public.next_participant_id(uuid) to service_role;
grant execute on function public.next_submission_number(uuid) to service_role;

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
from public, anon, authenticated, service_role;

alter table public.consent_records force row level security;
alter table public.survey_questions force row level security;
alter table public.survey_submissions force row level security;
alter table public.survey_answers force row level security;
