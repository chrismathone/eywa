// 파싱된 주차 탭 → ECS DB 행. 순수(주입된 컨텍스트만 사용, IO 없음 — Vitest).
//
// 매핑 원칙(전부 "지어내지 않는다"):
//  · 교시 → `class_schedules`의 실제 슬롯 시각과 **정확히 일치할 때만** 붙인다. 못 붙이면 그 교시는 통째 skip(이슈).
//  · 영역 → 학원설정 skillAreas의 key. 없으면 null로 넣되 이슈로 보고(raw 라벨을 slug로 만들지 않는다).
//  · 학생 → 이름 확정 + **그 반 수강생**일 때만. 아니면 skip(이슈) — 학생·수강을 자동 생성하지 않는다.
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { shiftDays } from "@/features/timetable/lib/week";
import { normalizePeriodStart, type DowKey } from "../lib/week";
import { parseWeekTab } from "./parse-week-tab";
import { parseWeekTabTitle } from "./week-title";
import { addIssue, resolveSkillKey, type EcsImportIssue } from "./types";

const DAY_ORDER: readonly DowKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** 이슈 문구용 한글 요일 — 화면에 영문 키(raw code)를 내보내지 않는다. */
const DAY_KO: Readonly<Record<DowKey, string>> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

export type SlotRow = { day: DowKey; start: string; validFrom: string; validTo: string | null };

export type BuildContext = {
  year: number;
  className: string;
  skillAreas: readonly SkillAreaSetting[];
  slots: readonly SlotRow[];
  /** 정규화 이름(공백 제거) → 후보 학생. 테넌트 전체가 아니라 조회된 후보만. */
  studentsByName: ReadonlyMap<string, readonly { id: string; englishName: string | null }[]>;
  /** 그 반 수강생 id. */
  rosterIds: ReadonlySet<string>;
  /** 그 날짜에 실제 수강 중인가(등원요일·보류·퇴원 반영). */
  eligibleOn: (studentId: string, date: string) => boolean;
};

export type PlanRow = {
  planDate: string;
  slotStart: string;
  termMode: "regular" | "exam";
  /** 🔴 `class_sheet_plan_lines.skill_area`는 **not null**(0157a) — 못 정하면 행을 만들지 않는다. */
  skillArea: string;
  lineNo: number;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
};

export type GoalRow = {
  scope: "month" | "week";
  periodStart: string;
  role: "homeroom" | "assistant";
  skillArea: string;
  textbook: string | null;
  targetProgress: string | null;
};

export type MarkRow = {
  studentId: string;
  markDate: string;
  slotStart: string;
  status: string | null;
  progressNote: string | null;
};

export type BuiltWeek = {
  tab: string;
  monday: string | null;
  /** 건너뛴 사유(있으면 이 탭은 통째 미반영). */
  skipped: string | null;
  planRows: PlanRow[];
  goalRows: GoalRow[];
  markRows: MarkRow[];
};

const norm = (s: string): string => s.replace(/\s+/g, "");
const cut = (s: string | null, max: number): string | null => (s == null ? null : s.slice(0, max));

/** 이름 표기("류지훈(Jay)")에서 한글 이름과 영문명 분리. */
export function splitStudentLabel(label: string): { korean: string; english: string | null } {
  const m = /^(.+?)\s*\(([^)]*)\)\s*$/.exec(label.trim());
  if (!m) return { korean: norm(label), english: null };
  return { korean: norm(m[1]!), english: m[2]!.trim() || null };
}

/** 시트의 교시 시각 → 그 날짜에 유효한 class_schedules 슬롯. 정확 일치만(없으면 null). */
export function matchSlot(slots: readonly SlotRow[], day: DowKey, start24: string | null, date: string): string | null {
  if (!start24) return null;
  const hit = slots.find(
    (s) =>
      s.day === day &&
      s.start.slice(0, 5) === start24 &&
      s.validFrom <= date &&
      (s.validTo === null || s.validTo >= date),
  );
  return hit ? hit.start.slice(0, 5) : null;
}

/**
 * 하루치 교시 블록 → eywa 슬롯 시각 배정.
 *
 * ① **시각이 정확히 맞는 블록 먼저** 확정한다(이게 정상 경로).
 * ② 시각을 못 읽은 블록은 **앞뒤로 확정된 슬롯 사이에 남은 후보가 정확히 1개일 때만** 채운다.
 *    시트의 블록 순서는 곧 시간 순서라 이 범위 안에 후보가 하나뿐이면 다른 답이 없다.
 *    후보가 0개거나 2개 이상이면 **비워 둔다** — 애매한 걸 찍어서 남의 교시에 넣지 않는다.
 *    (근거: 강사가 `04:00~05:00`을 두 칸에 나눠 써 종료만 남은 교시가 실재한다 — parseTimeCell 주석.)
 */
export function assignDaySlots(
  blocks: readonly { slotKey: string; start24: string | null }[],
  daySlots: readonly string[],
): Map<string, string> {
  const sorted = [...new Set(daySlots)].sort();
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const b of blocks) {
    if (b.start24 && sorted.includes(b.start24) && !used.has(b.start24)) {
      out.set(b.slotKey, b.start24);
      used.add(b.start24);
    }
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (out.has(b.slotKey)) continue;
    // 🔴 **시각을 읽었는데 안 맞은** 블록은 채우지 않는다 — 그건 시트와 시간표가 진짜로 어긋난 것이라
    //    사람이 봐야 한다. 순서 보정은 **시각을 못 읽은**(쪼개진 칸) 블록에만 쓴다.
    if (b.start24) continue;
    let lo: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const s = out.get(blocks[j]!.slotKey);
      if (s) {
        lo = s;
        break;
      }
    }
    let hi: string | null = null;
    for (let j = i + 1; j < blocks.length; j++) {
      const s = out.get(blocks[j]!.slotKey);
      if (s) {
        hi = s;
        break;
      }
    }
    const cands = sorted.filter((s) => !used.has(s) && (lo === null || s > lo) && (hi === null || s < hi));
    if (cands.length === 1) {
      out.set(b.slotKey, cands[0]!);
      used.add(cands[0]!);
    }
  }
  return out;
}

/** 주차 탭 하나 → DB 행 + 이슈. */
export function buildWeekRows(
  tab: string,
  rows: string[][],
  ctx: BuildContext,
  issues: EcsImportIssue[],
): BuiltWeek {
  const wt = parseWeekTabTitle(tab, ctx.year);
  if (!wt.ok) {
    addIssue(issues, "week-title", `${ctx.className} · '${tab}' — ${wt.reason}`);
    return { tab, monday: null, skipped: wt.reason, planRows: [], goalRows: [], markRows: [] };
  }
  if (wt.ambiguous) addIssue(issues, "week-ambiguous", `${ctx.className} · '${tab}' → ${wt.monday} 주`);
  const monday = wt.monday;
  const parsed = parseWeekTab(rows);

  // 교시 → 날짜·슬롯 시각.
  // ⚠️ 못 붙였다고 **그 자리에서 이슈를 올리지 않는다** — 시트는 수업이 없는 요일까지 월~일 격자를 다 그려서
  //    빈 교시가 대량으로 나온다(실측: 그냥 올리면 1,536건 중 대부분이 '수업 없는 토·일'). 경고가 그렇게
  //    쌓이면 진짜 유실을 못 본다. **실제로 버릴 내용이 있을 때만** 그 교시를 이슈로 올린다(아래 note 참조).
  const slotStartOf = new Map<string, { date: string; slotStart: string }>();
  const unmappedNote = new Map<string, string>();
  for (const day of DAY_ORDER) {
    const blocks = parsed.slots.filter((s) => s.day === day);
    if (blocks.length === 0) continue;
    const date = shiftDays(monday, DAY_ORDER.indexOf(day));
    const daySlots = ctx.slots
      .filter((s) => s.day === day && s.validFrom <= date && (s.validTo === null || s.validTo >= date))
      .map((s) => s.start.slice(0, 5));
    const assigned = assignDaySlots(blocks, daySlots);
    for (const b of blocks) {
      const slotStart = assigned.get(b.slotKey);
      if (!slotStart) {
        // 🔴 **날짜별로 세지 않는다** — 같은 어긋남이 주마다 반복돼 실측 288줄이 됐고, 그 벽 안에서
        //    "무엇을 고쳐야 하는지"가 안 보였다. **요일·교시 단위로 묶고 원인을 구분**해서 알린다.
        //    요일 자체가 없는 것(시트가 수업 없는 날에 쓴 것)과 시각이 다른 것은 고칠 곳이 다르다.
        unmappedNote.set(
          b.slotKey,
          daySlots.length === 0
            ? `${ctx.className} · ${DAY_KO[day]}요일 ${b.periodLabel}${b.timeRaw ? ` ${b.timeRaw}` : ""} — eywa 시간표엔 이 반의 ${DAY_KO[day]}요일 수업이 없습니다`
            : `${ctx.className} · ${DAY_KO[day]}요일 ${b.periodLabel} ${b.timeRaw ?? "(시각 없음)"} — eywa 교시: ${daySlots.join(", ")}`,
        );
        continue;
      }
      slotStartOf.set(b.slotKey, { date, slotStart });
    }
  }
  /** 내용이 있는데 붙일 곳이 없을 때만 이슈. */
  const dropUnmapped = (slotKey: string): void => {
    const note = unmappedNote.get(slotKey);
    if (note) addIssue(issues, "slot-unmapped", note);
  };

  // 계획행 — (날짜·슬롯·시기)별로 1..N 번호.
  const planRows: PlanRow[] = [];
  const lineNoOf = new Map<string, number>();
  for (const l of parsed.planLines) {
    const at = slotStartOf.get(l.slotKey);
    if (!at) {
      dropUnmapped(l.slotKey);
      continue;
    }
    const skillArea = resolveSkillKey(l.skillLabel, ctx.skillAreas);
    // 🔴 skill_area는 not null이라 정하지 못한 줄은 **넣지 않는다**. 예전엔 null로 밀어넣어
    //    그 반의 계획 저장이 통째로 실패했다(2026-07-30 프로덕션: 초5 의치대·중1 정규 A).
    //    임의 slug를 지어내면 화면에 영문 raw가 노출되므로 그것도 안 된다.
    if (!skillArea) {
      const preview = [l.textbook, l.pageRange, l.progress].filter(Boolean).join(" · ").slice(0, 40);
      addIssue(
        issues,
        l.skillLabel ? "skill-unknown" : "skill-missing",
        l.skillLabel
          ? `${ctx.className} · '${l.skillLabel}'`
          : `${ctx.className} · ${at.date} ${l.termMode === "exam" ? "내신" : "평시"}${preview ? ` — ${preview}` : ""}`,
      );
      continue;
    }
    const groupKey = `${at.date}|${at.slotStart}|${l.termMode}`;
    const lineNo = (lineNoOf.get(groupKey) ?? 0) + 1;
    lineNoOf.set(groupKey, lineNo);
    // DB CHECK: line_no 1..20 — 넘치면 그 줄만 버린다(전체 실패보다 낫다).
    if (lineNo > 20) continue;
    planRows.push({
      planDate: at.date,
      slotStart: at.slotStart,
      termMode: l.termMode,
      skillArea,
      lineNo,
      textbook: cut(l.textbook, 500),
      pageRange: cut(l.pageRange, 500),
      progress: cut(l.progress, 500),
      homework: cut(l.homework, 500),
    });
  }

  // 목표 — 영역 slug를 못 찾으면 저장하지 않는다(UNIQUE 키의 일부라 null이면 행이 성립하지 않는다).
  const goalRows: GoalRow[] = [];
  const seenGoal = new Set<string>();
  for (const g of parsed.goals) {
    const skillArea = resolveSkillKey(g.skillLabel, ctx.skillAreas);
    if (!skillArea) {
      addIssue(issues, "skill-unknown", `${ctx.className} · '${g.skillLabel}' (목표)`);
      continue;
    }
    const periodStart = normalizePeriodStart(g.scope, monday);
    const key = `${g.scope}|${periodStart}|${g.role}|${skillArea}`;
    if (seenGoal.has(key)) continue; // 같은 칸이 여러 줄이면 첫 줄만(UNIQUE 충돌 방지)
    seenGoal.add(key);
    goalRows.push({
      scope: g.scope,
      periodStart,
      role: g.role,
      skillArea,
      textbook: cut(g.textbook, 500),
      targetProgress: cut(g.targetProgress, 500),
    });
  }

  // 학생 기록 — 상태·개인노트가 있는 행만(빈 행은 만들지 않는다). 출석 체크는 가져오지 않는다(원장 결정).
  const markRows: MarkRow[] = [];
  const seenMark = new Set<string>();
  for (const m of parsed.marks) {
    if (!m.status && !m.note) continue;
    const at = slotStartOf.get(m.slotKey);
    if (!at) {
      dropUnmapped(m.slotKey);
      continue;
    }
    const { korean, english } = splitStudentLabel(m.studentLabel);
    let cand = [...(ctx.studentsByName.get(korean) ?? [])];
    if (cand.length > 1) {
      const inRoster = cand.filter((s) => ctx.rosterIds.has(s.id));
      if (inRoster.length > 0) cand = inRoster;
    }
    if (cand.length > 1 && english) {
      const byEng = cand.filter((s) => norm(s.englishName ?? "").toLowerCase() === norm(english).toLowerCase());
      if (byEng.length === 1) cand = byEng;
    }
    if (cand.length !== 1) {
      addIssue(
        issues,
        "student-unresolved",
        `${ctx.className} · '${m.studentLabel}'${cand.length > 1 ? ` (동명 ${cand.length}명)` : " (없는 이름)"}`,
      );
      continue;
    }
    const student = cand[0]!;
    if (!ctx.rosterIds.has(student.id) || !ctx.eligibleOn(student.id, at.date)) {
      addIssue(issues, "student-off-roster", `${ctx.className} · '${m.studentLabel}'`);
      continue;
    }
    const key = `${student.id}|${at.date}|${at.slotStart}`;
    if (seenMark.has(key)) continue;
    seenMark.add(key);
    markRows.push({
      studentId: student.id,
      markDate: at.date,
      slotStart: at.slotStart,
      status: cut(m.status, 50),
      progressNote: cut(m.note, 500),
    });
  }

  return { tab, monday, skipped: null, planRows, goalRows, markRows };
}
