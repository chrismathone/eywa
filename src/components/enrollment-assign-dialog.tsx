"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  createEnrollment,
  type CreateEnrollmentState,
} from "@/features/enrollments/server/actions";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export type AssignDialogStudent = {
  id: string;
  name: string;
  grade: string | null;
};

export type AssignDialogClass = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
  studentCount: number;
  /** 반 운영 요일(분리등원 후보). 없으면 등원 요일 선택 미표시. */
  days?: string[];
  /** 스케줄 요약("월·목 14:20") — 반 옵션에서 무슨 요일·몇 시인지 표시. */
  scheduleLabel?: string;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      배정
    </Button>
  );
}

/**
 * 수강 배정 모달. 두 가지 모드:
 * - mode="add-class-to-student": 학생 정보가 고정, 반 목록에서 선택
 * - mode="add-student-to-class": 반 정보가 고정, 학생 목록에서 선택
 */
export function EnrollmentAssignDialog({
  open,
  onClose,
  mode,
  student,
  classes,
  studentOptions,
  fixedClass,
  conflicts,
}: {
  open: boolean;
  onClose: (assigned: boolean) => void;
  mode: "add-class-to-student" | "add-student-to-class";
  student?: AssignDialogStudent;
  classes?: AssignDialogClass[];
  studentOptions?: AssignDialogStudent[];
  fixedClass?: AssignDialogClass;
  conflicts?: { day: string; time: string; existingClass: string }[];
}) {
  const router = useRouter();
  const subjects = useSubjectMaps();
  const [state, formAction] = useActionState<CreateEnrollmentState, FormData>(
    createEnrollment,
    undefined,
  );
  const isStudentMode = mode === "add-class-to-student";

  // 분리등원: 대상 반의 운영 요일. student→class 모드는 드롭다운 선택 반, class→student 모드는 고정 반.
  const [selectedClassId, setSelectedClassId] = useState("");
  const targetClassDays = isStudentMode
    ? (classes?.find((c) => c.id === selectedClassId)?.days ?? [])
    : (fixedClass?.days ?? []);
  const classDaysKey = DAY_ORDER.filter((d) => targetClassDays.includes(d)).join(",");
  // 등원 요일(=학생이 실제 가는 요일). 기본 = 반 전 요일. 대상 반이 바뀌면 그 반 전 요일로 리셋.
  // (effect 대신 "렌더 중 prev 비교 조정" 패턴 — set-state-in-effect 룰 회피, React 권장 #25.)
  const [attendingDays, setAttendingDays] = useState<string[]>(classDaysKey ? classDaysKey.split(",") : []);
  const [prevClassDaysKey, setPrevClassDaysKey] = useState(classDaysKey);
  if (classDaysKey !== prevClassDaysKey) {
    setPrevClassDaysKey(classDaysKey);
    setAttendingDays(classDaysKey ? classDaysKey.split(",") : []);
  }
  const toggleDay = (d: string) =>
    setAttendingDays((prev) => {
      const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
      return DAY_ORDER.filter((x) => next.includes(x));
    });
  const orderedClassDays = classDaysKey ? classDaysKey.split(",") : [];

  // 배정 성공 시 1회만: 배경 새로고침 + 닫기. 부모(ClassAssignAction/StudentAssignAction)가
  // 다이얼로그를 항상 마운트한 채 open만 토글하므로(언마운트 없음) useActionState state가 잔존한다.
  // handledRef에 처리한 enrollmentId를 기록해, stale state가 재오픈 렌더에서 다이얼로그를 다시
  // 닫는 것(=클릭 무반응 버그)을 막는다. 진짜 새 배정(새 UUID)일 때만 다시 발화한다.
  const handledEnrollmentId = useRef<string | null>(null);
  useEffect(() => {
    if (
      state?.enrollmentId &&
      !state.error &&
      handledEnrollmentId.current !== state.enrollmentId
    ) {
      handledEnrollmentId.current = state.enrollmentId;
      router.refresh();
      onClose(true);
    }
  }, [state, router, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">수강 배정</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {isStudentMode ? (
                <>
                  {student?.name}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {student?.grade ?? ""}
                  </span>
                </>
              ) : (
                <>
                  {fixedClass?.className}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {fixedClass ? subjects.labelOf(fixedClass.subject) : ""}
                  </span>
                </>
              )}
            </h2>
            <p className="text-muted-foreground text-xs">
              {isStudentMode ? "배정할 반을 선택하세요" : "배정할 학생을 선택하세요"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          {isStudentMode && student ? (
            <input type="hidden" name="studentId" value={student.id} />
          ) : null}
          {!isStudentMode && fixedClass ? (
            <input type="hidden" name="classId" value={fixedClass.id} />
          ) : null}

          {isStudentMode && classes ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">반 선택</label>
              <SearchableSelect
                name="classId"
                value={selectedClassId}
                onValueChange={setSelectedClassId}
                placeholder="반 선택..."
                searchPlaceholder="반 이름·강사 검색..."
                options={classes.map((c) => ({
                  value: c.id,
                  label: c.className,
                  hint: `${subjects.labelOf(c.subject)}${c.scheduleLabel ? ` · ${c.scheduleLabel}` : ""}${c.teacherName ? ` · ${c.teacherName}` : ""} · ${c.studentCount}명`,
                }))}
              />
            </div>
          ) : null}

          {!isStudentMode && studentOptions ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">학생 선택</label>
              <SearchableSelect
                name="studentId"
                placeholder="학생 선택..."
                searchPlaceholder="학생 이름 검색..."
                options={studentOptions.map((s) => ({
                  value: s.id,
                  label: s.name,
                  hint: s.grade ?? undefined,
                }))}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-muted-foreground block text-[11px] font-medium">
                시작일
              </label>
              <input
                name="startDate"
                type="date"
                required
                defaultValue={kstToday()}
                className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground block text-[11px] font-medium">
                종료일 (선택)
              </label>
              <input
                name="endDate"
                type="date"
                className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {orderedClassDays.length > 0 ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">
                등원 요일
                <span className="text-muted-foreground ml-1 text-xs font-normal">
                  · 특정 요일만 등원하면 해제 (분리등원)
                </span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {orderedClassDays.map((d) => {
                  const on = attendingDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      aria-pressed={on}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {DAY_LABEL[d] ?? d}
                    </button>
                  );
                })}
              </div>
              <input type="hidden" name="attendanceDays" value={attendingDays.join(",")} />
              <p className="text-muted-foreground text-[11px]">
                {attendingDays.length === 0
                  ? "요일을 선택하지 않으면 전 요일 등원으로 저장됩니다."
                  : attendingDays.length >= orderedClassDays.length
                    ? "전 요일 등원"
                    : `${attendingDays.map((d) => DAY_LABEL[d] ?? d).join("·")}만 등원`}
              </p>
            </div>
          ) : null}

          {conflicts && conflicts.length > 0 ? (
            <div className="border-chart-4/40 bg-chart-4/5 rounded-md border px-3 py-2 text-xs">
              <div className="text-chart-4 inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                <span className="font-semibold">시간 충돌</span>
              </div>
              <ul className="text-foreground mt-1 space-y-0.5">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    {c.day}요일 {c.time} — {c.existingClass}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

          <footer className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              취소
            </Button>
            <Submit />
          </footer>
        </form>
      </div>
    </div>
  );
}
