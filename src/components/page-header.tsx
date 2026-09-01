import type { ReactNode } from "react";

/**
 * PageHeader — Editorial 문법 ①(eyebrow→헤드라인→서브)의 단일 소스.
 * 창(iframe) 스케일: eyebrow 12px / 타이틀 21px / 서브 13px — 블로그의 36px급을 운영 도구로 축소 이식.
 * 기존 소비처 {title, description, actions}와 하위호환 — eyebrow/stats는 opt-in 슬롯.
 * stats에는 BigStat 그리드(문법 ②)를 끼운다. 구분선(border-b) 대신 여백 리듬(문법 ⑥).
 *
 * ⚠️ 임베드(플로팅 창, ?embed=1) 컴팩트 모드(2026-07-19 원장 지적 — "창 안 헤더가 본문을 잠식 +
 * 제목 3중 노출(상단 바·창 타이틀바·인페이지)"): 창 안에선 **창 타이틀바가 제목**이므로
 * eyebrow·21px 헤드라인을 접고 embedLabel ?? description(?? title)을 13px 한 줄로 — actions와 같은 행.
 *
 * ⚠️ 판정은 요청 헤더(x-embed)가 아니라 **임베드 셸 <main>의 `.embed-main` 마커 + CSS 변형**이다
 * (적대 리뷰 major): x-embed는 요청 단위라 창 안 내비(주 이동·월 이동 등, 대다수 href 빌더가
 * embed=1 미보존)마다 풀 헤더로 플립했다. layout의 임베드 <main>은 soft nav에서 재렌더되지 않아
 * 마커가 유지되고, 단일 마크업이라 actions/stats 슬롯 이중 마운트(#67류)도 없다. 서버 렌더 시점에
 * 클래스가 이미 확정돼 하이드레이션 플래시도 없음. 최상위 프레임(모바일 라우트·직접 방문)은
 * 마커가 없어 Editorial 풀 헤더 그대로다.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  embedLabel,
  actions,
  stats,
}: {
  /** 상단 소라벨(문법 ①) — 예: "학생 관리". 한글 전제, uppercase 없음. */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /**
   * 임베드 컴팩트 행의 라벨 명시 지정(기본 description ?? title). title이 메뉴명이 아니라
   * **콘텐츠**(수납의 "2026년 7월" 등)라 컴팩트 행에서 사라지면 안 되거나, description이
   * 길어 창 안에서 여러 줄로 감길 때 짧은 대체 문구로 쓴다.
   */
  embedLabel?: ReactNode;
  actions?: ReactNode;
  /** 헤더 아래 붙는 BigStat 행 슬롯(문법 ②). */
  stats?: ReactNode;
}) {
  // 컴팩트 행 라벨이 desc/embedLabel로 이미 있으면 임베드에선 title을 숨긴다(타이틀바와 중복).
  // 없으면 title 자체를 13px dim으로 강등해 라벨로 쓴다(빈 행 방지 — 미래 소비처 안전망).
  const hasCompactLabel = Boolean(embedLabel ?? description);
  return (
    // 🔴 **상단 헤더와 본문 사이 가벼운 구분선 하나**(원장 2026-09-01: *"상단 헤더랑 본문 사이에
    //    '구분선' 하나만 가볍게 넣어줘"* + *"이 구분선 스타일은 웹앱 전체에 통일"*).
    //    ⚠️ 종전 규약은 "구분선 대신 여백 리듬"이었다 — 원장이 명시로 뒤집은 것이라, 화면마다 자기
    //    선을 새로 긋지 말고 **여기 한 줄**만 쓴다(굵기·색이 갈리면 통일이 아니다).
    //    가장 옅은 선(`--line-faint`)이다: 존재를 알리되 칸 테두리·표 선보다 앞서지 않는다.
    <header className="border-line-faint flex flex-col gap-4 border-b pb-3 compact-chrome:gap-3 compact-chrome:pb-2">
      <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between compact-chrome:flex-row compact-chrome:flex-wrap compact-chrome:items-baseline compact-chrome:gap-x-3 compact-chrome:gap-y-1">
        <div className="min-w-0 compact-chrome:flex compact-chrome:min-w-0 compact-chrome:flex-wrap compact-chrome:items-baseline compact-chrome:gap-x-2">
          {eyebrow ? <p className="editorial-eyebrow compact-chrome:hidden">{eyebrow}</p> : null}
          <h2
            className={`text-foreground text-[21px] font-bold tracking-tight ${eyebrow ? "mt-1" : ""} ${
              hasCompactLabel
                ? "compact-chrome:hidden"
                : "compact-chrome:text-text-dim compact-chrome:mt-0 compact-chrome:text-[13px] compact-chrome:font-normal compact-chrome:tracking-normal"
            }`}
          >
            {title}
          </h2>
          {description ? (
            <div
              className={`text-text-dim mt-1 text-[13px] ${
                embedLabel ? "compact-chrome:hidden" : "compact-chrome:mt-0"
              }`}
            >
              {description}
            </div>
          ) : null}
          {embedLabel ? (
            <div className="text-text-dim hidden text-[13px] compact-chrome:block">{embedLabel}</div>
          ) : null}
        </div>
        {actions ? (
          // 임베드에선 shrink/wrap 허용 — actions로 들어온 툴바(문서 검색 등)의 내부 flex-wrap이
          // 좁은 창에서 실제로 발동하게(shrink-0 고정이면 max-content 폭이 창을 뚫음, 적대 리뷰).
          <div className="flex shrink-0 items-center gap-2 compact-chrome:min-w-0 compact-chrome:shrink compact-chrome:flex-wrap">
            {actions}
          </div>
        ) : null}
      </div>
      {stats ?? null}
    </header>
  );
}
