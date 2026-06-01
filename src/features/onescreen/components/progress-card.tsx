import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { subjectTone, toneSolidClass, toneTextClass } from "../data";
import { MATH_G3 } from "../curriculum";
import type { OneScreenStudent } from "../types";

/** 진도 카드 — 과목별 이전 진도 + 오늘 진도(초3 수학 커리큘럼에서 선택) + 확정 토글 */
export function ProgressCard({
  student,
  onConfirm,
  onProgress,
}: {
  student: OneScreenStudent;
  onConfirm: () => void;
  onProgress: (subjectIndex: number, today: string) => void;
}) {
  return (
    <div className="bg-card border-line shadow-card rounded-md border">
      <header className="border-line flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="micro text-text-faint">진도 확인</p>
          <p className="text-foreground text-[15px] font-bold">오늘 어디까지 나갔나요</p>
        </div>
        <Button
          variant={student.progressConfirmed ? "outline" : "default"}
          size="sm"
          onClick={onConfirm}
        >
          {student.progressConfirmed ? (
            <>
              <EyIcon name="check" size={13} /> 확정됨
            </>
          ) : (
            "오늘 진도 확정"
          )}
        </Button>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {student.subjects.map((su, i) => {
          const { tone } = subjectTone(su.name);
          return (
            <div key={i} className="flex items-start gap-3">
              <span className={`mt-1 h-9 w-1 rounded-pill ${toneSolidClass(tone)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-bold ${toneTextClass(tone)}`}>{su.name}</p>
                <div className="mt-1 space-y-1 text-[12px]">
                  <p className="text-text-faint truncate">이전 · {su.prev}</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 font-semibold ${toneTextClass(tone)}`}>오늘 →</span>
                    <select
                      value={su.today}
                      onChange={(e) => onProgress(i, e.target.value)}
                      aria-label={`${su.name} 오늘 진도 선택`}
                      className="border-line focus:border-primary text-foreground min-w-0 flex-1 rounded-sm border bg-background px-2 py-1.5 text-[12px] font-semibold outline-none"
                    >
                      {MATH_G3.map((unit) => (
                        <optgroup key={unit.unit} label={unit.unit}>
                          {unit.lessons.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
