import { validateVerticalLayout, type VerticalLayoutV1 } from "./vertical-layout.ts";

export function parseVerticalLayoutWrite(input: unknown): VerticalLayoutV1 | null {
  return input === null ? null : validateVerticalLayout(input);
}

export function authorizeLayoutWrite(sessionUserId: string | null, rowUserId: string | null): 401 | 403 | null {
  if (!sessionUserId) return 401;
  if (sessionUserId !== rowUserId) return 403;
  return null;
}

export function effectiveVerticalLayout(accountLayout: VerticalLayoutV1 | null, draftOverride?: VerticalLayoutV1 | null): VerticalLayoutV1 | null {
  return draftOverride ?? accountLayout;
}

export function layoutEditorState(isPro: boolean, accountLayout: VerticalLayoutV1 | null, clipOverride: VerticalLayoutV1 | null | undefined, pendingAccount: VerticalLayoutV1 | null) {
  return isPro
    ? { preview: effectiveVerticalLayout(accountLayout, clipOverride), pending: null, exportBlocked: false }
    : { preview: pendingAccount ?? accountLayout, pending: pendingAccount, exportBlocked: pendingAccount !== null };
}
