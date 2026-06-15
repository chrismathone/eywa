"use client";

import { useState } from "react";
import { EyIcon, MENU_ICON, type EywaIconName } from "@/components/icons/eywa-icons";

type MenuItem = { id: string; label: string; href: string; description: string };
type FaqItem = { q: string; a: string };

export function HelpBrowser({ menus, faq }: { menus: MenuItem[]; faq: FaqItem[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filteredMenus = q
    ? menus.filter((m) => `${m.label} ${m.description}`.toLowerCase().includes(q))
    : menus;
  const filteredFaq = q
    ? faq.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(q))
    : faq;
  const noResults = q.length > 0 && filteredMenus.length === 0 && filteredFaq.length === 0;

  return (
    <>
      {/* Search hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#2a7a52] p-8 text-white shadow-primary-deep">
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
          <p className="font-mono text-[11px] tracking-wider uppercase text-[#e9c876]">
            HELP CENTER
          </p>
          <h1 className="mt-2 text-[28px] font-extrabold leading-tight">무엇을 도와드릴까요?</h1>
          <p className="mt-2 text-[13px] text-white/85">
            {menus.length}개 메뉴 가이드와 자주 묻는 질문을 한 곳에 모았어요.
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 backdrop-blur-sm">
            <EyIcon name="search" size={15} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="메뉴·FAQ 검색 (예: 출석, AI 분석)"
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
                ✕
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {noResults ? (
        <section className="bg-card border-line shadow-card rounded-2xl border p-10 text-center">
          <p className="text-foreground text-sm font-bold">
            &lsquo;{query}&rsquo; 검색 결과가 없습니다
          </p>
          <p className="text-text-dim mt-1 text-xs">다른 검색어를 입력하거나 검색어를 지워보세요.</p>
        </section>
      ) : null}

      {/* 메뉴 가이드 */}
      {filteredMenus.length > 0 ? (
        <section>
          <header className="mb-3">
            <p className="micro">{menus.length}개 메뉴 가이드</p>
            <h2 className="text-foreground mt-0.5 text-[17px] font-bold">기능 한눈에 보기</h2>
          </header>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredMenus.map((m) => {
              const iconName: EywaIconName = MENU_ICON[m.id] ?? "spore";
              return (
                <article
                  key={m.href}
                  className="bg-card border-line shadow-card rounded-2xl border p-4"
                >
                  <header className="flex items-center gap-2">
                    <span className="bg-primary-soft text-primary inline-flex size-7 items-center justify-center rounded-md">
                      <EyIcon name={iconName} size={14} />
                    </span>
                    <h3 className="text-foreground text-[13px] font-bold">{m.label}</h3>
                    <span className="text-text-faint ml-auto font-mono text-[10px]">{m.href}</span>
                  </header>
                  <p className="text-text-dim mt-2 text-[12px] leading-relaxed">{m.description}</p>
                </article>
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
                  <span>{item.q}</span>
                  <span className="text-text-dim ml-2 text-lg transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="text-text-dim mt-3 text-[12px] leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
