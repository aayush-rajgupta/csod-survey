-- Expand the two rating questions without changing their ordering.
-- If the active questionnaire has answers, create a new version so historical
-- question definitions and submissions remain immutable.
do $$
declare
  question_record public.survey_questions;
  has_active_answers boolean;
  new_options jsonb;
  new_validation_rules jsonb;
begin
  select exists (
    select 1
      from public.survey_answers answers
      join public.survey_questions questions
        on questions.id = answers.question_id
     where questions.survey_version = 'v1'
       and questions.is_active
  ) into has_active_answers;

  if has_active_answers then
    for question_record in
      select *
        from public.survey_questions
       where survey_version = 'v1'
         and is_active
       order by display_order, id
    loop
      new_options := question_record.options;
      new_validation_rules := question_record.validation_rules;

      if question_record.question_key = 'perceived_air_quality' then
        new_options := '["1","2","3","4","5","6","7","8","9","10"]'::jsonb;
        new_validation_rules :=
          '{"min":1,"max":10,"step":1,"labels":{"1":"Very poor","10":"Excellent"}}'::jsonb;
      elsif question_record.question_key = 'public_transport_awareness' then
        new_options := '["1","2","3","4","5","6","7","8","9","10"]'::jsonb;
        new_validation_rules :=
          '{"min":1,"max":10,"step":1,"labels":{"1":"Not aware at all","10":"Extremely aware"}}'::jsonb;
      end if;

      update public.survey_questions
         set is_active = false
       where id = question_record.id;

      insert into public.survey_questions
        (question_key, question_text, question_type, section, city_id,
         options, validation_rules, visibility_rule, is_required,
         display_order, survey_version, is_active)
      values
        (question_record.question_key, question_record.question_text,
         question_record.question_type, question_record.section,
         question_record.city_id, new_options, new_validation_rules,
         question_record.visibility_rule, question_record.is_required,
         question_record.display_order, 'v2', true);
    end loop;
  else
    update public.survey_questions
       set options = '["1","2","3","4","5","6","7","8","9","10"]'::jsonb,
           validation_rules =
             '{"min":1,"max":10,"step":1,"labels":{"1":"Very poor","10":"Excellent"}}'::jsonb
     where question_key = 'perceived_air_quality'
       and survey_version = 'v1'
       and city_id is null;

    update public.survey_questions
       set options = '["1","2","3","4","5","6","7","8","9","10"]'::jsonb,
           validation_rules =
             '{"min":1,"max":10,"step":1,"labels":{"1":"Not aware at all","10":"Extremely aware"}}'::jsonb
     where question_key = 'public_transport_awareness'
       and survey_version = 'v1'
       and city_id is null;
  end if;
end;
$$;

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
