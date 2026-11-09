"use server";
import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { PART_KEYS, type PartKey } from "../model/loyalty-parts";

/** 로열티 랭킹 표의 점수 칸 순서 — 계정에 저장(다른 PC에서도 같은 순서). 모르는 키·빠진 키는 받지 않는다. */
export async function saveLoyaltyColumnOrder(order: string[]) {
  const valid = Array.isArray(order) && order.length === PART_KEYS.length && PART_KEYS.every((k) => order.includes(k));
  if (!valid) return { ok: false, error: "칸 순서를 저장하지 못했습니다" };
  const isDefault = order.every((k, i) => k === PART_KEYS[i]);
  return patchMyUiPrefs("loyaltyRanking", { columns: isDefault ? undefined : (order as PartKey[]) });
}
