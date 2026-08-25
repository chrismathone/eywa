/**
 * 좌석표 칸에 붙는 **출결 체크 시각** — 순수 함수(Vitest).
 *
 * 원장(2026-08-21): *"출결 시간을 학생이름옆에 학생 글자보다 작게 표시하고 싶은데. 출결시간이라함은
 * 선생님이 이 학생에 대해 출석/지각/결석을 마지막으로 체크한시간."* → 위치는 후속 지시로 **이름 아래 줄**,
 * 서식은 *"단순히 kst 기준으로 hh:mm"*.
 *
 * 값의 출처는 `attendance_records.recorded_at` — `setAttendanceCell`이 기존 행을 고칠 때도 갱신하므로
 * 뜻이 정확히 "마지막으로 체크한 시각"이다(새 쿼리 없음, 이미 화면까지 실려 있다).
 *
 * 🔴 **날짜가 다르면 반드시 날짜를 함께 보인다.** 실데이터엔 **미래 수업일을 미리 결석 처리해 둔 행**이
 *    있다(수업일 08-28인데 체크는 08-21). 거기에 `15:08`만 띄우면 *그 날 그 시각에* 찍은 것처럼 읽혀
 *    거짓말이 된다 — 같은 날일 때만 맨 시각, 다르면 `MM/DD`를 앞세운다.
 * 🔴 **판정도 서식도 KST 기준**이다. 서버는 UTC(Vercel)라 안 박으면 9시간 어긋나고, 날짜 비교를 UTC로
 *    하면 밤 시간대(KST 00:00~09:00)에 찍은 기록이 통째로 "다른 날"로 튄다.
 * ⚠️ 현재 시각을 읽지 않는다 — 인자로 받은 값만 쓴다(클라 컴포넌트가 SSR도 되므로 여기서 시각을 읽으면
 *    서버·클라 렌더가 갈려 하이드레이션이 깨진다, [[#108]]).
 */
import { INTAKE_MEMO_SUFFIX } from "../intake/absence-intake";

/**
 * 한 번에 KST 연·월·일·시·분을 뽑는다.
 * `hourCycle: "h23"`가 필요하다 — `hour12: false`만 주면 자정이 `24`로 나오는 ICU 판이 있다
 * (`kstMinutesOfDay`가 같은 이유로 같은 조합을 쓴다).
 */
const KST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

export type AttendanceCheckMark = {
  /** `13:24` — 24시간 KST. */
  time: string;
  /**
   * **수업이 끝난 뒤에 찍었나** — 원장 2026-08-24: *"수업시간 지나서 출결한 건에 대해 출결에 진한 회색
   * 테두리 붙여줄것."* 판정은 (수업일 + 그 반 종료시각) 대 체크 시각.
   * ⚠️ 종료시각을 모르면 **false**(모르면 안 붙인다 — 없는 지연을 만들지 않는다).
   * ⚠️ 미래 수업일을 미리 찍어 둔 행은 수업 **전**이라 false다(날짜까지 넣어 비교하는 이유).
   */
  afterClass: boolean;
  /**
   * `8/28` — **수업일과 다른 날**에 찍었을 때만. 같은 날이면 null(맨 시각만 그린다).
   * 원장 시안 그대로 앞자리 0을 채우지 않는다(좁은 칸에서 한 글자가 아쉽다).
   */
  date: string | null;
  /** 툴팁용 전체 일시 `2026-08-21 13:24` — 칸에는 연도가 안 들어가니까. */
  full: string;
};

/**
 * 그 칸에 그릴 체크 시각. 기록이 없거나(미출결) 값이 이상하면 **null** —
 * 호출부는 아래 줄을 **아예 안 그린다**(빈 자리가 곧 "아직 안 찍음"이다).
 *
 * @param recordedAtIso `attendance_records.recorded_at`(timestamptz ISO)
 * @param boardDateYmd  지금 보고 있는 **수업일**(YYYY-MM-DD, 좌석표 `date` prop)
 * @param classEndHhmm  그 반의 종료시각(`HH:MM`, 카드에 적힌 그 시각). 모르면 지연 판정을 안 한다.
 */
export function attendanceCheckMark(
  recordedAtIso: string | null | undefined,
  boardDateYmd: string | null | undefined,
  classEndHhmm?: string | null,
): AttendanceCheckMark | null {
  if (!recordedAtIso) return null;
  const at = new Date(recordedAtIso);
  if (Number.isNaN(at.getTime())) return null; // 깨진 값에 "Invalid Date"를 화면에 내보내지 않는다
  const parts = KST_PARTS.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const time = `${get("hour")}:${get("minute")}`;
  const ymd = `${year}-${month}-${day}`;
  return {
    time,
    date:
      boardDateYmd && ymd === boardDateYmd ? null : `${Number(month)}/${Number(day)}`,
    full: `${ymd} ${time}`,
    // 날짜까지 이어 붙여 **문자열 그대로** 비교한다(`2026-08-24 18:11` > `2026-08-24 18:10`).
    // 자리 맞춤 형식이라 사전순 = 시간순이고, Date 산술이 없어 서버·클라 결과가 갈리지 않는다.
    afterClass: Boolean(
      boardDateYmd && classEndHhmm && `${ymd} ${time}` > `${boardDateYmd} ${classEndHhmm}`,
    ),
  };
}

/**
 * 칸에 함께 적을 **입력자 이름** — *"담임 이외의 사람이 출결했으면 hh:mm (출결자)"*(원장 2026-08-21).
 *
 * 🔑 기준은 **카드에 이름이 적힌 그 사람**(`SeatingClass.teacherId` = 이미 `teacher-axis`를 거친 값)이다.
 *    그 사람이 찍었으면 카드 머리에 이미 있는 이름을 칸마다 반복할 뿐이라 안 적는다.
 * 🔴 **자리(LAB·JJ)는 아예 안 적는다**(원장 2026-08-24: *"JJ / LAB 은 출결자 표기하지말것"*).
 *    자리 반은 담당이 사람이 아니라 방이라 축이 null이고, 그대로 두면 **모든 칸에** 대신 찍은 한 사람의
 *    이름이 반복돼(실측 8월 자리 반 2,118행 중 1,589행) 정작 봐야 할 시각을 덮는다.
 * ⚠️ id가 **없으면**(레거시 행) 담임 판정을 할 수 없다 — 이름만 보고 적는다. 대신 id는 반드시
 *    이름과 **짝으로** 실려 와야 한다(한쪽만 흘리면 담임이 찍은 칸에도 이름이 붙는다, 원장 제보 08-24).
 * ⚠️ 이름을 모르는 id(퇴사자·시스템)는 **null** — raw uuid를 화면에 내보내지 않는다.
 */
export function seatRecorderName(input: {
  recordedBy?: string | null;
  recordedByName?: string | null;
  classTeacherId?: string | null;
  /** 자리 반이면 `LAB`·`JJ`(`SeatingClass.seatLabel`). 사람 반이면 null. */
  seatLabel?: string | null;
}): string | null {
  if (input.seatLabel) return null;
  const name = input.recordedByName?.trim();
  if (!name) return null;
  if (input.recordedBy && input.classTeacherId && input.recordedBy === input.classTeacherId) {
    return null;
  }
  return name;
}

/**
 * **데스크 접수건인가** — 원장 2026-08-24: *"데스크접수건은 시각 남기지 말것."*
 *
 * 학부모 전화를 받아 미리 처리한 결석은 "선생님이 그 학생을 이 시각에 확인했다"가 아니다. 접수 시각을
 * 수업 칸에 적으면 그 시각에 교실에서 확인한 것처럼 읽힌다 — 그래서 시각 줄을 통째로 안 그린다.
 * 🔑 표식은 접수가 메모에 남기는 한 줄([`INTAKE_MEMO_SUFFIX`](../intake/absence-intake.ts))이다 —
 *    `recorded_via` 컬럼은 저장만 되고 읽는 화면이 없어서 접수 쪽이 일부러 메모에 실어 둔 것이다.
 */
export function isDeskIntakeNote(note: string | null | undefined): boolean {
  return Boolean(note && note.includes(INTAKE_MEMO_SUFFIX));
}
