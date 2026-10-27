"use client";

import { usePathname } from "next/navigation";

/**
 * 학부모 화면 가로 탭(5칸) — 로그아웃 아래, 각 섹션 제목 위.
 *
 * 🔑 칸 = 섹션 주소 하나. 누르면 그 섹션 화면으로 넘어간다(링크 — 폰에서 상태 없이 전체 새로 그림).
 * 🔑 5칸은 **자리만** 잡아 둔다(사용자 2026-09-26 "일단 비워주고" · 4칸은 2026-10-22 가까운 노선 찾기로 채움) — 누를 수 없고 글자도 없다.
 *    기능이 생기면 `href`와 `label`만 채운다.
 * 🔑 `lines`는 긴 이름을 **정한 자리에서** 두 줄로 끊는다(자동 줄바꿈이면 '등하원 / 시간 변경· / 확인'
 *    세 줄로 꺾였다). 그런 칸만 글자를 한 단계 줄이고(xs=14px, 앱 최소 글자) 자간을 좁힌다 — 다른 칸은 그대로.
 * 활성 판정은 경로 접두 — `/parent/rides?day=tue`도 '등하원 시간 변경·확인'이 켜진다.
 */
export const PARENT_TABS: { key: string; label: string; lines?: [string, string]; href: string | null }[] = [
  { key: "live", label: "실시간 차량", href: "/parent/live" },
  { key: "rides", label: "등하원 시간 변경·확인", lines: ["등하원 시간", "변경·확인"], href: "/parent/rides" },
  { key: "classes", label: "수업 시간표", href: "/parent/classes" },
  // 4칸 = 가까운 노선 찾기(사용자 2026-10-22 "학부모가 위치를 던지면 가까운 노선을 찾을 수 있게 · 4번째 칸").
  { key: "nearby", label: "가까운 노선 찾기", lines: ["가까운", "노선 찾기"], href: "/parent/nearby" },
  { key: "slot5", label: "", href: null },
];

export function ParentTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="학부모 메뉴" className="grid grid-cols-5 gap-1.5">
      {PARENT_TABS.map((t) => {
        if (!t.href) {
          return <span key={t.key} aria-hidden className="border-line min-h-14 rounded-xl border border-dashed" />;
        }
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <a
            key={t.key}
            href={t.href}
            aria-label={t.label}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 items-center justify-center rounded-xl py-2 text-center leading-tight font-bold break-keep ${
              t.lines ? "px-0.5 text-xs tracking-tight" : "px-1 text-sm"
            } ${active ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-[var(--shadow-card)]"}`}
          >
            {t.lines ? (
              <span aria-hidden className="flex flex-col">
                {t.lines.map((line) => (
                  <span key={line} className="whitespace-nowrap">
                    {line}
                  </span>
                ))}
              </span>
            ) : (
              t.label
            )}
          </a>
        );
      })}
    </nav>
  );
}
