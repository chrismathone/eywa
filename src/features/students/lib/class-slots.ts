/**
 * 학생 수업 탭 — 반 배치 행(`class_schedules`) → 화면 슬롯(요일·시각·교시·담당·자리·강의실). 순수(Vitest).
 *
 * `getStudentClassesDetail`(server-only)에서 꺼냈다(2026-09-11) — 원장 *"영어 스케줄에서 교실 정할때
 * 본원nnn 으로 되어있는데, 왜 학생 정보에서 수업 들어가면 그냥 606으로 되어있는 경우가 있지?"*.
 * 규칙을 Vitest로 잠그려면 서버 조회 밖에 있어야 한다. 조회(DB·RLS)는 여전히 queries.ts 몫이다.
 */
import {
  enumDayToKo,
  periodRowText,
  slotPeriodRow,
  type DayOfWeek,
  type PeriodsConfig,
} from "@/features/timetable/lib/periods";
import {
  LAB_ROOM_LABEL,
  resolveTeacherLabel,
  specialSlotLabel,
  type TeacherLabelMap,
} from "@/features/timetable/lib/teacher-label";
// 🔑 자리를 가르는 규칙은 자리 출석부·시간표 격자와 한 벌이다(순수 모듈).
import { labSplitSlotShows } from "@/features/attendance/seat/lab-split";
import { canonicalRoomName, resolveRoomName } from "@/features/attendance/live/seating-floors";

/** 반 배치 한 줄 — DB 원자료를 정리한 모양. 시각 `HH:MM`, 날짜 `YYYY-MM-DD`. */
export type ScheduleRow = {
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  /** 슬롯 강의실 FK(`class_schedules.classroom_id`) — **반 수정 폼이 고르는 값**이라 표시의 진실이다. */
  roomId: string | null;
  /** 시트 원문 라벨 — 건물 없는 호수(`606`)가 흔하다(실측 2026-09-11 영어 유효 배치 321줄 중 207줄). */
  roomLabel: string | null;
  teacherId: string | null;
  teacherLabel: string | null;
  /** '따로 수업(\*LAB)' 교시인가(0271a) — 호출부가 따로 읽어 실어 준다([[#95]]: 뿌리 select에 칸을 안 끼운다). */
  labSeparate?: boolean;
};

/** 개별 슬롯(요일 하나 × 시작시각 하나) — 학생 주간 시간표 격자의 재료. */
export type ClassSlot = {
  day: DayOfWeek;
  startTime: string;
  /** 종료시각 — 격자가 교시 행을 (시작,종료) 짝으로 고르고([[#106]]) 연속 교시를 이을지 볼 때 쓴다. */
  endTime: string;
  periodLabel: string;
  /** 그 교시의 강의실 — `slotRoomName` 규칙(FK 이름 → 라벨 정정 → 반 기본). 없으면 null. */
  room: string | null;
  /**
   * **그 교시의 담당**(반 담임이 아니다) — 원장 2026-09-07 *"영어 주간 시간표에서 스케줄마다 다
   * 선생님이 다르고 JJ실도 있을텐데 표현 제대로"*. 영어는 한 반이 교시마다 담당이 갈린다.
   * 없으면 격자가 반 담임으로 떨어뜨린다(시간표·ECS와 같은 폴백 사슬).
   */
  teacherName: string | null;
  /** 자리(LAB·JJ) 교시면 그 이름 — 사람이 아니라 방이라 화면이 다르게 그린다. */
  seat: string | null;
  /** 그 자리가 '따로 수업(\*LAB)' 교시면 true — 격자가 `LAB` 대신 `*LAB`(이탤릭·밑줄)로 그린다. */
  labSeparate?: true;
};

/**
 * **\*LAB 배정으로 이 원생의 자리 교시를 가른다** — 켠 원생은 \*LAB 교시만, 끈 원생은 일반 LAB 교시만
 * (원장 2026-09-18 *"*lab은 *lab이 체크된 학생만 떠야함"*). 판정은 자리 출석부·시간표 격자와 **같은 함수**
 * [`labSplitSlotShows`](../../attendance/seat/lab-split.ts).
 *
 * 🔴 **모르면(null) 한 줄도 안 뺀다** — 칸이 없거나 조회가 실패했을 때 수업이 사라지는 쪽으로 틀리지 않는다.
 * 🔴 강사 교시·JJ는 그대로 — 가르는 것은 LAB 자리뿐이다.
 */
export function filterLabSeparateRows<R extends Pick<ScheduleRow, "day" | "teacherLabel" | "labSeparate">>(
  rows: readonly R[],
  flagged: boolean | null,
): R[] {
  if (flagged === null) return [...rows];
  const isLab = (r: R) => specialSlotLabel(r.teacherLabel) === LAB_ROOM_LABEL;
  const days = new Map<string, { sep: boolean; normal: boolean }>();
  for (const r of rows) {
    if (!isLab(r)) continue;
    const cur = days.get(r.day) ?? { sep: false, normal: false };
    if (r.labSeparate === true) cur.sep = true;
    else cur.normal = true;
    days.set(r.day, cur);
  }
  return rows.filter((r) => {
    if (!isLab(r)) return true;
    const d = days.get(r.day);
    return labSplitSlotShows({
      slotSeparate: r.labSeparate === true,
      flagged,
      dayHasSeparate: d?.sep === true,
      dayHasNormal: d?.normal === true,
    });
  });
}

/** 등록 강의실 — id → 이름(FK 해석), 이름 목록(맨숫자 라벨 정정의 근거). 보관된 방도 넣는다(옛 배치가 읽혀야 한다). */
export type RoomBook = { nameById: ReadonlyMap<string, string>; names: readonly string[] };

/**
 * 등록 강의실 조회 행 → `RoomBook`. 조회(DB·RLS)는 호출부(queries.ts) 몫이다.
 * 🔴 빈 목록이면 FK 이름을 못 찾아 시트 라벨(`606`)로 떨어진다 — 호출부가 **조회 결과**를 넘기는지는
 *    `teacher-view/room-name.test.ts`의 'FK 우선' 구조 가드가 본다.
 */
export function roomBookOf(rows: readonly { id: string; name: string }[]): RoomBook {
  return { nameById: new Map(rows.map((r) => [r.id, r.name])), names: rows.map((r) => r.name) };
}

/**
 * 기준일에 유효한 배치만([[#88]] — `class_schedules`는 운영 이력을 함께 담는다). `valid_to`는 포함 경계.
 * 전 행이 이력뿐인 특이 데이터는 옛 동작(전 행)으로 폴백 — "시간 미정"으로 거짓 축소하지 않는다.
 * 기준일은 호출부가 정한다: 수강 중이면 오늘, 지난 수강이면 그 수강의 마지막 날(당시 스케줄이 사실).
 */
export function liveScheduleRows(all: readonly ScheduleRow[], refDate: string): ScheduleRow[] {
  const live = all.filter((s) => (!s.validTo || s.validTo >= refDate) && (!s.validFrom || s.validFrom <= refDate));
  return live.length > 0 ? live : [...all];
}

/**
 * 그 교시의 강의실 — **좌석표·ECS·오늘 출결과 같은 두 함수**(`resolveRoomName` → `canonicalRoomName`)를 탄다.
 * ① 슬롯 FK 이름(`본원606` — 반 수정 폼에서 고른 방) ② FK가 없으면 라벨을 등록 이름으로 정정(`305` → `본원305`,
 * 애매하면 그대로 — `602`는 본원602·바른602 둘에 걸린다) ③ 슬롯에 방이 없으면 반 기본 강의실. 지어내지 않는다.
 * 🔴 라벨을 먼저 쓰던 옛 규칙은 같은 학생·같은 날에 `본원602`와 `602`를 섞었고(실측 박세인 LE1 화요일),
 *    라벨과 FK가 **다른 방**인 배치에선 반 수정 폼과 다른 방을 보여 줬다(실측 중등E_중1 정규 B 화 19:20 —
 *    라벨 `305` / FK `본원301`).
 */
export function slotRoomName(
  s: Pick<ScheduleRow, "roomId" | "roomLabel">,
  classRoomName: string | null,
  rooms: RoomBook,
): string | null {
  return canonicalRoomName(
    resolveRoomName({
      slotClassroomName: s.roomId ? (rooms.nameById.get(s.roomId) ?? null) : null,
      slotRoomLabel: s.roomLabel,
      classClassroomName: classRoomName,
    }),
    rooms.names,
  );
}

/**
 * 유효 배치 → 화면 슬롯. 등원 요일(분리등원)만 남긴다 — `groupSchedule`(텍스트 요약)과 같은 규칙.
 * 교시 담당 = ① 라벨(`Song` 같은 닉네임)을 표시 이름으로 ② 없으면 슬롯 FK 계정 이름 — 시간표·ECS와 같은 두 함수.
 * 🔴 **라벨이 먼저**다(라벨과 FK가 서로 다른 사람을 가리키는 슬롯이 실제로 있다, changelog 2026-07-29).
 * 자리(LAB·JJ)는 라벨이 곧 방 이름이라 사람 자리에 안 들어가고 `seat`로 간다.
 */
export function buildClassSlots(
  rows: readonly ScheduleRow[],
  ctx: {
    subject: string;
    /** 등원 요일(한글, 빈 배열 = 전체). */
    attendanceDaysKo: readonly string[];
    periodsConfig: PeriodsConfig;
    /** 반 기본 강의실(`classes.classroom_id`의 이름) — 슬롯에 방이 없을 때 상속. */
    classRoomName: string | null;
    rooms: RoomBook;
    labelMap: TeacherLabelMap;
    userNameById: ReadonlyMap<string, string>;
  },
): ClassSlot[] {
  return rows
    .filter((s) => ctx.attendanceDaysKo.length === 0 || ctx.attendanceDaysKo.includes(enumDayToKo(s.day)))
    .map((s) => {
      const seat = specialSlotLabel(s.teacherLabel);
      return {
        // 켜진 자리 교시에만 싣는다(화면이 `*LAB`으로 그린다) — 강사 교시엔 뜻이 없다.
        ...(seat === LAB_ROOM_LABEL && s.labSeparate === true ? { labSeparate: true as const } : {}),
        day: s.day,
        startTime: s.startTime,
        endTime: s.endTime,
        // (시작,종료) 짝으로 교시 라벨 — 시작이 같은 두 교시 오매핑 방지([[#106]]).
        periodLabel: periodRowText(slotPeriodRow(ctx.subject, s.startTime, s.day, ctx.periodsConfig, s.endTime)),
        room: slotRoomName(s, ctx.classRoomName, ctx.rooms),
        seat,
        teacherName: seat
          ? null
          : (resolveTeacherLabel(s.teacherLabel, ctx.labelMap) ??
            (s.teacherId ? (ctx.userNameById.get(s.teacherId) ?? null) : null)),
      };
    });
}
