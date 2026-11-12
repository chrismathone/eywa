"use client";
import { useLinkStatus } from "next/link";

export function ContributionNavigationHint({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span className="relative" aria-busy={pending}>
    <span className={pending ? "opacity-60" : undefined}>{label}</span>
    {pending && <><span aria-hidden className="absolute -bottom-1 left-0 h-0.5 w-full animate-pulse bg-current" /><span role="status" className="sr-only">{label} 불러오는 중</span></>}
  </span>;
}
