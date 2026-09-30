"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ledgerCounts, ledgerMarkKey, ledgerPairKey, ledgerSummary, type LedgerGroup } from "../ledger";
import type { VideoHomeworkLedgerRow, VideoHomeworkMark, VideoHomeworkStatus } from "../types";
import type { LedgerChange } from "./use-ledger-marks";
import styles from "./video-homework-management.module.css";

const PAGE_SIZE = 50;
const ROUND_SIZE = 10;
const shortDate = (date: string) => date.slice(5).replace("-", ".");
export const LEDGER_STATUS_OPTIONS = [{ value: "submitted", label: "완료" }, { value: "missing", label: "미수행" }, { value: "unchecked", label: "미확인" }] as const;
export type ActiveCell = { row: VideoHomeworkLedgerRow; date: string; round: number };
export type SaveLedgerChanges = (changes: LedgerChange[]) => Promise<string[]>;

export function ClassLedger({ group, marks, busy, save, onEdit, collapsed, onToggle }: {
  group: LedgerGroup; marks: ReadonlyMap<string, VideoHomeworkMark>; busy: boolean; save: SaveLedgerChanges;
  onEdit: (cell: ActiveCell) => void; collapsed: boolean; onToggle: () => void;
}) {
  const [page, setPage] = useState(0);
  const [roundPage, setRoundPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDate, setBatchDate] = useState(group.dates.at(-1) ?? "");
  const [batchStatus, setBatchStatus] = useState<VideoHomeworkStatus | "unchecked">("submitted");
  const pages = Math.max(1, Math.ceil(group.rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const paged = group.rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const roundPages = Math.max(1, Math.ceil(group.dates.length / ROUND_SIZE));
  const currentRoundPage = Math.min(roundPage, roundPages - 1);
  const roundOffset = currentRoundPage * ROUND_SIZE;
  const dates = group.dates.slice(roundOffset, roundOffset + ROUND_SIZE);
  const editable = paged.filter((row) => row.editable);
  const selectedRows = paged.filter((row) => row.editable && selected.has(row.studentId));
  const applicable = selectedRows.filter((row) => row.lessonDates.includes(batchDate));
  const summary = ledgerSummary(group.rows, marks);
  const allSelected = editable.length > 0 && editable.every((row) => selected.has(row.studentId));
  const panelId = `video-ledger-${group.classId}`;
  function toggleStudent(studentId: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(studentId)) next.delete(studentId); else next.add(studentId); return next; });
  }
  async function saveBatch() {
    const changes = applicable.map((row): LedgerChange => ({ classId: row.classId, studentId: row.studentId, checkDate: batchDate,
      homeworkDate: marks.get(ledgerMarkKey({ ...row, checkDate: batchDate }))?.homeworkDate ?? null,
      status: batchStatus === "unchecked" ? null : batchStatus }));
    const failures = new Set(await save(changes));
    setSelected(new Set(applicable.filter((row) => failures.has(ledgerMarkKey({ ...row, checkDate: batchDate }))).map((row) => row.studentId)));
  }
  return <section className={styles.group} aria-label={`${group.className} 장부`}>
    <button type="button" className={styles.groupHeading} onClick={onToggle} aria-expanded={!collapsed} aria-controls={panelId}>
      <span aria-hidden="true" className={styles.chevron}>{collapsed ? "▸" : "▾"}</span><strong>{group.className}</strong>
      <span className={styles.groupMeta}>{group.subject} · {group.rows.length}명</span>
      <span className={styles.groupTotals}><span className={styles.green}>완료 {summary.submitted}</span><span className={styles.red}>미수행 {summary.missing}</span><span>미확인 {summary.unchecked}</span></span>
    </button>
    {!collapsed ? <div id={panelId}>
      <div className={styles.groupToolbar}>
        {group.rows.some((row) => row.editable) ? <div className={styles.batch}>
          <strong>{selectedRows.length}명 선택</strong>
          <select aria-label={`${group.className} 일괄 검사 날짜`} value={batchDate} disabled={busy} onChange={(event) => setBatchDate(event.target.value)}>
            {group.dates.map((date, index) => <option key={date} value={date}>{index + 1}회 · {date}</option>)}
          </select>
          <select aria-label={`${group.className} 일괄 수행 상태`} value={batchStatus} disabled={busy} onChange={(event) => setBatchStatus(event.target.value as typeof batchStatus)}>
            {LEDGER_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" className={styles.primary} disabled={busy || !applicable.length} onClick={() => void saveBatch()}>선택 {applicable.length}명 적용</button>
          {selectedRows.length > applicable.length ? <span className={styles.dim}>해당 수업 대상 아닌 {selectedRows.length - applicable.length}명 제외</span> : null}
        </div> : <span className={styles.dim}>읽기 전용</span>}
        <div className={styles.roundPager}>
          <button type="button" disabled={currentRoundPage === 0 || busy} onClick={() => setRoundPage(currentRoundPage - 1)} aria-label={`${group.className} 이전 회차`}>‹</button>
          <span>{roundOffset + 1}–{roundOffset + dates.length}회 <small>/ {group.dates.length}회</small></span>
          <button type="button" disabled={currentRoundPage >= roundPages - 1 || busy} onClick={() => setRoundPage(currentRoundPage + 1)} aria-label={`${group.className} 다음 회차`}>›</button>
        </div>
      </div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${group.className} 회차별 수행 기록, 가로 스크롤 가능`}>
        <table className={styles.table} style={{ minWidth: 366 + dates.length * 84 }}>
          <caption className="sr-only">{group.className} 학생별 영상숙제 장부</caption>
          <colgroup><col style={{ width: 36 }} /><col style={{ width: 128 }} /><col style={{ width: 142 }} /><col style={{ width: 60 }} />{dates.map((date) => <col key={date} />)}</colgroup>
          <thead><tr>
            <th className={styles.selectCell}><input type="checkbox" aria-label={`${group.className} 현재 페이지 학생 전체 선택`} disabled={busy || !editable.length} checked={allSelected}
              ref={(node) => { if (node) node.indeterminate = selectedRows.length > 0 && !allSelected; }}
              onChange={() => setSelected(allSelected ? new Set() : new Set(editable.map((row) => row.studentId)))} /></th>
            <th scope="col" className={styles.studentCell}>학생</th><th scope="col">학교 · 학년</th><th scope="col">완료</th>
            {dates.map((date, index) => <th scope="col" key={date}><strong>{roundOffset + index + 1}회</strong><small>{shortDate(date)}</small></th>)}
          </tr></thead>
          <tbody>{paged.map((row) => {
            const counts = ledgerCounts(row, marks);
            return <tr key={ledgerPairKey(row)} data-selected={selected.has(row.studentId) || undefined}>
              <td className={styles.selectCell}><input type="checkbox" aria-label={`${group.className} ${row.studentName} 선택`} disabled={busy || !row.editable} checked={selected.has(row.studentId)} onChange={() => toggleStudent(row.studentId)} /></td>
              <th scope="row" className={styles.studentCell}><span title={row.studentName}>{row.studentName}</span>{!row.editable ? <small title="읽기 전용">조회</small> : null}</th>
              <td className={styles.schoolCell} title={`${row.school ?? "학교 미등록"} ${row.grade ?? ""}`}>{row.school || "미등록"} <span>{row.grade}</span>
                {row.lastAssignment?.assigned === false ? <small className={styles.assignmentNote}
                  title={`${row.lastAssignment.beforeDate} 이전 마지막 수업 보고서 기준입니다. 이전 회차의 검사 기록은 그대로 유지됩니다.`}>
                  지난 수업 영상 과제 없음</small> : null}
              </td>
              <td className={styles.countCell}><strong>{counts.submitted}</strong><span>/{counts.total}</span></td>
              {dates.map((date, index) => {
                if (!row.lessonDates.includes(date)) return <td key={date}><span className={styles.notApplicable} title="이 날짜의 수업 대상이 아닙니다" aria-label="수업 대상 아님">—</span></td>;
                const mark = marks.get(ledgerMarkKey({ ...row, checkDate: date }));
                const status = mark?.status ?? "unchecked";
                const label = status === "submitted" ? "완료" : status === "missing" ? "미수행" : "미확인";
                return <td key={date}><button type="button" className={`${styles.mark} ${styles[status]}`} disabled={busy}
                  aria-label={`${row.studentName} ${roundOffset + index + 1}회 ${date} ${label}`}
                  title={`${date} 검사 · ${label}${mark?.homeworkDate ? ` · 지난 숙제 ${mark.homeworkDate}` : ""}`}
                  onClick={() => onEdit({ row, date, round: roundOffset + index + 1 })}>
                  {status === "submitted" ? <><EyIcon name="check" size={12} className="inline-block align-middle" /> {shortDate(date)}</> : status === "missing" ? "× 미수행" : "+ 확인"}
                </button></td>;
              })}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className={styles.groupFooter}><span>{group.rows.length}명 중 {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + paged.length}명 · 날짜는 검사한 수업일</span>
        {pages > 1 ? <div className={styles.roundPager}>
          <button type="button" disabled={busy || currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelected(new Set()); }} aria-label={`${group.className} 이전 학생`}>이전</button>
          <span>{currentPage + 1} / {pages}</span>
          <button type="button" disabled={busy || currentPage >= pages - 1} onClick={() => { setPage(currentPage + 1); setSelected(new Set()); }} aria-label={`${group.className} 다음 학생`}>다음</button>
        </div> : <span>학생 칸은 고정 · 회차는 가로 스크롤</span>}
      </div>
    </div> : null}
  </section>;
}
