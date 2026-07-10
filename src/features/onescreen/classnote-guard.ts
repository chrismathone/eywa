import { kstToday } from "@/lib/date-kst";

/**
 * ClassNote 발송 too_old 가드 — edutrix 2026-05~06 과거보고서 재발송 사고(1~4월 3,500건이 학부모에게 오발송)
 * 대응으로 도입. "전 달 1일 이후" 보고서만 발송 허용. **KST 기준** 순수 문자열(YYYY-MM-DD) 비교라 Vercel UTC
 * 월초/자정 경계 오류 없음. (edutrix utils/classnoteGuard.ts 이식.)
 */

/** 오늘(KST) 기준 발송 허용 최소 날짜 = "전 달 1일"(YYYY-MM-DD). 1월이면 전년 12월 1일. */
export function classnoteMinDate(todayKst: string = kstToday()): string {
  const [y, m] = todayKst.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

/** report_date(YYYY-MM-DD)가 발송 허용 범위인가 — 전 달 1일 이후(문자열 사전순 비교). */
export function isClassnoteAllowed(reportDate: string, todayKst: string = kstToday()): boolean {
  if (!reportDate) return false;
  return reportDate >= classnoteMinDate(todayKst);
}

/**
 * ClassNote로 발송 가능한 과목 키 화이트리스트 — 실보드 명명 관례가 `(수학)학생명`/`(영어)학생명` 둘뿐이라
 * 보드 라벨 매핑이 있는 과목만 발송할 수 있다(math·subject_1→수학 보드, english→영어 보드).
 * ⚠️ 이 목록에 없는 과목을 발송하면 워커 subjectLabel이 전부 "(수학)" 보드로 보내는 오게시가 났었음
 * (2026-07-10 병행 발송 적대 검증 P0-3). 새 과목을 발송 지원하려면 여기 + classnote-core.mjs subjectLabel
 * + ClassNote 실보드 관례를 함께 확장할 것.
 */
export const CLASSNOTE_SENDABLE_SUBJECTS = ["math", "subject_1", "english"] as const;

/**
 * 과목별 ClassNote 발송 허용 여부 — 학원설정 `report.classnoteSubjects`(발송 허용 과목 키 목록)에 든 과목만 발송.
 * **명시 opt-in**: 목록이 비면(기본) 어떤 과목도 발송 안 함(수학만 쓰는 현 운영 + 오발송 안전장치 겸용).
 * **발송 경로에서 subject null/빈값은 거부**(2026-07-10 P0-2) — 이관(edutrix_import)·레거시 행이 math opt-in에
 * 편승해 과목 게이트를 통과하는 것 차단. (조회용 null→math 정규화는 score-history 등 별도 코드 — 영향 없음.)
 * 화이트리스트 밖 과목도 거부(P0-3) — 보드 매핑이 없어 "(수학)" 보드 오게시로 직결되기 때문.
 * 순수 함수(Vitest). 큐 진입(saveAndQueueClassnote)·재발송(retryClassnote) 공용 게이트.
 */
export function isClassnoteSubjectEnabled(
  subject: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!subject || !subject.trim()) return false; // 발송 경로에선 과목 불명 = 거부
  if (!(CLASSNOTE_SENDABLE_SUBJECTS as readonly string[]).includes(subject)) return false;
  return allowed.includes(subject);
}
