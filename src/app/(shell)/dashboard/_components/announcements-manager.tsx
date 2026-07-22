"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Megaphone, Pencil, Pin, PinOff, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPin,
  updateAnnouncement,
  type AnnouncementActionState,
} from "@/features/dashboard/server/actions";
import type { ManageAnnouncementRow } from "@/features/dashboard/server/queries";
import {
  AUDIENCE_LABEL,
  NOTICE_AUDIENCES,
  type NoticeAudience,
} from "@/features/notices/audience";

const INPUT =
  "border-border bg-card text-foreground w-full rounded-md border px-2.5 py-1.5 text-sm";

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}

function PinButton({ pinned, title }: { pinned: boolean; title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`“${title}” 공지 ${pinned ? "고정 해제" : "상단 고정"}`}
      className="text-text-dim hover:text-foreground inline-flex size-8 items-center justify-center rounded-md transition disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : pinned ? (
        <PinOff className="size-3.5" />
      ) : (
        <Pin className="size-3.5" />
      )}
    </button>
  );
}

function PinForm({ id, pinned, title }: { id: string; pinned: boolean; title: string }) {
  const [state, action] = useActionState(toggleAnnouncementPin, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="pinned" value={pinned ? "false" : "true"} />
      <PinButton pinned={pinned} title={title} />
      {state?.error ? <span className="sr-only" role="alert">{state.error}</span> : null}
    </form>
  );
}

function DeleteButton({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`“${title}” 공지 삭제`}
      className="text-text-dim hover:text-chart-4 inline-flex size-8 items-center justify-center rounded-md transition disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}

function DeleteForm({ id, title }: { id: string; title: string }) {
  const [state, action] = useActionState(deleteAnnouncement, undefined);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`“${title}” 공지를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <DeleteButton title={title} />
      {state?.error ? <span className="sr-only" role="alert">{state.error}</span> : null}
    </form>
  );
}

function AnnouncementForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: ManageAnnouncementRow | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<AnnouncementActionState, FormData>(
    async (prev, formData) => {
      const run = editing ? updateAnnouncement : createAnnouncement;
      const res = await run(prev, formData);
      if (res?.ok) {
        formRef.current?.reset();
        onSaved();
      }
      return res;
    },
    undefined,
  );

  return (
    <form ref={formRef} action={action} className="space-y-2 px-5 pb-4">
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
      <label htmlFor="announcement-title" className="sr-only">공지 제목</label>
      <input
      id="announcement-title"
        name="title"
      required
      autoFocus={editing !== null}
        defaultValue={editing?.title ?? ""}
        placeholder="제목"
        className={INPUT}
      />
      <label htmlFor="announcement-content" className="sr-only">공지 내용</label>
      <textarea
        id="announcement-content"
        name="content"
        required
        rows={3}
        defaultValue={editing?.content ?? ""}
        placeholder="내용을 입력하세요..."
        className={INPUT}
      />
      <div className="flex items-center gap-2">
        <label htmlFor="announcement-audience" className="sr-only">공지 대상</label>
        <select
          id="announcement-audience"
          name="audience"
          defaultValue={editing?.audience ?? "all"}
          className={INPUT + " flex-1"}
        >
          {NOTICE_AUDIENCES.map((audience) => (
            <option key={audience} value={audience}>
              {AUDIENCE_LABEL[audience]}
            </option>
          ))}
        </select>
        <label className="text-text-dim flex shrink-0 items-center gap-1.5 text-xs">
          <input type="checkbox" name="pinned" defaultChecked={editing?.pinned ?? false} />
          상단 고정
        </label>
      </div>
      <p aria-live="polite" className="text-chart-4 min-h-4 text-xs">
        {state?.error ?? ""}
      </p>
      <div className="flex items-center justify-end gap-2">
        {editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            취소
          </Button>
        ) : null}
        <SubmitBtn label={editing ? "수정" : "공지 작성"} />
      </div>
    </form>
  );
}

function Manager({ items, unavailable = false }: { items: ManageAnnouncementRow[]; unavailable?: boolean }) {
  const [editing, setEditing] = useState<ManageAnnouncementRow | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const finishEditing = () => {
    const trigger = editTriggerRef.current;
    setEditing(null);
    requestAnimationFrame(() => trigger?.focus());
  };

  return (
    <>
      {/* key로 작성/편집 폼을 분리해 defaultValue와 액션 상태가 다른 공지로 새지 않게 한다. */}
      <AnnouncementForm
        key={editing?.id ?? "create"}
        editing={editing}
        onCancel={finishEditing}
        onSaved={finishEditing}
      />

      {/* 기존 공지 목록 */}
      <div className="border-border flex min-h-0 flex-1 flex-col border-t px-5 pt-3 pb-4">
          <p className="micro mb-2 shrink-0">등록된 공지 {unavailable ? "" : `(${items.length})`}</p>
          {/* ⚠️ 조회 실패를 '아직 공지가 없습니다'로 위장하면 원장이 같은 공지를 다시 써서 중복 게시된다
              (관리 목록은 카드와 별개 쿼리라 카드만 정상일 수 있음, 2026-07-22 전수검사). */}
          {unavailable ? (
            <p className="text-text-faint py-4 text-center text-xs">
              공지 목록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
            </p>
          ) : items.length === 0 ? (
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
                    <p className="text-text-faint text-[11px]">
                      {AUDIENCE_LABEL[a.audience as NoticeAudience] ?? a.audience}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <PinForm id={a.id} pinned={a.pinned} title={a.title} />
                    <button
                      type="button"
                      onClick={(event) => {
                        editTriggerRef.current = event.currentTarget;
                        setEditing(a);
                      }}
                      aria-label={`“${a.title}” 공지 수정`}
                      className="text-text-dim hover:text-foreground inline-flex size-8 items-center justify-center rounded-md transition"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <DeleteForm id={a.id} title={a.title} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
    </>
  );
}

export function AnnouncementsManager({
  items,
  unavailable = false,
}: {
  items: ManageAnnouncementRow[];
  unavailable?: boolean;
}): ReactNode {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="text-text-dim hover:text-foreground inline-flex shrink-0 items-center gap-1 rounded-sm text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
        }
      >
        <Megaphone className="size-3" />
        관리
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="px-5 pt-5 pr-12 pb-3">
          <DialogTitle>공지 관리</DialogTitle>
          <DialogDescription className="text-xs">
            작성·수정·고정·삭제한 내용은 오늘 화면의 공지 카드에 즉시 반영됩니다.
          </DialogDescription>
        </DialogHeader>
        <DialogClose
          render={
            <button
              type="button"
              className="text-text-dim hover:text-foreground absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
          }
        >
          <X className="size-4" />
          <span className="sr-only">공지 관리 닫기</span>
        </DialogClose>
        <Manager items={items} unavailable={unavailable} />
      </DialogContent>
    </Dialog>
  );
}
