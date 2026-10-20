"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { normalizeSchoolName } from "@/features/schools/school-name";
import { EXAM_TERMS, defaultExam, schoolYearOf, type ExamTerm } from "@/features/textbooks/exam-periods";
import { saveSchoolExamPeriods } from "@/features/textbooks/server/school-exam-actions";
import { useMathTextbooks } from "./math-textbook-context";
import styles from "./learning-overview.module.css";
import local from "./math-textbook.module.css";
import css from "./plan-card.module.css";

const md = (d: string) => d.slice(5).replace("-", ".");

/**
 * 학교별 내신기간 버튼 + 창(원장 2026-10-20 *"학교마다 내신기간이 다름 학교별로 내신기간 반영되게"*).
 * 이 반 학생들의 학교만 고를 수 있다(서버가 다시 본다). 비운 시험은 기본표(원장 표)로 계산한다.
 */
export function SchoolExamButton({ schools, today }: { schools: (string | null)[]; today: string }) {
  const ctx = useMathTextbooks();
  const [open, setOpen] = useState(false);
  if (!ctx?.canWrite) return null;
  return (
    <>
      <button type="button" className={styles.button} onClick={() => setOpen(true)}>학교별 내신기간</button>
      {open ? <SchoolExamDialog schools={schools} today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SchoolExamDialog({ schools, today, onClose }: { schools: (string | null)[]; today: string; onClose: () => void }) {
  const ctx = useMathTextbooks()!;
  const router = useRouter();
  const list = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const s of schools) {
      const key = normalizeSchoolName(s);
      if (!key || !s) continue;
      const cur = m.get(key);
      m.set(key, { label: cur?.label ?? s.trim(), count: (cur?.count ?? 0) + 1 });
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
  }, [schools]);
  const sy = schoolYearOf(today);
  const [school, setSchool] = useState(list[0]?.key ?? "");
  const [year, setYear] = useState(sy);
  const saved = (term: ExamTerm) => ctx.schoolExams.rows.find((r) => r.schoolKey === school && r.schoolYear === year && r.term === term);
  const [draft, setDraft] = useState<Record<string, { from: string; to: string }>>({});
  const keyOf = (term: ExamTerm) => `${school}|${year}|${term}`;
  const value = (term: ExamTerm) => draft[keyOf(term)] ?? { from: saved(term)?.from ?? "", to: saved(term)?.to ?? "" };
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const locked = ctx.schoolExams.status !== "ok";

  const save = () => {
    const sel = list.find((s) => s.key === school);
    if (!sel) return;
    setError(null);
    start(async () => {
      const res = await saveSchoolExamPeriods({
        classId: ctx.classId, school: sel.label, schoolYear: year,
        rows: EXAM_TERMS.map(({ term }) => ({ term, from: value(term).from || null, to: value(term).to || null })),
      });
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
        <DialogTitle>학교별 내신기간</DialogTitle>
        <DialogDescription>적은 시험만 그 학교 학생의 진도 계산에서 빠집니다(다른 반의 같은 학교 학생에게도 적용). 비운 시험은 기본 기간으로 계산합니다.</DialogDescription>
        {locked ? <p className={local.hint}>{ctx.schoolExams.status === "missing-table" ? "학교별 내신기간 표가 아직 없습니다 — SQL을 적용하면 열립니다." : "학교별 내신기간을 불러오지 못했습니다. 새로고침해 주세요."}</p> : null}
        {list.length === 0 ? <p className={local.hint}>이 반 학생의 학교 정보가 없습니다.</p> : (
          <div className={css.examForm}>
            <div className={css.examPick}>
              <select aria-label="학교" value={school} disabled={pending} onChange={(e) => setSchool(e.target.value)}>
                {list.map((s) => <option key={s.key} value={s.key}>{s.label} · {s.count}명</option>)}
              </select>
              <select aria-label="학년도" value={year} disabled={pending} onChange={(e) => setYear(Number(e.target.value))}>
                {[sy, sy + 1].map((y) => <option key={y} value={y}>{y}학년도</option>)}
              </select>
            </div>
            {EXAM_TERMS.map(({ term, label }) => {
              const v = value(term);
              const d = defaultExam(term === "2-final-3" ? 3 : 2, year, term);
              const hint = d ? `기본 ${md(d.from)}–${md(d.to)}${term === "2-final" ? " (중2)" : ""}` : "";
              const set = (patch: Partial<{ from: string; to: string }>) => setDraft((x) => ({ ...x, [keyOf(term)]: { ...v, ...patch } }));
              return (
                <div key={term} className={css.examRow}>
                  <b>{label}</b>
                  <input type="date" aria-label={`${label} 시작`} value={v.from} disabled={pending || locked} onChange={(e) => set({ from: e.target.value })} />
                  <span>~</span>
                  <input type="date" aria-label={`${label} 끝`} value={v.to} disabled={pending || locked} onChange={(e) => set({ to: e.target.value })} />
                  <small>{v.from || v.to ? <button type="button" className={css.linkButton} disabled={pending || locked} onClick={() => set({ from: "", to: "" })}>기본으로</button> : hint}</small>
                </div>
              );
            })}
          </div>
        )}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <div className={local.actions}>
          <button type="button" className={styles.button} disabled={pending} onClick={onClose}>취소</button>
          <button type="button" className={styles.primaryButton} disabled={pending || locked || list.length === 0} onClick={save}>{pending ? "저장 중…" : "저장"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
