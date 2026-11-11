-- CSOD Survey consent lock ordering and visibility reconciliation.
-- Additive only. Do not edit 0001, 0002, 0003, or 0004.

-- Lock order for submission-specific operations:
--   1. survey_submissions row FOR UPDATE
--   2. consent-stream advisory lock
--   3. latest consent event read and any state change
-- Participant-level consent (submission_id IS NULL) uses only step 2.
-- All callers must follow this order. A caller that locks the advisory key
-- before the submission row can still deadlock with these triggers.

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
   order by event_sequence desc, id desc
   limit 1;

  if new.consent_event = 'withdrawn'
     and latest_event is distinct from 'granted' then
    raise exception 'Consent can be withdrawn only after a granted event';
  end if;

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

create or replace function public.enforce_public_visibility_consent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  latest_event public.consent_event;
  latest_provenance public.consent_event_provenance;
  locked_submission_id uuid;
begin
  if new.id is not null then
    select id
      into locked_submission_id
      from public.survey_submissions
     where id = new.id
     for update;
  end if;

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
     order by event_sequence desc, id desc
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

create or replace function public.revoke_public_visibility_on_consent_event()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  latest_event public.consent_event;
  latest_provenance public.consent_event_provenance;
begin
  if new.submission_id is not null
     and new.consent_type = 'public_display' then
    select consent_event, event_provenance
      into latest_event, latest_provenance
      from public.consent_records
     where participant_id = new.participant_id
       and submission_id = new.submission_id
       and consent_type = 'public_display'
     order by event_sequence desc, id desc
     limit 1;

    if latest_event is distinct from 'granted'
       or latest_provenance = 'legacy_ambiguous' then
      update public.survey_submissions
         set public_visibility = false
       where id = new.submission_id
         and public_visibility;
    end if;
  end if;
  return new;
end;
$$;

-- Reconcile already-visible rows without changing consent history. The
-- lateral query selects exactly one latest applicable event deterministically.
update public.survey_submissions submissions
   set public_visibility = false
 where submissions.public_visibility
   and (
     submissions.moderation_status <> 'approved'
     or not exists (
       select 1
         from lateral (
           select consent_event, event_provenance
             from public.consent_records records
            where records.participant_id = submissions.participant_id
              and records.submission_id = submissions.id
              and records.consent_type = 'public_display'
            order by records.event_sequence desc, records.id desc
            limit 1
         ) latest
        where latest.consent_event = 'granted'
          and latest.event_provenance <> 'legacy_ambiguous'
     )
   );

revoke all on function public.lock_consent_stream(
  uuid, uuid, public.consent_type
) from public, anon, authenticated;
grant execute on function public.lock_consent_stream(
  uuid, uuid, public.consent_type
) to service_role;

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
alter table public.survey_submissions force row level security;
alter table public.survey_answers force row level security;
alter table public.survey_questions force row level security;
