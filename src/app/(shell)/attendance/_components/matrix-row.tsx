import type { AttendanceMatrix, AttendanceStatus, MatrixStudent } from "@/features/attendance/server/queries";
import type { StudentMoney } from "@/features/attendance/server/teacher-money";
import { formatDows } from "@/features/attendance/calendar";
import { countMarks } from "@/features/attendance/grid/totals";
import { rowKey } from "@/features/attendance/grid/model";
import { AttendanceCell } from "./attendance-cell";
import { RowTotalCells } from "./live-totals";

/** 금액 표시 — 0원과 '자료 없음'을 구분한다(청구서가 없는 달은 "—"). */
export function formatMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("ko-KR");
}

/** 잠긴 칸 툴팁 — 서버 응답과 같은 취지의 한글 문장(raw 코드 노출 금지). */
function lockedMessage(date: string, lockBefore: string): string {
  return `${date} 출결은 수정 기간(7일)이 지나 고칠 수 없습니다 — ${lockBefore} 이후만 수정 가능, 그 전은 관리자에게 요청하세요`;
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
  money,
  lockBefore,
}: {
  student: MatrixStudent;
  /** 이 행이 속한 반 — 셀 저장 대상. 강사 전체 보기에선 행마다 다르다. */
  classId: string;
  matrix: AttendanceMatrix;
  days: AttendanceMatrix["days"];
  holidays: Record<string, string>;
  /** 원장 전용 금액 열(강사 전체 보기). undefined = 열 자체 없음. */
  money?: StudentMoney | null;
  /** 이 날짜 **이전**은 강사가 수정 못 함(7일 창). null = 제한 없음(관리자 이상). */
  lockBefore?: string | null;
}) {
  const marks = matrix.marks[student.id] ?? {};
  const units = matrix.units[student.id] ?? {};
  const attendDows = new Set(student.attendDows);
  const attendLabel = formatDows(student.attendDows);

  return (
    <tr className="hover:bg-bg-soft/40">
      {/* 이름 **위**, 등원요일 **아래** — 같은 반이라도 학생마다 오는 요일이 다르다(분리등원).
          한 줄에 이어 붙이면 이름 열이 이름+요일만큼 넓어져야 해 날짜 칸을 잡아먹는다(원장 2026-08-06:
          "세로폭은 조금 더 키우더라도 요일을 이름 아래로"). 행이 한 줄 높아지는 건 감수한 트레이드오프.
          ⚠️ 열 폭이 고정(colgroup)이라 넘치는 글자는 잘린다 — 원문은 `title`에 남긴다. */}
      <td className="border-line text-foreground sticky left-0 z-10 border-b border-r bg-card px-2 py-1">
        <span className="block truncate text-[12px] leading-tight font-bold" title={student.name}>
          {student.name}
        </span>
        {attendLabel ? (
          <span
            className="text-text-faint block truncate text-[10px] leading-tight font-medium"
            title={`등원 ${attendLabel}`}
          >
            {attendLabel}
          </span>
        ) : null}
      </td>
      <td className="border-line text-text-dim border-b border-r px-1.5 py-1 text-[11px]">
        <span className="block truncate" title={student.grade ?? undefined}>
          {student.grade ?? "—"}
        </span>
      </td>
      <td className="border-line text-text-dim border-b border-r px-1.5 py-1 text-[11px]">
        <span className="block truncate" title={student.school ?? undefined}>
          {student.school ?? "—"}
        </span>
      </td>
      {days.map((d) => {
        // 그 달에 없는 날(placeholder) — 빈 칸(입력 불가). 폭은 다른 칸과 동일(min-w)로 고정.
        if (d.placeholder) {
          return <td key={d.date} className="border-line bg-bg-soft/20 min-w-[30px] border-b border-r" aria-hidden />;
        }
        const holiday = holidays[d.date];
        // 등원요일 = 그 학생이 실제로 오는 날(분리등원 반영) — 공휴일은 휴원이라 제외.
        const attend = attendDows.has(d.dow) && !holiday;
        // 배경(음영·틴트)은 셀을 꽉 채우는 AttendanceCell 버튼이 그린다 — td는 relative 무대만
        // 제공한다(고정 크기 칩에 배경을 주면 셀을 못 채운다, gotcha #66).
        return (
          <td key={d.date} className="border-line relative min-w-[30px] border-b border-r p-0 text-center align-middle">
            <AttendanceCell
              studentId={student.id}
              classId={classId}
              sessionDate={d.date}
              initialStatus={(marks[d.date] as AttendanceStatus | undefined) ?? null}
              note={matrix.notes[student.id]?.[d.date] ?? null}
              initialUnits={units[d.date] ?? null}
              attendDay={attend}
              muted={!!holiday || (!attend && d.isWeekend)}
              locked={lockBefore && d.date < lockBefore ? lockedMessage(d.date, lockBefore) : null}
              derived={!!matrix.derived[student.id]?.[d.date]}
            />
          </td>
        );
      })}
      {money !== undefined ? (
        <>
          {/* 청구·납입은 **학생 단위 총액**(다른 과목 포함) — 반 몫이 아니다. 여러 강사에 걸친 학생은 '공유' 표식. */}
          <td className="border-line text-text-dim num border-b border-l px-2 py-2 text-right text-[11px] whitespace-nowrap">
            {formatMoney(money?.billed ?? null)}
            {money?.shared ? (
              <span
                className="text-text-faint ml-1 text-[10px]"
                title="다른 과목·강사와 함께 쓰는 청구서입니다 — 반별 배분은 회차 확정(수납관리) 후에만 정확합니다"
              >
                공유
              </span>
            ) : null}
          </td>
          <td className="border-line text-foreground num border-b px-2 py-2 text-right text-[11px] whitespace-nowrap">
            {formatMoney(money?.paid ?? null)}
          </td>
        </>
      ) : null}
      {/* 시수·출석률은 **입력을 즉시 따라간다**(클라 집계) — 서버 값은 첫 렌더 폴백. */}
      <RowTotalCells row={rowKey(classId, student.id)} fallback={countMarks(marks, units)} />
    </tr>
  );
}
