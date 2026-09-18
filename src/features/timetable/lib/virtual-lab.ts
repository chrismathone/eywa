/**
 * 시간표 통합뷰의 **\*LAB 임시 칸** — 순수 규칙(IO 없음, Vitest).
 *
 * 원장 2026-09-11: *"만약 랩실에서 드래그로 시간을 이동시키면, 시간표에서도 LAB이 스케줄로 추가되나? 수업설정에는
 * 추가될 필요 없고, 이동된 학생때문에 추가되는거니까 *LAB 같은식으로 임시 추가? 느낌으로 추가시킬 수 있겠나"*
 *
 * 그 반 학생이 자리 출석부에서 **다른 시간 랩실로 옮겨 앉는**(0255a — 하루 `seat_period_moves` · 상시
 * `seat_period_pins`) 요일·교시 칸에 `*LAB`을 띄운다. 칸의 뜻 = "이 반 학생 누가 이 시각에 랩실에 있다".
 *
 * 🔴 **판정은 자리 출석부 명단과 같은 함수다** — 그날의 선택은 `resolveSeatPeriodChoices`, 옮겨 앉는 학생은
 *    `applySeatPeriodChoicesByPeriod`가 세우는 **옮겨 온 묶음(`visiting`)** 그대로다. 새 규칙을 적지 않는다
 *    (두 화면이 한 학생을 다른 교시에 세우면 거짓이다). 그래서 아래가 저절로 따라온다:
 *      · 하루 이동이 상시 고정을 이긴다 · 고정은 `effectiveFrom` 이후 날짜에만(과거는 기록이다)
 *      · 목표 교시가 그날 이 자리에 **실제로 돌아야** 한다(학원 전체 배치 — 화면 필터 뒤 슬롯이 아니다)
 *      · 그 시각에 그 반의 다른 수업(반 BUSY)이 있으면 버린다(기록 키가 겹친다)
 *      · 제 반 자리 교시를 고른 것(하루 두 번 도는 반의 "어느 쪽")은 **자기 칸**이라 *LAB이 아니다
 * 🔴 **표시 전용 파생** — `class_schedules`에 안 쓰고(마이그레이션 0), 슬롯·카드 칸(`card.cells`)·교시축
 *    (`periodRows`)에도 안 넣는다. 그래서 인원·교시 수·반 드래그·학생 드래그 드롭 칸·충돌 검사·엑셀/시트·
 *    강사뷰·빈 교시 판정은 이 칸을 **모른다**(가드 `virtual-lab-wiring.test.ts`).
 * ⚠️ **출결 사실은 싣지 않는다(알려진 한계)** — 자리 출석부는 "사실이 규칙을 이긴다"(그날 이미 찍힌 교시가 그날의
 *    자리)지만 주간 시간표는 **계획(선택)** 을 보여 준다(`markedSlotsByCell: {}`). 그래서 그 반 자리 교시에 **어떤
 *    경로로든** 기록이 찍힌 날 — 자리 라벨 없는 반 출석 포함(자리 출석부의 `markedSlotsByCell`은 라벨을 안 가린다) —
 *    에는 자리 출석부가 그 학생을 제 교시에 세우고 옮겨 온 묶음에서 빼는데, 시간표는 계획대로 `*LAB`을 띄운다.
 *    그날은 **자리 출석부가 진실**이다. (찍은 뒤에 선택을 바꾼 날만 갈리는 게 아니다 — 라벨 없이 찍히는 행은 실제로 생긴다.)
 * ⚠️ 명단 판정 재료는 시간표 명단 줄이다 — 퇴원·대기(휴원·미래 시작)·그 날짜 뒤 시작·예약 전출 이후·분리등원
 *    요일 밖은 뺀다. 전출이 아닌 **미래 종료일**은 시간표 줄에 실리지 않아(퇴원 줄에만 있다) 그 주 안에서
 *    끝나는 수강은 끝난 뒤 요일에도 설 수 있다(알려진 한계 — 이름 표식 `seat-pin-mark`와 같은 재료).
 */
import { MOVABLE_SEATS, hhmm } from "@/features/attendance/seat/seat";
import {
  applySeatPeriodChoicesByPeriod,
  resolveSeatPeriodChoices,
  type ChoiceRoster,
} from "@/features/attendance/seat/period-choice";
import { dowIndexOf, resolveAttendDows } from "@/features/attendance/calendar";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { shortMoveDate } from "./move-date";
import { slotPeriodRow, type DayOfWeek, type PeriodsConfig } from "./periods";
import type { RowSpanPlan } from "./row-span";
import { movableSeatOf, type SeatPinData, type SeatPinRow } from "./seat-pin-mark";
import { DAY_LABEL } from "./split-attendance";
import { dateOfDowInWeek, slotLiveOnDate } from "./week";

/** 칸에 적는 글자 — 원장이 부른 이름 그대로(`*LAB`). 화면 파일에 다시 적지 말 것. */
export const VIRTUAL_LAB_LABEL = "*LAB";

/**
 * 표시 서식 **단일 소스** — LAB 칸(파랑 `bg-blue-soft text-blue`)과 같은 계열이되 **임시**로 읽히게:
 * 바탕을 칠하지 않고 파란 점선 테두리 + 이탤릭.
 * ⚠️ 테두리는 `border`가 아니라 `outline` — 칸의 격자선(border)과 축이 달라 서로를 덮지 않고, 레이아웃도 안 민다.
 * ⚠️ 색은 globals.css에 있는 토큰(`--color-blue`)만 쓴다 — 없는 토큰 유틸은 에러 없이 무색이 된다.
 * 🔴 `[font-synthesis:style]`을 빼지 말 것 — body가 합성을 끄고 Pretendard엔 이탤릭 서체가 없어 이것 없이는 곧게 선다.
 */
export const VIRTUAL_LAB_CELL_CLASS = "text-blue italic [font-synthesis:style] outline-1 outline-dashed -outline-offset-2 outline-blue/60";

/** 0255a `seat_period_moves` 한 줄(앱 표기). `sessionDate`="YYYY-MM-DD", `slotStart`="HH:MM". */
export type SeatMoveRow = { seat: string; sessionDate: string; classId: string; studentId: string; slotStart: string };

/** 그 주 **학원 전체** 자리 배치 한 줄 — 목표 교시가 그날 도는지·끝 시각의 재료(`getSeatLiveSlots`). */
export type SeatLiveSlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string | null;
  slotTeacherLabel: string | null;
  validFrom?: string | null;
  validTo?: string | null;
};

/** 이 모듈이 학생 줄에서 읽는 것 전부 — 시간표 명단 줄(`StudentLine`)이 구조적으로 만족한다. */
type LabStudentLike = {
  studentId: string;
  name: string;
  status: string;
  enrollmentDate?: string | null;
  attendanceDays?: readonly string[];
  movingOut?: { on: string } | null;
};

/** 이 모듈이 슬롯에서 읽는 것 전부 — 시간표 슬롯(`ScheduleSlotWithStudents`)이 구조적으로 만족한다. */
type LabSlotLike = {
  classId: string;
  dayOfWeek: string;
  startTime: string;
  endTime?: string | null;
  slotTeacherLabel?: string | null;
  students: readonly LabStudentLike[];
};

/** 왜 거기 앉는가 — 하루짜리 이동(그 날짜) / 상시 고정(적용일부터 매주). */
export type VirtualLabSource = { kind: "move"; date: string } | { kind: "pin"; effectiveFrom: string };

export type VirtualLabEntry = { studentId: string; name: string; source: VirtualLabSource };

/** `*LAB` 칸 하나 = (반, 요일, 교시 시작) — 그 시각에 랩실로 옮겨 앉는 그 반 학생들. */
export type VirtualLabCell = {
  classId: string;
  dayOfWeek: DayOfWeek;
  /** 그 주 그 요일 칸의 실제 날짜. */
  date: string;
  /** "HH:MM" — 자리 출결 축(`slot_start`)과 같은 값. */
  start: string;
  /**
   * 통합뷰 교시축에서 이 칸이 앉을 행 `order` — 카드 빌더가 평일 슬롯에 쓰는 **같은 함수**(`slotPeriodRow`)로 잰다.
   * 주말은 null — 카드 빌더가 주말 칸을 평일 행으로 끌어올리거나 1교시로 당겨서(행 ≠ 시각) 자리를 못 믿는다.
   */
  order: number | null;
  students: VirtualLabEntry[];
  /** 툴팁 문장(한글) — 화면은 이 문장을 그대로 쓴다. */
  note: string;
};

/** 반 id → 그 반 카드의 `*LAB` 칸들. 서버 컴포넌트가 클라로 넘기므로 평범한 객체. */
export type VirtualLabsByClass = Readonly<Record<string, readonly VirtualLabCell[]>>;

/** 고정·이동이 없거나 판정할 수 없을 때의 빈 값. */
export const NO_VIRTUAL_LABS: VirtualLabsByClass = {};

/**
 * *LAB 재료 두 벌(상시 고정·하루 이동)을 **둘 다 알 때만** 넘긴다 — 하나라도 모르면(조회 실패) null = 그 주엔 칸 없음.
 * 🔴 실패를 "0줄"로 읽으면 **거짓 칸**이 선다 — 자리 출석부의 판정은 두 재료를 **함께** 봐야 나온다:
 *    · 하루 이동을 모르면 → "오늘만 제 교시로" 되돌린 학생이 고정 교시에 `*LAB`으로 선다(자리 출석부는 제 교시에 세운다)
 *    · 고정을 모르면 → 고정 첫날(그날 이동 줄 + 같은 교시 고정)이 "하루만"이 된다(사실은 매주 고정이다)
 *    학원 전체 배치를 모르면(`live=null`) 칸을 안 세우는 것과 같은 원칙이다 — **모르면 안 붙인다**.
 * 🔑 둘 다 0줄이어도 null — page는 이 값이 null이면 학원 전체 배치도 묻지 않는다(평소 왕복 불변, B6).
 * ⚠️ 이름 표식(`seat-pin-mark`)은 이 판정을 안 탄다 — 고정만 보고, 고정 조회가 실패하면 원래대로 안 붙는다.
 */
export function knownLabSources(
  pins: SeatPinData,
  moves: readonly SeatMoveRow[] | null,
): { pins: readonly SeatPinRow[]; moves: readonly SeatMoveRow[] } | null {
  if (pins.failed || moves === null) return null;
  if (pins.pins.length === 0 && moves.length === 0) return null;
  return { pins: pins.pins, moves };
}

/** 시간표 축과 같은 요일 순서(월→일). */
const WEEK_DOWS: readonly DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKEND = new Set<string>(["sat", "sun"]);

type RosterStudent = { id: string; name: string };

/**
 * 그날 이 반 **자리 명단에 서는** 학생인가 — 자리 출석부 명단(`loadSeatDay`)과 같은 두 판정을 같은 함수로.
 *  ① 수강이 그날 유효한가(`isEnrollmentActiveOn` — 예약된 반이동 전출은 그날부터 새 반, 반열림)
 *  ② 분리등원이면 그 요일에 오는가(`resolveAttendDows`)
 * 퇴원·대기(휴원·미래 시작)는 시간표 기준일 시점 상태로 먼저 뺀다.
 */
export function onSeatRosterOn(s: LabStudentLike, date: string, dow: string): boolean {
  if (s.status !== "active") return false;
  const enrolled = isEnrollmentActiveOn(
    {
      startDate: s.enrollmentDate ?? "",
      endDate: s.movingOut?.on ?? null,
      onHold: false,
      isTransferred: s.movingOut != null,
    },
    date,
  );
  if (!enrolled) return false;
  const idx = dowIndexOf(dow);
  const dows = resolveAttendDows(s.attendanceDays ?? [], idx >= 0 ? [idx] : []);
  return dows.length === 0 || dows.includes(idx);
}

/**
 * 이 학생이 왜 그 교시에 앉는가 — 하루짜리가 이긴다(`resolveSeatPeriodChoices`와 같은 순서).
 * 🔑 단 **고정을 거는 날엔 그날 이동 줄도 같은 교시로 함께 쓰인다**(`moveSeatStudentPeriod` — 그날 이동 upsert 뒤에
 *    '고정할까요?' 확인이면 `effective_from` = 그 날짜로 고정 upsert). 그 이동은 고정을 **되풀이할 뿐**이라, 적용 중인
 *    고정이 같은 교시를 가리키면 출처는 고정이다 — 안 그러면 고정 첫날마다 툴팁은 "하루만", 같은 카드의 이름 표식
 *    (`seat-pin-mark`)은 "고정"이라 말한다. 이동이 다른 교시를 가리키거나(오늘만 딴 데로) 고정이 아직 적용 전이면
 *    (미래 시작) 하루짜리다 — 그래서 아래 `effectiveFrom <= date`는 이 판정의 몫이다(선택 함수가 거른 뒤에도 필요하다).
 */
function sourceOf(
  moves: readonly SeatMoveRow[],
  pins: readonly SeatPinRow[],
  classId: string,
  studentId: string,
  date: string,
): VirtualLabSource | null {
  const move = moves.find((m) => m.classId === classId && m.studentId === studentId);
  const pin = pins.find((p) => p.classId === classId && p.studentId === studentId && p.effectiveFrom <= date);
  if (move && !(pin && pin.slotStart === move.slotStart)) return { kind: "move", date };
  return pin ? { kind: "pin", effectiveFrom: pin.effectiveFrom } : null;
}

/**
 * 툴팁 문장 — `임시 LAB · 목 17:00 — 교시 이동: 송지혜(9/10 하루만) · 이현이(9/3부터 매주 목 고정)`.
 * (하루 이동은 **그 날짜의 요일 칸에만** 선다 — 목요일 칸이면 날짜도 목요일이다.)
 * 🔴 raw 코드(`thu`·`move`)를 내보내지 않는다 — 요일은 `DAY_LABEL`, 날짜는 `9/11` 꼴.
 */
export function virtualLabNote(cell: Pick<VirtualLabCell, "dayOfWeek" | "start" | "students">): string {
  const day = DAY_LABEL[cell.dayOfWeek] ?? cell.dayOfWeek;
  const who = cell.students
    .map((s) =>
      s.source.kind === "move"
        ? `${s.name}(${shortMoveDate(s.source.date)} 하루만)`
        : `${s.name}(${shortMoveDate(s.source.effectiveFrom)}부터 매주 ${day} 고정)`,
    )
    .join(" · ");
  return `임시 LAB · ${day} ${cell.start} — 교시 이동: ${who}`;
}

const pushUnique = (map: Record<string, string[]>, key: string, value: string) => {
  const list = (map[key] ??= []);
  if (!list.includes(value)) list.push(value);
};

/**
 * 그 주 통합뷰에 띄울 `*LAB` 칸 — 요일마다 **자리 출석부 하루치 판정을 그대로** 돌려 옮겨 온 묶음만 모은다.
 *
 * @param slots 화면에 선 슬롯(과목·프로그램·학년·강사 범위 필터 뒤) — 칸을 붙일 반과 그 반의 명단·다른 수업.
 * @param live  그 주 **학원 전체** 자리 배치(모르면 null → 다른 시간 선택은 판정하지 않는다 = 칸 없음).
 * @param subject·config 교시축 행 `order`를 카드 빌더와 같은 함수로 재기 위한 재료.
 */
export function buildVirtualLabs(v: {
  slots: readonly LabSlotLike[];
  pins: readonly SeatPinRow[];
  moves: readonly SeatMoveRow[];
  live: readonly SeatLiveSlot[] | null;
  referenceDate: string;
  subject: string;
  config: PeriodsConfig;
}): VirtualLabsByClass {
  if (v.pins.length === 0 && v.moves.length === 0) return NO_VIRTUAL_LABS;
  // 🔴 모르면 안 붙인다 — 목표 교시가 그날 도는지 모르는 채로 칸을 세우면 없는 수업을 지어낸다.
  if (!v.live) return NO_VIRTUAL_LABS;
  const out: Record<string, VirtualLabCell[]> = {};
  for (const seat of MOVABLE_SEATS) {
    for (const dow of WEEK_DOWS) {
      const date = dateOfDowInWeek(v.referenceDate, dow);
      if (!date) continue;
      // 🔴 하루 이동은 **그날**만(그 날짜가 든 주에만 보인다), 고정은 그 요일만 — 자리 출석부 조회와 같은 축.
      const dayMoves = v.moves.filter((m) => m.seat === seat && m.sessionDate === date);
      const dayPins = v.pins.filter((p) => p.seat === seat && p.dayOfWeek === dow);
      if (dayMoves.length === 0 && dayPins.length === 0) continue;

      // 그날 이 자리의 교시(학원 전체) — 시작 → 끝들. 자리 출석부 `periods`와 같은 재료.
      const endsByStart = new Map<string, Set<string>>();
      for (const r of v.live) {
        if (r.dayOfWeek !== dow || movableSeatOf(r.slotTeacherLabel) !== seat) continue;
        if (!slotLiveOnDate(r, v.referenceDate)) continue;
        const start = hhmm(r.startTime);
        if (!start) continue;
        const ends = endsByStart.get(start) ?? new Set<string>();
        if (r.endTime) ends.add(hhmm(r.endTime));
        endsByStart.set(start, ends);
      }

      // 화면에 선 반들의 그날 — 제 자리 교시(`slotsByClass`) · 다른 수업 시작(`busyStartsByClass`) · 명단.
      // 🔴 다른 수업 = **라벨이 붙은** 이 자리 밖 교시 — 자리 출석부(`loadSeatDay`)가 라벨 있는 슬롯만 읽어 같은 판정을 한다.
      const slotsByClass: Record<string, string[]> = {};
      const busyStartsByClass: Record<string, string[]> = {};
      const rosterOf = new Map<string, readonly LabStudentLike[]>();
      for (const s of v.slots) {
        if (s.dayOfWeek !== dow) continue;
        const start = hhmm(s.startTime);
        if (!start) continue;
        if (movableSeatOf(s.slotTeacherLabel) === seat) {
          pushUnique(slotsByClass, s.classId, start);
          if (!rosterOf.has(s.classId)) rosterOf.set(s.classId, s.students);
          // 제 반 자리 교시도 그날의 자리 교시다(학원 전체 배치 조회가 비어도 명단의 출발점은 있어야 한다).
          if (!endsByStart.has(start)) endsByStart.set(start, new Set(s.endTime ? [hhmm(s.endTime)] : []));
        } else if (s.slotTeacherLabel) {
          pushUnique(busyStartsByClass, s.classId, start);
        }
      }
      if (Object.keys(slotsByClass).length === 0) continue;

      const rosterByPeriod: Record<string, ChoiceRoster<RosterStudent>[]> = {};
      for (const start of endsByStart.keys()) rosterByPeriod[start] = [];
      for (const [classId, starts] of Object.entries(slotsByClass)) {
        const students = (rosterOf.get(classId) ?? [])
          .filter((s) => onSeatRosterOn(s, date, dow))
          .map((s) => ({ id: s.studentId, name: s.name }));
        for (const start of starts) rosterByPeriod[start]!.push({ classId, students });
      }

      // 🔑 자리 출석부 하루치와 **같은 함수** — 옮겨 온 묶음(`visiting`)이 곧 `*LAB` 칸이다.
      const applied = applySeatPeriodChoicesByPeriod(rosterByPeriod, {
        choices: resolveSeatPeriodChoices({ moves: dayMoves, pins: dayPins, date }),
        slotsByClass,
        // 출결 사실은 싣지 않는다(파일 머리 ⚠️) — 주간 시간표는 계획을 보여 준다.
        markedSlotsByCell: {},
        busyStartsByClass,
        blank: (s) => s,
      });

      for (const start of Object.keys(applied).sort((a, b) => a.localeCompare(b))) {
        for (const r of applied[start] ?? []) {
          if (!r.visiting) continue;
          const students: VirtualLabEntry[] = [];
          for (const s of r.students) {
            const source = sourceOf(dayMoves, dayPins, r.classId, s.id, date);
            if (source) students.push({ studentId: s.id, name: s.name, source });
          }
          if (students.length === 0) continue;
          const ends = [...(endsByStart.get(start) ?? [])].sort();
          const cell: VirtualLabCell = {
            classId: r.classId,
            dayOfWeek: dow,
            date,
            start,
            // 끝이 하나면 (시작,끝) 짝으로 교시를 찾는다([[#106]] — 시작이 같은 두 교시), 여럿이면 시작만.
            order: WEEKEND.has(dow)
              ? null
              : slotPeriodRow(v.subject, start, dow, v.config, ends.length === 1 ? ends[0] : null).order,
            students,
            note: "",
          };
          cell.note = virtualLabNote(cell);
          (out[r.classId] ??= []).push(cell);
        }
      }
    }
  }
  return Object.keys(out).length === 0 ? NO_VIRTUAL_LABS : out;
}

/** 카드 격자에 행이 없는 `*LAB` — 그 카드에만 격자 아래에 더하는 행(시작 시각 하나 = 행 하나). */
export type VirtualLabRow = { start: string; cells: Partial<Record<string, VirtualLabCell>> };

export type VirtualLabPlacement = {
  /** `${order}:${요일}` → 격자 안에 그릴 칸(그 자리가 비어 있을 때만). */
  inGrid: Readonly<Record<string, VirtualLabCell>>;
  /** 격자에 자리가 없는 칸 — 그 카드에만 행을 더한다(시작 시각 순). */
  extraRows: readonly VirtualLabRow[];
};

export const NO_VIRTUAL_LAB_PLACEMENT: VirtualLabPlacement = { inGrid: {}, extraRows: [] };

const EPS = 1e-6;

/**
 * 한 카드의 `*LAB` 칸을 **어디에 그릴지** — 격자 안(그 교시 행이 섹션에 있고 그 칸이 비어 있을 때) / 카드 아래 추가 행.
 *
 * 🔴 섹션 교시축(`periodRows`)을 늘리지 않는다 — 늘리면 같은 줄의 **다른 카드 전부**에 빈 행이 생기고 엑셀·
 *    빈 교시 판정이 같은 배열을 쓴다. 행이 없으면 **그 카드에만** 더한다(원장에게 알린 설계 그대로).
 * 🔴 칸을 덮지 않는다 — 그 칸에 이미 그 반 수업이 있거나, 이 카드의 접힌 칸(60분 수업을 40분 눈금에 1.5칸,
 *    `row-span`)이 그 행을 지나가면 격자 대신 추가 행으로 뺀다(실제 수업이 가려지는 것보다 한 줄 더 서는 편이 낫다).
 * @param rows 화면이 실제로 그리는 교시 행(`visibleSpanRows` 뒤) — 접혀 감춘 행은 자리가 아니다.
 */
export function placeVirtualLabs(v: {
  labs: readonly VirtualLabCell[];
  cells: Readonly<Record<string, unknown>>;
  rows: readonly { order: number }[];
  plan?: RowSpanPlan | null;
}): VirtualLabPlacement {
  if (v.labs.length === 0) return NO_VIRTUAL_LAB_PLACEMENT;
  const rowIdx = new Map(v.rows.map((r, i) => [r.order, i] as const));
  // 이 카드의 접힌 칸이 덮는 구간 — 요일 → [시작, 끝) (행 단위, 소수 가능).
  const covered = new Map<string, [number, number][]>();
  for (const [from, m] of Object.entries(v.plan?.moved ?? {})) {
    const at = rowIdx.get(m.order);
    if (at === undefined) continue;
    for (const key of Object.keys(v.cells)) {
      const sep = key.lastIndexOf(":");
      if (sep < 0 || key.slice(0, sep) !== from) continue;
      const day = key.slice(sep + 1);
      const list = covered.get(day) ?? [];
      list.push([at + m.offset, at + m.offset + m.span]);
      covered.set(day, list);
    }
  }

  const inGrid: Record<string, VirtualLabCell> = {};
  const extra = new Map<string, VirtualLabRow>();
  for (const lab of v.labs) {
    const idx = lab.order == null ? undefined : rowIdx.get(lab.order);
    const key = `${lab.order}:${lab.dayOfWeek}`;
    const free =
      idx !== undefined &&
      !(key in v.cells) &&
      !(key in inGrid) &&
      !(covered.get(lab.dayOfWeek) ?? []).some(([a, b]) => a < idx + 1 - EPS && b > idx + EPS);
    if (free) {
      inGrid[key] = lab;
      continue;
    }
    let row = extra.get(lab.start);
    if (!row) extra.set(lab.start, (row = { start: lab.start, cells: {} }));
    // 한 반의 같은 (요일, 시작)은 칸이 하나뿐이다(빌더가 시작마다 한 칸으로 모은다) — 두 번째는 올 일이 없다.
    row.cells[lab.dayOfWeek] ??= lab;
  }
  return {
    inGrid,
    extraRows: [...extra.values()].sort((a, b) => a.start.localeCompare(b.start)),
  };
}

/**
 * 카드에만 더한 행의 높이를 **그 카드 재원 칸의 남는 자리**에서 빌린다 — 카드 전체 높이가 이웃 카드·라벨열과
 * 같게 남아 아래 대기·퇴원 줄이 어긋나지 않는다(섹션 안 카드는 같은 높이라야 시트처럼 읽힌다).
 * 🔴 남는 자리보다 많이 빌리지 않는다 — 명단이 잘려 사람이 가려지면 안 된다. 모자라면 그만큼은 그 카드만 길어진다.
 * @param sectionH 재원 칸 높이(명단 접힘이면 0)
 * @param usedH   재원 칸에서 실제로 쓰는 높이(줄 수 × 줄 높이 + 여백)
 */
export function borrowFromRoster(v: { extraH: number; sectionH: number; usedH: number }): number {
  return Math.max(0, Math.min(v.extraH, v.sectionH - v.usedH));
}
