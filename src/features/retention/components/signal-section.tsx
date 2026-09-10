import type { LucideIcon } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";

export type SignalRow = {
  id: string;
  name: string;
  sub: string;
  note: string;
  noteTone?: "danger" | "amber" | "dim";
};

const NOTE_CLASS = {
  danger: "text-danger",
  amber: "text-amber",
  dim: "text-text-dim",
} as const;

/** 브리핑 신호 패널 — 제목 + 학생 행 리스트(우측 note). 행 클릭 → 학생 상세. */
export function SignalSection({
  title,
  icon: Icon,
  rows,
  empty,
}: {
  title: string;
  icon: LucideIcon;
  rows: SignalRow[];
  empty: string;
}) {
  return (
    <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
      <header className="border-line flex items-center gap-2 border-b px-4 py-3">
        <span className="text-text-dim flex size-6 items-center justify-center">
          <Icon size={14} strokeWidth={1.8} />
        </span>
        <h3 className="text-foreground text-sm font-bold">{title}</h3>
        <span className="text-text-faint num ml-auto shrink-0 whitespace-nowrap text-xs">{rows.length}명 표시</span>
      </header>
      {rows.length === 0 ? (
        <p className="text-text-faint px-4 py-5 text-xs">{empty}</p>
      ) : (
        <ul className="divide-line divide-y">
          {rows.map((r) => (
            <li key={r.id} className="hover:bg-bg-soft/50 transition">
              <WindowLink href={`/students/${r.id}`} title={r.name} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-xs font-bold">
                    {r.name} <span className="text-text-faint text-xs font-normal">{r.sub}</span>
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-medium ${NOTE_CLASS[r.noteTone ?? "dim"]}`}>
                  {r.note}
                </span>
              </WindowLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
