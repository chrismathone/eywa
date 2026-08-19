"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteCalendarTag, saveCalendarTag } from "@/features/calendar/server/actions";
import {
  EVENT_COLORS,
  EVENT_COLOR_LABEL,
  type CalendarTag,
  type EventColor,
} from "@/features/calendar/types";

/**
 * 태그 관리(0224a) — 태그 이름·색 편집과 추가·삭제. fixed 오버레이(EventDialog 패턴).
 * 색은 태그에 한 번만 저장되므로 여기서 바꾸면 그 태그가 달린 일정 전부가 따라온다.
 * 목록은 서버 props(page → calendar-client) — 저장 성공 시 router.refresh()로 재조회.
 */

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition";

/** 색 점 — Tailwind 동적 클래스 금지(정적 Record, event-dialog와 동일 팔레트). */
const DOT_SOLID: Record<EventColor, string> = {
  primary: "bg-primary",
  blue: "bg-blue",
  green: "bg-green",
  amber: "bg-amber",
  purple: "bg-purple",
  rose: "bg-rose",
  neutral: "bg-text-faint",
};

function ColorPicker({
  value,
  onChange,
}: {
  value: EventColor;
  onChange: (c: EventColor) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {EVENT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={EVENT_COLOR_LABEL[c]}
          aria-label={`색 ${EVENT_COLOR_LABEL[c]}`}
          className={`size-4 rounded-full transition ${DOT_SOLID[c]} ${
            value === c ? "ring-primary/60 ring-2 ring-offset-1" : "opacity-50 hover:opacity-100"
          }`}
        />
      ))}
    </div>
  );
}

/** 기존 태그 한 줄 — 이름·색 편집 + 삭제. 저장은 값이 바뀌었을 때만 활성. */
function TagRow({ tag }: { tag: CalendarTag }) {
  const router = useRouter();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<EventColor>(tag.color);
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
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <ColorPicker value={color} onChange={setColor} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={30}
        className={`${inputClass} min-w-0 flex-1`}
        aria-label="태그 이름"
      />
      <span className="flex shrink-0 items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={pending || !dirty || !name.trim()} onClick={save}>
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
  const [color, setColor] = useState<EventColor>("primary");
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
    <div className="border-line mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2.5">
      <ColorPicker value={color} onChange={setColor} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={30}
        placeholder="새 태그 이름"
        className={`${inputClass} min-w-0 flex-1`}
        aria-label="새 태그 이름"
      />
      <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={add}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        추가
      </Button>
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
        <p className="text-text-dim mt-1 text-[12px]">
          태그 색을 바꾸면 그 태그가 달린 일정 전부가 새 색으로 보입니다.
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
