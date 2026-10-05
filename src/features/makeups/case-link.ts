const CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 보강 상세는 케이스 주소다. 식별자가 아니면 링크를 만들지 않는다. */
export function makeupCaseHref(caseId: string | null | undefined): string | null {
  if (!caseId || !CASE_ID.test(caseId)) return null;
  return `/makeups/${caseId}`;
}
