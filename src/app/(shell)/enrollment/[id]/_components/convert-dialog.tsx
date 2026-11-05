"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, Loader2, UserPlus, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useWindowMode } from "@/components/workspace/use-window-mode";
import { useWindowStore } from "@/components/workspace/window-store";
import { windowIdForHref } from "@/components/workspace/window-link";
import { addDays, formatKoreanDate, kstToday } from "@/lib/date-kst";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  ASSIGN_START_MAX_AHEAD_DAYS,
  ASSIGN_START_MAX_BACK_DAYS,
  assignStartDateNotice,
  normalizeAssignStartDate,
} from "@/features/enrollment/assign-start-date";
import {
  convertConsultationToStudent,
  type ConvertToStudentState,
} from "@/features/enrollment/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

type ClassOption = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
};

/**
 * 교재 신청서로 잇는 기준 과목. 원장 2026-09-09: *"수학 반을 배정했다면, 바로 교재까지 그 자리에서
 * 신청서 작성할 수 있게 연결"*. 🔴 **반 이름이 아니라 `classes.subject` 키로 판정**한다(이름을 바꾸면
 * 조용히 끊긴다 — 학원이 건과 같은 함정). 라벨·색이 아니라 **키**라 학원설정 enum 하드코딩 규칙 밖이고,
 * MCS 대상 판정(`subject === "math"`)·수학 시간표 내보내기와 같은 축이다.
 */
const TEXTBOOK_SUBJECT_KEY = "math";

function SubmitBtn({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      수업 배정
    </Button>
  );
}

export function ConvertToStudentDialog({
  consultationId,
  defaults,
  classes,
  recommendedIds,
  alreadyConverted,
  linkedStudentId,
  canRequestTextbook,
  canWrite = true,
}: {
  consultationId: string;
  defaults: {
    name: string;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
  classes: ClassOption[];
  recommendedIds: string[];
  alreadyConverted: boolean;
  linkedStudentId: string | null;
  /**
   * 이 사람이 교재 요청 화면을 열 수 있는가(`textbook_requests` 쓰기). 배정 뒤 '교재 신청서' 경로를
   * **그릴지 말지**를 정한다 — 못 여는 사람에게 그리면 눌러도 권한 화면으로 튕기는 죽은 버튼이 된다.
   * ⚠️ 판정은 서버(페이지)에서 온다. 진짜 게이트는 교재 화면 자신의 `requireAccess`다([[#77]]).
   */
  canRequestTextbook: boolean;
  /**
   * 신규 콜&상담 쓰기 권한(`canWriteTenant(…,"enrollment")` — 서버 `convertConsultationToStudent`와 같은 게이트).
   * false면 '수업 배정' 단추를 그리지 않는다(원장 2026-11-05 · write-lock.ts). 이미 배정된 건의 '학생 정보 보기'는 읽기라 남는다.
   */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const isDesktop = useWindowMode();
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ConvertToStudentState, FormData>(
    convertConsultationToStudent,
    undefined,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(recommendedIds));
  const [classFilter, setClassFilter] = useState("");

  // 배정일(원장 2026-09-09) — 기본값은 KST 오늘이라 **아무것도 안 만지면 종전과 같은 동작**이다.
  // 규칙(허용 범위·문구)은 서버 액션과 같은 순수 함수를 쓴다 — 화면 검증은 편의고 게이트는 서버다.
  const today = kstToday();
  const [startDate, setStartDate] = useState(today);
  const parsedStart = normalizeAssignStartDate(startDate, today);
  const startError = "error" in parsedStart ? parsedStart.error : null;
  const startNotice =
    "error" in parsedStart
      ? null
      : startDate.trim() === ""
        ? `비워 두면 오늘(${formatKoreanDate(today)})부터 배정됩니다.`
        : assignStartDateNotice(parsedStart.date, today);

  const ql = classFilter.trim().toLowerCase();
  const filteredClasses = ql
    ? classes.filter(
        (c) =>
          c.className.toLowerCase().includes(ql) ||
          (c.teacherName ?? "").toLowerCase().includes(ql) ||
          subjects.labelOf(c.subject).toLowerCase().includes(ql),
      )
    : classes;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 라우트 열기 — 데스크톱은 플로팅 창, 그 외(모바일·창 안)는 이동. 이 화면의 세 링크가 같은 경로를 쓴다. */
  function openRoute(href: string, title: string) {
    const resolved = isDesktop ? windowIdForHref(href) : null;
    if (resolved) useWindowStore.getState().open("route", { id: resolved.id, title, href });
    else router.push(href);
  }

  // 이번 저장으로 **실제로 만들어진** 수강(서버가 돌려준 것). 클라 체크박스로 세지 않는다 —
  // 기존 학생 재사용 시 이미 등록된 반은 서버가 걸러내므로 그 차이가 곧 거짓 안내가 된다.
  const success = state && !state.error && state.studentId ? state : null;
  const assignedClasses = (success?.assignedClassIds ?? [])
    .map((id) => classes.find((c) => c.id === id))
    .filter((c): c is ClassOption => !!c);
  const mathAssigned = assignedClasses.some((c) => c.subject === TEXTBOOK_SUBJECT_KEY);
  // 수학 반이 붙었으면 학생 화면으로 튕기지 않고 **그 자리에서** 교재 신청서로 잇는다.
  const textbookStep = !!success && canRequestTextbook && mathAssigned;

  // 성공 처리 1회 — 같은 studentId에 두 번 발화하지 않게 ref로 잠근다(항상 마운트된 다이얼로그라
  // useActionState 결과가 잔존한다, [[#67]]). setState를 하지 않으므로 set-state-in-effect(#25) 밖이다.
  const handledStudentId = useRef<string | null>(null);
  useEffect(() => {
    const sid = success?.studentId;
    if (!sid || handledStudentId.current === sid) return;
    handledStudentId.current = sid;
    if ((success?.assignedClassIds?.length ?? 0) > 0) notifyTermPlansChanged();
    // 동명이인이라 접미사가 붙었으면 **이동 전에** 알린다 — 조용히 이름을 바꾸면 직원이 나중에
    // "내가 넣은 이름이 아닌데?" 하고 헤맨다.
    if (success?.notice) toast.warning(success.notice, { duration: 8000 });
    // 교재 단계가 서면 그 화면에 머문다. 아니면 종전대로 학생 화면으로 — 단 이동은 `openRoute`로 한다:
    // 서버 액션 **직후의 `router.push`는 응답이 현재 라우트를 다시 적용하면서 삼켜질 수 있고**([[#102]]),
    // 데스크톱 최상위에선 이동해 봐야 배경이 창에 가려 아무 일도 안 일어난 것처럼 보인다([[#86]]).
    if (!textbookStep) openRoute(`/students/${sid}`, defaults.name ?? "학생");
    // openRoute·defaults는 매 렌더 새로 만들어지지만 이 효과는 studentId 1회 가드(handledStudentId)로
    // 잠겨 있어 재실행돼도 아무 일도 하지 않는다 — 의존성에 넣어 봐야 같은 결과라 목록에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success, textbookStep]);

  // 교재 단계를 그리는 중이면 아래 '학생 정보 보기' 조기 반환에 먹히지 않게 한다 — 서버 액션의
  // revalidate로 페이지가 다시 그려지면서 alreadyConverted가 true가 되어 모달이 통째로 사라진다.
  const showCompletion = textbookStep && open;

  if (alreadyConverted && linkedStudentId && !showCompletion) {
    return (
      <Button
        variant="outline"
        onClick={() => openRoute(`/students/${linkedStudentId}`, defaults.name ?? "학생")}
      >
        <UserPlus className="size-4" />
        학생 정보 보기
      </Button>
    );
  }
  // 훅은 위에서 다 부른 뒤에 끊는다(규칙 순서 유지) — 읽기 권한이면 배정 단추·양식째 없다.
  if (!canWrite) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        수업 배정
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="bg-background border-border w-full max-w-lg rounded-xl border p-6 shadow-lg">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <p className="eyebrow">{showCompletion ? "배정 완료" : "상담 → 수업 배정"}</p>
                <h2 className="text-foreground mt-1 text-lg font-bold">
                  {showCompletion ? `${defaults.name} 배정 완료` : `${defaults.name} 수업 배정`}
                </h2>
                <p className="text-muted-foreground text-xs">
                  {showCompletion
                    ? "학생이 등록되고 수업이 배정됐습니다."
                    : "학생 정보를 확인하고 배정할 반을 1개 이상 선택하세요."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="닫기"
              >
                <X className="size-4" />
              </button>
            </header>

            {showCompletion && success ? (
              <CompletionStep
                studentName={defaults.name}
                startDate={success.startDate ?? today}
                assigned={assignedClasses.map((c) => ({
                  id: c.id,
                  className: c.className,
                  subjectLabel: subjects.labelOf(c.subject),
                  isTextbookSubject: c.subject === TEXTBOOK_SUBJECT_KEY,
                }))}
                onTextbook={() => {
                  const sid = success.studentId;
                  if (!sid) return;
                  setOpen(false);
                  openRoute(`/textbook-requests?studentId=${encodeURIComponent(sid)}`, "교재 요청");
                }}
                onStudent={() => {
                  const sid = success.studentId;
                  if (!sid) return;
                  setOpen(false);
                  openRoute(`/students/${sid}`, defaults.name ?? "학생");
                }}
                onClose={() => setOpen(false)}
              />
            ) : (
              <form action={formAction} className="space-y-3">
                <input type="hidden" name="consultationId" value={consultationId} />

                <div className="grid grid-cols-2 gap-2">
                  <Field label="이름" name="name" defaultValue={defaults.name} required />
                  <Field label="학년" name="grade" defaultValue={defaults.grade ?? ""} />
                  <Field label="학교" name="school" defaultValue={defaults.school ?? ""} />
                  <Field
                    label="학부모"
                    name="parentName"
                    defaultValue={defaults.parentName ?? ""}
                  />
                  <Field
                    label="연락처"
                    name="parentPhone"
                    defaultValue={defaults.parentPhone ?? ""}
                    className="col-span-2"
                    mono
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="convert-start-date"
                    className="text-foreground block text-sm font-medium"
                  >
                    배정일
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      · 이 날짜부터 수업에 들어갑니다
                    </span>
                  </label>
                  <input
                    id="convert-start-date"
                    name="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={addDays(today, -ASSIGN_START_MAX_BACK_DAYS)}
                    max={addDays(today, ASSIGN_START_MAX_AHEAD_DAYS)}
                    className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
                  />
                  {startError ? (
                    <p className="text-danger text-xs break-keep">{startError}</p>
                  ) : startNotice ? (
                    // 오늘이 아닌 날짜를 골랐으면 **무슨 일이 벌어지는지** 한 줄로 말한다(조용히 다르게 굴지 않는다).
                    <p className="text-gold text-xs break-keep">{startNotice}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <label className="text-foreground block text-sm font-medium">
                    배정할 반 (다중 선택, 최소 1개)
                  </label>
                  {classes.length > 12 ? (
                    <input
                      type="search"
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                      placeholder="반 이름·강사·과목 검색..."
                      className="border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-2.5 py-1.5 text-xs focus:outline-none"
                    />
                  ) : null}
                  <div className="border-border bg-bg-soft/30 max-h-48 overflow-auto rounded-md border p-2">
                    {classes.length === 0 ? (
                      <p className="text-muted-foreground text-xs">활성 반이 없습니다</p>
                    ) : filteredClasses.length === 0 ? (
                      <p className="text-muted-foreground text-xs">검색 결과 없음</p>
                    ) : (
                      <ul className="space-y-1">
                        {filteredClasses.map((c) => {
                          const isSelected = selected.has(c.id);
                          const isRecommended = recommendedIds.includes(c.id);
                          return (
                            <li key={c.id}>
                              <label className="hover:bg-bg-soft flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm">
                                <input
                                  type="checkbox"
                                  name="classIds"
                                  value={c.id}
                                  checked={isSelected}
                                  onChange={() => toggle(c.id)}
                                  className="mt-0.5"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-foreground font-medium">
                                      {c.className}
                                    </span>
                                    <span className="text-muted-foreground text-xs">
                                      {subjects.labelOf(c.subject)}
                                    </span>
                                    {isRecommended ? (
                                      // 추천 = 학생 학년이 반 이름에 들어가는 반(actions.ts gradePrefix 부분일치).
                                      // AI 추론이 아니라 학년 매칭이므로 "학년 추천"으로 정직하게 표기.
                                      <span className="bg-chart-4/10 text-chart-4 border-chart-4/20 rounded-md border px-1 py-0 text-xs font-medium">
                                        학년 추천
                                      </span>
                                    ) : null}
                                  </div>
                                  {c.teacherName ? (
                                    <p className="text-muted-foreground text-xs">
                                      {c.teacherName} 강사
                                    </p>
                                  ) : null}
                                </div>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    선택한 반으로 학생이 생성되고 수업이 배정됩니다. 반은 나중에 학생 상세에서 추가·변경할 수 있습니다.
                  </p>
                </div>

                {state?.error ? (
                  <div className="border-chart-4/40 bg-chart-4/5 space-y-2 rounded-md border px-3 py-2">
                    <p className="text-chart-4 text-sm">{state.error}</p>
                    {state.existingStudentId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const sid = state?.existingStudentId;
                            if (!sid) return;
                            openRoute(`/students/${sid}`, defaults.name ?? "학생");
                          }}
                        >
                          <UserPlus className="size-4" />
                          {state.withdrawnMatch ? "퇴원 학생 열기(재원 복구)" : "기존 학생 정보 보기"}
                        </Button>
                        {/* 퇴원생과 이름·학교·학년만 같은 **다른 아이**일 수도 있다 — 그때만 사람이 골라 새로 만든다(감사 F13).
                            자동 병합은 없다. submitter의 name/value가 FormData에 실린다. */}
                        {state.withdrawnMatch ? (
                          <Button
                            type="submit"
                            variant="ghost"
                            name="ignoreWithdrawn"
                            value="1"
                            disabled={selected.size === 0 || !!startError}
                          >
                            다른 학생이면 새로 등록
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {selected.size === 0 ? (
                  <p className="text-muted-foreground text-xs">배정할 반을 1개 이상 선택해야 합니다.</p>
                ) : null}

                <footer className="flex items-center justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    취소
                  </Button>
                  <SubmitBtn disabled={selected.size === 0 || !!startError} />
                </footer>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * 배정 직후 화면 — **수학 반이 붙었을 때만** 선다(원장 2026-09-09 "바로 교재까지 그 자리에서").
 * 새 교재 신청 경로를 만들지 않고 기존 교재 요청 화면(`/textbook-requests`)을 학생만 채워서 연다.
 */
function CompletionStep({
  studentName,
  startDate,
  assigned,
  onTextbook,
  onStudent,
  onClose,
}: {
  studentName: string;
  startDate: string;
  assigned: { id: string; className: string; subjectLabel: string; isTextbookSubject: boolean }[];
  onTextbook: () => void;
  onStudent: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="border-line bg-bg-soft/30 space-y-1.5 rounded-md border px-3 py-2">
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">{studentName}</span> 학생이{" "}
          <span className="text-foreground font-medium">{formatKoreanDate(startDate)}</span>부터 아래 반에
          배정됐습니다.
        </p>
        <ul className="space-y-0.5">
          {assigned.map((c) => (
            <li key={c.id} className="text-foreground text-sm">
              <span className="font-medium">{c.className}</span>
              <span className="text-muted-foreground ml-1.5 text-xs">{c.subjectLabel}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-foreground text-sm break-keep">
        {assigned.find((c) => c.isTextbookSubject)?.subjectLabel} 반이 배정됐습니다 — 교재 신청서를
        지금 바로 작성할 수 있습니다.
      </p>

      <footer className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          닫기
        </Button>
        <Button type="button" variant="outline" onClick={onStudent}>
          <UserPlus className="size-4" />
          학생 정보 보기
        </Button>
        <Button type="button" onClick={onTextbook}>
          <BookOpen className="size-4" />
          교재 신청서 작성
        </Button>
      </footer>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  mono,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  mono?: boolean;
  className?: string;
}) {
  // 컨트롤드 — React 19는 `<form action>` 제출마다 비컨트롤드 입력을 기본값으로 되돌린다(#83). 퇴원생 경고 뒤
  // '다른 학생이면 새로 등록'으로 다시 제출할 때 직원이 고친 학년·연락처가 상담 원본으로 돌아가면 안 된다.
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-muted-foreground block text-xs font-medium">{label}</label>
      <input
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        className={`border-border bg-card text-foreground w-full rounded-md border px-2 py-1.5 text-sm ${mono ? "num" : ""}`}
      />
    </div>
  );
}
