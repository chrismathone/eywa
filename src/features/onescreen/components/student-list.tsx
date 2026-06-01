import { Initial } from "@/components/atoms/initial";
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
  onClick,
}: {
  st: OneScreenStudent;
  active: boolean;
  onClick: () => void;
}) {
  const s = studentStatus(st);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition ${
        active ? "border-primary bg-primary-soft/40" : "border-transparent hover:bg-bg-soft"
      }`}
    >
      <Initial name={st.name} size="sm" color={active ? "primary" : "neutral"} />
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
            className={`flex size-5 items-center justify-center rounded-sm text-[10px] font-bold ${CELL_CLASS[s[c.key]]}`}
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
}: {
  students: OneScreenStudent[];
  selId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="bg-card border-line shadow-card flex flex-col rounded-md border">
      <header className="border-line flex items-baseline justify-between border-b px-3 py-2.5">
        <p className="micro text-text-faint">학생</p>
        <p className="text-text-dim font-mono text-[11px]">{students.length}명</p>
      </header>
      <div className="scrollbar-thin flex max-h-[calc(100vh-220px)] flex-col gap-1 overflow-y-auto p-2">
        {students.length === 0 ? (
          <p className="text-text-faint px-2 py-6 text-center text-xs">해당 반 학생이 없습니다</p>
        ) : (
          students.map((st) => (
            <StudentRow
              key={st.id}
              st={st}
              active={st.id === selId}
              onClick={() => onSelect(st.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
