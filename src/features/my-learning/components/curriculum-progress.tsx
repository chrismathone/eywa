import { subjectTone, toneSolidClass, toneTextClass } from "@/features/onescreen/data";
import type { CurriculumItem } from "../history";

/** 과목별 진도 진척 — done/total강 + 진행 바 */
export function CurriculumProgress({ curriculum }: { curriculum: CurriculumItem[] }) {
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border p-5">
      <h2 className="text-foreground text-[15px] font-bold">과목별 진도 진척</h2>
      <div className="mt-3 space-y-3">
        {curriculum.map((c) => {
          const { tone } = subjectTone(c.name);
          const p = Math.round((c.done / c.total) * 100);
          return (
            <div key={c.name}>
              <div className="flex items-center justify-between text-[13px]">
                <span className={`font-bold ${toneTextClass(tone)}`}>{c.name}</span>
                <span className="tabular text-text-dim">
                  {c.done}/{c.total}강 · {p}%
                </span>
              </div>
              <div className="bg-bg-soft mt-1.5 h-2 overflow-hidden rounded-pill">
                <div className={`h-full rounded-pill ${toneSolidClass(tone)}`} style={{ width: `${p}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
