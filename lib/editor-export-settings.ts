import type { CaptionStyle, ExportFormat } from './clips';
import type { HookStyle } from './captions';
import type { CaptionColor, CaptionPosition } from './editor-captions';
import type { EditSegment } from './edit-segments';
import type { MediaInsert } from './editor-media';
/** The same settings travel from the editor to individual and batch exports. */
export type EditorExportSettings = {
  style?: CaptionStyle; hook?: string; hook_style: HookStyle;
  aspect_ratio: ExportFormat; caption_color: CaptionColor; caption_position: CaptionPosition;
  caption_edits?: { text: string }[]; segments: EditSegment[]; media: MediaInsert[];
};
