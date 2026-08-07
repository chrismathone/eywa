import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { subjectTone, toneSolidClass, toneTextClass } from "../data";
import { displayLessons, resolveStudyGrade } from "../curriculum";
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
  embedded,
}: {
  student: OneScreenStudent;
  onConfirm: () => void;
  onProgress: (subjectIndex: number, today: string) => void;
  onStudyGrade: (grade: string) => void;
  onLoadPrev?: () => void; // 보강 학생 '이전 진도 불러오기'(있을 때만 노출) — 직전 회차를 당겨온다.
  /** 보고서 카드 안에 들어간 상태 — 카드 속 카드로 겹쳐 보이지 않게 그림자·배경을 뺀 얇은 테두리로(2026-08-05 통합). */
  embedded?: boolean;
}) {
  const studyGrade = resolveStudyGrade(student.studyGrade ?? student.grade);
  const isMathSubject = (key: string | undefined) => (key ?? "math") === "math";

  return (
    <div className={embedded ? "border-line rounded-lg border" : "bg-card border-line shadow-card rounded-2xl border"}>
      {/* 보고서 카드 안(embedded)에선 제목을 **한 줄**로 줄인다 — 원장 2026-08-05 "공간 절약가능한곳은
          최대한 극한으로". 단독 카드로 쓸 때는 기존 2줄 제목 그대로. */}
      <header
        className={`border-line flex items-center justify-between gap-2 border-b ${
          embedded ? "px-3 py-2" : "px-4 py-3"
        }`}
      >
        <div>
          {embedded ? (
            <p className="text-foreground text-[13px] font-bold">오늘 진도</p>
          ) : (
            <>
              <p className="micro text-text-faint">진도 확인</p>
              <p className="text-foreground text-[15px] font-bold">오늘 어디까지 나갔나요</p>
            </>
          )}
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

      <div className={`flex flex-col gap-2 ${embedded ? "px-3 py-2" : "px-4 py-3"}`}>
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
                    <span className={`inline-flex shrink-0 items-center gap-0.5 font-bold ${toneTextClass(tone)}`}>
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
                      // 🔴 한 줄 `<input>`이면 **개행이 뭉개져** "Vocab 41 42Reading section 5-1"으로 읽힌다
                      //    (2026-08-07 실화면 — ECS 시트 초안은 교시가 여럿이면 줄이 여럿이고, 학부모
                      //    보고서는 그 줄바꿈을 살려 그린다). 값에 줄이 있으면 그만큼 보여 준다.
                      <textarea
                        rows={Math.min(4, (su.today.match(/\n/g)?.length ?? 0) + 1)}
                        value={su.today}
                        onChange={(e) => onProgress(i, e.target.value)}
                        placeholder="오늘 진도 입력 (예: Unit 8 · p.90)"
                        aria-label={`${su.name} 오늘 진도 입력`}
                        className="border-line bg-card focus:border-primary scrollbar-thin w-full min-w-0 flex-1 resize-none rounded-lg border px-2 py-1.5 text-[12px] leading-relaxed outline-none transition-colors"
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
