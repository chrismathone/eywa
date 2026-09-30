/**
 * 월별 출석부 강사 보기의 **다른 반 대신 보강** 목록(읽기 전용, 적대 리뷰 2026-09-30 · 원장 결정 3).
 *
 * 칸은 학생의 반(B반)에 있고 시수는 보강한 강사(A) 몫이라 정산엔 들어가는데 A의 격자엔 B반이 없다 — 이 목록이 그 칸을 보인다
 * (안 보이면 화면 시수와 정산액이 말없이 갈린다). 고치는 곳은 그 반 출석부다(강사 보기 저장은 그 반 칸을 쓸 수 없다).
 * 재료 = [`loadSubstituteCells`](@/features/attendance/server/substitute-cells). 서버 컴포넌트(훅 없음) — 언어는 페이지가 넘긴다.
 */
import type { SubstituteCell } from "@/features/attendance/server/substitute-cells";
import { attendanceLabelOf } from "@/features/class-sheets/lib/attendance-label";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

/** 칩으로 펼쳐 보일 최대 칸 — 나머지는 '외 N칸'(한 달 대신 보강은 보통 몇 칸이다). */
const SHOW_MAX = 24;

export function SubstituteCellsNote({ cells, lang }: { cells: readonly SubstituteCell[]; lang: SheetLang }) {
  if (cells.length === 0) return null;
  const units = cells.reduce((s, c) => s + c.units, 0);
  const shown = cells.slice(0, SHOW_MAX);
  return (
    <section
      aria-label={sheetTf(lang, "att.sub.title", { n: cells.length, units: formatSessionUnits(units) })}
      className="border-line bg-bg-soft shrink-0 border-t px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-foreground text-xs font-bold">
          {sheetTf(lang, "att.sub.title", { n: cells.length, units: formatSessionUnits(units) })}
        </span>
        <span className="border-line text-text-dim rounded-full border px-1.5 py-px text-xs">{sheetT(lang, "att.sub.readonly")}</span>
        <span className="text-text-dim text-xs">{sheetT(lang, "att.sub.desc")}</span>
      </div>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <li
            key={`${c.classId}|${c.studentId}|${c.date}`}
            className="border-line bg-card text-foreground num rounded-full border px-2 py-0.5 text-xs whitespace-nowrap"
          >
            {`${Number(c.date.slice(5, 7))}/${Number(c.date.slice(8, 10))} · ${c.className || "—"} · ${c.studentName || "—"} · ${
              attendanceLabelOf(c.status, lang) ?? c.status
            } ${formatSessionUnits(c.units)}`}
          </li>
        ))}
        {cells.length > shown.length ? (
          <li className="text-text-dim text-xs">{sheetTf(lang, "att.sub.more", { n: cells.length - shown.length })}</li>
        ) : null}
      </ul>
    </section>
  );
}
