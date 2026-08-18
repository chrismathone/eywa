"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  deleteCalendarEvent,
  saveCalendarEvent,
  type CalendarActionState,
} from "@/features/calendar/server/actions";
import {
  EVENT_COLORS,
  EVENT_COLOR_LABEL,
  eventTimeLabel,
  type CalendarEvent,
  type EventColor,
} from "@/features/calendar/types";

/**
 * 일정 다이얼로그 — 등록·수정 겸용 + 읽기 전용(권한 없는 열람자). fixed 오버레이(ConfirmDialog 선례)라
 * 어디서 열어도 잘리지 않는다. 저장 성공 시 서버 revalidate가 그리드를 갱신하므로 닫기만 한다.
 */

export type DialogState =
  | { mode: "create"; date: string }
  | { mode: "edit"; event: CalendarEvent }
  | { mode: "view"; event: CalendarEvent }
  | null;

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition";

/** 색 점 — Tailwind 동적 클래스 금지(정적 Record). */
const DOT_SOLID: Record<EventColor, string> = {
  primary: "bg-primary",
  blue: "bg-blue",
  green: "bg-green",
  amber: "bg-amber",
  purple: "bg-purple",
  rose: "bg-rose",
  neutral: "bg-text-faint",
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      저장
    </Button>
  );
}

export function EventDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  if (!state) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-background border-line max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl border p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === "create" ? "일정 등록" : state.mode === "edit" ? "일정 수정" : "일정"}
        onClick={(e) => e.stopPropagation()}
      >
        {state.mode === "view" ? (
          <ViewBody event={state.event} onClose={onClose} />
        ) : (
          <EditBody state={state} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

/** 읽기 전용 — 강사·상담 등 readonly 열람자. 필드 대신 내용을 그대로 보여준다. */
function ViewBody({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const time = eventTimeLabel(event);
  return (
    <div className="space-y-3">
      <h2 className="text-foreground text-sm font-bold break-keep">{event.title}</h2>
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex gap-2">
          <dt className="text-text-dim w-[52px] shrink-0">기간</dt>
          <dd className="num text-foreground">
            {event.startDate}
            {event.endDate !== event.startDate ? ` ~ ${event.endDate}` : ""}
          </dd>
        </div>
        {time ? (
          <div className="flex gap-2">
            <dt className="text-text-dim w-[52px] shrink-0">시간</dt>
            <dd className="num text-foreground">{time}</dd>
          </div>
        ) : null}
        {event.memo ? (
          <div className="flex gap-2">
            <dt className="text-text-dim w-[52px] shrink-0">메모</dt>
            <dd className="text-foreground break-keep whitespace-pre-wrap">{event.memo}</dd>
          </div>
        ) : null}
        {event.createdByName ? (
          <div className="flex gap-2">
            <dt className="text-text-dim w-[52px] shrink-0">작성</dt>
            <dd className="text-foreground">{event.createdByName}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>
    </div>
  );
}

function EditBody({
  state,
  onClose,
}: {
  state: { mode: "create"; date: string } | { mode: "edit"; event: CalendarEvent };
  onClose: () => void;
}) {
  const editing = state.mode === "edit" ? state.event : null;
  const [saveState, saveAction] = useActionState<CalendarActionState, FormData>(
    saveCalendarEvent,
    undefined,
  );
  const seen = useRef<CalendarActionState>(undefined);
  useEffect(() => {
    if (!saveState || saveState === seen.current) return;
    seen.current = saveState;
    if (saveState.error) toast.error(saveState.error);
    else if (saveState.ok) {
      toast.success(saveState.notice ?? "저장했습니다");
      onClose(); // 그리드는 서버 revalidate가 갱신한다
    }
  }, [saveState, onClose]);

  const [color, setColor] = useState<EventColor>(editing?.color ?? "primary");
  const [start, setStart] = useState(editing?.startDate ?? (state.mode === "create" ? state.date : ""));
  const [end, setEnd] = useState(editing?.endDate ?? (state.mode === "create" ? state.date : ""));

  // 삭제 — 확인 다이얼로그를 거친다(비가역).
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  function doDelete() {
    if (!editing) return;
    const fd = new FormData();
    fd.append("id", editing.id);
    startDelete(async () => {
      const res = await deleteCalendarEvent(undefined, fd);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) {
        toast.success(res.notice ?? "삭제했습니다");
        onClose();
      }
    });
  }

  return (
    <form action={saveAction} className="space-y-3">
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
      <input type="hidden" name="color" value={color} />

      <h2 className="text-foreground text-sm font-bold">
        {editing ? "일정 수정" : "일정 등록"}
      </h2>

      <label className="block">
        <span className="micro mb-1 block">제목</span>
        <input
          name="title"
          defaultValue={editing?.title ?? ""}
          maxLength={120}
          placeholder="예: 여름특강 개강"
          className={inputClass}
          autoFocus
          required
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="micro mb-1 block">시작일</span>
          <input
            type="date"
            name="startDate"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value > end) setEnd(e.target.value);
            }}
            className={inputClass}
            required
          />
        </label>
        <label className="block">
          <span className="micro mb-1 block">종료일</span>
          <input
            type="date"
            name="endDate"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            className={inputClass}
            required
          />
        </label>
        <label className="block">
          <span className="micro mb-1 block">시작 시간 (선택)</span>
          <input type="time" name="startTime" defaultValue={editing?.startTime ?? ""} className={inputClass} />
        </label>
        <label className="block">
          <span className="micro mb-1 block">종료 시간 (선택)</span>
          <input type="time" name="endTime" defaultValue={editing?.endTime ?? ""} className={inputClass} />
        </label>
      </div>
      <p className="text-text-faint -mt-1 text-[11px]">종일 일정이면 시간을 비워 두세요.</p>

      <div>
        <span className="micro mb-1 block">색</span>
        <div className="flex items-center gap-1.5">
          {EVENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              title={EVENT_COLOR_LABEL[c]}
              aria-label={`색 ${EVENT_COLOR_LABEL[c]}`}
              className={`size-6 rounded-full transition ${DOT_SOLID[c]} ${
                color === c ? "ring-primary/60 ring-2 ring-offset-2" : "opacity-60 hover:opacity-100"
              }`}
            />
          ))}
        </div>
      </div>

      <label className="block">
        <span className="micro mb-1 block">메모 (선택)</span>
        <textarea
          name="memo"
          defaultValue={editing?.memo ?? ""}
          rows={3}
          maxLength={2000}
          placeholder="상세 내용"
          className={`${inputClass} resize-y`}
        />
      </label>

      <div className="flex items-center justify-between gap-2 pt-1">
        {editing ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={() => setConfirmDelete(true)}
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            삭제
          </Button>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <SaveButton />
        </span>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="일정 삭제"
        message={editing ? `'${editing.title}' 일정을 삭제합니다. 되돌릴 수 없습니다.` : ""}
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          doDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
