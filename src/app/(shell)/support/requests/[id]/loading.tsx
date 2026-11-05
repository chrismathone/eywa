import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";

/** 글자 막대 — 실물 문구를 투명하게 깔아 줄 높이를 실물 글자가 정하게 한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/** 실물 카드 표면(request-detail — `bg-card shadow-card rounded-2xl`). */
const CARD = "bg-card shadow-card rounded-2xl";
/** 요청 정보 줄(SupportRequestDetailView) — 처리상태 줄만 단계 알약(`py-0.5 text-sm`)이라 더 높다(≈ 48px · 나머지 ≈ 44px). */
const INFO_ROWS = ["글쓴이", "작성일시", "결과수신 연락처", "결과수신 이메일", "처리상태", "처리완료 예정일"];
const STEPS = ["1 접수", "2 내용확인", "3 처리중", "4 완료"]; // 단계 알약 사이 › 는 폭만 조금 다르다

/**
 * 개선요청 상세 스켈레톤 — 실 배치(page.tsx, `space-y-4`): 헤더(제목) → 요청 정보 · 내용 · 답변 카드 → '목록으로'.
 * 칸은 실물 클래스(줄 `px-4 py-2.5` · 라벨 8.5rem 열 · `text-sm`) 그대로라 높이를 실물 글자가 정한다.
 * 글쓴이 본인의 수정 카드는 권한·상태에 따라 서므로 그리지 않는다. 고객센터 목록 스켈레톤을 받으면 모양이 전혀 달라 자기 것을 둔다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="개선요청 불러오는 중" className="space-y-4">
      <p className="sr-only">개선요청을 불러오고 있습니다…</p>
      <PageHeaderSkeleton />
      <div aria-hidden className="space-y-4">
        <section className={`${CARD} overflow-hidden`}>
          <div className="divide-line grid divide-y text-sm">
            {INFO_ROWS.map((label) => (
              <div key={label} className="grid grid-cols-[8.5rem_1fr] items-center gap-3 px-4 py-2.5 max-sm:grid-cols-1 max-sm:gap-0.5">
                <div className="font-bold">
                  <span className={TEXT_BAR}>{label}</span>
                </div>
                <div className="min-w-0">
                  {label === "처리상태" ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {STEPS.map((step) => (
                        <span key={step} className={`${TEXT_BAR} inline-flex rounded-full px-2.5 py-0.5 text-sm font-bold`}>
                          {step}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className={TEXT_BAR}>값 자리 · 값 자리</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
        {/* 내용 · 답변 — 제목(`text-base font-bold mb-2`) + 본문(`text-sm leading-relaxed`). */}
        {(["내용", "답변"] as const).map((title) => (
          <section key={title} className={`${CARD} p-5`}>
            <SkeletonLine className="mb-2 w-12 text-base font-bold" />
            <SkeletonText className="text-sm leading-relaxed">
              {title === "내용"
                ? "어느 화면에서 무엇을 어떻게 바꾸면 좋을지 적은 요청 본문 자리입니다. 길이는 요청마다 달라 두어 줄로 그립니다."
                : "아직 답변이 없습니다. 운영팀이 확인하면 여기와 알림으로 알려 드립니다."}
            </SkeletonText>
          </section>
        ))}
      </div>
      {/* 목록으로(`text-sm` 링크) */}
      <SkeletonLine className="w-16 text-sm" />
    </div>
  );
}
