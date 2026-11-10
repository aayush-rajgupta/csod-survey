# Database hardening test plan

These are integration tests for an isolated Supabase project after applying
migrations 0001 through 0006. They are intentionally not run against
production.

## Required scenarios

- Concurrent participant registration allocates unique public IDs.
- Email addresses differing only by case or surrounding whitespace collide
  after normalization.
- Repeat submissions for one participant receive unique numbers.
- Concurrent submission-number allocation returns no duplicates.
- Common questions are globally unique per version; city questions are unique
  per city and version.
- Answers cannot cross city or survey-version boundaries.
- Consent submissions must belong to the same participant.
- Consent rows are append-only.
- Public visibility requires approved moderation and active public consent.
- A public-display withdrawal clears public visibility.
- Anonymous and authenticated clients cannot directly query private tables.
- `is_admin()` rejects non-admin sessions and accepts the configured admin.

## Follow-up migration scenarios

After applying `0003_integrity_and_consent_fixes.sql`, additionally test:

- A new consent event explicitly distinguishes `granted`, `declined`, and
  `withdrawn`; an initial decline has no `withdrawn_at`.
- A withdrawal is rejected unless the latest event for that stream is granted.
- Existing false rows shaped like withdrawals are `legacy_ambiguous` because
  0002 timestamped every false record; they are never treated as proof of
  genuine withdrawal or as authorization for public visibility.
- Event sequence values are unique and strictly increasing by insertion order.
- Publication uses the latest event, so a later decline or withdrawal blocks
  visibility even when an earlier grant exists.
- Run publication and withdrawal on separate connections repeatedly; the final
  state must never be visible after a withdrawal commits.
- Update every historical question-definition field after an answer exists;
  each update and deletion must fail.
- Change `participant_id` after answers and after consent records; both must
  fail.
- Concurrent answer insertion and question/submission scope changes must
  serialize through row locks and never accept a cross-city or version-matched
  invalid row.
- A submission for an unverified participant must fail.
- Seed pre-existing valid participant IDs and assert allocation advances past
  the maximum. Seed malformed, mismatched, or overlong IDs and assert
  allocation fails loudly.
- Attempt `TRUNCATE` and direct table access as `anon` and `authenticated`;
  assert denial. Confirm the configured administrator can use `is_admin()`.
- Inspect `pg_proc` and `information_schema.role_routine_grants` to confirm
  security-definer owners, explicit search paths, and service-role-only
  allocation execution.

Concurrency cases must use separate database connections. Session tests must
use Supabase JWT claims for anonymous, authenticated, and administrator
identities; do not treat a service-role client as evidence of public access
control.

## Final correction scenarios

After applying `0004_consent_and_integrity_corrections.sql`, additionally test:

- Insert legacy-shaped false records through the actual 0002 trigger behavior,
  then migrate them and assert `legacy_ambiguous` provenance and no public
  authorization.
- Insert two consent events concurrently on separate connections and assert
  unique sequence values ordered by serialized insertion.
- Submit concurrent grant and decline events and assert the committed latest
  event alone determines publication eligibility.
- Race withdrawal and publication on separate connections and assert a
  withdrawn latest event cannot leave visibility enabled.
- Supply `event_sequence` and provenance values from a caller and assert the
  BEFORE INSERT trigger replaces both.
- Change submission city, survey version, and participant independently after
  answers/consent; each must fail under its specified condition.
- Change `question_key` after an answer exists and assert failure; delete the
  answered question and assert failure.
- Attempt `TRUNCATE` using `service_role` and assert denial.
- Execute `lock_consent_stream()` as anonymous and authenticated JWT sessions
  and assert denial; verify the intended server-side role can execute it.

## 0005 lock-order and reconciliation scenarios

After applying `0005_consent_lock_order_and_visibility_reconciliation.sql`,
additionally test:

- Consent insertion for a submission locks `survey_submissions` first, then
  the consent-stream advisory lock; publication uses the same order.
- Run concurrent consent insertion and submission updates on separate
  connections and assert no inconsistent latest-consent/publication state.
- Run concurrent grant/decline and withdrawal/publication operations on
  separate connections; assert the committed latest event controls visibility.
- Seed visible submissions with ambiguous legacy consent, no applicable
  consent, and unapproved moderation; assert reconciliation clears visibility
  without modifying consent rows.
- Assert event sequences are ordered within one stream and remain unique.
- Roll back an event insert and assert the next sequence may contain a gap but
  never reuses the rolled-back value.
- Attempt `TRUNCATE` using `service_role` and assert denial for every
  application table.
- Execute `lock_consent_stream()` with anonymous and authenticated Supabase
  JWT claims and assert denial; verify only the intended server-side role can
  execute it.

The executable test harness should use separate database connections for
concurrency cases and should assert both database errors and resulting rows.
