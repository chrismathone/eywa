"use client";

// 지난주 복사 배너 — 빈 주에만 노출. 확인 다이얼로그에 복사 범위·skip 정책 명시.
// RPC(ecs_copy_week)가 원자 처리: 의미 행 있는 대상 교시 통째 skip, 대상 주 스케줄 밖 슬롯은 unmapped 보고.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyWeekFromPrevious } from "../server/actions";

export function CopyPrevWeek({
  classId,
  weekMonday,
  weekLabelText,
}: {
  classId: string;
  weekMonday: string;
  weekLabelText: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const r = await copyWeekFromPrevious({ classId, weekMonday });
    setBusy(false);
    dialogRef.current?.close();
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    const parts = [`계획 ${r.copied}줄 · 주간 목표 ${r.goalsCopied}건 복사`];
    if (r.skippedSlots.length > 0) parts.push(`이미 작성된 교시 ${r.skippedSlots.length}개 건너뜀`);
    if (r.unmapped.length > 0) parts.push(`시간표에 없는 교시 ${r.unmapped.length}개 제외`);
    toast.success(parts.join(" — "));
    router.refresh();
  };

  return (
    <div className="border-line bg-bg-soft flex flex-wrap items-center gap-2 rounded-2xl border border-dashed px-4 py-2.5 text-sm">
      <span className="text-text-dim">이 주는 아직 비어 있어요.</span>
      <button
        type="button"
        className="text-primary cursor-pointer font-bold underline-offset-2 hover:underline"
        onClick={() => dialogRef.current?.showModal()}
      >
        지난주 계획 가져오기
      </button>

      <dialog
        ref={dialogRef}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        className="bg-card border-line backdrop:bg-ink/40 m-auto w-full max-w-md rounded-xl border p-5 shadow-lg"
      >
        <h3 className="text-foreground text-sm font-bold">지난주 계획 가져오기</h3>
        <div className="text-text-dim mt-3 space-y-1.5 text-sm">
          <p>
            지난주 수업계획과 주간 목표를 <b className="text-foreground">{weekLabelText}</b>로 복사합니다.
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            <li>학생 기록(출석·상태·개인 진도)은 복사하지 않습니다.</li>
            <li>이미 계획이 있는 교시는 통째로 건너뜁니다(덮어쓰기 없음).</li>
            <li>이번 주 시간표에 없는 교시는 복사하지 않고 알려드립니다.</li>
          </ul>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => dialogRef.current?.close()}>
            취소
          </Button>
          <Button type="button" disabled={busy} onClick={() => void run()}>
            {busy ? "복사 중…" : "가져오기"}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
