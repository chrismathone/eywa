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
 * 설명 글 속의 화면 이름에 하이라이트를 걸어 **그 화면의 설명서**(`/help/<slug>`)로 이동한다.
 * 지금 보고 있는 화면 이름은 색만 남기고 누르지 않는다. 이 사람이 열 수 없는 화면은 하이라이트하지 않는다.
 *
 * 🔴 **실제 화면으로 보내지 말 것** — 설명서를 읽던 사람이 글 한 줄 눌렀다고 업무 화면으로 튕기면 읽던 자리를
 * 잃는다. 실제 화면은 목록의 `↗`와 설명서 머리의 '이 화면 열기'가 맡는다(둘의 역할이 갈려 있다).
 * 09-15에 `/help/<slug>`를 걷으면서 잠시 화면으로 보냈다가, 설명서 목록을 되살리며 원래대로 돌렸다.
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
        // 설명서가 없는 말은 링크로 만들지 않는다(빈 페이지로 보내는 것보다 글자로 두는 게 낫다).
        if (!manualBySlug(t.slug)) return <span key={i}>{t.label}</span>;
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
