import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimAcquisitionSource } from "@/lib/acquisition-claim";
import { SOURCE_COOKIE } from "@/lib/acquisition-source";

export const runtime = "nodejs";

/** Saves where a new account came from. Safe to call again: it only fills an empty value on a new account. */
export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const result = await claimAcquisitionSource(
      createAdminClient() as unknown as Parameters<typeof claimAcquisitionSource>[0],
      user.id,
      request.cookies.get(SOURCE_COOKIE)?.value,
    );
    return NextResponse.json({ ok: true, result });
  } catch {
    // Tracking must never get in the way of using Klyp.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
