import Image from "next/image";
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
 */
function BrandPanel() {
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
      {/* 텍스트 가독 오버레이 — 사진 위 흰 글자 대비 확보 */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/50 to-black/35"
        aria-hidden
      />

      <div className="relative flex items-center gap-3">
        <span className="text-primary inline-flex size-9 items-center justify-center rounded-xl bg-white text-lg font-bold">
          e
        </span>
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-tight">eywa</p>
          <p className="text-[11px] text-white/70">인재원 학원관리 시스템</p>
        </div>
      </div>

      <div className="relative my-auto space-y-7 py-12">
        <h2 className="font-bold tracking-tight text-5xl xl:text-[3.75rem]">
          매일 같은 시간,<br />
          <span className="text-white/60">같은 자리,</span><br />
          한 권의 일지.
        </h2>
        <p className="max-w-md text-base leading-relaxed text-white/85">
          출석부, 시간표, 수강료, 상담 기록.<br />
          인재원의 하루를 한 곳에 모아두는<br />
          가벼운 학원관리 도구입니다.
        </p>
      </div>

      <p className="relative text-[12px] font-medium text-white/75">
        인재원 · 학원 운영의 하루가 여기서 시작됩니다
      </p>
    </aside>
  );
}
