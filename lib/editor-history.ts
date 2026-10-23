export type History<T> = {
    past: T[];
    present: T;
    future: T[];
};
export const reset = <T>(present: T): History<T> => ({ past: [], present: structuredClone(present), future: [] });
export function apply<T>(h: History<T>, next: T): History<T> { return JSON.stringify(next) === JSON.stringify(h.present) ? h : { past: [...h.past.slice(-99), h.present], present: structuredClone(next), future: [] }; }
export function undo<T>(h: History<T>): History<T> { return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h; }
export function redo<T>(h: History<T>): History<T> { return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h; }
