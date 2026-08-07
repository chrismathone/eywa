/**
 * 강사뷰 홈(원스크린 자리)을 과목으로 가르는 **순수 규칙** — IO는 [teacher-home.ts](./teacher-home.ts)가 담당.
 *
 * 배경(원장 지시 2026-08-07): *"영어 선생님들의 강사뷰를 수학 선생님과 차별화. 수학은 수업보고서를 위한
 * 원스크린, 영어 강사들은 ECS를 기반으로 한 원스크린을 두고 나머지 메뉴를 구성."*
 * 근거는 실측이다 — 2026-07-01 이후 `lesson_reports` 771건이 **전부 수학 반**이고 영어 반은 0건이라,
 * 영어 강사에게 원스크린(수업 마감)은 구조적으로 빈 화면이었다. 그들의 작업면은 ECS 주간 시트다.
 *
 * ⚠️ **순수/IO를 나눈 이유**: 판정 규칙을 두 곳(레이아웃 착지 · 뷰 전환 액션)이 쓰는데, 뷰 전환 액션은
 * 쿠키를 **막 세팅한 그 요청**이라 `effectiveTeacherId()`(쿠키 판독)를 신뢰할 수 없다. 그쪽은 이미 들고 있는
 * 담당 반 과목을 이 규칙에 직접 먹인다 — 규칙이 갈라지지 않게 여기 한 곳에만 적는다.
 */

/** 영어 강사 홈 = English Class Sheet 랜딩(담당 영어 반 주간 카드). */
export const ENGLISH_TEACHER_HOME = "/ecs";
/** 기본 강사 홈 = 선생님 원스크린(수업 마감·수업보고서 발송). */
export const DEFAULT_TEACHER_HOME = "/onescreen";

/**
 * 담당 반(`classes.teacher_id`) 과목만으로 강사 홈을 정한다.
 *
 * - **영어만** 담당 → ECS. 그 사람에겐 원스크린에 마감할 수업보고서가 없다.
 * - 그 외(수학 전담·겸업) → 원스크린. ⚠️ **겸업(영어+수학)은 반드시 원스크린**이다 — 수학 반 보고서를
 *   매일 마감해야 하므로, 영어를 하나 맡았다는 이유로 홈을 옮기면 그날 마감을 못 찾는다.
 * - 담당 반이 0개(또는 과목 미지정)면 **`null`** = "이것만으론 판정 불가". 호출부가 부담임 슬롯까지 보고
 *   정한다(실측: Florence Park — 담당 반 0개, 영어 반 슬롯 5개. 그 사람의 원스크린은 로스터가 담당 반만
 *   싣기 때문에 항상 비어 있다).
 */
export function teacherHomeFromClassSubjects(subjects: string[]): string | null {
  if (subjects.length === 0) return null;
  return subjects.every((s) => s === "english") ? ENGLISH_TEACHER_HOME : DEFAULT_TEACHER_HOME;
}

/**
 * 담당 반이 없을 때의 폴백 판정 — 부담임(슬롯 강사)으로 배선된 영어 반이 하나라도 있으면 ECS.
 * 근거는 `class_schedules.teacher_id`(FK)뿐이다(라벨 금지 — ECS 접근 게이트와 같은 규약).
 */
export function teacherHomeFromAssistantClasses(englishAssistantClassCount: number): string {
  return englishAssistantClassCount > 0 ? ENGLISH_TEACHER_HOME : DEFAULT_TEACHER_HOME;
}
