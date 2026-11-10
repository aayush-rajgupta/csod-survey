import ParticipantExperience from "@/app/participant-experience";
import { getActiveCities } from "@/lib/survey-data";
import { connection } from "next/server";

export const instant = false;

export default async function Home() {
  await connection();
  let cities;
  try {
    cities = await getActiveCities();
  } catch {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <section className="max-w-lg rounded-3xl border border-amber-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Temporarily unavailable</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">We couldn&apos;t load the survey.</h1>
          <p className="mt-3 leading-7 text-slate-600">The participant experience needs its server-side Supabase configuration. Please try again after the service is configured.</p>
        </section>
      </main>
    );
  }
  return <ParticipantExperience cities={cities} />;
}
