import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/profile";
import { authorizeClipDraftWrite } from "@/lib/clip-edit-auth";
import { ClipEditDraftError, validateClipEditDraft } from "@/lib/clip-edit-draft";
import { assertOwnedDraftAssets, EditorAssetError } from "@/lib/editor-assets";

export const runtime = "nodejs";

type Context = { params: { id: string } };

async function updateDraft(req: NextRequest, { params }: Context, reset: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to edit clips." }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  let body: unknown = null;
  if (!reset) {
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  }

  try {
    const admin = createAdminClient();
    const { data: clip, error: readError } = await admin.from("clips")
      .select("id,user_id,start_seconds,end_seconds,words")
      .eq("id", params.id).eq("user_id", user.id).maybeSingle();
    if (readError) throw readError;
    const profile = await getProfile();
    const denial = authorizeClipDraftWrite(
      user.id, clip?.user_id ?? null, profile?.tier ?? null,
      profile?.stripe_subscription_id ?? null,
    );
    if (denial) {
      const error = denial === 404 ? "Clip not found." : "Editing saved clips requires Pro.";
      return NextResponse.json({ error }, { status: denial });
    }
    const draft = reset ? null : validateClipEditDraft(
      (body as { draft?: unknown } | null)?.draft,
      clip!,
    );
    if (draft) await assertOwnedDraftAssets(user.id, params.id, draft);
    const { data, error: writeError } = await admin.from("clips")
      .update({ edit_draft: draft })
      .eq("id", params.id).eq("user_id", user.id)
      .select("edit_draft").single();
    if (writeError) throw writeError;
    return NextResponse.json({ edit_draft: data.edit_draft });
  } catch (error) {
    if (error instanceof EditorAssetError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ClipEditDraftError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[clip-edit-draft] save failed", error);
    return NextResponse.json({ error: "Could not save clip edits. Please try again." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: Context) {
  return updateDraft(req, context, false);
}

export async function DELETE(req: NextRequest, context: Context) {
  return updateDraft(req, context, true);
}
