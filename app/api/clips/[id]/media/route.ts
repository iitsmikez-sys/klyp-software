import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createEditorUpload, listEditorAssets, EditorAssetError } from '@/lib/editor-assets';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'private, no-store' };

async function handle(req: NextRequest, {params}: Context, upload: boolean) {
 try {
  const { id } = await params;
  const client=await createClient(); const {data:{user}}=await client.auth.getUser();
  if(!user) return NextResponse.json({error:'Sign in to import media.'},{status:401,headers});
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({error:'Clip not found.'},{status:404,headers});
  if(!upload) return NextResponse.json({assets:await listEditorAssets(user.id,id)},{headers});
  let body;
  try { body=await req.json(); } catch { return NextResponse.json({error:'Invalid upload metadata.'},{status:400,headers}); }
  const result=await createEditorUpload(user.id,id,body?.file_name,body?.size_bytes,body?.mime_type);
  return NextResponse.json(result,{status:201,headers});
 } catch(error) {
  if(error instanceof EditorAssetError) return NextResponse.json({error:error.message},{status:error.status,headers});
  console.error('[editor-media] request failed',error);
  return NextResponse.json({error:'Could not access editor media. Please try again.'},{status:500,headers});
 }
}
/** Metadata only: the browser sends bytes to the returned Supabase signed upload URL. */
export async function POST(req:NextRequest,context:Context) { return handle(req,context,true); }
export async function GET(req:NextRequest,context:Context) { return handle(req,context,false); }
