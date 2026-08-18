"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { weekdayIndexOf } from "@/lib/date-kst";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
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
 * 일정 다이얼로그 — 등록·수정 겸용 + 읽기 전용(권한 없는 열람자). fixed 오버레이(ConfirmDialog 선례).
 *
 * 시간 선택 = **구글 캘린더식**(원장 2026-08-18): 15분 간격 드롭다운(00:00~23:45, "종일" 포함),
 * 시작을 고르면 종료가 자동으로 따라온다 — 종료가 비어 있으면 +1시간, 둘 다 있으면 **기존 간격 유지**.
 * 종료 목록은 시작 이후 시각만 + 소요시간 힌트("(1시간)"). 저장 성공 시 서버 revalidate가 그리드 갱신.
 *
 * ⚠️ 패널은 sm+에서 overflow를 풀어 둔다 — 시간 드롭다운 팝오버(absolute, ≈270px)가
 *    `overflow-y-auto` 패널에 잘리기 때문. 좁은 화면(시트 모드)만 스크롤을 남긴다.
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

// ── 15분 간격 시간표(구글 캘린더 관행) ────────────────────────────────────────
const TIME_SLOTS: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, "0");
  const m = String((i % 4) * 15).padStart(2, "0");
  return `${h}:${m}`;
});
const LAST_SLOT = "23:45";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHM = (min: number) => {
  const c = Math.min(Math.max(min, 0), toMin(LAST_SLOT));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};
/** 소요시간 한글 — "(30분)"·"(1시간)"·"(1시간 30분)". */
function durationLabel(min: number): string {
  if (min <= 0) return "";
  if (min < 60) return `${min}분`;
  return min % 60 === 0 ? `${min / 60}시간` : `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

/** 옛 데이터(15분 밖 시각, 예 "15:22")도 목록에 끼워 보존 — 없는 값이면 placeholder로 위장되는 것 방지. */
function withLegacy(slots: string[], current: string): string[] {
  if (!current || slots.includes(current)) return slots;
  return [...slots, current].sort();
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      저장
    </Button>
  );
}

export function EventDialog({
  state,
  today,
  onClose,
}: {
  state: DialogState;
  /** KST 오늘 — 읽기 전용 뷰의 D-day 계산(서버가 내려준 값·클라 시계 안 씀). */
  today: string;
  onClose: () => void;
}) {
  if (!state) return null;
  const isView = state.mode === "view";
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      {/* sm+는 overflow 해제(시간 팝오버 잘림 방지) — 내용이 컴팩트해 92vh를 넘지 않는다. */}
      <div
        className={`bg-background border-line w-full rounded-xl border p-5 shadow-lg ${
          isView ? "max-w-md" : "max-w-2xl"
        } max-h-[92vh] overflow-y-auto ${
          // overflow 해제는 편집 모드 전용(시간 팝오버 잘림 방지) — 읽기 모드는 긴 메모(≤2000자) 스크롤 유지.
          isView ? "" : "sm:max-h-none sm:overflow-visible"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === "create" ? "일정 등록" : state.mode === "edit" ? "일정 수정" : "일정"}
        onClick={(e) => e.stopPropagation()}
      >
        {state.mode === "view" ? (
          <ViewBody event={state.event} today={today} onClose={onClose} />
        ) : (
          <EditBody state={state} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

/** 읽기 전용 — readonly 열람자 + 휴가 오버레이. 필드 대신 내용을 그대로, 다만 조촐하지 않게. */

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-08-20 (목)" — 읽는 사람이 요일을 되짚지 않게. */
function dateWithDow(ymd: string): string {
  return `${ymd} (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

/** 시작·종료 포함 일수. */
function spanDaysOf(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** "HH:MM"×2 → "1시간 30분" — 같은 날 시간 일정만(위 durationLabel(min) 재사용). */
function timeSpanLabel(start: string, end: string): string | null {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const min = (eh! - sh!) * 60 + (em! - sm!);
  return min > 0 ? durationLabel(min) : null;
}

/** 오늘 기준 상태 배지 — D-N / 오늘 / 진행 중 / 지난 일정. */
function ddayBadge(event: CalendarEvent, today: string): { label: string; cls: string } {
  if (today < event.startDate) {
    const d = spanDaysOf(today, event.startDate) - 1;
    return { label: `D-${d}`, cls: "bg-primary-soft text-primary" };
  }
  if (today > event.endDate) return { label: "지난 일정", cls: "bg-bg-soft text-text-faint" };
  return {
    label: event.startDate === event.endDate ? "오늘" : "진행 중",
    cls: "bg-green-soft text-green",
  };
}

function ViewBody({
  event,
  today,
  onClose,
}: {
  event: CalendarEvent;
  today: string;
  onClose: () => void;
}) {
  const time = eventTimeLabel(event);
  const days = spanDaysOf(event.startDate, event.endDate);
  const dday = ddayBadge(event, today);
  const duration =
    event.startTime && event.endTime && event.startDate === event.endDate
      ? timeSpanLabel(event.startTime, event.endTime)
      : null;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-foreground flex min-w-0 items-center gap-2 text-[16px] font-bold break-keep">
          <span className={`size-3 shrink-0 rounded-full ${DOT_SOLID[event.color]}`} aria-hidden />
          {event.title}
        </h2>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${dday.cls}`}>
          {dday.label}
        </span>
      </div>

      {event.source === "leave" ? (
        <p className="bg-amber-soft text-amber rounded-lg px-3 py-2 text-[12px]">
          전자결재로 승인된 휴가입니다 — 캘린더에서 수정할 수 없고, 변경은 결재 문서에서 합니다.
        </p>
      ) : null}

      <dl className="space-y-1.5 text-[13px]">
        <div className="flex gap-2">
          <dt className="text-text-dim w-[52px] shrink-0">기간</dt>
          <dd className="num text-foreground">
            {dateWithDow(event.startDate)}
            {event.endDate !== event.startDate ? ` ~ ${dateWithDow(event.endDate)}` : ""}
            <span className="text-text-faint ml-1.5">· {days}일</span>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-dim w-[52px] shrink-0">시간</dt>
          <dd className="num text-foreground">
            {time ?? <span className="text-text-dim">종일</span>}
            {duration ? <span className="text-text-faint ml-1.5">({duration})</span> : null}
          </dd>
        </div>
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
  // 시간 — "" = 종일. 구글식 자동 보정의 근거라 제어 상태로 둔다.
  const [startTime, setStartTime] = useState(editing?.startTime ?? "");
  const [endTime, setEndTime] = useState(editing?.endTime ?? "");

  /** 시작 시간 선택 — 구글 동작: 종료가 비면 +1시간, 둘 다 있으면 기존 간격을 유지해 민다. */
  function pickStartTime(v: string) {
    if (v === "") {
      // 종일 — 시간을 통째로 비운다(종료만 남으면 서버가 거절하는 조합).
      setStartTime("");
      setEndTime("");
      return;
    }
    const prevDur =
      startTime && endTime && toMin(endTime) > toMin(startTime)
        ? toMin(endTime) - toMin(startTime)
        : 60;
    setStartTime(v);
    setEndTime(toHM(toMin(v) + prevDur));
  }

  const sameDay = start === end;
  const startOptions: ComboOption[] = useMemo(
    () => [
      { value: "", label: "종일" },
      ...withLegacy(TIME_SLOTS, startTime).map((t) => ({ value: t, label: t })),
    ],
    [startTime],
  );
  const endOptions: ComboOption[] = useMemo(() => {
    const base = withLegacy(TIME_SLOTS, endTime);
    // 같은 날이면 시작 이후만 + 소요시간 힌트(구글식). 여러 날이면 전체(종료일의 시각이므로).
    const list =
      sameDay && startTime
        ? base
            .filter((t) => toMin(t) > toMin(startTime))
            .map((t) => ({ value: t, label: t, hint: `(${durationLabel(toMin(t) - toMin(startTime))})` }))
        : base.map((t) => ({ value: t, label: t }));
    return [{ value: "", label: "미지정" }, ...list];
  }, [sameDay, startTime, endTime]);

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
    <form action={saveAction} className="space-y-4">
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
      <input type="hidden" name="color" value={color} />
      <input type="hidden" name="startTime" value={startTime} />
      <input type="hidden" name="endTime" value={endTime} />

      <h2 className="text-foreground text-sm font-bold">{editing ? "일정 수정" : "일정 등록"}</h2>

      {/* 제목 — 구글처럼 맨 위 한 줄 크게 */}
      <input
        name="title"
        defaultValue={editing?.title ?? ""}
        maxLength={120}
        placeholder="일정 제목"
        className={`${inputClass} px-3.5 py-2 text-base font-medium`}
        aria-label="일정 제목"
        autoFocus
        required
      />

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        {/* 왼쪽 — 언제 */}
        <div className="space-y-3">
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
            <div>
              <span className="micro mb-1 block">시작 시간</span>
              <SearchableSelect
                options={startOptions}
                value={startTime}
                onValueChange={pickStartTime}
                placeholder="종일"
                searchPlaceholder="예: 15"
                cap={100}
                ariaLabel="시작 시간"
              />
            </div>
            {startTime ? (
              <div>
                <span className="micro mb-1 block">종료 시간</span>
                <SearchableSelect
                  options={endOptions}
                  value={endTime}
                  onValueChange={setEndTime}
                  placeholder="미지정"
                  searchPlaceholder="예: 16"
                  cap={100}
                  ariaLabel="종료 시간"
                />
              </div>
            ) : (
              <div>
                <span className="micro mb-1 block">종료 시간</span>
                <p className="text-text-faint border-line rounded-lg border border-dashed px-3 py-1.5 text-sm">
                  종일
                </p>
              </div>
            )}
          </div>
          <p className="text-text-faint text-[11px]">
            시작 시간을 고르면 종료는 자동으로 따라옵니다(기본 1시간). 종일 일정은 시작 시간을
            &lsquo;종일&rsquo;로.
          </p>
        </div>

        {/* 오른쪽 — 어떻게 보일지 */}
        <div className="space-y-3">
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
              rows={4}
              maxLength={2000}
              placeholder="상세 내용"
              className={`${inputClass} resize-y`}
            />
          </label>
        </div>
      </div>

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
