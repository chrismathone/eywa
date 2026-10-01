/** 학부모 등하원 스켈레톤 — 오늘 등하원과 같은 조회를 받으므로 첫 페인트를 막지 않게 흘려보낸다(B7). */
import { SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";

export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <div className={SHUTTLE_TOOLBAR}>
        <div className="bg-muted h-(--control-h) w-96 animate-pulse rounded-lg" />
      </div>
      <div className="bg-muted h-5 w-80 animate-pulse rounded" />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-muted h-40 animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
