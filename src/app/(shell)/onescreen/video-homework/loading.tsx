import { PageHeaderSkeleton } from "@/components/page-header";
import { VideoLedgerSkeleton } from "@/features/video-homework/components/video-ledger-skeleton";

// 강사뷰 '영상 제출 현황' 첫 로드 — 내가 낸 숙제 → 장부(숙제·기록·명단·영상·출결) 조회가 도는 동안 바로 그린다(B7).
// 🔴 원스크린 루트(`/onescreen/loading.tsx`)엔 두지 않는다 — 원스크린 첫 페인트까지 바뀐다. 이 폴더에만.
// 본문 = 관리자 화면과 같은 장부(VideoHomeworkManagement)라 공용 `VideoLedgerSkeleton`을 함께 쓴다
// (툴바 = 실물 `<Toolbar>` + `ToolbarSkeletonItem` · 요약 줄 · 안내 줄 · 반 묶음).
// 조건부 안내 상자(검사 꺼짐·읽기 실패 등)는 흔한 첫 화면에 없어 그리지 않는다.
export default function TeacherVideoHomeworkLoading() {
  return (
    <div className="w-full min-w-0 space-y-4">
      <PageHeaderSkeleton />
      <VideoLedgerSkeleton />
    </div>
  );
}
