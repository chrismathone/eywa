import { configuredHubGroups, hubGroupOfPath, type HubGroup } from "@/lib/menu-hub";
import type { MenuGroupLayout, MenuLayout } from "./menu-layout";

/**
 * 페이지 머리글 앞부분(eyebrow) = **왼쪽 사이드바에서 그 메뉴가 속한 그룹 이름**(원장 2026-10-01 *"상단 헤더에 잘못된거
 * 같은데? 상담.재원 - 콜&상담 같은데"* — 콜&상담 머리글이 `콜&상담 - 콜&상담`이었다).
 *
 * 화면마다 손으로 적은 eyebrow는 사이드바와 따로 놀았다("운영"·"학생 케어"·"수업 운영" — 사이드바엔 그런 그룹이 없다).
 * 그래서 사이드바와 **같은 단일 소스**를 읽는다: 메뉴 정의([`HUB_GROUPS`](../../lib/menu-hub.ts)) + 학원 설정 '탭 및 메뉴 구성'
 * (그룹 이름 바꾸기·메뉴를 다른 그룹으로 옮기기·새 그룹) — 해석은 [`configuredHubGroups`](../../lib/menu-hub.ts)가,
 * "지금 주소가 어느 그룹인가"는 사이드바 현재 위치 표시와 같은 [`hubGroupOfPath`](../../lib/menu-hub.ts)가 한다.
 *
 * - 메뉴에 없는 화면(상세·편집·새로 만들기)은 접두가 같은 **부모 메뉴의 그룹**(`/enrollment/123` → 콜&상담의 그룹).
 * - 메뉴 자체가 없는 화면(내 정보·슈퍼관리자 등) → 화면이 적은 eyebrow(폴백).
 * - 메뉴는 있는데 그 그룹을 학원 설정에서 **숨겼으면** → 앞부분 없음(사이드바에 없는 이름을 지어내지도, 원장이 틀렸다고 한
 *   옛 손 문구로 돌아가지도 않는다 — 적대 리뷰).
 * - 그룹 이름과 제목이 같으면(회의록 - 회의록 · 도움말 - 도움말) 앞부분을 뺀다.
 * 🔴 이 파일엔 `"use client"`도 `import "server-only"`도 붙이지 말 것 — 클라 컴포넌트와 테스트가 함께 읽는다([[#61]]·[[#81]]).
 */

/** 그룹 이름 · `null` = 메뉴는 있으나 그 그룹을 숨김(앞부분 없음) · `undefined` = 메뉴 밖 화면(폴백). */
export type MenuGroupLabel = string | null | undefined;

export function menuGroupLabelFor(
  href: string,
  source: readonly HubGroup[],
  menus: MenuLayout,
  groups: MenuGroupLayout,
): MenuGroupLabel {
  const group = hubGroupOfPath(href, configuredHubGroups(source, menus, groups));
  if (!group) return undefined;
  return group.hidden ? null : group.label;
}

/** 최종 앞부분 — 사이드바 그룹 → (메뉴 밖이면) 화면이 적은 값. 숨긴 그룹·제목과 같으면 생략(`undefined`). */
export function pageHeaderEyebrow(groupLabel: MenuGroupLabel, fallback: string | undefined, title: string): string | undefined {
  if (groupLabel === null) return undefined;
  const eyebrow = (groupLabel ?? fallback)?.trim();
  if (!eyebrow) return undefined;
  return eyebrow === title.trim() ? undefined : eyebrow;
}
