-- Enable and force RLS on the participant submission sequence table.
-- This migration is repository-only until explicitly approved for remote use.

alter table public.participant_submission_sequences enable row level security;
alter table public.participant_submission_sequences force row level security;
