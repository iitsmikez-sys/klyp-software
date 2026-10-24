import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateVerticalLayout } from "@/lib/vertical-layout";
import { parseVerticalLayoutWrite } from "@/lib/vertical-layout-auth";

export const runtime = "nodejs";

async function owner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Sign in to manage your layout." }, { status: 401 });
  const { data, error } = await createAdminClient().from("profiles").select("vertical_layout").eq("id", user.id).single();
  if (error) return NextResponse.json({ error: "Could not load layout." }, { status: 500 });
  try {
    return NextResponse.json({ layout: data.vertical_layout ? validateVerticalLayout(data.vertical_layout) : null });
  } catch {
    return NextResponse.json({ layout: null, warning: "Saved layout is outdated or invalid. The full frame will be used." });
  }
}

export async function PUT(req: NextRequest) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Sign in to manage your layout." }, { status: 401 });
  let layout;
  try {
    const body = await req.json();
    layout = parseVerticalLayoutWrite(body?.layout);
  } catch {
    return NextResponse.json({ error: "Invalid vertical layout." }, { status: 400 });
  }
  const { data, error } = await createAdminClient().from("profiles").update({ vertical_layout: layout })
    .eq("id", user.id).select("vertical_layout").single();
  if (error) return NextResponse.json({ error: "Could not save layout." }, { status: 500 });
  return NextResponse.json({ layout: data.vertical_layout });
}
