// 수업보고서 발송용 이름(0217a users.report_display_name) — **표시 매핑 판정** 순수 함수.
//
// 왜 표시 시점 매핑인가: lesson_reports.teacher_name은 "지난 보고서" 이력(`eq(teacher_name, displayName)`)·
// 보강 소유 판정(makeup-owner)·작성률 통계가 **이름 일치**로 묶는 귀속 축이라, 저장값을 발송용 이름으로
// 갈아끼우면 그 강사의 본인 이력이 통째로 사라진다. 그래서 저장은 그대로 두고, 학부모에게 보이는 표면
// (ClassNote 게시 작성자명 · /r 공유 카드 · 인쇄본 · 원스크린 미리보기)에서만 이름을 바꾼다.
//
// ⚠️ 이 판정은 발송 워커(scripts/_classnote/classnote-core.mjs)에도 같은 규칙으로 복제돼 있다
//    (워커는 .mjs라 TS를 import하지 못한다) — 규칙을 바꾸면 **둘 다** 고칠 것.

export type ReportAuthorRow = {
  displayName: string | null;
  reportDisplayName: string | null;
};

/**
 * `teacherName`(보고서에 저장된 표시 이름)에 대한 발송용 이름 — 없으면 null(원래 이름 그대로).
 *
 * `rows` = 그 테넌트에서 **display_name이 teacherName과 같은 users 행 전부**(override 유무 무관).
 * - 정확히 1명이고 그 사람이 발송용 이름을 정했으면 → 그 이름.
 * - 같은 표시 이름의 직원이 2명 이상이면 → null(모호 — 남의 보고서에 다른 사람 발송용 이름이 붙는
 *   오표시가 미표시보다 나쁘다. 이때는 지금처럼 실명이 나간다).
 * - 아무도 안 정했으면 → null.
 *
 * 🔴 매칭은 **raw 정확 일치**(트림·퍼지 금지) — lesson_reports.teacher_name은 저장 시
 * users.display_name을 **그대로** 기록하므로 byte 동일이 곧 같은 계정이다. 트림 매칭을 섞으면
 * 앱(.eq SQL)과 워커(JS)가 "박소선"/"박소선 " 같은 케이스에서 서로 다른 답을 내는 갈림길이 된다
 * (적대 리뷰 2026-08-18에서 실제 지적된 분기). 공백만 다른 두 계정은 **서로 다른 계정**이고,
 * 각자의 보고서는 raw 일치로 각자 이름에 정확히 갈린다 — 이게 모호 판정보다 옳다.
 */
export function pickReportAuthorName(
  teacherName: string | null | undefined,
  rows: ReportAuthorRow[],
): string | null {
  const name = teacherName ?? "";
  if (!name.trim()) return null;
  const matches = rows.filter((r) => (r.displayName ?? "") === name);
  if (matches.length !== 1) return null;
  const override = (matches[0]!.reportDisplayName ?? "").trim();
  return override || null;
}

/** 발송용 이름 입력 최대 길이 — ClassNote 작성자명·카드 '담임' 칸에 들어가는 한 줄 이름. */
export const REPORT_NAME_MAX = 30;
