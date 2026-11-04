"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2, X } from "@/components/icons/aywa-icon-compat";
import { kstToday } from "@/lib/date-kst";
import { endChoices, type EndChoice } from "../end-choices";
import { endSingleEnrollment } from "@/features/students/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { ReasonFields } from "@/features/withdrawals/reason-fields";
import { endScopeText, endScopeViaReport, fetchEndScope } from "@/features/timetable/lib/end-scope-text";

/**
 * 수강 종료 — 이 수강 **한 건**을 끝낸다(퇴원 아님·반 폐지 아님).
 *
 * 원장 2026-09-01: *"반에서 바로 학생 수강종료 다이렉트로 할 수 있는 기능 추가"* → *"'퇴원'이 아닌
 * '수강 종료'"* → *"누르면 '오늘까지 수업인지, 어제까지 수업인지' 물어볼 것"*.
 *
 * 🔑 **학생 상세와 반 상세가 같은 이 한 벌**을 쓴다 — 종료가 표면마다 다른 UI로 갈리면 한쪽만 고쳐진다
 *    (서버는 이미 `endSingleEnrollment` 하나로 모여 있고 종료 규약은 `endEnrollmentById`가 단일 소스다).
 * 🔴 권한은 **학생 쓰기(full)** — 강사는 학생 기록 열람 전용(원장 2026-08-18)이라 호출부가 버튼을
 *    숨기고, 서버 액션이 `canManageStudentRecords`로 한 번 더 막는다(#77 이중 방어).
 * 🔑 **사유를 고른다**(원장 2026-10-15 *"기타는 모든 곳을 일치하게"*) — 상태 전환 창과 같은 칸(`ReasonFields`: 대분류 · 세부 ·
 *    '기타'면 메모 필수). 예전엔 사유 없이 '기타'로 끝나 퇴원관리에 메모 없는 '기타'가 쌓였다. 날짜 버튼이 곧 저장이라
 *    누르면 먼저 칸 검사(`reportValidity`)를 지난다 — 서버도 같은 규칙으로 다시 본다(`readReasonForm`).
 * 🔴 **마지막 수업이면 창이 열리는 순간 막는다**(원장 2026-11-02) — 학생의 마지막 반 · 영어·수학 등 그 과목의 마지막 반은 사유를 다 고른 뒤
 *    맨 아래 작은 글씨로 거절하지 않고, 입력 칸 대신 '반이동이면 반 이동 메뉴로, 퇴원(수강종료)이면 퇴원보고서'만 보여 준다.
 *    판정은 시간표 확인 문구와 같은 서버 판정이고, 조회가 실패해도 저장 때 `endSingleEnrollment`가 다시 막는다.
 * ⚠️ 아직 시작 안 한 수강(배정 예정)엔 붙이지 말 것 — 종료일이 시작일로 클램프돼 두 갈래가 **같은
 *    결과**가 된다(그건 '종료'가 아니라 배정 취소라 학생 상세의 삭제가 맡는다).
 */
export function EndEnrollmentAction({
  enrollmentId,
  studentId,
  studentName,
  className,
  currentEndDate,
  startDate,
  today = kstToday(),
}: {
  enrollmentId: string;
  studentId: string;
  /** 반 상세처럼 **여러 학생이 한 화면에** 있는 곳에서 누구를 끝내는지 확인시키기 위해. */
  studentName?: string;
  className: string;
  /** 이미 종료일이 잡혀 있으면(오늘까지는 아직 명단에 남는다) 그 값을 보여 준다. */
  currentEndDate?: string | null;
  /** 수강 시작일 — 그보다 앞선 갈래는 고를 수 없게 막는다(클램프로 설명이 거짓말이 되는 것 방지). */
  startDate?: string | null;
  /** 테스트·SSR 일관성용 주입구. 기본값 = KST 오늘. */
  today?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="이 수강을 종료합니다 (퇴원·반 폐지 아님)"
        className="text-text-dim hover:text-danger hover:border-danger/30 hover:bg-danger/10 inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-xs whitespace-nowrap transition"
      >
        <LogOut className="size-3" />
        수강 종료
      </button>
      {open ? (
        <EndDialog
          enrollmentId={enrollmentId}
          studentId={studentId}
          studentName={studentName}
          className={className}
          currentEndDate={currentEndDate}
          startDate={startDate}
          today={today}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function EndDialog({
  enrollmentId,
  studentId,
  studentName,
  className,
  currentEndDate,
  startDate,
  today,
  onClose,
}: {
  enrollmentId: string;
  studentId: string;
  studentName?: string;
  className: string;
  currentEndDate?: string | null;
  startDate?: string | null;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const choices = endChoices(today, startDate);
  const [gate, setGate] = useState<{ checking: boolean; blocked: string | null }>({ checking: true, blocked: null });

  useEffect(() => {
    let alive = true;
    void fetchEndScope(enrollmentId, today).then((result) => {
      if (alive) setGate({ checking: false, blocked: endScopeViaReport(result) ? endScopeText(result) : null });
    });
    return () => {
      alive = false;
    };
  }, [enrollmentId, today]);

  const submit = (choice: EndChoice) => {
    const form = formRef.current;
    // 사유 칸(대분류 필수 · '기타'면 메모 필수)을 먼저 — 비었으면 브라우저가 그 칸을 짚어 준다.
    if (!form || !form.reportValidity()) return;
    setBusy(true);
    setError(null);
    const fd = new FormData(form);
    fd.set("enrollmentId", enrollmentId);
    fd.set("studentId", studentId);
    fd.set("date", choice.date);
    void endSingleEnrollment(undefined, fd)
      .then((res) => {
        if (res?.error) {
          setError(res.error);
          setBusy(false);
          return;
        }
        notifyTermPlansChanged();
        // 배경(반 상세·학생 상세)이 새 명단으로 다시 그려진 뒤 닫는다.
        startTransition(() => router.refresh());
        onClose();
      })
      .catch(() => {
        setError("종료 결과를 확인하지 못했습니다(네트워크 오류 등). 다시 시도해 주세요.");
        setBusy(false);
      });
  };

  const working = busy || pending;
  if (gate.blocked) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
        <div role="alertdialog" aria-label="수강 종료 불가" className="bg-background border-border w-full max-w-md rounded-2xl border p-6 shadow-lg">
          <p className="eyebrow">수강 종료</p>
          <h2 className="text-foreground mt-1 truncate text-lg font-bold">
            {studentName ? `${studentName} · ` : ""}
            {className}
          </h2>
          <p className="text-danger mt-3 text-sm font-medium">{gate.blocked}</p>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground px-3 py-1.5 text-sm">
              닫기
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">수강 종료</p>
            <h2 className="text-foreground mt-1 truncate text-lg font-bold">
              {studentName ? `${studentName} · ` : ""}
              {className}
            </h2>
            <p className="text-muted-foreground text-xs">
              이 반 수강만 끝냅니다 — 퇴원도, 반 폐지도 아닙니다.
              {currentEndDate ? (
                <>
                  {" "}
                  현재 종료일 <span className="num">{currentEndDate}</span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="mb-4 space-y-3">
          <ReasonFields
            reasonLabel="종료 사유"
            initialReason={null}
            memoPlaceholder="배경 정보 (선택)"
            labelClassName="text-foreground block text-sm font-medium"
            controlClassName="border-border bg-card text-foreground w-full rounded-lg border px-3 py-2 text-sm"
            idPrefix={`end-${enrollmentId}`}
          />
        </form>

        <p className="text-foreground mb-2 text-sm font-medium">언제까지 수업하나요?</p>
        <div className="space-y-2">
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={working || gate.checking || !!c.disabledReason}
              onClick={() => submit(c)}
              title={c.disabledReason}
              className="border-line enabled:hover:border-primary/50 enabled:hover:bg-bg-soft focus-visible:ring-primary/50 block w-full rounded-xl border px-4 py-3 text-left transition focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-foreground block text-sm font-bold">{c.label}</span>
              <span className="text-text-dim mt-0.5 block text-xs">{c.disabledReason ?? c.effect}</span>
            </button>
          ))}
        </div>

        {error ? <p className="text-danger mt-3 text-xs">{error}</p> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          {working ? <Loader2 className="text-text-faint size-4 animate-spin" /> : null}
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="text-text-dim hover:text-foreground px-3 py-1.5 text-sm disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
