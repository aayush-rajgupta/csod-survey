-- Ensure the public dashboard and new submissions use one active v2
-- questionnaire even when the database had no answers when 0011 ran.
do $$
begin
  if not exists (
    select 1
      from public.survey_questions
     where survey_version = 'v2'
       and is_active
  ) and exists (
    select 1
      from public.survey_questions
     where survey_version = 'v1'
       and is_active
  ) then
    insert into public.survey_questions
      (question_key, question_text, question_type, section, city_id,
       options, validation_rules, visibility_rule, is_required,
       display_order, survey_version, is_active)
    select question_key, question_text, question_type, section, city_id,
           options, validation_rules, visibility_rule, is_required,
           display_order, 'v2', true
      from public.survey_questions
     where survey_version = 'v1'
       and is_active;

    update public.survey_questions
       set is_active = false
     where survey_version = 'v1'
       and is_active;
  end if;
end;
$$;
