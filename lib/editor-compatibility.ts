import type {SavedClip} from './clip-ui.ts';
import {toClipExportPayload,type ClipEditDraftV3} from './clip-edit-draft.ts';
/** Never remove or rewrite an existing device draft merely by opening the new editor. */
export function hasLegacyEditorDraft(raw: string | null): boolean { return raw !== null; }
/** The timeline is the primary editor; a browser-only draft remains available by choice. */
export function initialSavedEditorState(raw: string | null): { mode: 'timeline'; hasLegacy: boolean } {
 return { mode: 'timeline', hasLegacy: hasLegacyEditorDraft(raw) };
}
export function isLegacyEditorExport(body: Record<string, unknown>): boolean {
 if(body.edit_draft !== undefined || body.editor_export === true || body.caption_cues !== undefined) return false;
 return body.legacy_editor === true || Array.isArray(body.segments) && body.segments.length > 0 && body.segments.every(s=>s && typeof s.start === 'number' && typeof s.end === 'number');
}
/** Editing is available on every plan. Format and watermark rules apply at export. */
export function timelineExportPayload(clip: SavedClip, draft: ClipEditDraftV3, _isPro: boolean) {
 return toClipExportPayload(clip,draft);
}

