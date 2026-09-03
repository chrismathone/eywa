"use client";

import { useState } from "react";
import { nextSort, type SortState } from "@/features/inventory/sort";

/**
 * 표 정렬 상태 — 면마다 하나. v1은 저장하지 않는다(저장한다면 localStorage가 아니라
 * `users.ui_prefs.inventory` DB로 — 뷰 세팅은 계정 귀속, [[#90]]).
 */
export function useSort(initial: SortState = null) {
  const [sort, setSort] = useState<SortState>(initial);
  return { sort, toggle: (key: string) => setSort((cur) => nextSort(cur, key)) };
}
