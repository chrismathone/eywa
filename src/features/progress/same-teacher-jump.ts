/**
 * 진도 점프 경고 — **같은 선생님 자기 줄 안에서 난 점프**만 경고한다 (원장 지시 2026-08-20).
 *
 * 원장: *"진도 점프 이상이, 같은 선생님의 진도 체크에서 이상한 경우에만, 경고하도록 배선."*
 *       *"부담임 선생님의 진도가 다른 경우가 있을 수 있기 때문."*
 *
 * ## 왜 필요한가
 * `detectJumpError`는 **활성 컨테이너의 직전 위치**와만 비교한다 — 그 위치를 누가 썼는지 보지 않는다.
 * 그런데 한 학생을 담임·부담임이 나눠 맡으면 서로 다른 줄(교재·차시)을 나란히 쓴다(실측 2026-08-20:
 * 최근 120일 진도 기록이 있는 학생 209명 중 **70명이 작성 강사 2명 이상**). 그러면 강사가 갈리는 자리에서
 * 진도가 훌쩍 뛴 것처럼 보여 경고가 뜨는데, 정작 **아무도 틀리지 않았다** — 끌 수 없는 경고가 쌓이면
 * 결국 통째로 무시된다(0151a '이상 없음' 버튼을 만든 것과 같은 이유).
 *
 * ## 규칙(🔴 방향을 뒤집지 말 것)
 * "직전이 다른 강사면 억제"가 **아니라** "같은 강사의 직전 진도와 비교해 20 이상일 때만 경고"다.
 * 전자면 그 강사가 이 학생에게 **처음** 쓰는 자리에서 비교 대상이 없는데도 경고가 남는다
 * (실측 최다은 8/4 = 직전 218이 김은정, 이번 245가 김윤하 — 원장이 말한 바로 그 경우).
 *
 * ## 축은 이름(문자열)뿐이다
 * `lesson_reports`에는 teacher_id·created_by 기반의 "작성 강사" 축이 없다(`created_by`는 계정 소유이고
 * 대리 작성이 흔하다, [[#93]]). 표시·발송이 쓰는 `teacher_name`이 유일한 작성자 축이라 그것으로 비교한다.
 * 비교 전에 공백을 접고(앞뒤·연속) 대소문자를 내린다 — 한쪽이 비어 있으면 "같은 강사"로 보지 않는다.
 */
import { JUMP_ERROR_THRESHOLD } from "./progress-detector";

/**
 * 강사 이름 비교용 정규화 — 앞뒤 공백 제거 + 내부 연속 공백 1칸 + 소문자.
 * 빈 문자열(공백뿐 포함)은 **null**(= 이름 없음)로 돌린다. 이름이 없으면 비교 자체가 성립하지 않는다.
 * ⚠️ 소문자화는 영문 표기 흔들림("Florence Park" ↔ "florence park")을 같은 사람으로 보기 위한 것이고,
 *    한글 이름엔 아무 영향이 없다.
 */
export function normalizeTeacherName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const collapsed = name.replace(/\s+/g, " ").trim().toLowerCase();
  return collapsed === "" ? null : collapsed;
}

/** 두 이름이 같은 강사인가 — 한쪽이라도 비어 있으면 false(모르면 "같다"고 하지 않는다). */
export function isSameTeacher(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeTeacherName(a);
  const nb = normalizeTeacherName(b);
  return na !== null && nb !== null && na === nb;
}

export type JumpWarningInput = {
  /** 이 보고서 작성자와 **같은 강사**가 이 학생·같은 track에 쓴 직전 엔트리 위치. 없으면 null. */
  sameTeacherLastPosition: number | null;
  /** 이번 보고서 위치. */
  newPosition: number;
};

/**
 * 같은 선생님 자기 줄 안에서 난 점프인가 — **경고를 낼지 정하는 유일한 기준**.
 * null(비교 불가) → false. 그 강사의 첫 진도이거나 강사가 갈린 자리라 "이상"이라고 부를 근거가 없다.
 */
export function jumpWarningApplies({ sameTeacherLastPosition, newPosition }: JumpWarningInput): boolean {
  if (sameTeacherLastPosition === null) return false;
  return newPosition - sameTeacherLastPosition >= JUMP_ERROR_THRESHOLD;
}

/**
 * 억제 표식 — `progress_events.details.suppressed`에 남기는 사유 키(코드 고정).
 * ⚠️ 화면엔 이 raw 키가 아니라 아래 한글 라벨을 낸다.
 */
export const JUMP_SUPPRESSED_OTHER_TEACHER = "other_teacher";

/** 억제 이벤트의 details 모양 — 나중에 "왜 조용했나"를 역검수할 수 있게 근거를 함께 남긴다. */
export type JumpSuppressionDetails = {
  suppressed: typeof JUMP_SUPPRESSED_OTHER_TEACHER;
  teacherName: string | null;
  sameTeacherLastPosition: number | null;
};

export function buildJumpSuppressionDetails(input: {
  teacherName: string | null;
  sameTeacherLastPosition: number | null;
}): JumpSuppressionDetails {
  return {
    suppressed: JUMP_SUPPRESSED_OTHER_TEACHER,
    teacherName: input.teacherName,
    sameTeacherLastPosition: input.sameTeacherLastPosition,
  };
}

/**
 * 자동 확인(억제)된 기록의 화면 라벨 — 사람이 누른 '이상 없음'과 구분해서 보여주기 위한 것.
 * 알 수 없는 details면 null(모르는 걸 지어내지 않는다 · raw 키는 화면에 안 낸다).
 */
export function jumpSuppressionLabel(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const reason = (details as { suppressed?: unknown }).suppressed;
  if (reason === JUMP_SUPPRESSED_OTHER_TEACHER) return "같은 선생님 진도 기준 자동 확인";
  return null;
}
