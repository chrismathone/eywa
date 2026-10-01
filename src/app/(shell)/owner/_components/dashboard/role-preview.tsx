"use client";

import { useMemo } from "react";
import type { MenuKey } from "@/lib/permissions";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { previewSnapshot } from "@/features/dashboard/layout/preview";
import type { Bundle, Item } from "@/features/dashboard/layout/types";
import { Overview } from "@/app/(shell)/dashboard/_overview/overview";

/**
 * 실데이터 미리보기 — 실제 운영실 컴포넌트(`Overview`)를 그 역할로 다듬은 스냅샷으로 그린다(가짜 숫자 없음).
 * 갱신·실시간 구독은 끈다(`preview`) — 원본이 원장 시점이라 갱신하면 원장 화면으로 덮인다.
 */
export function RolePreview({
  full,
  role,
  items,
  menus,
  subject,
}: {
  full: OverviewSnapshot;
  role: Bundle;
  items: readonly Item[];
  menus: ReadonlySet<MenuKey>;
  subject: { key: string; label: string } | null;
}) {
  const snapshot = useMemo(() => previewSnapshot(full, { role, items, menus, subject }), [full, role, items, menus, subject]);
  return (
    <div aria-label="운영실 미리보기" className="overflow-hidden rounded-2xl shadow-card">
      <Overview initial={snapshot} preview />
    </div>
  );
}
