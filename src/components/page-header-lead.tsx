/**
 * PageHeader 한 줄의 앞머리 — `eyebrow - 제목`(설명은 PageHeader가 뒤에 붙인다). 훅이 없는 그림 조각이라 서버(Suspense 폴백)와
 * 클라([`MenuPageLead`](../features/owner/menu-page-title.tsx) — 사이드바 그룹·메뉴 이름을 읽는 쪽)가 같은 마크업을 쓴다.
 * 🔴 이 파일엔 `"use client"`를 붙이지 말 것 — 서버 PageHeader가 폴백으로 직접 그린다([[#81]]).
 *
 * `data-page-header-extra` = 화면 최대화 중 숨는 조각(eyebrow·구분자·설명) — 최대화 중 머리글은 **제목 + 오른쪽 버튼** 한 줄만
 * 남는다(globals.css `[data-page-maximize="on"]`). 제목은 남긴다: 사이드바가 숨어 "지금 어느 화면인가"를 알려 줄 곳이 여기뿐이다.
 */
import { SheetText } from "@/features/teacher-view/interface-label";

export function PageHeaderLead({
  eyebrow,
  title,
  hasCompactLabel,
}: {
  /** 이미 정해진 앞부분(사이드바 그룹 → 폴백, 제목과 같으면 `undefined`). */
  eyebrow: string | undefined;
  title: string;
  /** 창·모바일 컴팩트 행에 설명·embedLabel이 있어 제목을 접는가(PageHeader가 판정). */
  hasCompactLabel: boolean;
}) {
  return (
    <>
      {eyebrow ? (
        <p data-page-header-extra="" className="text-foreground text-sm font-medium whitespace-nowrap compact-chrome:hidden">
          <SheetText value={eyebrow} />
        </p>
      ) : null}
      <div className={`flex items-baseline gap-x-2 ${hasCompactLabel ? "compact-chrome:hidden" : ""}`}>
        {eyebrow ? <HeaderSeparator /> : null}
        <h2
          className={`text-foreground text-xl font-bold tracking-tight ${
            hasCompactLabel
              ? ""
              : "compact-chrome:text-text-dim compact-chrome:text-sm compact-chrome:font-medium compact-chrome:tracking-normal"
          }`}
        >
          <SheetText value={title} />
        </h2>
      </div>
    </>
  );
}

/** 한 줄 헤더의 구분자 ` - ` — 앞뒤 간격은 묶음의 `gap-x-2`. 창·모바일(컴팩트)에선 라벨이 하나뿐이라 숨는다. 읽지 않는다. */
export function HeaderSeparator() {
  return (
    <span data-page-header-extra="" aria-hidden className="text-foreground text-sm font-medium compact-chrome:hidden">
      -
    </span>
  );
}
