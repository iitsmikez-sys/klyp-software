import { captionAppearance, layoutTimedCaption, hookTextLayout, HOOK_TOP_MARGIN_REF } from './captions.ts';
import { editorOverlayAtTime, resolveEditorCues } from './editor-captions.ts';
import { defaultCaptionPlacement, defaultHookPlacement, type TextPlacement } from './text-placement.ts';
import { planClipComposition, previewDimensions, type VerticalLayoutV1 } from './vertical-layout.ts';
import type { ClipEditDraftV3 } from './clip-edit-draft.ts';
import type { SavedClip } from './clip-ui.ts';

export function editorHookPlacement(draft:ClipEditDraftV3,source:{w:number;h:number}|null):TextPlacement {
  const res=previewDimensions(source?.w&&source?.h?source:{w:1920,h:1080},draft.aspect_ratio);
  const requested=draft.hook_placement??defaultHookPlacement();
  const geometry=hookTextLayout(draft.hook,res,draft.hook_style,requested);
  return draft.hook_placement
    ? {x:geometry.x/res.w,y:geometry.y/res.h,scale:requested.scale}
    : {x:.5,y:(HOOK_TOP_MARGIN_REF*res.h/1920+geometry.lines.length*geometry.lineHeight/2)/res.h,scale:1};
}

/** Where the caption group is actually painted, including the video-safe area. */
export function editorCaptionPlacement(draft:ClipEditDraftV3,clip:SavedClip,time:number,source:{w:number;h:number}|null,layout:VerticalLayoutV1|null):TextPlacement {
  if(!source?.w||!source?.h)return draft.caption_placement??defaultCaptionPlacement(draft.caption_position);
  const res=previewDimensions(source,draft.aspect_ratio);
  const plan=planClipComposition(source,draft.aspect_ratio,layout,res);
  const text=editorOverlayAtTime(draft,clip,time).caption?.text ?? resolveEditorCues(draft,clip)[0]?.text ?? 'Caption';
  const painted=layoutTimedCaption(text,draft.caption_style,captionAppearance(draft),res,plan.textSafe,draft.caption_font??'sans');
  if(!painted.lines.length)return draft.caption_placement??defaultCaptionPlacement(draft.caption_position);
  const first=painted.lines[0],last=painted.lines[painted.lines.length-1];
  return {x:first.x/res.w,y:(first.y+last.y)/2/res.h,scale:draft.caption_placement?.scale??1};
}
