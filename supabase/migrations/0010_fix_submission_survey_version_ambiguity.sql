-- Qualify submission survey-version queries and avoid the RETURNS TABLE
-- survey_version output variable colliding with database columns.
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
  v_survey_version text;
  version_count integer;
  allocated_number integer;
  new_submission_id uuid;
  required_count integer;
  supplied_count integer;
begin
  select participants.*
    into participant_record
    from public.participants
   where participants.id = p_participant_id
   for update;

  if not found then
    raise exception 'A valid participant session is required';
  end if;

  if not exists (
    select 1
      from public.cities cities
     where cities.id = p_city_id
       and cities.is_active
  ) then
    raise exception 'Selected city is unavailable';
  end if;

  if not exists (
    select 1
      from public.city_zones zones
     where zones.id = p_zone_id
       and zones.city_id = p_city_id
       and zones.is_active
  ) then
    raise exception 'Selected zone is unavailable for this city';
  end if;

  select count(distinct questions.survey_version),
         min(questions.survey_version)
    into version_count, v_survey_version
    from public.survey_questions questions
   where questions.is_active
     and (questions.city_id is null or questions.city_id = p_city_id);

  if version_count <> 1 or v_survey_version is null then
    raise exception 'The active questionnaire is not consistently versioned';
  end if;

  select count(*)
    into required_count
    from public.survey_questions required_questions
   where required_questions.is_active
     and required_questions.is_required
     and required_questions.survey_version = v_survey_version
     and (
       required_questions.city_id is null
       or required_questions.city_id = p_city_id
     );

  select count(distinct supplied.question_id)
    into supplied_count
    from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb))
      as supplied(question_id uuid, answer jsonb);

  if exists (
    select 1
      from public.survey_questions questions
     where questions.is_active
       and questions.is_required
       and questions.survey_version = v_survey_version
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
       and questions.survey_version = v_survey_version
       and (questions.city_id is null or questions.city_id = p_city_id)
     where questions.id is null
        or supplied.answer is null
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
    (p_participant_id, p_city_id, p_zone_id, current_date, allocated_number, v_survey_version)
  returning survey_submissions.id into new_submission_id;

  insert into public.survey_answers (submission_id, question_id, answer)
  select new_submission_id, supplied.question_id, supplied.answer
    from jsonb_to_recordset(coalesce(p_answers, '[]'::jsonb))
      as supplied(question_id uuid, answer jsonb);

  insert into public.consent_records
    (participant_id, submission_id, consent_type, consent_version, consent_event)
  values
    (p_participant_id, new_submission_id, 'research_participation', v_survey_version, 'granted'),
    (p_participant_id, new_submission_id, 'public_display', v_survey_version,
      (case when p_public_display then 'granted' else 'declined' end)::public.consent_event),
    (p_participant_id, new_submission_id, 'future_communication', v_survey_version,
      (case when p_future_communication then 'granted' else 'declined' end)::public.consent_event);

  return query
    select new_submission_id as submission_id,
           participant_record.public_participant_id as public_participant_id,
           allocated_number as submission_number,
           v_survey_version as survey_version;
end;
$$;

revoke all on function public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_participant_survey(uuid, uuid, uuid, jsonb, boolean, boolean)
  to service_role;
