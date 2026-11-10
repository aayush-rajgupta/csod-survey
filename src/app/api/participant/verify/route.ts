import { NextResponse } from "next/server";

import { verifyParticipantToken } from "@/lib/participant-server";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  try {
    await verifyParticipantToken(token ?? "");
    return NextResponse.redirect(new URL("/?verified=1", request.url));
  } catch {
    return NextResponse.redirect(new URL("/?verified=0", request.url));
  }
}
