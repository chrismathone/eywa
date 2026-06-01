import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";

export function HeroSection() {
  return (
    <section className="bg-background relative overflow-hidden">
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-center gap-14 px-16 py-16 lg:grid-cols-[1.1fr_1fr]">
        {/* 좌측 */}
        <div className="space-y-7">
          <span className="bg-primary-soft text-primary inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold">
            <EyIcon name="sparkle" size={13} />
            전국 47개 학원이 선택한 학원관리 프로그램
          </span>
          <h1 className="display-md text-foreground" style={{ fontSize: 56, lineHeight: 1.15 }}>
            원장님이 가장 먼저 켜는
            <br />
            <span className="text-primary">학원관리 프로그램</span>
          </h1>
          <p
            className="text-text-dim max-w-[460px]"
            style={{ fontSize: 17, lineHeight: 1.7 }}
          >
            출결 · 수납 · 상담 · 학부모 알림까지
            <br />
            학원 운영에 꼭 필요한 모든 기능을 한 화면에서.{" "}
            <span className="text-foreground font-bold">월 49,000원부터, 첫 달은 무료</span>입니다.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="bg-primary text-primary-foreground hover:bg-primary-hover shadow-primary-glow inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-[14px] font-bold transition"
            >
              무료로 시작하기
              <EyIcon name="arrowRight" size={14} />
            </Link>
            <a
              href="#pricing"
              className="border-line-strong bg-card text-foreground hover:bg-bg-soft inline-flex items-center rounded-xl border px-6 py-3.5 text-[14px] font-semibold transition"
            >
              요금 안내 →
            </a>
          </div>
          {/* 소셜 프루프 */}
          <div className="border-line flex flex-wrap items-center gap-4 border-t pt-5">
            <div className="flex -space-x-2">
              {(["primary", "gold", "blue", "rose"] as const).map((c) => (
                <span
                  key={c}
                  className={`bg-${c} ring-background size-7 rounded-md ring-2`}
                />
              ))}
            </div>
            <div>
              <p className="text-foreground text-[13px] font-bold">
                이미 47개 학원이 사용하고 있어요
              </p>
              <p className="text-text-dim text-[11px]">
                <span className="text-gold">★★★★★</span> 4.9 · 원장님 92%가 추천
              </p>
            </div>
          </div>
        </div>

        {/* 우측 — Hero 카드 (forest gradient) */}
        <div
          className="relative overflow-hidden rounded-xl p-6"
          style={{
            background: "linear-gradient(135deg, #1a5f3c 0%, #2d9461 100%)",
            boxShadow: "0 20px 60px rgba(31, 122, 77, 0.25)",
          }}
        >
          {/* 우상단 동심원 */}
          <svg
            className="pointer-events-none absolute top-0 right-0 opacity-[0.18]"
            width="240"
            height="240"
            viewBox="0 0 240 240"
            aria-hidden="true"
          >
            {[100, 80, 60, 40, 20].map((r) => (
              <circle key={r} cx="120" cy="120" r={r} fill="none" stroke="#fff" strokeWidth="1" />
            ))}
          </svg>

          <div className="space-y-3.5">
            {/* 카드 1: KPI */}
            <article
              className="bg-card rounded-xl p-4"
              style={{ transform: "rotate(-1.5deg)", boxShadow: "0 10px 30px rgba(0,0,0,0.12)" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="bg-primary size-2 rounded-full" />
                <p className="micro">오늘의 학원</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <Mini label="재원생" value="248" />
                <Mini label="출석률" value="94.2%" />
                <Mini label="수납률" value="87.1%" />
              </div>
            </article>

            {/* 카드 2: 진행중 수업 */}
            <article
              className="bg-card flex items-center gap-3 rounded-xl p-4"
              style={{ transform: "rotate(1deg)", boxShadow: "0 10px 30px rgba(0,0,0,0.12)" }}
            >
              <span className="bg-primary-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                <EyIcon name="leaf" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-[13px] font-bold">중2 수학 심화 A반</p>
                <p className="text-text-dim text-[11px]">박지훈 강사 · 301호 · 12명</p>
              </div>
              <span className="bg-danger-soft text-danger rounded-full px-2 py-0.5 font-mono text-[10px] font-bold">
                LIVE
              </span>
            </article>

            {/* 카드 3: 학부모 상담 완료 */}
            <article
              className="bg-card flex items-center gap-3 rounded-xl p-4"
              style={{ transform: "rotate(-0.5deg)", boxShadow: "0 10px 30px rgba(0,0,0,0.12)" }}
            >
              <span className="bg-rose-soft text-rose flex size-9 shrink-0 items-center justify-center rounded-lg font-bold">
                윤
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-[13px] font-bold">윤소율 학부모 상담 완료</p>
                <p className="text-text-dim text-[11px]">중2 수학 진로 · AI 분석 완료</p>
              </div>
              <span className="text-primary text-[11px] font-bold">방금</span>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="micro text-[9px]">{label}</p>
      <p className="tabular text-foreground mt-1 text-[18px] leading-none">{value}</p>
    </div>
  );
}
