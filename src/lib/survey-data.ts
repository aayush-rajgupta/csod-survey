import "server-only";

import {
  createServiceClient,
  logSupabaseDiagnostics,
} from "@/lib/supabase/service";

export type City = {
  id: string;
  name: string;
  city_code: string;
};

export type Zone = {
  id: string;
  city_id: string;
  zone_name: string;
};

export type SurveyQuestion = {
  id: string;
  question_key: string;
  question_text: string;
  question_type:
    | "short_text"
    | "long_text"
    | "number"
    | "date"
    | "multiple_choice"
    | "checkboxes"
    | "linear_scale"
    | "dropdown";
  section: string;
  options: unknown[];
  validation_rules: Record<string, unknown>;
  visibility_rule: Record<string, unknown> | null;
  is_required: boolean;
  display_order: number;
  survey_version: string;
};

const supportedCitySlugs = [
  "bhubaneswar",
  "mumbai",
  "bengaluru",
  "jamshedpur",
  "patna",
] as const;

export async function getActiveCities(): Promise<City[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cities")
    .select("id, name, city_code")
    .eq("is_active", true)
    .in("slug", [...supportedCitySlugs])
    .order("name");

  if (error) {
    logSupabaseDiagnostics("get-active-cities-query-failed", error);
    throw new Error("Unable to load supported cities.");
  }
  logSupabaseDiagnostics("get-active-cities-query-succeeded");
  return data ?? [];
}

export async function getActiveZones(cityId: string): Promise<Zone[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("city_zones")
    .select("id, city_id, zone_name")
    .eq("city_id", cityId)
    .eq("is_active", true)
    .order("zone_name");

  if (error) throw new Error("Unable to load zones for this city.");
  return data ?? [];
}

export async function getActiveQuestions(
  cityId: string,
): Promise<SurveyQuestion[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("survey_questions")
    .select(
      "id, question_key, question_text, question_type, section, options, validation_rules, visibility_rule, is_required, display_order, survey_version",
    )
    .eq("is_active", true)
    .or(`city_id.is.null,city_id.eq.${cityId}`)
    .order("display_order");

  if (error) throw new Error("Unable to load the active questionnaire.");
  return (data ?? []) as SurveyQuestion[];
}
