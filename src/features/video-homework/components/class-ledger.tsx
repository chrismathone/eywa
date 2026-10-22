"use client";

import { useState, type CSSProperties } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ledgerCounts, ledgerPairKey, ledgerSummary, roundsOf, type LedgerGroup, type LedgerRounds } from "../ledger";
import { blankCells, ledgerRowCells, type BlankFacts } from "../no-homework";
import type { LedgerRound } from "../rounds";
import type { VideoHomeworkLedgerRow, VideoHomeworkStatus } from "../types";
import { isVideoHomeworkDate } from "../types";
import { LEDGER_STATUS_OPTIONS, type ActiveCell, type SaveLedgerChanges } from "./round-editor";
import { RoundCell } from "./round-cell";
import type { IssueMenuTarget } from "./issue-menu";
import { changeKey, type LedgerChange } from "./use-ledger-marks";
import styles from "./video-homework-management.module.css";

const PAGE_SIZE = 50;
const ROUND_SIZE = 10;
// 반의 회차 수나 창 폭이 달라도 같은 열은 항상 같은 너비를 쓴다. 나머지 폭은 빈 공간이다.
const COLUMN_WIDTH = { select: 32, student: 112, school: 132, count: 64, round: 96 } as const;
export function ClassLedger({ group, rounds, blankFacts, videosKnown = true, showTeacher = false, today, busy, save, onEdit, onPlay, onAssign, onIssueMenu, collapsed, onToggle }: {
  group: LedgerGroup; rounds: LedgerRounds; blankFacts: BlankFacts; videosKnown?: boolean; today: string; busy: boolean; save: SaveLedgerChanges;
  showTeacher?: boolean;
  onEdit: (cell: ActiveCell) => void; collapsed: boolean; onToggle: () => void;
  onPlay: (cell: ActiveCell) => void;
  onAssign?: (row: VideoHomeworkLedgerRow) => void;
  /** 숙제없음 칸의 '숙제 출제' · 따로 낸 숙제 칸의 '출제 취소' 메뉴 — 고칠 수 있는 줄에서만 연다. */
  onIssueMenu?: (target: IssueMenuTarget) => void;
}) {
  const [page, setPage] = useState(0);
  const [roundPage, setRoundPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRound, setBatchRound] = useState(Math.max(1, group.roundCount));
  const [batchStatus, setBatchStatus] = useState<VideoHomeworkStatus | "unchecked">("submitted");
  const [submittedDate, setSubmittedDate] = useState(today);
  const validSubmission = batchStatus !== "submitted" || isVideoHomeworkDate(submittedDate) && submittedDate <= today;
  const pages = Math.max(1, Math.ceil(group.rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const paged = group.rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  // 열 = 회차 · 숙제 0건 반(①)은 회차가 없어 그 학생들의 숙제없음 수업일 칸(열 머리 '수업' — 회차가 아니다).
  const columns = Math.max(group.roundCount, group.blankColumns);
  const roundPages = Math.max(1, Math.ceil(columns / ROUND_SIZE));
  const currentRoundPage = Math.min(roundPage, roundPages - 1);
  const roundOffset = currentRoundPage * ROUND_SIZE;
  const numbers = Array.from({ length: Math.min(ROUND_SIZE, columns - roundOffset) }, (_, i) => roundOffset + i + 1);
  const editable = paged.filter((row) => row.editable);
  const selectedRows = paged.filter((row) => row.editable && selected.has(row.studentId));
  // 줄의 칸 차례 = 회차와 빈 칸(결석 · 숙제없음)을 날짜순으로(ledgerRowCells) — 빈 칸은 반에 숙제가 나간 날 중 이 학생에게 없는 날이다(회차 수에는 안 든다).
  const cellsOf = (row: VideoHomeworkLedgerRow) => {
    const own = roundsOf(rounds, row);
    return ledgerRowCells(own, blankCells({ classDates: group.homeworkDates, own, facts: blankFacts[ledgerPairKey(row)], slots: columns - own.length }));
  };
  // 같은 N회라도 학생마다 숙제일이 다르다 — 화면의 N번째 칸에 적는다(빈 칸이면 그 학생은 뺀다).
  const batchChanges = selectedRows.flatMap((row): LedgerChange[] => {
    const round = cellsOf(row)[batchRound - 1]?.round;
    if (!round || batchStatus === "unchecked" && !round.mark) return [];
    if (batchStatus === "submitted" && round.homeworkDate && submittedDate < round.homeworkDate) return [];
    return [{ classId: row.classId, studentId: row.studentId, round, status: batchStatus === "unchecked" ? null : batchStatus,
      submittedDate: batchStatus === "submitted" ? submittedDate : null }];
  });
  const summary = ledgerSummary(group.rows, rounds);
  const allSelected = editable.length > 0 && editable.every((row) => selected.has(row.studentId));
  const panelId = `video-ledger-${group.classId}`;
  function toggleStudent(studentId: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(studentId)) next.delete(studentId); else next.add(studentId); return next; });
  }
  async function saveBatch() {
    if (busy || !validSubmission) return;
    const failures = new Set(await save(batchChanges));
    setSelected(new Set(batchChanges.filter((change) => failures.has(changeKey(change))).map((change) => change.studentId)));
  }
  function open(row: VideoHomeworkLedgerRow, round: LedgerRound, number: number) {
    // 체크와 동시에 날짜(원장 2026-10-01) — 미확인 칸은 한 번 누르면 오늘 날짜로 완료. 다시 누르면 날짜 수정·되돌리기.
    if (row.editable && round.status === "unchecked" && !round.mark)
      void save([{ classId: row.classId, studentId: row.studentId, round, status: "submitted", submittedDate: today }]);
    else onEdit({ row, round, number });
  }
  return <section className={styles.group} aria-label={`${group.className} 장부`}>
    <button type="button" className={styles.groupHeading} onClick={onToggle} aria-expanded={!collapsed} aria-controls={panelId}>
      <EyIcon name={collapsed ? "chevronRight" : "chevronDown"} size={18} /><strong>{group.className}</strong>
      <span className={styles.groupMeta}>{group.subject} · {group.rows.length}명</span>
      {showTeacher ? <span className={styles.groupTeacher}>담당 {group.teacherName || "미지정"}</span> : null}
      <span className={styles.groupTotals}><span className={styles.green}>완료 {summary.submitted}</span><span className={styles.red}>미수행 {summary.missing}</span><span className={styles.amber}>미확인 {summary.unchecked}</span></span>
    </button>
    {!collapsed ? <div id={panelId}>
      <div className={styles.groupToolbar}>
        {group.rows.some((row) => row.editable) && group.roundCount ? <div className={styles.batch}>
          <strong>{selectedRows.length}명 선택</strong>
          <select aria-label={`${group.className} 일괄 회차`} value={batchRound} disabled={busy} onChange={(event) => setBatchRound(Number(event.target.value))}>
            {Array.from({ length: group.roundCount }, (_, i) => <option key={i} value={i + 1}>{i + 1}회</option>)}
          </select>
          <select aria-label={`${group.className} 일괄 수행 상태`} value={batchStatus} disabled={busy} onChange={(event) => setBatchStatus(event.target.value as typeof batchStatus)}>
            {LEDGER_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {batchStatus === "submitted" ? <label className={styles.batchSubmission}>제출일 <input type="date" aria-label={`${group.className} 일괄 제출일`}
            value={submittedDate} min="2000-01-01" max={today} disabled={busy} onChange={(event) => setSubmittedDate(event.target.value)} /></label> : null}
          <button type="button" className={styles.primary} disabled={busy || !batchChanges.length || !validSubmission} onClick={() => void saveBatch()}>선택 {batchChanges.length}명 적용</button>
          {selectedRows.length > batchChanges.length ? <span className={styles.dim}>적용할 수 없는 {selectedRows.length - batchChanges.length}명 제외(그 회차가 없거나 제출일이 숙제일보다 빠름)</span> : null}
        </div> : <span className={styles.dim}>{group.roundCount ? "읽기 전용"
          : group.idle ? "이 기간에 이 반에 나간 영상 숙제가 없습니다 · 올라온 영상은 '영상 배정'에서 수업일에 붙입니다" : "이 기간에 영상 과제가 나간 학생이 없습니다"}</span>}
        <div className={styles.roundPager}>
          <button type="button" disabled={currentRoundPage === 0 || busy} onClick={() => setRoundPage(currentRoundPage - 1)} aria-label={`${group.className} 이전 회차`}>‹</button>
          {/* 숙제 0건 반은 회차가 아니라 수업일 칸이다 — '0회'로 적지 않고 수업일 수를 적는다. */}
          <span>{group.roundCount || !numbers.length ? <>{group.roundCount ? `${roundOffset + 1}–${roundOffset + numbers.length}회` : "0회"} <small>/ {group.roundCount}회</small></>
            : <>수업일 {roundOffset + 1}–{roundOffset + numbers.length} <small>/ {columns}일</small></>}</span>
          <button type="button" disabled={currentRoundPage >= roundPages - 1 || busy} onClick={() => setRoundPage(currentRoundPage + 1)} aria-label={`${group.className} 다음 회차`}>›</button>
        </div>
      </div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${group.className} 회차별 수행 기록, 가로 스크롤 가능`}>
        <table className={styles.table} style={{ width: COLUMN_WIDTH.select + COLUMN_WIDTH.student + COLUMN_WIDTH.school + COLUMN_WIDTH.count + numbers.length * COLUMN_WIDTH.round,
          "--ledger-select-width": `${COLUMN_WIDTH.select}px` } as CSSProperties}>
          <caption className="sr-only">{group.className} 학생별 영상 과제 장부</caption>
          <colgroup><col style={{ width: COLUMN_WIDTH.select }} /><col style={{ width: COLUMN_WIDTH.student }} /><col style={{ width: COLUMN_WIDTH.school }} /><col style={{ width: COLUMN_WIDTH.count }} />{numbers.map((n) => <col key={n} style={{ width: COLUMN_WIDTH.round }} />)}</colgroup>
          <thead><tr>
            <th className={styles.selectCell}><input type="checkbox" aria-label={`${group.className} 현재 페이지 학생 전체 선택`} disabled={busy || !editable.length} checked={allSelected}
              ref={(node) => { if (node) node.indeterminate = selectedRows.length > 0 && !allSelected; }}
              onChange={() => setSelected(allSelected ? new Set() : new Set(editable.map((row) => row.studentId)))} /></th>
            <th scope="col" className={styles.studentCell}>학생</th><th scope="col">학교 · 학년</th><th scope="col">완료</th>
            {numbers.map((n) => <th scope="col" key={n}><strong>{n <= group.roundCount ? `${n}회` : "수업"}</strong></th>)}
          </tr></thead>
          <tbody>{paged.map((row) => {
            const counts = ledgerCounts(row, rounds);
            const cells = cellsOf(row);
            return <tr key={ledgerPairKey(row)} data-selected={selected.has(row.studentId) || undefined}>
              <td className={styles.selectCell}><input type="checkbox" aria-label={`${group.className} ${row.studentName} 선택`} disabled={busy || !row.editable} checked={selected.has(row.studentId)} onChange={() => toggleStudent(row.studentId)} /></td>
              <th scope="row" className={styles.studentCell}><span title={row.studentName}>{row.studentName}</span>{!row.editable ? <small title="읽기 전용">조회</small> : null}
                {row.canAssignVideos && row.tracked && row.hasAssignableVideos && onAssign ?<button type="button" className="text-primary mt-1 block text-xs underline underline-offset-2" disabled={busy} aria-label={`${group.className} ${row.studentName} 영상 배정`} onClick={() => onAssign(row)}>영상 배정</button> : null}</th>
              <td className={styles.schoolCell} title={`${row.school ?? "학교 미등록"} ${row.grade ?? ""}`}>{row.school || "미등록"} <span>{row.grade}</span></td>
              <td className={styles.countCell}><strong>{counts.submitted}</strong><span>/{counts.total}</span></td>
              {numbers.map((n) => <RoundCell key={n} row={row} round={cells[n - 1]?.round} blank={cells[n - 1]?.blank} number={n} busy={busy} videosKnown={videosKnown}
                onOpen={(round) => open(row, round, n)} onEditor={(round) => onEdit({ row, round, number: n })} onPlay={(round) => onPlay({ row, round, number: n })}
                onMenu={row.editable && onIssueMenu ? (kind, date, at) => onIssueMenu({ kind, row, date, ...at }) : undefined} />)}
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className={styles.groupFooter}><span>{group.rows.length}명 중 {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + paged.length}명</span>
        {pages > 1 ? <div className={styles.roundPager}>
          <button type="button" disabled={busy || currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelected(new Set()); }} aria-label={`${group.className} 이전 학생`}>이전</button>
          <span>{currentPage + 1} / {pages}</span>
          <button type="button" disabled={busy || currentPage >= pages - 1} onClick={() => { setPage(currentPage + 1); setSelected(new Set()); }} aria-label={`${group.className} 다음 학생`}>다음</button>
        </div> : <span>학생 칸은 고정 · 회차는 가로 스크롤</span>}
      </div>
    </div> : null}
  </section>;
}
