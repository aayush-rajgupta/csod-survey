-- CSOD Survey database hardening.
-- This migration is intentionally additive/forward-only. Do not edit 0001.

create or replace function public.normalize_email(value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select lower(btrim(value));
$$;

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

alter table public.participants
  drop constraint if exists participants_email_key;

alter table public.participants
  add constraint participants_email_not_blank
  check (email = public.normalize_email(email) and email <> '');

create unique index participants_email_normalized_key
  on public.participants (public.normalize_email(email));

alter table public.participants
  add constraint participants_email_verification_consistent
  check (email_verified = (email_verified_at is not null));

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

alter table public.survey_questions
  drop constraint if exists survey_questions_question_key_survey_version_city_id_key;

alter table public.survey_questions
  add constraint survey_questions_text_not_blank
  check (btrim(question_key) <> '' and btrim(question_text) <> '' and btrim(section) <> ''),
  add constraint survey_questions_version_not_blank
  check (btrim(survey_version) <> ''),
  add constraint survey_questions_options_array
  check (jsonb_typeof(options) = 'array'),
  add constraint survey_questions_validation_object
  check (jsonb_typeof(validation_rules) = 'object'),
  add constraint survey_questions_visibility_object
  check (visibility_rule is null or jsonb_typeof(visibility_rule) = 'object'),
  add constraint survey_questions_choice_options
  check (
    question_type not in ('multiple_choice', 'checkboxes', 'dropdown')
    or jsonb_array_length(options) > 0
  );

alter table public.survey_submissions
  add constraint survey_submissions_version_not_blank
  check (btrim(survey_version) <> '');

create unique index survey_questions_common_key
  on public.survey_questions (question_key, survey_version)
  where city_id is null;

create unique index survey_questions_city_key
  on public.survey_questions (city_id, question_key, survey_version)
  where city_id is not null;

create index survey_questions_city_version_order_idx
  on public.survey_questions (city_id, survey_version, display_order)
  where is_active;

create table public.participant_submission_sequences (
  participant_id uuid primary key
    references public.participants(id) on delete cascade,
  next_value bigint not null default 1 check (next_value > 0)
);

create or replace function public.next_participant_id(p_city_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  city_code_value text;
  allocated_value bigint;
begin
  select city_code
    into city_code_value
    from public.cities
   where id = p_city_id
     and is_active;

  if city_code_value is null then
    raise exception 'Cannot allocate participant ID for inactive or unknown city';
  end if;

  insert into public.participant_city_sequences (city_id, next_value)
  values (p_city_id, 2)
  on conflict (city_id) do update
    set next_value = public.participant_city_sequences.next_value + 1
  returning next_value - 1 into allocated_value;

  return 'CSOD-' || city_code_value || '-' || lpad(allocated_value::text, 5, '0');
end;
$$;

create or replace function public.next_submission_number(p_participant_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  allocated_value bigint;
begin
  insert into public.participant_submission_sequences (participant_id, next_value)
  values (p_participant_id, 2)
  on conflict (participant_id) do update
    set next_value = public.participant_submission_sequences.next_value + 1
  returning next_value - 1 into allocated_value;

  if allocated_value > 2147483647 then
    raise exception 'Submission number exceeds integer range';
  end if;

  return allocated_value::integer;
end;
$$;

revoke all on function public.next_participant_id(uuid) from public, anon, authenticated;
revoke all on function public.next_submission_number(uuid) from public, anon, authenticated;
grant execute on function public.next_participant_id(uuid) to service_role;
grant execute on function public.next_submission_number(uuid) to service_role;

create or replace function public.validate_submission_relationships()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.city_id <> old.city_id or new.survey_version <> old.survey_version)
     and exists (
       select 1
         from public.survey_answers
        where submission_id = old.id
     ) then
    raise exception 'Cannot change submission city or survey version after answers exist';
  end if;

  if not exists (
    select 1
      from public.participants
     where id = new.participant_id
  ) then
    raise exception 'Submission participant does not exist';
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
   where id = new.submission_id;

  if submission_city is null then
    raise exception 'Answer submission does not exist';
  end if;

  select city_id, survey_version
    into question_city, question_version
    from public.survey_questions
   where id = new.question_id
     and is_active;

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

drop trigger if exists survey_answers_validate_relationships on public.survey_answers;
create trigger survey_answers_validate_relationships
before insert or update of submission_id, question_id
on public.survey_answers
for each row execute function public.validate_answer_relationships();

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

drop trigger if exists survey_questions_prevent_scope_change
  on public.survey_questions;
create trigger survey_questions_prevent_scope_change
before update of city_id, survey_version
on public.survey_questions
for each row execute function public.prevent_question_scope_change();

create index survey_answers_question_submission_idx
  on public.survey_answers (question_id, submission_id);

create index consent_records_submission_type_created_idx
  on public.consent_records (submission_id, consent_type, created_at desc);

create or replace function public.validate_consent_relationship()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  submission_participant uuid;
begin
  if new.submission_id is not null then
    select participant_id
      into submission_participant
      from public.survey_submissions
     where id = new.submission_id;

    if submission_participant is null then
      raise exception 'Consent submission does not exist';
    end if;

    if submission_participant <> new.participant_id then
      raise exception 'Consent participant does not match submission participant';
    end if;
  end if;

  if new.consent_status and new.consented_at is null then
    new.consented_at := clock_timestamp();
  elsif not new.consent_status then
    new.withdrawn_at := coalesce(new.withdrawn_at, clock_timestamp());
  end if;

  return new;
end;
$$;

drop trigger if exists consent_records_validate_relationship
  on public.consent_records;
create trigger consent_records_validate_relationship
before insert on public.consent_records
for each row execute function public.validate_consent_relationship();

alter table public.consent_records
  add constraint consent_records_status_timestamps_consistent
  check (
    (consent_status and consented_at is not null and withdrawn_at is null)
    or
    (not consent_status and withdrawn_at is not null)
  );

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

drop trigger if exists consent_records_append_only_update on public.consent_records;
create trigger consent_records_append_only_update
before update or delete on public.consent_records
for each row execute function public.prevent_consent_history_mutation();

create or replace function public.enforce_public_visibility_consent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.public_visibility and (
    new.moderation_status <> 'approved'
    or not exists (
      select 1
        from (
          select consent_status, withdrawn_at
            from public.consent_records
           where participant_id = new.participant_id
             and submission_id = new.id
             and consent_type = 'public_display'
           order by created_at desc
           limit 1
        ) latest_consent
       where latest_consent.consent_status
         and latest_consent.withdrawn_at is null
    )
  ) then
    raise exception 'Public visibility requires approved moderation and active public-display consent';
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

create or replace function public.revoke_public_visibility_on_withdrawal()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.consent_type = 'public_display'
     and not new.consent_status
     and new.submission_id is not null then
    update public.survey_submissions
       set public_visibility = false
     where id = new.submission_id;
  end if;
  return new;
end;
$$;

drop trigger if exists consent_records_revoke_public_visibility
  on public.consent_records;
create trigger consent_records_revoke_public_visibility
after insert on public.consent_records
for each row execute function public.revoke_public_visibility_on_withdrawal();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.admin_users
     where auth_user_id = (select auth.uid())
       and role = 'super_admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Keep private tables inaccessible to direct anonymous/authenticated queries.
-- Server-side service-role operations remain possible, while RLS remains enabled.
revoke all on table
  public.participants,
  public.participant_city_sequences,
  public.participant_submission_sequences,
  public.survey_submissions,
  public.survey_answers,
  public.consent_records,
  public.admin_users
from public, anon, authenticated;

revoke all on table public.cities, public.city_zones, public.survey_questions
from public, anon, authenticated;

grant all on table
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
to service_role;

alter table public.participants force row level security;
alter table public.participant_city_sequences force row level security;
alter table public.participant_submission_sequences force row level security;
alter table public.survey_submissions force row level security;
alter table public.survey_answers force row level security;
alter table public.consent_records force row level security;
alter table public.admin_users force row level security;
alter table public.cities force row level security;
alter table public.city_zones force row level security;
alter table public.survey_questions force row level security;
