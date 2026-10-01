"use client";

import { useState, type FormEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Toolbar, ToolbarButton } from "@/components/toolbar";
import { TOOLBAR_SEARCH_BOX, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { EmbedHiddenInput } from "@/components/embed-link";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DEFAULT_LEDGER_FILTERS, type LedgerFilters } from "../ledger";
import { isVideoHomeworkRange } from "../ledger-roster";
import { LEDGER_STATUS_OPTIONS } from "./round-editor";
import styles from "./video-homework-management.module.css";

type Option = { value: string; label: string };
const ALL = "all";

function FilterSelect({ label, name, value, options, disabled, onChange }: {
  label: string; name: string; value: string; options: Option[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const missing = value !== ALL && !options.some((option) => option.value === value);
  return <label className={styles.filter}><span className="sr-only">{label}</span><select className={TOOLBAR_SELECT} name={name} aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value={ALL}>전체 {label}</option>{missing ? <option value={value}>{value} (조회기간에 없음)</option> : null}
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

/** 조회 기간·검색·필터 한 줄. 반은 여러 개를 함께 고른다(원장 2026-10-01 *"반도 여러 반 한번에 선택가능하게"*) — 반 칩 줄은 없앴다. */
export function LedgerToolbar({ filters, update, reset, classes, options, fromDate, toDate, today, busy, onDownload }: {
  filters: LedgerFilters; update: <K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) => void; reset: () => void;
  /** 반 선택지 — 이름과 지금 필터에 걸리는 학생 수. */
  classes: (Option & { count: number })[];
  options: { subjects: Option[]; schools: Option[]; grades: Option[] };
  fromDate: string; toDate: string; today: string; busy: boolean; onDownload: (() => void) | null;
}) {
  const [rangeError, setRangeError] = useState("");
  function validateRange(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    if (!isVideoHomeworkRange(String(data.get("from")), String(data.get("to")))) {
      event.preventDefault(); setRangeError("시작일과 종료일을 확인해 주세요. 한 번에 최대 366일까지 조회할 수 있습니다.");
    } else setRangeError("");
  }
  function toggleClass(value: string) {
    if (value === ALL) return update("classIds", []);
    const order = classes.map((option) => option.value);
    const next = filters.classIds.includes(value) ? filters.classIds.filter((id) => id !== value) : [...filters.classIds, value];
    update("classIds", next.sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  }
  return <form className={styles.filters} action="/lesson-reports/video-homework" method="get" onSubmit={validateRange}>
    <EmbedHiddenInput />
    {/* 반 선택은 폼 제출에도 실린다(기간 조회 뒤에도 고른 반이 남게). */}
    {filters.classIds.length ? <input type="hidden" name="class" value={filters.classIds.join(",")} /> : null}
    <Toolbar className={styles.filterRow} gap="gap-2" rail={false}>
      <label className={styles.dateFilter}><span className="sr-only">시작일</span><input className={TOOLBAR_SELECT} aria-label="조회 시작일" name="from" type="date" defaultValue={fromDate} max={today} required disabled={busy} /></label>
      <span className={styles.dateSeparator}>–</span>
      <label className={styles.dateFilter}><span className="sr-only">종료일</span><input className={TOOLBAR_SELECT} aria-label="조회 종료일" name="to" type="date" defaultValue={toDate} max={today} required disabled={busy} /></label>
      <ToolbarButton type="submit" variant="primary" disabled={busy}>기간 조회</ToolbarButton>
      <label className={`${TOOLBAR_SEARCH_BOX} ${styles.search}`}><EyIcon name="search" size={18} /><input aria-label="학생·반·학교 통합 검색" name="q" placeholder="학생·반·학교 검색" value={filters.query} disabled={busy} onChange={(event) => update("query", event.target.value)} /></label>
      <SearchableSelect className={styles.classPicker} triggerClassName={TOOLBAR_SELECT} ariaLabel="반" placeholder="전체 반"
        value={filters.classIds.length ? filters.classIds.join(",") : ALL} multiValues={filters.classIds} multiSummary={(count) => `반 ${count}개`}
        cap={classes.length + 1} onValueChange={toggleClass}
        options={[{ value: ALL, label: "전체 반" }, ...classes.map((option) => ({ value: option.value, label: option.label, hint: `${option.count}명` }))]} />
      <FilterSelect label="과목" name="subject" value={filters.subject} options={options.subjects} disabled={busy} onChange={(value) => update("subject", value)} />
      <FilterSelect label="학교" name="school" value={filters.school} options={options.schools} disabled={busy} onChange={(value) => update("school", value)} />
      <FilterSelect label="학년" name="grade" value={filters.grade} options={options.grades} disabled={busy} onChange={(value) => update("grade", value)} />
      <FilterSelect label="수행 상태" name="status" value={filters.status} options={LEDGER_STATUS_OPTIONS.map((option) => ({ value: option.value, label: `${option.label} 있음` }))} disabled={busy} onChange={(value) => update("status", value as LedgerFilters["status"])} />
      <label className={styles.filter}><span className="sr-only">정렬</span><select className={TOOLBAR_SELECT} aria-label="학생 정렬" name="sort" value={filters.sort} disabled={busy} onChange={(event) => update("sort", event.target.value as LedgerFilters["sort"])}>
        <option value="name">이름순</option><option value="missing">미수행 많은 순</option><option value="completion">완료율 낮은 순</option>
      </select></label>
      <ToolbarButton aria-label="필터 초기화" disabled={busy || JSON.stringify(filters) === JSON.stringify(DEFAULT_LEDGER_FILTERS)} onClick={reset}>초기화</ToolbarButton>
      <ToolbarButton disabled={busy || !onDownload} onClick={() => onDownload?.()}>검색 결과 CSV</ToolbarButton>
    </Toolbar>
    {rangeError ? <p role="alert" className={styles.red}>{rangeError}</p> : null}
  </form>;
}
