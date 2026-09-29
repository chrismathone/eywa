"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ComponentProps, type ReactNode } from "react";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

export type AttendanceColumn = "school" | "unitPrice" | "classBilled" | "actualAmount" | "actualSalary" | "units" | "termSessions" | "diff";
const HiddenColumns = createContext<readonly AttendanceColumn[]>([]);
const LABELS = {
  school: "att.col.schoolGrade", unitPrice: "att.col.unitPrice", classBilled: "att.col.classBilled",
  actualAmount: "att.col.actualAmount", actualSalary: "att.col.actualSalary", units: "att.col.lessonCount", termSessions: "att.col.termSessions", diff: "att.col.sessionDiff",
} as const;

/** Keep the full-table day width, then subtract only the widths of hidden columns. */
export function AttendanceColumns({ children, columns, minWidth, dayCount, dayMinWidth, lang, extra, leading, tools }: {
  children: ReactNode;
  columns: readonly { key: AttendanceColumn; width: number }[];
  minWidth: number;
  dayCount: number;
  dayMinWidth: number;
  lang: SheetLang;
  /** '보기 옵션' 오른쪽 — 비율 설정·실급여 보이기(관리자 전용, 서버가 권한을 보고 넣는다). */
  extra?: ReactNode;
  /** 같은 줄 왼쪽 — 범례·시수 기준·칸 안내(원장 2026-09-21 한 줄로). */
  leading?: ReactNode;
  /** 같은 줄 오른쪽 맨 앞 — 결석 통보 접수·급여명세서(툴바가 한 줄에 들어가도록 이 줄로 내렸다). */
  tools?: ReactNode;
}) {
  const [hidden, setHidden] = useState<AttendanceColumn[]>([]);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); menu.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // 🔴 폭은 **표가 실제로 들어가는 스크롤 영역의 안쪽 폭**(clientWidth = 세로 스크롤바 뺀 폭)으로 잰다(원장 2026-09-29
    //    *"출석부가 자꾸 가로스크롤이 생기네? 왼쪽 탭 on/off에 상관없이"*). 바깥 틀(el)의 폭으로 재면 세로 스크롤바만큼
    //    표가 늘 넓어서 가로 스크롤이 생겼다. 스크롤바는 행 수에 따라 생겼다 사라지므로 스크롤 영역도 함께 지켜본다.
    //    소수점 날짜 칸 폭이 합쳐 1px 넘치지 않게 내림.
    const scroller = el.querySelector("table")?.parentElement ?? null;
    const measure = () => setViewport(Math.floor(scroller ? scroller.clientWidth : el.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (scroller) observer.observe(scroller);
    measure();
    return () => observer.disconnect();
  }, []);
  const activeHidden = hidden.filter((key) => columns.some((c) => c.key === key));
  const removedWidth = columns.filter((c) => activeHidden.includes(c.key)).reduce((sum, c) => sum + c.width, 0);
  const fullWidth = Math.max(minWidth, viewport);
  const dayWidth = dayMinWidth + (dayCount ? (fullWidth - minWidth) / dayCount : 0);
  const style = { "--att-full-width": `${fullWidth}px`, "--att-hidden-width": `${removedWidth}px`, "--att-day-width": `${dayWidth}px` } as CSSProperties;
  return <HiddenColumns.Provider value={activeHidden}>
    <div ref={ref} data-att-columns={id} data-help="att-cell" className="flex h-full min-h-0 flex-col gap-1" style={style}>
      <style>{activeHidden.map((key) => `[data-att-columns="${id}"] [data-att-column="${key}"] { display: none; }`).join("\n")}</style>
      {/* 🔴 표 위 **한 줄**(원장 2026-09-21 *"상단에 굳이 2열로 두지말고 하나의 열로 공간 확보"*) —
          왼쪽 범례, 오른쪽 도구. 좁으면 도구 묶음째 다음 줄로 접힌다(묶음 안은 안 끊긴다). */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1">
        {leading}
        <div className="ml-auto flex shrink-0 items-center gap-2 [&>*]:shrink-0">
        {tools}
        <div ref={menu} className="relative">
          <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((prev) => !prev)}
            className="border-line bg-card cursor-pointer rounded border px-2 py-0.5 text-xs">{sheetT(lang, "att.columns.toggle")}</button>
          {/* 오른쪽 끝에 서므로 메뉴는 **오른쪽 정렬**로 편다(왼쪽 정렬이면 창 밖으로 나간다). */}
          {open ? <div role="dialog" aria-label={sheetT(lang, "att.columns.toggle")} className="border-line bg-card absolute right-0 top-full z-[80] mt-1 min-w-40 rounded border p-2 shadow-lg">
            {columns.map(({ key }) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs">
              <input type="checkbox" checked={!activeHidden.includes(key)} onChange={(e) => setHidden((prev) => e.target.checked ? prev.filter((c) => c !== key) : [...prev, key])} />
              {sheetT(lang, LABELS[key])}
            </label>)}
            <button type="button" className="mt-1 text-xs underline" onClick={() => setHidden([])}>{sheetT(lang, "att.columns.all")}</button>
          </div> : null}
        </div>
        {extra}
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  </HiddenColumns.Provider>;
}

/** Group/summary cells must shrink their colspan too, or browsers create phantom columns. */
export function AttendanceColSpan({ colSpan = 1, columns, ...props }: ComponentProps<"td"> & { columns?: readonly AttendanceColumn[] }) {
  const hidden = useContext(HiddenColumns);
  return <td {...props} colSpan={Math.max(1, colSpan - hidden.filter((key) => !columns || columns.includes(key)).length)} />;
}
