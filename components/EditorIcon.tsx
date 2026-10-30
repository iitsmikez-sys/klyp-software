import type { CSSProperties } from 'react';

const paths = {
 transcript: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
 photo: 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M9 8h.01',
 captions: 'M4 6h16v12H4z M7 11h3 M7 14h5 M14 14h3',
 layout: 'M3 3h18v18H3z M3 11h18 M12 11v10',
 video: 'M3 5h13v14H3z M16 9l5-3v12l-5-3 M8 9l4 3-4 3z',
 export: 'M12 16V3 M7 8l5-5 5 5 M4 14v7h16v-7',
 split: 'M9 9l11 11 M9 15L20 4 M7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M7 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
 delete: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
 undo: 'M8 4L3 9l5 5 M3 9h11a6 6 0 0 1 0 12',
 redo: 'M16 4l5 5-5 5 M21 9H10a6 6 0 0 0 0 12',
 play: 'M7 4l14 8-14 8z',
 pause: 'M8 4v16 M16 4v16',
 previous: 'M5 5v14 M19 5L7 12l12 7z',
 next: 'M19 5v14 M5 5l12 7-12 7z',
 audio: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-3-3h3 M20 16a3 3 0 1 1-3-3h3',
 hook: 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
 volume: 'M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14',
 muted: 'M3 9h4l5-4v14l-5-4H3z M16 9l6 6 M22 9l-6 6',
} as const;

export default function EditorIcon({name,style}:{name:keyof typeof paths;style?:CSSProperties}) {
 return <svg aria-hidden="true" className="editor-icon" style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}
