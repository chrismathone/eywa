"use client";

import { useState, type FormEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Toolbar, ToolbarButton } from "@/components/toolbar";
import { TOOLBAR_SEARCH_BOX, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { EmbedHiddenInput } from "@/components/embed-link";
import { DEFAULT_LEDGER_FILTERS, type LedgerFilters } from "../ledger";
import { isVideoHomeworkRange } from "../ledger-roster";
import { LEDGER_STATUS_OPTIONS } from "./round-editor";
import styles from "./video-homework-management.module.css";
import { usePathname } from "next/navigation";

type Option = { value: string; label: string };
const ALL = "all";

function FilterSelect({ label, name, value, options, disabled, onChange }: {
  label: string; name: string; value: string; options: Option[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const missing = value !== ALL && !options.some((option) => option.value === value);
  return <label className={styles.filter}><span className="sr-only">{label}</span><select className={TOOLBAR_SELECT} name={name} aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
    <option value={ALL}>전체 {label}</option>{missing ? <option value={value}>{value} (선택 조건에 없음)</option> : null}
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

/**
 * 조회 기간·검색·필터 한 줄. 강사·반·학교는 드롭다운이 아니라 **검색창**에서 찾는다(원장 2026-10-19 *"강사, 반, 학교 는 필터가 아닌
 * 검색에서 검색할 수 있게"* — 10-01의 여러 반 고르기 드롭다운을 걷었다). 강사 이름은 관리자 화면에서만 강사 필터로 읽힌다.
 */
export function LedgerToolbar({ filters, update, reset, searchTeachers, options, fromDate, toDate, today, busy, onDownload }: {
  filters: LedgerFilters; update: <K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) => void; reset: () => void;
  /** 검색창이 강사 이름도 찾나(관리자 화면 — 강사뷰는 이미 본인 칸뿐). */
  searchTeachers: boolean;
  options: { subjects: Option[]; grades: Option[] };
  fromDate: string; toDate: string; today: string; busy: boolean; onDownload: (() => void) | null;
}) {
  const pathname = usePathname();
  const [rangeError, setRangeError] = useState("");
  function validateRange(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    if (!isVideoHomeworkRange(String(data.get("from")), String(data.get("to")))) {
      event.preventDefault(); setRangeError("시작일과 종료일을 확인해 주세요. 한 번에 최대 366일까지 조회할 수 있습니다.");
    } else setRangeError("");
  }
  // 기간 조회는 **지금 화면 주소로** — 관리자 화면과 강사뷰(`/onescreen/video-homework`)가 같은 툴바를 쓴다(고정 주소면 강사가 관리자 화면으로 튕긴다).
  return <form className={styles.filters} action={pathname} method="get" onSubmit={validateRange}>
    <EmbedHiddenInput />
    <Toolbar className={styles.filterRow} gap="gap-2" rail={false}>
      <label className={styles.dateFilter}><span className="sr-only">시작일</span><input className={TOOLBAR_SELECT} aria-label="조회 시작일" name="from" type="date" defaultValue={fromDate} max={today} required disabled={busy} /></label>
      <span className={styles.dateSeparator}>–</span>
      <label className={styles.dateFilter}><span className="sr-only">종료일</span><input className={TOOLBAR_SELECT} aria-label="조회 종료일" name="to" type="date" defaultValue={toDate} max={today} required disabled={busy} /></label>
      <ToolbarButton type="submit" variant="primary" disabled={busy}>기간 조회</ToolbarButton>
      <label className={`${TOOLBAR_SEARCH_BOX} ${styles.search}`}><EyIcon name="search" size={18} /><input aria-label={searchTeachers ? "학생·반·학교·강사 통합 검색" : "학생·반·학교 통합 검색"} name="q" placeholder={searchTeachers ? "학생·반·학교·강사 검색" : "학생·반·학교 검색"} value={filters.query} disabled={busy} onChange={(event) => update("query", event.target.value)} /></label>
      <FilterSelect label="과목" name="subject" value={filters.subject} options={options.subjects} disabled={busy} onChange={(value) => update("subject", value)} />
      <FilterSelect label="학년" name="grade" value={filters.grade} options={options.grades} disabled={busy} onChange={(value) => update("grade", value)} />
      {/* 상태(원장 2026-10-19 '수행 상태' → '상태') — 마지막 '영상 배정 필요함' = 학생이 올렸는데 아직 숙제 칸에 붙지 않은 영상이 남은 학생. */}
      <FilterSelect label="상태" name="status" value={filters.status} options={[...LEDGER_STATUS_OPTIONS.map((option) => ({ value: option.value, label: `${option.label} 있음` })), { value: "assign", label: "영상 배정 필요함" }]} disabled={busy} onChange={(value) => update("status", value as LedgerFilters["status"])} />
      <label className={styles.filter}><span className="sr-only">정렬</span><select className={TOOLBAR_SELECT} aria-label="학생 정렬" name="sort" value={filters.sort} disabled={busy} onChange={(event) => update("sort", event.target.value as LedgerFilters["sort"])}>
        <option value="name">이름순</option><option value="missing">미수행 많은 순</option><option value="completion">완료율 낮은 순</option>
      </select></label>
      <ToolbarButton aria-label="필터 초기화" disabled={busy || JSON.stringify(filters) === JSON.stringify(DEFAULT_LEDGER_FILTERS)} onClick={reset}>초기화</ToolbarButton>
      <ToolbarButton disabled={busy || !onDownload} onClick={() => onDownload?.()}>검색 결과 CSV</ToolbarButton>
    </Toolbar>
    {rangeError ? <p role="alert" className={styles.red}>{rangeError}</p> : null}
  </form>;
}
