import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getProfileFromToken } from '@/lib/profile-token';
import { withCors, corsPreflight } from '@/lib/cors';
import { finalizeEditorUpload, EditorAssetError } from '@/lib/editor-assets';

export const runtime='nodejs';
export const maxDuration=180;
export const OPTIONS=corsPreflight;
type Context={params:{id:string;assetId:string}};
export async function POST(req:NextRequest,context:Context) { return withCors(await finalize(req,context)); }
async function finalize(req:NextRequest,{params}:Context) {
 const headers={'Cache-Control':'private, no-store'};
 if(process.env.DEPLOYMENT_TARGET!=='processing') return NextResponse.json({error:'This endpoint only runs on the processing service.'},{status:404,headers});
 try {
  const token=bearerToken(req);const profile=token?await getProfileFromToken(token):null;
  if(!profile) return NextResponse.json({error:'Sign in to verify imported media.'},{status:401,headers});
  if(profile.tier!=='pro' || !profile.stripe_subscription_id) return NextResponse.json({error:'Importing media requires a confirmed Pro subscription.'},{status:403,headers});
  if(![params.id,params.assetId].every(id=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) return NextResponse.json({error:'Media asset not found.'},{status:404,headers});
  return NextResponse.json({asset:await finalizeEditorUpload(profile.id,params.id,params.assetId)},{headers});
 }catch(error){
  if(error instanceof EditorAssetError) return NextResponse.json({error:error.message},{status:error.status,headers});
  console.error('[editor-media] verification failed',error);
  return NextResponse.json({error:'Could not verify this upload. Please retry verification.'},{status:503,headers});
 }
}
