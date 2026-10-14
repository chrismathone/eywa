/**
 * 과목 관리자 — 스냅샷을 **담당 과목**으로 좁힌다(스냅샷 안에 과목이 실려 있는 영역만). 순수 함수 — 서버가 스냅샷을 만들 때 건다.
 *
 * 과목 판정은 운영실이 이미 쓰는 `subjectGroupOf`(영어 = EiE·인재원 영어, 수학 = 수학(심화) 포함)의 **묶음** 기준이라
 * 재원생 프로그램·학년 막대와 같은 말을 한다. 담당 과목이 여럿이면 묶음의 합집합이다.
 * 2026-10-14 2단계부터 출결 집계·상담·콜&상담·입테·보강·수납 등은 서버가 **과목별로 다시 센 값**(`slices.ts`)으로 갈아 끼운다 —
 * 그렇게 끼운 영역은 여기서 다시 좁히지 않는다(`skip`). 여기 남은 좁히기는 스냅샷 행에 과목이 이미 실린 영역과, 과목 값이
 * 없을 때(옛 스냅샷)의 폴백이다.
 */
import type { Area, OverviewData, Sections } from "@/features/dashboard/overview/model";
import type { Program } from "@/features/students/program";

export type GroupOf = (key: string | null | undefined) => string | null;

const programGroup = (program: Program | null): string | null => (program === "math" ? "math" : program ? "english" : null);

function narrowStudents(st: OverviewData["students"], groups: readonly string[], groupOf: GroupOf, keepAcademyWide: boolean): OverviewData["students"] {
  const has = (g: string) => groups.includes(g);
  const mine = (key: string | null | undefined) => {
    const g = groupOf(key);
    return g !== null && groups.includes(g);
  };
  const subjects = st.subjects.filter((r) => mine(r.label));
  const p = st.programs;
  const enOrMath = has("english") || has("math");
  const programs = {
    ...p,
    eie: has("english") ? p.eie : 0,
    injaewon: has("english") ? p.injaewon : 0,
    math: has("math") ? p.math : 0,
    // 동시 수강(영어+수학)은 영어·수학 담당에게만 의미가 있다.
    both: enOrMath ? p.both : 0,
    noEnrollment: 0,
    otherOnly: 0,
  };
  // 과목 조합은 학생마다 한 행에만 센다. 여러 과목·같은 묶음의 여러 트랙을 맡아도 중복 합산하지 않는다.
  // 수학 단독은 기존 프로그램 집계와 같은 축, 조합이 없는 옛 스냅샷만 과목 막대로 폴백한다.
  const enrolled = groups.length === 1 && has("math") ? p.math
    : st.subjectCombinations
      ? st.subjectCombinations.filter((c) => c.subjects.some(mine)).reduce((sum, c) => sum + c.value, 0)
      : subjects.reduce((sum, r) => sum + r.value, 0);
  const narrowed: OverviewData["students"] = {
    ...st,
    enrolled,
    concurrent: enOrMath ? st.concurrent : 0,
    subjects,
    subjectCombinations: (st.subjectCombinations ?? []).filter(
      (c) =>
        c.subjects.some(mine) &&
        c.subjects.every((k) => mine(k) || (enOrMath && (groupOf(k) === "english" || groupOf(k) === "math"))),
    ),
    programs,
  };
  // 학년·학교·수준 구성은 과목으로 못 나뉜다 — 그 칸이 배치에 있을 때만 학원 전체 값을 싣고, 없으면 비운다(안 쓰는 값을 내려보내지 않는다).
  // 그 칸은 '(학원 전체)'로 서므로 재원생 수·미수강도 학원 전체 값을 함께 싣는다 — 좁힌 `enrolled`를 쓰면 한 카드에 두 범위가 섞인다.
  if (keepAcademyWide) return { ...narrowed, academy: { enrolled: st.enrolled, noEnrollment: p.noEnrollment } };
  return { ...narrowed, levels: [], schools: [], schoolGroups: undefined, levelSplit: undefined, gradeSplit: { rows: [], neither: 0 } };
}

/** @param skip 이미 과목별로 다시 집계한 값(`slices.ts`)으로 갈아 끼운 영역 — 다시 좁히지 않는다. */
export function narrowBySubject(sections: Sections, groups: readonly string[], groupOf: GroupOf, keepAcademyWide: boolean, skip: ReadonlySet<Area> = new Set()): Sections {
  const out: Sections = { ...sections };
  const live = <K extends Area>(area: K) => (skip.has(area) ? undefined : sections[area]);
  // 과목을 모르는 행(빈 과목 · 설정에 없는 과목 — `groupOf`가 null)은 모든 과목 관리자에게 든다(원장 2026-10-14 결정 1 —
  // 과목별 값 `slicePredicate`와 같은 판정. 서버·미리보기는 `sliceGroupOf`를 넘긴다).
  // 담당 과목을 못 정했으면(groups 빔) 아무것도 통과시키지 않는다.
  const same = (key: string | null | undefined) => {
    if (!groups.length) return false;
    const g = groupOf(key);
    return g === null || groups.includes(g);
  };
  const st = live("students");
  if (st?.data) out.students = { ...st, data: narrowStudents(st.data, groups, groupOf, keepAcademyWide) };
  const schedule = live("schedule");
  const work = live("teacherWork");
  if (work?.data) out.teacherWork = { ...work, data: { ...work.data, rows: work.data.rows.filter((r) => same(r.subject)) } };
  if (schedule?.data) out.schedule = { ...schedule, data: schedule.data.filter((row) => same(row.subject)) };
  const first = live("firstClass");
  if (first?.data) {
    out.firstClass = {
      ...first,
      data: first.data.filter((r) => r.subjects.some(same)).map((r) => ({ ...r, subjects: r.subjects.filter(same) })),
    };
  }
  const absent = live("absent");
  if (absent?.data) {
    const mine = (a: { subject: string | null; classes: { subject: string | null }[] }) => same(a.subject) || a.classes.some((c) => same(c.subject));
    // 학생의 다른 과목 반(과목 이름·반 이름)은 빼고 담당 과목 반만 남긴다.
    // 🔴 상태(결석·공결)는 반별이 아니라 학생 한 벌이라 다른 과목 반을 뺐고 상태가 **둘 이상**이면 어느 상태가 남는지 모른다 —
    //    그때만 비운다(다른 과목의 '공결'이 담당 과목 결석에 붙어 보이지 않게). 상태가 하나면 모든 칸이 그 상태라 그대로 둔다.
    //    '전부 사전 통보'는 부분집합에도 참이라 그대로 둔다.
    const only = (a: (typeof absent.data.absent)[number]) => {
      const classes = a.classes.filter((c) => same(c.subject));
      const trimmed = classes.length < a.classes.length && a.statuses.length > 1;
      return { ...a, classes, subject: same(a.subject) ? a.subject : (classes[0]?.subject ?? null), ...(trimmed ? { statuses: [] } : {}) };
    };
    out.absent = {
      ...absent,
      data: { ...absent.data, absent: absent.data.absent.filter(mine).map(only), partial: absent.data.partial.filter(mine).map(only) },
    };
  }
  // 퇴원 명단 — 종료된 반의 과목(없으면 마지막 수강 반의 프로그램)으로 가른다. 둘 다 모르면 모든 과목 관리자에게(결정 1).
  const wd = live("withdrawals");
  if (wd?.data) {
    out.withdrawals = { ...wd, data: { ...wd.data, rows: wd.data.rows.filter((r) => r.subject ? same(r.subject) : r.program ? groups.includes(programGroup(r.program) ?? "") : same(null)) } };
  }
  // 강사 시트는 과목마다 하나뿐 — 담당 과목 것만 남긴다.
  if (!groups.includes("english")) delete out.englishSheet;
  if (!groups.includes("math")) delete out.mathSheet;
  return out;
}
