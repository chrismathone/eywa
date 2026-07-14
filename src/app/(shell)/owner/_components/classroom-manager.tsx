"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createClassroom,
  updateClassroom,
  deleteClassroom,
  type ClassroomActionState,
} from "@/features/owner/server/classroom-actions";
import type { ClassroomRow } from "@/features/owner/server/classroom-queries";
import { SettingsCard } from "./section-form";

const INPUT = "border-border bg-card text-foreground rounded-md border px-2.5 py-1.5 text-sm";

function SubmitInner({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <>{pending ? <Loader2 className="size-4 animate-spin" /> : children}</>;
}

function AddForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<ClassroomActionState, FormData>(async (p, fd) => {
    const r = await createClassroom(p, fd);
    if (r?.ok) formRef.current?.reset();
    return r;
  }, undefined);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-text-dim text-[11px]">강의실 이름</span>
        <input name="name" required placeholder="예: 본원 304" className={`${INPUT} w-40`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-dim text-[11px]">정원 (선택)</span>
        <input name="capacity" type="number" min={0} max={9999} placeholder="8" className={`${INPUT} w-24`} />
      </label>
      <button
        type="submit"
        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold"
      >
        <SubmitInner>
          <Plus className="size-4" />
        </SubmitInner>
        추가
      </button>
      {state?.error ? <span className="text-danger w-full text-xs">{state.error}</span> : null}
    </form>
  );
}

function RoomRow({ room }: { room: ClassroomRow }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [upState, upAction] = useActionState<ClassroomActionState, FormData>(async (p, fd) => {
    const r = await updateClassroom(p, fd);
    if (r?.ok) setEditing(false);
    return r;
  }, undefined);
  const [delState, delAction] = useActionState<ClassroomActionState, FormData>(deleteClassroom, undefined);

  if (editing) {
    return (
      <li className="py-2">
        <form action={upAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={room.id} />
          <input name="name" required defaultValue={room.name} className={`${INPUT} w-40`} />
          <input
            name="capacity"
            type="number"
            min={0}
            max={9999}
            defaultValue={room.capacity ?? ""}
            placeholder="정원"
            className={`${INPUT} w-24`}
          />
          <button
            type="submit"
            className="bg-primary text-primary-foreground inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-semibold"
          >
            <SubmitInner>저장</SubmitInner>
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-text-dim text-xs">
            취소
          </button>
          {upState?.error ? <span className="text-danger w-full text-xs">{upState.error}</span> : null}
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-foreground truncate text-[13px] font-semibold">{room.name}</span>
        {room.capacity != null ? <span className="text-text-faint text-[11px]">정원 {room.capacity}</span> : null}
        {room.classCount > 0 ? (
          <span className="bg-bg-soft text-text-dim rounded-full px-2 py-0.5 text-[11px]">{room.classCount}개 반</span>
        ) : null}
        {room.slotCount > 0 ? (
          <span className="bg-bg-soft text-text-faint rounded-full px-2 py-0.5 text-[11px]">슬롯 {room.slotCount}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="수정"
          className="text-text-dim hover:text-foreground inline-flex items-center transition"
        >
          <Pencil className="size-3.5" />
        </button>
        {confirm ? (
          <form action={delAction} className="flex items-center gap-1">
            <input type="hidden" name="id" value={room.id} />
            <button type="submit" className="text-danger text-[11px] font-semibold">
              삭제
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="text-text-faint text-[11px]">
              취소
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            aria-label="삭제"
            className="text-text-dim hover:text-danger inline-flex items-center transition"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {confirm && (room.classCount > 0 || room.slotCount > 0) ? (
        <p className="text-amber w-full text-[11px]">
          ⚠️{" "}
          {[
            room.classCount > 0 ? `반 ${room.classCount}개` : null,
            room.slotCount > 0 ? `시간표 슬롯 ${room.slotCount}개` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          의 강의실이 미지정으로 바뀝니다.
        </p>
      ) : null}
      {delState?.error ? <span className="text-danger w-full text-xs">{delState.error}</span> : null}
    </li>
  );
}

export function ClassroomManager({ rooms }: { rooms: ClassroomRow[] }) {
  return (
    <SettingsCard
      title="강의실"
      description="강의실명·정원을 등록·수정합니다(추가·수정·삭제는 즉시 반영 — 운영 설정 '저장' 버튼과 별개). 반/시간표의 강의실 선택지로 쓰이며, 삭제해도 반 데이터는 유지되고 해당 반의 강의실만 미지정으로 바뀝니다."
      span2
    >
      <AddForm />
      <ul className="divide-line mt-4 divide-y border-t pt-2">
        {rooms.length === 0 ? (
          <li className="text-text-faint py-3 text-center text-sm">아직 등록된 강의실이 없습니다</li>
        ) : (
          rooms.map((r) => <RoomRow key={r.id} room={r} />)
        )}
      </ul>
    </SettingsCard>
  );
}
