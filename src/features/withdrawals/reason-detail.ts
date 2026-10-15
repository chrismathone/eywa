// Pure constants + helpers — safe to import from both server and client.
/**
 * 퇴원·수강 종료 **세부 사유**(2단계) — 대분류(`WithdrawalReason`) 아래에 고르는 칸(원장 2026-10-15 *"퇴원사유를 50가지 정도로
 * 세분화"* → 고른 시안: 대분류 14 · 세부 42 · 이사·졸업·기타는 세부 없음 · 기타는 메모 필수).
 *
 * 🔑 세부 키는 **전역에서 하나**다(같은 '친구 따라'라도 타 학원 이동과 가족·친구는 다른 키) — 키만 보고 대분류를 안다.
 *    저장 = 퇴원 `students.withdrawal_metadata.detail` · 수강 종료 `enrollments.withdrawal_detail`(0367a).
 * 🔴 키는 한 번 저장되면 바꾸지 않는다(라벨만 고친다). 강사평가 '뺄 사유'는 **대분류**로 고른다 — 세부는 분석용이다.
 * ⚠️ 장부 정리(일괄 퇴원)는 고르는 목록 밖이다(시스템이 표시만 한다 — `isCleanupWithdrawal`).
 */
import { REASON_LABEL, WITHDRAWAL_REASONS, normalizeReason, type WithdrawalReason } from "./types";

export type ReasonDetail = { key: string; label: string };

/** 대분류 → 세부(순서 = 화면 순서). 빈 배열 = 세부를 고르지 않는 대분류. */
export const REASON_DETAILS: Record<WithdrawalReason, readonly ReasonDetail[]> = {
  dissatisfaction: [
    { key: "teacher_changes", label: "잦은 강사 변경" },
    { key: "teacher_reassigned", label: "담당 강사 변경" },
    { key: "teacher_left", label: "강사 퇴사" },
    { key: "teaching_style", label: "수업 방식 불만" },
    { key: "too_hard", label: "난이도 높음" },
    { key: "too_easy", label: "난이도 낮음" },
    { key: "pace", label: "진도 불만" },
    { key: "homework_load", label: "과제 부담" },
    { key: "care_lacking", label: "관리·피드백 부족" },
    { key: "class_grouping", label: "반 구성·반 이동 불만" },
  ],
  grades: [
    { key: "score_stalled", label: "성적 정체·하락" },
    { key: "school_grades", label: "내신 성적 불만" },
    { key: "exam_prep", label: "시험 대비 불만" },
  ],
  motivation: [
    { key: "low_motivation", label: "학습 의욕 저하" },
    { key: "struggling", label: "힘들어함" },
    { key: "wants_break", label: "휴식 희망" },
  ],
  method: [
    { key: "private_tutor", label: "과외" },
    { key: "self_study", label: "혼자 공부" },
    { key: "home_study", label: "집에서 관리" },
    { key: "online_lecture", label: "인강" },
    { key: "other_subject_focus", label: "다른 과목 집중" },
  ],
  competitor: [
    { key: "with_friends", label: "친구 따라" },
    { key: "closer_academy", label: "가까운 곳" },
    { key: "cheaper_academy", label: "수강료 저렴" },
    { key: "preferred_academy", label: "특정 학원 선호" },
  ],
  schedule: [
    { key: "school_schedule", label: "학교 일정" },
    { key: "other_academy_conflict", label: "다른 학원과 충돌" },
    { key: "distance_shuttle", label: "거리·차량" },
    { key: "travel_vacation", label: "여행·방학" },
  ],
  financial: [
    { key: "tuition_burden", label: "수강료 부담" },
    { key: "family_finances", label: "가정 형편" },
  ],
  career: [
    { key: "career_change", label: "진로 변경(예체능·운동)" },
    { key: "vocational_school", label: "특성화고 진학" },
    { key: "study_abroad", label: "유학" },
  ],
  peers: [
    { key: "with_sibling", label: "형제 따라" },
    { key: "friends_left", label: "친구 따라" },
    { key: "family_conflict", label: "가정 내 갈등" },
  ],
  illness: [
    { key: "physical", label: "신체 질환" },
    { key: "mental", label: "심리(우울 등)" },
  ],
  advised: [
    { key: "conduct", label: "생활 태도" },
    { key: "homework_neglect", label: "과제 미이행" },
    { key: "attendance_poor", label: "출결 불량" },
  ],
  relocation: [],
  graduated: [],
  other: [],
};

const DETAIL_INDEX = new Map<string, { reason: WithdrawalReason; label: string }>(
  (Object.entries(REASON_DETAILS) as [WithdrawalReason, readonly ReasonDetail[]][]).flatMap(([reason, list]) =>
    list.map((d) => [d.key, { reason, label: d.label }] as const),
  ),
);

/** 세부 키 → 라벨 · 대분류. 모르는 키는 null(옛 값·잘못된 값은 화면에 키를 내지 않는다). */
export function reasonDetailOf(key: string | null | undefined): { reason: WithdrawalReason; label: string } | null {
  return key ? (DETAIL_INDEX.get(key) ?? null) : null;
}

/**
 * 저장된 세부 키를 **그 대분류에 맞을 때만** 살린다 — 대분류를 바꾼 뒤 남은 옛 세부(다른 대분류의 키)가 새 대분류 아래 서지 않게.
 * 대분류는 원문(키·별칭)이어도 된다(`normalizeReason`).
 */
export function detailFor(reason: string | null | undefined, detail: string | null | undefined): string | null {
  const d = reasonDetailOf(detail);
  const r = reason ? normalizeReason(reason) : null;
  return d && r && d.reason === r ? detail! : null;
}

/** 메모를 꼭 적어야 하는 대분류 — '기타'는 메모가 곧 실제 사유다(원장 2026-10-15 시안 *"기타(메모 필수)"*). */
export function memoRequired(reason: WithdrawalReason): boolean {
  return reason === "other";
}

/**
 * 저장 직전 검사(서버 액션이 부른다 — 화면 조건은 게이트가 아니다, #77). 통과하면 `{ detail }`(빈 값 = null), 아니면 `{ error }`.
 * - 세부는 고르지 않아도 된다(선택) · 고른 값은 그 대분류의 세부여야 한다
 * - '기타'는 메모가 있어야 한다
 */
export function checkReasonInput(input: {
  reason: WithdrawalReason;
  detail: string | null | undefined;
  memo: string | null | undefined;
}): { detail: string | null; error?: undefined } | { error: string; detail?: undefined } {
  const raw = input.detail?.trim() || null;
  if (raw && reasonDetailOf(raw)?.reason !== input.reason) return { error: "세부 사유를 다시 골라 주세요." };
  if (memoRequired(input.reason) && !input.memo?.trim()) {
    return { error: `'${REASON_LABEL.other}'는 메모에 실제 사유를 적어 주세요.` };
  }
  return { detail: raw };
}

/**
 * 폼의 사유 칸 셋(`reason`·`detail`·`memo` — [`ReasonFields`](./reason-fields.tsx)) → 검사한 값. 사유를 받는 서버 액션은 모두 이것을
 * 부른다(원장 2026-10-15 *"기타는 모든 곳을 일치하게"*). 대분류를 안 골랐거나 모르는 값이면 `{ error }`.
 * `kind` = 오류 문구의 말(퇴원 사유 / 종료 사유).
 */
export function readReasonForm(
  formData: FormData,
  kind: "퇴원" | "종료" = "퇴원",
): { reason: WithdrawalReason; detail: string | null; memo: string | null; error?: undefined } | { error: string } {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!(WITHDRAWAL_REASONS as readonly string[]).includes(reason)) return { error: `${kind} 사유를 골라 주세요.` };
  const memo = String(formData.get("memo") ?? "").trim() || null;
  const checked = checkReasonInput({ reason: reason as WithdrawalReason, detail: String(formData.get("detail") ?? ""), memo });
  if (checked.error !== undefined) return { error: checked.error };
  return { reason: reason as WithdrawalReason, detail: checked.detail, memo };
}
