# Database integration tests

The test suite targets only the isolated CSOD-Test project. It refuses to run
when `CSOD_TEST_ENVIRONMENT=production` and requires:

```text
CSOD_TEST_PROJECT_REF=awcqwzxiawxuuvuzzmeu
CSOD_TEST_CONFIRMATION=CSOD-Test
CSOD_TEST_ENVIRONMENT=test
CSOD_TEST_DATABASE_HOST=...
CSOD_TEST_DATABASE_URL=postgresql://postgres...:password@...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
CSOD_TEST_AUTHENTICATED_JWT=...
CSOD_TEST_ADMIN_JWT=...
```

Keep these variables in an ignored local `.env.test.local` file or the process
environment. For a direct database connection, use username `postgres` and
host `db.awcqwzxiawxuuvuzzmeu.supabase.co`. For a Session Pooler connection,
use username `postgres.awcqwzxiawxuuvuzzmeu` and set
`CSOD_TEST_DATABASE_HOST` to the exact pooler host. Never commit or print the
database URL, passwords, JWTs, or service-role key.

Run with:

```text
npm run test:db
```

The suite uses PostgreSQL `Pool` connections for independent concurrency
operations and Supabase clients for JWT-context checks. Fixtures are uniquely
named and cleaned up by targeted IDs in `finally` blocks. It never uses
`TRUNCATE` or broad resets.

The anonymous client uses only the publishable key. RLS/session assertions for
authenticated and administrator behavior additionally require their JWTs.
Catalog assertions and PostgreSQL concurrency cases require remote access and
credentials. Without the explicit variables above, those tests are skipped;
that is not a passing database result.

The harness verifies that the Supabase URL is for project
`awcqwzxiawxuuvuzzmeu`. It validates either the direct database target or the
Session Pooler username/host combination before creating a PostgreSQL pool. It
loads `.env.test.local` automatically when present; that file is ignored by
Git.
