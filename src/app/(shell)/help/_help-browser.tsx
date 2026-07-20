"use client";

import { useState } from "react";
import Image from "next/image";
import { EyIcon, MENU_ICON } from "@/components/icons/eywa-icons";
import type { MenuKey } from "@/lib/permissions";

type MenuItem = { id: MenuKey; label: string; href: string; description: string };
type FaqItem = { q: string; a: string };
type QuickStep = { title: string; desc: string; href: string; hrefLabel: string };

export function HelpBrowser({
  menus,
  faq,
  quickstart,
}: {
  menus: MenuItem[];
  faq: FaqItem[];
  quickstart: QuickStep[];
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filteredSteps = q
    ? quickstart.filter((s) => `${s.title} ${s.desc}`.toLowerCase().includes(q))
    : quickstart;
  const filteredMenus = q
    ? menus.filter((m) => `${m.label} ${m.description}`.toLowerCase().includes(q))
    : menus;
  const filteredFaq = q
    ? faq.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(q))
    : faq;
  const noResults =
    q.length > 0 &&
    filteredSteps.length === 0 &&
    filteredMenus.length === 0 &&
    filteredFaq.length === 0;

  return (
    <>
      {/* Search hero — Editorial 문법 ④: 사진 배경 + 어두운 오버레이(텍스트 대비 유지) */}
      <section className="relative overflow-hidden rounded-2xl p-8 text-white shadow-primary-deep">
        <Image
          src="/photos/help-hero.webp"
          alt=""
          fill
          sizes="(max-width: 1024px) 100vw, 860px"
          className="object-cover"
        />
        <div
          className="absolute inset-0 bg-gradient-to-br from-primary/85 to-primary/60"
          aria-hidden="true"
        />
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
        <div className="relative max-w-2xl">
          <p className="text-[12px] font-bold text-[var(--gold-bright)]">도움말 센터</p>
          <h1 className="mt-2 text-[28px] font-bold leading-tight">무엇을 도와드릴까요?</h1>
          <p className="mt-2 text-[13px] text-white/85">
            처음이신가요? 아래 <b>빠른 시작</b>부터 따라 해보세요. 메뉴별 안내와 자주 묻는 질문도 한 곳에 있어요.
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 backdrop-blur-sm">
            <EyIcon name="search" size={15} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="검색 (예: 출석, 학생 등록, 엑셀 가져오기)"
              autoComplete="off"
              aria-label="도움말 검색"
              className="flex-1 bg-transparent text-[13px] text-white placeholder:text-white/60 focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="검색어 지우기"
                className="rounded-full px-1.5 text-white/70 transition hover:text-white"
              >
                <EyIcon name="close" size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {noResults ? (
        <section className="bg-card border-line shadow-card rounded-2xl border p-10 text-center">
          <p className="text-foreground text-sm font-bold">&lsquo;{query}&rsquo; 검색 결과가 없습니다</p>
          <p className="text-text-dim mt-1 text-xs">다른 검색어를 입력하거나 검색어를 지워보세요.</p>
        </section>
      ) : null}

      {/* 빠른 시작 — 처음 사용자를 위한 순서 */}
      {filteredSteps.length > 0 ? (
        <section>
          <header className="mb-3">
            <p className="micro">처음이신가요?</p>
            <h2 className="text-foreground mt-0.5 text-[17px] font-bold">빠른 시작 — 이 순서로 준비하세요</h2>
          </header>
          <ol className="bg-card border-line shadow-card space-y-1 rounded-2xl border p-2">
            {filteredSteps.map((s, i) => (
              <li
                key={s.title}
                className="hover:bg-bg-soft/60 flex items-start gap-3 rounded-lg px-3 py-2.5 transition"
              >
                <span className="bg-primary text-white shadow-primary-glow mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-foreground text-[13px] font-bold break-keep">{s.title}</h3>
                    <a
                      href={s.href}
                      className="text-primary hover:bg-primary-soft ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition"
                    >
                      {s.hrefLabel} <EyIcon name="arrowRight" size={11} />
                    </a>
                  </div>
                  <p className="text-text-dim mt-1 text-[12px] leading-relaxed break-keep">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          {!q ? (
            <p className="text-text-faint mt-2 flex items-start gap-1.5 px-1 text-[11px] leading-relaxed break-keep">
              <EyIcon name="info" size={13} className="mt-0.5 shrink-0" />
              <span>메뉴를 누르면 <b>창</b>으로 열립니다. 여러 메뉴를 동시에 띄워두고, 창을 화면 가장자리로 끌면 나란히 볼 수
              있어요. 최소화해도 작업 상태는 그대로 보존됩니다.
              </span>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* 메뉴 가이드 */}
      {filteredMenus.length > 0 ? (
        <section>
          <header className="mb-3">
            <p className="micro">{menus.length}개 메뉴 안내</p>
            <h2 className="text-foreground mt-0.5 text-[17px] font-bold">기능 한눈에 보기</h2>
          </header>
          {/* 동질 목록(메뉴)은 개별 카드로 과박싱하지 않고 한 컨테이너 안 리스트로(영역 구분 규약: 과적용 금지, FAQ와 동일 톤). */}
          <div className="bg-card border-line shadow-card grid grid-cols-1 gap-1 rounded-2xl border p-2 sm:grid-cols-2">
            {filteredMenus.map((m) => {
              const iconName = MENU_ICON[m.id];
              return (
                <div
                  key={m.href}
                  className="hover:bg-bg-soft/60 flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition"
                >
                  <span className="bg-primary-soft text-primary inline-flex size-7 shrink-0 items-center justify-center rounded-md">
                    <EyIcon name={iconName} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground text-[13px] font-bold break-keep">{m.label}</h3>
                    <p className="text-text-dim mt-1 text-[12px] leading-relaxed break-keep">{m.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* FAQ */}
      {filteredFaq.length > 0 ? (
        <section>
          <header className="mb-3">
            <p className="micro">FAQ</p>
            <h2 className="text-foreground mt-0.5 text-[17px] font-bold">자주 묻는 질문</h2>
          </header>
          <div className="bg-card border-line divide-line shadow-card divide-y rounded-2xl border">
            {filteredFaq.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="text-foreground flex cursor-pointer items-center justify-between text-[13px] font-bold">
                  <span className="break-keep">{item.q}</span>
                  <EyIcon
                    name="plus"
                    size={16}
                    className="text-text-dim ml-2 shrink-0 transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  />
                </summary>
                <p className="text-text-dim mt-3 text-[12px] leading-relaxed break-keep">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
