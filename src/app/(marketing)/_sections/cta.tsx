import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";

export function CtaSection() {
  return (
    <section id="cta" className="bg-background px-16 py-[120px]">
      <div className="mx-auto max-w-[1100px]">
        <article
          className="bg-card border-line shadow-modal relative grid grid-cols-1 gap-14 overflow-hidden rounded-[10px] border px-14 py-16 lg:grid-cols-[1.3fr_1fr]"
        >
          {/* 배경 장식 */}
          <span
            className="bg-primary/15 pointer-events-none absolute -top-32 -right-32 size-[520px] rounded-full blur-3xl"
            aria-hidden="true"
          />
          <span
            className="bg-gold/14 pointer-events-none absolute -bottom-32 -left-32 size-[440px] rounded-full blur-3xl"
            aria-hidden="true"
          />
          <svg
            className="pointer-events-none absolute -top-32 -right-32 opacity-[0.18]"
            width="700"
            height="700"
            viewBox="0 0 700 700"
            aria-hidden="true"
          >
            {[300, 230, 160, 90].map((r) => (
              <circle key={r} cx="350" cy="350" r={r} fill="none" stroke="var(--primary)" strokeWidth="1" />
            ))}
          </svg>

          {/* 좌측 */}
          <div className="relative">
            <span className="bg-primary-soft text-primary inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-bold">
              <span className="bg-primary size-2 animate-pulse rounded-full" />
              BETA OPEN · 신규 등록 진행중
            </span>
            <h2
              className="text-foreground mt-5"
              style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-1.6px", lineHeight: 1.05 }}
            >
              오늘 신청하면
              <br />
              <span
                className="text-primary"
                style={{
                  backgroundImage:
                    "linear-gradient(transparent 62%, var(--gold-soft) 62%, var(--gold-soft) 92%, transparent 92%)",
                }}
              >
                다음 주에 적용
              </span>
              됩니다.
            </h2>
            <p
              className="text-text-dim mt-6 max-w-[480px]"
              style={{ fontSize: 16, lineHeight: 1.75 }}
            >
              상담 30분 · 데이터 마이그레이션 3일 · 직원 교육 2일.
              <br />
              다음 주 월요일에는 EYWA가 켜져 있습니다.
            </p>

            <div className="border-line mt-7 grid grid-cols-3 gap-7 border-t pt-6">
              {[
                { label: "신용카드 없이", title: "무료 시작" },
                { label: "평일 1시간 안", title: "응답 보장" },
                { label: "데이터", title: "무료 마이그레이션" },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-2">
                  <span className="bg-primary-soft text-primary mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full">
                    <EyIcon name="check" size={12} />
                  </span>
                  <div>
                    <p className="text-text-faint text-[11px]">{item.label}</p>
                    <p className="text-foreground text-[12px] font-bold">{item.title}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 우측 — 액션 카드 */}
          <div className="relative space-y-3">
            <Link
              href="/login"
              className="flex items-center gap-3 rounded-2xl px-6 py-5 text-white transition"
              style={{
                background: "linear-gradient(135deg, #1a5f3c 0%, #2a7a52 100%)",
                boxShadow: "0 14px 32px rgba(26, 95, 60, 0.28)",
              }}
            >
              <div className="flex-1">
                <p className="font-mono text-[11px] font-extrabold tracking-wider uppercase opacity-70">
                  3분이면 끝
                </p>
                <p className="mt-1 text-[17px] font-extrabold">베타 신청하기</p>
              </div>
              <span className="flex size-10 items-center justify-center rounded-full bg-white/18">
                <EyIcon name="arrowRight" size={18} />
              </span>
            </Link>

            <Link
              href="tel:1670-0000"
              className="bg-bg-soft border-line flex items-center gap-3 rounded-2xl border px-6 py-[18px] transition hover:bg-bg-soft/80"
            >
              <div className="flex-1">
                <p className="text-text-dim text-[11px]">편하게 물어보세요</p>
                <p className="text-foreground mt-0.5 text-[15px] font-bold">원장님과 30분 상담</p>
              </div>
              <span className="bg-card text-primary border-line flex size-9 items-center justify-center rounded-xl border">
                <EyIcon name="bell" size={15} />
              </span>
            </Link>

            <p className="text-text-dim mt-4 text-center text-[12px]">
              <span className="text-foreground font-mono font-semibold">1670-0000</span>
              <span className="ml-2">평일 10:00 – 18:00</span>
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
