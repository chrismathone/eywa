/**
 * 자리(랩실) **교시 고정** 표식 — 시간표에서 "이 학생은 랩실 시간대를 영구 이동했다"를 한눈에.
 *
 * 원장 2026-09-10: *"랩실 시간대를 영구 이동한 학생은 시간표에서 이렇게 바로 알아볼 수 있게,
 * 파란글씨에 밑줄+이탤릭체로 해주면 좋겠네."*
 *
 * 재료는 0255a `seat_period_pins`(**상시 고정**)뿐이다 — 하루짜리 `seat_period_moves`는 **안 읽는다**.
 * 원장이 말한 것은 "영구 이동"이고, 하루짜리는 그날 자리 출석부의 사정이라 주간 시간표가 말할 사실이 아니다.
 *
 * ## 표식의 뜻과 자리(grain)
 * 🔑 **표식은 학생에게 붙는다 — 칸이 아니라.** 그래서 그 반 명단에 그 학생이 뜨는 곳이면 어디서나 같은
 *    모양이고, **무엇이 고정됐는지는 툴팁**이 말한다(`랩실 교시 고정 · 목 16:20`).
 * 🔴 **"고정된 교시 칸에만" 붙이려던 안은 버렸다** — 시간표 칸은 교시 하나가 아니다.
 *    ① 기본뷰는 요일을 가로 병합해(`weekdayGrouping`, 기본 월~목) 한 칸이 여러 요일을 덮고,
 *    ② 통합뷰 카드 명단은 아예 **반 단위**라(`buildRichCards`가 `first.students`를 그대로 쓴다)
 *       교시 축이 없다. 칸에 매달면 영어의 기본 뷰(통합뷰, 실측 `english.defaultView='integrated'`)에서
 *       표식이 **통째로 안 보인다** — 정작 원장이 매일 여는 화면이 그쪽이다.
 * 🔴 **시간표를 고치는 것이 아니다.** 명단에서 학생을 빼거나 더하지 않는다(그건 자리 출석부의
 *    [`applySeatPeriodChoices`](../../attendance/seat/period-choice.ts) 몫이다). 여기서 바뀌는 것은
 *    **이름의 글꼴과 색**뿐이라 인원 수·검색·드래그·엑셀은 한 글자도 달라지지 않는다.
 *
 * ## 안 붙이는 경우 — 모르면·뜻을 잃었으면 **안 붙인다**
 * 🔴 그 주 그 요일에 그 반의 자리 교시가 **하나뿐**이면 안 붙인다. 옮길 자리가 없으면 "영구 이동"이
 *    성립하지 않는다(자리 출석부의 `SEAT_PERIOD_ONE_SLOT`과 같은 판정).
 * 🔴 고정된 교시가 그 주 시간표에 **없으면**(배치가 바뀌었다) 안 붙인다 — 지난 사실을 현재로 읽히게
 *    하는 쪽이 표식이 없는 것보다 나쁘다.
 * 🔴 `effective_from`보다 **이전 주**엔 안 붙인다. 과거는 기록이지 계획이 아니다(0255a 주석과 같은 결).
 * 🔴 퇴원 줄엔 안 붙인다 — 고정은 지워지지 않고 남는데, 나간 학생에게 파란 밑줄이 서면 "지금 다니는
 *    아이"로 읽힌다.
 */
import { hhmm, MOVABLE_SEATS, SEAT_NAME, seatKeyOf, type SeatKey } from "@/features/attendance/seat/seat";
import { DAY_LABEL } from "./split-attendance";
import { specialSlotLabel } from "./teacher-label";
import { dateOfDowInWeek } from "./week";

/**
 * 표시 서식 **단일 소스** — 원장 지시 그대로 파란 글씨 + 밑줄 + 이탤릭.
 *
 * 🔴 화면 파일에 이 문자열을 다시 적지 말 것(세 뷰가 같은 걸 봐야 "같은 학생이 뷰마다 다르게" 보이지 않는다).
 * 🔑 색은 `text-blue`(의미색 캐논의 info, `--blue`)다 — 이 표에서 **보라(`text-purple`)는 이미 '이동 대기'**가
 *    쓰고 있어(예약된 반 이동) 겹치면 두 사실이 한 색으로 읽힌다. 원장이 고른 파랑이 마침 비어 있던 자리다.
 * ⚠️ 밑줄 색은 지정하지 않는다 — `currentColor`라 글씨 색을 저절로 따라간다(토큰을 하나 더 만들 이유가 없다).
 * ⚠️ `text-blue`는 **자식 span에** 얹는다(줄 전체가 아니라). 줄에는 이미 tone(신입 빨강·전입 초록·검색
 *    표식)이 붙어 있어 같은 축 유틸을 이어 붙이면 승자를 CSS 순서가 정한다([[#116]]) — 상속은 자식이 이긴다.
 */
export const SEAT_PIN_MARK_CLASS = "text-blue italic underline underline-offset-2";

/** 0255a `seat_period_pins` 한 줄(앱 표기). `slotStart`는 "HH:MM", `effectiveFrom`은 "YYYY-MM-DD". */
export type SeatPinRow = {
  seat: string;
  dayOfWeek: string;
  classId: string;
  studentId: string;
  slotStart: string;
  effectiveFrom: string;
};

/** 표식이 붙은 한 건 — 툴팁 문구를 만드는 재료. */
export type SeatPinHit = { seat: SeatKey; dayOfWeek: string; slotStart: string };

/** 시간표 축과 같은 요일 순서 — 툴팁에 여러 건이 실릴 때 월→일로 정렬한다. */
const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * 툴팁 문구 — `랩실 교시 고정 · 목 16:20`. 여러 요일이면 `· 화 16:20 · 목 14:20`으로 이어 붙인다.
 *
 * 🔴 화면에 raw 코드(`thu`·`lab`)를 내보내지 않는다 — 자리 이름은 `SEAT_NAME`, 요일은 `DAY_LABEL`.
 *    모르는 요일 키가 오면 그 값을 그대로 두되(데이터가 어긋난 경우) 문장은 살린다.
 * ⚠️ 자리가 둘 이상 섞이면(랩실+JJ실) 자리 이름을 각 건에 적는다 — 지금은 `MOVABLE_SEATS`가 랩실뿐이라
 *    실제로는 한 자리지만, JJ실이 열리는 날 문장이 조용히 거짓이 되지 않게 미리 갈라 둔다.
 */
export function seatPinNote(hits: readonly SeatPinHit[]): string {
  if (hits.length === 0) return "";
  const sorted = [...hits].sort(
    (a, b) =>
      (DOW_ORDER.indexOf(a.dayOfWeek) + 1 || 99) - (DOW_ORDER.indexOf(b.dayOfWeek) + 1 || 99) ||
      a.slotStart.localeCompare(b.slotStart),
  );
  const seats = new Set(sorted.map((h) => h.seat));
  const one = seats.size === 1 ? SEAT_NAME[sorted[0]!.seat] : null;
  const parts = sorted.map(
    (h) =>
      `${one ? "" : `${SEAT_NAME[h.seat]} `}${DAY_LABEL[h.dayOfWeek] ?? h.dayOfWeek} ${h.slotStart}`,
  );
  return `${one ?? "자리"} 교시 고정 · ${parts.join(" · ")}`;
}

/** 이 슬롯이 **교시를 옮길 수 있는 자리**면 그 자리 키, 아니면 null. */
export function movableSeatOf(slotTeacherLabel: string | null | undefined): SeatKey | null {
  const seat = seatKeyOf(specialSlotLabel(slotTeacherLabel));
  return seat && MOVABLE_SEATS.includes(seat) ? seat : null;
}

/** 이 모듈이 슬롯에서 읽는 것 전부 — 시간표 슬롯(`ScheduleSlotWithStudents`)이 구조적으로 만족한다. */
type PinSlotLike<S> = {
  classId: string;
  dayOfWeek: string;
  startTime: string;
  slotTeacherLabel?: string | null;
  students: S[];
};

/** 이 모듈이 학생 줄에서 읽는 것 전부. `seatPinNote`가 채워지면 화면이 표식을 붙인다. */
type PinStudentLike = { studentId: string; status?: string; seatPinNote?: string };

/**
 * 그 주 시간표 슬롯에 **교시 고정 표식**을 얹는다 — 서버에서 한 번, 세 뷰가 그 결과를 함께 쓴다.
 *
 * 🔑 **명단 배열의 참조 공유를 지킨다.** 한 반의 슬롯들은 같은 `students` 배열 **인스턴스**를 나눠
 *    갖는다(`queries.ts`의 `byClass`). 슬롯마다 새 배열을 만들면 RSC 페이로드가 그만큼 불어난다
 *    (Flight는 같은 참조를 한 번만 싣는다) → 배열 단위로 캐시해 **바뀐 반만** 새 배열을 만든다.
 * ⚠️ 고정이 하나도 없으면 입력을 **그대로** 돌려준다(왕복도 렌더도 지금까지와 글자 그대로 같다).
 */
export function applySeatPinMarks<S extends PinStudentLike, T extends PinSlotLike<S>>(
  slots: readonly T[],
  v: { pins: readonly SeatPinRow[]; referenceDate: string },
): T[] {
  if (v.pins.length === 0) return slots as T[];

  // ① 그 주에 **실제로 도는** 자리 교시를 (자리|반|요일)로 모은다. 슬롯은 이미 요일 칸의 날짜로
  //    유효성이 걸러져 있어(`slotLiveOnDate`), 끝난 배치가 섞이지 않는다.
  const startsByKey = new Map<string, Set<string>>();
  for (const s of slots) {
    const seat = movableSeatOf(s.slotTeacherLabel);
    if (!seat) continue;
    const key = `${seat}|${s.classId}|${s.dayOfWeek}`;
    let set = startsByKey.get(key);
    if (!set) startsByKey.set(key, (set = new Set()));
    set.add(hhmm(s.startTime));
  }

  // ② 반별·학생별로 살아남은 고정을 모은다.
  const hitsByClass = new Map<string, Map<string, SeatPinHit[]>>();
  for (const p of v.pins) {
    const seat = p.seat as SeatKey;
    if (!(MOVABLE_SEATS as readonly string[]).includes(seat)) continue;
    // 그 요일 칸의 **실제 날짜**로 시작일을 판정한다 — 주 단위로 재면 전환 주가 통째로 어긋난다.
    const date = dateOfDowInWeek(v.referenceDate, p.dayOfWeek);
    if (!date || p.effectiveFrom > date) continue;
    const starts = startsByKey.get(`${seat}|${p.classId}|${p.dayOfWeek}`);
    // 자리 교시가 하나뿐이면 옮길 자리가 없고, 고정된 교시가 사라졌으면 그 고정은 이미 뜻을 잃었다.
    if (!starts || starts.size < 2 || !starts.has(p.slotStart)) continue;
    let byStudent = hitsByClass.get(p.classId);
    if (!byStudent) hitsByClass.set(p.classId, (byStudent = new Map()));
    const list = byStudent.get(p.studentId);
    const hit: SeatPinHit = { seat, dayOfWeek: p.dayOfWeek, slotStart: p.slotStart };
    if (list) list.push(hit);
    else byStudent.set(p.studentId, [hit]);
  }
  if (hitsByClass.size === 0) return slots as T[];

  // ③ 명단에 문구를 얹는다 — 배열 인스턴스 단위로 캐시(위 🔑).
  const cache = new Map<S[], S[]>();
  return slots.map((slot) => {
    const byStudent = hitsByClass.get(slot.classId);
    if (!byStudent) return slot;
    let next = cache.get(slot.students);
    if (!next) {
      let changed = false;
      const mapped = slot.students.map((st) => {
        // 퇴원 줄엔 안 붙인다(위 🔴) — 고정은 남아 있어도 그 학생은 이제 안 온다.
        const hits = st.status === "withdrawn" ? undefined : byStudent.get(st.studentId);
        if (!hits) return st;
        changed = true;
        // 제네릭 스프레드라 TS가 `S`로 좁히지 못한다 — 필드 하나를 더할 뿐이라 여기서 단언한다.
        return { ...st, seatPinNote: seatPinNote(hits) } as S;
      });
      next = changed ? mapped : slot.students;
      cache.set(slot.students, next);
    }
    return next === slot.students ? slot : { ...slot, students: next };
  });
}
