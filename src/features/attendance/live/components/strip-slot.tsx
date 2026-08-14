"use client";
/**
 * 스트립의 교시 한 칸 — 「전원 출석」 한 번으로 끝내는 자리.
 *
 * ⚠️ 여기서 결석을 찍을 수는 없다(의도) — 예외가 있는 반은 '자세히'로 넘어가 이름별로 찍는다.
 *    한 화면에 모든 걸 넣으면 스트립이 또 하나의 무거운 화면이 되고, 그러면 아무도 안 본다.
 * ⚠️ 서버가 거절하면 낙관 상태를 되돌린다(.catch 없으면 "찍은 줄 알았는데 안 찍힌" 상태가 남는다).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setAttendanceBulk } from "@/features/attendance/server/actions";

export function StripSlot({
  date,
  classId,
  className,
  slotStart,
  saveSlot,
  periodLabel,
  pendingIds,
  pendingNames,
}: {
  date: string;
  classId: string;
  className: string;
  slotStart: string;
  /** 저장에 실을 교시 값(slot-axis) — 수학은 null이라 "그날 전체"로 저장된다. */
  saveSlot: string | null;
  periodLabel: string | null;
  pendingIds: string[];
  pendingNames: string[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fillAll() {
    setError(null);
    setDone(true);
    startTransition(() => {
      setAttendanceBulk({
        sessionDate: date,
        status: "present",
        cells: pendingIds.map((id) => ({ studentId: id, classId })),
        fillEmptyOnly: true, // 서버 강제 — 낡은 화면이 남이 찍은 결석을 뒤집지 못한다
        slotStart: saveSlot,
      })
        .then((res) => {
          if ("error" in res) {
            setDone(false);
            setError(res.error);
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setDone(false);
          setError("저장하지 못했습니다 — 다시 눌러 주세요");
        });
    });
  }

  if (done && !error) return null;

  return (
    <div className="border-line bg-surface flex items-center justify-between gap-2 rounded-xl border p-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{className}</p>
        <p className="text-text-dim num text-xs">
          {periodLabel ? `${periodLabel} · ` : ""}
          {slotStart} · 미입력 {pendingIds.length}명
        </p>
        <p className="text-text-faint truncate text-xs" title={pendingNames.join(", ")}>
          {pendingNames.slice(0, 4).join(", ")}
          {pendingNames.length > 4 ? ` 외 ${pendingNames.length - 4}명` : ""}
        </p>
        {error && <p className="text-danger text-xs">{error}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={fillAll}
          disabled={busy}
          className="bg-primary text-primary-foreground rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap disabled:opacity-60"
        >
          전원 출석
        </button>
        <Link
          href="/attendance/live"
          className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1 text-center text-xs whitespace-nowrap"
        >
          자세히
        </Link>
      </div>
    </div>
  );
}
