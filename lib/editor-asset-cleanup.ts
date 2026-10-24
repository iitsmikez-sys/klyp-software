import { cleanupExpiredEditorUploads } from './editor-assets.ts';

/** Persistent sweep: abandoned uploads and deleted clip/account originals, with retries. */
export function startEditorAssetCleanup() {
 if(process.env.DEPLOYMENT_TARGET!=='processing') return;
 const state=globalThis as typeof globalThis & {editorAssetCleanupTimer?:ReturnType<typeof setInterval>};
 if(state.editorAssetCleanupTimer) return;
 let busy=false;
 const sweep=async()=>{
  if(busy) return;
  busy=true;
  try { await cleanupExpiredEditorUploads(); }
  catch(error) { console.error('[editor-media] storage cleanup failed; will retry',error instanceof Error?error.message:error); }
  finally { busy=false; }
 };
 state.editorAssetCleanupTimer=setInterval(()=>void sweep(),15*60*1000);
 state.editorAssetCleanupTimer.unref();
 void sweep();
}
