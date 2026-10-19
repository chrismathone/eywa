import "server-only";
import { Skeleton } from "@/components/ui/skeleton";
import { loadMemoSheet } from "../server/store";
import { MemoSheet } from "./memo-sheet";

/**
 * 오른쪽 판의 서버 쪽 — 시트를 읽어 엑셀 판에 넘긴다. 시간표 첫 그림을 막지 않게 **Suspense 안에서** 돈다(B7) —
 * 오른쪽 판은 처음엔 화면 밖이라 시트가 조금 늦게 와도 보는 사람이 기다리지 않는다.
 * 게이트(보기·편집)는 호출부(시간표 페이지)가 `memoSheetAccess`로 먼저 정해 넘긴다.
 */
export async function MemoSheetPane({ tenantId, subject, canEdit }: { tenantId: string; subject: string; canEdit: boolean }) {
  const load = await loadMemoSheet(tenantId, subject);
  if (load.status !== "ok") {
    return (
      <div className="bg-card shadow-card flex h-full items-center justify-center rounded-2xl p-6 text-center text-sm">
        메모 시트를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.
      </div>
    );
  }
  return (
    <MemoSheet
      cacheKey={`${tenantId}:${subject}`}
      subject={subject}
      packed={load.packed}
      version={load.version}
      updatedAt={load.updatedAt}
      canEdit={canEdit}
    />
  );
}

export function MemoSheetSkeleton() {
  return (
    <div className="bg-card shadow-card flex h-full flex-col gap-3 rounded-2xl p-3" aria-hidden>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="min-h-0 w-full flex-1" />
    </div>
  );
}
