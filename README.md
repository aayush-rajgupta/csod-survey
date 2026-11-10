# CSOD Survey

CSOD Survey is a citizen science air-quality survey platform for Bhubaneswar,
Mumbai, Bengaluru, Jamshedpur, and Patna.

## Initial architecture

- **Web:** Next.js App Router, TypeScript strict mode, Tailwind CSS, shadcn/ui
  conventions, Lucide React, and Recharts.
- **Data:** Supabase PostgreSQL. All writes will go through server-side
  validation and controlled mutations; public exploration will use an explicit
  anonymised projection rather than raw table reads.
- **Authentication:** Supabase Auth for administrators only. Participants are
  identified by a verified, private email and a stable public participant ID.
- **Boundaries:** `src/app` contains routes, `src/components` reusable UI,
  `src/lib` shared server/client utilities, and `supabase/migrations` database
  evolution.

The initial migration models cities, configurable zones and versioned questions,
participants, repeatable submissions, answers, consent records, and admin
authorization. RLS is enabled on every table; feature milestones will add
least-privilege policies alongside their server-side operations.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set the Supabase URL and publishable key.
3. Apply `supabase/migrations/0001_initial_schema.sql`, then
   `supabase/migrations/0002_database_hardening.sql`, then
   `supabase/migrations/0003_integrity_and_consent_fixes.sql`, then
   `supabase/migrations/0004_consent_and_integrity_corrections.sql`, then
   `supabase/migrations/0005_consent_lock_order_and_visibility_reconciliation.sql`,
   then `supabase/migrations/0006_enable_submission_sequence_rls.sql`, then
   `supabase/migrations/0007_participant_verification_and_submission.sql`
   in a Supabase project.
4. Start the development server:

```bash
npm run dev
```

Open http://localhost:3000.

## Planned milestones

1. Seed supported cities and build the configurable survey/question schema.
2. Implement verified participant registration and consent flows.
3. Implement server-side submissions with abuse controls.
4. Add the anonymised public explorer and aggregate analytics.
5. Add protected admin moderation, configuration, and exports.
6. Add RLS integration tests, deployment configuration, and production checks.

## Participant experience

The participant landing flow is implemented in
`src/app/participant-experience.tsx`. It loads active cities, zones, and
versioned questions through server-only Supabase service-role queries, keeps
participant email out of browser database reads, supports mobile-friendly
questionnaire navigation, and presents research, public-display, and future
communication consent as independent choices.

The participant verification and submission backend is now implemented in
`src/lib/participant-server.ts` and migration
`supabase/migrations/0007_participant_verification_and_submission.sql`.
Configure `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`
server-side to send verification links through Resend. The service-role key
must remain server-only. Verification tokens are random, single-use, hashed
with SHA-256, and expire after 30 minutes; participant sessions are opaque
HttpOnly/Secure/SameSite cookies. Migration `0007` must be applied before
using this flow; it adds zone persistence, verification/session tables, and
the transactional submission function.

## Database hardening

`0002_database_hardening.sql` preserves the original tables and adds:

- Canonical email normalization (`trim` + lowercase), case-insensitive
  uniqueness, non-empty validation, and verification/timestamp consistency.
- Automatic participant `updated_at` maintenance.
- Partial unique indexes that correctly distinguish common questions
  (`city_id is null`) from city-specific questions.
- JSONB shape constraints for question options, validation rules, and
  visibility rules, plus non-empty options for choice questions.
- Transaction-safe public participant ID allocation by city through a
  `SECURITY DEFINER` function, with a restricted `search_path` and execution
  granted only to `service_role`.
- Transaction-safe repeat-submission numbering using a participant sequence
  table and an atomic upsert function, also restricted to `service_role`.
- Trigger validation that answers match both the submission survey version and
  city, while common questions remain valid for every city.
- Append-only consent history and participant/submission consistency checks.
  Public visibility requires approved moderation and an active public-display
  consent record; a withdrawal immediately clears visibility.
- Additional relationship and lookup indexes.
- A restricted `is_admin()` helper for authenticated sessions. Private tables
  have no direct `anon` or `authenticated` table privileges, and all tables
  are forced through RLS.

The migration intentionally does not create public read or write policies.
Public exploration must use a later, explicit anonymised projection or
server-side query. The Supabase service-role key remains server-only.

## Follow-up integrity fixes

`0003_integrity_and_consent_fixes.sql` adds an append-only consent event model:
`granted`, `declined`, and `withdrawn`. Existing rows are migrated without
claiming certainty: `consent_status = false` with a prior non-null
`withdrawn_at` is mapped to `withdrawn`; other false rows are mapped to
`declined`. The old schema cannot distinguish those cases reliably, so this
ambiguity is retained in the migration history.

Each event receives a global monotonic `event_sequence`. Publication checks the
latest event in the participant/submission/consent stream, not merely the
existence of any granted row. Consent and publication operations lock the same
submission and consent stream, preventing a concurrent withdrawal from being
overridden by publication.

Answered question definitions are immutable, including text, type, options,
required state, validation and visibility rules, section, and ordering.
Submission participants cannot change after answers or consent records exist.
Submissions require a verified participant email.

Participant ID allocation now locks the city row, inspects existing IDs, and
raises on malformed or mismatched IDs rather than silently risking a collision.
The allocator also advances past pre-existing parsed IDs before allocating.

All privileged allocation functions are owned by `postgres`, use an explicit
`pg_catalog, public` search path, and are executable only by `service_role`.
Non-service roles have no table or `TRUNCATE` privileges, and RLS remains
forced on the affected tables.

## Final integrity corrections

`0004_consent_and_integrity_corrections.sql` records explicit provenance for
consent events. Because `0002` assigned `withdrawn_at` to every false consent,
all existing withdrawn-shaped rows are marked `legacy_ambiguous`; they are not
treated as proof of a genuine withdrawal and cannot authorize public
visibility. Existing granted/declined-shaped rows are marked
`legacy_migrated`. New events are marked `new_event`.

The consent trigger now acquires the stream lock before assigning
`event_sequence`, ignores caller-supplied sequence and provenance values, and
serializes grant/decline/withdrawal decisions within each stream. Publication
uses the latest event and rejects ambiguous legacy authorization.

The submission trigger again protects city, survey version, and participant
changes independently, while retaining verified-email and active-city checks.
Answered question keys are immutable along with the rest of the historical
definition. `TRUNCATE` is explicitly revoked from `service_role` as well as
public roles, and direct execution of the consent lock helper is limited to
`service_role`.

## Lock ordering and visibility reconciliation

`0005_consent_lock_order_and_visibility_reconciliation.sql` standardizes
submission-specific consent and publication operations to this order:

1. Lock the `survey_submissions` row with `FOR UPDATE`.
2. Acquire the consent-stream transaction advisory lock.
3. Read the latest consent event and make the decision.

Participant-level consent has no submission row and uses only the advisory
lock. Callers must not acquire these locks in the reverse order. A caller that
does so can still deadlock with a trigger following the canonical order; the
application must use the database functions and preserve this sequence.

The migration also reconciles existing visible submissions. It clears
`public_visibility` when moderation is not approved, no public-display consent
exists, the latest event is not granted, or the latest event is
`legacy_ambiguous`. Consent history is not changed. Latest-event selection is
deterministic by `event_sequence` and `id`.

`0006_enable_submission_sequence_rls.sql` is repository-only in this
milestone. It enables and forces RLS on
`participant_submission_sequences`; it has not been pushed or applied
remotely.

## Database verification

The guarded integration harness is at
`tests/integration/database.test.ts`. It uses PostgreSQL pool connections for
independent concurrency cases and Supabase clients with actual JWTs for
anonymous, authenticated, and administrator checks. It requires explicit
CSOD-Test variables and rejects production targets. Fixtures are uniquely
named, cleaned up by targeted IDs, and never removed with `TRUNCATE`.

Run the safe local mode with `npm run test:db`. Without CSOD-Test database
credentials and JWTs, remote database tests are skipped and are not reported
as passed. See `tests/integration/README.md` for the required variable names.

## Application-level validation still required

The database cannot safely replace all application policy. Server-side code
must still:

- Verify email ownership before marking a participant verified.
- Validate request payloads with Zod, including answer shape and value ranges
  described by each question's `validation_rules`.
- Allocate a participant ID and insert the participant in one transaction,
  passing the returned ID to the participant insert.
- Allocate a submission number and insert the submission in the same
  transaction; retry only on a documented serialization/deadlock failure.
- Enforce required-question completion, conditional visibility semantics, and
  survey-version selection.
- Apply rate limiting, bot/abuse controls, CSRF-aware request handling, and
  authorization checks before service-role operations.
- Use an explicit allowlist for public fields and suppress identifying
  free-text answers.
- Use `is_admin()` (or an equivalent server-side authorization check) before
  every administrator operation.

## Hardening integration-test plan

Run these tests against an isolated Supabase test project after both
migrations are applied. Use separate transactions/connections where
concurrency is specified; do not run them against production:

1. Register two participants concurrently in one city and assert distinct,
   sequential public IDs with no duplicate key errors.
2. Insert the same email with different casing and surrounding whitespace;
   assert the second insert fails after normalization.
3. Call `next_submission_number` concurrently for one participant and assert
   the returned values are unique, contiguous, and accepted by submissions.
4. Insert common and city-specific questions with the same key/version;
   assert common questions are unique globally and city-specific questions are
   unique only within their city.
5. Attempt an answer using a question from another city or survey version;
   assert the relationship trigger rejects it.
6. Attempt a consent record whose participant differs from its submission;
   assert rejection. Insert a withdrawal and assert the consent row cannot be
   updated or deleted afterward.
7. Attempt to set `public_visibility` true without approved moderation and
   active public consent; assert rejection. Withdraw public consent and assert
   visibility becomes false.
8. Query each private table as `anon` and `authenticated`; assert permission
   denial and no participant email/UUID exposure. Call `is_admin()` for a
   non-admin and an admin session and assert false/true respectively.
