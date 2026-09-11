"use client";

import type { ReactNode } from "react";
import { EyIcon, MENU_ICON } from "@/components/icons/eywa-icons";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { WindowLink, windowIdForHref } from "@/components/workspace/window-link";
import type { MenuKey } from "@/lib/permissions";
import { useHelpQuery } from "./_help-search";

type MenuItem = { id: MenuKey; label: string; href: string; description: string };
type FaqItem = { q: string; a: string };
type QuickStep = { title: string; desc: string; href: string; hrefLabel: string };

/**
 * 도움말 안의 메뉴 링크 — 이 화면은 **"메뉴를 누르면 창으로 열립니다"**라고 약속한다. 그래서 창 안에서 눌러도
 * 도움말 창을 그 화면으로 바꾸지 않고 **부모 작업면에 그 메뉴 창**을 연다(`frameTarget="window"`). 맨 `<a href>`였을 땐
 * 도움말 창이 통째로 그 메뉴 화면이 되고 embed까지 빠져 창 안에 전체 셸이 떴다(2026-09-11 전수검사).
 * 🔴 창이 될 수 없는 목적지(대시보드 = 이 창 **뒤의 배경**)는 창 안에선 링크를 걸지 않는다 — 걸면 배경 화면이
 *    도움말 창 안에 뜬다. 최상위 프레임(폰·강사 미니셸)에선 평소처럼 이동한다.
 */
function MenuLink({
  href,
  className,
  arrow,
  children,
}: {
  href: string;
  className: string;
  /** 링크일 때만 붙는 화살표 — 글자만 남길 땐 누를 수 있어 보이면 안 된다. */
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
  menus,
  faq,
  quickstart,
}: {
  menus: MenuItem[];
  faq: FaqItem[];
  quickstart: QuickStep[];
}) {
  // 검색어는 머리의 토글(_help-search.tsx)이 든다 — 이 컴포넌트는 거르기만 한다.
  const query = useHelpQuery();
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
      {/* 옛 사진 히어로("무엇을 도와드릴까요?" + 안내 문장 + 알약 검색창 + 장식 원)는 뺐다(디자인 v5 13단계 2026-09-04 — 지시서 §4
          설명 문장·장식 금지, §10 검색은 토글, 컨트롤에 알약 금지). 제목·검색은 PageHeader(page.tsx)가 든다. */}
      {noResults ? (
        <section className="bg-card border-line shadow-card rounded-2xl border p-10 text-center">
          <p className="text-foreground text-sm font-bold">&lsquo;{query}&rsquo; 검색 결과가 없습니다</p>
          <p className="text-text-dim mt-1 text-xs">다른 검색어를 입력하거나 검색어를 지워보세요.</p>
        </section>
      ) : null}

      <nav aria-label="도움말 목차" className="flex flex-wrap gap-2 border-b border-line pb-2">
        {filteredSteps.length > 0 && <a href="#help-start" className="inline-flex h-(--control-h) items-center rounded-md border border-line px-2 text-sm hover:bg-primary-soft">빠른 시작 {filteredSteps.length}</a>}
        {filteredMenus.length > 0 && <a href="#help-menus" className="inline-flex h-(--control-h) items-center rounded-md border border-line px-2 text-sm hover:bg-primary-soft">메뉴 안내 {filteredMenus.length}</a>}
        {filteredFaq.length > 0 && <a href="#help-faq" className="inline-flex h-(--control-h) items-center rounded-md border border-line px-2 text-sm hover:bg-primary-soft">자주 묻는 질문 {filteredFaq.length}</a>}
      </nav>

      {/* 빠른 시작 — 처음 사용자를 위한 순서 */}
      {filteredSteps.length > 0 ? (
        <section id="help-start" className="scroll-mt-3">
          <header className="mb-3">
            <p className="micro">처음이신가요?</p>
            <h2 className="text-foreground mt-0.5 text-lg font-bold">빠른 시작 — 이 순서로 준비하세요</h2>
          </header>
          <ol className="bg-card border-line shadow-card space-y-1 rounded-2xl border p-2">
            {filteredSteps.map((s) => (
              <li
                key={s.title}
                className="hover:bg-bg-soft/60 flex items-start gap-3 rounded-lg px-3 py-2.5 transition"
              >
                <span className="bg-primary mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white tabular-nums">
                  {quickstart.indexOf(s) + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-foreground text-sm font-bold break-keep">{s.title}</h3>
                    <MenuLink
                      href={s.href}
                      className="text-primary hover:bg-primary-soft ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition"
                      arrow={<EyIcon name="arrowRight" size={11} />}
                    >
                      {s.hrefLabel}
                    </MenuLink>
                  </div>
                  <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          {!q ? (
            <p className="text-text-faint mt-2 flex items-start gap-1.5 px-1 text-xs leading-relaxed break-keep">
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
        <section id="help-menus" className="scroll-mt-3">
          <header className="mb-3">
            <p className="micro">{menus.length}개 메뉴 안내</p>
            <h2 className="text-foreground mt-0.5 text-lg font-bold">기능 한눈에 보기</h2>
          </header>
          {/* 동질 목록(메뉴)은 개별 카드로 과박싱하지 않고 한 컨테이너 안 리스트로(영역 구분 규약: 과적용 금지, FAQ와 동일 톤).
              열은 auto-fit — `sm:grid-cols-2`는 검색이 1건으로 좁혀지면 오른쪽 반쪽을 비워 두고, 반대로 넓은
              창에선 12개 메뉴가 2열에 갇혀 설명 옆이 텅 비었다. 여긴 행이 truncate가 아니라 **줄바꿈되는 카드**라
              열을 늘리는 게 이득(브리핑·출석 퀵오픈의 truncate 행과 반대 판단).
              하한 300px = 옛 `sm:grid-cols-2`가 640px에서 만들던 열폭(310px)보다 살짝 좁게 잡은 값 —
              **어떤 폭에서도 예전보다 열이 줄지 않게** 하려는 것(420px로 잡았더니 640~847px 구간이
              2열→1열로 퇴행해 높이가 416→818px가 됐다). */}
          <div className="bg-card border-line shadow-card grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-1 rounded-2xl border p-2">
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
                    <h3 className="text-foreground text-sm font-bold break-keep">
                      <MenuLink
                        href={m.href}
                        className="hover:text-primary hover:underline"
                        arrow={<span aria-hidden>↗</span>}
                      >
                        {m.label}
                      </MenuLink>
                    </h3>
                    <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">{m.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* FAQ */}
      {filteredFaq.length > 0 ? (
        <section id="help-faq" className="scroll-mt-3">
          <header className="mb-3">
            <p className="micro">FAQ</p>
            <h2 className="text-foreground mt-0.5 text-lg font-bold">자주 묻는 질문</h2>
          </header>
          <div className="bg-card border-line divide-line shadow-card divide-y rounded-2xl border">
            {filteredFaq.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="text-foreground flex cursor-pointer items-center justify-between text-sm font-bold">
                  <span className="break-keep">{item.q}</span>
                  <EyIcon
                    name="plus"
                    size={16}
                    className="text-text-dim ml-2 shrink-0 transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  />
                </summary>
                <p className="text-text-dim mt-3 text-xs leading-relaxed break-keep">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
