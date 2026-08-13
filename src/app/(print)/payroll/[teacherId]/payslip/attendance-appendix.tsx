import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import { STATUS_TEXT, consumedUnits } from "@/features/attendance/cell-display";
import { formatSessionUnits } from "@/features/attendance/session-units";

/**
 * 급여명세서 **별지 — 그 달 출석부**(원장 지시 2026-08-13: *"인쇄하기 누르면 해당하는 달의 출석부가
 * 같이 인쇄되도록. 세로로 인쇄가 힘들면 가로로 회전"*).
 *
 * 🔴 **가로 용지**다(`print-landscape` → `@page landscape-doc`). 학생×31일 격자는 세로 A4에 안 들어간다 —
 *    폭을 줄여 욱여넣으면 칸이 4mm가 돼 읽을 수 없다. 명세서(세로) 뒤에 별지로 붙는다.
 * 🔴 **읽기 전용 복제가 아니라 요약이다** — 출석부 화면의 격자(MatrixTable)는 입력·드래그·정정 이력을 지고
 *    있어 인쇄에 그대로 쓸 수 없다. 여기선 **급여가 실제로 센 값**(소비 시수)만 찍는다.
 * 🔑 칸 값 = `consumedUnits`(결석·인정결석은 0 → 'ㆍ'). 명세서의 '총 시수'와 이 표의 합이 같아야 한다 —
 *    다르면 둘 중 하나가 거짓말이므로, 같은 헬퍼를 쓰고 합계를 나란히 찍는다.
 */
export function AttendanceAppendix({
  groups,
  period,
  teacherName,
}: {
  groups: { classId: string; className: string; matrix: AttendanceMatrix }[];
  period: string;
  teacherName: string;
}) {
  if (groups.length === 0) return null;
  const [y, m] = period.split("-");

  return (
    // 화면: 가로 A4 콘텐츠 폭(297−20mm)까지 늘리되 좁은 창에선 스크롤(⚠️ scroll이 아니라 auto — 안 넘쳐도
    // 트랙을 예약해 '가짜 스크롤바'가 생긴다). 인쇄: 컨테이너 제약을 풀어 용지 전폭.
    <section className="print-landscape mx-auto mt-10 max-w-[277mm] overflow-x-auto bg-white px-8 py-6 text-black break-before-page print:max-w-none print:overflow-visible print:p-0">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-bold">
          {y}년 {Number(m)}월 출석부 — {teacherName}
        </h2>
        <p className="text-[11px]">
          칸의 숫자 = 그날 인정된 수업 시수(급여 산정에 들어간 값) · ㆍ = 결석 · 빈칸 = 수업 없음
        </p>
      </header>

      {groups.map((g) => (
        <ClassSheet key={g.classId} className={g.className} matrix={g.matrix} />
      ))}
    </section>
  );
}

function ClassSheet({ className, matrix }: { className: string; matrix: AttendanceMatrix }) {
  // 인쇄에선 31칸 패딩이 필요 없다(화면은 열 위치 고정 때문에 채운다) — 실제 날짜만 그린다.
  const days = matrix.days.filter((d) => !d.placeholder);
  if (matrix.students.length === 0) return null;

  const unitsOf = (studentId: string, date: string): number | null => {
    const status = matrix.marks[studentId]?.[date];
    if (!status) return null;
    // 하루에 교시가 여럿이면 matrix.units가 그날 합이다(급여가 세는 값과 같은 수).
    const u = matrix.units[studentId]?.[date];
    return consumedUnits(status, u ?? null);
  };

  const rows = matrix.students.map((s) => {
    const cells = days.map((d) => ({ date: d.date, units: unitsOf(s.id, d.date), status: matrix.marks[s.id]?.[d.date] }));
    return { student: s, cells, total: cells.reduce((sum, c) => sum + (c.units ?? 0), 0) };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="mb-5">
      <h3 className="mb-1 text-[12px] font-semibold">{className}</h3>
      <table className="w-full border-collapse text-[9px] leading-none">
        <colgroup>
          <col className="w-[92px]" />
          {days.map((d) => (
            <col key={d.date} />
          ))}
          <col className="w-[40px]" />
        </colgroup>
        <thead>
          <tr>
            <th className="border border-black/60 bg-black/[0.05] px-1 py-1 text-left font-medium">학생</th>
            {days.map((d) => (
              <th
                key={d.date}
                className={`border border-black/60 px-0 py-1 text-center font-medium ${
                  d.isWeekend ? "bg-black/[0.10]" : "bg-black/[0.05]"
                }`}
              >
                {d.day}
              </th>
            ))}
            <th className="border border-black/60 bg-black/[0.05] px-1 py-1 text-center font-medium">시수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.student.id}>
              <td className="truncate border border-black/60 px-1 py-1">{r.student.name}</td>
              {r.cells.map((c) => (
                <td
                  key={c.date}
                  // 결석은 시수가 0이라 숫자로 찍으면 '0'이 격자를 덮는다 — 점 하나로 "왔다 안 왔다"만 남긴다.
                  title={c.status ? STATUS_TEXT[c.status] : undefined}
                  className="num border border-black/60 px-0 py-1 text-center"
                >
                  {c.status ? (c.units && c.units > 0 ? formatSessionUnits(c.units) : "ㆍ") : ""}
                </td>
              ))}
              <td className="num border border-black/60 px-1 py-1 text-center font-semibold">
                {formatSessionUnits(r.total)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="border border-black/60 bg-black/[0.05] px-1 py-1 font-semibold" colSpan={days.length + 1}>
              합계
            </td>
            <td className="num border border-black/60 bg-black/[0.05] px-1 py-1 text-center font-bold">
              {formatSessionUnits(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
