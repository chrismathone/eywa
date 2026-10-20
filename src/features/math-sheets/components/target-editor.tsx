"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RoadmapView } from "@/features/textbooks/book-plans";
import { saveMathBookTarget } from "@/features/textbooks/server/math-book-target-actions";
import { useMathTextbooks } from "./math-textbook-context";
import css from "./plan-card.module.css";

const AUTO = "__auto__";
const dot = (date: string) => date.replaceAll("-", ".");

/**
 * 최종 목표 권 고르기(원장 2026-10-20 *"최종목표가 설정되면 수정되게도 교재단위로"*).
 * 속도(내신 뺀 3개월에 2권)는 그대로라 권을 바꾸면 **끝나는 날만** 바뀐다 — 그래서 선택지마다 예상 완료일을 적는다.
 * 게이트는 서버 액션이 다시 본다([[#77]]). 저장 표가 없으면(마이그레이션 전) 버튼 대신 사유를 적는다.
 */
export function TargetEditor({ r, studentId, studentName }: { r: RoadmapView; studentId: string; studentName: string }) {
  const ctx = useMathTextbooks();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(r.target.auto ? AUTO : r.target.key);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!ctx?.canWrite) return null;
  if (ctx.targetStatus !== "ok") {
    return <span className={css.targetLock}>{ctx.targetStatus === "missing-table" ? "목표 교재 변경 준비 중" : "목표 교재를 불러오지 못했습니다"}</span>;
  }
  if (!open) return <button type="button" className={css.linkButton} onClick={() => setOpen(true)}>목표 교재 변경</button>;
  const auto = r.choices.find((c) => c.key === r.target.autoKey);
  return (
    <form
      className={css.targetForm}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await saveMathBookTarget({ classId: ctx.classId, studentId, series: r.series, targetKey: value === AUTO ? null : value });
          if (!res.ok) { setError(res.error); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <select aria-label={`${studentName} 최종 목표 교재`} value={value} disabled={pending} onChange={(e) => setValue(e.target.value)}>
        <option value={AUTO}>자동{auto ? ` — ${auto.title}${r.target.autoLesson != null ? ` ${r.target.autoLesson}차시` : ""} (${dot(r.target.autoLesson != null && r.deadline ? r.deadline : auto.finishDate)})` : ""}</option>
        {r.choices.map((c) => <option key={c.key} value={c.key}>{c.title} · {dot(c.finishDate)} 완료 예정</option>)}
      </select>
      <button type="submit" disabled={pending}>{pending ? "저장 중…" : "저장"}</button>
      <button type="button" disabled={pending} onClick={() => setOpen(false)}>취소</button>
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
}
