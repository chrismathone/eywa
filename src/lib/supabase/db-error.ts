// Postgres/PostgREST 에러 원문(영문)을 사용자용 한글 요약으로 변환(순수).
// UI 규칙: 기술 에러 원문을 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
// 선례: humanizeClassnoteError([src/features/report-admin/classnote-error.ts]).

/** @param action 사용자가 시도한 동작("저장"·"삭제"·"수정") — 문장에 그대로 들어간다. */
export function humanizeDbError(raw: string | null | undefined, action = "저장"): string {
  const r = (raw ?? "").trim();
  // ⚠️ **권한·입력 패턴보다 먼저.** 스키마/관계 오류는 사용자가 뭘 잘못한 게 아니라 **코드가 틀린 것**이라
  // "형식을 확인하세요"처럼 사용자를 탓하는 문장으로 흘러가면 안 된다(원장이 자기 입력을 계속 고치게 된다).
  // 2026-08-03 실사례: 0171a가 `makeup_class_id`를 더해 lesson_reports→classes FK가 2개가 되자
  // 보고서 목록의 `classes(...)` 임베드가 PGRST201로 실패 → 영문 원문이 그대로 토스트에 떴다.
  // ⚠️ 이건 새로고침으로 낫지 않으므로 "다시 시도" 안내를 하지 말 것 — 배포로만 고쳐진다.
  if (/PGRST(100|200|201|202|204)|more than one relationship|Could not embed|Could not find a relationship|does not exist|schema cache/i.test(r))
    return "화면을 구성하는 데이터 설정에 문제가 있어 불러오지 못했습니다 — 입력하신 값 때문이 아니니 관리자에게 알려 주세요";
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
