/**
 * 신규 상담 사전 체크리스트 — 옵션 카탈로그 + 타입 + 파싱/검증(순수).
 *
 * 공개 접수 폼(학부모)·서버 액션(재검증)·등록상담 상세(표시)가 **이 파일 하나**를 소스로 쓴다.
 * 값은 코드(영문 slug)로 저장하고 화면 라벨은 여기 `label`만 참조 — DB/jsonb에 한글을 박아두면
 * 문구 수정이 과거 데이터를 못 따라오고, 화면에 raw 값이 새면 안 되기 때문(UI 한글 매핑 규칙).
 *
 * ⚠️ 과목 enum과의 관계: 5(수학)·6(영어)번은 **과목별 문항 은행**이라 학원설정 subjects의 라벨·선택지를
 * 대신하지 않는다(설정 과목 목록은 스텝1이 단일 소스). 노출 여부만 선택 과목으로 판정 → `wantsSubject()`.
 * 레벨테스트 SUBSCORE_KEYS와 같은 성격의 도메인 메타(KNOWN_EXCEPTION).
 */

export type ChoiceOption = { value: string; label: string };

/** 학습 상담을 통해 가장 알고 싶은 문제 (최대 2). ⚠️ 저장 키는 `goals` 고정 — 문항 이름이 바뀌어도
 *  기존 데이터가 그대로 읽히도록 값·키는 건드리지 않는다(라벨만 교체). */
export const GOAL_OPTIONS: ChoiceOption[] = [
  { value: "level", label: "현재 영어·수학 수준" },
  { value: "priority", label: "3~6개월 학습 우선순위" },
  { value: "prior_decision", label: "선행학습 시작·유지·중단 여부" },
  { value: "class_fit", label: "적합한 반과 수업 방식" },
  { value: "time_split", label: "과목별 학습 시간 배분" },
  { value: "habit", label: "학습 습관 및 자기주도성 개선" },
  { value: "exam", label: "시험 대비 및 성적 향상" },
];

/** 3. 가장 걱정되는 것 (최대 3) */
export const WORRY_OPTIONS: ChoiceOption[] = [
  { value: "where_to_start", label: "무엇부터 공부해야 할지 모르겠다" },
  { value: "behind_peers", label: "또래보다 진도가 늦은 것 같다" },
  { value: "prior_shallow", label: "선행은 하지만 제대로 이해하는지 모르겠다" },
  { value: "grade_vs_skill", label: "학교 성적은 괜찮지만 실제 실력이 불안하다" },
  { value: "low_yield", label: "공부량에 비해 성과가 잘 보이지 않는다" },
  { value: "avoids_hard", label: "틀리거나 어려운 문제를 피하려 한다" },
  { value: "no_self_start", label: "스스로 공부를 시작하거나 마치기 어렵다" },
  { value: "overload", label: "현재 학습량이 너무 많은 것 같다" },
  { value: "opaque_academy", label: "학원 수업과 관리가 어떻게 이루어지는지 모르겠다" },
];

/** 현재 학생의 학업 수준을 무엇으로 판단하시나요 (복수). 저장 키 `levelBasis` 고정(라벨만 교체). */
export const LEVEL_BASIS_OPTIONS: ChoiceOption[] = [
  { value: "school_grade", label: "학교 성적" },
  { value: "test_result", label: "학교·학원 시험 결과" },
  { value: "material", label: "현재 학습 중인 교재와 진도" },
  { value: "compare", label: "또래 또는 형제자매와의 비교" },
  { value: "teacher", label: "학교·학원 교사의 설명" },
  { value: "watching", label: "아이가 문제를 풀고 설명하는 모습" },
  { value: "unsure", label: "정확히 판단하기 어렵다" },
];

/** 5. 수학 현재 상태 (최대 2) */
export const MATH_STATE_OPTIONS: ChoiceOption[] = [
  { value: "calc_error", label: "연산 실수가 잦거나 정확도가 낮다" },
  { value: "formula_only", label: "공식을 사용하지만 개념을 설명하지 못한다" },
  { value: "word_problem", label: "문장제의 조건을 해석하기 어렵다" },
  { value: "unfamiliar", label: "낯선 문제를 어떻게 시작해야 할지 모른다" },
  { value: "repeat_wrong", label: "같은 유형의 오답이 반복된다" },
  { value: "fast_unstable", label: "진도는 빠르지만 현행 과정이 불안하다" },
  { value: "needs_advanced", label: "기본 문제는 가능하고 심화·응용이 필요하다" },
  { value: "fine", label: "현재 큰 어려움이 없다" },
  { value: "unknown", label: "아직 정확히 모르겠다" },
];

/** 6. 영어 현재 상태 (최대 2) */
export const ENGLISH_STATE_OPTIONS: ChoiceOption[] = [
  { value: "phonics", label: "알파벳·파닉스·소리 읽기 기초가 필요하다" },
  { value: "vocab", label: "어휘량이 부족하거나 단어를 자주 잊는다" },
  { value: "grammar", label: "문장 구조와 문법 이해가 약하다" },
  { value: "reading", label: "문장을 읽지만 내용을 정확히 이해하지 못한다" },
  { value: "listening", label: "듣기 또는 말하기가 어렵다" },
  { value: "writing", label: "문장 쓰기와 서술형 표현이 어렵다" },
  { value: "fast_unstable", label: "진도는 빠르지만 실제 이해가 부족하다" },
  { value: "needs_advanced", label: "기본 학습은 안정적이며 심화가 필요하다" },
  { value: "fine", label: "현재 큰 어려움이 없다" },
  { value: "unknown", label: "아직 정확히 모르겠다" },
];

/** 7. 학습 행동 1~5점 */
export const HABIT_ITEMS: ChoiceOption[] = [
  { value: "self_start", label: "도움 없이 공부를 시작한다" },
  { value: "finish", label: "정해진 과제를 끝까지 마친다" },
  { value: "explain", label: "배운 내용을 자기 말로 설명한다" },
  { value: "review_wrong", label: "틀린 이유를 찾아 다시 해결한다" },
  { value: "try_hard", label: "어려운 문제도 일단 시도해 본다" },
  { value: "recover", label: "학습 후 감정적으로 빠르게 회복한다" },
];
export const HABIT_SCALE_MIN = 1;
export const HABIT_SCALE_MAX = 5;

/** 선행학습 — 진행 여부 + 이유. (부작용 문항 "복습·수면·독서·자신감이 줄고 있나요"는 폐기: 원장 지시 2026-07-15.) */
export const PRIOR_STATUS_OPTIONS: ChoiceOption[] = [
  { value: "none", label: "하지 않음" },
  { value: "partial", label: "일부 진행 중" },
  { value: "active", label: "적극적으로 진행 중" },
  { value: "unsure", label: "잘 모르겠음" },
];
/**
 * ⚠️ "선행을 고려하지 않음" 같은 선택지를 다시 넣지 말 것(원장 지적 2026-07-15) — 안 하는 사람은 위
 * '여부'에서 '하지 않음'을 고르고 이 라디오는 숨겨진다. 여기 남기면 "진행 중"이라 해놓고 "고려하지 않음"을
 * 고를 수 있는 모순된 중복이 된다. 이 목록은 **하는(또는 고려 중인) 사람의 이유**만 담는다.
 */
export const PRIOR_REASON_OPTIONS: ChoiceOption[] = [
  { value: "mastered", label: "현재 과정을 충분히 이해했기 때문" },
  { value: "next_stage", label: "다음 학년 또는 학교급 전환 대비" },
  { value: "exam", label: "시험·입시 대비" },
  { value: "peers", label: "또래가 선행하고 있어서" },
  { value: "academy", label: "현재 학원에서 권해서" },
  { value: "anxiety", label: "뒤처질 것 같은 불안 때문에" },
];

/**
 * 심화학습 — 선행학습과 같은 구조(여부 + 이유), 문구만 심화에 맞춤(원장 지시 2026-07-15).
 * 여부 선택지는 선행과 문구가 같아 PRIOR_STATUS_OPTIONS를 공유(같은 라벨을 두 벌 두면 한쪽만 고쳐져 어긋난다).
 * 이유는 '선행'이 박힌 문구가 있어 별도 카탈로그 — 값(slug)은 선행과 같은 체계로 맞춰 읽기 쉽게.
 */
export const ADVANCED_REASON_OPTIONS: ChoiceOption[] = [
  { value: "mastered", label: "현재 과정을 충분히 이해했기 때문" },
  { value: "next_stage", label: "다음 학년 또는 학교급 전환 대비" },
  { value: "exam", label: "시험·입시 대비" },
  { value: "peers", label: "또래가 심화하고 있어서" },
  { value: "academy", label: "현재 학원에서 권해서" },
  { value: "anxiety", label: "뒤처질 것 같은 불안 때문에" },
];

/** 9. 6개월 내 원하는 변화 (최대 2) */
export const CHANGE_OPTIONS: ChoiceOption[] = [
  { value: "basics", label: "영어·수학 기초 안정" },
  { value: "school_progress", label: "학교 진도와 성취기준 도달" },
  { value: "prior_ready", label: "선행학습을 시작할 준비" },
  { value: "problem_solving", label: "독해력과 문제해결력 향상" },
  { value: "self_study", label: "스스로 공부하는 습관 형성" },
  { value: "exam_score", label: "학교·학원 시험 성적 향상" },
  { value: "confidence", label: "어려운 문제에 대한 자신감 회복" },
  { value: "less_stress", label: "과도한 학습량과 스트레스 감소" },
];

/** 10. 학원에서 확인·제공받고 싶은 것 (최대 3) */
export const WANT_OPTIONS: ChoiceOption[] = [
  { value: "diagnosis", label: "영어·수학 진단 결과와 근거" },
  { value: "class_criteria", label: "학생에게 적합한 반 배정 기준" },
  { value: "teaching_style", label: "실제 수업 방식과 과제 수준" },
  { value: "difficulty_policy", label: "진도 및 난이도 조정 기준" },
  { value: "monthly_record", label: "월별 학습 내용과 성장 기록" },
  { value: "habit_mgmt", label: "오답·과제·학습 습관 관리 방식" },
  { value: "regular_report", label: "성적 또는 실력 변화에 대한 정기 보고" },
  { value: "fast_consult", label: "이상 신호 발생 시 빠른 상담" },
  { value: "cost_transparency", label: "비용 및 수강 운영의 투명성" },
];

/** 최대 선택 개수 — 폼 가드와 서버 검증이 같은 값을 쓴다. */
export const MAX_GOALS = 2;
export const MAX_WORRIES = 3;
export const MAX_SUBJECT_STATES = 2;
export const MAX_CHANGES = 2;
export const MAX_WANTS = 3;

export type SubjectChecklist = { states: string[]; course: string | null };

export type IntakeChecklist = {
  version: 1;
  goals: string[];
  goalsEtc: string | null;
  worries: string[];
  worriesEtc: string | null;
  worryOutcome: string | null;
  levelBasis: string[];
  levelBasisEtc: string | null;
  math: SubjectChecklist | null;
  english: SubjectChecklist | null;
  habits: Record<string, number>;
  priorStatus: string | null;
  priorReason: string | null;
  /** '하지 않음'을 고른 경우에만 묻는 자유입력 — 왜 안 하는지(학원이 제안을 맞추는 데 핵심). */
  priorNoneReason: string | null;
  advancedStatus: string | null;
  advancedReason: string | null;
  advancedNoneReason: string | null;
  changes: string[];
  changesEtc: string | null;
  wants: string[];
  wantsEtc: string | null;
  strengths: string | null;
  extra: string | null;
};

/** 라벨 조회 — 미등록 값(옛 데이터·문항 개편)은 raw 대신 "(삭제된 항목)"으로. UI에 slug 노출 금지. */
export function labelOf(options: ChoiceOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? "(삭제된 항목)";
}

/**
 * 선택 과목이 특정 과목 문항(수학·영어)에 해당하는지.
 * 표준키(math/english)를 우선 보고, 학원이 자체 키로 만든 과목(예: 수학(심화)=subject_1)은 라벨로 판정한다
 * — 설정에서 키는 자동 확정이라 라벨이 유일한 단서다. 판정 실패는 문항 미노출(과잉 질문 방지)일 뿐 안전.
 */
export function wantsSubject(
  selected: { key: string; label: string }[],
  target: "math" | "english",
): boolean {
  const ko = target === "math" ? "수학" : "영어";
  return selected.some((s) => s.key === target || s.label.includes(ko));
}
