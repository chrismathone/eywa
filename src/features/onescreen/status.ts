/**
 * 선생님 원스크린 — "발송 현황" 뷰 순수 헬퍼(5단계-1).
 * 오늘 (학생×과목) 행별 발송 상태와 요약(미작성/작성중/발송/열람)을 계산. 신규 쿼리 없이 이미 로드된
 * reports state(발송·열람)와 subject(진도 입력)만 사용. CLAUDE.md: 계산 함수 분리 + Vitest.
 */
import type { GridRow } from "./grid";
import type { Subject } from "./types";
import type { SubjectReport } from "./components/report-card";

// 발송완료 > 작성중(진도·초안 있음, 미발송) > 미작성(아무것도 안 함) > 제외(보낼 일이 없는 행).
export type SendStatus = "sent" | "draft" | "todo" | "excluded";

/**
 * 행 발송 상태. sent=오늘 저장됨, draft=미발송이나 진도·초안 있음, todo=미착수,
 * excluded='수업보고서 미발송' 반(0174a)이라 **애초에 보낼 일이 없는 행**.
 *
 * 🔴 `excluded`가 필요한 이유(2026-08-19): 그 반이 원스크린 로스터에 돌아오면서(출결을 찍어야 해서)
 *    보고서 입력이 잠긴 행이 이 보드에 들어온다. 그냥 두면 **영원히 지울 수 없는 빨간 '미작성'**이 되어
 *    강사가 할 수 있는 일이 없는 재촉이 된다(#77 — 재촉은 그 행동의 실제 게이트와 같은 조건이어야 한다).
 * ⚠️ `sent`가 먼저다 — 미발송 반이 되기 **전에** 나간 옛 보고서가 있으면 그 사실이 더 중요하다.
 */
export function rowSendStatus(rep: SubjectReport | undefined, subject: Subject): SendStatus {
  if (rep?.sent) return "sent";
  if (subject.reportOptout === true) return "excluded";
  if ((rep?.draft && rep.draft.trim()) || (subject.today && subject.today.trim())) return "draft";
  return "todo";
}

export type SendSummary = {
  /** **보낼 수 있는** (학생×반) 행 수 — 미발송 반(excluded)은 분모에서 뺀다(못 채우는 분모 금지). */
  total: number;
  sent: number; // 발송(저장)됨
  draft: number; // 미발송·작성중
  todo: number; // 미작성(미착수)
  unsent: number; // 아직 안 보낸 = draft + todo (리마인더 핵심 수)
  viewed: number; // 발송 + 학부모 열람 1회 이상
  /** '수업보고서 미발송' 반이라 대상이 아닌 행 — 화면이 "왜 안 세나"를 밝힐 수 있게 건수는 돌려준다. */
  excluded: number;
};

/** 전체 행(오늘 학생×과목) 기준 발송 현황 요약. */
export function summarizeSend(
  rows: GridRow[],
  reports: Record<string, Record<string, SubjectReport>>,
): SendSummary {
  let sent = 0;
  let draft = 0;
  let todo = 0;
  let viewed = 0;
  let excluded = 0;
  for (const r of rows) {
    const rep = reports[r.student.id]?.[r.subject.name];
    const s = rowSendStatus(rep, r.subject);
    if (s === "sent") {
      sent++;
      if ((rep?.viewCount ?? 0) > 0) viewed++;
    } else if (s === "draft") draft++;
    else if (s === "excluded") excluded++;
    else todo++;
  }
  return { total: rows.length - excluded, sent, draft, todo, unsent: draft + todo, viewed, excluded };
}
