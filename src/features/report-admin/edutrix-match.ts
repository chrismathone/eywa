/**
 * Edutrix → eywa 학생 매칭 (순수).
 * 정석 키 = Edutrix students.id ↔ students.edutrix_student_id.
 * 이름 매칭은 **백필 1회**에만 쓰고, 런타임 이관(cron/import)은 UUID만.
 */

export type EywaStudentLite = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  edutrixStudentId?: string | null;
};

export type EdutrixStudentLite = {
  id: string;
  name: string;
  school?: string | null;
  grade?: string | null;
};

export type MapPick =
  | { kind: "mapped"; eywaId: string; reason: string }
  | { kind: "none"; reason: string }
  | { kind: "ambiguous"; reason: string; candidateIds: string[] };

function normName(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function schoolGradeKey(school: string | null | undefined, grade: string | null | undefined): string {
  return `${(school ?? "").trim()}|${(grade ?? "").trim()}`;
}

/**
 * 백필용: Edutrix 학생 1명 → eywa 후보 중 1명 고르기.
 * - 후보 0 → none
 * - 후보 1 → mapped
 * - 학교+학년 일치 1명 → mapped
 * - 재원(enrolled/on_hold) 1명 → mapped
 * - 그 외 → ambiguous (절대 자동 매핑 금지 — fan-out 방지)
 */
export function pickEywaForEdutrixStudent(
  edu: EdutrixStudentLite,
  candidates: EywaStudentLite[],
): MapPick {
  if (candidates.length === 0) return { kind: "none", reason: "no_name_match" };
  if (candidates.length === 1) {
    return { kind: "mapped", eywaId: candidates[0]!.id, reason: "unique_name" };
  }

  const sg = schoolGradeKey(edu.school, edu.grade);
  if (sg !== "|") {
    const bySg = candidates.filter((c) => schoolGradeKey(c.school, c.grade) === sg);
    if (bySg.length === 1) {
      return { kind: "mapped", eywaId: bySg[0]!.id, reason: "school_grade" };
    }
    if (bySg.length > 1) {
      const active = bySg.filter((c) => c.status === "enrolled" || c.status === "on_hold");
      if (active.length === 1) {
        return { kind: "mapped", eywaId: active[0]!.id, reason: "school_grade_enrolled" };
      }
      return {
        kind: "ambiguous",
        reason: "school_grade_multi",
        candidateIds: bySg.map((c) => c.id),
      };
    }
  }

  const active = candidates.filter((c) => c.status === "enrolled" || c.status === "on_hold");
  if (active.length === 1) {
    return { kind: "mapped", eywaId: active[0]!.id, reason: "enrolled_only" };
  }

  return {
    kind: "ambiguous",
    reason: "multi_name",
    candidateIds: candidates.map((c) => c.id),
  };
}

/** 이름 exact 후보 목록 만들기(백필). */
export function candidatesByExactName(
  eduName: string,
  eywa: EywaStudentLite[],
): EywaStudentLite[] {
  return eywa.filter((s) => s.name === eduName);
}

/** exact 실패 시 정규화 이름 후보(공백 무시). exact와 동시 쓰지 말 것. */
export function candidatesByNormName(
  eduName: string,
  eywa: EywaStudentLite[],
): EywaStudentLite[] {
  const n = normName(eduName);
  return eywa.filter((s) => normName(s.name) === n);
}

/**
 * 런타임 이관: edutrix student UUID → eywa student id.
 * 맵에 없으면 null (이름 폴백 없음 — 오배정 금지).
 */
export function resolveEywaIdByEdutrixId(
  edutrixStudentId: string,
  byEdutrixId: Map<string, string>,
): string | null {
  return byEdutrixId.get(edutrixStudentId) ?? null;
}

/**
 * Edutrix 미매핑 목록용 — 테스트 학생 휴리스틱(순수). **이름 패턴만** 본다(학원일·학원1·테스트·demo).
 * ⚠️ "학교+학년 플레이스홀더(미입력/미정)" 규칙은 폐기(2026-07-10) — Edutrix 프로필을 안 채운
 * **실학생**(보고서 수십 건 + eywa 동명 후보 존재)까지 더미로 숨겨 실매핑 대상이 과소집계됐다.
 */
export function isEdutrixDummyStudent(opts: {
  name: string;
  school?: string | null;
  grade?: string | null;
}): boolean {
  const name = (opts.name ?? "").trim();
  if (!name) return true;
  // 학원일/학원이/학원1/학원A, 테스트*, demo*
  if (/^학원[일이삼사오육칠팔구십\dA-Za-z]+$/.test(name)) return true;
  if (/^(테스트|test|demo)/i.test(name)) return true;
  return false;
}
