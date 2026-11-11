import { createClient } from "@supabase/supabase-js";

const expectedProjectHost = "awcqwzxiawxuuvuzzmeu.supabase.co";

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(?:sb_(?:publishable|secret)_|eyJ)[A-Za-z0-9._-]+/gu, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted]");
}

export function logSupabaseDiagnostics(
  stage: string,
  error?: { code?: string; message?: string },
): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const diagnostics = {
    stage,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(url),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    },
    supabaseHostname: (() => {
      if (!url) return "missing";
      try {
        return new URL(url).hostname;
      } catch {
        return "invalid";
      }
    })(),
    expectedProjectHost,
  };

  if (error) {
    console.error("[supabase-diagnostics]", {
      ...diagnostics,
      error: {
        code: error.code ?? "unknown",
        message: sanitizeErrorMessage(error.message ?? "unknown"),
      },
    });
    return;
  }

  console.info("[supabase-diagnostics]", diagnostics);
}

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  logSupabaseDiagnostics("service-client-initialization");

  if (!url || !serviceRoleKey) {
    const missing = [
      !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
      !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    ].filter((name): name is string => name !== null);
    logSupabaseDiagnostics("service-client-initialization-failed", {
      code: "MISSING_ENV",
      message: `Missing server environment variables: ${missing.join(", ")}`,
    });
    throw new Error(`Missing server environment variables: ${missing.join(", ")}`);
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
