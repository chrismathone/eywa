"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { loadCalendarEvent } from "@/features/calendar/server/actions";
import type { CalendarTag } from "@/features/calendar/types";
import { EventDialog, type DialogState } from "./event-dialog";

/**
 * 목록·연간 보기에서 일정을 **눌러 여는** 자리(2026-09-23 전수 점검 N9) — 월 그리드와 같은 `EventDialog`를 쓴다.
 *
 * 🔑 두 보기는 서버 컴포넌트라 행마다 일정 전체(메모 ≤2,000자)를 클라로 실어 보내지 않는다 — 버튼은 id만 들고,
 *    누르는 순간 그 한 건만 서버에서 읽는다(`loadCalendarEvent`, 반응속도). 쓰기 권한이면 수정 모드, 아니면 읽기.
 * ⚠️ 저장·삭제 뒤 목록 갱신은 서버 revalidate(`/calendar`)가 한다 — 월 그리드와 같은 규약.
 */

type Ctx = { open: (id: string) => void; pendingId: string | null };
const EventOpenContext = createContext<Ctx | null>(null);

export function EventOpenHost({
  canWrite,
  today,
  tags,
  children,
}: {
  canWrite: boolean;
  today: string;
  tags: CalendarTag[];
  children: ReactNode;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function open(id: string) {
    if (pendingId) return;
    setPendingId(id);
    startTransition(async () => {
      try {
        const res = await loadCalendarEvent(id);
        if ("error" in res) toast.error(res.error);
        else setDialog(canWrite ? { mode: "edit", event: res.event } : { mode: "view", event: res.event });
      } catch {
        toast.error("일정을 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <EventOpenContext.Provider value={{ open, pendingId }}>
      {children}
      {dialog ? <EventDialog state={dialog} today={today} tags={tags} onClose={() => setDialog(null)} /> : null}
    </EventOpenContext.Provider>
  );
}

/** 일정 제목 버튼 — 호스트 밖이면(쓰는 곳이 없으면) 글자만 그린다. */
export function EventOpenButton({
  id,
  className,
  title,
  children,
}: {
  id: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const ctx = useContext(EventOpenContext);
  if (!ctx) return <span className={className} title={title}>{children}</span>;
  const busy = ctx.pendingId === id;
  return (
    <button
      type="button"
      onClick={() => ctx.open(id)}
      aria-busy={busy}
      title={title}
      className={`${className ?? ""} cursor-pointer text-left hover:underline ${busy ? "opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}
