import "server-only";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import { sheetDowLabel } from "@/features/teacher-view/i18n";
import type { PillColor } from "@/components/atoms/pill";
import type { ExploreAnalysis, ExploreAnalysisBlock } from "../model";

/**
 * 수업·강사 중심의 '분석·판단'(원장 2026-11-05 시안의 오른쪽 아래 칸) — AI가 아니라 **기록 기반 규칙 판정**이다(페이지 로드로 AI를 부르지 않는다).
 * 숫자는 그 중심의 조각과 같은 조회 결과에서 센다(수업 출결 = getClassAttendanceStats 30일 · 명단 = getClassStudents).
 * 🔴 '다음 제안'은 사실에 매달린 정해진 문장만(지어내지 않는다) — 사실이 없으면 비운다.
 */

type Stat = { rate: number; total: number; present: number; late: number; absent: number; excused: number };
type AttRec = { student_id: string; status: string; student: { name?: string } | { name?: string }[] | null };

const nameOf = (r: AttRec) => (Array.isArray(r.student) ? r.student[0]?.name : r.student?.name) ?? "이름 확인 필요";

export function attendanceBadge(rate: number, total: number): { label: string; color: PillColor } | null {
  if (total === 0) return null;
  return rate >= 90 ? { label: "안정", color: "green" } : rate >= 80 ? { label: "주의", color: "amber" } : { label: "경고", color: "danger" };
}

/** 이름별 횟수 — "김민준 2회 · 이서아 1회"(많은 순 · 같으면 이름 순). */
function countNames(recs: readonly AttRec[], status: string, min = 1): string[] {
  const by = new Map<string, number>();
  for (const r of recs) if (r.status === status) by.set(nameOf(r), (by.get(nameOf(r)) ?? 0) + 1);
  return [...by.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).map(([n, c]) => `${n} ${c}회`);
}

export function classRuleAnalysis(input: {
  today: string;
  stats: Stat | null;
  /** 같은 30일 창의 출결(정정 접은 것). 못 읽었으면 null. */
  recs: readonly AttRec[] | null;
  roster: { count: number; upcoming: number; onHold: number; groups: string[] } | null;
}): ExploreAnalysis {
  const blocks: ExploreAnalysisBlock[] = [];
  const s = input.stats;
  if (s) {
    const absent = input.recs ? countNames(input.recs, "absent") : [];
    const late = input.recs ? countNames(input.recs, "late", 2) : [];
    blocks.push({
      id: "rule:attendance",
      kind: "rule",
      title: "출결",
      badge: attendanceBadge(s.rate, s.total),
      headline: s.total > 0 ? `최근 30일 출석률 ${s.rate.toFixed(0)}% · 기록 ${s.total}건 중 ${attendedCount(s)}회 출석` : null,
      change: null,
      watch: [absent.length ? `결석 ${absent.slice(0, 4).join(" · ")}${absent.length > 4 ? ` 외 ${absent.length - 4}명` : ""}` : null, late.length ? `지각 2회 이상 ${late.slice(0, 3).join(" · ")}` : null].filter((x): x is string => !!x),
      next: [absent.length ? "결석 원생의 보강 예약 확인" : null, late.length ? "지각이 잦은 원생의 등원 시간 확인" : null].filter((x): x is string => !!x),
      basis: `규칙 · 출석부 최근 30일 · 출석률 = (출석+지각) ÷ 기록 · 기준일 ${input.today}`,
      empty: s.total === 0 ? "최근 30일 출결 기록이 없습니다." : null,
      related: ["attendance", "students"],
    });
  }
  const r = input.roster;
  if (r) {
    blocks.push({
      id: "rule:roster",
      kind: "rule",
      title: "구성",
      badge: null,
      headline: `오늘 명단 ${r.count}명${r.upcoming ? ` · 배정 예정 ${r.upcoming}명` : ""}${r.onHold ? ` · 휴원 ${r.onHold}명` : ""}`,
      change: null,
      watch: r.groups.length ? [r.groups.slice(0, 4).join(" · ")] : [],
      next: [],
      basis: `규칙 · 수강 명단 · 기준일 ${input.today}`,
      empty: null,
      related: ["students"],
    });
  }
  if (blocks.length === 0) return { state: "error", blocks: [], canRefresh: false, note: "출결·명단을 조회하지 못해 판정할 수 없습니다." };
  return { state: "ready", blocks, canRefresh: false };
}

export function teacherRuleAnalysis(input: {
  today: string;
  classes: { id: string; name: string }[];
  /** 담당 원생 수(반을 여럿 듣는 원생은 한 번 — 도넛 '담당 원생' 조각과 같은 수). 명단을 못 읽었으면 null. */
  students: number | null;
  /** 반별 최근 30일 출결 합계(정정 접은 것). 못 읽었으면 null. */
  attendance: Map<string, { total: number; present: number; late: number }> | null;
  /** 이번 달 이 선생님이 상담한 담당 원생 수 / 담당 원생 수. 못 읽었으면 null. */
  consult: { met: number; of: number } | null;
  reports7: number | null;
}): ExploreAnalysis {
  const blocks: ExploreAnalysisBlock[] = [];
  const rates = input.attendance
    ? input.classes
        .map((c) => {
          const a = input.attendance!.get(c.id);
          return a && a.total > 0 ? { name: c.name, rate: attendanceRate(attendedCount(a), a.total) } : null;
        })
        .filter((x): x is { name: string; rate: number } => !!x)
        .sort((a, b) => a.rate - b.rate)
    : [];
  const low = rates[0] ?? null;
  blocks.push({
    id: "rule:classes",
    kind: "rule",
    title: "담당 반",
    badge: low ? attendanceBadge(low.rate, 1) : null,
    headline: `담당 반 ${input.classes.length}개${input.students !== null ? ` · 담당 원생 ${input.students}명` : ""}${input.reports7 !== null ? ` · 최근 7일 보고서 ${input.reports7}건` : ""}`,
    change: null,
    watch: low ? [`출석률 가장 낮은 반 ${low.name} ${low.rate.toFixed(0)}%(최근 30일)`] : [],
    next: low && low.rate < 90 ? [`${low.name} 결석 원생 확인`] : [],
    basis: `규칙 · 출석부 최근 30일 · 반별 (출석+지각) ÷ 기록 · 기준일 ${input.today}`,
    empty: null,
    related: ["classes", "timetable", "students"],
  });
  if (input.consult) {
    const { met, of } = input.consult;
    blocks.push({
      id: "rule:consult",
      kind: "rule",
      title: "담당 원생 상담",
      // 배지 없음 — 달 초엔 누구나 낮게 나와 '주의'가 거짓 경보가 된다(평가 지표는 강사평가 화면의 몫).
      badge: null,
      headline: `이번 달 이 선생님이 상담한 담당 원생 ${met}명 / ${of}명`,
      change: null,
      watch: of - met > 0 ? [`이번 달 상담 기록 없음 ${of - met}명`] : [],
      next: [],
      basis: `규칙 · 원생상담(이 선생님이 상담자) · 이번 달 1일부터 · 기준일 ${input.today}`,
      empty: null,
      related: ["students"],
    });
  }
  return { state: "ready", blocks, canRefresh: false };
}

const ROOM_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
const dayKo = (d: string) => sheetDowLabel(d, "ko");

/**
 * 강의실 중심의 '분석·판단'(시안 :3978 roomCenter의 '사용' · '좌석 여유') — 규칙 판정. 숫자는 위 조각과 같은 조회(지금 배치 · 반별 오늘 명단).
 * 겹침 = 같은 요일에 시간이 겹치는 서로 다른 반의 배치(합반·따로 수업일 수 있어 '확인'만 권한다 — 오류로 단정하지 않는다).
 */
export function roomRuleAnalysis(input: {
  today: string;
  capacity: number | null;
  /** 주 N회 — 반마다 이어진 교시를 한 번으로 센 합(수업·강사 중심과 같은 셈). */
  weekly: number;
  slots: { day: string; start: string; end: string; className: string }[];
  /** 반별 오늘 명단 — 못 읽었으면 roster null. */
  classes: { name: string; roster: number | null }[];
}): ExploreAnalysis {
  const { slots, classes, capacity, today } = input;
  const used = new Set(slots.map((s) => s.day));
  const freeDays = ROOM_DAYS.filter((d) => !used.has(d)).map(dayKo);
  const overlaps: string[] = [];
  const seen = new Set<string>();
  for (const a of slots)
    for (const b of slots) {
      if (a === b || a.day !== b.day || a.className === b.className || !(a.start < b.end && b.start < a.end)) continue;
      const pair = [a.className, b.className].sort((x, y) => x.localeCompare(y, "ko"));
      const key = `${a.day}|${pair.join("|")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      overlaps.push(`${dayKo(a.day)} ${a.start < b.start ? a.start : b.start} ${pair.join("·")}`);
    }
  const usage: ExploreAnalysisBlock = {
    id: "rule:room-usage",
    kind: "rule",
    title: "사용",
    badge: overlaps.length > 0 ? { label: "겹침", color: "amber" } : null,
    headline: slots.length > 0 ? `주 ${input.weekly}회 사용 · 수업 ${classes.length}개` : null,
    change: null,
    watch: [freeDays.length > 0 ? `빈 요일 ${freeDays.join("·")}` : "빈 요일 없음(월~토)", ...overlaps.slice(0, 3).map((o) => `같은 시간 배치 ${o}`)],
    next: overlaps.length > 0 ? ["겹치는 배치가 합반·따로 수업인지 시간표에서 확인"] : [],
    basis: `규칙 · 시간표 지금 배치 · 기준일 ${today}`,
    empty: slots.length === 0 ? "지금 이 강의실에 배치된 수업이 없습니다." : null,
    related: ["timetable", "classes"],
  };
  const known = classes.filter((c): c is { name: string; roster: number } => c.roster !== null);
  const max = [...known].sort((a, b) => b.roster - a.roster)[0] ?? null;
  const complete = known.length === classes.length;
  const over = capacity ? known.filter((c) => c.roster > capacity) : [];
  const seats: ExploreAnalysisBlock = {
    id: "rule:room-seats",
    kind: "rule",
    title: "좌석 여유",
    badge: capacity && max && complete ? (max.roster > capacity ? { label: "정원 초과", color: "danger" } : max.roster === capacity ? { label: "만석", color: "amber" } : { label: "안정", color: "green" }) : null,
    headline: capacity && max && complete ? `정원 ${capacity}석 · 가장 큰 반 ${max.name} ${max.roster}명 · 여유 ${capacity - max.roster}석` : null,
    change: null,
    watch: over.map((c) => `정원 초과 ${c.name} ${c.roster}명`),
    next: over.length > 0 ? ["정원을 넘는 반의 강의실 배정 확인"] : [],
    basis: `규칙 · 강의실 정원 · 반별 오늘 명단 · 기준일 ${today}`,
    empty: !capacity ? "정원이 입력되지 않아 판정할 수 없습니다." : known.length < classes.length ? "명단을 조회하지 못해 판정할 수 없습니다." : !max ? "배치된 수업이 없습니다." : null,
    related: ["info", "classes"],
  };
  return { state: "ready", blocks: [usage, seats], canRefresh: false };
}
