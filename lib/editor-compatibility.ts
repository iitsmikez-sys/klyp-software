import type {SavedClip} from './clip-ui.ts';
import {defaultClipEditDraft,toClipExportPayload,type ClipEditDraftV3} from './clip-edit-draft.ts';
import {resolveExportFormat} from './clips.ts';
/** Never remove or rewrite an existing device draft merely by opening the new editor. */
export function hasLegacyEditorDraft(raw: string | null): boolean { return raw !== null; }
export function isLegacyEditorExport(body: Record<string, unknown>): boolean {
 if(body.edit_draft !== undefined || body.editor_export === true || body.caption_cues !== undefined) return false;
 return body.legacy_editor === true || Array.isArray(body.segments) && body.segments.length > 0 && body.segments.every(s=>s && typeof s.start === 'number' && typeof s.end === 'number');
}
/** Free explicitly exports the original clip without mutating its saved Pro draft. */
export function timelineExportPayload(clip: SavedClip, draft: ClipEditDraftV3, isPro: boolean) {
 if(isPro) return toClipExportPayload(clip,draft);
 return toClipExportPayload(clip,{...defaultClipEditDraft(clip),aspect_ratio:resolveExportFormat(draft.aspect_ratio,false)});
}
