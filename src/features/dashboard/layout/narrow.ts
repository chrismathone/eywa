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
import type { Program } from "@/features/students/enrollment/program";
import { sortRecentAbsentStudents, withAbsences } from "@/features/dashboard/recent-absences";

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
  // 최근 결석 — 담당 과목 반의 결석만 남기고 **다시 센다**(횟수·연락 필요 · 정렬도 같은 규칙 — recent-absences.ts 한 벌).
  // 학생의 다른 과목 결석까지 세면 과목 관리자 화면의 누적 결석이 다른 과목 몫까지 커진다.
  const absent = live("absent");
  if (absent?.data) {
    const students = absent.data.students
      .map((st) => withAbsences(st, st.absences.filter((a) => same(a.subject))))
      .filter((st) => st.count > 0);
    out.absent = { ...absent, data: { ...absent.data, students: sortRecentAbsentStudents(students) } };
  }
  // 퇴원 명단 — 종료된 반의 과목(없으면 마지막 수강 반의 프로그램)으로 가른다. 둘 다 모르면 모든 과목 관리자에게(결정 1).
  const wd = live("withdrawals");
  if (wd?.data) {
    const mine = (r: { subject?: string | null; program: Program | null }) =>
      r.subject ? same(r.subject) : r.program ? groups.includes(programGroup(r.program) ?? "") : same(null);
    // '앞 달로 센' 줄(원장 2026-11-03)도 같은 규칙으로 — 영어 관리자 팝업에 수학 줄이 서지 않게.
    out.withdrawals = { ...wd, data: { ...wd.data, rows: wd.data.rows.filter(mine), ...(wd.data.carried ? { carried: wd.data.carried.filter(mine) } : {}) } };
  }
  // 등록 후 3개월 내 퇴원 — 퇴원 무렵 끝난 과목 중 하나라도 담당이면(두 과목이면 양쪽에). 과목을 모르면 모든 과목 관리자에게.
  const early = live("earlyExits");
  if (early?.data) {
    const mine = (r: { subjects: string[] }) => (r.subjects.length ? r.subjects.some(same) : same(null));
    out.earlyExits = { ...early, data: { ...early.data, rows: early.data.rows.filter(mine), history: early.data.history.filter(mine) } };
  }
  // 강사 시트는 과목마다 하나뿐 — 담당 과목 것만 남긴다.
  if (!groups.includes("english")) delete out.englishSheet;
  if (!groups.includes("math")) delete out.mathSheet;
  return out;
}
