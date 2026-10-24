"use client";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
type Blocker = (() => boolean) | null;
const NavigationGuardContext = createContext<{
    current: Blocker;
} | null>(null);
const POSITION = "__klypHistoryPosition";
/**
 * Track entries across the shared App Router root, including before the editor
 * mounts. Capture popstate before Next's bubble listener can restore its tree.
 * Cancelling rewinds only browser history; React never sees either traversal.
 */
export function NavigationGuardProvider({ children }: {
    children: ReactNode;
}) {
    const blocker = useRef<Blocker>(null);
    useEffect(() => {
        const history = window.history;
        const originalPush = history.pushState;
        const originalReplace = history.replaceState;
        let position = Number.isInteger(history.state?.[POSITION]) ? history.state[POSITION] : 0;
        let restoring = false;
        originalReplace.call(history, { ...history.state, [POSITION]: position }, "");
        const push: History["pushState"] = function (state, unused, url) {
            position += 1;
            originalPush.call(history, { ...state, [POSITION]: position }, unused, url);
        };
        const replace: History["replaceState"] = function (state, unused, url) {
            originalReplace.call(history, { ...state, [POSITION]: position }, unused, url);
        };
        history.pushState = push;
        history.replaceState = replace;
        const pop = (event: PopStateEvent) => {
            const target = event.state?.[POSITION];
            if (restoring) {
                // Next must not process the return traversal either: the original
                // editor tree and local history have remained mounted throughout.
                event.stopImmediatePropagation();
                restoring = false;
                return;
            }
            if (!Number.isInteger(target) || target === position)
                return;
            if (blocker.current?.() && !window.confirm("Leave without saving your clip edits?")) {
                event.stopImmediatePropagation();
                restoring = true;
                history.go(position - target);
                return;
            }
            position = target;
        };
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (blocker.current?.()) {
                event.preventDefault();
                event.returnValue = "";
            }
        };
        window.addEventListener("popstate", pop, true);
        window.addEventListener("beforeunload", beforeUnload);
        return () => {
            window.removeEventListener("popstate", pop, true);
            window.removeEventListener("beforeunload", beforeUnload);
            if (history.pushState === push)
                history.pushState = originalPush;
            if (history.replaceState === replace)
                history.replaceState = originalReplace;
        };
    }, []);
    return <NavigationGuardContext.Provider value={blocker}>{children}</NavigationGuardContext.Provider>;
}
export function useUnsavedNavigationGuard(dirty: boolean) {
    const blocker = useContext(NavigationGuardContext);
    const latest = useRef(dirty);
    latest.current = dirty;
    useEffect(() => {
        if (!blocker)
            return;
        const read = () => latest.current;
        blocker.current = read;
        return () => { if (blocker.current === read)
            blocker.current = null; };
    }, [blocker]);
}
