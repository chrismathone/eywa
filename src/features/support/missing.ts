/** 0294a 미적용 — 표가 아직 없다(42P01 / PGRST205). */
export function isMissingSupportTables(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/support_requests|support_notices/.test(error.message ?? "") &&
      /not find|does not exist|schema cache/i.test(error.message ?? ""))
  );
}

export const SUPPORT_NOT_READY = "고객센터 준비 중 — 아직 적용되지 않았습니다.";

/** PostgREST `or`/`ilike` 필터 문자열을 깨뜨리는 글자를 걷어낸다. */
export function cleanSearch(q: string | undefined): string {
  return (q ?? "").replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** 제목+내용 검색 → PostgREST `or` 필터(`cleanSearch`를 거친 말만). */
export function searchFilter(q: string): string {
  return `title.ilike.%${q}%,body.ilike.%${q}%`;
}
