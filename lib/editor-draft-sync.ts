/** Browser cache metadata is separate from the versioned cloud document. */
export type EditorDraftDocument = { version: 1; [key: string]: unknown };
export type LocalEditorDraft = EditorDraftDocument & {
  cloudRevision: number;
  dirty: boolean;
  savedAt: number;
};
export type CloudEditorDraft = { revision: number; draft: EditorDraftDocument };

export function normalizeLocalDraft(value: unknown): LocalEditorDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (draft.version !== undefined && draft.version !== 1) return null;
  return {
    ...draft, version: 1,
    cloudRevision: Number.isInteger(draft.cloudRevision) && (draft.cloudRevision as number) >= 0
      ? draft.cloudRevision as number : 0,
    dirty: typeof draft.dirty === "boolean" ? draft.dirty : true,
    savedAt: typeof draft.savedAt === "number" && Number.isFinite(draft.savedAt)
      ? draft.savedAt : 0,
  };
}

export function cloudDocument(local: LocalEditorDraft): EditorDraftDocument {
  const { cloudRevision: _revision, dirty: _dirty, savedAt: _savedAt, ...document } = local;
  return document;
}

export function chooseEditorDraft(local: LocalEditorDraft | null, cloud: CloudEditorDraft | null):
  { source: "local" | "cloud" | "conflict" | "empty"; draft: EditorDraftDocument | null; revision: number } {
  if (!cloud) return local
    ? { source: "local", draft: cloudDocument(local), revision: 0 }
    : { source: "empty", draft: null, revision: 0 };
  if (!local || !local.dirty) return { source: "cloud", draft: cloud.draft, revision: cloud.revision };
  if (local.cloudRevision === cloud.revision) {
    return { source: "local", draft: cloudDocument(local), revision: cloud.revision };
  }
  return { source: "conflict", draft: cloudDocument(local), revision: cloud.revision };
}
