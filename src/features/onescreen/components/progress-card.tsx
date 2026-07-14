import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { subjectTone, toneSolidClass, toneTextClass } from "../data";
import { displayLessons } from "../curriculum";
import { ProgressSelector } from "./progress-selector";
import type { OneScreenStudent } from "../types";

/**
 * 진도 카드 — 과목별 오늘 진도를 **다중 차시**로 선택(edutrix 진도선택창, ProgressSelector).
 * - 진도(수업) 학년은 실제 학년과 다를 수 있음(선행/후행) → ProgressSelector 안에서 학년 필터로 조정.
 * - 이전 진도는 참고로 표시(다중차시면 ", "로 이어 한 줄).
 * - math 과목은 커리큘럼 다중선택, 그 외(영어 등)는 자유 텍스트.
 */
export function ProgressCard({
  student,
  onConfirm,
  onProgress,
  onStudyGrade,
  onLoadPrev,
}: {
  student: OneScreenStudent;
  onConfirm: () => void;
  onProgress: (subjectIndex: number, today: string) => void;
  onStudyGrade: (grade: string) => void;
  onLoadPrev?: () => void; // 보강 학생 '이전 진도 불러오기'(있을 때만 노출) — 직전 회차를 당겨온다.
}) {
  const studyGrade = student.studyGrade ?? student.grade;
  const isMathSubject = (key: string | undefined) => (key ?? "math") === "math";

  return (
    <div className="bg-card border-line shadow-card rounded-md border">
      <header className="border-line flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="micro text-text-faint">진도 확인</p>
          <p className="text-foreground text-[15px] font-bold">오늘 어디까지 나갔나요</p>
        </div>
        <div className="flex items-center gap-2">
          {onLoadPrev && (
            <Button variant="outline" size="sm" onClick={onLoadPrev}>
              <EyIcon name="history" size={13} /> 이전 진도 불러오기
            </Button>
          )}
          <Button variant={student.progressConfirmed ? "outline" : "default"} size="sm" onClick={onConfirm}>
            {student.progressConfirmed ? (
              <>
                <EyIcon name="check" size={13} /> 확정됨
              </>
            ) : (
              "오늘 진도 확정"
            )}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        {student.subjects.map((su, i) => {
          const { tone } = subjectTone(su.name);
          const isMath = isMathSubject(su.subjectKey);
          return (
            <div key={i} className="flex items-start gap-3">
              <span className={`mt-1 h-9 w-1 rounded-pill ${toneSolidClass(tone)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-bold ${toneTextClass(tone)}`}>{su.name}</p>
                <div className="mt-1 space-y-1 text-[12px]">
                  <p className="text-text-faint truncate">이전 · {displayLessons(su.prev) || su.prev || "기록 없음"}</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex shrink-0 items-center gap-0.5 font-semibold ${toneTextClass(tone)}`}>
                      오늘 <EyIcon name="arrowRight" size={11} />
                    </span>
                    {isMath ? (
                      <ProgressSelector
                        value={su.today}
                        onChange={(joined) => onProgress(i, joined)}
                        studyGrade={studyGrade}
                        onStudyGrade={onStudyGrade}
                        studentGrade={student.grade}
                        prev={su.prev}
                        ariaLabel={`${su.name} 오늘 진도`}
                      />
                    ) : (
                      <input
                        type="text"
                        value={su.today}
                        onChange={(e) => onProgress(i, e.target.value)}
                        placeholder="오늘 진도 입력 (예: Unit 8 · p.90)"
                        aria-label={`${su.name} 오늘 진도 입력`}
                        className="border-line bg-card focus:border-primary h-8 w-full min-w-0 flex-1 rounded-sm border px-2 text-[12px] outline-none transition-colors"
                      />
                    )}
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
