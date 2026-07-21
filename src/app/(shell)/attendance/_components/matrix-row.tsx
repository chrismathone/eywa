import type { AttendanceMatrix, AttendanceStatus, MatrixStudent } from "@/features/attendance/server/queries";
import { COUNTABLE_STATUSES, formatSessionUnits } from "@/features/attendance/session-units";
import { formatDows } from "@/features/attendance/calendar";
import { AttendanceCell } from "./attendance-cell";

/** 한 학생 행의 집계(시수 합·출석률) — 그룹 합계도 같은 계산을 써야 표와 합계가 어긋나지 않는다. */
export function rowTotals(
  marks: Record<string, AttendanceStatus>,
  units: Record<string, number>,
): { unitsTotal: number; rate: number | null; recorded: number; present: number } {
  const entries = Object.entries(marks);
  const present = entries.filter(([, st]) => st === "present").length;
  // 시수 합 = 소비 상태 셀의 배수 합(배수 미입력 = 1). 0.1 단위 반올림(부동소수 방어).
  const unitsTotal =
    Math.round(
      entries
        .filter(([, st]) => COUNTABLE_STATUSES.has(st))
        .reduce((sum, [date]) => sum + (units[date] ?? 1), 0) * 10,
    ) / 10;
  return {
    unitsTotal,
    rate: entries.length > 0 ? Math.round((present / entries.length) * 100) : null,
    recorded: entries.length,
    present,
  };
}

function rateColorOf(rate: number | null): string {
  if (rate === null) return "text-text-faint";
  return rate >= 90 ? "text-primary" : rate >= 80 ? "text-amber" : "text-danger";
}

/**
 * 출석부 매트릭스의 학생 행 하나 — 반별 보기와 강사 전체 보기가 **같은 행 컴포넌트**를 쓴다.
 * (렌더를 두 벌 만들면 급여 계산에 쓰는 숫자가 화면마다 갈린다.)
 */
export function MatrixRow({
  student,
  classId,
  matrix,
  days,
  holidays,
}: {
  student: MatrixStudent;
  /** 이 행이 속한 반 — 셀 저장 대상. 강사 전체 보기에선 행마다 다르다. */
  classId: string;
  matrix: AttendanceMatrix;
  days: AttendanceMatrix["days"];
  holidays: Record<string, string>;
}) {
  const marks = matrix.marks[student.id] ?? {};
  const units = matrix.units[student.id] ?? {};
  const { unitsTotal, rate } = rowTotals(marks, units);
  const attendDows = new Set(student.attendDows);
  const attendLabel = formatDows(student.attendDows);

  return (
    <tr className="hover:bg-bg-soft/40">
      {/* 이름 + 등원요일 — 같은 반이라도 학생마다 오는 요일이 다르다(분리등원). */}
      <td className="border-line text-foreground sticky left-0 z-10 border-b border-r bg-card px-3 py-2 text-[12px] font-bold whitespace-nowrap">
        {student.name}
        {attendLabel ? (
          <span className="text-text-faint ml-1.5 text-[10px] font-medium">{attendLabel}</span>
        ) : null}
      </td>
      <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px] whitespace-nowrap">
        {student.grade ?? "—"}
      </td>
      <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px] whitespace-nowrap">
        {student.school ?? "—"}
      </td>
      {days.map((d) => {
        // 그 달에 없는 날(placeholder) — 빈 칸(입력 불가). 폭은 다른 칸과 동일(min-w)로 고정.
        if (d.placeholder) {
          return <td key={d.date} className="border-line bg-bg-soft/20 min-w-[34px] border-b border-r" aria-hidden />;
        }
        const holiday = holidays[d.date];
        // 등원요일 = 그 학생이 실제로 오는 날(분리등원 반영) — 공휴일은 휴원이라 제외.
        const attend = attendDows.has(d.dow) && !holiday;
        // 배경(음영·틴트)은 셀을 꽉 채우는 AttendanceCell 버튼이 그린다 — td는 relative 무대만
        // 제공한다(고정 크기 칩에 배경을 주면 셀을 못 채운다, gotcha #66).
        return (
          <td key={d.date} className="border-line relative min-w-[34px] border-b border-r p-0 text-center align-middle">
            <AttendanceCell
              studentId={student.id}
              classId={classId}
              sessionDate={d.date}
              initialStatus={(marks[d.date] as AttendanceStatus | undefined) ?? null}
              note={matrix.notes[student.id]?.[d.date] ?? null}
              initialUnits={units[d.date] ?? null}
              attendDay={attend}
              muted={!!holiday || (!attend && d.isWeekend)}
              derived={!!matrix.derived[student.id]?.[d.date]}
            />
          </td>
        );
      })}
      <td className="border-line text-foreground num sticky right-[64px] z-10 w-[52px] min-w-[52px] border-b border-l bg-card px-2 py-2 text-right text-[12px] whitespace-nowrap">
        {unitsTotal > 0 ? formatSessionUnits(unitsTotal) : "—"}
      </td>
      <td
        className={`border-line num sticky right-0 z-10 w-[64px] min-w-[64px] border-b bg-card px-2 py-2 text-right text-[12px] font-bold whitespace-nowrap ${rateColorOf(rate)}`}
      >
        {rate === null ? "—" : `${rate}%`}
      </td>
    </tr>
  );
}
