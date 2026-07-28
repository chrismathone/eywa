/**
 * "오늘은 진도 대신 **월말평가**를 봤다"를 정식 값으로 다루는 규약 — 원장 지시(2026-07-28):
 * *"월말평가 치는 날도 수업보고서를 발송해야 한다"*.
 *
 * 왜 필요한가: 월말평가일엔 나간 차시가 없다. 그런데 진도칸이 비면 ① 학부모 카드에 진도가 통째로 빠지고
 * ② AI 멘트는 사실 0이라 생성이 거부되며(`generateReportComment` hasFacts) ③ 강사가 어쩔 수 없이
 * "월말평가", "시험", "-" 등을 차시칸에 제각각 적는다(과제칸에서 이미 겪은 실측 67건 패턴 —
 * [`none-marker.ts`](./none-marker.ts) 참조). 그 값은 그대로 학부모에게 나간다.
 *
 * 규약 두 줄:
 *  ① 표기는 **"월말평가" 하나로 통일**한다. 진도 문자열(`Subject.today`)에 이 라벨 **단독**으로 들어간다 —
 *     차시와 섞이지 않는다(월말평가일엔 나간 차시가 없으므로).
 *  ② **진도 파이프라인에서는 자동 제외**된다. 커리큘럼 정확 매핑(`positionOf`)에 걸리지 않아
 *     `ingestReport`가 `no-position`으로 skip → 진도 컨테이너·이상 감지가 오염되지 않는다.
 *     🔴 이 라벨을 커리큘럼 차시 이름과 겹치게 바꾸지 말 것(겹치면 월말평가가 진도로 집계된다).
 *
 * ⚠️ 저장 경로는 기존 진도칸 그대로다(마이그레이션 0) — `lesson_reports.progress`엔 다른 진도와 똑같이
 *    `"수학 월말평가"`(과목 라벨 접두)로 들어가고, 세션 자동저장(`subject_progress`)·직전 회차 복원도
 *    별도 분기 없이 동작한다. **새 컬럼을 만들지 말 것** — 진도칸 하나가 단일 소스여야 표(그리드)·카드·
 *    직전 회차·발송이 전부 자동으로 따라온다.
 */

/** 화면·저장·학부모 카드에 나가는 표준 표기. 진도 문자열에 이 값 단독으로 들어간다. */
export const MONTHLY_EXAM_LABEL = "월말평가";

/**
 * 이 진도 값이 "월말평가"인가 — 문장 조립·AI 사실 블록이 진도 표현("~ 진도를 진행했습니다")을
 * 쓰면 안 되는지 판정한다. 과목 라벨 접두(`"수학 월말평가"`)가 붙은 저장값에도 그대로 쓸 수 있게
 * **포함 검사**가 아니라 라벨 제거 후 비교 — 차시 이름에 우연히 들어간 경우를 삼키지 않는다.
 */
export function isMonthlyExam(progress: string | null | undefined): boolean {
  return progress?.trim() === MONTHLY_EXAM_LABEL;
}

/**
 * 저장된 진도(`"수학 월말평가"`처럼 과목 라벨이 앞에 붙은 값)가 월말평가인가.
 * 접두 라벨은 행마다 달라(수학·영어) 정규식으로 벗기지 않고 **끝이 라벨인지**로 본다.
 */
export function isMonthlyExamProgress(progress: string | null | undefined): boolean {
  const s = progress?.trim();
  if (!s) return false;
  return s === MONTHLY_EXAM_LABEL || s.endsWith(` ${MONTHLY_EXAM_LABEL}`);
}
