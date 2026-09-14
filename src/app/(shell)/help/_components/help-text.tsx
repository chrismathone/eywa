"use client";

import { createContext, useContext, type ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { tokenizeHelp } from "@/features/help/link-terms";

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
 * 설명 글 속의 화면 이름에 하이라이트를 걸어 그 설명서로 이동한다.
 * 지금 보고 있는 화면 이름은 색만 남기고 누르지 않는다.
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
        return (
          <WindowLink
            key={i}
            href={`/help/${t.slug}`}
            className="bg-primary-soft text-primary rounded-sm px-0.5 font-medium break-keep hover:underline"
          >
            {t.label}
          </WindowLink>
        );
      })}
    </>
  );
}
