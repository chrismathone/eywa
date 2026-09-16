"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { STATUS_STYLE, cellBoxClass, cellMarkOf } from "@/features/newcomers/cell-display";
import { shortDate } from "@/features/newcomers/board-model";
import { ONBOARDING_ITEMS, daysBetween, daysLeftOf, dueDateOf, statusOf, type OnboardingItemDef } from "@/features/newcomers/onboarding-items";
import type { NewcomerRow } from "@/features/newcomers/server/queries";
import styles from "./newcomer-board.module.css";

export function TaskBadge({ row, item, today }: { row: NewcomerRow; item: OnboardingItemDef; today: string }) {
  const status = statusOf(item, row, row.checks[item.key], today);
  const left = daysLeftOf(item, row, today);
  const mark = cellMarkOf(status, left);
  return <span className={cellBoxClass(status, !!item.optional, left)}>{mark.kind === "check" ? <><EyIcon name="check" size={12} />완료</> : mark.text}</span>;
}

export function NewcomerTable({ rows, today, canWrite, checksKnown, busy, selected, onToggle, compact }: {
  rows: NewcomerRow[]; today: string; canWrite: boolean; checksKnown: boolean; busy: ReadonlySet<string>;
  selected: string | null; onToggle: (row: NewcomerRow, item: OnboardingItemDef) => void;
  compact: boolean;
}) {
  const { labelOf } = useSubjectMaps();
  return <table className={`${styles.table} ${compact ? styles.compact : ""}`}>
    <caption className="sr-only">학생·과목별 신규생 90일 관리. 업무 칸을 누르면 완료 또는 완료 취소합니다.</caption>
    <colgroup><col style={{ width: 148 }} /><col style={{ width: 114 }} /><col style={{ width: 64 }} /><col style={{ width: 92 }} /><col style={{ width: 138 }} />{ONBOARDING_ITEMS.map(item => <col key={item.key} />)}</colgroup>
    <thead><tr>
      <th scope="col" className={styles.stickyName}>이름</th>
      <th scope="col" className={styles.stickySchool}>학교·학년</th>
      <th scope="col" className={styles.stickySubject}>과목</th>
      <th scope="col">등록일</th><th scope="col" className={styles.divider}>첫 수업</th>
      {ONBOARDING_ITEMS.map(item => <th scope="col" key={item.key} title={item.optional ? "선택 업무 · 필수 완료율과 지연·임박 집계에서 제외" : `${item.anchor === "enrolled" ? "등록일" : "첫 수업일"} 기준 ${item.offsetDays >= 0 ? "+" : ""}${item.offsetDays}일`}>
        {item.shortLabel}{item.optional && <small className={styles.optional}>선택</small>}
      </th>)}
    </tr></thead>
    <tbody>{rows.map(row => <tr key={row.rowKey} data-row-key={row.rowKey} data-selected={selected === row.rowKey || undefined}>
      <td className={styles.stickyName}>
        <div className={styles.nameCell}>
          <WindowLink href={`/students/${row.studentId}?back=/newcomers`} className={styles.studentName} title={row.name}>{row.name}</WindowLink>
        </div>
      </td>
      <td className={styles.stickySchool} title={schoolGradeLabel(row.school, row.grade)}><span className={styles.ellipsis}>{schoolGradeLabel(row.school, row.grade)}</span></td>
      <td className={styles.stickySubject}><span className={styles.subject} title={row.subject ? labelOf(row.subject) : "과목 미정"}>{row.subject ? labelOf(row.subject) : "미정"}</span></td>
      <td className={styles.date}>{shortDate(row.enrolledOn)}</td>
      <td className={`${styles.date} ${styles.divider}`}>{row.firstClassOn ? <span className={styles.firstClass} title={`첫 수업일 ${row.firstClassOn}`}>
        <time dateTime={row.firstClassOn}>{shortDate(row.firstClassOn)}</time><FirstClassDay date={row.firstClassOn} today={today} />
      </span> : <span className={styles.muted}>날짜 미정</span>}</td>
      {ONBOARDING_ITEMS.map(item => {
        const key = `${row.rowKey}|${item.key}`;
        const status = statusOf(item, row, row.checks[item.key], today);
        const left = daysLeftOf(item, row, today), due = dueDateOf(item, row);
        const mark = cellMarkOf(status, left);
        const title = [checksKnown ? STATUS_STYLE[status].label : "기록 확인 불가", item.optional ? "선택 · 필수 집계 제외" : null,
          due ? `예정일 ${due}` : "첫 수업일 미정", status === "overdue" ? `${Math.abs(left ?? 0)}일 경과` : null,
          row.checks[item.key] ? `완료일 ${row.checks[item.key]}` : null,
          canWrite ? status === "done" ? "눌러서 완료 취소" : "눌러서 완료" : "현재 완료 기록을 변경할 수 없습니다"].filter(Boolean).join(" · ");
        return <td key={item.key} className={styles.taskCell}>
          <button type="button" className={cellBoxClass(checksKnown ? status : "pending", !!item.optional, left)}
            disabled={!canWrite || busy.has(key)} aria-busy={busy.has(key)} aria-pressed={checksKnown && status === "done"}
            data-task-key={key} title={title} aria-label={`${row.name} ${row.subject ? labelOf(row.subject) : "과목 미정"} · ${item.shortLabel} · ${title}`}
            onClick={() => onToggle(row, item)}>
            {busy.has(key) ? <EyIcon name="loader" size={12} className={styles.spin} /> : null}
            {!checksKnown ? "확인 불가" : mark.kind === "check" ? <>{!busy.has(key) && <EyIcon name="check" size={12} />}완료</> : mark.text}
          </button>
        </td>;
      })}
    </tr>)}</tbody>
  </table>;
}

function FirstClassDay({ date, today }: { date: string; today: string }) {
  const n = daysBetween(date, today);
  return <span className={styles.firstDay}>{n > 0 ? <>D+{n}</> : n < 0 ? `D${n}` : "오늘"}</span>;
}
