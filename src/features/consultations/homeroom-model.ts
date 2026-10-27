/**
 * 원생상담 통계의 **담임별 상담 현황**(원장 2026-10-27 *"상담 강사 별로 해당 어떤 학생이 안됐는지 됐는지 월별 등등 여러가지 정보"*
 * + *"부담임은 상담에 포함할 필요가 없음 담임으로만 계산"* + *"퇴사자 제외"*) — 모양과 순수 계산(서버·클라 공용, [[#61]]·Vitest).
 *
 * 🔑 담임 = `classes.teacher_id`(교시 담당·부담임 슬롯은 안 센다) · 특강 반·JJ(복습) 반 제외(`isHomeroomConsultClass`).
 * 🔑 칸 판정 — 그 달에 **담임 본인**이 상담했으면 `self`, 담임이 아닌 직원만 했으면 `other`(과목이 다른 담임의 상담이 이 담임 몫을
 *    채운 것처럼 읽히면 안 된다), 아무도 안 했으면 `none`, 그 반에 들어오기 전 달이면 `before`(분모 밖).
 */

export type HomeroomCell = "self" | "other" | "none" | "before";

/**
 * 담임 상담 대상 반인가 — 특강(방학 단기강좌)과 **JJ 반**은 뺀다(원장 2026-10-27 *"jj도 상담에 포함되지 않음"*).
 * JJ = 수학 복습(`classes.math_learning_track='supplement'`) 반이다 — 실측 2026-10-27: JJ 반 학생 111명 **전원**이 같은 과목
 * 정규 반에도 있다(상담은 정규 반 담임 몫). 판정은 컬럼이 먼저고, 컬럼이 아직 'regular'로 남은 JJ 반 3개(JJ3A·JJ2L·JJ1K)
 * 때문에 이름의 `JJ`를 폴백으로 함께 본다(`isSpecialLecture`와 같은 모양).
 */
export function isHomeroomConsultClass(c: { isSpecial: boolean | null; className: string; learningTrack: string | null }): boolean {
  if (c.isSpecial === true || c.className.includes("특강")) return false;
  return c.learningTrack !== "supplement" && !c.className.includes("JJ");
}

export type HomeroomStudent = {
  id: string;
  name: string;
  grade: string | null;
  cells: HomeroomCell[];
  /** 달별 담임 본인 상담 건수(같은 날 여러 건도 그대로). */
  selfCounts: number[];
  /** 창 안에서 담임 본인이 마지막으로 상담한 날(KST, 없으면 null). */
  lastSelf: string | null;
  /** 달별 담임이 아닌 상담자 이름(마우스 오버 — "누가 했는가"). */
  otherNames: string[][];
};

export type HomeroomMonth = { target: number; self: number; other: number; none: number };

export type HomeroomTeacher = {
  id: string;
  name: string;
  /** 담임 반 과목 키(학원설정 라벨은 화면이 붙인다). */
  subjects: string[];
  classNames: string[];
  students: HomeroomStudent[];
  months: HomeroomMonth[];
};

export type HomeroomStats = {
  today: string;
  /** `YYYY-MM` 오래된 달 → 이번 달. */
  months: string[];
  teachers: HomeroomTeacher[];
  /** 퇴사한 담임이 아직 맡고 있는 반 — 현황에서 빠진 사실을 밝힌다. */
  retired: { teachers: number; classes: number; students: number };
};

/** 오늘이 든 달부터 거꾸로 n달(`YYYY-MM`, 오래된 순). */
export function recentMonths(today: string, n: number): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export type HomeroomInput = {
  today: string;
  months: string[];
  /** 담임 반(이미 거른 것 — 활성·특강 아님·재직 담임). */
  classes: { id: string; name: string; subject: string | null; teacherId: string }[];
  /** 담임·상담자 이름(id → 이름). */
  staffNames: Map<string, string>;
  /** 오늘 살아 있는 수강(그 반의 학생). startDate null = 시작일 모름(처음부터 있던 것으로 본다). */
  enrollments: { studentId: string; classId: string; startDate: string | null }[];
  /** 재원생(테스트 제외)만. 여기 없는 학생은 버린다. */
  students: Map<string, { name: string; grade: string | null }>;
  /** 창 안 상담(KST 날짜). */
  consults: { studentId: string; counselorId: string | null; date: string }[];
};

const CELL_ORDER: Record<HomeroomCell, number> = { none: 0, other: 1, self: 2, before: 3 };

export function buildHomeroomTeachers(input: HomeroomInput): HomeroomTeacher[] {
  const { months } = input;
  const classById = new Map(input.classes.map((c) => [c.id, c]));
  // 담임 → 학생 → 그 담임 반에 들어온 가장 이른 날.
  const roster = new Map<string, Map<string, string | null>>();
  const classNames = new Map<string, Set<string>>();
  const subjects = new Map<string, Set<string>>();
  for (const e of input.enrollments) {
    const cls = classById.get(e.classId);
    if (!cls || !input.students.has(e.studentId)) continue;
    const per = roster.get(cls.teacherId) ?? new Map<string, string | null>();
    roster.set(cls.teacherId, per);
    const prev = per.get(e.studentId);
    // null(시작일 모름)이 이긴다 — 모르면 처음부터 있던 것으로 본다(분모에서 빼면 미상담이 숨는다).
    per.set(e.studentId, prev === undefined ? e.startDate : prev === null || e.startDate === null ? null : prev < e.startDate ? prev : e.startDate);
    const names = classNames.get(cls.teacherId) ?? new Set<string>();
    names.add(cls.name);
    classNames.set(cls.teacherId, names);
    if (cls.subject) subjects.set(cls.teacherId, (subjects.get(cls.teacherId) ?? new Set<string>()).add(cls.subject));
  }
  // 학생 → 달 → { 상담한 직원들, 직원별 건수, 직원별 마지막 날 }
  const byStudent = new Map<string, Map<string, Map<string | null, number>>>();
  const lastBy = new Map<string, string>();
  for (const c of input.consults) {
    const month = c.date.slice(0, 7);
    const per = byStudent.get(c.studentId) ?? new Map<string, Map<string | null, number>>();
    byStudent.set(c.studentId, per);
    const who = per.get(month) ?? new Map<string | null, number>();
    per.set(month, who);
    who.set(c.counselorId, (who.get(c.counselorId) ?? 0) + 1);
    const key = `${c.studentId}|${c.counselorId}`;
    if (!lastBy.has(key) || lastBy.get(key)! < c.date) lastBy.set(key, c.date);
  }

  const teachers: HomeroomTeacher[] = [];
  for (const [teacherId, per] of roster) {
    const students: HomeroomStudent[] = [];
    for (const [studentId, start] of per) {
      const s = input.students.get(studentId)!;
      const startMonth = start ? start.slice(0, 7) : null;
      const cells: HomeroomCell[] = [];
      const selfCounts: number[] = [];
      const otherNames: string[][] = [];
      for (const m of months) {
        const who = byStudent.get(studentId)?.get(m);
        const mine = who?.get(teacherId) ?? 0;
        selfCounts.push(mine);
        otherNames.push(
          [...(who?.keys() ?? [])]
            .filter((id) => id !== teacherId)
            .map((id) => (id ? (input.staffNames.get(id) ?? "이름 없는 직원") : "상담자 없음"))
            .sort((a, b) => a.localeCompare(b, "ko")),
        );
        if (startMonth && startMonth > m) cells.push("before");
        else if (mine > 0) cells.push("self");
        else if (who && who.size > 0) cells.push("other");
        else cells.push("none");
      }
      students.push({ id: studentId, name: s.name, grade: s.grade, cells, selfCounts, otherNames, lastSelf: lastBy.get(`${studentId}|${teacherId}`) ?? null });
    }
    if (students.length === 0) continue;
    const last = months.length - 1;
    // 이번 달 미상담이 맨 위 — 할 일이 먼저 보인다.
    students.sort((a, b) => CELL_ORDER[a.cells[last]!] - CELL_ORDER[b.cells[last]!] || a.name.localeCompare(b.name, "ko"));
    const monthsAgg = months.map((_, i) => {
      const agg: HomeroomMonth = { target: 0, self: 0, other: 0, none: 0 };
      for (const st of students) {
        const cell = st.cells[i]!;
        if (cell === "before") continue;
        agg.target++;
        agg[cell]++;
      }
      return agg;
    });
    teachers.push({
      id: teacherId,
      name: input.staffNames.get(teacherId) ?? "이름 없는 직원",
      subjects: [...(subjects.get(teacherId) ?? [])].sort(),
      classNames: [...(classNames.get(teacherId) ?? [])].sort((a, b) => a.localeCompare(b, "ko")),
      students,
      months: monthsAgg,
    });
  }
  return teachers.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 칸의 뜻 → 의미색 tone·글자(이 축의 단일 소스 — 화면 파일에 맵을 따로 두지 않는다). */
export const HOMEROOM_CELL_META: Record<HomeroomCell, { tone: "positive" | "info" | "critical" | "inert"; mark: string; label: string }> = {
  self: { tone: "positive", mark: "●", label: "담임 상담" },
  // 원장 2026-10-27 *"다른 직원만 상담이 뭔말이여"* — 그 달에 상담은 있었는데 담임이 아니라 다른 선생님·데스크가 했다는 뜻.
  other: { tone: "info", mark: "◐", label: "담임 아닌 직원이 상담" },
  none: { tone: "critical", mark: "○", label: "미상담" },
  before: { tone: "inert", mark: "—", label: "반 들어오기 전" },
};
