// 비교 뒤 손질 — 반 이름 변경으로 보이는 것을 가려내고, 새 반이 다른 반과 강의실을 같이 쓰는지 알린다. 순수.

import { norm } from "../match";
import type { AfterClass } from "./delta-after";
import type { ResolvedCell } from "./delta-before";
import type { DeltaClassRef, DeltaIgnored, DeltaStudent, GridDelta } from "./types";

export interface RawAddition {
  student: DeltaStudent;
  to: DeltaClassRef;
  days: string[];
  /** 옮겨 간 반의 비교 키. */
  key: string;
  /** 그 반 칸에서 전부 대기 구역에 적혔다. */
  toHold: boolean;
}

const RENAME_WHY = "반 이름을 바꾼 것으로 보입니다 — 이름 변경은 수업목록에서 해 주세요(시트로는 새 반을 만들지 않습니다).";
const SPLIT_WHY =
  "원래 반 칸이 사라지고 그 학생들이 새 반 여러 개에 나뉘어 적혀 있습니다 — 반을 나누려면 원래 반 칸을 남겨 두고 옮길 학생만 새 반에 적어 주세요(시트로는 새 반을 만들지 않았습니다).";

/**
 * 격자에서 통째로 사라진 반의 학생이 다른 칸에 '새로 적힌' 것으로 보일 때.
 *
 * 🔴 이걸 '추가'로 읽으면 사고다 — 원래 반은 건드리지 않기로 했으므로(전원 '빠짐' 방지) 그 학생은 **두 반에 동시에**
 *    있게 되고, 반 이름만 바꾼 경우엔 같은 반이 하나 더 생긴다. 새 반의 학생이 전부 한 사라진 반에서 왔으면
 *    반 이름 변경으로 보고 통째로 뺀다. 섞여 있으면 그 학생들만 빼고 이유를 말한다.
 */
export function splitRenames(
  raw: RawAddition[],
  classes: Map<string, AfterClass>,
  goneWith: Map<string, string>,
  skipKeys: Set<string>,
  ignored: DeltaIgnored[],
): { additions: RawAddition[]; renamedKeys: Set<string>; dropped: Set<string> } {
  const renamedKeys = new Set<string>();
  /** 새로 적혀 있지만 '추가'로 읽지 않은 학생 — 호출부가 그 학생의 '빠짐'도 쓰지 않는다. */
  const dropped = new Set<string>();
  /** 사라진 반 이름 → 그 반 학생만으로 채워진 새 반 이름들. */
  const heirs = new Map<string, string[]>();
  for (const [key, entry] of classes) {
    if (entry.ref.classId || skipKeys.has(key) || entry.members.size === 0) continue;
    const sources = new Set([...entry.members.values()].map((m) => (m.student.studentId ? goneWith.get(m.student.studentId) : undefined)));
    if (sources.size !== 1 || sources.has(undefined)) continue;
    renamedKeys.add(key);
    const gone = [...sources][0]!;
    heirs.set(gone, [...(heirs.get(gone) ?? []), entry.ref.name]);
  }
  // 새 반 하나면 이름을 바꾼 것, 여럿이면 반을 나눈 것 — 이유가 다르다(둘 다 "이름 변경"이라 하면 틀린 안내다).
  for (const [gone, names] of heirs) {
    if (names.length === 1) ignored.push({ what: `반 이름 "${gone}" → "${names[0]}"`, why: RENAME_WHY });
    else ignored.push({ what: `"${gone}" 반을 ${names.map((n) => `"${n}"`).join(" · ")}(으)로 나눔`, why: SPLIT_WHY });
  }
  const additions = raw.filter((a) => {
    const id = a.student.studentId;
    const gone = id ? goneWith.get(id) : undefined;
    if (id && (renamedKeys.has(a.key) || gone)) dropped.add(id);
    if (renamedKeys.has(a.key)) return false;
    if (!gone) return true;
    ignored.push({
      what: `${a.student.text} → "${a.to.name}"`,
      why: `원래 반 "${gone}"이(가) 격자에서 사라져 옮긴 것인지 알 수 없습니다 — 원래 반 칸을 되살리거나 앱에서 옮겨 주세요.`,
    });
    return false;
  });
  return { additions, renamedKeys, dropped };
}

/** 새 반이 같은 요일·교시에 다른 반과 같은 강의실을 쓰면 알린다(막지 않는다 — 합반·겹침은 실제 운영이다). */
export function roomSharingNotes(newClasses: GridDelta["newClasses"], resolved: ResolvedCell[]): string[] {
  const notes = new Set<string>();
  for (const cls of newClasses) {
    for (const slot of cls.slots) {
      const room = norm(slot.room);
      if (!room) continue;
      for (const { cell } of resolved) {
        if (cell.weekend !== slot.weekend || cell.classes.some((k) => norm(k.name) === norm(cls.name))) continue;
        if (!cell.room.split(" / ").some((r) => norm(r) === room)) continue;
        const day = cell.days.find((d) => slot.days.includes(d));
        const period = cell.classes.flatMap((k) => k.periodIds).find((p) => slot.periodIds.includes(p));
        if (!day || !period) continue;
        notes.add(`"${cls.name}" — ${day}요일 ${period.split("-")[0]}교시에 ${slot.room}을(를) "${cell.classes.map((k) => k.name).join(" · ")}" 반도 씁니다.`);
      }
    }
  }
  return [...notes];
}
