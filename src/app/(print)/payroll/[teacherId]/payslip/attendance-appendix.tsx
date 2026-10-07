import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import {
  BADGE_BASE,
  BADGE_TONE,
  DAY_TONE,
  cellDisplay,
  type AttendanceMark,
} from "@/features/attendance/cell-display";
import { BADGE_LABEL, isEnrolledOn } from "@/features/attendance/enrollment-span";
import { countMarks, ratePercent } from "@/features/attendance/grid/totals";
import { attendanceNameTone } from "@/features/attendance/name-tone";
import { VIVID_STUDENT_TONE_STICKY } from "@/features/timetable/lib/student-tone";
import { kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";

/**
 * 급여명세서 **별지 — 그 달 출석부**(원장 2026-08-13: *"인쇄하기 누르면 해당하는 달의 출석부가 같이"* ·
 * *"따로 서식 두지 말고 현재 출석부 반별 서식을 그대로"* · *"퇴원생을 각 반별로도 확인할 수 있게"*).
 *
 * 🔴 **서식을 새로 만들지 않는다.** 열 구성(이름·학교학년·날짜·시수·출석률)·칸 표기와 색(`cellDisplay`)·
 *    날짜 음영(`DAY_TONE`)·이름 옆 표식(`BADGE_TONE`/`BADGE_LABEL`)을 전부 **출석부 화면과 같은 소스**에서
 *    가져온다. 덕분에 '퇴원' 표식이 화면과 종이에서 같은 자리·같은 색으로 나온다(= 반별 퇴원 확인).
 * 🔴 **가로 용지**다(`print-landscape`). 학생×31일은 세로 A4에 안 들어간다.
 * ⚠️ 화면 격자(MatrixTable/MatrixRow)를 그대로는 못 쓴다 — 입력·드래그·sticky를 지고 있어 인쇄에서 깨진다.
 *    그래서 **마크업만** 읽기 전용으로 다시 짜되 표시 규약은 하나도 새로 만들지 않았다.
 * 🔴 **급여명세서 별지는 이름 옆 라벨을 안 단다**(원장 2026-10-07 *"급여 명세서에 신입 종강 라벨은 필요없고, 신입 퇴원만
 *    셀 색상 변경해서 표시하는걸로. 기존 시간표처럼."* · *"이름의 셀 색상을 이용해 표시할것."*). **신입·퇴원만**
 *    이름 칸 배경색으로 말한다 — 색도 판정도 시간표·월별 출석부 이름 칸과 같은 것(`VIVID_STUDENT_TONE_STICKY` ·
 *    `attendanceNameTone`). 전입·전출·종강·등록 31~60일은 명세서에선 표시하지 않는다. 반별 출석부 인쇄·자리 출석부 인쇄는
 *    화면과 같은 표라 종전대로 라벨(`nameStyle="badge"`).
 */
/** 급여 별지 기본 문구. 랩실은 시수가 담임 정산에서 빠져 있어 호출부가 다른 caption을 넘긴다. */
export const PAYSLIP_APPENDIX_CAPTION =
  "칸의 숫자 = 그날 인정된 수업 시수(급여 산정에 들어간 값) · 이름 칸 색 =";

/**
 * 이름 칸 색의 판정 — **화면(월별 출석부 이름 칸)과 같은 함수**(`attendanceNameTone`)에서 신입·퇴원만 취한다.
 * 🔑 기준일 = min(오늘, 표의 마지막 날) — 화면과 같다(지난 달 명세서는 그 달 끝의 사실).
 * 🔴 그 달 표식(`badges`의 `left`)만 보면 **말일 퇴원**이 빠진다 — 그 달엔 "마지막 날까지 재원"이라 표식이 없고 다음 달엔
 *    명단에서 사라져, 화면은 검정인데 종이만 무표시가 된다(적대 리뷰 2026-10-07). 학생 퇴원일(`withdrawnAt`)까지 보는
 *    화면 판정을 그대로 쓴다.
 * 🔴 전입·등록 31~60일·전출·종강은 색을 안 준다(원장 *"신입 퇴원만"*).
 */
function nameToneOf(student: AttendanceMatrix["students"][number], referenceDate: string): "new" | "withdrawn" | null {
  const tone = attendanceNameTone(student.spans, student.withdrawnAt, referenceDate, student.badges);
  return tone === "new" || tone === "withdrawn" ? tone : null;
}
const NAME_TONE_LABEL = { new: "신입", withdrawn: "퇴원" } as const;

/**
 * 자리 별지 머리 문구. **자리 시수를 켠 자리(랩실)만** 급여 근거다 —
 * JJ실처럼 화면만 연 자리는 시수가 여전히 담임 정산에 있어서, 같은 문구를 쓰면 종이가 거짓말을 한다.
 */
export function seatAppendixCaption(payrollSeat: boolean): string {
  return payrollSeat
    ? "칸의 숫자 = 그날 자리 출결 · 시수 열은 자리 표시가 있는 확정 기록만(아르바이트 급여 근거) · 자리 표시가 없는 기록은 아직 담임 정산에 남아 있습니다"
    : "칸의 숫자 = 그날 자리 출결 · 이 자리의 시수는 담임 정산에 들어 있습니다(자리 시수로 따로 잡지 않습니다)";
}

export function AttendanceAppendix({
  groups,
  period,
  teacherName,
  holidays,
  caption = PAYSLIP_APPENDIX_CAPTION,
  unitsByStudent,
  nameStyle = "tone",
}: {
  groups: { classId: string; className: string; matrix: AttendanceMatrix }[];
  period: string;
  teacherName: string;
  /** 'YYYY-MM-DD' → 공휴일 이름. 날짜 음영·글자색을 화면과 맞추는 데 쓴다. */
  holidays: Record<string, string>;
  /** 머리 안내. 기본 = 급여 별지 문구. 랩실은 시수 귀속이 달라 다른 문장을 넘긴다. */
  caption?: string;
  /** 시수 열을 덮어쓴다(랩실: 확정만). 없으면 countMarks. */
  unitsByStudent?: Record<string, number>;
  /**
   * 이름 칸 표시 — `tone`(기본 · 급여명세서) = 신입·퇴원만 이름 칸 색으로, 라벨 없음 /
   * `badge` = 이름 옆 라벨(신입·퇴원·전입·전출·종강 — 화면과 같은 표를 찍는 반별·자리 출석부 인쇄).
   */
  nameStyle?: "tone" | "badge";
}) {
  const drawable = groups.filter((g) => g.matrix.students.length > 0);
  if (drawable.length === 0) return null;
  const [y, m] = period.split("-");

  return (
    // 화면: 가로 A4 콘텐츠 폭(297−20mm)까지, 좁은 창에선 스크롤(⚠️ scroll이 아니라 auto — [[#87]]).
    // 인쇄: 컨테이너 제약을 풀어 용지 전폭.
    <section className="print-landscape mx-auto mt-10 max-w-[277mm] overflow-x-auto bg-white px-8 py-6 text-black break-before-page print:max-w-none print:overflow-visible print:p-0">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">
          {y}년 {Number(m)}월 출석부 — {teacherName}
        </h2>
        <p className="flex flex-wrap items-center gap-x-1 text-[11px]">
          <span>{caption}</span>
          {/* 색의 뜻은 머리에 한 번만 적는다 — 줄마다 라벨을 달지 않는 대신(문구를 바꿔 넘긴 호출부엔 안 붙인다). */}
          {nameStyle === "tone" && caption === PAYSLIP_APPENDIX_CAPTION
            ? (["new", "withdrawn"] as const).map((k) => (
                <span key={k} data-name-legend={k} className={`px-1 ${VIVID_STUDENT_TONE_STICKY[k]}`}>
                  {NAME_TONE_LABEL[k]}
                </span>
              ))
            : null}
        </p>
      </header>

      {drawable.map((g) => (
        <ClassSheet
          key={g.classId}
          className={g.className}
          matrix={g.matrix}
          holidays={holidays}
          unitsByStudent={unitsByStudent}
          nameStyle={nameStyle}
        />
      ))}
    </section>
  );
}

function ClassSheet({
  className,
  matrix,
  holidays,
  unitsByStudent,
  nameStyle,
}: {
  className: string;
  matrix: AttendanceMatrix;
  holidays: Record<string, string>;
  unitsByStudent?: Record<string, number>;
  nameStyle: "tone" | "badge";
}) {
  // 인쇄엔 31칸 패딩이 필요 없다(화면은 열 위치 고정 때문에 채운다) — 실제 날짜만.
  const days = matrix.days.filter((d) => !d.placeholder);
  const classDows = new Set(matrix.classDows);
  // 이름 칸 색 기준일 = min(오늘, 표의 마지막 날) — 화면(`matrix-row.tsx`)과 같은 규칙.
  const today = kstToday();
  const referenceDate = matrix.window.end < today ? matrix.window.end : today;

  const leftNames: string[] = [];
  const rows = matrix.students.map((s) => {
    /**
     * 🔴 **표식은 매트릭스가 준 것을 그대로 쓴다**(원장 2026-09-14 *"급여명세서도 '반이동'과 '퇴원'을
     *    구분해서 퇴원처리해야지"*). 종전엔 여기서 `others: []`로 **다시 계산**해서, 같은 날 이어받은
     *    반이동이 전부 '퇴원'으로 찍혔다 — 화면(월별 출석부)은 다른 반을 보고 '반이동'이라 적는데
     *    원장이 받는 종이만 '퇴원'이라 갈렸다.
     *    `getMonthlyAttendanceMatrix`가 `attachLifecycleBadges`로 다른 반 수강(+`is_transferred`)을 보고
     *    이미 판정해 둔다 — 버리고 다시 셀 이유가 없다.
     * ⚠️ 덕분에 아래 반 머리 '퇴원 N명'에도 반이동생이 안 섞인다(원장이 짚은 바로 그 지점).
     */
    const badges = s.badges;
    const tone = nameStyle === "tone" ? nameToneOf(s, referenceDate) : null;
    // 🔑 반 머리 '퇴원 N명' = 색칠된 이름과 **같은 판정**(급여명세서) — 라벨을 쓰는 인쇄는 종전대로 그 달 표식(`left`).
    if (nameStyle === "tone" ? tone === "withdrawn" : badges.some((b) => b.kind === "left")) leftNames.push(s.name);
    const marks = matrix.marks[s.id] ?? {};
    const units = matrix.units[s.id] ?? {};
    const counted = countMarks(marks, units);
    return {
      student: s,
      badges,
      tone,
      marks,
      units,
      counted,
      unitsShown: unitsByStudent?.[s.id] ?? counted.units,
    };
  });

  return (
    <div className="mb-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[12px] font-semibold">{className}</h3>
        <span className="text-[10px]">명단 {matrix.students.length}명</span>
        {/* 반별 퇴원 확인(원장 요청) — 이름 칸 표시만으론 줄을 훑어야 해서 반 머리에 한 번 더 적는다. */}
        {leftNames.length > 0 ? (
          <span className="text-[10px] font-semibold text-rose-700">
            퇴원 {leftNames.length}명 · {leftNames.join(", ")}
          </span>
        ) : null}
      </div>

      <table className="w-full table-fixed border-collapse text-[9px] leading-none">
        <colgroup>
          <col className="w-[78px]" />
          <col className="w-[58px]" />
          {days.map((d) => (
            <col key={d.date} />
          ))}
          <col className="w-[30px]" />
          <col className="w-[34px]" />
        </colgroup>
        <thead>
          <tr>
            <th className="border border-black/50 bg-black/[0.06] px-1 py-1 text-center font-medium">이름</th>
            <th className="border border-black/50 bg-black/[0.06] px-1 py-1 text-center font-medium">학교·학년</th>
            {days.map((d) => {
              const holiday = holidays[d.date];
              const isClassDay = classDows.has(d.dow) && !holiday;
              // 화면 헤더와 **같은 규칙**: 수업요일(민트) > 주말·휴일(회색) > 평일(흰색), 일요일·휴일 글자 빨강.
              const tone = isClassDay ? DAY_TONE.classDay : d.isWeekend || holiday ? DAY_TONE.weekend : "";
              const fg = d.dow === 0 || holiday ? "text-rose-600" : "";
              return (
                <th
                  key={d.date}
                  title={holiday ?? undefined}
                  className={`border border-black/50 px-0 py-0.5 text-center font-medium ${tone} ${fg}`}
                >
                  <div>{d.day}</div>
                  <div className="text-[7px] font-normal opacity-70">{d.label}</div>
                </th>
              );
            })}
            <th className="border border-black/50 bg-black/[0.06] px-0 py-1 text-center font-medium">시수</th>
            <th className="border border-black/50 bg-black/[0.06] px-0 py-1 text-center font-medium">출석</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rate = ratePercent(r.counted);
            const tone = r.tone;
            return (
              <tr key={r.student.id}>
                <td
                  data-name-tone={tone ?? undefined}
                  title={tone ? NAME_TONE_LABEL[tone] : undefined}
                  className={`border border-black/50 px-1 py-1 ${tone ? VIVID_STUDENT_TONE_STICKY[tone] : ""}`}
                >
                  <span className="flex items-center gap-0.5">
                    <span className="truncate">{r.student.name}</span>
                    {nameStyle === "badge"
                      ? r.badges.map((b) => (
                          <span key={b.kind} className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}>
                            {BADGE_LABEL[b.kind]}
                          </span>
                        ))
                      : null}
                  </span>
                </td>
                <td className="truncate border border-black/50 px-1 py-1">
                  {schoolGradeLabel(r.student.school, r.student.grade)}
                </td>
                {days.map((d) => {
                  const status = (r.marks[d.date] ?? null) as AttendanceMark | null;
                  const holiday = holidays[d.date];
                  const disp = cellDisplay(status, r.units[d.date] ?? null, {
                    attendDay: r.student.attendDows.includes(d.dow) && !holiday,
                    muted: d.isWeekend || !!holiday,
                    outside: !isEnrolledOn(d.date, r.student.spans),
                  });
                  return (
                    <td key={d.date} className={`num border border-black/50 px-0 py-1 text-center ${disp.className}`}>
                      {disp.text}
                    </td>
                  );
                })}
                <td className="num border border-black/50 px-0 py-1 text-center font-semibold">{r.unitsShown}</td>
                <td className="num border border-black/50 px-0 py-1 text-center">{rate === null ? "—" : `${rate}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
