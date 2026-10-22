import type { ReactNode } from "react";

/**
 * 원생 통계 화면의 카드 껍데기 — `id`는 운영실 '상세'가 여는 자리(`/students/stats#trend`).
 * 머리 = 제목 + 기준(무엇을·언제 기준으로 셌나) + 오른쪽 조작. 실패는 0이 아니라 '못 불러옴'으로 적는다.
 */
export function StatCard({
  id,
  title,
  note,
  tools,
  error = false,
  className = "",
  children,
}: {
  id: string;
  title: string;
  note: ReactNode;
  tools?: ReactNode;
  error?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className={`border-line scroll-mt-4 space-y-3 rounded-2xl border p-3 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-bold">{title}</h2>
          <p className="text-muted-foreground text-xs break-keep">{note}</p>
        </div>
        {tools ? <div className="flex flex-wrap items-center gap-2">{tools}</div> : null}
      </header>
      {error ? (
        <p className="text-danger text-sm" role="status">
          불러오지 못했습니다 · 0이라는 뜻이 아닙니다. 새로고침하면 다시 조회합니다.
        </p>
      ) : (
        children
      )}
    </section>
  );
}
