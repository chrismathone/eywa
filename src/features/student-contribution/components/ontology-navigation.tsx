"use client";
import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useStudentContributionScope } from "./student-contribution-scope";
type Navigation = { pending: boolean; navigate: (href: string) => void };
const Context = createContext<Navigation | null>(null);

/** One transition prevents a filter, month or scope click from racing another control's navigation. */
export function OntologyNavigation({ children }: { children: ReactNode }) {
  const router = useRouter(), [localPending, start] = useTransition(), scope = useStudentContributionScope();
  const pending = scope?.pending ?? localPending;
  const navigate = scope?.navigate ?? ((href: string) => { if (!pending) start(() => router.push(href, { scroll: false })); });
  return <Context.Provider value={{ pending, navigate }}>
    <div aria-busy={pending} className="min-w-0">
      {pending && !scope && <p role="status" className="mb-3 text-sm text-primary">선택한 조건으로 기록을 불러오는 중…</p>}
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

/**
 * 화면 표시 없이 이동 상태만 나눠 쓴다. 학생 상세의 차트·월 선택·정정 링크·탭이 한 이동을 함께 본다 —
 * 이동 중에 탭이 주소를 바꾸면(replaceState = 복원 동작) 라우터가 진행 중인 이동을 버리고 옛 달로 돌아간다.
 */
export function NavigationScope({ children }: { children: ReactNode }) {
  const router = useRouter(), [localPending, start] = useTransition(), scope = useStudentContributionScope();
  const pending = scope?.pending ?? localPending;
  const navigate = scope?.navigate ?? ((href: string) => { if (!pending) start(() => router.push(href, { scroll: false })); });
  return <Context.Provider value={{ pending, navigate }}>{children}</Context.Provider>;
}

export function useOntologyNavigation(): Navigation {
  const context = useContext(Context), router = useRouter(), [pending, start] = useTransition(), scope = useStudentContributionScope();
  return scope ?? context ?? { pending, navigate: (href) => start(() => router.push(href, { scroll: false })) };
}
