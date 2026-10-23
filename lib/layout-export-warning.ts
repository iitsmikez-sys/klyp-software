export function readLayoutExportWarning(response: Pick<Response, "headers">): string | null {
  return response.headers.get("X-Klyp-Layout-Warning")?.trim() || null;
}
