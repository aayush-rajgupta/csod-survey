create extension if not exists "pgcrypto";

create type public.moderation_status as enum ('pending', 'approved', 'rejected');
create type public.question_type as enum (
  'short_text', 'long_text', 'number', 'date',
  'multiple_choice', 'checkboxes', 'linear_scale', 'dropdown'
);
create type public.consent_type as enum (
  'research_participation', 'public_display', 'future_communication'
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  city_code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.city_zones (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  zone_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (city_id, zone_name)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  public_participant_id text not null unique,
  email text not null unique,
  email_verified boolean not null default false,
  email_verified_at timestamptz,
  city_id uuid references public.cities(id) on delete restrict,
  contact_opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participant_city_sequences (
  city_id uuid primary key references public.cities(id) on delete cascade,
  next_value bigint not null default 1 check (next_value > 0)
);

create table public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  question_key text not null,
  question_text text not null,
  question_type public.question_type not null,
  section text not null,
  city_id uuid references public.cities(id) on delete cascade,
  options jsonb not null default '[]'::jsonb,
  validation_rules jsonb not null default '{}'::jsonb,
  visibility_rule jsonb,
  is_required boolean not null default false,
  display_order integer not null check (display_order >= 0),
  survey_version text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (question_key, survey_version, city_id)
);

create table public.survey_submissions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  city_id uuid not null references public.cities(id) on delete restrict,
  submission_date date not null,
  submission_number integer not null check (submission_number > 0),
  survey_version text not null,
  moderation_status public.moderation_status not null default 'pending',
  public_visibility boolean not null default false,
  created_at timestamptz not null default now(),
  unique (participant_id, submission_number)
);

create table public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.survey_submissions(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete restrict,
  answer jsonb not null,
  created_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete restrict,
  submission_id uuid references public.survey_submissions(id) on delete cascade,
  consent_type public.consent_type not null,
  consent_version text not null,
  consent_status boolean not null,
  consented_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'super_admin' check (role = 'super_admin'),
  created_at timestamptz not null default now()
);

create index survey_submissions_city_date_idx
  on public.survey_submissions (city_id, submission_date);
create index survey_submissions_public_idx
  on public.survey_submissions (public_visibility, moderation_status);
create index survey_answers_submission_idx on public.survey_answers (submission_id);
create index consent_records_participant_idx on public.consent_records (participant_id);

alter table public.cities enable row level security;
alter table public.city_zones enable row level security;
alter table public.participants enable row level security;
alter table public.participant_city_sequences enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_submissions enable row level security;
alter table public.survey_answers enable row level security;
alter table public.consent_records enable row level security;
alter table public.admin_users enable row level security;

-- Public reads will use explicit server-side allowlists, not direct table access.
-- Policies are added with each feature so anonymous users never receive private rows.
