"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pencil, Plus, Trash2 } from "@/components/icons/aywa-icon-compat";
import {
  createClassroom,
  updateClassroom,
  deleteClassroom,
  setClassroomArchived,
  type ClassroomActionState,
} from "@/features/owner/server/classroom-actions";
import type { ClassroomRow } from "@/features/owner/server/classroom-queries";
import { SettingsCard } from "./section-form";
import { ExcelMenu } from "@/components/excel-import/excel-menu";

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
        <span className="text-text-dim text-xs">강의실 이름</span>
        <input name="name" required placeholder="예: 304호" className={`${INPUT} w-40`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-dim text-xs">정원 (선택)</span>
        <input name="capacity" type="number" min={0} max={9999} placeholder="8" className={`${INPUT} w-24`} />
      </label>
      <button
        type="submit"
        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
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

function RoomRow({ room, readOnly }: { room: ClassroomRow; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [upState, upAction] = useActionState<ClassroomActionState, FormData>(async (p, fd) => {
    const r = await updateClassroom(p, fd);
    if (r?.ok) setEditing(false);
    return r;
  }, undefined);
  const [delState, delAction] = useActionState<ClassroomActionState, FormData>(deleteClassroom, undefined);
  const [arcState, arcAction] = useActionState<ClassroomActionState, FormData>(setClassroomArchived, undefined);
  // 참조가 하나라도 있으면 **하드 삭제 금지**(지우면 그 반·슬롯이 미지정이 된다) → 숨기기만 제공.
  const inUse = room.classCount > 0 || room.staleDefaultCount > 0 || room.slotCount > 0;
  const archived = room.archivedAt != null;

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
            className="bg-primary text-primary-foreground inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-bold"
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
        <span className={`truncate text-sm font-bold ${archived ? "text-text-faint" : "text-foreground"}`}>
          {room.name}
        </span>
        {archived ? (
          <span className="bg-bg-soft text-text-faint rounded-full px-2 py-0.5 text-xs">숨김</span>
        ) : null}
        {room.capacity != null ? <span className="text-text-faint text-xs">정원 {room.capacity}</span> : null}
        {/* 🔴 "이 방에서 실제로 수업하는 반"과 "기본값만 이 방인 반"은 **다른 사실**이라 따로 보여준다.
            예전엔 기본값만 세서, 시간표가 다른 방으로 옮겨간 반까지 "2개 반 사용"으로 표시됐다(원장 제보). */}
        {room.classCount > 0 ? (
          <span className="bg-bg-soft text-text-dim rounded-full px-2 py-0.5 text-xs">
            수업 중 {room.classCount}개 반
          </span>
        ) : null}
        {room.slotCount > 0 ? (
          <span className="bg-bg-soft text-text-faint rounded-full px-2 py-0.5 text-xs">주 {room.slotCount}칸</span>
        ) : null}
        {room.staleDefaultCount > 0 ? (
          <span
            className="border-line text-text-faint rounded-full border px-2 py-0.5 text-xs"
            title="반 정보에는 이 강의실이 기본값으로 적혀 있지만, 실제 시간표는 다른 강의실에서 돌거나 배치가 없습니다"
          >
            기본값만 {room.staleDefaultCount}개 반
          </span>
        ) : null}
      </div>
      {readOnly ? null : (
      <div className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="수정"
          className="text-text-dim hover:text-foreground inline-flex items-center transition"
        >
          <Pencil className="size-3.5" />
        </button>
        {/* 숨김 ↔ 복원. 되돌릴 수 있는 조작이라 확인 단계 없이 바로 실행한다. */}
        <form action={arcAction} className="flex items-center">
          <input type="hidden" name="id" value={room.id} />
          <input type="hidden" name="archive" value={archived ? "0" : "1"} />
          <button
            type="submit"
            title={
              archived
                ? "다시 선택지에 노출합니다"
                : "목록·선택지에서만 빼고, 이미 배정된 반·시간표는 그대로 둡니다"
            }
            className="text-text-dim hover:text-foreground text-xs font-bold transition"
          >
            <SubmitInner>{archived ? "복원" : "숨기기"}</SubmitInner>
          </button>
        </form>
        {/* 🔴 참조가 있으면 삭제 버튼 자체를 안 준다 — 지우면 그 반·슬롯이 미지정이 되고 되돌릴 수 없다
            (원장 2026-08-05: "삭제하더라도 미지정으로 바뀌지않고 그대로 남겨져있어야해"). 서버도 같은
            판정으로 거절한다(#77 — 화면에서만 잠그면 우회된다). 잘못 만든 빈 방만 삭제 가능. */}
        {inUse ? null : confirm ? (
          <form action={delAction} className="flex items-center gap-1">
            <input type="hidden" name="id" value={room.id} />
            <button type="submit" className="text-danger text-xs font-bold">
              삭제
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="text-text-faint text-xs">
              취소
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            aria-label="삭제"
            title="이 강의실을 쓰는 반·시간표가 없어 완전히 지울 수 있습니다"
            className="text-text-dim hover:text-danger inline-flex items-center transition"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      )}
      {delState?.error ? <span className="text-danger w-full text-xs">{delState.error}</span> : null}
      {arcState?.error ? <span className="text-danger w-full text-xs">{arcState.error}</span> : null}
    </li>
  );
}

/**
 * `readOnly` = 운영 설정 읽기 권한 — 추가 양식·행의 수정·숨기기·삭제를 **그리지 않는다**(원장 2026-11-05 — 비활성으로 남기면
 * 쓸 수 있는 것처럼 읽힌다). 판정은 강의실 액션과 같은 `canWriteTenant(operations_settings)`(page.tsx → 운영 섹션).
 */
export function ClassroomManager({ rooms, canImport = false, readOnly = false }: { rooms: ClassroomRow[]; canImport?: boolean; readOnly?: boolean }) {
  const live = rooms.filter((r) => r.archivedAt == null);
  const archived = rooms.filter((r) => r.archivedAt != null);
  return (
    <SettingsCard
      title="강의실"
      description="강의실명·정원을 등록·수정합니다(추가·수정·숨김은 즉시 반영 — 운영 설정 '저장' 버튼과 별개). 반/시간표의 강의실 선택지로 쓰입니다. 안 쓰는 강의실은 '숨기기'로 목록에서만 빼세요 — 이미 배정된 반·시간표는 그대로 남습니다. 삭제는 쓰는 곳이 하나도 없는 강의실만 가능합니다."
      span2
      collapsible
      summary={`${live.length}개`}
    >
      {readOnly ? null : (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <AddForm />
          {/* 엑셀 가져오기(강의실) — 이 카드엔 검색이 없어 추가 줄 오른쪽 끝(원장 2026-09-29 통일 — 이름은 ExcelMenu 한 곳). */}
          {canImport ? <ExcelMenu importKind="classrooms" /> : null}
        </div>
      )}
      <ul className="divide-line mt-4 divide-y border-t pt-2">
        {live.length === 0 ? (
          <li className="text-text-faint py-3 text-center text-sm">아직 등록된 강의실이 없습니다</li>
        ) : (
          live.map((r) => <RoomRow key={r.id} room={r} readOnly={readOnly} />)
        )}
      </ul>
      {/* 숨긴 강의실 — 접어 둔다. 배정이 남아 있으면 시간표엔 계속 보이므로 여기서 복원할 수 있어야 한다. */}
      {archived.length > 0 ? (
        <details className="mt-3">
          <summary className="text-text-faint cursor-pointer text-xs">
            숨긴 강의실 {archived.length}개
          </summary>
          <ul className="divide-line mt-1 divide-y">
            {archived.map((r) => (
              <RoomRow key={r.id} room={r} readOnly={readOnly} />
            ))}
          </ul>
        </details>
      ) : null}
    </SettingsCard>
  );
}
