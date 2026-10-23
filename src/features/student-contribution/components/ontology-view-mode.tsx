import { EmbedLink as Link } from "@/components/embed-link";

export function OntologyViewMode({ current, month }: { current: boolean; month?: string }) {
  return <nav aria-label="연결 기록의 기준" className="flex flex-wrap gap-2">
    {[[true, "현재 수강 연결", "/student-contribution/ontology?view=current"],
      [false, "월별 기여도 근거", `/student-contribution/ontology${month ? `?month=${month}` : ""}`]].map(([isCurrent, label, href]) =>
      <Link key={String(isCurrent)} href={String(href)} prefetch={false} aria-current={current === isCurrent ? "page" : undefined}
        className={`rounded-lg border px-4 py-2 text-sm ${current === isCurrent ? "border-primary bg-primary-softer font-semibold text-primary" : "border-line hover:bg-secondary"}`}>{label}</Link>)}
  </nav>;
}
