/**
 * 선생님 원스크린 — "발송 현황" 뷰 순수 헬퍼(5단계-1).
 * 오늘 (학생×과목) 행별 발송 상태와 요약(미작성/작성중/발송/열람)을 계산. 신규 쿼리 없이 이미 로드된
 * reports state(발송·열람)와 subject(진도 입력)만 사용. CLAUDE.md: 계산 함수 분리 + Vitest.
 */
import type { GridRow } from "./grid";
import type { Subject } from "./types";
import type { SubjectReport } from "./components/report-card";

// 발송완료 > 작성중(진도·초안 있음, 미발송) > 미작성(아무것도 안 함).
export type SendStatus = "sent" | "draft" | "todo";

/** 행 발송 상태. sent=오늘 저장됨, draft=미발송이나 진도·초안 있음, todo=미착수. */
export function rowSendStatus(rep: SubjectReport | undefined, subject: Subject): SendStatus {
  if (rep?.sent) return "sent";
  if ((rep?.draft && rep.draft.trim()) || (subject.today && subject.today.trim())) return "draft";
  return "todo";
}

export type SendSummary = {
  total: number; // 오늘 (학생×과목) 행 수
  sent: number; // 발송(저장)됨
  draft: number; // 미발송·작성중
  todo: number; // 미작성(미착수)
  unsent: number; // 아직 안 보낸 = draft + todo (리마인더 핵심 수)
  viewed: number; // 발송 + 학부모 열람 1회 이상
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
  for (const r of rows) {
    const rep = reports[r.student.id]?.[r.subject.name];
    const s = rowSendStatus(rep, r.subject);
    if (s === "sent") {
      sent++;
      if ((rep?.viewCount ?? 0) > 0) viewed++;
    } else if (s === "draft") draft++;
    else todo++;
  }
  return { total: rows.length, sent, draft, todo, unsent: draft + todo, viewed };
}
