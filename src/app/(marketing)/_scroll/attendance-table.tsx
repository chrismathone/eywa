import { buildAttendance, type AttCell } from "./attendance-data";

function Cell({ cell }: { cell: AttCell }) {
  switch (cell.kind) {
    case "hol": return <td className="d hol">휴</td>;
    case "out": return <td className="d out">—</td>;
    case "off": return <td className="d off" />;
    case "later": return <td className="d" />;
    case "mark":
      return (
        <td className={`d c ${cell.tone}`} data-o={cell.order}>
          <span>{cell.label}</span>
          {cell.memo ? <i className="memo">{cell.memo}</i> : null}
        </td>
      );
  }
}

/**
 * 출석부 장면의 표. 합계 칸은 **최종값**으로 그린다(JS 없이도 맞는 숫자) — 스크롤 애니메이션이 켜지면
 * `landing-motion`이 켜진 칸만큼 다시 센다. 칸의 `data-o` 끝자리 = 학생 순번.
 */
export function AttendanceTable() {
  const { days, rows } = buildAttendance();
  return (
    <table id="attTable">
      <tbody>
        <tr>
          <th className="nm">이름</th>
          {days.map((d) => (
            <th key={d.day} className={d.holiday ? "d hol" : "d"}>{d.day}<small>{d.label}</small></th>
          ))}
          <th className="sum">시수</th>
        </tr>
        {rows.map((r) => (
          <tr key={r.name}>
            <td className="nm">{r.name}{r.note ? <small>{r.note}</small> : null}</td>
            {r.cells.map((c, i) => <Cell key={days[i].day} cell={c} />)}
            <td className="sum num" data-s={r.sum}>{r.sum}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
