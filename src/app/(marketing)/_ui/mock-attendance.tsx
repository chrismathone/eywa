/**
 * MockAttendance — 학생 × 일자 출석 매트릭스 (출석/지각/결석 컬러 셀). 제품 목업.
 */
const STUDENTS = ["강OO", "김OO", "박OO", "이OO", "정OO", "최OO"];
const DAYS = [1, 2, 5, 8, 9, 12, 15, 16, 19, 22, 23, 26];

// 0 없음 · 1 출석 · 2 지각 · 3 결석 (결정적 패턴)
const GRID: number[][] = [
  [1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1],
  [1, 2, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1],
  [1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1],
];

const CELL: Record<number, string> = {
  0: "bg-bg-soft",
  1: "bg-primary/85",
  2: "bg-amber",
  3: "bg-danger",
};

export function MockAttendance() {
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-foreground text-[13px] font-extrabold">출석부 · 중2 수학 A반</p>
        <div className="flex items-center gap-2.5 font-mono text-[9px]">
          <Legend color="bg-primary/85" label="출석" />
          <Legend color="bg-amber" label="지각" />
          <Legend color="bg-danger" label="결석" />
        </div>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: "44px repeat(12, 1fr)" }}>
        <span />
        {DAYS.map((d) => (
          <span key={d} className="text-text-faint text-center font-mono text-[8.5px]">
            {d}
          </span>
        ))}
        {STUDENTS.map((name, r) => (
          <Row key={name} name={name} cells={GRID[r]} />
        ))}
      </div>
    </div>
  );
}

function Row({ name, cells }: { name: string; cells: number[] }) {
  return (
    <>
      <span className="text-text-dim flex items-center truncate text-[10px] font-semibold">{name}</span>
      {cells.map((c, i) => (
        <span key={i} className={`aspect-square rounded-[3px] ${CELL[c]}`} />
      ))}
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-text-faint flex items-center gap-1">
      <span className={`size-2 rounded-[2px] ${color}`} />
      {label}
    </span>
  );
}
