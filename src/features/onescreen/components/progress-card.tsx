import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { SUBJECT_SOLID, SUBJECT_TEXT, subjectColorOfRow } from "@/features/owner/subjects";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { displayLessons, resolveStudyGrade } from "../curriculum";
import { ProgressModePills } from "./progress-mode-pills";
import { ProgressSelector } from "./progress-selector";
import type { OneScreenStudent } from "../types";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { useDisplayOptions } from "./display-options-context";

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
  onProgressMode,
  onStudyGrade,
  onLoadPrev,
  embedded,
  lockedSubjects = [],
}: {
  student: OneScreenStudent;
  onConfirm: () => void;
  onProgress: (subjectIndex: number, today: string) => void;
  /** 오늘 수업 성격(복습·문제풀이) 토글 — 진도와 함께 사는 축(progress-mode.ts). */
  onProgressMode: (subjectIndex: number, mode: string | null) => void;
  onStudyGrade: (grade: string) => void;
  onLoadPrev?: () => void; // 보강 학생 '이전 진도 불러오기'(있을 때만 노출) — 직전 회차를 당겨온다.
  /** 보고서 카드 안에 들어간 상태 — 카드 속 카드로 겹쳐 보이지 않게 그림자·배경을 뺀 얇은 테두리로(2026-08-05 통합). */
  embedded?: boolean;
  lockedSubjects?: readonly string[];
}) {
  const t = useSheetT();
  const { options } = useDisplayOptions();
  const subjectMaps = useSubjectMaps(); // 과목 색 = 학원설정(운영 enum 하드코딩 금지)
  const tf = useSheetTf();
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
            <p className="text-foreground text-sm font-bold">{t("os.pc.title")}</p>
          ) : (
            <>
              <p className="micro text-text-faint">{t("os.pc.kicker")}</p>
              <p className="text-foreground text-base font-bold">{t("os.pc.heading")}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onLoadPrev && (
            <Button variant="outline" size="sm" onClick={onLoadPrev}>
              <EyIcon name="history" size={13} /> {t("os.pc.loadPrev")}
            </Button>
          )}
          <Button variant={student.progressConfirmed ? "outline" : "default"} size="sm" onClick={onConfirm}>
            {student.progressConfirmed ? (
              <>
                <EyIcon name="check" size={13} /> {t("os.pc.confirmed")}
              </>
            ) : (
              t("os.pc.confirm")
            )}
          </Button>
        </div>
      </header>

      <div className={`flex flex-col gap-2 ${embedded ? "px-3 py-2" : "px-4 py-3"}`}>
        {student.subjects.map((su, i) => {
          const tone = subjectColorOfRow(subjectMaps, su);
          const isMath = isMathSubject(su.subjectKey);
          return (
            <fieldset key={i} disabled={lockedSubjects.includes(su.name)} className="flex min-w-0 items-start gap-3 disabled:opacity-60">
              <span className={`mt-1 h-9 w-1 rounded-pill ${SUBJECT_SOLID[tone]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${SUBJECT_TEXT[tone]}`}>{su.name}</p>
                <div className="mt-1 space-y-1 text-xs">
                  {!options.hidePrevious ? <p className="text-text-faint truncate">
                    {tf("os.pc.prev", {
                      text: displayLessons(su.prev) || su.prev || t("os.pc.noRecord"),
                    })}
                  </p> : null}
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex shrink-0 items-center gap-0.5 font-bold ${SUBJECT_TEXT[tone]}`}>
                      {t("os.pc.today")} <EyIcon name="arrowRight" size={11} />
                    </span>
                    {isMath ? (
                      <ProgressSelector
                        value={su.today}
                        onChange={(joined) => onProgress(i, joined)}
                        mode={su.progressMode}
                        onMode={(m) => onProgressMode(i, m)}
                        studyGrade={studyGrade}
                        onStudyGrade={onStudyGrade}
                        studentGrade={student.grade}
                        prev={su.prev}
                        ariaLabel={tf("os.pc.subjectProgressAria", { subject: su.name })}
                      />
                    ) : (
                      // 🔴 한 줄 `<input>`이면 **개행이 뭉개져** "Vocab 41 42Reading section 5-1"으로 읽힌다
                      //    (2026-08-07 실화면 — ECS 시트 초안은 교시가 여럿이면 줄이 여럿이고, 학부모
                      //    보고서는 그 줄바꿈을 살려 그린다). 값에 줄이 있으면 그만큼 보여 준다.
                      <textarea
                        rows={Math.min(4, (su.today.match(/\n/g)?.length ?? 0) + 1)}
                        value={su.today}
                        onChange={(e) => onProgress(i, e.target.value)}
                        placeholder={t("os.pc.inputPh")}
                        aria-label={tf("os.pc.inputAria", { subject: su.name })}
                        className="border-line bg-card focus:border-primary scrollbar-thin w-full min-w-0 flex-1 resize-none rounded-lg border px-2 py-1.5 text-xs leading-relaxed outline-none transition-colors"
                      />
                    )}
                  </div>
                  {/* 자유 입력 과목(영어 등)은 팝오버가 없어 성격 알약이 갈 곳이 없다 → 입력칸 **바로 아래**에
                      (원장 2026-08-07). 수학은 팝오버 안에 이미 있으므로 여기선 안 그린다(같은 것이 두 번). */}
                  {!isMath ? (
                    <div className="mt-1">
                      <ProgressModePills
                        mode={su.progressMode}
                        onMode={(m) => onProgressMode(i, m)}
                        ariaLabel={tf("os.pc.modeAria", { subject: su.name })}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
