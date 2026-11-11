-- Question definitions are immutable after answers exist. Create a new active
-- version rather than changing the answered v2 definitions in place.
do $$
declare
  active_version text;
  next_version text := 'v3';
begin
  if exists (
    select 1
      from public.survey_questions
     where survey_version = next_version
       and is_active
  ) then
    return;
  end if;

  select min(survey_version)
    into active_version
    from public.survey_questions
   where is_active;

  if active_version is null then
    return;
  end if;

  insert into public.survey_questions
    (question_key, question_text, question_type, section, city_id,
     options, validation_rules, visibility_rule, is_required,
     display_order, survey_version, is_active)
  select question_key,
         question_text,
         question_type,
         section,
         city_id,
         case
           when question_key in (
             'perceived_air_quality',
             'public_transport_awareness'
           ) then '["1","2","3","4","5"]'::jsonb
           else options
         end,
         case question_key
           when 'perceived_air_quality' then
             '{"min":1,"max":5,"step":1,"labels":{"1":"Very poor","5":"Very good"}}'::jsonb
           when 'public_transport_awareness' then
             '{"min":1,"max":5,"step":1,"labels":{"1":"Not aware","5":"Very aware"}}'::jsonb
           else validation_rules
         end,
         visibility_rule,
         is_required,
         display_order,
         next_version,
         true
    from public.survey_questions
   where survey_version = active_version
     and is_active;

  update public.survey_questions
     set is_active = false
   where survey_version = active_version
     and is_active;
end;
$$;
