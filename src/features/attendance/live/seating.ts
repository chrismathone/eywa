/**
 * 데스크 좌석표 — **학생축**(순수, Vitest).
 *
 * 원장(2026-08-14 정정): *"그냥 그 반의 오늘 날짜에 이 학생이 수업했냐 안했냐만 체크하는 단순한 알림판."*
 * 칸 = 반 × 학생 × 오늘 **하나**. 연강 2~3교시도 섹션 하나·칸 하나.
 * 섹션 순서 = 오늘 첫 교시 시작시각(시간을 훑는 건 유지).
 *
 * 🔑 **카드가 대표하는 교시는 '지금 교시'다**(2026-08-18, [`seating-anchor.ts`](./seating-anchor.ts)) —
 *    첫 교시에 못박으면 하루에 방을 옮기는 반(활성 43개 중 20개)의 **뒤 방이 화면에서 사라진다**.
 *    바뀌는 건 **어디에 그릴지**(방·시각)뿐이고 **무엇을 쓸지**(저장 교시)는 불변이다.
 *
 * 읽기: 교시 무시, (반·학생·오늘)에 기록이 있으면 그 상태. 여러 행이면 recorded_at 최신.
 * 쓰기 슬롯은 호출부가 slot-axis를 따른다(수학=null, 영어=첫 교시). 기존 행이 있으면 그 행의 교시를 쓴다.
 *
 * 🔴 **칸이 하루 하나라고 해서 하루치를 한 화면에 동시에 펼치는 건 다른 얘기다**(원장 2026-08-18:
 *    *"1개의 수업에 대해서만 수업인데 마치 전부 수업하는 것처럼"*). 카드마다 [`NowBand`](./now-band.ts)를
 *    들려 보내 화면이 지금/예정/지난으로 나눠 그린다 — **거르는 게 아니라 나누는 것**이다([[#105]]).
 */
import { specialSlotLabel, type SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { seatMarkOf, type SeatMark } from "./mark-state";
import { anchorSlotIndex } from "./seating-anchor";
import { foldNowBands, type NowBand } from "./now-band";
import { saveSlotFor } from "./slot-axis";
import type { LiveBoardSlot, LiveStudent } from "./types";

export type SeatingStudent = LiveStudent & {
  mark: SeatMark;
  /** setAttendanceCell.slotStart — 기존 행이면 그 교시, 없으면 과목 축의 신규 값. */
  writeSlot: string | null;
};

export type SeatingClass = {
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null;
  /**
   * 카드에 이름이 적힌 그 사람의 id — 이미 **귀속 축**(`teacher-axis`)을 거친 값이다(슬롯 담당 →
   * 없으면 담임, 자리는 null). 칸이 "담임 아닌 사람이 찍었나"를 판정하는 기준(원장 2026-08-21).
   * ⚠️ `classes.teacher_id`를 여기서 다시 읽지 말 것 — 축이 갈린다(teacher-axis 단일 소스).
   */
  teacherId: string | null;
  /**
   * **대표 교시**가 열리는 강의실 — 층 묶음 근거([`seating-floors.ts`](./seating-floors.ts)).
   * 대표 교시 = 지금 열린 교시(없으면 다음, 그것도 없으면 마지막) — [`anchorSlotIndex`](./seating-anchor.ts).
   */
  roomName: string | null;
  /**
   * 🔑 이름은 `first`지만 뜻은 **"대표 교시의"**다(2026-08-18) — 하루에 방을 옮기는 반(활성 43개 중 20개)이
   * 첫 방에 못박혀 604·605·606이 통째로 화면에서 빠졌다. 이름을 바꾸려면 소비처를 함께 고칠 것
   * (`seating-floors`·`seating-bands`·`seating-room`·`seating-cell`·정렬).
   * 🔴 **저장 축이 아니다** — 영어 신규 저장은 아래 `writeSlot`(하루 첫 교시)이 그대로 정한다.
   */
  firstStart: string;
  /** 대표 교시부터 **같은 방으로 이어지는 동안**의 종료시각(`spanAdjacentEnd`). */
  firstEnd: string | null;
  /**
   * 카드에 **적히는** 수업 시각 — 대표 교시가 속한 **연속 블록**의 시작(`blockSpanAround`).
   *
   * 원장 2026-09-16(오늘 출결 캡처): *"왜 수업을 따로 생각하냐? 하나의 수업인데. 2-1, 2-2 수업하면
   * 하나로 봐야지."* — 수학 반은 대부분 두 교시를 붙여 한 수업으로 한다(실측 화요일: 화면의 7개 반이
   * 전부 2교시 블록). 그런데 카드는 **대표 교시 하나**만 적어서, 16:20~18:10짜리 수업이 `17:15~18:10`으로
   * 보였다(수업이 끝나면 대표가 마지막 교시로 내려가고, 진행 중엔 앞뒤로 튄다).
   *
   * 🔴 **`firstStart`와 갈라 둔 이유** — `firstStart`는 그대로 **대표 교시**(방을 고르는 근거이자
   *    `setAttendanceCell({ periodStart })`로 나가 "그 교시 담당에게 벨"을 정한다). 표시만 블록으로
   *    넓히고 판정 축은 건드리지 않는다([`seating-anchor.ts`](./seating-anchor.ts)의 경고 그대로).
   */
  blockStart: string;
  /** 같은 블록의 종료시각. 한 교시짜리면 `firstEnd`와 같다. */
  blockEnd: string | null;
  periodLabel: string | null;
  /** LAB·JJ — 같은 시각에 여러 반이 한 방을 쓴다. 일반 4열과 다른 묶음의 근거. */
  seatLabel: SpecialSlotLabel | null;
  phase: LiveBoardSlot["phase"];
  /**
   * 이 반이 **지금 열려 있나** — 교시 하나라도 열려 있으면 '지금'(`foldNowBands`).
   * 🔑 `phase`(첫 교시의 유예 국면)와 다르다: phase는 "빈 칸을 큐에 올릴 때가 됐나", band는 "지금 하나".
   */
  band: NowBand;
  ownedByMe: boolean;
  students: SeatingStudent[];
};

export type SeatingSummary = {
  unmarked: number;
  absent: number;
  recorded: number;
  expected: number;
};

type DayHit = {
  status: string | null;
  note: string | null;
  recordedAt: string | null;
  /**
   * 입력자 — 시각과 **같은 행**에서 와야 한다(다른 교시의 입력자를 붙이면 거짓말이 된다).
   * 🔴 id와 이름이 **짝으로** 다녀야 한다: id만 빠지면 "담임이 찍었나" 판정이 늘 거짓이 되어
   *    담임 본인이 찍은 칸에도 이름이 붙는다(원장 제보 2026-08-24 *"담임이 정유진인데 왜 (정유진)이?"*).
   */
  recordedBy: string | null;
  recordedByName: string | null;
  recordSlot: string | null;
};

/** 같은 (반·학생·오늘)의 여러 교시 행 중 **최신** 하나. 기록 없으면 null. */
export function pickClassDayHit(hits: readonly DayHit[]): DayHit | null {
  let best: DayHit | null = null;
  for (const h of hits) {
    if (h.status == null) continue;
    if (!best) {
      best = h;
      continue;
    }
    const a = h.recordedAt ?? "";
    const b = best.recordedAt ?? "";
    if (a > b) best = h;
  }
  return best;
}

export function foldSeating(slots: readonly LiveBoardSlot[]): SeatingClass[] {
  const byClass = new Map<string, LiveBoardSlot[]>();
  for (const slot of slots) {
    (byClass.get(slot.classId) ?? byClass.set(slot.classId, []).get(slot.classId)!).push(slot);
  }
  const out: SeatingClass[] = [];
  for (const list of byClass.values()) {
    const ordered = [...list].sort((a, b) => (a.slotStart < b.slotStart ? -1 : 1));
    const first = ordered[0];
    if (!first) continue;
    // 카드가 대표할 교시 — 지금 열린 것(없으면 다음, 그것도 없으면 마지막). 방·시각·라벨만 여기서 온다.
    const anchorIdx = anchorSlotIndex(ordered);
    const anchor = ordered[anchorIdx] ?? first;
    /** 대표 교시부터 하루 끝까지 — 종료시각(`spanAdjacentEnd`)이 대표 교시에서 시작하게. */
    const fromAnchor = ordered.slice(anchorIdx < 0 ? 0 : anchorIdx);
    /** 카드에 적히는 시각 — 대표 교시가 속한 연속 블록(앞뒤 모두, 쉬는 시간 허용). */
    const block = blockSpanAround(ordered, anchorIdx);
    const roster = new Map<string, LiveStudent>();
    for (const slot of ordered) {
      for (const s of slot.students) roster.set(s.studentId, s);
    }
    const students: SeatingStudent[] = [...roster.values()]
      .map((base) => {
        const hit = pickClassDayHit(
          ordered.map((slot) => {
            const s = slot.students.find((x) => x.studentId === base.studentId);
            return {
              status: s?.status ?? null,
              note: s?.note ?? null,
              recordedAt: s?.recordedAt ?? null,
              recordedBy: s?.recordedBy ?? null,
              recordedByName: s?.recordedByName ?? null,
              recordSlot: s?.recordSlot ?? null,
            };
          }),
        );
        const status = hit?.status ?? null;
        return {
          ...base,
          status,
          note: hit?.note ?? base.note,
          recordSlot: hit?.recordSlot ?? null,
          recordedAt: hit?.recordedAt ?? null,
          // 🔴 base(어느 한 교시의 값)가 아니라 **고른 행(hit)**의 것으로 확정한다 — 안 그러면
          //    다른 교시의 입력자 이름이 이 칸의 시각 옆에 붙는다.
          //    🔴 id도 **반드시 같이** — base엔 기록 없는 교시의 null이 들어 있어, id만 흘리면
          //       담임 판정이 무너져 담임이 찍은 칸에도 이름이 붙는다.
          recordedBy: hit?.recordedBy ?? null,
          recordedByName: hit?.recordedByName ?? null,
          mark: seatMarkOf(status, anchor.phase),
          // 🔴 **저장 축은 하루 첫 교시 그대로**(`first`). 대표 교시로 바꾸면 같은 (학생·반·날)에
          //    교시가 다른 행이 둘 생기고, 그 표는 시수(session_units) → 급여에 닿는다(slot-axis.ts).
          //    화면 읽기는 어차피 "(반·학생·오늘) 최신 하나"라 표시는 그대로인데 **돈만 조용히 달라진다.**
          writeSlot: hit ? (hit.recordSlot ?? null) : saveSlotFor(first.subject, first.slotStart),
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
    out.push({
      classId: first.classId,
      className: first.className,
      subject: first.subject,
      // 담당도 대표 교시 것 — 605호 카드에 랩실 자리 표기(LAB)가 강사 이름인 양 적히면 안 된다.
      teacherName: anchor.teacherName ?? anchor.slotTeacherLabel,
      teacherId: anchor.teacherId,
      // 대표 교시의 방이 우선. 그 교시에 방이 비어 있으면 뒤 교시 → 앞 교시 순으로 아는 이름을 쓴다.
      roomName:
        fromAnchor.find((s) => s.roomName)?.roomName ?? ordered.find((s) => s.roomName)?.roomName ?? null,
      firstStart: anchor.slotStart,
      firstEnd: spanAdjacentEnd(fromAnchor),
      // 카드에 적히는 시각 — 대표 교시가 **속한** 블록 전체(앞 교시까지 거슬러 올라간다).
      blockStart: block.start,
      blockEnd: block.end,
      // 🔑 묶음(band)만은 **전 교시 fold** — 하나라도 열려 있으면 '지금'이다(랩실로 옮긴 반이 '지난'으로
      //    내려가지 않게). 대표 교시는 "어디에 그릴지", band는 "어느 띠에 놓일지"라 질문이 다르다.
      band: foldNowBands(ordered.map((s) => s.band)),
      periodLabel: anchor.periodLabel,
      seatLabel: specialSlotLabel(anchor.slotTeacherLabel),
      // 헤더 색·대기/미출결은 카드에 적힌 시각(=대표 교시) 기준.
      phase: anchor.phase,
      ownedByMe: first.ownedByMe,
      students,
    });
  }
  // 🔑 정렬도 **블록 시작**이다 — 16:20에 시작한 수업이 대표 교시(17:15) 자리에 끼면
  //    "이 수업이 언제 시작했나"와 화면 순서가 어긋난다.
  out.sort((a, b) =>
    a.blockStart === b.blockStart
      ? a.className.localeCompare(b.className, "ko")
      : a.blockStart < b.blockStart
        ? -1
        : 1,
  );
  return out;
}

/**
 * 넘겨받은 **첫 원소(= 카드의 대표 교시)** 부터 끝이 다음에 닿는 동안의 종료시각 — **다만 같은 방에 있는 동안만**.
 * BS4F 20:10~21:05 + 21:05~22:00 → 22:00. 점심으로 끊기면 앞 블록만.
 *
 * 🔴 방이 바뀌면 끊는다. 카드는 **한 강의실 아래**에 놓이는데 종료시각만 계속 이어 붙이면 그 방에
 *    있지도 않은 시간을 그 방의 수업인 양 적는다 — 실측(화요일 본원602): DP6는 14:20~15:00만 602이고
 *    15:00~15:40은 랩실인데 카드가 `14:20~15:40`이라 적혀, 같은 방 LS6(15:00~17:00)와 **겹쳐 보였다**.
 *    그래서 한 강사가 한 방에서 세 반을 동시에 가르치는 그림이 됐다(같은 요일 실측 4쌍, 목 3·금 3·수 1).
 *    슬롯이 겹치는 일은 실제로 없다 — 겹침은 전부 이 이어붙이기가 만든 것이었다.
 * ⚠️ 자리(LAB·JJ) 표기도 방과 같이 본다 — 같은 호수라도 자리 수업은 담당이 다른 별개의 칸이다.
 */
export function spanAdjacentEnd(
  ordered: readonly {
    slotStart: string;
    slotEnd: string | null;
    roomName?: string | null;
    slotTeacherLabel?: string | null;
  }[],
): string | null {
  const first = ordered[0];
  if (!first) return null;
  const sameRoom = (a: (typeof ordered)[number], b: (typeof ordered)[number]) =>
    (a.roomName ?? null) === (b.roomName ?? null) &&
    specialSlotLabel(a.slotTeacherLabel ?? null) === specialSlotLabel(b.slotTeacherLabel ?? null);
  let end = first.slotEnd;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const next = ordered[i]!;
    if (prev.slotEnd == null || prev.slotEnd !== next.slotStart) break;
    if (!sameRoom(prev, next)) break;
    end = next.slotEnd;
  }
  return end;
}

/**
 * 이어진 교시로 보는 **최대 쉬는 시간(분)**. 학원설정 평일 교시표 실측(2026-09-16):
 * 붙어 있거나(16:20→16:20 · 17:15→17:15 · 19:15→19:15) 5분(15:20→15:25) · 10분(18:10→18:20)뿐이다.
 * ⚠️ 운영실 '현재 수업 현황'의 [`BREAK_MAX_MIN`](../../dashboard/overview/continuous-classes.ts)과 같은 값이다 —
 *    같은 사실(쉬는 시간)을 재는 두 자리라 한쪽만 늘리면 두 화면이 다른 수업을 말한다.
 */
export const SEAT_BREAK_MAX_MIN = 10;

const hhmmToMin = (hm: string): number => {
  const [h, m] = hm.split(":");
  return Number(h) * 60 + Number(m);
};

/**
 * 대표 교시가 **속한 연속 블록**의 시작·끝 — 순수(Vitest).
 *
 * `spanAdjacentEnd`와 둘 다 필요한 이유: 저쪽은 대표 교시에서 **앞으로만** 이어 붙이고 끝이 정확히
 * 맞닿을 때만 잇는다. 그래서 ① 수업이 끝나 대표가 마지막 교시로 내려가면 앞 교시가 통째로 빠지고
 * (16:20~18:10 수업이 `17:15~18:10`), ② 5분·10분 쉬는 시간이 낀 교시표에선 아예 안 붙는다
 * (14:20~15:20 + 15:25~16:20 → `15:25~16:20`). 카드에 적히는 시각은 **수업 전체**여야 한다
 * (원장 2026-09-16 *"2-1, 2-2 수업하면 하나로 봐야지"*).
 *
 * 🔴 **방(그리고 자리 표기)이 바뀌면 끊는다** — `spanAdjacentEnd`가 지키던 불변식 그대로다. 영어는
 *    40분마다 랩실↔강의실을 도는 편성이 표준이라, 방을 무시하고 이어 붙이면 그 방에 있지도 않은
 *    시간을 그 방의 수업인 양 적어 같은 방 다른 반과 **겹쳐 보인다**(실측 DP6 14:20~15:40).
 * ⚠️ `ordered`는 `slotStart` 오름차순이어야 한다(foldSeating이 그렇게 넘긴다).
 */
export function blockSpanAround(
  ordered: readonly {
    slotStart: string;
    slotEnd: string | null;
    roomName?: string | null;
    slotTeacherLabel?: string | null;
  }[],
  anchorIdx: number,
): { start: string; end: string | null } {
  const i = anchorIdx < 0 ? 0 : anchorIdx;
  const anchor = ordered[i];
  if (!anchor) return { start: "", end: null };
  const joins = (prev: (typeof ordered)[number], next: (typeof ordered)[number]): boolean => {
    if (prev.slotEnd == null) return false;
    // 겹치는 행(음수 간격)도 이어진 것으로 본다 — 끊어야 할 것은 '띄어진' 수업뿐이다.
    if (hhmmToMin(next.slotStart) - hhmmToMin(prev.slotEnd) > SEAT_BREAK_MAX_MIN) return false;
    return (
      (prev.roomName ?? null) === (next.roomName ?? null) &&
      specialSlotLabel(prev.slotTeacherLabel ?? null) === specialSlotLabel(next.slotTeacherLabel ?? null)
    );
  };
  let start = anchor.slotStart;
  let end = anchor.slotEnd;
  for (let k = i + 1; k < ordered.length; k++) {
    if (!joins(ordered[k - 1]!, ordered[k]!)) break;
    const next = ordered[k]!.slotEnd;
    if (next != null && (end == null || hhmmToMin(next) > hhmmToMin(end))) end = next;
  }
  for (let k = i - 1; k >= 0; k--) {
    if (!joins(ordered[k]!, ordered[k + 1]!)) break;
    start = ordered[k]!.slotStart;
  }
  return { start, end };
}

/**
 * 이어지는 같은 반·같은 강사 교시를 한 카드로 접는다.
 * 예: 초등M 초4 BS1J 14:30~15:25 와 15:25~16:20 → 14:30~16:20 한 장.
 * 끝이 다음에 닿지 않으면(점심 전·후) 묶지 않는다.
 */
export function isAdjacentSlot(a: LiveBoardSlot, b: LiveBoardSlot): boolean {
  return (
    a.classId === b.classId &&
    a.teacherId === b.teacherId &&
    // 저장 축이 같아야 한 칸이다. 수학 연강(둘 다 null)만 묶고,
    // 영어 연속 교시(14:30 / 15:25 = 다른 행·다른 교재)는 묶지 않는다.
    a.saveSlot === b.saveSlot &&
    a.slotEnd != null &&
    a.slotEnd === b.slotStart
  );
}

function mergeAdjacentPair(a: LiveBoardSlot, b: LiveBoardSlot): LiveBoardSlot {
  const roster = new Map<string, LiveStudent>();
  for (const s of [...a.students, ...b.students]) roster.set(s.studentId, s);
  const students = [...roster.values()]
    .map((base) => {
      const hit = pickClassDayHit(
        [a, b].map((slot) => {
          const s = slot.students.find((x) => x.studentId === base.studentId);
          return {
            status: s?.status ?? null,
            note: s?.note ?? null,
            recordedAt: s?.recordedAt ?? null,
            recordedBy: s?.recordedBy ?? null,
            recordedByName: s?.recordedByName ?? null,
            recordSlot: s?.recordSlot ?? null,
          };
        }),
      );
      const status = hit?.status ?? null;
      return {
        ...base,
        status,
        note: hit?.note ?? base.note,
        recordSlot: hit?.recordSlot ?? null,
        recordedAt: hit?.recordedAt ?? null,
        recordedBy: hit?.recordedBy ?? null,
        recordedByName: hit?.recordedByName ?? null,
        signal: base.signal,
      };
    })
    .sort((x, y) => x.studentName.localeCompare(y.studentName, "ko"));
  return {
    ...a,
    slotEnd: b.slotEnd ?? a.slotEnd,
    // 뒤 교시가 시작됐으면 그 국면(앞이 종료여도 '진행 중'으로).
    phase: b.phase !== "before" ? b.phase : a.phase,
    band: foldNowBands([a.band, b.band]),
    students,
    recordedCount: students.filter((s) => s.status != null).length,
    hasAnyRecord: a.hasAnyRecord || b.hasAnyRecord,
    ownedByMe: a.ownedByMe || b.ownedByMe,
  };
}

export function groupAdjacentSlots(slots: readonly LiveBoardSlot[]): LiveBoardSlot[] {
  // 반+강사별로 먼저 모은 뒤 잇는다. 시각 순으로만 훑으면 사이에 다른 반이
  // 끼는 순간(14:30 A, 14:40 B, 15:25 A) 연강 A가 안 붙는다.
  const byKey = new Map<string, LiveBoardSlot[]>();
  for (const slot of slots) {
    const key = `${slot.teacherId ?? ""}|${slot.classId}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(slot);
  }
  const out: LiveBoardSlot[] = [];
  for (const group of byKey.values()) {
    const ordered = [...group].sort((a, b) => (a.slotStart < b.slotStart ? -1 : 1));
    const merged: LiveBoardSlot[] = [];
    for (const slot of ordered) {
      const prev = merged[merged.length - 1];
      if (prev && isAdjacentSlot(prev, slot)) merged[merged.length - 1] = mergeAdjacentPair(prev, slot);
      else merged.push(slot);
    }
    out.push(...merged);
  }
  out.sort((a, b) =>
    a.slotStart === b.slotStart
      ? a.className.localeCompare(b.className, "ko")
      : a.slotStart < b.slotStart
        ? -1
        : 1,
  );
  return out;
}

/**
 * 한 강의실 가로 칸 수. 수학 4교시와 같다.
 * 수업이 2~3개여도 이 폭을 유지하고, 학생은 칸 안에서 다음 줄로 간다.
 */
export const SEATING_PERIOD_COLS = 4;

export function seatingSummary(classes: readonly SeatingClass[]): SeatingSummary {
  let unmarked = 0;
  let absent = 0;
  let recorded = 0;
  let expected = 0;
  for (const c of classes) {
    for (const s of c.students) {
      expected += 1;
      if (s.status != null) recorded += 1;
      if (s.mark === "unmarked") unmarked += 1;
      if (s.mark === "absent") absent += 1;
    }
  }
  return { unmarked, absent, recorded, expected };
}
