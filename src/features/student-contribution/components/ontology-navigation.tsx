"use client";
import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
type Navigation = { pending: boolean; navigate: (href: string) => void };
const Context = createContext<Navigation | null>(null);

/** One transition prevents a filter, month or scope click from racing another control's navigation. */
export function OntologyNavigation({ children }: { children: ReactNode }) {
  const router = useRouter(), [pending, start] = useTransition();
  const navigate = (href: string) => { if (!pending) start(() => router.push(href, { scroll: false })); };
  return <Context.Provider value={{ pending, navigate }}>
    <div aria-busy={pending} className="min-w-0">
      {pending && <p role="status" className="mb-3 text-sm text-primary">선택한 조건으로 기록을 불러오는 중…</p>}
      <div inert={pending} className={pending ? "opacity-70" : undefined} onClickCapture={(event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        const href = anchor?.getAttribute("href");
        if (!href?.startsWith("/student-contribution/ontology?") || anchor?.target === "_blank") return;
        event.preventDefault(); event.stopPropagation(); navigate(href);
      }}>{children}</div>
    </div>
  </Context.Provider>;
}

export function useOntologyNavigation(): Navigation {
  const context = useContext(Context), router = useRouter(), [pending, start] = useTransition();
  return context ?? { pending, navigate: (href) => start(() => router.push(href, { scroll: false })) };
}
