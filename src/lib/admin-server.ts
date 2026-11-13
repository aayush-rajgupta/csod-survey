import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendSubmissionNotification } from "@/lib/email-notifications";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

/**
 * Verifies that the current request is authenticated as an administrator.
 */
export async function verifyAdminAuth(): Promise<{ userId: string }> {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();

  if (authError || !user) {
    throw new Error("Unauthorized: Administrator sign-in required.");
  }

  const serviceClient = createServiceClient();
  const { data: adminRecord, error: adminError } = await serviceClient
    .from("admin_users")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .eq("role", "super_admin")
    .maybeSingle();

  if (adminError || !adminRecord) {
    throw new Error("Forbidden: Administrator privileges required.");
  }

  return { userId: user.id };
}

/**
 * Explicitly hides a survey submission by setting admin_hidden = true and public_visibility = false.
 */
export async function adminHideSubmission(submissionId: string): Promise<{ ok: true }> {
  if (!submissionId || !isUuid(submissionId)) {
    throw new Error("Invalid submission ID.");
  }

  await verifyAdminAuth();
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.rpc("admin_hide_submission", {
    p_submission_id: submissionId,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to hide submission.");
  }

  return { ok: true };
}

/**
 * Explicitly clears admin_hidden and restores public visibility if public_display consent is granted
 * and moderation status is approved.
 */
export async function adminRestoreSubmission(submissionId: string): Promise<{ ok: true }> {
  if (!submissionId || !isUuid(submissionId)) {
    throw new Error("Invalid submission ID.");
  }

  await verifyAdminAuth();
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.rpc("admin_restore_submission", {
    p_submission_id: submissionId,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to restore submission.");
  }

  return { ok: true };
}

/**
 * Explicitly updates the moderation status of a submission.
 */
export async function adminSetModeration(
  submissionId: string,
  status: "approved" | "rejected" | "pending",
): Promise<{ ok: true }> {
  if (!submissionId || !isUuid(submissionId)) {
    throw new Error("Invalid submission ID.");
  }
  if (!["approved", "rejected", "pending"].includes(status)) {
    throw new Error("Invalid moderation status.");
  }

  await verifyAdminAuth();
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.rpc("admin_set_moderation", {
    p_submission_id: submissionId,
    p_status: status,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to update moderation status.");
  }

  return { ok: true };
}

/**
 * Retries sending an email notification for a submission. Requires admin authorization.
 */
export async function adminRetrySubmissionNotification(
  submissionId: string,
): Promise<{ ok: boolean; status: "sent" | "failed" | "skipped"; error?: string }> {
  if (!submissionId || !isUuid(submissionId)) {
    throw new Error("Invalid submission ID.");
  }

  await verifyAdminAuth();
  return sendSubmissionNotification(submissionId, { forceRetry: true });
}

