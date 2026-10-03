import { PageHeaderSkeleton } from "@/components/page-header";

// 강사뷰 '영상 제출 현황' 첫 로드 — 내가 낸 숙제 → 장부(숙제·기록·명단·영상·출결) 조회가 도는 동안 바로 그린다(B7).
// 🔴 원스크린 루트(`/onescreen/loading.tsx`)엔 두지 않는다 — 원스크린 첫 페인트까지 바뀐다. 이 폴더에만.
export default function TeacherVideoHomeworkLoading() {
  return (
    <div className="w-full min-w-0 space-y-4">
      <PageHeaderSkeleton />
      <div className="bg-bg-soft h-(--control-h) w-full max-w-xl animate-pulse rounded-lg" />
      <div className="bg-card border-line shadow-card h-64 animate-pulse rounded-2xl border" />
    </div>
  );
}
