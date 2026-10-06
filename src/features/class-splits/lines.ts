/**
 * 시간표 반 칸의 **'나눔' 줄** — 표시 전용(원장 2026-10-06 *"시간표에서도 해당 학생들이 이동되면 모두 보여야 함"*).
 *
 * 한 나눔은 **두 칸에 선다**: 원래 반 칸엔 `→ 받는 선생님`(그 시간 빠짐), 받는 반 칸엔 `← 원래 선생님`(그 시간 옴).
 * 🔴 `StudentLine`(수강 명단)에 섞지 않는다 — 나눔은 수강이 아니라 인원·드래그·엑셀·반 이동 판정에 들어가면 거짓이 된다
 *    (보강 예약 `TimetableReservedLine`과 같은 결).
 * ⚠️ 클라(셀)도 import한다 — `server-only` 금지([[#61]]).
 */
import { durationLabel, SPLIT_DAY_KO, toMin, type ClassSplit, type SplitDay } from "./rules";
import { periodText } from "./period";

export type TimetableSplitLine = {
  /** 렌더 key — 나눔 id + 방향(한 칸에 같은 나눔이 두 번 설 일은 없지만 합반 칸은 두 반 것을 합친다). */
  key: string;
  splitId: string;
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  /** out = 이 반에서 그 시간 빠짐 · in = 그 시간 이 반으로 옴 */
  dir: "out" | "in";
  day: SplitDay;
  startTime: string;
  endTime: string;
  /** 상대 쪽 선생님(없으면 반 이름) — 줄 꼬리표(`→유형숙`). */
  otherLabel: string;
  otherClassName: string;
  periodText: string;
};

export type SplitNames = {
  student: (id: string) => { name: string; grade: string | null; school: string | null } | undefined;
  /** 반 → 이름·담임. 모르면 undefined(줄을 세우지 않는다 — 지어내지 않는다). */
  klass: (id: string) => { name: string; teacherName: string | null } | undefined;
};

/** 한 칸(반·요일·시각 구간) 위에 설 나눔 줄들. 칸과 시간이 하루라도 안 겹치면 안 선다. */
export function splitLinesForCell(
  cell: { classId: string; dayOfWeek: string; startTime: string; endTime: string },
  splits: readonly ClassSplit[],
  names: SplitNames,
): TimetableSplitLine[] {
  const cs = toMin(cell.startTime);
  const ce = toMin(cell.endTime);
  const out: TimetableSplitLine[] = [];
  for (const s of splits) {
    if (s.dayOfWeek !== cell.dayOfWeek) continue;
    if (!(toMin(s.startTime) < ce && cs < toMin(s.endTime))) continue;
    const dir = s.sourceClassId === cell.classId ? "out" : s.targetClassId === cell.classId ? "in" : null;
    if (!dir) continue;
    const stu = names.student(s.studentId);
    const other = names.klass(dir === "out" ? s.targetClassId : s.sourceClassId);
    if (!stu || !other) continue;
    out.push({
      key: `${s.id}:${dir}`,
      splitId: s.id,
      studentId: s.studentId,
      name: stu.name,
      grade: stu.grade,
      school: stu.school,
      dir,
      day: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      otherLabel: other.teacherName?.trim() || other.name,
      otherClassName: other.name,
      periodText: periodText(s),
    });
  }
  return out.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name, "ko"));
}

/** 줄 꼬리표 — `→유형숙 17:20` / `←이성우 17:20`. */
export function splitTag(l: Pick<TimetableSplitLine, "dir" | "otherLabel" | "startTime">): string {
  return `${l.dir === "out" ? "→" : "←"}${l.otherLabel} ${l.startTime}`;
}

/** hover 카드 줄 — 무엇이 어디로, 언제까지. */
export function splitTipRows(l: TimetableSplitLine): [string, string][] {
  const mins = toMin(l.endTime) - toMin(l.startTime);
  return [
    [l.dir === "out" ? "그 시간 수업" : "원래 반", `${l.otherClassName} (${l.otherLabel})`],
    ["시간", `${SPLIT_DAY_KO[l.day]} ${l.startTime}~${l.endTime} · ${durationLabel(mins)}`],
    ["기간", l.periodText],
  ];
}


/** 병합 블록(여러 슬롯)의 나눔 줄을 한 번씩만 — 🔴 서버 컴포넌트(격자)가 부르므로 이 일반 모듈에 둔다([[#81]]) (같은 나눔이 연속 교시 슬롯마다 붙는다). */
export function uniqueSplits(slots: readonly { splits?: TimetableSplitLine[] }[]): TimetableSplitLine[] {
  const seen = new Set<string>();
  const out: TimetableSplitLine[] = [];
  for (const s of slots) {
    for (const l of s.splits ?? []) {
      if (seen.has(l.key)) continue;
      seen.add(l.key);
      out.push(l);
    }
  }
  return out;
}
