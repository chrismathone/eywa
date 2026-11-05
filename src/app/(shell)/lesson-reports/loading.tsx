import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonText } from "@/components/skeleton-text";
import { lessonReportFaces } from "@/features/report-admin/lesson-report-faces";

const BAR = "bg-bg-soft text-transparent animate-pulse rounded";
// 작성률 카드의 알약(기간 전환·과목 칩) — 실물 `rounded-full border px-3 py-1 text-xs`. BAR와 섞지 않는다(rounded 둘이 겹치면 CSS 순서가 승자 — [[#116]]).
const CHIP = "border-line bg-bg-soft animate-pulse rounded-full border px-3 py-1 text-xs text-transparent";
const WEEK = ["월", "화", "수", "목", "금", "토", "일"];

// 면 탭 칸 = 흔한 첫 화면(원장 · 전 권한 · 클래스노트 켜짐 · AI 분석 라이선스 켜짐 — page.tsx `isFeatureLicensed`는 행이 없으면 켜짐)의
// 실물 면 — 실물 정의(lessonReportFaces)에서 읽어 이름·순서가 바뀌면 따라온다.
const FACES = lessonReportFaces({ canReportSettings: true, canAiMent: true, canSend: true, classnoteOn: true, aiOn: true });
const FACE_LABELS = FACES.map((f) => f.label);
// 구분선 자리 = 실물 face-tabs.tsx와 같은 판정(앞 칸과 group이 다르면 그 칸 앞 — 관리 ┃ 설정).
const FACE_DIVIDERS = FACES.flatMap((f, i) => (i > 0 && f.group !== FACES[i - 1]?.group ? [i] : []));

// 수업보고서 초기 로드 스트리밍 — 활성 면 하나만 조회하는 동안(page.tsx tabP) Next가 이 loading을 Suspense fallback으로
// 즉시 흘린다(창=iframe 첫 페인트 빈 화면 방지, B7).
// loading.tsx는 주소(?tab=)를 못 읽는다 — 면마다 본문이 달라 공통 골격(머리 + 면 탭 + 카드 한 장)으로 타협한다(원장 결정).
// 카드는 기본 면(작성률 WritingRateCard)의 껍데기 · 그 면엔 카드 밖 툴바가 없어(기간 이동은 카드 안) 툴바 줄은 그리지 않는다.
// 영상 제출 현황 면은 별도 라우트라 자기 스켈레톤(video-homework/loading.tsx)을 갖는다.
export default function LessonReportsLoading() {
  return (
    <div className="w-full min-w-0 space-y-3">
      {/* 머리 — 실 헤더엔 embedLabel·actions가 없다. 창·모바일 컴팩트 한 줄은 공용 스켈레톤이 같은 CSS 변형으로 맞춘다. */}
      <PageHeaderSkeleton />
      {/* 면 탭 — 영상 제출 현황·작성률·목록·클래스노트·보고서 설정·AI 멘트(권한·모듈에 따라 줄어든다). */}
      <FaceTabsSkeleton labels={FACE_LABELS} dividers={FACE_DIVIDERS} />
      <section aria-hidden className="bg-card shadow-card rounded-2xl px-5 py-5">
        <div className="mb-3 space-y-3">
          <div>
            <SkeletonText className="editorial-eyebrow">작성 현황</SkeletonText>
            <SkeletonText className="mt-0.5 text-base font-bold">강사별 작성률</SkeletonText>
          </div>
          {/* 기간 전환 칩(RangeSwitch) — 실물과 같은 알약 치수. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex shrink-0 items-center gap-1.5">
              {["이번 주", "월간"].map((t) => (
                <span key={t} className={CHIP}>{t}</span>
              ))}
            </div>
          </div>
          <SkeletonText className="text-xs">이번 주(월~일) 요일별·주간 작성률 — 작성/대상(결석 제외) · 오늘은 시작된 수업까지만</SkeletonText>
        </div>
        {/* 과목 칩 줄 — 과목이 둘 이상인 지점(흔한 경우)에 선다. 실물과 같은 알약 치수. */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["전체", "수학", "영어"].map((t) => (
            <span key={t} className={CHIP}>{t}</span>
          ))}
        </div>
        {/* 강사별 표 — 실물과 같은 셀 여백·글자 크기. 행 높이는 두 줄짜리 요일·주간 칸(비율 + 작성/대상)이 정한다. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-line border-b">
                <th className="px-3 py-2 font-bold"><span className={BAR}>강사</span></th>
                <th className="px-3 py-2 text-center font-bold"><span className={BAR}>오늘</span></th>
                {WEEK.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-bold"><span className={BAR}>{d}</span></th>
                ))}
                <th className="px-3 py-2 text-center font-bold"><span className={BAR}>주간</span></th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((r) => (
                <tr key={r} className="border-line border-b align-top last:border-b-0">
                  <td className="px-3 py-2"><span className={`font-bold ${BAR}`}>강사 이름</span></td>
                  <td className="px-3 py-2 text-center">
                    <span className={`num text-sm font-bold ${BAR}`}>00%<span className="ml-1 text-xs font-normal">0/0</span></span>
                  </td>
                  {WEEK.map((d) => (
                    <td key={d} className="px-2 py-2 text-center align-middle">
                      <span className="num text-xs font-bold">
                        <span className={BAR}>00%</span>
                        <span className={`num mx-auto block w-fit font-normal ${BAR}`}>0/0</span>
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center align-middle">
                    <span className="num text-sm font-bold">
                      <span className={BAR}>00%</span>
                      <span className={`num mx-auto block w-fit text-xs font-normal ${BAR}`}>00/00</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
