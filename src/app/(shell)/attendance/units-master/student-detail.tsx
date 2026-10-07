"use client";

import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";
import { masterNeedsInput, type MasterClass, type MasterStudent } from "@/features/attendance/units-master";
import styles from "./sheet.module.css";

export const TRACK_LABELS = { math: "수학 · 55분 = 0.5U", eie: "EiE · 40분 = 1U", bridge: "브릿지 · 40분 = 1U", hourly: "인재원 · 1시간 = 1U" };
export const numberLabel = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
export const unitsLabel = (n: number | null | undefined) => n == null ? "—" : `${numberLabel(n)} U`;
const labels = { normal: "정상 진행", short: "부족", review: "입력 확인", complete: "월 시수 충족", excess: "초과", plannedExcess: "예정 초과", unconfirmed: "미확정" };
const statuses: Record<string, string> = { present: "출석", late: "지각", early_leave: "조퇴", makeup: "보강", absent: "결석", excused: "공결", unmarked: "미입력" };
const buttonClass = `${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`;

export function statusLabel(s: MasterStudent): string {
  if (s.status === "short") return `부족 ${numberLabel((s.remaining ?? 0) - s.future)}U`;
  if (s.status === "excess") return `초과 ${numberLabel(-(s.remaining ?? 0))}U`;
  if (s.status === "plannedExcess") return `예정 초과 ${numberLabel(s.future - (s.remaining ?? 0))}U`;
  if (s.status === "unconfirmed" && s.invoice !== "ok") return s.invoice === "void" ? "청구 취소" : "청구 없음";
  return labels[s.status];
}

export function ownerLabel(c: MasterClass, id: string): string {
  return c.teachers.find((t) => t.id === id)?.name ?? (["JJ", "LAB"].includes(id) ? id : "귀속 확인");
}

export function MasterStudentDetail({ classInfo: c, student: s, month, position, count, onPrevious, onNext, onClose }: {
  classInfo: MasterClass; student: MasterStudent; month: string; position: number; count: number;
  onPrevious?: () => void; onNext?: () => void; onClose?: () => void;
}) {
  const sourceHref = `/attendance?${new URLSearchParams({ class: c.id, month, subject: c.subject, mode: "class", q: s.name })}`;
  const billingHref = `/billing?${new URLSearchParams({ tab: "sessions", period: month, subject: c.subject, q: s.name })}`;
  return <div className={styles.detailBody}>
    <header className={styles.detailHeader}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{s.name} <span className="text-text-dim text-sm font-medium">{s.school}</span></h2>
        {onClose ? <button type="button" className={buttonClass} onClick={onClose}>닫기</button> : null}
      </div>
      <p className="text-text-dim text-xs">{c.name} · {TRACK_LABELS[c.track]}<br />{c.periodLabel}</p>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} disabled={!onPrevious} onClick={onPrevious} aria-label="이전 학생">이전 학생</button>
        <span className="num text-text-dim text-xs">{position + 1}/{count}</span>
        <button type="button" className={buttonClass} disabled={!onNext} onClick={onNext} aria-label="다음 학생">다음 학생</button>
      </div>
    </header>
    <table className={styles.detailTable}>
      <thead><tr><th scope="col">월 발생</th><th scope="col">실수업 합계</th><th scope="col">잔여</th></tr></thead>
      <tbody><tr><td className={styles.total}>{unitsLabel(s.target)}</td><td className={styles.total}>{unitsLabel(s.actual)}</td><td>{unitsLabel(s.remaining)}</td></tr></tbody>
    </table>
    <section className={styles.checkNotes} aria-label="확인할 사항">
      <b>{statusLabel(s)}</b>
      <p>남은 예정 {numberLabel(s.future)}U · 미입력 {numberLabel(s.missing)}U</p>
      {s.target === null ? <p>월 발생 시수가 미확정입니다. 출결 입력 여부와 회차 확정을 각각 확인하세요.</p> : null}
      {s.missing > 0 ? <p>지난 수업의 출결이 비어 있습니다. 아래 미입력 날짜를 확인하세요.</p> : null}
      {s.review.map((note) => <p key={note}>{note}</p>)}
      {!masterNeedsInput(s) && s.status === "normal" ? <p>남은 예정 수업을 진행하면 월 발생 시수를 충족합니다.</p> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <EmbedLink className={buttonClass} href={sourceHref}>원 출석부 열기</EmbedLink>
        <EmbedLink className={buttonClass} href={billingHref}>회차 확정·배분 열기</EmbedLink>
      </div>
    </section>
    <section className="space-y-2">
      <h3 className="text-sm font-bold">담당별 월 배분과 실제 수업</h3>
      <table className={styles.detailTable}>
        <thead><tr><th scope="col">담당</th><th scope="col">월 배분</th><th scope="col">실수업</th><th scope="col">잔여 배분</th></tr></thead>
        <tbody>{Object.entries(s.owners).map(([id, v]) => <tr key={id}><th scope="row">{ownerLabel(c, id)}</th><td>{unitsLabel(v.planned)}</td><td className={styles.total}>{unitsLabel(v.actual)}</td><td>{v.planned === null ? "확인 필요" : unitsLabel(v.planned - v.actual)}</td></tr>)}</tbody>
      </table>
      <p className="text-text-dim text-xs">담임에게 배분한 잔여 시수는 실제 출결이 있을 때만 실수업으로 인정합니다.</p>
    </section>
    <section className="space-y-2">
      <h3 className="text-sm font-bold">출결 내역 {s.events.length}건</h3>
      <div className={styles.events}>{s.events.length ? s.events.map((e, i) => <div key={`${e.date}-${e.slot}-${i}`} data-excluded={e.excluded || undefined} data-missing={e.status === "unmarked" || undefined}>
        <div><time>{e.date.slice(5)} {e.slot ?? "일별"}</time><b>{ownerLabel(c, e.owner)} · {statuses[e.status] ?? e.status}</b><strong>{unitsLabel(e.units)}</strong></div>
        {e.note ? <p>{e.note}</p> : null}
      </div>) : <p>저장된 출결 내역이 없습니다.</p>}</div>
    </section>
  </div>;
}
