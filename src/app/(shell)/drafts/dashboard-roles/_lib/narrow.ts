/**
 * 과목 관리자 — 스냅샷을 **담당 과목 하나**로 좁힌다(스냅샷 안에 과목이 실려 있는 영역만).
 *
 * 과목 판정은 운영실이 이미 쓰는 `subjectGroupOf`(영어 = EiE·인재원 영어, 수학 = 수학(심화) 포함)의 **묶음** 기준이라
 * 재원생 프로그램·학년 막대와 같은 말을 한다. 과목이 안 실린 영역(출결 집계·상담·콜&상담·입테·보강 등)은 여기서
 * 좁히지 못하므로 호출부(`apply.ts`)가 아예 지운다 — 목록은 `UNNARROWABLE`(설계 메모·화면 설명이 같은 표를 읽는다).
 */
import type { OverviewData, Sections } from "@/features/dashboard/overview/model";
import type { Program } from "@/features/students/program";

type GroupOf = (key: string | null | undefined) => string | null;

const programGroup = (program: Program | null): string | null => (program === "math" ? "math" : program ? "english" : null);

function narrowStudents(st: OverviewData["students"], group: string | null, groupOf: GroupOf): OverviewData["students"] {
  const subjects = st.subjects.filter((r) => groupOf(r.label) === group);
  const p = st.programs;
  const enOrMath = group === "english" || group === "math";
  // 프로그램별 재원생(겹침 있음)에서 담당 묶음만 남긴다 — 영어 = EiE + 인재원 영어, 수학 = 수학 프로그램.
  const programs = {
    ...p,
    eie: group === "english" ? p.eie : 0,
    injaewon: group === "english" ? p.injaewon : 0,
    math: group === "math" ? p.math : 0,
    // 동시 수강(영어+수학)은 담당 과목 학생 중 다른 쪽도 듣는 사람이라 영어·수학 담당에겐 그대로 의미가 있다. 그 밖의 과목(국어 등)엔 0.
    both: enOrMath ? p.both : 0,
    noEnrollment: 0,
    otherOnly: 0,
  };
  // 재원생 수: 수학 = 수학 프로그램(학생 단위로 한 번씩), 그 밖 = 과목별 막대 합. 🔴 영어를 `eie + injaewon`으로 더하면 두 트랙을
  // 모두 듣는 학생이 두 번 세어진다 — 영어 과목 막대(`subjects`)는 학생 단위라 그쪽 값을 쓴다.
  const enrolled = group === "math" ? p.math : subjects.reduce((sum, r) => sum + r.value, 0);
  return {
    ...st,
    enrolled,
    concurrent: enOrMath ? st.concurrent : 0,
    subjects,
    // 담당 과목이 든 조합만 — 영어·수학 담당은 둘의 조합(동시 수강)까지, 그 밖의 과목 이름이 섞인 조합은 뺀다.
    subjectCombinations: (st.subjectCombinations ?? []).filter(
      (c) =>
        c.subjects.some((k) => groupOf(k) === group) &&
        c.subjects.every((k) => groupOf(k) === group || (enOrMath && (groupOf(k) === "english" || groupOf(k) === "math"))),
    ),
    programs,
    // 학년·학교·수준 구성은 과목으로 못 나눠 비운다(그 카드들은 과목 관리자 배치에 없다).
    levels: [],
    schools: [],
    schoolGroups: undefined,
    levelSplit: undefined,
    gradeSplit: { rows: [], neither: 0 },
  };
}

export function narrowBySubject(sections: Sections, group: string | null, groupOf: GroupOf): Sections {
  const out: Sections = { ...sections };
  // 담당 과목을 못 정했으면(group null) 아무것도 통과시키지 않는다 — null === null로 과목 없는 행이 새지 않게.
  const same = (key: string | null | undefined) => group !== null && groupOf(key) === group;
  const st = sections.students;
  if (st?.data) out.students = { ...st, data: narrowStudents(st.data, group, groupOf) };
  const schedule = sections.schedule;
  if (schedule?.data) out.schedule = { ...schedule, data: schedule.data.filter((row) => same(row.subject)) };
  const first = sections.firstClass;
  // 다른 과목 이름이 같이 실려 오지 않게 담당 과목만 남긴다.
  if (first?.data) {
    out.firstClass = {
      ...first,
      data: first.data.filter((r) => r.subjects.some(same)).map((r) => ({ ...r, subjects: r.subjects.filter(same) })),
    };
  }
  const absent = sections.absent;
  if (absent?.data) {
    const mine = (a: { subject: string | null; classes: { subject: string | null }[] }) =>
      same(a.subject) || a.classes.some((c) => same(c.subject));
    // 학생의 다른 과목 반(과목 이름·반 이름)은 빼고 담당 과목 반만 남긴다.
    // `subject` = 처음 기록된 결석 칸의 반 과목 — 다른 과목 반이 먼저였으면 담당 과목 반 것으로 바꿔 담는다.
    const only = (a: (typeof absent.data.absent)[number]) => {
      const classes = a.classes.filter((c) => same(c.subject));
      return { ...a, classes, subject: same(a.subject) ? a.subject : (classes[0]?.subject ?? null) };
    };
    out.absent = {
      ...absent,
      data: { ...absent.data, absent: absent.data.absent.filter(mine).map(only), partial: absent.data.partial.filter(mine).map(only) },
    };
  }
  // 퇴원 명단 — 마지막 수강 반의 프로그램으로 가른다. 영어·수학 밖 과목은 귀속을 못 가려 영역째 뺀다.
  const wd = sections.withdrawals;
  if (wd?.data) {
    if (group === "english" || group === "math") {
      out.withdrawals = { ...wd, data: { ...wd.data, rows: wd.data.rows.filter((r) => programGroup(r.program) === group) } };
    } else delete out.withdrawals;
  }
  // 강사 시트는 과목마다 하나뿐 — 담당 과목 것만 남긴다.
  if (group !== "english") delete out.englishSheet;
  if (group !== "math") delete out.mathSheet;
  return out;
}

/**
 * 과목으로 **좁혀지지 않는** 카드/칸 — 스냅샷에 과목이 안 실려 있다. 시안은 이 칸들을 과목 관리자에서 뺀다.
 * 실제로 켜려면 서버 조회에 과목 조건을 새로 붙여야 한다(설계 메모 3절).
 */
export const UNNARROWABLE: { label: string; why: string }[] = [
  { label: "재원생 구성 · 학년별 재원생 · 학교별 학생", why: "학년·학교 집계가 과목 구분 없이 한 표(과목별 수강 막대만 과목이 있다)" },
  { label: "출결 현황 · 최근 14일 등원율", why: "오늘 출결 도넛·14일 비율이 학원 전체 합계 한 벌" },
  { label: "반복 결석 학생", why: "학생 이름·결석 횟수만 — 과목이 안 실림(전일 결석 칸은 반 과목이 있어 좁혀짐)" },
  { label: "등록 · 퇴원 추이 · 재원생 추이", why: "월별 합계라 과목이 안 실림" },
  { label: "신규생 단계별 관리 · 신규생 체크 진행", why: "90일 체크 집계에 과목이 없다" },
  { label: "콜&상담 전환 · 상담 진행 · 레벨테스트 일정", why: "콜&상담 요약에 과목이 안 실림(일정은 제목 글자뿐)" },
  { label: "학습·학부모 보고 · 학생 상담", why: "숙제 위험·미확인·상담 건수가 합계 한 벌" },
  { label: "신규문의 · 금일 등록 · 보강예정 (KPI)", why: "접수·등록 명단에 과목이 없고, 보강 예약은 반 이름만 있다" },
  { label: "행정 · 자산", why: "과목과 무관한 건수" },
  { label: "퇴원생 KPI · 강사 시트 (영어·수학 밖 과목)", why: "국어·과학 등은 퇴원 프로그램 귀속과 강사 시트가 없어 켜도(③·④) 비어 있다" },
  { label: "이번 달 수납 현황", why: "청구서가 과목 구분 없이 합산(② 켜도 학원 전체 값)" },
];
