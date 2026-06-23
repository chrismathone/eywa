import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EyIcon } from "@/components/icons/eywa-icons";
import { subjectTone, toneSolidClass, toneTextClass } from "../data";
import {
  CURRICULUM_GRADES,
  curriculumForGradeSemester,
  semesterOfLesson,
  semestersForGrade,
  type Semester,
} from "../curriculum";
import type { OneScreenStudent } from "../types";

/**
 * 진도 카드 — 진도(수업) 학년 + 학기 + 차시를 단계적으로 좁혀 선택.
 * - 진도 학년은 실제 학년과 다를 수 있음(선행/후행) → 학생 grade에 고정하지 않는다.
 * - 학기는 "현재 진도(today)"에서 자동 도출 → 학생을 열면 직전 수업에서 고른 위치가
 *   그대로 선택되어 있어 매번 다시 찾을 필요가 없다.
 * - 차시 드롭다운은 (학년 + 학기)로 스코프 → 목록이 짧아짐. Base UI Select라 팝업/
 *   스크롤바가 앱 톤(전역 스크롤바 규칙) 그대로.
 */
export function ProgressCard({
  student,
  onConfirm,
  onProgress,
  onStudyGrade,
  onSemester,
}: {
  student: OneScreenStudent;
  onConfirm: () => void;
  onProgress: (subjectIndex: number, today: string) => void;
  onStudyGrade: (grade: string) => void;
  onSemester: (semester: Semester) => void;
}) {
  const studyGrade = student.studyGrade ?? student.grade;
  const ahead = studyGrade !== student.grade;
  // 학기 = 현재 진도(첫 과목 today)에서 자동 도출 (자동 입력 핵심)
  const firstToday = student.subjects[0]?.today ?? "";
  const semester = semesterOfLesson(studyGrade, firstToday);
  const semesters = semestersForGrade(studyGrade);
  const units = curriculumForGradeSemester(studyGrade, semester);
  // 과목별 진도 입력 방식: math 과목은 커리큘럼 드롭다운, 그 외(영어 등)는 freeform 텍스트.
  // subjectKey 미지정(데모)은 math로 간주 → 기존 동작 보존. 진도 학년/학기 행도 math 과목이 있을 때만.
  const isMathSubject = (key: string | undefined) => (key ?? "math") === "math";
  const hasMath = student.subjects.some((su) => isMathSubject(su.subjectKey));

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
        {/* 진도 학년 + 학기 — 실제 학년과 분리 (선행/후행). 커리큘럼이 있는 과목(math)이 있을 때만. */}
        {hasMath ? (
        <div className="bg-bg-soft flex flex-wrap items-center gap-2 rounded-sm px-3 py-2">
          <span className="micro text-text-faint">진도</span>
          <Select
            value={studyGrade}
            onValueChange={(v) => {
              if (v) onStudyGrade(v as string);
            }}
          >
            <SelectTrigger size="sm" aria-label="진도 학년 선택">
              <SelectValue>{(v) => v as string}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {CURRICULUM_GRADES.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={semester}
            onValueChange={(v) => {
              if (v) onSemester(v as Semester);
            }}
          >
            <SelectTrigger size="sm" aria-label="학기 선택">
              <SelectValue>{(v) => `${v}학기`}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {semesters.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}학기
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-text-faint text-[11px]">실제 {student.grade}</span>
          {ahead ? (
            <span className="bg-amber-soft text-amber rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold">
              {student.grade}과 다름
            </span>
          ) : null}
        </div>
        ) : null}

        {student.subjects.map((su, i) => {
          const { tone } = subjectTone(su.name);
          const isMath = isMathSubject(su.subjectKey);
          return (
            <div key={i} className="flex items-start gap-3">
              <span className={`mt-1 h-9 w-1 rounded-pill ${toneSolidClass(tone)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-bold ${toneTextClass(tone)}`}>{su.name}</p>
                <div className="mt-1 space-y-1 text-[12px]">
                  <p className="text-text-faint truncate">이전 · {su.prev || "기록 없음"}</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 font-semibold ${toneTextClass(tone)}`}>오늘 →</span>
                    {isMath ? (
                      <Select
                        value={su.today}
                        onValueChange={(v) => {
                          if (v) onProgress(i, v as string);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-full min-w-0 flex-1"
                          aria-label={`${su.name} 오늘 진도 선택`}
                        >
                          <SelectValue placeholder="차시 선택">{(v) => v as string}</SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false} className="max-h-80">
                          {units.map((unit) => (
                            <SelectGroup key={unit.unit}>
                              <SelectLabel>{unit.unit}</SelectLabel>
                              {unit.lessons.map((l) => (
                                <SelectItem key={l} value={l}>
                                  {l}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
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
