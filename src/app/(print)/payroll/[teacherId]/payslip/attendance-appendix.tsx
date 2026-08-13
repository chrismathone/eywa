import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import {
  BADGE_BASE,
  BADGE_TONE,
  DAY_TONE,
  cellDisplay,
  type AttendanceMark,
} from "@/features/attendance/cell-display";
import { BADGE_LABEL, isEnrolledOn, lifecycleBadgesInRange } from "@/features/attendance/enrollment-span";
import { countMarks, ratePercent } from "@/features/attendance/grid/totals";
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
 */
export function AttendanceAppendix({
  groups,
  period,
  teacherName,
  holidays,
}: {
  groups: { classId: string; className: string; matrix: AttendanceMatrix }[];
  period: string;
  teacherName: string;
  /** 'YYYY-MM-DD' → 공휴일 이름. 날짜 음영·글자색을 화면과 맞추는 데 쓴다. */
  holidays: Record<string, string>;
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
        <p className="text-[11px]">
          칸의 숫자 = 그날 인정된 수업 시수(급여 산정에 들어간 값) · 이름 옆 표식으로 신입·퇴원·반이동 표시
        </p>
      </header>

      {drawable.map((g) => (
        <ClassSheet key={g.classId} className={g.className} matrix={g.matrix} holidays={holidays} />
      ))}
    </section>
  );
}

function ClassSheet({
  className,
  matrix,
  holidays,
}: {
  className: string;
  matrix: AttendanceMatrix;
  holidays: Record<string, string>;
}) {
  // 인쇄엔 31칸 패딩이 필요 없다(화면은 열 위치 고정 때문에 채운다) — 실제 날짜만.
  const days = matrix.days.filter((d) => !d.placeholder);
  const classDows = new Set(matrix.classDows);
  const range = { first: matrix.window.start, last: matrix.window.end };

  const leftNames: string[] = [];
  const rows = matrix.students.map((s) => {
    // 반이동 판정(transferIn/Out)은 **다른 반 수강**을 알아야 성립한다 — 별지는 반 단위로만 그리므로
    // 그 정보를 넘기지 않고, 근거가 없는 이동을 지어내지 않는다(신입/퇴원만 확실히 표시).
    const badges = lifecycleBadgesInRange(range, s.spans, null, []);
    if (badges.some((b) => b.kind === "left")) leftNames.push(s.name);
    const marks = matrix.marks[s.id] ?? {};
    const units = matrix.units[s.id] ?? {};
    return { student: s, badges, marks, units, counted: countMarks(marks, units) };
  });

  return (
    <div className="mb-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[12px] font-semibold">{className}</h3>
        <span className="text-[10px]">명단 {matrix.students.length}명</span>
        {/* 반별 퇴원 확인(원장 요청) — 이름 옆 표식만으론 31칸을 훑어야 해서 반 머리에 한 번 더 적는다. */}
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
            return (
              <tr key={r.student.id}>
                <td className="border border-black/50 px-1 py-1">
                  <span className="flex items-center gap-0.5">
                    <span className="truncate">{r.student.name}</span>
                    {r.badges.map((b) => (
                      <span key={b.kind} className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}>
                        {BADGE_LABEL[b.kind]}
                      </span>
                    ))}
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
                <td className="num border border-black/50 px-0 py-1 text-center font-semibold">{r.counted.units}</td>
                <td className="num border border-black/50 px-0 py-1 text-center">{rate === null ? "—" : `${rate}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
