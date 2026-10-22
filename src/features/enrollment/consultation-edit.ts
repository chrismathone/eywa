/** 폼이 저장하는 칸만 비교한다. 파생 분석·녹음·학생 전환·시각은 제외. */
export const CONSULTATION_EDIT_FIELDS = [
  "prospect_name", "prospect_grade", "prospect_school", "english_name", "gender", "blood_type",
  "birth_date", "student_phone", "home_phone", "parent_name", "parent_phone", "parent_relation",
  "address", "zip_code", "address_detail", "consultation_path", "subject", "career_goal", "siblings",
  "safety_notes",
  "follow_up_date", "follow_up_content", "non_registration_reason", "parent_request",
  "shuttle_bus_request", "privacy_agreement", "installment_agreement", "subject_details", "counselor",
  "received_date", "student_type", "siblings_details", "consultation_date", "learning_history",
  "referrer_student_id", "referrer_staff_id", "referrer_name", "consultant_id",
] as const;

type Row = Record<string, unknown>;
export function normalizeEditValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(normalizeEditValue);
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, normalizeEditValue(v)] as const).filter(([, v]) => v !== null);
    return entries.length ? Object.fromEntries(entries) : null;
  }
  return value;
}
export function hasConsultationEdit(before: Row | null, patch: Row): boolean {
  if (!before) return false;
  return CONSULTATION_EDIT_FIELDS.some((key) => {
    if (!(key in patch)) return false;
    const pick = (v: unknown) => key === "learning_history"
      ? Object.fromEntries(["prevAcademy", "lastScore"].map((k) => [k, (v as Row | null)?.[k]])) : v;
    return JSON.stringify(normalizeEditValue(pick(before[key]))) !== JSON.stringify(normalizeEditValue(pick(patch[key])));
  });
}

/** QR는 공개 접수 시 두 표식을 함께 저장한다. 토큰 유효기간/삭제와 무관한 출처 표식을 쓴다. */
export function counselorAutofill(before: Row | null, patch: Row, name: string, promoted = false): string | null {
  if (!before?.from_public_intake || !name.trim()) return null;
  const afterCounselor = "counselor" in patch ? patch.counselor : before.counselor;
  if (normalizeEditValue(afterCounselor) !== null) return null;
  // 직접 비우기까지 포함해 상담자 칸을 고른 이번 저장은 존중한다.
  if ("counselor" in patch && normalizeEditValue(before.counselor) !== normalizeEditValue(patch.counselor)) return null;
  return promoted || hasConsultationEdit(before, patch) ? name.trim() : null;
}
