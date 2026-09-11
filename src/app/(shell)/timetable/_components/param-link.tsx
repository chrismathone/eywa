"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { confirmTimetableNav } from "./timetable-unsaved";

/**
 * 시간표 searchParam 토글(과목·구분·뷰·주·표시설정) 전용 무플래시 네비.
 *
 * 🔴 왜(원장 2026-07-27 "과목전환이 왜 이렇게 느릴까 / 페이지 내 이동이 원활하게"): `<Link>`로
 * searchParam만 바꿔도 App Router가 세그먼트를 다시 렌더하며 `loading.tsx` 스켈레톤을 띄운다(B7 트레이드오프).
 * 서버가 새 데이터를 만드는 1~3초 동안 **멀쩡히 보이던 시간표가 스켈레톤으로 지워졌다 다시 그려져**
 * 체감이 최악이었다. `startTransition` + `router.push`로 감싸면 React가 **이전 화면을 유지**한 채 백그라운드로
 * 새 RSC를 받아와 교체한다 — 클릭한 칩만 pulse로 "가는 중"을 표시.
 *
 * ⚠️ 첫 진입(창 열기)은 여전히 `loading.tsx`가 맞다(보여줄 이전 화면이 없음) — 이 컴포넌트는 **이미 화면이
 * 있는 상태의 파라미터 전환**에만 쓸 것. 새 페이지 이동(다른 라우트)엔 그냥 `<Link>`.
 *
 * 접근성/브라우저 기본: 실제 `<a href>`라 중클릭·Ctrl+클릭(새 탭)·우클릭 복사·포커스가 전부 보존된다 —
 * 수식키가 눌린 클릭은 preventDefault 없이 브라우저에 넘긴다.
 */
export function ParamLink({
  href,
  className,
  children,
  ariaLabel,
  title,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
}) {
  const router = useRouter();
  const embed = useEmbed();
  const [pending, start] = useTransition();
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      title={title}
      aria-busy={pending || undefined}
      className={`${className ?? ""} ${pending ? "animate-pulse opacity-60" : ""}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // 새 탭 등 보존
        e.preventDefault();
        // 그룹 설정에서 아직 반영 안 한 배치가 있으면 확인부터 — 주·과목·구분·뷰 전환이 전부 여기를
        // 지나므로 한 곳만 막으면 된다(원장 2026-08-06 "편집중에 주 과목 뷰 바꿀때도 경고").
        if (!confirmTimetableNav()) return;
        // 창(iframe) 안이면 embed=1을 싣는다(PeriodNav·FaceTabs와 같은 규칙) — 빼면 뒤이은 새로고침이 창 안에
        // 전체 셸을 그린다. `<a href>`(새 탭 = 최상위)는 원래 주소 그대로 둔다.
        start(() => router.push(embed ? withEmbed(href) : href, { scroll: false }));
      }}
    >
      {children}
    </a>
  );
}
