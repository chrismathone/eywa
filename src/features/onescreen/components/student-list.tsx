import { studentStatus } from "../report";
import { subjectTone, toneSolidClass } from "../data";
import type { CellState, OneScreenStudent } from "../types";

const CELL_CLASS: Record<CellState, string> = {
  ok: "bg-primary-soft text-primary",
  warn: "bg-amber-soft text-amber",
  todo: "bg-bg-soft text-text-faint",
};

const CELLS: { key: "prog" | "test" | "rep"; label: string }[] = [
  { key: "prog", label: "진" },
  { key: "test", label: "테" },
  { key: "rep", label: "보" },
];

function StudentRow({
  st,
  active,
  reportCell,
  onClick,
}: {
  st: OneScreenStudent;
  active: boolean;
  reportCell?: CellState;
  onClick: () => void;
}) {
  const s = studentStatus(st);
  // 보(보고서) 셀은 과목별 발송 상태로 재정의 가능 (클라이언트가 reportCellById로 전달).
  const cellState = (key: "prog" | "test" | "rep"): CellState =>
    key === "rep" ? (reportCell ?? s.rep) : s[key];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition ${
        active ? "border-primary bg-primary-soft/40" : "border-transparent hover:bg-bg-soft"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground truncate text-[13px] font-bold">{st.name}</span>
          {st.attendance !== "출석" ? (
            <span
              className={`rounded-sm px-1 py-px text-[10px] font-bold ${
                st.attendance === "지각" ? "bg-amber-soft text-amber" : "bg-danger-soft text-danger"
              }`}
            >
              {st.attendance}
            </span>
          ) : null}
        </div>
        <div className="text-text-faint mt-0.5 flex items-center gap-1.5 text-[11px]">
          <span>{st.grade}</span>
          <span className="flex items-center gap-0.5">
            {st.subjects.map((su, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full ${toneSolidClass(subjectTone(su.name).tone)}`}
                title={su.name}
              />
            ))}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {CELLS.map((c) => (
          <span
            key={c.key}
            title={c.label}
            className={`flex size-5 items-center justify-center rounded-sm text-[10px] font-bold ${CELL_CLASS[cellState(c.key)]}`}
          >
            {c.label}
          </span>
        ))}
      </div>
    </button>
  );
}

export function StudentList({
  students,
  selId,
  onSelect,
  reportCellById,
  classOrder,
}: {
  students: OneScreenStudent[];
  selId: string;
  onSelect: (id: string) => void;
  reportCellById?: Record<string, CellState>;
  /** 반 그룹 표시 순서(보통 시각순). 없으면 등장 순서. */
  classOrder?: readonly string[];
}) {
  // 반별 그룹 — className 없으면 "기타"로.
  const groups = new Map<string, OneScreenStudent[]>();
  for (const st of students) {
    const key = st.className ?? "기타";
    const arr = groups.get(key);
    if (arr) arr.push(st);
    else groups.set(key, [st]);
  }
  const orderedKeys = [
    ...(classOrder ?? []).filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !(classOrder ?? []).includes(k)),
  ];

  return (
    <div className="bg-card border-line shadow-card flex flex-col rounded-md border">
      <header className="border-line flex items-baseline justify-between border-b px-3 py-2.5">
        <p className="micro text-text-faint">학생 · 반별</p>
        <p className="text-text-dim font-mono text-[11px]">{students.length}명</p>
      </header>
      <div className="scrollbar-thin flex max-h-[calc(100vh-220px)] flex-col gap-2 overflow-y-auto p-2 [scrollbar-gutter:stable]">
        {students.length === 0 ? (
          <p className="text-text-faint px-2 py-6 text-center text-xs">해당 반 학생이 없습니다</p>
        ) : (
          orderedKeys.map((key) => {
            const rows = groups.get(key)!;
            return (
              <div key={key} className="flex flex-col gap-1">
                {/* 반 헤더 — sticky로 스크롤 중에도 어느 반인지 보이게 */}
                <div className="bg-card/95 sticky top-0 z-10 flex items-center justify-between px-1.5 py-0.5 backdrop-blur">
                  <span className="text-text-dim truncate text-[11px] font-bold">{key}</span>
                  <span className="text-text-faint shrink-0 font-mono text-[10px]">{rows.length}명</span>
                </div>
                {rows.map((st) => (
                  <StudentRow
                    key={st.id}
                    st={st}
                    active={st.id === selId}
                    reportCell={reportCellById?.[st.id]}
                    onClick={() => onSelect(st.id)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
