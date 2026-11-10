import { SUBJECT_SOLID, SUBJECT_TEXT, subjectColorOfRow, type SubjectMaps } from "@/features/owner/subjects";
import type { CurriculumItem } from "../history";

/** 과목별 진도 진척 — done/total강 + 진행 바 */
/** @param subjectMaps 과목 색 = 학원설정(운영 enum 하드코딩 금지) — 서버 페이지가 buildSubjectMaps로 만들어 넘긴다. */
export function CurriculumProgress({ curriculum, subjectMaps }: { curriculum: CurriculumItem[]; subjectMaps: SubjectMaps }) {
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border p-5">
      <h2 className="text-foreground text-base font-bold">과목별 진도 진척</h2>
      <div className="mt-3 space-y-3">
        {curriculum.map((c) => {
          const tone = subjectColorOfRow(subjectMaps, { name: c.name });
          const p = Math.round((c.done / c.total) * 100);
          return (
            <div key={c.name}>
              <div className="flex items-center justify-between text-sm">
                <span className={`font-bold ${SUBJECT_TEXT[tone]}`}>{c.name}</span>
                <span className="tabular text-text-dim">
                  {c.done}/{c.total}강 · {p}%
                </span>
              </div>
              <div className="bg-bg-soft mt-1.5 h-2 overflow-hidden rounded-pill">
                <div className={`h-full rounded-pill ${SUBJECT_SOLID[tone]}`} style={{ width: `${p}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
