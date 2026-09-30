"use client";

import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Toolbar, ToolbarButton, ToolbarChip } from "@/components/toolbar";
import { TOOLBAR_SEARCH_BOX, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { EmbedHiddenInput } from "@/components/embed-link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_LEDGER_FILTERS, filterLedgerRows, groupLedgerRows, ledgerCsv, ledgerMarkKey, ledgerPairKey,
  ledgerSummary, type LedgerFilters } from "../ledger";
import { isVideoHomeworkRange } from "../ledger-roster";
import type { VideoHomeworkLedgerRow, VideoHomeworkMark, VideoHomeworkStatus } from "../types";
import { useLedgerMarks } from "./use-ledger-marks";
import { ClassLedger, LEDGER_STATUS_OPTIONS, type ActiveCell, type SaveLedgerChanges } from "./class-ledger";
import styles from "./video-homework-management.module.css";

function FilterSelect({ label, name, value, options, disabled, onChange }: {
  label: string; name: string; value: string; options: { value: string; label: string }[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const missing = value !== "all" && !options.some((option) => option.value === value);
  return <label className={styles.filter}><span className="sr-only">{label}</span><select className={TOOLBAR_SELECT} name={name} aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value="all">전체 {label}</option>{missing ? <option value={value}>{value} (조회기간에 없음)</option> : null}
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

function RecordEditor({ cell, mark, busy, save, onClose }: { cell: ActiveCell; mark?: VideoHomeworkMark; busy: boolean; save: SaveLedgerChanges; onClose: () => void }) {
  const [status, setStatus] = useState<VideoHomeworkStatus | "unchecked">(mark?.status ?? "unchecked");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!cell.row.editable || busy) return;
    const failed = await save([{ classId: cell.row.classId, studentId: cell.row.studentId, checkDate: cell.date,
      homeworkDate: mark?.homeworkDate ?? null, status: status === "unchecked" ? null : status }]);
    if (!failed.length) onClose();
  }
  return <form className={styles.editor} onSubmit={(event) => void submit(event)}>
    <DialogHeader><DialogTitle>{cell.row.studentName} · {cell.round}회</DialogTitle>
      <DialogDescription>{cell.row.className} · {cell.row.school} {cell.row.grade}</DialogDescription></DialogHeader>
    <label>검사한 수업 날짜<input type="date" value={cell.date} readOnly /></label>
    {mark?.homeworkDate ? <p className={styles.dim}>지난 숙제일 {mark.homeworkDate}</p> : null}
    <div className={styles.statusOptions}>{LEDGER_STATUS_OPTIONS.map((option) => <button key={option.value} type="button" disabled={busy || !cell.row.editable}
      aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>{option.label}</button>)}</div>
    <p className={styles.dim}>미확인으로 바꾸면 이 수업일의 검사 기록이 취소됩니다.</p>
    {cell.row.editable ? <button type="submit" className={styles.primary} disabled={busy}>{busy ? "저장 중…" : "기록 저장"}</button> : <p className={styles.dim}>이 기록은 읽기 전용입니다.</p>}
  </form>;
}

export function VideoHomeworkManagement({ rows, initialMarks, fromDate, toDate, today, initialFilters = DEFAULT_LEDGER_FILTERS }: {
  rows: VideoHomeworkLedgerRow[]; initialMarks: VideoHomeworkMark[]; fromDate: string; toDate: string; today: string; initialFilters?: LedgerFilters;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const query = useDeferredValue(filters.query);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [rangeError, setRangeError] = useState("");
  const { marks, progress, save } = useLedgerMarks(initialMarks);
  const busy = progress !== null;
  const groups = useMemo(() => groupLedgerRows(rows), [rows]);
  const visible = useMemo(() => filterLedgerRows(rows, marks, { ...filters, query }), [rows, marks, filters, query]);
  const tabCounts = useMemo(() => {
    const matches = filterLedgerRows(rows, marks, { ...filters, query, classId: "all" });
    const byClass = new Map<string, number>();
    for (const row of matches) byClass.set(row.classId, (byClass.get(row.classId) ?? 0) + 1);
    return { total: matches.length, byClass };
  }, [rows, marks, filters, query]);
  const visibleByClass = useMemo(() => {
    const byClass = new Map<string, VideoHomeworkLedgerRow[]>();
    for (const row of visible) { const entries = byClass.get(row.classId) ?? []; entries.push(row); byClass.set(row.classId, entries); }
    return byClass;
  }, [visible]);
  const visibleGroups = groups.flatMap((group) => {
    const matching = visibleByClass.get(group.classId);
    return matching?.length ? [{ ...group, rows: matching }] : [];
  });
  const options = useMemo(() => {
    const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })).map((value) => ({ value, label: value }));
    return { subjects: unique(rows.map((row) => row.subject)), schools: unique(rows.map((row) => row.school || "미등록")), grades: unique(rows.map((row) => row.grade || "미등록")) };
  }, [rows]);
  const summary = ledgerSummary(visible, marks);
  const filterKey = JSON.stringify(filters);
  function update<K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) { setFilters((current) => ({ ...current, [key]: value })); }
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      const values = { class: filters.classId, subject: filters.subject, school: filters.school, grade: filters.grade, q: filters.query.trim(), status: filters.status, sort: filters.sort };
      for (const [key, value] of Object.entries(values)) {
        if (!value || value === "all" || key === "sort" && value === "name") url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      }
      url.searchParams.set("from", fromDate); url.searchParams.set("to", toDate);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, fromDate, toDate]);
  function validateRange(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    if (!isVideoHomeworkRange(String(data.get("from")), String(data.get("to")))) {
      event.preventDefault(); setRangeError("시작일과 종료일을 확인해 주세요. 한 번에 최대 366일까지 조회할 수 있습니다.");
    } else setRangeError("");
  }
  function download() {
    const url = URL.createObjectURL(new Blob([ledgerCsv(visibleGroups, marks)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `영상숙제-${fromDate}-${toDate}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={styles.ledger} aria-busy={busy}>
    <form className={styles.filters} action="/lesson-reports/video-homework" method="get" onSubmit={validateRange}>
      <EmbedHiddenInput />
      <Toolbar className={styles.filterRow} gap="gap-2" rail={false}>
        <label className={styles.dateFilter}><span className="sr-only">시작일</span><input className={TOOLBAR_SELECT} aria-label="조회 시작일" name="from" type="date" defaultValue={fromDate} max={today} required disabled={busy} /></label>
        <span className={styles.dateSeparator}>–</span>
        <label className={styles.dateFilter}><span className="sr-only">종료일</span><input className={TOOLBAR_SELECT} aria-label="조회 종료일" name="to" type="date" defaultValue={toDate} max={today} required disabled={busy} /></label>
        <ToolbarButton type="submit" variant="primary" disabled={busy}>기간 조회</ToolbarButton>
        <label className={`${TOOLBAR_SEARCH_BOX} ${styles.search}`}><EyIcon name="search" size={18} /><input aria-label="학생·반·학교 통합 검색" name="q" placeholder="학생·반·학교 검색" value={filters.query} disabled={busy} onChange={(event) => update("query", event.target.value)} /></label>
        <FilterSelect label="반" name="class" value={filters.classId} options={groups.map((group) => ({ value: group.classId, label: group.className }))} disabled={busy} onChange={(value) => update("classId", value)} />
        <FilterSelect label="과목" name="subject" value={filters.subject} options={options.subjects} disabled={busy} onChange={(value) => update("subject", value)} />
        <FilterSelect label="학교" name="school" value={filters.school} options={options.schools} disabled={busy} onChange={(value) => update("school", value)} />
        <FilterSelect label="학년" name="grade" value={filters.grade} options={options.grades} disabled={busy} onChange={(value) => update("grade", value)} />
        <FilterSelect label="수행 상태" name="status" value={filters.status} options={LEDGER_STATUS_OPTIONS.map((option) => ({ value: option.value, label: `${option.label} 있음` }))} disabled={busy} onChange={(value) => update("status", value as LedgerFilters["status"])} />
        <label className={styles.filter}><span className="sr-only">정렬</span><select className={TOOLBAR_SELECT} aria-label="학생 정렬" name="sort" value={filters.sort} disabled={busy} onChange={(event) => update("sort", event.target.value as LedgerFilters["sort"])}>
          <option value="name">이름순</option><option value="missing">미수행 많은 순</option><option value="completion">완료율 낮은 순</option>
        </select></label>
        <ToolbarButton aria-label="필터 초기화" disabled={busy} onClick={() => setFilters({ ...DEFAULT_LEDGER_FILTERS })}>초기화</ToolbarButton>
        <ToolbarButton disabled={busy || !visible.length} onClick={download}>검색 결과 CSV</ToolbarButton>
      </Toolbar>
      {rangeError ? <p role="alert" className={styles.red}>{rangeError}</p> : null}
    </form>
    <div className={styles.classTabs} aria-label="반 바로 선택">
      <ToolbarChip active={filters.classId === "all"} disabled={busy} onClick={() => update("classId", "all")}>전체 반 <small>{tabCounts.total}</small></ToolbarChip>
      {groups.map((group) => <ToolbarChip key={group.classId} active={filters.classId === group.classId} disabled={busy} onClick={() => update("classId", group.classId)}>{group.className} <small>{tabCounts.byClass.get(group.classId) ?? 0}</small></ToolbarChip>)}
    </div>
    <div className={styles.summary} aria-live="polite"><span>검색 결과 <strong>{visible.length}</strong>명·반 <span className={styles.dim}>/ {rows.length}</span></span>
      <span className={styles.green}>완료 <strong>{summary.submitted}</strong>회</span><span className={styles.red}>미수행 <strong>{summary.missing}</strong>회</span><span className={styles.dim}>미확인 {summary.unchecked}회</span>
      <div className={styles.expandActions}><button type="button" onClick={() => setCollapsed(new Set())}>모두 펼치기</button><button type="button" onClick={() => setCollapsed(new Set(groups.map((group) => group.classId)))}>모두 접기</button></div>
    </div>
    <p className={styles.hint}>조회 기간의 반별 수업일 순서가 회차입니다. <EyIcon name="check" size={12} className="inline-block align-middle" /> 완료 · × 미수행 · + 미확인 · — 수업 대상 아님. 수행 상태 필터는 해당 기록이 있는 학생을 찾습니다.</p>
    {progress ? <p className={styles.saving} role="status">기록 저장 중 {progress.done} / {progress.total}건</p> : null}
    {visibleGroups.length ? visibleGroups.map((group) => <ClassLedger key={`${group.classId}:${filterKey}`} group={group} marks={marks} busy={busy} save={save} onEdit={setActive}
      collapsed={collapsed.has(group.classId)} onToggle={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.classId)) next.delete(group.classId); else next.add(group.classId); return next; })} />)
      : <div className={styles.empty}><strong>{rows.length ? "조건에 맞는 학생이 없습니다." : "조회 기간에 영상숙제 대상 수업이 없습니다."}</strong><p>{rows.length ? "검색어와 필터를 조정해 주세요." : "조회 기간이나 보고서의 영상숙제 대상 설정을 확인해 주세요."}</p></div>}
    <Dialog open={active !== null} onOpenChange={(open) => { if (!open && !busy) setActive(null); }}>
      <DialogContent showCloseButton={!busy}>
        {active ? <RecordEditor key={`${ledgerPairKey(active.row)}:${active.date}`} cell={active} mark={marks.get(ledgerMarkKey({ ...active.row, checkDate: active.date }))} busy={busy} save={save} onClose={() => setActive(null)} /> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
