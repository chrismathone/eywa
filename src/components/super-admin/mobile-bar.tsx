"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { signOut } from "@/app/(auth)/login/actions";
import { ADMIN_LOGIN_ID, isAdminAuthEmail } from "@/lib/auth/admin-login";
import { SUPER_ADMIN_NAV, activeSuperAdminNav } from "./nav";

/**
 * 슈퍼관리자 **폰·터치 상단 바** — 앱 셸의 [`MobileTopNav`](../mobile-top-nav.tsx)와 같은 어법:
 * 한 줄(로고 · AYWA · 현재 메뉴명 … 햄버거) + 펼치면 메뉴 그리드, 고르면 닫힌다.
 *
 * 계기(원장 2026-09-25 폰 캡처): 종전엔 256px 검정 사이드바가 폰에서도 그대로 서서 본문이 130px만 남았고,
 * 지표 카드의 "전체 학원"·"507"이 **한 글자씩 세로로** 쌓였다. 데스크톱이 아니면 사이드바를 숨기고 이 바가 메뉴다.
 * ⚠️ 보이는 조건은 레이아웃의 `desk:hidden`(사이드바와 정확히 여집합 — 앱 셸과 같은 축).
 * ⚠️ 이 줄이 화면 제목이다 — 본문 `PageHeader`는 `compact-chrome`으로 접힌다(제목 두 번 금지).
 */
export function SuperAdminMobileBar({ email, className = "" }: { email: string; className?: string }) {
  const pathname = usePathname() ?? "/super-admin";
  const active = activeSuperAdminNav(pathname);
  const dedicatedAdmin = isAdminAuthEmail(email);
  const [open, setOpen] = useState(false);
  return (
    <nav className={`bg-sidebar border-line sticky top-0 z-20 shrink-0 border-b ${className}`} aria-label="슈퍼관리자 메뉴">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/super-admin" className="flex shrink-0 items-center gap-2">
            <span className="bg-primary flex size-5 items-center justify-center rounded-[3px]">
              <EyIcon name="shieldCheck" size={12} strokeWidth={1.8} className="text-white" />
            </span>
            <span className="text-foreground text-sm font-bold tracking-tight">AYWA</span>
            <span className="text-primary text-sm font-bold">슈퍼관리자</span>
          </Link>
          {active ? (
            <>
              <span className="bg-line h-3 w-px shrink-0" aria-hidden />
              <h1 className="text-foreground min-w-0 truncate text-sm font-bold tracking-tight">{active.label}</h1>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={open}
          className="text-foreground hover:bg-bg-soft flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md transition"
        >
          <EyIcon name={open ? "close" : "menu"} size={18} strokeWidth={1.8} />
        </button>
      </div>

      {open ? (
        <div className="border-line/60 border-t px-2 pt-1.5 pb-2">
          <ul className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            {SUPER_ADMIN_NAV.map((item) => {
              const isActive = active?.href === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-bold transition ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-primary-glow"
                        : "text-foreground hover:bg-bg-soft"
                    }`}
                  >
                    <EyIcon name={item.icon} size={16} strokeWidth={1.8} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="border-line/60 mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-1 pt-2">
            <span className="text-foreground min-w-0 truncate text-xs" title={dedicatedAdmin ? ADMIN_LOGIN_ID : email}>
              {dedicatedAdmin ? ADMIN_LOGIN_ID : email}
            </span>
            <div className="flex items-center gap-1">
              {dedicatedAdmin ? null : (
                <Link
                  href="/dashboard"
                  className="text-foreground hover:bg-bg-soft inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium"
                >
                  <EyIcon name="arrowLeft" size={16} strokeWidth={1.8} /> 학원 화면으로
                </Link>
              )}
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-foreground hover:text-danger hover:bg-bg-soft inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-medium"
                >
                  <EyIcon name="logOut" size={16} strokeWidth={1.8} /> 로그아웃
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
