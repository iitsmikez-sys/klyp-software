import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { previewEditorAsset, EditorAssetError } from '@/lib/editor-assets';

export const runtime='nodejs';
type Context={params:{id:string;assetId:string}};
export async function GET(_req:NextRequest,{params}:Context) {
 const headers={'Cache-Control':'private, no-store'};
 try {
  const client=await createClient();const {data:{user}}=await client.auth.getUser();
  if(!user) return NextResponse.json({error:'Sign in to preview imported media.'},{status:401,headers});
  if(![params.id,params.assetId].every(id=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) return NextResponse.json({error:'Media asset not found.'},{status:404,headers});
  return NextResponse.json(await previewEditorAsset(user.id,params.id,params.assetId),{headers});
 }catch(error){
  if(error instanceof EditorAssetError) return NextResponse.json({error:error.message},{status:error.status,headers});
  console.error('[editor-media] preview failed',error);
  return NextResponse.json({error:'Could not preview this media. Please try again.'},{status:500,headers});
 }
}
