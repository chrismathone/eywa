import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { subjectTone, toneSolidClass, toneTextClass } from "../data";
import type { OneScreenStudent } from "../types";

/** 진도 카드 — 과목별 이전→오늘 + "오늘 진도 확정" 토글 */
export function ProgressCard({
  student,
  onConfirm,
}: {
  student: OneScreenStudent;
  onConfirm: () => void;
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
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {student.subjects.map((su, i) => {
          const { tone } = subjectTone(su.name);
          return (
            <div key={i} className="flex items-start gap-3">
              <span className={`mt-0.5 h-9 w-1 rounded-full ${toneSolidClass(tone)}`} aria-hidden />
              <div>
                <p className={`text-[13px] font-bold ${toneTextClass(tone)}`}>{su.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                  <span className="text-text-faint">{su.prev}</span>
                  <span className={toneTextClass(tone)}>→</span>
                  <span className="text-foreground font-semibold">{su.today}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
