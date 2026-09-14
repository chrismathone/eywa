"use client";

import type { ReactNode } from "react";
import { EyIcon, MENU_ICON } from "@/components/icons/eywa-icons";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { WindowLink, windowIdForHref } from "@/components/workspace/window-link";
import type { HelpGroup, HelpManual } from "@/features/help/types";
import { HelpText } from "./_components/help-text";
import { OpenScreenArrow } from "./_components/open-screen";
import { useHelpQuery } from "./_help-search";

type FaqItem = { q: string; a: string };
type QuickStep = { title: string; desc: string; href: string; hrefLabel: string };

const GROUP_ORDER: HelpGroup[] = ["창", "홈", "수업", "원생", "운영", "지원"];

function MenuLink({
  href,
  className,
  arrow,
  children,
}: {
  href: string;
  className: string;
  arrow: ReactNode;
  children: ReactNode;
}) {
  const inFrame = useInFrame();
  if (inFrame && !windowIdForHref(href)) return <span>{children}</span>;
  return (
    <WindowLink href={href} frameTarget="window" className={className}>
      {children} {arrow}
    </WindowLink>
  );
}

export function HelpBrowser({
  faq,
  quickstart,
  manuals,
}: {
  faq: FaqItem[];
  quickstart: QuickStep[];
  manuals: HelpManual[];
}) {
  const query = useHelpQuery();
  const q = query.trim().toLowerCase();
  const hit = (s: string) => s.toLowerCase().includes(q);

  const filteredSteps = q ? quickstart.filter((s) => hit(`${s.title} ${s.desc}`)) : quickstart;
  const filteredFaq = q ? faq.filter((f) => hit(`${f.q} ${f.a}`)) : faq;
  const filteredManuals = q
    ? manuals.filter((m) =>
        hit(
          `${m.title} ${m.summary} ${m.callouts.map((c) => `${c.label} ${c.body}`).join(" ")}`,
        ),
      )
    : manuals;
  const noResults =
    q.length > 0 &&
    filteredSteps.length === 0 &&
    filteredFaq.length === 0 &&
    filteredManuals.length === 0;

  return (
    <>
      {noResults ? (
        <section className="bg-card shadow-card rounded-2xl p-10 text-center">
          <p className="text-foreground text-sm font-bold">&lsquo;{query}&rsquo; 검색 결과가 없습니다</p>
          <p className="text-text-dim mt-1 text-xs">다른 검색어를 입력하거나 검색어를 지워보세요.</p>
        </section>
      ) : null}

      <nav aria-label="도움말 목차" className="flex flex-wrap gap-2 border-b border-line pb-2">
        {filteredSteps.length > 0 && <a href="#help-start" className="inline-flex h-(--control-h) items-center rounded-md border border-line px-2 text-sm hover:bg-primary-soft">빠른 시작 {filteredSteps.length}</a>}
        {filteredManuals.length > 0 && <a href="#help-guides" className="inline-flex h-(--control-h) items-center rounded-md border border-line px-2 text-sm hover:bg-primary-soft">화면 설명서 {filteredManuals.length}</a>}
        {filteredFaq.length > 0 && <a href="#help-faq" className="inline-flex h-(--control-h) items-center rounded-md border border-line px-2 text-sm hover:bg-primary-soft">자주 묻는 질문 {filteredFaq.length}</a>}
      </nav>

      {filteredSteps.length > 0 ? (
        <section id="help-start" className="scroll-mt-3">
          <header className="mb-3">
            <p className="micro">처음이신가요?</p>
            <h2 className="text-foreground mt-0.5 text-lg font-bold">빠른 시작 — 이 순서로 준비하세요</h2>
          </header>
          <ol className="bg-card shadow-card space-y-1 rounded-2xl p-2">
            {filteredSteps.map((s) => (
              <li key={s.title} className="hover:bg-bg-soft/60 flex items-start gap-3 rounded-lg px-3 py-2.5">
                <span className="bg-primary mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white tabular-nums">
                  {quickstart.indexOf(s) + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-foreground text-sm font-bold break-keep">{s.title}</h3>
                    <MenuLink
                      href={s.href}
                      className="text-primary hover:bg-primary-soft ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
                      arrow={<EyIcon name="arrowRight" size={11} />}
                    >
                      {s.hrefLabel}
                    </MenuLink>
                  </div>
                  <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">
                    <HelpText text={s.desc} />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {filteredManuals.length > 0 ? (
        <section id="help-guides" className="scroll-mt-3">
          <header className="mb-3">
            <p className="micro">{filteredManuals.length}개 화면</p>
            <h2 className="text-foreground mt-0.5 text-lg font-bold">화면 설명서 — 버튼마다 번호</h2>
            <p className="text-text-dim mt-1 text-sm break-keep">
              제목을 누르면 그 화면의 번호 설명서입니다. 글 속의 <HelpText text="시간표" /> 같은 말은 다른
              설명서로 바로 갑니다. ↗는 실제 화면 창입니다.
            </p>
          </header>
          <div className="space-y-4">
            {GROUP_ORDER.map((group) => {
              const items = filteredManuals.filter((m) => m.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <h3 className="text-text-dim mb-1 px-1 text-xs font-bold">{group}</h3>
                  <div className="bg-card shadow-card grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-1 rounded-2xl p-2">
                    {items.map((m) => {
                      const iconName = m.menuKey ? MENU_ICON[m.menuKey] : "help";
                      return (
                        <div key={m.slug} className="hover:bg-bg-soft/60 flex items-start gap-2.5 rounded-lg px-3 py-2.5">
                          <span className="bg-primary-soft text-primary inline-flex size-7 shrink-0 items-center justify-center rounded-md">
                            <EyIcon name={iconName} size={14} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-1">
                              <h4 className="text-foreground min-w-0 text-sm font-bold break-keep">
                                <WindowLink href={`/help/${m.slug}`} className="hover:text-primary hover:underline">
                                  {m.title}
                                </WindowLink>
                              </h4>
                              {m.href !== "/help" ? <OpenScreenArrow href={m.href} label={m.title} /> : null}
                            </div>
                            <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">
                              <HelpText text={m.summary} />
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {filteredFaq.length > 0 ? (
        <section id="help-faq" className="scroll-mt-3">
          <header className="mb-3">
            <p className="micro">FAQ</p>
            <h2 className="text-foreground mt-0.5 text-lg font-bold">자주 묻는 질문</h2>
          </header>
          <div className="bg-card divide-line shadow-card divide-y rounded-2xl">
            {filteredFaq.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="text-foreground flex cursor-pointer items-center justify-between text-sm font-bold">
                  <span className="break-keep">{item.q}</span>
                  <EyIcon name="plus" size={16} className="text-text-dim ml-2 shrink-0 transition-transform group-open:rotate-45" aria-hidden="true" />
                </summary>
                <p className="text-text-dim mt-3 text-xs leading-relaxed break-keep">
                  <HelpText text={item.a} />
                </p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
