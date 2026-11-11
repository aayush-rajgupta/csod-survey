import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadTestEnvironment(): void {
  const filePath = resolve(process.cwd(), ".env.test.local");
  if (!existsSync(filePath)) {
    return;
  }
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/u, "$2");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadTestEnvironment();

type TestContext = {
  pool: Pool;
  anon: SupabaseClient;
  authenticated: SupabaseClient;
  admin: SupabaseClient;
  fixture: Fixture;
};

type Fixture = {
  cityId: string;
  cityCode: string;
  secondCityId: string;
  participantId: string;
  unverifiedParticipantId: string;
  questionId: string;
  secondQuestionId: string;
  submissionId: string;
  submissionNumber: number;
};

const projectRef = process.env.CSOD_TEST_PROJECT_REF;
const confirmation = process.env.CSOD_TEST_CONFIRMATION;
const targetEnvironment = process.env.CSOD_TEST_ENVIRONMENT;
const databaseUrl = process.env.CSOD_TEST_DATABASE_URL;
const databaseHost = process.env.CSOD_TEST_DATABASE_HOST;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const authenticatedJwt = process.env.CSOD_TEST_AUTHENTICATED_JWT;
const adminJwt = process.env.CSOD_TEST_ADMIN_JWT;
const expectedProjectRef = "awcqwzxiawxuuvuzzmeu";
const expectedSupabaseHost = `${expectedProjectRef}.supabase.co`;
const expectedDatabaseHost = `db.${expectedProjectRef}.supabase.co`;
const expectedPoolerUser = `postgres.${expectedProjectRef}`;
function parseUrl(value: string | undefined): URL | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

const parsedSupabaseUrl = parseUrl(supabaseUrl);
const parsedDatabaseUrl = parseUrl(databaseUrl);
const databaseUser = parsedDatabaseUrl?.username;
const directDatabaseTarget =
  databaseHost === expectedDatabaseHost &&
  parsedDatabaseUrl?.hostname === expectedDatabaseHost &&
  databaseUser === "postgres";
const sessionPoolerTarget =
  Boolean(databaseHost) &&
  parsedDatabaseUrl?.hostname === databaseHost &&
  databaseUser === expectedPoolerUser;
const isConfigured =
  projectRef === expectedProjectRef &&
  confirmation === "CSOD-Test" &&
  targetEnvironment === "test" &&
  parsedSupabaseUrl?.protocol === "https:" &&
  parsedSupabaseUrl.hostname === expectedSupabaseHost &&
  (directDatabaseTarget || sessionPoolerTarget) &&
  Boolean(databaseUrl && supabaseUrl && publishableKey);

if (targetEnvironment === "production") {
  throw new Error(
    "Refusing database tests: CSOD_TEST_ENVIRONMENT must not be production.",
  );
}

function requireConfigured(): void {
  if (!isConfigured) {
    throw new Error(
      "Database integration tests require explicit CSOD-Test variables. " +
        "Set CSOD_TEST_PROJECT_REF, CSOD_TEST_CONFIRMATION=CSOD-Test, " +
          "CSOD_TEST_ENVIRONMENT=test, CSOD_TEST_DATABASE_HOST, " +
          "CSOD_TEST_DATABASE_URL with either postgres@" +
          `${expectedDatabaseHost} or ${expectedPoolerUser}@CSOD_TEST_DATABASE_HOST, ` +
        "NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
}

function clientForApiKey(): SupabaseClient {
  return createClient(supabaseUrl!, publishableKey!);
}

function clientForJwt(jwt: string): SupabaseClient {
  return createClient(supabaseUrl!, publishableKey!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function createFixture(pool: Pool): Promise<Fixture> {
  const client = await pool.connect();
  const suffix = randomUUID();
  try {
    await client.query("begin");
    const city = await client.query(
      `insert into public.cities (name, slug, city_code)
       values ($1, $2, $3) returning id, city_code`,
      [`Test City ${suffix}`, `db-test-${suffix}`, `TST${suffix.slice(0, 3)}`],
    );
    const secondCity = await client.query(
      `insert into public.cities (name, slug, city_code)
       values ($1, $2, $3) returning id`,
      [
        `Second Test City ${suffix}`,
        `db-test-second-${suffix}`,
        `TS2${suffix.slice(0, 3)}`,
      ],
    );
    const cityCode = city.rows[0].city_code as string;
    const participant = await client.query(
      `insert into public.participants
        (public_participant_id, email, email_verified, email_verified_at, city_id)
       values ($1, $2, true, now(), $3) returning id`,
      [
        `CSOD-${cityCode}-90001`,
        `db-test-${suffix}@example.test`,
        city.rows[0].id,
      ],
    );
    const unverified = await client.query(
      `insert into public.participants
        (public_participant_id, email)
       values ($1, $2) returning id`,
      [`CSOD-${cityCode}-90002`, `unverified-${suffix}@example.test`],
    );
    const question = await client.query(
      `insert into public.survey_questions
        (question_key, question_text, question_type, section,
         display_order, survey_version)
       values ($1, 'Fixture question', 'short_text', 'fixture', 1, 'fixture-v1')
       returning id`,
      [`fixture-question-${suffix}`],
    );
    const secondQuestion = await client.query(
      `insert into public.survey_questions
        (question_key, question_text, question_type, section,
         city_id, display_order, survey_version)
       values ($1, 'Fixture city question', 'short_text', 'fixture',
               $2, 2, 'fixture-v1') returning id`,
      [`fixture-city-question-${suffix}`, secondCity.rows[0].id],
    );
    const submissionNumber = await client.query(
      "select public.next_submission_number($1) as value",
      [participant.rows[0].id],
    );
    const submission = await client.query(
      `insert into public.survey_submissions
        (participant_id, city_id, submission_date, submission_number, survey_version)
       values ($1, $2, current_date, $3, 'fixture-v1') returning id`,
      [participant.rows[0].id, city.rows[0].id, submissionNumber.rows[0].value],
    );
    await client.query("commit");
    return {
      cityId: city.rows[0].id,
      cityCode,
      secondCityId: secondCity.rows[0].id,
      participantId: participant.rows[0].id,
      unverifiedParticipantId: unverified.rows[0].id,
      questionId: question.rows[0].id,
      secondQuestionId: secondQuestion.rows[0].id,
      submissionId: submission.rows[0].id,
      submissionNumber: submissionNumber.rows[0].value,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(pool: Pool, fixture: Fixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from public.survey_submissions where id = $1", [
      fixture.submissionId,
    ]);
    await client.query("delete from public.survey_questions where id in ($1, $2)", [
      fixture.questionId,
      fixture.secondQuestionId,
    ]);
    await client.query("delete from public.participants where id in ($1, $2)", [
      fixture.participantId,
      fixture.unverifiedParticipantId,
    ]);
    await client.query("delete from public.cities where id in ($1, $2)", [
      fixture.cityId,
      fixture.secondCityId,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function withContext(
  callback: (context: TestContext) => Promise<void>,
): Promise<void> {
  requireConfigured();
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  let fixture: Fixture | undefined;
  try {
    fixture = await createFixture(pool);
    const anon = clientForApiKey();
    const authenticated = authenticatedJwt
      ? clientForJwt(authenticatedJwt)
      : anon;
    const admin = adminJwt ? clientForJwt(adminJwt) : anon;
    await callback({ pool, anon, authenticated, admin, fixture });
  } finally {
    if (fixture) {
      await cleanupFixture(pool, fixture);
    }
    await pool.end();
  }
}

test("database integration suite refuses production targets", () => {
  assert.notEqual(targetEnvironment, "production");
  if (isConfigured) {
    assert.equal(targetEnvironment, "test");
  }
});

test("partial or missing configuration cannot authorize a remote run", () => {
  if (!isConfigured) {
    assert.throws(requireConfigured, /explicit CSOD-Test variables/u);
  }
});

test("RLS and security session checks", async (t) => {
  if (!isConfigured || !authenticatedJwt || !adminJwt) {
    t.skip("Requires isolated CSOD-Test database and authenticated/admin JWTs.");
    return;
  }
  await withContext(async ({ pool, anon, authenticated, admin }) => {
    const catalog = await pool.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`,
      [[
        "cities",
        "city_zones",
        "participants",
        "participant_city_sequences",
        "participant_submission_sequences",
        "survey_questions",
        "survey_submissions",
        "survey_answers",
        "consent_records",
        "admin_users",
      ]],
    );
    assert.equal(catalog.rowCount, 10);
    for (const row of catalog.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} RLS`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} forced RLS`);
    }

    for (const client of [anon, authenticated]) {
      const { error } = await client.from("participants").select("email").limit(1);
      assert.ok(error, "private participant query must be denied");
    }
    const { data, error } = await admin.rpc("is_admin");
    assert.equal(error, null);
    assert.equal(data, true);
    const nonAdmin = await authenticated.rpc("is_admin");
    assert.equal(nonAdmin.data, false);
    assert.equal(nonAdmin.error, null);
    const anonymousAdminCheck = await anon.rpc("is_admin");
    assert.ok(anonymousAdminCheck.error);

    const grants = await pool.query(
      `select p.proname, has_function_privilege(
         'anon', p.oid, 'execute'
       ) as anon_execute, has_function_privilege(
         'authenticated', p.oid, 'execute'
       ) as authenticated_execute
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any($1::text[])`,
      [["next_participant_id", "next_submission_number", "lock_consent_stream"]],
    );
    for (const grant of grants.rows) {
      assert.equal(grant.anon_execute, false, `${grant.proname} anon grant`);
      assert.equal(
        grant.authenticated_execute,
        false,
        `${grant.proname} authenticated grant`,
      );
    }
  });
});

test("email verification, participant allocation, and submission numbering", async (t) => {
  if (!isConfigured) {
    t.skip("Requires isolated CSOD-Test database.");
    return;
  }
  await withContext(async ({ pool, fixture }) => {
    const client = await pool.connect();
    try {
      const normalized = await client.query(
        `update public.participants set email = '  MIXED@Example.Test '
         where id = $1 returning email`,
        [fixture.participantId],
      );
      assert.equal(normalized.rows[0].email, "mixed@example.test");
      await assert.rejects(
        client.query(
          `insert into public.participants
            (public_participant_id, email, email_verified, email_verified_at, city_id)
           values ($1, 'MIXED@EXAMPLE.TEST', true, now(), $2)`,
          [`CSOD-${fixture.cityCode}-90003`, fixture.cityId],
        ),
      );
      await assert.rejects(
        client.query(
          `insert into public.survey_submissions
            (participant_id, city_id, submission_date, submission_number, survey_version)
           values ($1, $2, current_date, 99, 'fixture-v1')`,
          [fixture.unverifiedParticipantId, fixture.cityId],
        ),
      );
      const allocations = await Promise.all(
        Array.from({ length: 4 }, () =>
          pool.query("select public.next_submission_number($1) as value", [
            fixture.participantId,
          ]),
        ),
      );
      assert.equal(
        new Set(allocations.map((result) => result.rows[0].value)).size,
        4,
      );
      const allocatedNumbers = allocations.map((result) => result.rows[0].value);
      assert.ok(
        allocatedNumbers.every(
          (value: number) => value !== fixture.submissionNumber,
        ),
      );

      const participantIds = await Promise.all(
        Array.from({ length: 4 }, () =>
          pool.query("select public.next_participant_id($1) as value", [
            fixture.cityId,
          ]),
        ),
      );
      const ids = participantIds.map((result) => result.rows[0].value as string);
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(
        ids.every((value) =>
          new RegExp(`^CSOD-${fixture.cityCode}-[0-9]+$`, "u").test(value),
        ),
      );
    } finally {
      client.release();
    }
  });
});

test("relationship and consent lifecycle checks", async (t) => {
  if (!isConfigured) {
    t.skip("Requires isolated CSOD-Test database.");
    return;
  }
  await withContext(async ({ fixture, pool }) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into public.survey_answers (submission_id, question_id, answer)
         values ($1, $2, '"answer"')`,
        [fixture.submissionId, fixture.questionId],
      );
      await assert.rejects(
        client.query(
          "update public.survey_submissions set city_id = $1 where id = $2",
          [fixture.secondCityId, fixture.submissionId],
        ),
      );
      await assert.rejects(
        client.query(
          "update public.survey_submissions set survey_version = $1 where id = $2",
          ["fixture-v2", fixture.submissionId],
        ),
      );
      await client.query("rollback");

      await client.query("begin");
      await client.query(
        `insert into public.consent_records
          (participant_id, submission_id, consent_type, consent_version, consent_event)
         values ($1, $2, 'public_display', 'fixture-v1', 'declined')`,
        [fixture.participantId, fixture.submissionId],
      );
      const declined = await client.query(
        `select consent_status, consented_at, withdrawn_at
           from public.consent_records
          where submission_id = $1
          order by event_sequence desc limit 1`,
        [fixture.submissionId],
      );
      assert.equal(declined.rows[0].consent_status, false);
      assert.equal(declined.rows[0].withdrawn_at, null);
      await client.query("rollback");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});

test("consent sequencing, visibility, revocation, and relationship guards", async (t) => {
  if (!isConfigured) {
    t.skip("Requires isolated CSOD-Test database.");
    return;
  }
  await withContext(async ({ pool, fixture }) => {
    await assert.rejects(
      pool.query(
        `insert into public.consent_records
          (participant_id, submission_id, consent_type, consent_version, consent_event)
         values ($1, $2, 'public_display', 'fixture-v1', 'withdrawn')`,
        [fixture.participantId, fixture.submissionId],
      ),
    );

    const grant = await pool.query(
      `insert into public.consent_records
        (participant_id, submission_id, consent_type, consent_version, consent_event)
       values ($1, $2, 'public_display', 'fixture-v1', 'granted')
       returning event_sequence, event_provenance`,
      [fixture.participantId, fixture.submissionId],
    );
    assert.equal(grant.rows[0].event_provenance, "new_event");

    await assert.rejects(
      pool.query(
        `update public.survey_submissions
            set public_visibility = true
          where id = $1`,
        [fixture.submissionId],
      ),
    );

    await pool.query(
      `update public.survey_submissions
          set moderation_status = 'approved', public_visibility = true
        where id = $1`,
      [fixture.submissionId],
    );
    const visible = await pool.query(
      "select public_visibility from public.survey_submissions where id = $1",
      [fixture.submissionId],
    );
    assert.equal(visible.rows[0].public_visibility, true);

    const withdrawal = await pool.query(
      `insert into public.consent_records
        (participant_id, submission_id, consent_type, consent_version, consent_event)
       values ($1, $2, 'public_display', 'fixture-v1', 'withdrawn')
       returning event_sequence`,
      [fixture.participantId, fixture.submissionId],
    );
    assert.ok(withdrawal.rows[0].event_sequence > grant.rows[0].event_sequence);
    const hidden = await pool.query(
      "select public_visibility from public.survey_submissions where id = $1",
      [fixture.submissionId],
    );
    assert.equal(hidden.rows[0].public_visibility, false);

    await assert.rejects(
      pool.query(
        "delete from public.consent_records where submission_id = $1",
        [fixture.submissionId],
      ),
    );
    await assert.rejects(
      pool.query(
        "update public.consent_records set consent_status = true where submission_id = $1",
        [fixture.submissionId],
      ),
    );

    await assert.rejects(
      pool.query(
        `insert into public.survey_answers (submission_id, question_id, answer)
         values ($1, $2, '"wrong-city"')`,
        [fixture.submissionId, fixture.secondQuestionId],
      ),
    );
    await assert.rejects(
      pool.query(
        `update public.survey_questions
            set question_key = $1
          where id = $2`,
        [`changed-${randomUUID()}`, fixture.questionId],
      ),
    );
    await assert.rejects(
      pool.query("delete from public.survey_questions where id = $1", [
        fixture.questionId,
      ]),
    );
    const versionQuestion = await pool.query(
      `insert into public.survey_questions
        (question_key, question_text, question_type, section,
         display_order, survey_version)
       values ($1, 'Wrong version', 'short_text', 'fixture', 3, 'fixture-v2')
       returning id`,
      [`fixture-version-${randomUUID()}`],
    );
    await assert.rejects(
      pool.query(
        `insert into public.survey_answers (submission_id, question_id, answer)
         values ($1, $2, '"wrong-version"')`,
        [fixture.submissionId, versionQuestion.rows[0].id],
      ),
    );
    await pool.query("delete from public.survey_questions where id = $1", [
      versionQuestion.rows[0].id,
    ]);
  });
});

test("concurrent consent events serialize within one stream", async (t) => {
  if (!isConfigured) {
    t.skip("Requires isolated CSOD-Test database.");
    return;
  }
  await withContext(async ({ pool, fixture }) => {
    const results = await Promise.all(
      ["granted", "declined"].map((event) =>
        pool.query(
          `insert into public.consent_records
            (participant_id, submission_id, consent_type, consent_version, consent_event)
           values ($1, $2, 'future_communication', 'fixture-v1', $3)
           returning event_sequence`,
          [fixture.participantId, fixture.submissionId, event],
        ),
      ),
    );
    const sequences = results.map((result) => result.rows[0].event_sequence);
    assert.equal(new Set(sequences).size, 2);
    const latest = await pool.query(
      `select consent_event from public.consent_records
        where participant_id = $1
          and submission_id = $2
          and consent_type = 'future_communication'
        order by event_sequence desc, id desc limit 1`,
      [fixture.participantId, fixture.submissionId],
    );
    assert.ok(["granted", "declined"].includes(latest.rows[0].consent_event));
  });
});
