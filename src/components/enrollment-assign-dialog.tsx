"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, UserPlus, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { conflictToast } from "@/lib/ui/conflict-toast";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { enrollmentPeriodsOverlap } from "@/features/enrollments/eligibility";
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
  /**
   * 이 학생이 **이 반에 이미 가진 수강 기간**(지난 것 포함). DB GiST가 같은 (학생,반)에 기간이 겹치는
   * 배정을 거부하므로, 저장을 눌러 실패하기 전에 화면에서 미리 알려주려고 받는다.
   * 미지정이면 사전 경고 없이 서버 메시지에 맡긴다(반→학생 모드).
   */
  existingPeriods?: { start: string; end: string | null }[];
};

function Submit({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      배정
    </Button>
  );
}

/** "2026-08-04" → "2026-08-04부터" / 종료가 있으면 "2026-08-04 ~ 2026-08-31". */
function periodLabel(e: { start: string; end: string | null }): string {
  return e.end ? `${e.start} ~ ${e.end}` : `${e.start}부터`;
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
  const selectedClass = isStudentMode
    ? classes?.find((c) => c.id === selectedClassId)
    : fixedClass;
  const targetClassDays = selectedClass?.days ?? [];
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

  // 수강 기간(제어 입력) — 겹침을 저장 전에 판정하려면 값을 알아야 한다.
  const today = kstToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  // 같은 (학생,반)에 기간이 겹치는 배정은 DB GiST가 거부한다 → **누르기 전에** 화면에서 막고 이유를 준다.
  // (겹치는데도 저장을 누르면 서버가 영문 제약 에러를 냈던 2026-07-28 제보의 근본 원인.)
  const isoStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null;
  const overlapping = isoStart
    ? (selectedClass?.existingPeriods ?? []).filter((p) =>
        enrollmentPeriodsOverlap(p.start, p.end, isoStart, endDate || null),
      )
    : [];
  // 반 옵션에 "이미 배정됨" 힌트 — 목록에서 고르기 전에 보이게(오늘 이후로 살아있는 수강만).
  const assignedHint = (c: AssignDialogClass) => {
    const live = (c.existingPeriods ?? []).find((p) => !p.end || p.end > today);
    return live ? ` · 이미 배정됨(${periodLabel(live)})` : "";
  };

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

  // 수강 기간 겹침 등 저장 차단 경고 — 인라인 텍스트 + 가운데(top-center) 토스트 병행(제출 결과 바뀔 때만).
  const notifiedError = useRef<CreateEnrollmentState>(undefined);
  useEffect(() => {
    if (state === notifiedError.current) return;
    notifiedError.current = state;
    if (state?.error) conflictToast(state.error);
  }, [state]);
  // 배정 다이얼로그를 열 때 이미 시간 충돌이 있으면 한 번 가운데 알림(작은 인라인 박스 보완).
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current && conflicts && conflicts.length > 0) {
      conflictToast(`시간 충돌: ${conflicts.map((c) => `${c.day}요일 ${c.time}`).join(", ")}`);
    }
    prevOpen.current = open;
  }, [open, conflicts]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border w-full max-w-md rounded-xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">수강 배정</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">
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
                searchPlaceholder="반 이름·과목·강사 검색..."
                // ⚠️ 기본 cap 50이면 이름순 앞을 로마자 영어반이 독점해 목록을 훑을 때 수학반이
                // 8개만 보였다(gotcha #84). 학생을 수학반에 배정하는 게 이 다이얼로그의 주 용도다.
                cap={300}
                options={classes.map((c) => ({
                  value: c.id,
                  label: c.className,
                  hint: `${subjects.labelOf(c.subject)}${c.scheduleLabel ? ` · ${c.scheduleLabel}` : ""}${c.teacherName ? ` · ${c.teacherName}` : ""} · ${c.studentCount}명${assignedHint(c)}`,
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
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border-border bg-card text-foreground num w-full rounded-lg border px-2 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground block text-[11px] font-medium">
                종료일 (선택)
              </label>
              <input
                name="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border-border bg-card text-foreground num w-full rounded-lg border px-2 py-1.5 text-sm"
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
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
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
            <div className="border-chart-4/40 bg-chart-4/5 rounded-lg border px-3 py-2 text-xs">
              <div className="text-chart-4 inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                <span className="font-bold">시간 충돌</span>
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

          {overlapping.length > 0 ? (
            <div className="border-danger/40 bg-danger/5 rounded-lg border px-3 py-2 text-xs">
              <div className="text-danger inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                <span className="font-bold">이미 배정된 반</span>
              </div>
              <p className="text-foreground mt-1">
                이 학생은 <span className="font-medium">{selectedClass?.className}</span>에 이미{" "}
                <span className="num">{periodLabel(overlapping[0])}</span> 배정되어 있습니다. 같은 반에
                기간이 겹치는 배정은 만들 수 없습니다.
              </p>
              <p className="text-muted-foreground mt-1">
                시작일을 겹치지 않게 바꾸거나, 학생 상세 &lsquo;수업&rsquo; 탭에서 기존 수강의 날짜·등원
                요일을 수정해 주세요.
              </p>
            </div>
          ) : null}

          {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

          <footer className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              취소
            </Button>
            <Submit disabled={overlapping.length > 0} />
          </footer>
        </form>
      </div>
    </div>
  );
}
