"use client";
import { createContext, useContext, useEffect, useRef, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmbedLink } from "@/components/embed-link";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { studentContributionHref } from "../model/student-route";
type Scope = { resolve: (href: string) => string; navigate: (href: string) => void; pending: boolean };
const Context = createContext<Scope | null>(null);
export const useStudentContributionScope = () => useContext(Context);

export function StudentContributionScope({ studentId, back, children }: { studentId: string; back?: string; children: ReactNode }) {
  const router = useRouter(), embed = useEmbed(), [pending, start] = useTransition();
  const content = useRef<HTMLDivElement>(null), focus = useRef<HTMLElement | SVGElement | null>(null), moved = useRef(false);
  useEffect(() => {
    if (pending || !moved.current) return;
    moved.current = false;
    const target = focus.current?.isConnected ? focus.current : content.current?.querySelector<HTMLElement>('nav a[aria-current="page"]');
    target?.focus({ preventScroll: true }); focus.current = null;
  }, [pending]);
  const resolve = (href: string) => { const path = studentContributionHref(href, studentId, back); return embed ? withEmbed(path) : path; };
  const navigate = (href: string) => { if (!pending) {
    const active = document.activeElement;
    focus.current = active && content.current?.contains(active) ? active as HTMLElement | SVGElement : null; moved.current = true;
    start(() => router.push(resolve(href), { scroll: false }));
  } };
  return <Context.Provider value={{ resolve, navigate, pending }}>
    <div aria-busy={pending} className="relative min-w-0">
      {pending && <p role="status" className="sticky top-0 z-10 rounded border border-line bg-card px-4 py-2 text-sm text-primary">선택한 내용을 불러오는 중…</p>}
      <div ref={content} inert={pending}>{children}</div>
    </div>
  </Context.Provider>;
}

export function ContributionLink({ href, onClick, ...props }: ComponentProps<typeof EmbedLink>) {
  const scope = useStudentContributionScope();
  return <EmbedLink {...props} href={scope?.resolve(href) ?? href} onClick={(event) => {
    onClick?.(event);
    if (!scope || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (props.target && props.target !== "_self")) return;
    if (!href.startsWith("/student-contribution")) return;
    event.preventDefault(); scope.navigate(href);
  }} />;
}
