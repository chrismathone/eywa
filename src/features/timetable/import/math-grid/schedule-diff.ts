// 기존 반의 자리(요일·교시·강사·강의실)가 수업목록과 다른가 — 읽어서 **알리기만** 한다. 순수.
//
// 🔴 시트로는 바꾸지 않는다: 배치 시각은 이미 찍힌 출결의 앵커라([[#126]]) 옮기면 그 기록이 떠 버리고, 담임·강의실은
//    "바뀌는 날" 규약이 따로 있다. 대신 조용히 무시하지 않는다 — 무엇이 다른지와 어디서 고치는지를 말한다.
//
// 견주는 상대는 익스포터가 그릴 그 모양이다(assembleMathParams의 반 목록) — 교시표에 안 맞아 격자에 못 올라간
// 수업 시간은 시트에도 없으므로, DB 행을 직접 견주면 손대지 않은 반이 '바뀜'으로 뜬다.

import { LEGACY_TO_UNIFIED_PERIOD_MAP } from "@/features/exports/math-timetable/constants";
import { norm } from "../match";
import { KO_DAYS, LEGACY_PERIOD_IDS } from "./grid-text";
import { periodLabel } from "./period-text";
import type { DeltaIgnored, GridDelta } from "./types";

/** 익스포터 입력의 반 한 줄에서 여기서 쓰는 것만. */
export interface ExportedClass {
  id: string;
  teacher: string;
  /** ["월 1-1", "목 1-2", …] */
  schedule: string[];
  /** 교시별 담당 — 키 "월-3"(통일 교시 번호). */
  slotTeachers?: Record<string, string>;
}

const WHY =
  "이미 있는 반의 요일·교시·강사는 시트로 바꾸지 않습니다(출결 기록이 그 시간에 매여 있습니다) — 수업목록이나 시간표에서 옮겨 주세요.";
const ROOM_WHY = "이미 있는 반의 강의실은 시트로 바꾸지 않습니다 — 수업목록에서 그 반의 강의실을 바꿔 주세요.";

/**
 * 주말 칸의 교시를 믿을 수 없는가.
 *
 * 익스포터는 주말 칸을 **그 주에 쓰인 교시들만 차례로** 쌓는다(`weekendPeriods = currentPeriods`, 칸 번호 = 그 안의 순번).
 * 앞 교시를 안 쓰는 주에는 칸이 위로 당겨져 교시 라벨과 어긋난다 — 그 칸을 라벨대로 읽으면 엉뚱한 시각이 된다.
 * 쓰인 교시가 1-1부터 빈틈없이 이어질 때만 순번이 곧 교시다.
 */
export function weekendSlotsShifted(exported: ExportedClass[]): boolean {
  const used = new Set(exported.flatMap((c) => c.schedule.map((s) => s.trim().split(/\s+/)[1]!)));
  const present = LEGACY_PERIOD_IDS.filter((p) => used.has(p));
  return present.some((p, i) => p !== LEGACY_PERIOD_IDS[i]);
}

/** "수|2-1|허주연" 묶음 → "수 2교시(허주연)". */
function describe(keys: string[]): string {
  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const [day, period, teacher] = key.split("|") as [string, string, string];
    const g = `${day}|${teacher}|${period.split("-")[0]}`;
    groups.set(g, [...(groups.get(g) ?? []), period]);
  }
  return [...groups]
    .sort((a, b) => KO_DAYS.indexOf(a[0].split("|")[0]!) - KO_DAYS.indexOf(b[0].split("|")[0]!) || a[0].localeCompare(b[0]))
    .map(([g, periods]) => {
      const [day, teacher] = g.split("|");
      const sorted = periods.sort((a, b) => LEGACY_PERIOD_IDS.indexOf(a) - LEGACY_PERIOD_IDS.indexOf(b));
      return `${day} ${periodLabel(sorted) || sorted.join("·")}(${teacher || "강사 없음"})`;
    })
    .join(", ");
}

export function scheduleChanges(classSlots: GridDelta["classSlots"], exported: ExportedClass[]): DeltaIgnored[] {
  const byId = new Map(exported.map((c) => [c.id, c]));
  const out: DeltaIgnored[] = [];
  // 주말 칸을 믿을 수 없는 주에는 주말 자리를 견주지 않는다(손대지 않은 반이 '다릅니다'로 뜬다).
  const shifted = weekendSlotsShifted(exported);
  const comparable = (k: string) => !shifted || !["토", "일"].includes(k.split("|")[0]!);
  for (const cls of classSlots) {
    const was = byId.get(cls.classId);
    if (!was) continue; // 지금 수업목록에서 시간표에 안 올라가는 반 — 견줄 상대가 없다
    /** 비교 키(강사 이름은 공백·대소문자 무시) → 화면에 적을 키. */
    const shown = new Map<string, string>();
    const key = (day: string, period: string, teacher: string) => {
      const k = `${day}|${period}|${norm(teacher)}`;
      if (!shown.has(k)) shown.set(k, `${day}|${period}|${teacher.trim()}`);
      return k;
    };
    const expected = new Set(
      was.schedule.map((s) => {
        const [day, period] = s.trim().split(/\s+/) as [string, string];
        const teacher = was.slotTeachers?.[`${day}-${LEGACY_TO_UNIFIED_PERIOD_MAP[period] ?? period}`] || was.teacher;
        return key(day, period, teacher ?? "");
      }),
    );
    const now = new Set(cls.slots.flatMap((s) => s.days.flatMap((day) => s.periodIds.map((period) => key(day, period, s.teacher)))));
    const show = (keys: string[]) => describe(keys.map((k) => shown.get(k)!));
    const onlySheet = [...now].filter((k) => !expected.has(k) && comparable(k));
    const onlyApp = [...expected].filter((k) => !now.has(k) && comparable(k));
    if (onlySheet.length > 0 || onlyApp.length > 0) {
      const parts = [onlyApp.length ? `수업목록: ${show(onlyApp)}` : "", onlySheet.length ? `시트: ${show(onlySheet)}` : ""];
      out.push({ what: `"${cls.name}" 수업 시간·강사가 다릅니다 — ${parts.filter(Boolean).join(" → ")}`, why: WHY });
    }
    // 강의실은 **시트끼리** 견준다(보낼 때 적은 글자 ↔ 지금 글자) — 양쪽 다 하나로 모일 때만.
    const rooms = [...new Set(cls.slots.map((s) => s.room.trim()).filter(Boolean))];
    if (rooms.length === 1 && cls.roomWas.length === 1 && norm(rooms[0]!) !== norm(cls.roomWas[0]!)) {
      out.push({ what: `"${cls.name}" 강의실을 바꿨습니다 — ${cls.roomWas[0]} → ${rooms[0]}`, why: ROOM_WHY });
    }
  }
  return out;
}
