/**
 * **미발송 보고서(저장만 하고 발송 안 누른 건)가 지금 실제로 보낼 수 있는가** — 판정 단일 소스(순수·Vitest).
 *
 * 원장 제보 2026-09-09: *"알림에는 미발송건이 굉장히 많은데, 실제로 들어가보면 발송건이 없어. 알림이 틀린거야?"*
 * 실측 결과 알림은 옳았다(09-08 5건이 진짜 `classnote_status IS NULL`). 화면이 안 보여 준 것이다 —
 * 발송 큐 카드는 `.not("classnote_status","is",null)`이라 **아직 큐에 안 들어온 건은 구조적으로 못 센다**.
 * 그래서 카드에 '미발송' 수를 세우고, 그 수가 알림·발송 콘솔과 **같은 게이트**를 지나게 이 모듈로 모았다.
 *
 * 🔴 게이트가 갈라지면 둘 중 하나가 거짓말이 된다([[#77]]): 알림은 재촉하는데 콘솔은 거절하거나,
 *    카드에 N건이 떠 있는데 눌러 보면 0건이 큐에 오른다. 소비처는 아래 셋이 전부여야 한다 —
 *    ① 발송 큐 카드 수(`getClassnoteQueue`) ② 미발송 재촉 알림(`detectUnsentReports`)
 *    ③ 발송 콘솔(`sendClassnoteForUnsent` — 여기에 더해 동명이인 마킹·dry-run 스위치를 갖는다).
 *
 * 판정 항목(전부 "보낼 수 없으면 세지 않는다"):
 *   · 발송 이력 없음(`classnote_status IS NULL`) · 취소 아님 · 이관분(edutrix_import) 아님 — **쿼리가 건다**.
 *   · 발송 기한 안(`isClassnoteAllowed`, 오늘 포함 7일) — 창 밖은 어떤 경로로도 못 나간다.
 *   · 과목 opt-in(`isClassnoteSubjectEnabled`) — injaewon은 math만.
 *   · '수업보고서 미발송' 반(0174a `report_optout`) 제외 — 애초에 안 보내기로 한 반.
 *   · **멘트가 있어야 한다** — 발송 콘솔이 빈 멘트를 큐에 올리지 않는다(워커가 어차피 거절).
 *     ⚠️ 이 항목이 종전 알림에는 없었다 = 멘트 빈 건을 재촉하고 있었다(이번에 맞춘다).
 *   · 그날 결석이면 제외(보강 보고서는 예외) — 판정은 호출부가 `getAbsenceBlockedKeys`로 미리 구한다.
 */
import { isClassnoteAllowed, isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";

/** 게이트가 보는 보고서 행의 최소 모양 — 조회마다 컬럼이 조금씩 달라 필요한 것만 받는다. */
export type UnsentRow = {
  id: string;
  studentId: string;
  reportDate: string;
  subject: string | null;
  classId: string | null;
  makeup: boolean | null;
  /** 학부모에게 나갈 멘트(`lesson_reports.notes`). 비면 발송 콘솔이 거절한다. */
  ment: string | null;
};

export type UnsentGateContext = {
  /** KST 오늘 — 발송 기한 창의 기준. */
  today: string;
  /** 학원설정 `report.classnoteSubjects`(현 injaewon `["math"]`). 빈 배열이면 어떤 과목도 못 나간다. */
  classnoteSubjects: readonly string[];
  /** '수업보고서 미발송' 반 id 집합(0174a). */
  optoutClassIds: ReadonlySet<string>;
  /** 그날 결석이라 막힌 키 집합(`absenceKeyOf`). 보강 보고서는 이 집합을 보지 않는다. */
  absenceBlockedKeys: ReadonlySet<string>;
  /** 행 → 결석 키. 호출부가 `absenceKeyOf`를 넘긴다(서버 전용 모듈을 여기서 import하지 않으려고). */
  absenceKeyOf: (row: UnsentRow) => string;
};

/** 멘트가 실제로 적혀 있나 — 발송 콘솔 `hasMent`와 같은 규칙(공백만 있으면 없는 것). */
export function hasSendableMent(ment: string | null | undefined): boolean {
  return !!(ment ?? "").trim();
}

export function isUnsentSendable(row: UnsentRow, ctx: UnsentGateContext): boolean {
  if (!isClassnoteAllowed(row.reportDate, ctx.today)) return false;
  if (!isClassnoteSubjectEnabled(row.subject, ctx.classnoteSubjects)) return false;
  if (row.classId && ctx.optoutClassIds.has(row.classId)) return false;
  if (!hasSendableMent(row.ment)) return false;
  // 보강은 결석 게이트 밖(발송 콘솔과 같은 규약) — 결석분을 메우는 수업이라 그날 결석 기록이 정상이다.
  if (!row.makeup && ctx.absenceBlockedKeys.has(ctx.absenceKeyOf(row))) return false;
  return true;
}

/** 순서를 보존한다 — 호출부가 "가장 오래된 건"을 첫 원소로 읽는다. 제네릭이라 호출부가 얹은 필드(학생 이름 등)가 안 사라진다. */
export function filterUnsentSendable<T extends UnsentRow>(rows: readonly T[], ctx: UnsentGateContext): T[] {
  return rows.filter((row) => isUnsentSendable(row, ctx));
}
