import Image from "next/image";
import { EyIcon } from "@/components/icons/eywa-icons";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인 — eywa" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
      <BrandPanel />

      <div className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm space-y-10">
          <header className="space-y-3">
            <p className="editorial-eyebrow">로그인</p>
            <h1 className="font-bold tracking-tight text-foreground text-3xl">
              다시 만나서<br />
              반갑습니다.
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              학원 운영 데이터를 보려면<br />
              계정으로 로그인해 주세요.
            </p>
          </header>

          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}

/**
 * 좌측 브랜드 패널 — Editorial 문법 ④(실사 사진 + 캡션 오버레이).
 * 구판의 CSS 괘선 텍스처·가짜 출석부 장식(LedgerDecoration)·영문 mono 푸터는 "코딩 틱함"의
 * 대표 사례라 제거. 사진은 public/photos/login-panel.webp (placeholder → 실사 덮어쓰기 계약,
 * docs/photo-generation-prompts.md). LCP라 preload.
 *
 * 브랜드(로고·워드마크·학원명)는 **학원설정에서 읽는다**(getPublicBranding — 로그인 전이라 세션이 없으므로
 * **회사 브랜드 학원**(`pickBrandTenantId`: 1개면 그 학원, 2개+면 env `PUBLIC_BRAND_TENANT_SLUG`)만 확정하고 아니면
 * 제품 중립 표기로 폴백 — URL에 지점이 없는 C안, 2026-09-18). /owner에서 값을 바꾸면 이 화면이
 * 따라온다. 학원명을 코드에 적지 말 것(구판은 "인재원"이 3곳 하드코딩돼 있었다).
 */
async function BrandPanel() {
  const branding = await getPublicBranding();
  const { wordmark, academyLine, academyName } = brandLabels(branding);
  // signed URL은 캐시 밖에서 요청마다((shell)/layout.tsx 동일 규약). 미업로드·실패면 null → 마크 폴백.
  const logoSrc = branding
    ? await resolveBrandingSrc(branding.settings.profile.logoUrl, branding.tenantId)
    : null;
  // 학원명이 없으면 "학원"으로 — 본문 카피가 특정 학원에 묶이지 않게.
  const subject = academyName ?? "학원";

  return (
    <aside className="relative hidden flex-col overflow-hidden p-12 text-white lg:flex">
      <Image
        src="/photos/login-panel.webp"
        alt=""
        fill
        sizes="(max-width: 1024px) 0px, 55vw"
        preload
        className="object-cover"
      />
      {/* 텍스트 가독 오버레이 — 사진 위 흰 글자 대비 확보.
          🔴 사진 위 글자에 알파를 먹이지 말 것(옛 white/60·70·75·85) — 2026-09-08 원장이 캡처로
          흐려진 "같은 자리,"를 지목했다. 화면 글자를 흐리게 하지 않는다는 같은 날 규칙(글자색 한 값)의
          비로그인 판이다. 위계가 필요하면 굵기·크기로. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/50 to-black/35"
        aria-hidden
      />

      <div className="relative flex items-center gap-3">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS signed URL), next/image 최적화 불필요
          <img src={logoSrc} alt={wordmark} className="size-9 shrink-0 rounded-xl bg-white object-contain p-1" />
        ) : (
          <span className="text-primary inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white">
            <EyIcon name="building" size={20} strokeWidth={1.8} />
          </span>
        )}
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-tight">{wordmark}</p>
          <p className="text-xs text-white">{academyLine}</p>
        </div>
      </div>

      <div className="relative my-auto space-y-7 py-12">
        <h2 className="font-bold tracking-tight text-5xl xl:text-[3.75rem]">
          매일 같은 시간,<br />
          <span className="text-white">같은 자리,</span><br />
          한 화면에 모인 하루.
        </h2>
        {/* 🔴 기능을 **나열하지 말 것**(원장 2026-09-08 "너무 그렇게 메뉴 나열하지말고 간단하게") —
            메뉴가 늘 때마다 고쳐야 하고 읽히지도 않는다. 옛 문구 "출석부, 시간표, 수강료, 상담 기록"이 그래서 낡았다. */}
        <p className="max-w-md text-base leading-relaxed text-white">
          {subject} 운영에 필요한 것만,<br />
          빠르고 단순하게.
        </p>
      </div>

      <p className="relative text-xs font-medium text-white">
        {academyName ? `${academyName} · ` : ""}학원 운영의 하루가 여기서 시작됩니다
      </p>
    </aside>
  );
}
