import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { PageHeaderSkeleton } from "@/components/page-header";
import { lessonReportFaces } from "@/features/report-admin/lesson-report-faces";
import { VideoLedgerSkeleton } from "@/features/video-homework/components/video-ledger-skeleton";

// 면 탭 칸 = 흔한 첫 화면(원장 · 전 권한 · 클래스노트 켜짐 · AI 분석 라이선스 켜짐 — page.tsx `isFeatureLicensed`는 행이 없으면 켜짐)의
// 실물 면 — 실물 정의(lessonReportFaces)에서 읽어 이름·순서가 바뀌면 따라온다.
const FACES = lessonReportFaces({ canReportSettings: true, canAiMent: true, canSend: true, classnoteOn: true, aiOn: true });
const FACE_LABELS = FACES.map((f) => f.label);
// 구분선 자리 = 실물 face-tabs.tsx와 같은 판정(앞 칸과 group이 다르면 그 칸 앞 — 관리 ┃ 설정).
const FACE_DIVIDERS = FACES.flatMap((f, i) => (i > 0 && f.group !== FACES[i - 1]?.group ? [i] : []));

// 관리자 '영상숙제 확인' 첫 로드 — 장부·강사 필터 재료 조회가 도는 동안 바로 그린다(B7).
// 이 파일이 없으면 부모(`/lesson-reports/loading.tsx` — 작성률 카드 골격)를 받아 데이터가 오는 순간 화면이 통째로 바뀐다.
// 줄 = 실물: 머리 → 수업보고서 면 탭(이 화면이 첫 면) → 장부(툴바 = 실물 `<Toolbar>` + `ToolbarSkeletonItem` · 요약 · 안내 · 반 묶음,
// 강사뷰와 같은 `VideoLedgerSkeleton`).
// 조건부 안내 상자(검사 꺼짐·대상 제외·읽기 실패 등)는 흔한 첫 화면에 없어 그리지 않는다.
export default function VideoHomeworkLoading() {
  return (
    <div className="w-full min-w-0 space-y-4">
      <PageHeaderSkeleton />
      <FaceTabsSkeleton labels={FACE_LABELS} dividers={FACE_DIVIDERS} />
      <VideoLedgerSkeleton />
    </div>
  );
}
