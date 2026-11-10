-- Participant verification, secure sessions, zone persistence, and submission.
-- Additive only. Do not edit migrations 0001 through 0006.

alter table public.survey_submissions
  add column if not exists zone_id uuid
    references public.city_zones(id) on delete restrict;

create index if not exists survey_submissions_zone_idx
  on public.survey_submissions (zone_id);

create or replace function public.validate_submission_zone()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.zone_id is not null and not exists (
    select 1
      from public.city_zones zones
     where zones.id = new.zone_id
       and zones.city_id = new.city_id
       and zones.is_active
  ) then
    raise exception 'Submission zone does not belong to the selected active city';
  end if;
  return new;
end;
$$;

drop trigger if exists survey_submissions_validate_zone
  on public.survey_submissions;
create trigger survey_submissions_validate_zone
before insert or update of city_id, zone_id
on public.survey_submissions
for each row execute function public.validate_submission_zone();

create table public.participant_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index participant_verification_tokens_lookup_idx
  on public.participant_verification_tokens (token_hash, expires_at)
  where used_at is null;

create unique index participant_verification_tokens_one_active_idx
  on public.participant_verification_tokens (participant_id)
  where used_at is null;

create table public.participant_verification_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

create table public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index participant_sessions_lookup_idx
  on public.participant_sessions (session_token_hash, expires_at)
  where revoked_at is null;

alter table public.participant_verification_tokens enable row level security;
alter table public.participant_verification_tokens force row level security;
alter table public.participant_verification_rate_limits enable row level security;
alter table public.participant_verification_rate_limits force row level security;
alter table public.participant_sessions enable row level security;
alter table public.participant_sessions force row level security;

revoke all on table
  public.participant_verification_tokens,
  public.participant_verification_rate_limits,
  public.participant_sessions
from public, anon, authenticated;
grant all on table
  public.participant_verification_tokens,
  public.participant_verification_rate_limits,
  public.participant_sessions
to service_role;
revoke truncate on table
  public.participant_verification_tokens,
  public.participant_verification_rate_limits,
  public.participant_sessions
from public, anon, authenticated, service_role;

create or replace function public.consume_participant_verification_rate_limit(
  p_key text,
  p_limit integer default 3,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_window timestamptz := clock_timestamp();
  key_digest text := encode(digest(p_key, 'sha256'), 'hex');
  allowed boolean;
begin
  insert into public.participant_verification_rate_limits
    (key_hash, window_started_at, request_count)
  values (key_digest, current_window, 1)
  on conflict (key_hash) do update
    set request_count = case
      when public.participant_verification_rate_limits.window_started_at
           + make_interval(secs => p_window_seconds) <= current_window
        then 1
      else public.participant_verification_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.participant_verification_rate_limits.window_started_at
           + make_interval(secs => p_window_seconds) <= current_window
        then current_window
      else public.participant_verification_rate_limits.window_started_at
    end,
    updated_at = current_window
  returning request_count <= p_limit into allowed;
  return allowed;
end;
$$;

revoke all on function public.consume_participant_verification_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_participant_verification_rate_limit(text, integer, integer)
  to service_role;

create or replace function public.consume_participant_verification_token(
  p_token_hash text,
  p_session_token_hash text,
  p_session_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  token_record public.participant_verification_tokens;
begin
  select *
    into token_record
    from public.participant_verification_tokens
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > clock_timestamp()
   for update;

  if not found then
    raise exception 'Verification token is invalid or expired';
  end if;

  update public.participant_verification_tokens
     set used_at = clock_timestamp()
   where id = token_record.id;

  update public.participants
     set email_verified = true,
         email_verified_at = clock_timestamp()
   where id = token_record.participant_id;

  insert into public.participant_sessions
    (participant_id, session_token_hash, expires_at)
  values
    (token_record.participant_id, p_session_token_hash, p_session_expires_at);

  return token_record.participant_id;
end;
$$;

revoke all on function public.consume_participant_verification_token(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_participant_verification_token(text, text, timestamptz)
  to service_role;

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

  if not found or not participant_record.email_verified
     or participant_record.email_verified_at is null then
    raise exception 'A verified participant session is required';
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

  select count(distinct survey_version), min(survey_version)
    into version_count, active_version
    from public.survey_questions
   where is_active
     and (city_id is null or city_id = p_city_id);

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
