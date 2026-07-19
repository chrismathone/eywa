"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { conflictToast } from "@/lib/ui/conflict-toast";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  DoorOpen,
  Loader2,
  Sparkles,
  X,
} from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  applyClassroomAssignments,
  loadClassroomAssignmentData,
  type ApplyAssignState,
} from "@/features/classes/server/actions";
import {
  autoAssignClassrooms,
  assignSummary,
  DEFAULT_ASSIGN_OPTIONS,
  type AssignOptions,
  type ClassroomAssignData,
} from "@/features/classes/lib/classroom-assign";

function ApplyBtn({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || count === 0}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      {count > 0 ? `${count}건 적용` : "변경 없음"}
    </Button>
  );
}

function AssignDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<ClassroomAssignData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [opts, setOpts] = useState<AssignOptions>(DEFAULT_ASSIGN_OPTIONS);
  const [state, formAction] = useActionState<ApplyAssignState, FormData>(
    applyClassroomAssignments,
    undefined,
  );

  // 미리보기 데이터는 열 때만 지연 로드(페이지 로드 비용 0).
  useEffect(() => {
    let alive = true;
    loadClassroomAssignmentData().then((res) => {
      if (!alive) return;
      if (res.error) setLoadErr(res.error);
      else setData(res.data ?? { classes: [], rooms: [] });
    });
    return () => {
      alive = false;
    };
  }, []);

  // 적용 성공 → 배경 새로고침 + 닫기.
  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);

  // 적용 실패 경고 — 하단 작은 텍스트를 놓치지 않게 가운데(top-center) 토스트 병행(제출 결과 바뀔 때만).
  const notifiedError = useRef<ApplyAssignState>(undefined);
  useEffect(() => {
    if (state === notifiedError.current) return;
    notifiedError.current = state;
    if (state?.error) conflictToast(state.error);
  }, [state]);

  const result = useMemo(
    () => (data ? autoAssignClassrooms(data.classes, data.rooms, opts) : null),
    [data, opts],
  );
  const summary = result ? assignSummary(result) : null;
  const changed = result ? result.assignments.filter((a) => a.changed) : [];
  const payload = JSON.stringify(changed.map((a) => ({ classId: a.classId, roomId: a.toRoomId })));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border shadow-lg">
        <header className="border-border flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-foreground inline-flex items-center gap-1.5 text-lg font-bold">
              <Sparkles className="text-gold size-4" />
              강의실 자동배정
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              시간 충돌을 피하고 정원에 맞춰 활성 반에 강의실을 제안합니다. 미리보기 후 적용하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* 옵션 */}
        <div className="border-border flex flex-wrap items-center gap-4 border-b px-6 py-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={opts.respectCapacity}
              onChange={(e) => setOpts((o) => ({ ...o, respectCapacity: e.target.checked }))}
            />
            <span className="text-foreground">수용 인원 준수</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={opts.keepExisting}
              onChange={(e) => setOpts((o) => ({ ...o, keepExisting: e.target.checked }))}
            />
            <span className="text-foreground">기존 배정 유지 우선</span>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loadErr ? (
            <p className="text-danger inline-flex items-center gap-1.5 text-sm">
              <AlertTriangle className="size-4" />
              {loadErr}
            </p>
          ) : !result || !summary ? (
            <p className="text-muted-foreground inline-flex items-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" />
              배정 데이터를 불러오는 중…
            </p>
          ) : (
            <div className="space-y-4">
              {/* 요약 */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <SummaryCell label="변경 제안" value={summary.changed} tone="primary" />
                <SummaryCell label="미배정" value={summary.unassigned} tone="rose" />
                <SummaryCell label="기존 충돌" value={summary.conflictsResolved} tone="amber" />
              </div>

              {data && data.rooms.length === 0 ? (
                <p className="text-muted-foreground border-border rounded-md border border-dashed px-4 py-6 text-center text-sm">
                  등록된 강의실이 없습니다. 반 수정에서 강의실을 먼저 추가하세요.
                </p>
              ) : null}

              {/* 기존 충돌 안내 */}
              {result.conflictsBefore.length > 0 ? (
                <div className="border-amber/30 bg-amber/5 rounded-md border px-4 py-3 text-xs">
                  <p className="text-amber inline-flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="size-3.5" />
                    현재 같은 강의실에 시간이 겹치는 반 {result.conflictsBefore.length}건
                  </p>
                  <ul className="text-text-dim mt-1.5 space-y-0.5">
                    {result.conflictsBefore.slice(0, 5).map((c, i) => (
                      <li key={i}>
                        {c.roomName} · {c.day}요일 — {c.classNames[0]} / {c.classNames[1]}
                      </li>
                    ))}
                    {result.conflictsBefore.length > 5 ? (
                      <li className="text-text-faint">외 {result.conflictsBefore.length - 5}건</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {/* 변경 제안 목록 */}
              <div>
                <p className="eyebrow mb-2">변경 제안</p>
                {changed.length === 0 ? (
                  <p className="text-muted-foreground border-border rounded-md border border-dashed px-4 py-5 text-center text-sm">
                    모든 활성 반이 이미 최적 배정 상태입니다.
                  </p>
                ) : (
                  <ul className="border-border divide-border divide-y rounded-md border">
                    {changed.map((a) => (
                      <li
                        key={a.classId}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                          {a.className}
                          <span className="text-text-faint ml-1.5 text-xs">{a.studentCount}명</span>
                        </span>
                        <span className="text-text-dim inline-flex shrink-0 items-center gap-1.5 text-xs">
                          <span className="text-text-faint">{a.fromRoomName ?? "미정"}</span>
                          <ArrowRight className="text-text-faint size-3" />
                          <span className="text-primary inline-flex items-center gap-1 font-bold">
                            <DoorOpen className="size-3" />
                            {a.toRoomName}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 미배정 */}
              {result.unassigned.length > 0 ? (
                <div>
                  <p className="eyebrow text-rose mb-2">미배정 {result.unassigned.length}건</p>
                  <ul className="border-rose/30 divide-rose/15 divide-y rounded-md border">
                    {result.unassigned.map((u) => (
                      <li
                        key={u.classId}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <span className="text-foreground min-w-0 flex-1 truncate">
                          {u.className}
                          <span className="text-text-faint ml-1.5 text-xs">{u.studentCount}명</span>
                        </span>
                        <span className="text-rose shrink-0 text-xs">{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 적용 */}
        <form
          action={formAction}
          className="border-border flex items-center justify-between gap-2 border-t px-6 py-3"
        >
          <input type="hidden" name="assignments" value={payload} />
          <span className="text-danger text-xs">{state?.error ?? ""}</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              취소
            </Button>
            <ApplyBtn count={changed.length} />
          </div>
        </form>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "rose" | "amber";
}) {
  const color =
    tone === "primary" ? "text-primary" : tone === "rose" ? "text-rose" : "text-amber";
  return (
    <div className="border-border bg-muted/30 rounded-md border px-3 py-2">
      <p className={`num text-xl font-bold ${color}`}>{value}</p>
      <p className="text-text-dim text-[11px]">{label}</p>
    </div>
  );
}

/** 수업목록 헤더의 "강의실 자동배정" 트리거. */
export function ClassroomAssignButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" />
        강의실 자동배정
      </Button>
      {open ? <AssignDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
