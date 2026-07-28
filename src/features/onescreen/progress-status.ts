/**
 * "그 날은 **진도가 중단**된다"를 정식 값으로 다루는 규약 — 원장 지시(2026-07-28):
 * *"월말평가 치는 날도 수업보고서를 발송해야 한다 / 그 날은 시험을 치기 때문에 진도가 '중단'되는 날인 것"*.
 * edutrix `ChapterSelector`의 `SKIP_CHAPTER_STATUSES`(진도 체크 없이 제출 가능한 특수 상태) 이식.
 *
 * 왜 필요한가: 시험을 치는 날엔 나간 차시가 없다. 그런데 진도칸이 비면 ① 학부모 카드에서 진도가 통째로
 * 빠지고 ② AI 멘트는 사실 0이라 생성이 거부되며(`generateReportComment` hasFacts) ③ 강사가 차시칸에
 * "월말평가"·"시험"·"-"를 제각각 적어 그대로 학부모에게 나간다(과제칸에서 겪은 실측 67건 패턴 =
 * [`none-marker.ts`](./none-marker.ts)).
 *
 * 규약 세 줄:
 *  ① 표기는 아래 **닫힌 목록** 하나로 통일한다. 진도 문자열(`Subject.today`)에 라벨 **단독**으로 들어간다.
 *  ② 차시와 **상호배타**다 — 진도가 중단된 날이므로 차시와 섞이지 않는다. 선택기가 값을 통째로 교체한다.
 *  ③ **진도 파이프라인에서 자동 제외**된다. 커리큘럼 정확 매핑(`positionOf`)에 걸리지 않아
 *     `ingestReport`가 `no-position`으로 skip → 진도 컨테이너·이상 감지가 오염되지 않는다.
 *     🔴 라벨을 커리큘럼 차시 이름과 겹치게 바꾸지 말 것(겹치면 시험이 진도로 집계된다).
 *
 * ⚠️ 저장 경로는 기존 진도칸 그대로다(마이그레이션 0) — `lesson_reports.progress`엔 다른 진도와 똑같이
 *    `"수학 모의고사"`(과목 라벨 접두)로 들어가고, 세션 자동저장(`subject_progress`)·직전 회차 복원·발송이
 *    별도 분기 없이 동작한다. **새 컬럼을 만들지 말 것** — 진도칸 하나가 단일 소스여야 표(그리드)·카드·
 *    직전 회차·발송이 전부 자동으로 따라온다.
 *
 * 🔴 **진도와 '병행'하는 상태는 여기에 넣지 말 것** — edutrix의 나머지 6개(`오답 정리`·`과제오답`·
 *    `모르는 문제 풀이`·`문제 풀이`·`덜한 과제 진행`·`일일테스트`)는 차시와 **함께** 기록되는 별개 축이라
 *    진도칸에 같이 담으면 [`positionOf`](../progress/curriculum-position.ts)의 `normalizeLegacy`가
 *    **마지막 줄**을 그날 진도로 읽어(= 상태 문자열) 매핑에 실패한다 → 그날 진짜 진도가 컨테이너에
 *    안 들어가고 진도 시계가 조용히 멈춘다. 병행 상태를 도입하려면 **별도 컬럼**이 선행돼야 한다.
 */

/**
 * 진도 체크 없이 제출 가능한 특수 상태 — **표시 순서 = 이 배열 순서**(선택기 알약).
 * edutrix `SKIP_CHAPTER_STATUSES`와 같은 축이되 첫 항목 라벨은 원장 표기 `월말평가`를 쓴다
 * (edutrix 표기 `월간테스트`는 아래 레거시 별칭으로만 인식 — 선택지로는 노출하지 않는다).
 */
export const SKIP_PROGRESS_STATUSES = ["월말평가", "모의고사", "내신대비", "시험대비"] as const;

export type SkipProgressStatus = (typeof SKIP_PROGRESS_STATUSES)[number];

/**
 * 인식만 하고 **선택지로는 안 내보내는** 옛 표기. edutrix 화면에서 쓰이던 `월간테스트`가 손입력으로
 * 들어와도 문장·라벨·잠금이 똑같이 동작하게 한다. ⚠️ 새 표기를 여기에 추가하면 선택지가 아니라
 * "읽기만 되는 값"이 된다 — 강사가 고를 수 있어야 하면 `SKIP_PROGRESS_STATUSES`에 넣을 것.
 */
const LEGACY_ALIASES = ["월간테스트"] as const;

const ALL_LABELS: readonly string[] = [...SKIP_PROGRESS_STATUSES, ...LEGACY_ALIASES];

/** 첫 항목 — 가장 흔한 케이스(월말평가). 문서·테스트가 대표값으로 쓴다. */
export const MONTHLY_EXAM_LABEL: SkipProgressStatus = SKIP_PROGRESS_STATUSES[0];

/**
 * 진도칸 원본값(`Subject.today`)이 특수 상태면 그 라벨, 아니면 null.
 * 라벨 **단독**일 때만 인정한다 — 차시 이름에 우연히 섞인 값("월말평가 오답풀이")을 삼키면 진짜 기록이 사라진다.
 */
export function skipStatusOf(today: string | null | undefined): string | null {
  const s = today?.trim();
  return s && ALL_LABELS.includes(s) ? s : null;
}

/** 진도칸 원본값이 "진도가 중단된 날"인가 — 차시 선택 잠금·문장 분기 판정. */
export function isSkipStatus(today: string | null | undefined): boolean {
  return skipStatusOf(today) !== null;
}

/**
 * 저장값(`lesson_reports.progress` = `"수학 모의고사"`처럼 과목 라벨 접두가 붙은 값)의 특수 상태 라벨.
 * 접두 라벨은 행마다 달라(수학·영어) 정규식으로 벗기지 않고 **끝이 라벨인지**로 본다.
 */
export function skipStatusOfProgress(progress: string | null | undefined): string | null {
  const s = progress?.trim();
  if (!s) return null;
  const direct = skipStatusOf(s);
  if (direct) return direct;
  return ALL_LABELS.find((label) => s.endsWith(` ${label}`)) ?? null;
}

/** 저장값이 "진도가 중단된 날"인가 — 학부모 카드 필드 라벨 분기. */
export function isSkipStatusProgress(progress: string | null | undefined): boolean {
  return skipStatusOfProgress(progress) !== null;
}
