"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Megaphone, Pencil, Pin, PinOff, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPin,
  updateAnnouncement,
  type AnnouncementActionState,
} from "@/features/dashboard/server/actions";
import type { ManageAnnouncementRow } from "@/features/dashboard/server/queries";

const INPUT =
  "border-border bg-card text-foreground w-full rounded-md border px-2.5 py-1.5 text-sm";

const AUDIENCE_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "staff", label: "교직원" },
  { value: "teachers", label: "강사" },
  { value: "counselors", label: "상담사" },
  { value: "accounting", label: "회계" },
];
const AUDIENCE_LABEL: Record<string, string> = Object.fromEntries(
  AUDIENCE_OPTIONS.map((o) => [o.value, o.label]),
);

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}

function PinForm({ id, pinned }: { id: string; pinned: boolean }) {
  const [, action] = useActionState(toggleAnnouncementPin, undefined);
  const { pending } = useFormStatus();
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="pinned" value={pinned ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        aria-label={pinned ? "고정 해제" : "상단 고정"}
        className="text-text-dim hover:text-foreground inline-flex items-center transition"
      >
        {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </button>
    </form>
  );
}

function DeleteForm({ id }: { id: string }) {
  const [, action] = useActionState(deleteAnnouncement, undefined);
  const { pending } = useFormStatus();
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label="삭제"
        className="text-text-dim hover:text-chart-4 inline-flex items-center transition"
      >
        <Trash2 className="size-3.5" />
      </button>
    </form>
  );
}

function Manager({ items, onClose }: { items: ManageAnnouncementRow[]; onClose: () => void }) {
  const [editing, setEditing] = useState<ManageAnnouncementRow | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // 성공 후 정리(폼 reset + 편집모드 해제)는 액션 콜백 안에서 — effect 내 setState 금지(#25).
  const [state, action] = useActionState<AnnouncementActionState, FormData>(
    async (prev, formData) => {
      const run = editing ? updateAnnouncement : createAnnouncement;
      const res = await run(prev, formData);
      if (res?.ok) {
        formRef.current?.reset();
        setEditing(null);
      }
      return res;
    },
    undefined,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="bg-background border-border flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-foreground text-base font-semibold">공지 관리</h2>
            <p className="text-text-dim mt-0.5 text-xs">작성·수정·고정·삭제. 대시보드 카드에 즉시 반영됩니다.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-text-dim hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>

        {/* 작성 / 수정 폼 */}
        <form ref={formRef} action={action} className="space-y-2">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input
            name="title"
            required
            defaultValue={editing?.title ?? ""}
            placeholder="제목"
            className={INPUT}
          />
          <textarea
            name="content"
            required
            rows={3}
            defaultValue={editing?.content ?? ""}
            placeholder="내용을 입력하세요..."
            className={INPUT}
          />
          <div className="flex items-center gap-2">
            <select name="audience" defaultValue={editing?.audience ?? "all"} className={INPUT + " flex-1"}>
              {AUDIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="text-text-dim flex shrink-0 items-center gap-1.5 text-xs">
              <input type="checkbox" name="pinned" defaultChecked={editing?.pinned ?? false} />
              상단 고정
            </label>
          </div>
          {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            {editing ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                취소
              </Button>
            ) : null}
            <SubmitBtn label={editing ? "수정" : "공지 작성"} />
          </div>
        </form>

        {/* 기존 공지 목록 */}
        <div className="border-border mt-4 flex min-h-0 flex-1 flex-col border-t pt-3">
          <p className="micro mb-2">등록된 공지 ({items.length})</p>
          {items.length === 0 ? (
            <p className="text-text-faint py-4 text-center text-xs">아직 공지가 없습니다</p>
          ) : (
            <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
              {items.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {a.pinned ? <Pin className="text-gold size-3 shrink-0" /> : null}
                      <span className="text-foreground truncate text-[13px] font-medium">{a.title}</span>
                    </div>
                    <p className="text-text-faint text-[11px]">{AUDIENCE_LABEL[a.audience] ?? a.audience}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
                    <PinForm id={a.id} pinned={a.pinned} />
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      aria-label="수정"
                      className="text-text-dim hover:text-foreground inline-flex items-center transition"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <DeleteForm id={a.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function AnnouncementsManager({ items }: { items: ManageAnnouncementRow[] }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-text-faint hover:text-foreground inline-flex shrink-0 items-center gap-1 text-[11px]"
      >
        <Megaphone className="size-3" />
        관리
      </button>
      {open ? <Manager items={items} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
