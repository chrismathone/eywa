"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteCalendarTag, saveCalendarTag } from "@/features/calendar/server/actions";
import { chipProps } from "@/features/calendar/color";
import type { CalendarColor, CalendarTag } from "@/features/calendar/types";
import { ColorPicker } from "./color-picker";

/**
 * 태그 관리(0224a) — 태그 이름·색 편집과 추가·삭제. fixed 오버레이(EventDialog 패턴).
 * 색은 태그에 한 번만 저장되므로 여기서 바꾸면 그 태그가 달린 일정 전부가 따라온다.
 * 목록은 서버 props(page → calendar-client) — 저장 성공 시 router.refresh()로 재조회.
 */

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition";

/** 태그 미리보기 칩 — 저장하면 일정이 이렇게 보인다는 것을 그 자리에서 보여준다. */
function TagPreview({ name, color }: { name: string; color: CalendarColor }) {
  const chip = chipProps(color);
  return (
    <span
      className={`inline-block max-w-[160px] truncate rounded px-1.5 py-0.5 text-xs leading-tight font-medium ${chip.className}`}
      style={chip.style}
    >
      {name.trim() || "일정 제목"}
    </span>
  );
}

/** 기존 태그 한 줄 — 이름·색 편집 + 삭제. 저장은 값이 바뀌었을 때만 활성. */
function TagRow({ tag }: { tag: CalendarTag }) {
  const router = useRouter();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<CalendarColor>(tag.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const dirty = name.trim() !== tag.name || color !== tag.color;

  function save() {
    const fd = new FormData();
    fd.append("id", tag.id);
    fd.append("name", name.trim());
    fd.append("color", color);
    start(async () => {
      const res = await saveCalendarTag(undefined, fd);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) {
        toast.success(res.notice ?? "저장했습니다");
        router.refresh();
      }
    });
  }

  function remove() {
    const fd = new FormData();
    fd.append("id", tag.id);
    start(async () => {
      const res = await deleteCalendarTag(undefined, fd);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) {
        toast.success(res.notice ?? "삭제했습니다");
        router.refresh();
      }
    });
  }

  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          className={`${inputClass} min-w-0 flex-1`}
          aria-label="태그 이름"
        />
        <TagPreview name={name} color={color} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ColorPicker value={color} onChange={setColor} size="sm" label="태그 색" />
        <span className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !dirty || !name.trim()}
            onClick={save}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            저장
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-danger"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            삭제
          </Button>
        </span>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="태그 삭제"
        message={`'${tag.name}' 태그를 삭제합니다 — 일정은 남고 태그만 해제됩니다.`}
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}

/** 새 태그 행 — 추가 성공 시 입력을 비우고 refresh(새 행은 서버 목록으로 내려온다). */
function NewTagRow() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<CalendarColor>("primary");
  const [pending, start] = useTransition();

  function add() {
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("color", color);
    start(async () => {
      const res = await saveCalendarTag(undefined, fd);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) {
        toast.success(res.notice ?? "추가했습니다");
        setName("");
        setColor("primary");
        router.refresh();
      }
    });
  }

  return (
    <div className="border-line mt-3 space-y-2 rounded-lg border border-dashed px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          placeholder="새 태그 이름"
          className={`${inputClass} min-w-0 flex-1`}
          aria-label="새 태그 이름"
        />
        <TagPreview name={name} color={color} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ColorPicker value={color} onChange={setColor} label="새 태그 색" />
        <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={add}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          추가
        </Button>
      </div>
    </div>
  );
}

export function TagManager({ tags, onClose }: { tags: CalendarTag[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-background border-line max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="태그 관리"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-foreground text-sm font-bold">태그 관리</h2>
        <p className="text-text-dim mt-1 text-xs break-keep">
          태그 색을 바꾸면 그 태그가 달린 일정 전부가 새 색으로 보입니다. 색은 기본 7색 중에 고르거나,
          무지개 동그라미를 눌러 <b className="text-foreground">직접 선택</b>할 수 있습니다.
        </p>

        {tags.length > 0 ? (
          <ul className="divide-line border-line mt-3 divide-y rounded-lg border px-3">
            {tags.map((t) => (
              <TagRow key={t.id} tag={t} />
            ))}
          </ul>
        ) : (
          <p className="text-text-dim mt-3 text-sm">아직 태그가 없습니다 — 아래에서 추가하세요.</p>
        )}

        <NewTagRow />

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
