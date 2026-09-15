"use client";

import { createContext, useContext, type ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { tokenizeHelp } from "@/features/help/link-terms";
import { manualBySlug } from "@/features/help/manuals";

const AllowCtx = createContext<ReadonlySet<string> | undefined>(undefined);

export function HelpAllowProvider({
  slugs,
  children,
}: {
  slugs: readonly string[];
  children: ReactNode;
}) {
  return <AllowCtx.Provider value={new Set(slugs)}>{children}</AllowCtx.Provider>;
}

/**
 * 설명 글 속의 화면 이름에 하이라이트를 걸어 **실제 화면 창**으로 연다.
 * 화면별 설명서는 F1 겹침이 맡고, 도움말 허브의 `/help/<slug>` 는 걷었다.
 * 이 사람이 열 수 없는 화면은 하이라이트하지 않는다.
 */
export function HelpText({
  text,
  currentSlug,
  allowedSlugs,
}: {
  text: string;
  currentSlug?: string;
  allowedSlugs?: ReadonlySet<string>;
}) {
  const ctx = useContext(AllowCtx);
  const tokens = tokenizeHelp(text, currentSlug, allowedSlugs ?? ctx);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "text") return <span key={i}>{t.value}</span>;
        if (t.current) {
          return (
            <mark
              key={i}
              className="text-foreground bg-transparent p-0 font-bold"
            >
              {t.label}
            </mark>
          );
        }
        const href = manualBySlug(t.slug)?.href;
        if (!href) return <span key={i}>{t.label}</span>;
        return (
          <WindowLink
            key={i}
            href={href}
            frameTarget="window"
            className="bg-primary-soft text-primary rounded-sm px-0.5 font-medium break-keep hover:underline"
          >
            {t.label}
          </WindowLink>
        );
      })}
    </>
  );
}
