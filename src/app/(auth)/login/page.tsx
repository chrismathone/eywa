import { Fragment } from "react";
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
            <p className="eyebrow">Sign in</p>
            <h1 className="display text-foreground text-3xl">
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

function BrandPanel() {
  return (
    <aside className="bg-primary text-primary-foreground relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent 0, transparent 31px, currentColor 31px, currentColor 32px)",
        }}
        aria-hidden
      />

      <div className="relative flex items-center gap-3">
        <span className="bg-primary-foreground text-primary inline-flex size-9 items-center justify-center rounded-md text-lg font-black">
          e
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">eywa</p>
          <p className="text-[11px] opacity-60">인재원 학원관리 시스템</p>
        </div>
      </div>

      <div className="relative space-y-7">
        <h2 className="display text-5xl xl:text-[3.75rem]">
          매일 같은 시간,<br />
          <span className="opacity-50">같은 자리,</span><br />
          한 권의 일지.
        </h2>
        <p className="max-w-md text-base leading-relaxed opacity-80">
          출석부, 시간표, 수강료, 상담 기록.<br />
          인재원의 하루를 한 곳에 모아두는<br />
          가벼운 학원관리 도구입니다.
        </p>
      </div>

      <div className="relative space-y-4">
        <LedgerDecoration />
        <p className="num font-mono text-[10px] tracking-wider opacity-40">
          v0.1.0 · DEMO · MADE WITH WARMTH IN SEOUL · 2026
        </p>
      </div>
    </aside>
  );
}

function LedgerDecoration() {
  const rows = [
    { name: "강민서", marks: ["P", "P", "P", "P", "L", "P", "P"] },
    { name: "윤지호", marks: ["P", "P", "A", "P", "P", "P", "P"] },
    { name: "이서연", marks: ["P", "L", "P", "P", "P", "P", "P"] },
    { name: "김도윤", marks: ["P", "P", "P", "P", "P", "P", "A"] },
    { name: "한지우", marks: ["P", "P", "P", "P", "P", "P", "P"] },
  ];
  return (
    <div className="border-primary-foreground/15 inline-block border p-3">
      <div className="mb-2 text-[10px] font-medium tracking-[0.18em] opacity-50 uppercase">
        Today · Class 3-A
      </div>
      <div className="num grid grid-cols-[auto_repeat(7,_1.5ch)] gap-x-3 gap-y-1 font-mono text-[10px] opacity-70">
        {rows.map((r) => (
          <Fragment key={r.name}>
            <span className="font-sans">{r.name}</span>
            {r.marks.map((m, i) => (
              <span
                key={i}
                className={
                  m === "A"
                    ? "text-[oklch(0.78_0.16_28)]"
                    : m === "L"
                      ? "text-[oklch(0.82_0.14_75)]"
                      : ""
                }
              >
                {m}
              </span>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
