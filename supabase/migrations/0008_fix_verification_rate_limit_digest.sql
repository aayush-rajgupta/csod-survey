-- Replace the pending verification design with session-based registration.
-- Migration 0007 is deployed and remains unchanged.

drop function if exists public.consume_participant_verification_token(
  text,
  text,
  timestamptz
);
drop function if exists public.consume_participant_verification_rate_limit(
  text,
  integer,
  integer
);
drop table if exists public.participant_verification_tokens;
drop table if exists public.participant_verification_rate_limits;

drop index if exists public.participants_email_normalized_key;

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
declare
  normalized_email text := public.normalize_email(p_email);
  new_participant_id uuid;
begin
  if normalized_email is null or normalized_email = '' then
    raise exception 'Participant email is required';
  end if;

  if p_session_token_hash is null or p_session_token_hash = '' then
    raise exception 'Participant session is required';
  end if;

  if p_session_expires_at <= clock_timestamp() then
    raise exception 'Participant session expiry must be in the future';
  end if;

  if not exists (
    select 1
      from public.cities
     where id = p_city_id
       and is_active
  ) then
    raise exception 'Selected city is unavailable';
  end if;

  if not exists (
    select 1
      from public.city_zones
     where id = p_zone_id
       and city_id = p_city_id
       and is_active
  ) then
    raise exception 'Selected zone is unavailable for this city';
  end if;

  new_participant_id := public.next_participant_id(p_city_id);

  insert into public.participants
    (public_participant_id, email, email_verified, email_verified_at, city_id)
  values
    (new_participant_id, normalized_email, false, null, p_city_id)
  returning id into register_participant.participant_id;

  insert into public.participant_sessions
    (participant_id, session_token_hash, expires_at)
  values
    (register_participant.participant_id, p_session_token_hash, p_session_expires_at);

  return next;
end;
$$;

revoke all on function public.register_participant(text, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_participant(text, uuid, uuid, text, timestamptz)
  to service_role;

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

create or replace function public.submit_participant_survey(
  p_participant_id uuid,
  p_city_id uuid,
  p_zone_id uuid,
  p_answers jsonb,
  p_public_display boolean,
  p_future_communication boolean
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
  active_version text;
  version_count integer;
  allocated_number integer;
  new_submission_id uuid;
  required_count integer;
  supplied_count integer;
begin
  select *
    into participant_record
    from public.participants
   where id = p_participant_id
   for update;

  if not found then
    raise exception 'A valid participant session is required';
  end if;

  if not exists (
    select 1 from public.cities
     where id = p_city_id and is_active
  ) then
    raise exception 'Selected city is unavailable';
  end if;

  if not exists (
    select 1 from public.city_zones
     where id = p_zone_id and city_id = p_city_id and is_active
  ) then
    raise exception 'Selected zone is unavailable for this city';
  end if;

  select count(distinct questions.survey_version), min(questions.survey_version)
    into version_count, active_version
    from public.survey_questions questions
   where questions.is_active
     and (questions.city_id is null or questions.city_id = p_city_id);

  if version_count <> 1 or active_version is null then
    raise exception 'The active questionnaire is not consistently versioned';
  end if;

  select count(*)
    into required_count
    from public.survey_questions
   where is_active
     and is_required
     and survey_version = active_version
     and (city_id is null or city_id = p_city_id);

  select count(distinct question_id)
    into supplied_count
    from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb))
      as supplied(question_id uuid, answer jsonb);

  if exists (
    select 1
      from public.survey_questions questions
     where questions.is_active
       and questions.is_required
       and questions.survey_version = active_version
       and (questions.city_id is null or questions.city_id = p_city_id)
       and not exists (
         select 1
           from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb))
             as supplied(question_id uuid, answer jsonb)
          where supplied.question_id = questions.id
            and supplied.answer is not null
       )
  ) then
    raise exception 'Required survey answers are missing';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb))
        as supplied(question_id uuid, answer jsonb)
      left join public.survey_questions questions
        on questions.id = supplied.question_id
       and questions.is_active
       and questions.survey_version = active_version
       and (questions.city_id is null or questions.city_id = p_city_id)
     where questions.id is null or supplied.answer is null
  ) then
    raise exception 'Survey answers do not match the active questionnaire';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb))
        as supplied(question_id uuid, answer jsonb)
     group by supplied.question_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate survey answers are not allowed';
  end if;

  allocated_number := public.next_submission_number(p_participant_id);

  insert into public.survey_submissions
    (participant_id, city_id, zone_id, submission_date, submission_number, survey_version)
  values
    (p_participant_id, p_city_id, p_zone_id, current_date, allocated_number, active_version)
  returning id into new_submission_id;

  insert into public.survey_answers (submission_id, question_id, answer)
  select new_submission_id, supplied.question_id, supplied.answer
    from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb))
      as supplied(question_id uuid, answer jsonb);

  insert into public.consent_records
    (participant_id, submission_id, consent_type, consent_version, consent_event)
  values
    (p_participant_id, new_submission_id, 'research_participation', active_version, 'granted'),
    (p_participant_id, new_submission_id, 'public_display', active_version,
      case when p_public_display then 'granted' else 'declined' end),
    (p_participant_id, new_submission_id, 'future_communication', active_version,
      case when p_future_communication then 'granted' else 'declined' end);

  return query
    select new_submission_id, participant_record.public_participant_id,
           allocated_number, active_version;
end;
$$;

revoke all on function public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean)
  to service_role;
