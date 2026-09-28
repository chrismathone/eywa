"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { signOut } from "@/app/(auth)/login/actions";
import { ADMIN_LOGIN_ID, isAdminAuthEmail } from "@/lib/auth/admin-login";
import { SUPER_ADMIN_NAV, activeSuperAdminNav } from "./nav";

/**
 * 슈퍼관리자 **데스크톱 사이드바** — 앱 관리자뷰 사이드바([`app-sidebar.tsx`](../app-sidebar.tsx))와 같은 옷을 입는다.
 *
 * 🔴 **따로 놀던 디자인을 걷어냈다**(원장 2026-09-25 *"색상 등이 기존과 너무 차이나는걸?"*): 2026-05-28 첫 구현의
 *    검정 바탕(`bg-ink`)·금색 강조·금색 빛 번짐·영문 모노 대문자(`SUPER ADMIN`·`01 · SAAS 운영`)·이름 이니셜 배지가
 *    팔레트 v3(07-19)·v4(08-18) 전환에서 빠져 이 영역만 옛 옷으로 남아 있었다. 지금은
 *    `bg-sidebar` + 오른쪽 테두리 · 활성 = `bg-primary` 네이비 · 한글 라벨 · 이니셜 배지 없음(영구 금지)이다.
 *    가드 [`super-admin-design.test.ts`](src/app/(super-admin)/super-admin-design.test.ts)가 옛 토큰 재유입을 막는다.
 * 🔑 '슈퍼관리자' 둘째 줄은 관리자뷰 사이드바의 '관리자뷰'와 **같은 자리·같은 모양**이다 — 지금 어느 화면인지를
 *    색이 아니라 글자로 말한다(색을 바꿔 구분하면 의미색 캐논이 깨진다).
 * ⚠️ 폭 216px = 관리자뷰 사이드바 기본 폭. 이메일은 한 줄 말줄임 + `title`로 전체.
 * ⚠️ 데스크톱(≥1240 + 마우스, `desk:`)에서만 보인다 — 조건은 레이아웃의 `desk:`(앱 셸과 같은 축).
 */
export function SuperAdminSidebar({
  email,
  displayName,
  className = "",
}: {
  email: string;
  displayName: string;
  className?: string;
}) {
  const pathname = usePathname() ?? "/super-admin";
  const active = activeSuperAdminNav(pathname);
  const dedicatedAdmin = isAdminAuthEmail(email);
  const accountLabel = dedicatedAdmin ? ADMIN_LOGIN_ID : email;
  return (
    <aside className={`bg-sidebar border-line h-screen w-[216px] shrink-0 flex-col border-r ${className}`}>
      <div className="border-line flex h-12 shrink-0 items-center border-b px-3">
        <Link href="/super-admin" className="flex min-w-0 items-center gap-2.5">
          <span className="bg-primary shadow-primary-glow flex size-7 shrink-0 items-center justify-center rounded-[5px]">
            <EyIcon name="shieldCheck" size={16} strokeWidth={1.8} className="text-white" />
          </span>
          <span className="min-w-0 leading-none">
            <span className="text-foreground block truncate text-lg leading-tight font-bold tracking-tight">에이와</span>
            <span className="text-primary mt-[3px] block truncate text-base leading-none font-bold">슈퍼관리자</span>
          </span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-1 py-2.5" aria-label="슈퍼관리자 메뉴">
        {SUPER_ADMIN_NAV.map((item) => {
          const isActive = active?.href === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex h-9 items-center gap-2.5 rounded-[9px] px-3 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-primary-glow"
                  : "text-foreground hover:bg-sidebar-accent"
              }`}
            >
              <EyIcon name={item.icon} size={18} strokeWidth={1.8} className="shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-line shrink-0 border-t px-3 py-3">
        <p className="text-foreground truncate text-sm font-bold">{displayName}</p>
        <p className="text-foreground truncate text-xs" title={accountLabel}>
          {accountLabel}
        </p>
        <div className="mt-2 flex flex-col items-start gap-1">
          {dedicatedAdmin ? null : (
            <Link
              href="/dashboard"
              className="text-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm font-medium"
            >
              <EyIcon name="arrowLeft" size={16} strokeWidth={1.8} /> 학원 화면으로
            </Link>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="text-foreground hover:text-danger inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium"
            >
              <EyIcon name="logOut" size={16} strokeWidth={1.8} /> 로그아웃
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
