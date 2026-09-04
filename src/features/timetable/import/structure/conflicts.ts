// 적용 후 배치가 **물리적으로 성립하는가** — 순수 검사. 시트에서 도출한 목표 배치(TargetSchedule)만 본다.
//
// 🔴 왜 필요한가(원장 2026-08-28 *"미래 적용시킬때 적용시 에러사항(중복, 물리적으로 불가능 등)을 경고해줘야해"*):
// 가져오기를 **오늘** 적용하면 이상한 배치가 바로 화면에 보인다 — 미래 날짜로 예약하면 그날이 올 때까지
// 아무도 못 본다. 시트에서는 칸이 멀리 떨어져 있어 눈에 안 띄지만, 배치로 합치면 한 방에 두 반이거나
// 한 강사가 동시에 두 곳에 있는 조합이 나온다.
//
// ── 판정은 **실제 시간표를 재서** 세웠다(2026-08-28, 유효 슬롯 534 / 자리 제외 후 겹치는 쌍 3건) ──
// · 같은 방 + **같은 강사** … 1건(화 604호 Sam: RTT4 × 중등E_초등 브릿지 C2) → **합반**. 원장 확인:
//   *"일부 수업도 같이 합반 수업이 존재할 수 있으므로 합반의 경우는 경고만 띄우고 적용은 가능해야함"*.
// · 같은 방 + **다른 강사** … 2건(목 606호 Hannah×Sam, 부원장×Kristine) → 한 방에 선생이 둘 = **불가능**.
// · 같은 강사 + 다른 방 … 0건 / 같은 반이 두 자리 … 0건.
// ⚠️ `class_schedules.merge_group`은 컬럼만 있고 **실제 0행**이라 합반 표식으로 못 쓴다 — 그래서 합반은
//    "같은 강사·같은 방"이라는 **모양**으로 알아본다. 나중에 merge_group을 채우기 시작하면 그걸 먼저 볼 것.
//
// 🔴 **자리(LAB·JJ)는 충돌이 아니다.** 순진하게 세면 강의실 76쌍·강사 76쌍이 나오는데 대부분이
// `LAB`(603호)·`JJ`(305호)다 — 여러 반 학생이 **동시에 같은 자리에 앉는 것이 설계**고 그 라벨은 사람도
// 아니다. 정본 [`specialSlotLabel`](../../lib/teacher-label.ts)로 거르면 3쌍만 남고 그건 전부 진짜다.
// ⚠️ 자리를 다시 검사 대상에 넣지 말 것 — 76칸짜리 체크리스트는 아무도 안 읽고 그냥 다 눌러 버린다.
//
// ⚠️ **타 과목은 보지 않는다**: 수학 슬롯은 `slot_room_label`이 대부분 비어 있어 방 비교가 성립하지 않는다
//    (실측: 자리·빈 방 제외 시 전 과목 충돌 = 영어 내부 3쌍과 동일). 왕복을 늘려도 얻는 게 0이다.

import type { DayOfWeek } from "@/features/timetable/lib/periods";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import type { SchedulePlanItem, TargetSchedule } from "./types";
import { roomToken } from "../../lib/room-token";

/**
 * · `room` — 한 방에 **다른 강사**의 두 반(불가능)
 * · `teacher` — 한 강사가 **다른 방**에 동시에(불가능)
 * · `duplicate` — 한 반이 같은 시간에 두 자리(불가능)
 * · `merged` — 같은 강사·같은 방 = **합반으로 보임**(정상일 수 있음 → 경고만)
 */
export type ConflictKind = "room" | "teacher" | "duplicate" | "merged";

/** 적용을 막는 종류인가. 합반만 통과시킨다(원장 2026-08-28). */
export function blocksApply(kind: ConflictKind): boolean {
  return kind !== "merged";
}

export interface ConflictSide {
  className: string;
  startTime: string;
  endTime: string | null;
  room: string | null;
  teachers: string[];
}

export interface ScheduleConflict {
  /** 안정적 식별자 — 체크 상태의 축이자, 서버가 "확인한 목록과 같은가"를 대조하는 키. */
  key: string;
  kind: ConflictKind;
  /** 겹치는 축의 이름 — 방 "604" · 강사 "Sam" · 반 "RTT4". */
  where: string;
  day: DayOfWeek;
  /** 두 슬롯의 시간대가 **정확히** 같은가 — 합반은 보통 같고, 어긋나면 사람이 봐야 한다. */
  exact: boolean;
  /**
   * 이번 변경이 **만들었거나 건드린** 충돌인가. 확인을 요구하는 것은 이것뿐이다 —
   * 손대지 않은 옛 충돌까지 매번 체크시키면 체크가 의식(儀式)이 되고 진짜 경고가 묻힌다.
   */
  touched: boolean;
  a: ConflictSide;
  b: ConflictSide;
}

const DAY_KO: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

/** 방 라벨을 비교 토큰으로("본원303"→"303", "SKY"→"SKY", 없으면 "") — 앱 단일 소스(`lib/room-token.ts`). */
const roomTok = roomToken;

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * 두 슬롯이 시간으로 겹치는가.
 * ⚠️ 끝시각을 모르면(`null`) 시작시각으로 대체하는데 그러면 길이 0이라 반열림 비교로는 **절대 안 겹친다**
 *    — 시작이 같은 두 슬롯은 끝을 몰라도 명백히 겹치므로 그 경우를 따로 잡는다.
 */
function overlaps(a: TargetSchedule, b: TargetSchedule): boolean {
  if (a.startTime === b.startTime) return true;
  return toMin(a.startTime) < toMin(b.endTime ?? b.startTime) && toMin(b.startTime) < toMin(a.endTime ?? a.startTime);
}

/** 사람 강사 이름만(자리 라벨·빈 문자열 제외). */
function teacherNames(t: TargetSchedule): string[] {
  return t.teachers
    .map((x) => x.name.trim())
    .filter((n) => n !== "" && specialSlotLabel(n) === null);
}

/** 이 목표 슬롯이 자리(LAB·JJ)인가 — 강사 라벨·방 라벨 어느 쪽으로든 판정한다. */
function isSeatSlot(t: TargetSchedule): boolean {
  if (specialSlotLabel(t.room) !== null) return true;
  return t.teachers.some((x) => specialSlotLabel(x.name) !== null);
}

function sideOf(t: TargetSchedule): ConflictSide {
  return {
    className: t.className,
    startTime: t.startTime,
    endTime: t.endTime,
    room: t.room,
    teachers: t.teachers.map((x) => x.name),
  };
}

/** 쌍의 순서가 뒤집혀도 같은 키 — 목록 정렬이 달라져도 체크가 풀리지 않는다. */
function pairKey(kind: ConflictKind, where: string, day: string, a: TargetSchedule, b: TargetSchedule): string {
  const s = [`${a.classId ?? a.className}@${a.startTime}`, `${b.classId ?? b.className}@${b.startTime}`].sort();
  return `${kind}|${where}|${day}|${s[0]}|${s[1]}`;
}

/**
 * 적용 후 배치의 충돌 전부. `planItems`는 **어느 슬롯이 이번에 바뀌는지**만 알려 준다(touched 판정) —
 * 검사 대상은 언제나 목표 배치 전체다(적용 후에 남는 것이 곧 진실이므로).
 */
export function detectScheduleConflicts(
  targets: readonly TargetSchedule[],
  planItems: readonly SchedulePlanItem[],
): ScheduleConflict[] {
  const changed = new Set(
    planItems
      .filter((p) => p.action === "create" || p.action === "update")
      .map((p) => `${p.classId}|${p.day}|${p.startTime}`),
  );
  const isChanged = (t: TargetSchedule) => changed.has(`${t.classId}|${t.day}|${t.startTime}`);

  // 요일로 먼저 갈라 그 안에서만 쌍을 만든다(전수 O(n²) 회피).
  const byDay = new Map<string, TargetSchedule[]>();
  for (const t of targets) {
    if (isSeatSlot(t)) continue;
    let arr = byDay.get(t.day);
    if (!arr) byDay.set(t.day, (arr = []));
    arr.push(t);
  }

  const out: ScheduleConflict[] = [];
  for (const arr of byDay.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!, b = arr[j]!;
        if (!overlaps(a, b)) continue;

        const ra = roomTok(a.room), rb = roomTok(b.room);
        const sameRoom = ra !== "" && ra === rb;
        const roomsKnownDiffer = ra !== "" && rb !== "" && ra !== rb;
        const ta = teacherNames(a), tb = teacherNames(b);
        const shared = ta.find((n) => tb.includes(n)) ?? null;

        let kind: ConflictKind | null = null;
        let where = "";
        if (a.classId != null && a.classId === b.classId) {
          // 같은 반이 같은 시간에 두 줄 — 시작시각이 달라 병합되지 않은 중복이다.
          kind = "duplicate";
          where = a.className;
        } else if (shared !== null && roomsKnownDiffer) {
          // 한 사람이 동시에 두 방. 합반으로도 설명되지 않는다.
          kind = "teacher";
          where = shared;
        } else if (shared !== null) {
          // 같은 강사 + 같은 방(또는 방 미상) = 합반의 모양. 방을 모르면 "다른 방"이라 단정할 수 없으므로
          // 여기로 떨어뜨린다 — 확실하지 않은 것으로 적용을 막지 않는다.
          kind = "merged";
          where = sameRoom ? ra : shared;
        } else if (sameRoom) {
          // 한 방에 선생이 둘. 합반이면 강사가 같아야 하므로 이건 겹친 것이다.
          kind = "room";
          where = ra;
        }
        // 다른 방·다른 강사 = 충돌 아님(정상 병행 수업).
        if (kind === null) continue;

        out.push({
          key: pairKey(kind, where, a.day, a, b),
          kind,
          where,
          day: a.day,
          exact: a.startTime === b.startTime && (a.endTime ?? "") === (b.endTime ?? ""),
          touched: isChanged(a) || isChanged(b),
          a: sideOf(a),
          b: sideOf(b),
        });
      }
    }
  }

  // 결정적 정렬 — 같은 입력이면 같은 순서(키 집합 대조·화면 흔들림 방지).
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

/**
 * 적용 전에 **사람이 반드시 확인해야 하는** 것 = 이번 변경이 건드린 + 적용을 막는 종류.
 * 합반(경고)과 손대지 않은 옛 충돌은 목록에 보이되 체크 대상이 아니다.
 */
export function conflictChecklist(conflicts: readonly ScheduleConflict[]): ScheduleConflict[] {
  return conflicts.filter((c) => c.touched && blocksApply(c.kind));
}

/** 체크리스트 키 집합(정렬) — 클라가 확인한 목록과 서버 재계산 목록이 같은지 대조하는 축. */
export function conflictKeys(conflicts: readonly ScheduleConflict[]): string[] {
  return conflicts.map((c) => c.key).sort();
}

/** 화면·로그 공용 한 줄 설명. ⚠️ raw enum 노출 금지 — kind는 여기서만 한글로 풀린다. */
export function describeConflict(c: ScheduleConflict): string {
  const day = DAY_KO[c.day] ?? c.day;
  const t = (s: ConflictSide) => `${s.className} ${s.startTime}${s.endTime ? `~${s.endTime}` : ""}`;
  const pair = `${t(c.a)} / ${t(c.b)}`;
  switch (c.kind) {
    case "room":
      return `${day} ${c.where}호에 강사가 다른 두 반이 겹칩니다 — ${pair}`;
    case "teacher":
      return `${day} ${c.where} 강사가 같은 시간에 다른 방 두 곳에 있습니다 — ${pair}`;
    case "duplicate":
      return `${day} ${c.where} 반이 같은 시간에 두 줄로 잡혀 있습니다 — ${pair}`;
    case "merged":
      return c.exact
        ? `${day} 합반으로 보입니다(같은 강사·같은 방) — ${pair}`
        : `${day} 합반으로 보이나 시간대가 서로 다릅니다(같은 강사·같은 방) — ${pair}`;
  }
}
