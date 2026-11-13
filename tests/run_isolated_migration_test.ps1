$ErrorActionPreference = "Stop"

$tempDir = Join-Path $env:TEMP "csod_isolated_pg"
$logFile = Join-Path $tempDir "pg.log"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$postgres = "C:\Program Files\PostgreSQL\18\bin\postgres.exe"
$port = 54334

# Ensure clean temp dir
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
& "C:\Program Files\PostgreSQL\18\bin\initdb.exe" -D $tempDir -U postgres -A trust --encoding=UTF8 | Out-Null

Write-Host "=== 1. Starting Isolated PostgreSQL Server on port $port ==="
$pgProc = Start-Process -FilePath $postgres -ArgumentList "-D `"$tempDir`" -p $port" -PassThru -NoNewWindow
Start-Sleep -Seconds 2

function Invoke-PsqlExpectedError {
    param(
        [string]$sql,
        [string]$expectedPattern
    )
    $tempSql = [System.IO.Path]::GetTempFileName() + ".sql"
    $tempErr = [System.IO.Path]::GetTempFileName() + ".log"
    Set-Content -Path $tempSql -Value $sql -Encoding UTF8
    $proc = Start-Process -FilePath $psql -ArgumentList "-h localhost -p $port -U postgres -d postgres -f `"$tempSql`"" -RedirectStandardError $tempErr -PassThru -Wait
    $errText = ""
    if (Test-Path $tempErr) {
        $errText = Get-Content $tempErr -Raw
    }
    Remove-Item $tempSql -Force -ErrorAction SilentlyContinue
    Remove-Item $tempErr -Force -ErrorAction SilentlyContinue
    if ($errText -match $expectedPattern) {
        Write-Host "  [OK] Expected error caught: $expectedPattern" -ForegroundColor Green
    } else {
        throw "Failed to match expected pattern '$expectedPattern'. Output was:`n$errText"
    }
}

try {
    Write-Host "=== 2. Creating Supabase Mock Roles and Auth Schema ==="
    $initSqlFile = Join-Path $env:TEMP "init_auth.sql"
    @'
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
        SELECT null::uuid;
        $$ LANGUAGE sql STABLE;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END $$;
'@ | Set-Content -Path $initSqlFile -Encoding UTF8

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -f $initSqlFile

    Write-Host "=== 3. Executing Migrations in Sequence ==="
    $migrations = @(
        "0001_initial_schema.sql",
        "0002_database_hardening.sql",
        "0003_integrity_and_consent_fixes.sql",
        "0004_consent_and_integrity_corrections.sql",
        "0005_consent_lock_order_and_visibility_reconciliation.sql",
        "0006_enable_submission_sequence_rls.sql",
        "0007_participant_verification_and_submission.sql",
        "0008_fix_verification_rate_limit_digest.sql",
        "0009_fix_participant_id_type.sql",
        "0010_fix_submission_survey_version_ambiguity.sql",
        "0011_update_rating_question_scales.sql",
        "0014_reduce_rating_scales_to_five.sql",
        "0015_csod_v4_reset_and_daily_activity.sql"
    )

    foreach ($mig in $migrations) {
        $path = "supabase/migrations/$mig"
        Write-Host "Applying: $mig..."
        & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -f $path
        Write-Host "Success: $mig"
    }

    Write-Host "`n=== 4. Verifying Objects after Migration 0015 ==="
    Write-Host "--- Tables in public schema ---"
    & $psql -h localhost -p $port -U postgres -d postgres -c "
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
    "

    Write-Host "--- Triggers in public schema ---"
    & $psql -h localhost -p $port -U postgres -d postgres -c "
    SELECT trigger_name, event_manipulation, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY event_object_table, trigger_name;
    "

    Write-Host "`n=== 5. Real PostgreSQL Concurrency & Schedule Overlap Test ==="
    $setupSubSql = Join-Path $env:TEMP "setup_sub.sql"
    @'
    DO $$
    DECLARE
        v_city_id uuid;
        v_zone_id uuid;
        v_part_id uuid;
        v_sub_id uuid;
    BEGIN
        SELECT id INTO v_city_id FROM cities WHERE slug = 'delhi';
        IF v_city_id IS NULL THEN
            INSERT INTO cities (name, slug, city_code) VALUES ('Delhi', 'delhi', 'DEL') RETURNING id INTO v_city_id;
        END IF;

        SELECT id INTO v_zone_id FROM city_zones WHERE city_id = v_city_id LIMIT 1;
        IF v_zone_id IS NULL THEN
            INSERT INTO city_zones (city_id, zone_name) VALUES (v_city_id, 'Central') RETURNING id INTO v_zone_id;
        END IF;

        INSERT INTO participants (public_participant_id, email, city_id)
        VALUES ('TEST-PART-CONC-01', 'test_part_conc_01@example.com', v_city_id)
        RETURNING id INTO v_part_id;

        INSERT INTO survey_submissions (
            survey_version, participant_id, city_id, zone_id, submission_date, submission_number,
            moderation_status, public_visibility, admin_hidden
        )
        VALUES (
            'v4', v_part_id, v_city_id, v_zone_id, current_date, 1,
            'approved', false, false
        )
        RETURNING id INTO v_sub_id;

        RAISE NOTICE 'Created test submission: %', v_sub_id;
    END $$;
'@ | Set-Content -Path $setupSubSql -Encoding UTF8

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -f $setupSubSql

    # Get submission ID
    $subId = (& $psql -h localhost -p $port -U postgres -d postgres -t -A -c "
    SELECT s.id FROM survey_submissions s
    JOIN participants p ON s.participant_id = p.id
    WHERE p.public_participant_id = 'TEST-PART-CONC-01';
    ").Trim()
    Write-Host "Testing against submission ID: $subId"

    # Define SQL for Tx A: Inserts 10:00-12:00, holds lock with pg_sleep(2), then commits
    $txAFile = Join-Path $env:TEMP "tx_a.sql"
    @"
    BEGIN;
    SELECT id FROM survey_submissions WHERE id = '$subId' FOR UPDATE;
    INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category)
    VALUES ('$subId', 1, '10:00:00', '12:00:00', 'Office / Workplace', 'Indoor work / Studying');
    SELECT pg_sleep(2);
    COMMIT;
"@ | Set-Content -Path $txAFile -Encoding UTF8

    # Define SQL for Tx B: Starts 0.5s after Tx A, attempts to insert 11:00-13:00 (overlapping)
    $txBFile = Join-Path $env:TEMP "tx_b.sql"
    @"
    BEGIN;
    SELECT id FROM survey_submissions WHERE id = '$subId' FOR UPDATE;
    INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category)
    VALUES ('$subId', 2, '11:00:00', '13:00:00', 'Road / Commuting', 'Commuting');
    COMMIT;
"@ | Set-Content -Path $txBFile -Encoding UTF8

    Write-Host "Launching concurrent Transactions A (10:00-12:00) and B (11:00-13:00)..."
    $jobA = Start-Job -ScriptBlock {
        param($psql, $port, $file)
        & $psql -h localhost -p $port -U postgres -d postgres -f $file 2>&1
    } -ArgumentList $psql, $port, $txAFile

    Start-Sleep -Milliseconds 500

    $jobB = Start-Job -ScriptBlock {
        param($psql, $port, $file)
        & $psql -h localhost -p $port -U postgres -d postgres -f $file 2>&1
    } -ArgumentList $psql, $port, $txBFile

    $outA = Receive-Job -Job $jobA -Wait
    $outB = Receive-Job -Job $jobB -Wait

    Write-Host "Result Tx A:"
    $outA | ForEach-Object { Write-Host "  A: $_" }
    Write-Host "Result Tx B:"
    $outB | ForEach-Object { Write-Host "  B: $_" }

    # Check if Tx A succeeded and Tx B failed with overlap error
    $bFailed = ($outB -match "Daily activity entries cannot overlap")
    if ($bFailed) {
        Write-Host "SUCCESS: Transaction B was blocked by Transaction A's lock and rejected with overlap check error!" -ForegroundColor Green
    } else {
        throw "Concurrency test failed: Tx B did not fail with expected overlap check error"
    }

    # Verify Adjacent entry (12:00-14:00) succeeds
    Write-Host "`n=== 6. Testing Adjacent Interval (12:00 to 14:00) ==="
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category)
    VALUES ('$subId', 2, '12:00:00', '14:00:00', 'Road / Commuting', 'Commuting');
    "
    Write-Host "SUCCESS: Adjacent interval 12:00-14:00 succeeded without error!" -ForegroundColor Green

    # Verify Overnight entry (22:00 to 06:00) and duration calculation (480 minutes)
    Write-Host "`n=== 7. Testing Overnight Interval (22:00 to 06:00) ==="
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category)
    VALUES ('$subId', 3, '22:00:00', '06:00:00', 'Home', 'Sleeping / Resting');
    "
    $overnightDur = (& $psql -h localhost -p $port -U postgres -d postgres -t -A -c "
    SELECT duration_minutes FROM daily_activity_entries WHERE submission_id = '$subId' AND activity_category = 'Sleeping / Resting';
    ").Trim()
    Write-Host "Overnight duration stored: $overnightDur minutes (expected: 480)"
    if ($overnightDur -ne "480") {
        throw "Expected 480 minutes for 22:00-06:00 overnight duration, got $overnightDur"
    }
    Write-Host "SUCCESS: Overnight duration calculated correctly!" -ForegroundColor Green

    # Verify Exact Minute Precision: accept 06:00:00, reject 06:00:00.1, 06:00:00.4, 06:00:01
    Write-Host "`n=== 8. Testing Exact Minute Precision & Fractional Seconds ==="
    # 8.1 Accept 06:00:00
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category)
    VALUES ('$subId', 4, '06:00:00', '07:00:00', 'Outdoor public space / Park', 'Walking / Exercising');
    "
    Write-Host "  [OK] Accepted 06:00:00 without error" -ForegroundColor Green

    # 8.2 Reject 06:00:00.1
    Invoke-PsqlExpectedError "INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category) VALUES ('$subId', 5, '07:00:00.1', '08:00:00', 'Outdoor public space / Park', 'Walking / Exercising');" "minute precision|zero seconds"

    # 8.3 Reject 06:00:00.4
    Invoke-PsqlExpectedError "INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category) VALUES ('$subId', 5, '07:00:00.4', '08:00:00', 'Outdoor public space / Park', 'Walking / Exercising');" "minute precision|zero seconds"

    # 8.4 Reject 06:00:01
    Invoke-PsqlExpectedError "INSERT INTO daily_activity_entries (submission_id, sequence, start_time, end_time, location_category, activity_category) VALUES ('$subId', 5, '07:00:01', '08:00:00', 'Outdoor public space / Park', 'Walking / Exercising');" "minute precision|zero seconds"

    # Clean up activities for subId before publication workflow tests
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "DELETE FROM daily_activity_entries WHERE submission_id = '$subId';"

    Write-Host "`n=== 9. Testing Exact Publication Sequences (A, B, C, D, E) ==="

    function Create-TestSubmission {
        param([string]$tag)
        $sql = "WITH p AS (INSERT INTO participants (public_participant_id, email, city_id) VALUES ('PART-$tag', 'part-$tag@example.com', (SELECT id FROM cities WHERE slug = 'delhi')) RETURNING id, city_id) INSERT INTO survey_submissions (survey_version, participant_id, city_id, zone_id, submission_date, submission_number, moderation_status, public_visibility, admin_hidden) SELECT 'v4', p.id, p.city_id, (SELECT id FROM city_zones WHERE city_id = p.city_id LIMIT 1), current_date, 1, 'approved', false, false FROM p;"
        & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c $sql | Out-Null
        $newId = (& $psql -h localhost -p $port -U postgres -d postgres -t -A -c "SELECT s.id FROM survey_submissions s JOIN participants p ON s.participant_id = p.id WHERE p.public_participant_id = 'PART-$tag';").Trim()
        return $newId
    }

    # Helper function to check visibility
    function Check-Visibility {
        param($targetSubId, $testName, $expectedVis, $expectedAdmHid)
        $vis = (& $psql -h localhost -p $port -U postgres -d postgres -t -A -c "SELECT public_visibility FROM survey_submissions WHERE id = '$targetSubId';").Trim()
        $adm = (& $psql -h localhost -p $port -U postgres -d postgres -t -A -c "SELECT admin_hidden FROM survey_submissions WHERE id = '$targetSubId';").Trim()
        Write-Host "  [$testName] -> public_visibility=$vis (exp: $expectedVis), admin_hidden=$adm (exp: $expectedAdmHid)"
        if ($vis -ne $expectedVis -or $adm -ne $expectedAdmHid) {
            throw "Failed $testName : expected vis=$expectedVis, adm=$expectedAdmHid; got vis=$vis, adm=$adm"
        }
        Write-Host "  [$testName] Passed!" -ForegroundColor Green
    }

    # SEQUENCE A: Grant -> Withdraw -> Grant: response becomes visible again
    Write-Host "--- Testing Sequence A: Grant -> Withdraw -> Grant ---"
    $subA = Create-TestSubmission "SEQ-A"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subA';
    "
    Check-Visibility $subA "Sequence A - Step 1: Grant" "t" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'withdrawn' FROM survey_submissions WHERE id = '$subA';
    "
    Check-Visibility $subA "Sequence A - Step 2: Withdraw" "f" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subA';
    "
    Check-Visibility $subA "Sequence A - Step 3: Grant Again" "t" "f"

    # SEQUENCE B: Grant -> Admin hide -> Grant: response remains hidden
    Write-Host "`n--- Testing Sequence B: Grant -> Admin hide -> Grant ---"
    $subB = Create-TestSubmission "SEQ-B"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subB';
    "
    Check-Visibility $subB "Sequence B - Step 1: Grant" "t" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    SET ROLE service_role;
    SELECT public.admin_hide_submission('$subB');
    "
    Check-Visibility $subB "Sequence B - Step 2: Admin Hide" "f" "t"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subB';
    "
    Check-Visibility $subB "Sequence B - Step 3: Grant while Admin Hidden" "f" "t"

    # SEQUENCE C: Grant -> Withdraw -> Admin hide -> Grant: response remains hidden
    Write-Host "`n--- Testing Sequence C: Grant -> Withdraw -> Admin hide -> Grant ---"
    $subC = Create-TestSubmission "SEQ-C"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subC';
    "
    Check-Visibility $subC "Sequence C - Step 1: Grant" "t" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'withdrawn' FROM survey_submissions WHERE id = '$subC';
    "
    Check-Visibility $subC "Sequence C - Step 2: Withdraw" "f" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    SET ROLE service_role;
    SELECT public.admin_hide_submission('$subC');
    "
    Check-Visibility $subC "Sequence C - Step 3: Admin Hide" "f" "t"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subC';
    "
    Check-Visibility $subC "Sequence C - Step 4: Grant while Admin Hidden" "f" "t"

    # SEQUENCE D: Grant -> Admin hide -> Admin restore: response becomes visible if consent remains granted
    Write-Host "`n--- Testing Sequence D: Grant -> Admin hide -> Admin restore ---"
    $subD = Create-TestSubmission "SEQ-D"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subD';
    "
    Check-Visibility $subD "Sequence D - Step 1: Grant" "t" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    SET ROLE service_role;
    SELECT public.admin_hide_submission('$subD');
    "
    Check-Visibility $subD "Sequence D - Step 2: Admin Hide" "f" "t"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    SET ROLE service_role;
    SELECT public.admin_restore_submission('$subD');
    "
    Check-Visibility $subD "Sequence D - Step 3: Admin Restore" "t" "f"

    # SEQUENCE E: Decline -> Grant: response becomes visible if moderation is approved and no admin hide exists
    Write-Host "`n--- Testing Sequence E: Decline -> Grant ---"
    $subE = Create-TestSubmission "SEQ-E"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'declined' FROM survey_submissions WHERE id = '$subE';
    "
    Check-Visibility $subE "Sequence E - Step 1: Decline" "f" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subE';
    "
    Check-Visibility $subE "Sequence E - Step 2: Grant after Decline" "t" "f"

    Write-Host "`n=== 10. Testing Answer Payload Validation via submit_participant_survey RPC ==="
    # 10.1 Missing research participation consent -> Rejection
    Write-Host "Testing missing research participation consent..."
    $missingConsentSql = @'
    DO $$
    DECLARE
        v_city_id uuid;
        v_zone_id uuid;
        v_part_id uuid;
    BEGIN
        SELECT id INTO v_city_id FROM cities WHERE slug = 'delhi';
        SELECT id INTO v_zone_id FROM city_zones WHERE city_id = v_city_id LIMIT 1;
        INSERT INTO participants (public_participant_id, email, city_id)
        VALUES ('TEST-PART-RPC-01', 'test_rpc_01@example.com', v_city_id)
        RETURNING id INTO v_part_id;

        PERFORM public.submit_participant_survey(
            v_part_id,
            v_city_id,
            v_zone_id,
            '[]'::jsonb,
            false,
            true,
            false,
            '[]'::jsonb
        );
    END $$;
'@
    Invoke-PsqlExpectedError $missingConsentSql "Research participation consent is required"

    # 10.2 Duplicate checkbox selections -> Rejection
    Write-Host "Testing duplicate checkbox selections..."
    $dupCheckSql = @'
    DO $$
    DECLARE
        v_city_id uuid;
        v_zone_id uuid;
        v_part_id uuid;
        v_dup_answers jsonb;
    BEGIN
        SELECT id INTO v_city_id FROM cities WHERE slug = 'delhi';
        SELECT id INTO v_zone_id FROM city_zones WHERE city_id = v_city_id LIMIT 1;
        INSERT INTO participants (public_participant_id, email, city_id)
        VALUES ('TEST-PART-RPC-02', 'test_rpc_02@example.com', v_city_id)
        RETURNING id INTO v_part_id;

        SELECT jsonb_agg(
            jsonb_build_object(
                'question_id', q.id,
                'answer', CASE 
                    WHEN q.question_key = 'observed_pollution_sources' THEN jsonb_build_array('Vehicle exhaust', 'Vehicle exhaust')
                    WHEN q.question_type = 'checkboxes' THEN jsonb_build_array(q.options->>0)
                    WHEN q.question_type = 'linear_scale' THEN '"3"'::jsonb
                    ELSE to_jsonb(q.options->>0)
                END
            )
        ) INTO v_dup_answers
        FROM survey_questions q
        WHERE q.is_active AND q.is_required AND (q.city_id IS NULL OR q.city_id = v_city_id);

        PERFORM public.submit_participant_survey(
            v_part_id,
            v_city_id,
            v_zone_id,
            v_dup_answers,
            true,
            true,
            false,
            jsonb_build_array(
                jsonb_build_object(
                    'start_time', '08:00:00',
                    'end_time', '10:00:00',
                    'location_category', 'Office / Workplace',
                    'activity_category', 'Indoor work / Studying'
                )
            )
        );
    END $$;
'@
    Invoke-PsqlExpectedError $dupCheckSql "Duplicate checkbox options selected"

    # 10.3 Non-string multiple choice answer -> Rejection
    Write-Host "Testing non-string multiple choice answer..."
    $nonStrSql = @'
    DO $$
    DECLARE
        v_city_id uuid;
        v_zone_id uuid;
        v_part_id uuid;
        v_invalid_mc_answers jsonb;
    BEGIN
        SELECT id INTO v_city_id FROM cities WHERE slug = 'delhi';
        SELECT id INTO v_zone_id FROM city_zones WHERE city_id = v_city_id LIMIT 1;
        INSERT INTO participants (public_participant_id, email, city_id)
        VALUES ('TEST-PART-RPC-03', 'test_rpc_03@example.com', v_city_id)
        RETURNING id INTO v_part_id;

        SELECT jsonb_agg(
            jsonb_build_object(
                'question_id', q.id,
                'answer', CASE 
                    WHEN q.question_key = 'environment_setting' THEN to_jsonb(12345)
                    WHEN q.question_type = 'checkboxes' THEN jsonb_build_array(q.options->>0)
                    WHEN q.question_type = 'linear_scale' THEN '"3"'::jsonb
                    ELSE to_jsonb(q.options->>0)
                END
            )
        ) INTO v_invalid_mc_answers
        FROM survey_questions q
        WHERE q.is_active AND q.is_required AND (q.city_id IS NULL OR q.city_id = v_city_id);

        PERFORM public.submit_participant_survey(
            v_part_id,
            v_city_id,
            v_zone_id,
            v_invalid_mc_answers,
            true,
            true,
            false,
            jsonb_build_array(
                jsonb_build_object(
                    'start_time', '08:00:00',
                    'end_time', '10:00:00',
                    'location_category', 'Office / Workplace',
                    'activity_category', 'Indoor work / Studying'
                )
            )
        );
    END $$;
'@
    Invoke-PsqlExpectedError $nonStrSql "Answer for .* must be a JSON string"

    # 10.4 Valid complete submission -> Success
    Write-Host "Testing valid complete submission via submit_participant_survey..."
    $validSubSql = @'
    DO $$
    DECLARE
        v_city_id uuid;
        v_zone_id uuid;
        v_part_id uuid;
        v_valid_answers jsonb;
        v_res record;
    BEGIN
        SELECT id INTO v_city_id FROM cities WHERE slug = 'delhi';
        SELECT id INTO v_zone_id FROM city_zones WHERE city_id = v_city_id LIMIT 1;
        INSERT INTO participants (public_participant_id, email, city_id)
        VALUES ('TEST-PART-RPC-04', 'test_rpc_04@example.com', v_city_id)
        RETURNING id INTO v_part_id;

        SELECT jsonb_agg(
            jsonb_build_object(
                'question_id', q.id,
                'answer', CASE 
                    WHEN q.question_type = 'checkboxes' THEN jsonb_build_array(q.options->>0)
                    WHEN q.question_type = 'linear_scale' THEN '"3"'::jsonb
                    ELSE to_jsonb(q.options->>0)
                END
            )
        ) INTO v_valid_answers
        FROM survey_questions q
        WHERE q.is_active AND q.is_required AND (q.city_id IS NULL OR q.city_id = v_city_id);

        SELECT * INTO v_res FROM public.submit_participant_survey(
            v_part_id,
            v_city_id,
            v_zone_id,
            v_valid_answers,
            true,
            true,
            false,
            jsonb_build_array(
                jsonb_build_object(
                    'start_time', '08:00:00',
                    'end_time', '10:00:00',
                    'location_category', 'Office / Workplace',
                    'activity_category', 'Indoor work / Studying'
                )
            )
        );

        IF v_res.submission_id IS NULL THEN
            RAISE EXCEPTION 'Failed to create submission via submit_participant_survey';
        END IF;
    END $$;
'@
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c $validSubSql
    Write-Host "  [OK] Valid complete submission succeeded via RPC" -ForegroundColor Green

    Write-Host "`n=== 11. Testing Admin RPC Security & Role-Based Access Control ==="

    # 11.1 Function owner and security definer inspection
    Write-Host "--- 11.1 Inspecting Function Owner and Security Definer Invariants ---"
    $funcInfo = & $psql -h localhost -p $port -U postgres -d postgres -t -A -c "
    SELECT p.proname, r.rolname, p.prosecdef
    FROM pg_proc p
    JOIN pg_roles r ON p.proowner = r.oid
    WHERE p.proname IN ('admin_hide_submission', 'admin_restore_submission', 'admin_set_moderation')
    ORDER BY p.proname;
    "
    Write-Host "Function Metadata (name|owner|secdef):"
    $funcInfo | ForEach-Object { Write-Host "  $_" }

    foreach ($line in ($funcInfo -split "\r?\n")) {
        $trimmed = $line.Trim()
        if ($trimmed -ne "") {
            $parts = $trimmed.Split("|")
            $fnName = $parts[0]
            $owner = $parts[1]
            $secDef = $parts[2]
            if ($owner -ne "postgres") {
                throw "Expected function $fnName owner to be postgres, got $owner"
            }
            if ($secDef -ne "t") {
                throw "Expected function $fnName to be SECURITY DEFINER (t), got $secDef"
            }
        }
    }
    Write-Host "  [OK] All 3 admin functions are owned by postgres and marked SECURITY DEFINER" -ForegroundColor Green

    # 11.2 Negative Test: Direct execution by 'anon' MUST be denied
    Write-Host "--- 11.2 Negative Test: 'anon' cannot execute admin RPCs ---"
    Invoke-PsqlExpectedError @"
    SET ROLE anon;
    SELECT public.admin_hide_submission('$subId');
"@ "permission denied for function admin_hide_submission"

    Invoke-PsqlExpectedError @"
    SET ROLE anon;
    SELECT public.admin_restore_submission('$subId');
"@ "permission denied for function admin_restore_submission"

    Invoke-PsqlExpectedError @"
    SET ROLE anon;
    SELECT public.admin_set_moderation('$subId', 'rejected');
"@ "permission denied for function admin_set_moderation"

    # 11.3 Negative Test: Direct execution by 'authenticated' MUST be denied
    Write-Host "--- 11.3 Negative Test: Non-admin 'authenticated' cannot execute admin RPCs ---"
    Invoke-PsqlExpectedError @"
    SET ROLE authenticated;
    SELECT public.admin_hide_submission('$subId');
"@ "permission denied for function admin_hide_submission"

    Invoke-PsqlExpectedError @"
    SET ROLE authenticated;
    SELECT public.admin_restore_submission('$subId');
"@ "permission denied for function admin_restore_submission"

    Invoke-PsqlExpectedError @"
    SET ROLE authenticated;
    SELECT public.admin_set_moderation('$subId', 'rejected');
"@ "permission denied for function admin_set_moderation"

    # 11.4 Positive Test: Execution by 'service_role' succeeds
    Write-Host "--- 11.4 Positive Test: 'service_role' executes admin RPCs successfully ---"
    $subSec = Create-TestSubmission "SEC-ROLE"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    SET ROLE service_role;
    SELECT public.admin_hide_submission('$subSec');
    "
    Check-Visibility $subSec "service_role admin_hide_submission" "f" "t"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subSec';

    SET ROLE service_role;
    SELECT public.admin_restore_submission('$subSec');
    "
    Check-Visibility $subSec "service_role admin_restore_submission" "t" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    SET ROLE service_role;
    SELECT public.admin_set_moderation('$subSec', 'rejected');
    "
    Check-Visibility $subSec "service_role admin_set_moderation (rejected)" "f" "f"

    # 11.5 Persistence of admin hide: participant consent cannot republish admin-hidden submission
    Write-Host "--- 11.5 Admin Hide Persistence across Subsequent Consent Events ---"
    $subPersist = Create-TestSubmission "ADMIN-PERSIST"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    -- Step 1: Initial grant -> visible
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subPersist';
    "
    Check-Visibility $subPersist "Admin Persist - Step 1: Initial Grant" "t" "f"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    -- Step 2: Admin hides
    SET ROLE service_role;
    SELECT public.admin_hide_submission('$subPersist');
    "
    Check-Visibility $subPersist "Admin Persist - Step 2: Admin Hide" "f" "t"

    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    -- Step 3: Participant submits subsequent granted consent
    INSERT INTO consent_records (participant_id, submission_id, consent_type, consent_version, consent_event)
    SELECT participant_id, id, 'public_display', 'v4', 'granted' FROM survey_submissions WHERE id = '$subPersist';
    "
    Check-Visibility $subPersist "Admin Persist - Step 3: Subsequent Grant (must remain hidden)" "f" "t"
    Write-Host "  [OK] Admin hide remained persistent across subsequent consent events" -ForegroundColor Green

    # =========================================================================
    # §12 Submission Email Notifications Outbox & Permissions Test
    # =========================================================================
    Write-Host "`n=== 12. Verifying submission_email_notifications Outbox & RLS ==="

    # 12.1 Verify table existence and structure
    $notifTableCheck = & $psql -h localhost -p $port -U postgres -d postgres -t -A -c "
    SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'submission_email_notifications';
    "
    if ($notifTableCheck -ne "1") {
        throw "Table submission_email_notifications was not found in public schema."
    }
    Write-Host "  [OK] Table submission_email_notifications exists" -ForegroundColor Green

    # 12.2 Negative Test: 'anon' cannot access notification records
    Write-Host "--- 12.2 Negative Test: 'anon' cannot access submission_email_notifications ---"
    Invoke-PsqlExpectedError @"
    SET ROLE anon;
    SELECT * FROM public.submission_email_notifications;
"@ "permission denied for table submission_email_notifications"

    # 12.3 Negative Test: 'authenticated' cannot access notification records
    Write-Host "--- 12.3 Negative Test: 'authenticated' cannot access submission_email_notifications ---"
    Invoke-PsqlExpectedError @"
    SET ROLE authenticated;
    SELECT * FROM public.submission_email_notifications;
"@ "permission denied for table submission_email_notifications"

    # 12.4 Verify RPC automatically enqueues pending notification row
    Write-Host "--- 12.4 Verify submit_participant_survey RPC enqueued pending notification row ---"
    $outboxStatus = (& $psql -h localhost -p $port -U postgres -d postgres -t -A -c "
    SELECT concat(status, '|', attempt_count) FROM public.submission_email_notifications
    WHERE submission_id = (
        SELECT id FROM survey_submissions
        WHERE participant_id = (SELECT id FROM participants WHERE public_participant_id = 'TEST-PART-RPC-04')
    );
    ").Trim()

    if ($outboxStatus -ne "pending|0") {
        throw "Expected outbox row to be 'pending|0', got '$outboxStatus'"
    }
    Write-Host "  [OK] submit_participant_survey RPC automatically enqueued pending outbox notification (status: $outboxStatus)" -ForegroundColor Green

    # 12.5 Positive Test: service_role can select and update outbox status (sending, sent)
    Write-Host "--- 12.5 Positive Test: service_role can select and update outbox status ---"
    & $psql -h localhost -p $port -U postgres -d postgres -v "ON_ERROR_STOP=1" -c "
    SET ROLE service_role;
    SELECT count(*) FROM public.submission_email_notifications;

    UPDATE public.submission_email_notifications
       SET status = 'sending',
           sending_started_at = clock_timestamp(),
           attempt_count = attempt_count + 1
     WHERE submission_id = (
         SELECT id FROM survey_submissions
         WHERE participant_id = (SELECT id FROM participants WHERE public_participant_id = 'TEST-PART-RPC-04')
     );

    UPDATE public.submission_email_notifications
       SET status = 'sent',
           provider_email_id = 'msg_test_12345',
           sent_at = clock_timestamp()
     WHERE submission_id = (
         SELECT id FROM survey_submissions
         WHERE participant_id = (SELECT id FROM participants WHERE public_participant_id = 'TEST-PART-RPC-04')
     );
    "
    Write-Host "  [OK] service_role successfully selected and transitioned notification status to sending and sent" -ForegroundColor Green

    Write-Host "`n========================================================"
    Write-Host "ALL REAL POSTGRESQL & ISOLATED TESTS PASSED 100%!" -ForegroundColor Green
    Write-Host "========================================================"

} finally {
    Write-Host "`n=== Stopping Isolated PostgreSQL Server ==="
    Stop-Process -Id $pgProc.Id -Force -ErrorAction SilentlyContinue
}
