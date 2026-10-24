import { validateSegments, type SourceSegment } from './editor-timeline.ts';
export type Selection = {
    type: 'video' | 'caption' | 'cutaway';
    id: string;
} | null;
export type SaveState = {
    confirmed: string;
    pending: string | null;
    error: string | null;
};
export function saveTransition(state: SaveState, event: {
    type: 'pending';
    snapshot: string;
} | {
    type: 'success';
} | {
    type: 'error';
    message: string;
}): SaveState {
    if (event.type === 'pending')
        return { ...state, pending: event.snapshot, error: null };
    if (event.type === 'error')
        return { ...state, pending: null, error: event.message };
    return { confirmed: state.pending ?? state.confirmed, pending: null, error: null };
}
export const needsNavigationGuard = (state: SaveState, current: string) => state.pending !== null || state.confirmed !== current;
export const deleteTarget = (selection: Selection) => selection?.type ?? 'none';
export function trimSelected(segments: SourceSegment[], id: string, start: number, end: number, sourceStart: number, sourceEnd: number) {
    if (!segments.some(s => s.id === id))
        throw new Error('Select a video segment.');
    return validateSegments(segments.map(s => s.id === id ? { ...s, start_seconds: start, end_seconds: end } : s), sourceStart, sourceEnd);
}
/** Reconcile only fields unchanged since submission. Edits made during the request win. */
export function reconcileSavedDraft<T extends object>(current: T, submitted: T, confirmed: T): T {
    const result = { ...current };
    for (const key of Object.keys(confirmed) as (keyof T)[]) {
        if (JSON.stringify(current[key]) === JSON.stringify(submitted[key]))
            result[key] = confirmed[key];
    }
    return result;
}
/** Space yields to native activation; edit commands only yield to text controls. */
export function isEditorShortcutTarget(tagName: string, role: string | null, editable: boolean, code = 'Space'): boolean {
    const tag = tagName.toUpperCase();
    if (editable || ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(tag) || ['textbox', 'combobox'].includes(role ?? '')) return false;
    if (code !== 'Space') return true;
    return !['BUTTON', 'A', 'SUMMARY'].includes(tag) && !['button', 'tab', 'slider', 'link', 'menuitem', 'checkbox', 'radio', 'switch'].includes(role ?? '');
}
