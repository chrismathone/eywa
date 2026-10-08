/**
 * aywa 학생 → 인재원 `/ext/eywa/students/profile` 한 줄(순수, Vitest). 보내는 쪽은 `server/profile-push.ts`.
 * 🔑 값은 고르지 않고 aywa 원본 그대로 — 빈 문자열은 null(설명서: null·빈 글자 = 그 칸 지움, 같은 뜻을 한 모양으로).
 * 짝(`ijw_student_id`)이 없으면 null(보내지 않는다). 생년월일은 `YYYY-MM-DD`만(모양이 아니면 null).
 */
export type IjwProfileRow = {
  ijw_student_id: string | null;
  school: string | null;
  grade: string | null;
  birth_date: string | null;
};

export type IjwProfilePayload = { ijwId: string; school: string | null; grade: string | null; birthDate: string | null };

export function profilePayloadOf(r: IjwProfileRow): IjwProfilePayload | null {
  const ijwId = (r.ijw_student_id ?? "").trim();
  if (!ijwId) return null;
  const clean = (v: string | null) => (v ?? "").trim() || null;
  const birth = clean(r.birth_date);
  return {
    ijwId,
    school: clean(r.school),
    grade: clean(r.grade),
    birthDate: birth && /^\d{4}-\d{2}-\d{2}/.test(birth) ? birth.slice(0, 10) : null,
  };
}
