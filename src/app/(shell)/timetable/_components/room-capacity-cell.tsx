"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateClassroomCapacity } from "@/features/owner/server/classroom-actions";

// 교실뷰 인라인 정원 편집(원장 요청 2026-08-03) — 학원설정까지 안 가고 주간 표에서 바로 입력.
// 저장은 owner 강의실 액션 단일 경로(updateClassroomCapacity, owner 쓰기 게이트) 재사용.
// ⚠️ <form action> 금지(#83 자동 리셋) — 이벤트에서 액션 직접 호출 + router.refresh()로 서버 재렌더.

export function RoomCapacityCell({
  roomId,
  capacity,
  canEdit,
}: {
  roomId: string;
  capacity: number | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!canEdit) return <span className="num">{capacity ?? "—"}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        title="정원 수정"
        onClick={() => {
          setVal(capacity != null ? String(capacity) : "");
          setErr(null);
          setEditing(true);
        }}
        className={`num underline decoration-dotted underline-offset-2 ${
          capacity == null ? "text-text-faint hover:text-foreground" : "hover:text-primary"
        }`}
      >
        {capacity ?? "정원 입력"}
      </button>
    );
  }

  const save = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", roomId);
      fd.set("capacity", val.trim());
      const res = await updateClassroomCapacity(undefined, fd);
      if (res?.error) {
        setErr(res.error);
        return; // 편집 유지 — 값이 조용히 사라지지 않게
      }
      setEditing(false);
      router.refresh(); // 지도 헤더·좌석 % 등 서버 파생값까지 갱신
    });
  };

  return (
    <input
      autoFocus
      value={val}
      disabled={pending}
      inputMode="numeric"
      title={err ?? "빈칸 저장 = 정원 해제"}
      onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") setEditing(false);
      }}
      className={`num w-12 rounded-md border px-1 py-0 text-right text-[11px] ${
        err ? "border-red-500" : "border-line"
      }`}
    />
  );
}
