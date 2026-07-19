import type { ReactNode } from "react";

/**
 * PageHeader — Editorial 문법 ①(eyebrow→헤드라인→서브)의 단일 소스.
 * 창(iframe) 스케일: eyebrow 12px / 타이틀 21px / 서브 13px — 블로그의 36px급을 운영 도구로 축소 이식.
 * 기존 소비처 {title, description, actions}와 하위호환 — eyebrow/stats는 opt-in 슬롯.
 * stats에는 BigStat 그리드(문법 ②)를 끼운다. 구분선(border-b) 대신 여백 리듬(문법 ⑥).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  stats,
}: {
  /** 상단 소라벨(문법 ①) — 예: "학생 관리". 한글 전제, uppercase 없음. */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** 헤더 아래 붙는 BigStat 행 슬롯(문법 ②). */
  stats?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="editorial-eyebrow">{eyebrow}</p> : null}
          <h2
            className={`text-foreground text-[21px] font-extrabold tracking-tight ${eyebrow ? "mt-1" : ""}`}
          >
            {title}
          </h2>
          {description ? <p className="text-text-dim mt-1 text-[13px]">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {stats ?? null}
    </header>
  );
}
