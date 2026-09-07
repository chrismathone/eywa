"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  BUILTIN_CATEGORY_MAPS,
  buildCategoryMaps,
  type CategoryMaps,
  type InventoryCategory,
} from "@/features/inventory/category";

/**
 * 자산 분류(0247a)의 **클라이언트 단일 소스** — 학원설정의 `OperationsProvider` 선례 그대로.
 *
 * 재고관리 화면 루트(page.tsx)가 서버에서 한 번 읽은 목록을 주입하면, 'use client' 컴포넌트가 부모 prop
 * 배선 없이 `useCategoryMaps()`로 읽는다(다이얼로그 4개 + 표 + 툴바가 전부 이 훅을 쓴다).
 * 🔴 클라이언트에서 직접 DB를 읽지 말 것. 🔴 분류 라벨·순서를 화면 파일에 다시 적지 말 것.
 * ⚠️ 프로바이더 밖이면 **내장 7종 폴백**(라벨이 영문 키로 새지 않게 — 화면이 죽는 것보다 낫다).
 */
const Ctx = createContext<CategoryMaps | null>(null);

export function InventoryCategoriesProvider({
  categories,
  children,
}: {
  categories: InventoryCategory[];
  children: ReactNode;
}) {
  const value = useMemo(() => buildCategoryMaps(categories), [categories]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCategoryMaps(): CategoryMaps {
  return useContext(Ctx) ?? BUILTIN_CATEGORY_MAPS;
}
