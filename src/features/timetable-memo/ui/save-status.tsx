"use client";

import { writeLockedNote } from "@/lib/write-lock";
import type { SaveState } from "./use-memo-autosave";

const TIME = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

function at(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : TIME.format(d);
}

/** 저장 상태 한 줄 — 자동 저장이라 '저장' 단추 대신 지금 어디까지 들어갔는지를 말한다. */
export function SaveStatus({ state, canEdit, onRetry }: { state: SaveState; canEdit: boolean; onRetry: () => void }) {
  // 읽기 권한 — 수식 입력줄은 글자가 차 있으면 placeholder 안내가 안 보이므로 여기서 한 줄로 알린다(write-lock.ts).
  if (!canEdit) return <span className="text-sm">{writeLockedNote("timetable")}</span>;
  if (state.kind === "pending" || state.kind === "saving") return <span className="text-sm">저장 중…</span>;
  if (state.kind === "error") {
    return (
      <span className="text-danger flex items-center gap-2 text-sm" role="alert">
        {state.message}
        <button type="button" className="border-line rounded-md border px-2 py-0.5 text-foreground" onClick={onRetry}>
          다시 저장
        </button>
      </span>
    );
  }
  if (state.kind === "conflict") return <span className="text-danger text-sm">저장 멈춤 — 아래에서 골라 주세요</span>;
  const when = at(state.at);
  return <span className="text-sm">{when ? `저장됨 · ${when}` : "자동 저장"}</span>;
}

/** 다른 사람이 먼저 저장했을 때 — 덮을지, 그 판을 받을지 사람이 고른다(조용히 덮지 않는다). */
export function ConflictBanner({ updatedAt, onTakeTheirs, onKeepMine }: { updatedAt: string | null; onTakeTheirs: () => void; onKeepMine: () => void }) {
  const when = at(updatedAt);
  return (
    <div className="bg-danger-soft border-line flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm" role="alert">
      <span className="font-bold">다른 분이 이 시트를 먼저 저장했습니다{when ? `(${when})` : ""}.</span>
      <span>내가 고친 내용은 아직 저장되지 않았습니다.</span>
      <span className="ml-auto flex gap-2">
        <button type="button" className="border-line bg-card rounded-md border px-2 py-1" onClick={onTakeTheirs}>
          그 판 불러오기(내 것 버림)
        </button>
        <button type="button" className="bg-primary text-primary-foreground rounded-md px-2 py-1" onClick={onKeepMine}>
          내 것으로 덮어쓰기
        </button>
      </span>
    </div>
  );
}
