"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { buildDetails } from "@/features/dashboard/instruments/details";
import { ALL, drawerView, numberColumns } from "@/features/dashboard/instruments/details-shared";
import type { DetailRow, DetailTable, DetailTrend, Details } from "@/features/dashboard/instruments/details-types";
import { V } from "./engine";
import { VizSlot, useBoard } from "./parts";
import { useWork } from "./work/work-context";

function Seg({ items, active, onPick }: { items: readonly (readonly [string, string])[]; active: string; onPick: (value: string) => void }) {
  return (
    <div className="seg-toggle">
      {items.map(([value, label]) => <button key={value} type="button" aria-pressed={value === active} onClick={() => onPick(value)}>{label}</button>)}
    </div>
  );
}

function Trend({ trend, kind, onKind, range, onRange }: { trend: DetailTrend; kind: string; onKind: (k: string) => void; range: number; onRange: (n: number) => void }) {
  const count = trend.labels.length;
  const ranges = ([[3, "3개월"], [6, "6개월"], [12, "1년"]] as const).filter(([n]) => n < count).map(([n, l]) => [String(n), l] as const);
  const shown = Math.min(range, count);
  const from = Math.max(0, count - shown);
  const drawKind = trend.lineOnly ? "line" : kind || trend.kind || "line";
  return (
    <section className="drawer-trend">
      <div className="drawer-tools">
        <h3>{trend.title}</h3>
        <div className="drawer-toggles">
          {!trend.noRange && count > 3 ? <Seg items={[...ranges, [String(count), "전체"]]} active={String(shown)} onPick={(n) => onRange(Number(n) === count ? Infinity : Number(n))} /> : null}
          {trend.lineOnly ? null : <Seg items={[["line", "꺾은선"], ["bar", "막대"]]} active={drawKind} onPick={onKind} />}
        </div>
      </div>
      <VizSlot h={210} draw={(w, h) => V.trend(w, h, { labels: trend.labels.slice(from), series: trend.series.map((s) => ({ ...s, values: s.values.slice(from) })), ...(trend.money ? { format: V.money } : { unit: trend.unit ?? "" }), ...(trend.zero ? { zero: true } : {}), kind: drawKind, valueLabels: "end", title: trend.title })} />
      {trend.note ? <p className="drawer-note">{trend.note}</p> : null}
    </section>
  );
}

function Table({ table, rows, focus, onNavigate }: { table: DetailTable; rows: DetailRow[]; focus?: string; onNavigate: () => void }) {
  // 펼치는 표 — 처음엔 담임 · 반까지 보이고 학생은 반을 누르면 열린다.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(rows.filter((r) => r.depth === 1).flatMap((r) => (r.id ? [r.id] : []))));
  if (!rows.length) return <section className="drawer-table"><h3>{table.title}</h3><p className="drawer-note">해당하는 항목이 없습니다.</p></section>;
  // 탭을 눌러도 열이 안 뒤집히게 표 전체로 판정한다.
  const numbers = numberColumns(table.rows);
  const alignOf = (j: number) => (numbers.has(j) ? "is-num" : undefined);
  const parents = new Map(rows.flatMap((r) => (r.id ? [[r.id, r.parent] as const] : [])));
  const hasChild = new Set(rows.flatMap((r) => (r.parent ? [r.parent] : [])));
  const shown = rows.filter((r) => { for (let p = r.parent; p; p = parents.get(p)) if (folded.has(p)) return false; return true; });
  const toggle = (id: string) => setFolded((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  return (
    <section className="drawer-table">
      <h3>{table.title} <small>{rows.length}</small></h3>
      <div className="table-wrap">
        <table>
          <thead><tr>{table.cols.map((c, j) => <th scope="col" key={c} className={alignOf(j)}>{c}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id ?? `${r.cells[0]}-${i}`} data-depth={r.depth} className={[focus && r.cells[0] === focus ? "is-focus" : "", r.state ? `is-${r.state}` : ""].filter(Boolean).join(" ") || undefined}>
                {r.cells.map((c, j) => (j === 0
                  ? <th scope="row" key={j}>
                      {r.id && hasChild.has(r.id) ? <button type="button" className="tree-toggle" aria-expanded={!folded.has(r.id)} aria-label={`${c} ${folded.has(r.id) ? "펼치기" : "접기"}`} onClick={() => toggle(r.id!)} /> : null}
                      {r.href ? <WindowLink href={r.href} title={r.linkTitle} onNavigate={onNavigate}>{c}</WindowLink> : c}
                    </th>
                  : <td key={j} className={alignOf(j)}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note ? <p className="drawer-note">{table.note}</p> : null}
    </section>
  );
}

type Open = { key: string; focus?: string; from: HTMLElement | null };

/** 화면 안 상세 — 오른쪽에서 열린다. 과목·학교급 탭은 수치·추세·표를 함께 바꾼다. */
export function Drawer({ details, openRef }: { details: Details; openRef: MutableRefObject<(key: string, focus: string | undefined, from: HTMLElement | null) => void> }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [shown, setShown] = useState(false);
  const [subject, setSubject] = useState(ALL);
  const [level, setLevel] = useState(ALL);
  const [range, setRange] = useState(12);
  const [kind, setKind] = useState("");
  const panel = useRef<HTMLElement>(null);
  // 상세가 없는 키는 열지 않는다(값이 나중에 와서 창이 저절로 뜨지 않게) — 누르는 쪽은 키만 넘긴다.
  const known = useRef(details);
  useEffect(() => { known.current = details; }, [details]);

  useEffect(() => {
    openRef.current = (key, focus, from) => {
      if (!known.current[key]) return;
      setSubject(ALL); setLevel(ALL); setRange(12); setKind("");
      setOpen({ key, focus, from });
    };
  }, [openRef]);

  const close = useCallback(() => {
    setShown(false);
    setOpen((current) => {
      if (current?.from?.isConnected) current.from.focus({ preventScroll: true });
      return null;
    });
  }, []);

  const detail = open ? details[open.key] : undefined;
  const hasDetail = !!detail;
  useEffect(() => {
    if (!hasDetail) return;
    const frame = requestAnimationFrame(() => {
      setShown(true);
      panel.current?.focus({ preventScroll: true });
      // 오늘 수업표는 지금 시간대부터 보이게 — 끝난 수업을 지나 내려가지 않아도 된다.
      panel.current?.querySelector("tr.is-now")?.scrollIntoView({ block: "center" });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button, [tabindex='0']")].filter((el) => el.getBoundingClientRect().width);
      const first = items[0];
      const end = items[items.length - 1];
      if (!first || !end) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); end.focus(); }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); };
  }, [hasDetail, close]);

  const view = useMemo(() => (detail ? drawerView(detail, subject, level) : null), [detail, subject, level]);

  if (!open || !detail || !view) return null;
  return createPortal(
    <div className="aywa-instruments">
      <div className={`drawer-root${shown ? " is-open" : ""}`}>
        <div className="drawer-scrim" onClick={close} />
        <aside ref={panel} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}>
          <header className="drawer-head">
            <div><span className="drawer-period">{detail.period}</span><h2 id="drawer-title">{detail.title}</h2></div>
            <button type="button" className="drawer-close" onClick={close} aria-label="상세 닫기"><EyIcon name="close" size={16} aria-hidden /></button>
          </header>
          <div className="drawer-body">
            {view.subjects.length > 1 || view.levels.length > 1 ? (
              <div className="drawer-facets">
                {view.subjects.length > 1 ? <div className="drawer-facet"><span>과목</span><Seg items={[ALL, ...view.subjects].map((o) => [o, o] as const)} active={subject} onPick={setSubject} /></div> : null}
                {view.levels.length > 1 ? <div className="drawer-facet"><span>학교급</span><Seg items={[ALL, ...view.levels].map((o) => [o, o] as const)} active={level} onPick={setLevel} /></div> : null}
              </div>
            ) : null}
            {view.stats.length ? <dl key={`stats:${subject}|${level}`} className="drawer-stats drawer-swap">{view.stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
            {view.trend ? <Trend trend={view.trend} kind={kind} onKind={setKind} range={range} onRange={setRange} /> : null}
            <div key={`tables:${subject}|${level}`} className="drawer-swap drawer-swap-group">
              {view.tables.map(({ table, rows }) => <Table key={table.title} table={table} rows={rows} focus={open.focus} onNavigate={close} />)}
            </div>
            {detail.link ? <p className="drawer-note"><WindowLink href={detail.link.href} onNavigate={close}>{detail.link.label}</WindowLink></p> : null}
          </div>
        </aside>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 카드 · 수치 칸 · 확인할 일의 상세 — 업무 흐름 값까지 함께 만든다(사람 상세의 맡은 업무 요청 · 업무 요청만 있는 사람의 줄).
 * 업무 값은 업무 흐름 문맥 안에서만 읽혀서 여기서 짓는다.
 */
export function DetailDrawer({ openRef }: { openRef: MutableRefObject<(key: string, focus: string | undefined, from: HTMLElement | null) => void> }) {
  const { snapshot, extras, subjects, eieOn, amounts } = useBoard();
  const { board } = useWork();
  const details = useMemo(
    () => buildDetails({ snapshot, extras, can: (menu) => snapshot.allowed.includes(menu), subjects, eieOn, amounts, work: board.enabled ? board : null }),
    [snapshot, extras, subjects, eieOn, amounts, board],
  );
  return <Drawer details={details} openRef={openRef} />;
}
