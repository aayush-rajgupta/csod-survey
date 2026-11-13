import assert from "node:assert/strict";
import { test } from "node:test";

type ModerationStatus = "pending" | "approved" | "rejected";
type ConsentEvent = "granted" | "declined" | "withdrawn";

interface SubmissionState {
  id: string;
  moderation_status: ModerationStatus;
  public_visibility: boolean;
  admin_hidden: boolean;
  survey_version: string;
}

interface ConsentRecord {
  submission_id: string;
  consent_type: "research_participation" | "public_display" | "future_communication";
  consent_event: ConsentEvent;
  consent_version: string;
  event_sequence: number;
}

/**
 * Pure simulation of the authoritative publication, withdrawal, and persistent
 * administrator hide logic implemented by `sync_public_visibility_on_consent_event`,
 * `enforce_public_visibility_consent`, and the admin RPC functions in migration 0015.
 */
class PublicationWorkflowSimulator {
  submission: SubmissionState;
  consents: ConsentRecord[] = [];
  private sequenceCounter = 1;

  constructor(surveyVersion = "v4", initialModeration: ModerationStatus = "approved") {
    this.submission = {
      id: "sub-123",
      moderation_status: initialModeration,
      public_visibility: false,
      admin_hidden: false,
      survey_version: surveyVersion,
    };
  }

  // Simulates INSERT into public.consent_records with triggers
  insertConsent(
    consentType: "research_participation" | "public_display" | "future_communication",
    event: ConsentEvent,
  ) {
    const latestEvent = this.getLatestConsent(consentType);
    if (event === "withdrawn" && latestEvent?.consent_event !== "granted") {
      throw new Error("Consent can be withdrawn only after a granted event");
    }

    const record: ConsentRecord = {
      submission_id: this.submission.id,
      consent_type: consentType,
      consent_event: event,
      consent_version: this.submission.survey_version,
      event_sequence: this.sequenceCounter++,
    };
    this.consents.push(record);

    // Trigger: sync_public_visibility_on_consent_event
    // CRITICAL: Participant consent changes public_visibility WITHOUT changing admin_hidden!
    if (consentType === "public_display") {
      if (
        event === "granted" &&
        this.submission.moderation_status === "approved" &&
        !this.submission.admin_hidden
      ) {
        this.submission.public_visibility = true;
      } else {
        this.submission.public_visibility = false;
      }
    }
    return record;
  }

  // Simulates Admin explicit hide (e.g. admin_hide_submission RPC)
  adminExplicitHide() {
    this.submission.admin_hidden = true;
    this.submission.public_visibility = false;
  }

  // Simulates Admin explicit restore (e.g. admin_restore_submission RPC)
  adminExplicitRestore() {
    this.submission.admin_hidden = false;
    const latest = this.getLatestConsent("public_display");
    if (this.submission.moderation_status === "approved" && latest?.consent_event === "granted") {
      this.submission.public_visibility = true;
    } else {
      this.submission.public_visibility = false;
    }
  }

  // Simulates Admin update of moderation_status
  adminUpdateModeration(status: ModerationStatus) {
    this.submission.moderation_status = status;
    if (status !== "approved") {
      this.submission.public_visibility = false;
    } else {
      const latest = this.getLatestConsent("public_display");
      if (latest?.consent_event === "granted" && !this.submission.admin_hidden) {
        this.submission.public_visibility = true;
      }
    }
  }

  // Simulates generic service operation (e.g. UPDATE survey_submissions SET ... without admin_hidden)
  genericServiceUpdate(updates: Partial<Pick<SubmissionState, "moderation_status" | "public_visibility">>) {
    // Generic service operation must NEVER accidentally clear admin_hidden!
    if (updates.moderation_status !== undefined) {
      this.submission.moderation_status = updates.moderation_status;
    }
    if (updates.public_visibility !== undefined) {
      if (updates.public_visibility && this.submission.admin_hidden) {
        throw new Error("Cannot set public_visibility = true when admin_hidden is true");
      }
      this.submission.public_visibility = updates.public_visibility;
    }
  }

  getLatestConsent(
    consentType: "research_participation" | "public_display" | "future_communication",
  ): ConsentRecord | undefined {
    return [...this.consents]
      .filter((c) => c.consent_type === consentType)
      .sort((a, b) => b.event_sequence - a.event_sequence)[0];
  }
}

// ---------------------------------------------------------------------------
// EXACT SEQUENCES REQUIRED BY SPECIFICATION
// ---------------------------------------------------------------------------

test("Sequence A: Grant -> Withdraw -> Grant: response becomes visible again", () => {
  const sim = new PublicationWorkflowSimulator();
  assert.equal(sim.submission.public_visibility, false);
  assert.equal(sim.submission.admin_hidden, false);

  // 1. Grant
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, true, "Should be visible after grant");
  assert.equal(sim.submission.admin_hidden, false);

  // 2. Withdraw (MUST NOT set admin_hidden)
  sim.insertConsent("public_display", "withdrawn");
  assert.equal(sim.submission.public_visibility, false, "Should be hidden after withdrawal");
  assert.equal(sim.submission.admin_hidden, false, "Withdrawal must NOT set admin_hidden");

  // 3. Grant
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, true, "Should be visible again upon subsequent grant");
  assert.equal(sim.submission.admin_hidden, false);
});

test("Sequence B: Grant -> Admin hide -> Grant: response remains hidden", () => {
  const sim = new PublicationWorkflowSimulator();

  // 1. Grant
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, true);
  assert.equal(sim.submission.admin_hidden, false);

  // 2. Admin hide
  sim.adminExplicitHide();
  assert.equal(sim.submission.public_visibility, false);
  assert.equal(sim.submission.admin_hidden, true);

  // 3. Grant (subsequent participant grant MUST NOT override admin hide)
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, false, "Must remain hidden after admin hide");
  assert.equal(sim.submission.admin_hidden, true, "admin_hidden must remain true");
});

test("Sequence C: Grant -> Withdraw -> Admin hide -> Grant: response remains hidden", () => {
  const sim = new PublicationWorkflowSimulator();

  // 1. Grant
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, true);

  // 2. Withdraw
  sim.insertConsent("public_display", "withdrawn");
  assert.equal(sim.submission.public_visibility, false);
  assert.equal(sim.submission.admin_hidden, false);

  // 3. Admin hide
  sim.adminExplicitHide();
  assert.equal(sim.submission.public_visibility, false);
  assert.equal(sim.submission.admin_hidden, true);

  // 4. Grant (participant grants again, but admin hide is present)
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, false, "Must remain hidden due to admin hide");
  assert.equal(sim.submission.admin_hidden, true);
});

test("Sequence D: Grant -> Admin hide -> Admin restore: response becomes visible if consent remains granted", () => {
  const sim = new PublicationWorkflowSimulator();

  // 1. Grant
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, true);

  // 2. Admin hide
  sim.adminExplicitHide();
  assert.equal(sim.submission.public_visibility, false);
  assert.equal(sim.submission.admin_hidden, true);

  // 3. Admin restore
  sim.adminExplicitRestore();
  assert.equal(sim.submission.admin_hidden, false, "admin_hidden must be cleared");
  assert.equal(sim.submission.public_visibility, true, "Visibility restored because consent is granted and approved");
});

test("Sequence E: Decline -> Grant: response becomes visible if moderation is approved and no admin hide exists", () => {
  const sim = new PublicationWorkflowSimulator();

  // 1. Decline
  sim.insertConsent("public_display", "declined");
  assert.equal(sim.submission.public_visibility, false);
  assert.equal(sim.submission.admin_hidden, false, "Decline must NOT create an admin hide");

  // 2. Grant
  sim.insertConsent("public_display", "granted");
  assert.equal(sim.submission.public_visibility, true, "Response becomes visible upon granted consent");
  assert.equal(sim.submission.admin_hidden, false);
});

test("Admin restore with withdrawn consent does not make submission visible", () => {
  const sim = new PublicationWorkflowSimulator();
  sim.insertConsent("public_display", "granted");
  sim.adminExplicitHide();
  sim.insertConsent("public_display", "withdrawn");

  // Admin restores, but consent was withdrawn!
  sim.adminExplicitRestore();
  assert.equal(sim.submission.admin_hidden, false);
  assert.equal(sim.submission.public_visibility, false, "Must remain private because consent is withdrawn");
});

test("Generic service operations cannot accidentally clear an administrator's hide decision", () => {
  const sim = new PublicationWorkflowSimulator();
  sim.insertConsent("public_display", "granted");
  sim.adminExplicitHide();
  assert.equal(sim.submission.admin_hidden, true);

  // Generic update without explicit admin_hidden change
  sim.genericServiceUpdate({ moderation_status: "approved" });
  assert.equal(sim.submission.admin_hidden, true, "admin_hidden must be preserved across generic updates");
  assert.equal(sim.submission.public_visibility, false);

  // Cannot force public_visibility = true while admin_hidden is true
  assert.throws(
    () => sim.genericServiceUpdate({ public_visibility: true }),
    /Cannot set public_visibility = true when admin_hidden is true/,
  );
});

test("Three consent dimensions are strictly independent", () => {
  const sim = new PublicationWorkflowSimulator();
  sim.insertConsent("research_participation", "granted");
  sim.insertConsent("public_display", "declined");
  sim.insertConsent("future_communication", "granted");

  assert.equal(sim.getLatestConsent("research_participation")?.consent_event, "granted");
  assert.equal(sim.getLatestConsent("public_display")?.consent_event, "declined");
  assert.equal(sim.getLatestConsent("future_communication")?.consent_event, "granted");
  assert.equal(sim.submission.public_visibility, false);
});
