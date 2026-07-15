// Postgres/PostgREST 에러 원문(영문)을 사용자용 한글 요약으로 변환(순수).
// UI 규칙: 기술 에러 원문을 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
// 선례: humanizeClassnoteError([src/features/report-admin/classnote-error.ts]).

/** @param action 사용자가 시도한 동작("저장"·"삭제"·"수정") — 문장에 그대로 들어간다. */
export function humanizeDbError(raw: string | null | undefined, action = "저장"): string {
  const r = (raw ?? "").trim();
  if (/row-level security|permission denied|insufficient privilege|not authorized/i.test(r))
    return `${action} 권한이 없습니다 — 이 문서를 다룰 수 있는 계정인지 확인하세요`;
  if (/JWT|token is expired|invalid claim|refresh_token/i.test(r))
    return "로그인이 만료되었습니다 — 새로고침한 뒤 다시 시도하세요";
  if (/duplicate key|unique constraint/i.test(r)) return "이미 같은 내용이 저장되어 있습니다";
  if (/violates foreign key|violates check constraint|invalid input syntax/i.test(r))
    return `입력한 값이 올바르지 않아 ${action}하지 못했습니다 — 각 칸의 형식을 확인하세요`;
  if (/timeout|ETIMEDOUT|canceling statement/i.test(r))
    return `${action} 시간이 초과되었습니다 — 잠시 후 다시 시도하세요`;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network|ERR_/i.test(r))
    return "서버에 연결하지 못했습니다 — 인터넷 연결을 확인한 뒤 다시 시도하세요";
  return `${action}하지 못했습니다 — 자세한 내용은 마우스를 올려 확인하세요`;
}
