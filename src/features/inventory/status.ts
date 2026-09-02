/**
 * 자산 상태 — **단일 소스**(순수, 서버/클라 공용. `"use client"`·`server-only` 둘 다 붙이지 말 것 [[#61]]·[[#81]]).
 *
 * 원장 2026-09-02: *"<자산관리대장 개편 시안> 참고한 다음 '재고 관리 탭'으로"*. 시안의 한 줄 요지 =
 * "자산 1대 = 영구 행 1개. 월별 시트 복사 대신 대여·실사 이력을 누적한다".
 *
 * 🔴 DB엔 영문 키, 화면엔 한글 — raw 코드 노출 금지(작업 선호). 라벨 맵은 이 파일 하나.
 * 🔴 색은 `PillColor`가 아니라 **tone**(의미색 캐논, `src/lib/design/semantic-color.ts`). 화면 파일에
 *    `STATUS_META` 같은 로컬 맵을 새로 만들지 말 것(팔레트 v4).
 * ⚠️ 이건 학생 상태·출결 상태와 같은 **코드 고정 enum**이다 — 과목/학년/직급/교시(학원설정 단일 소스)가 아니다.
 */
import type { PillColor } from "@/components/atoms/pill";
import { type SemanticTone, toneColor } from "@/lib/design/semantic-color";

export const ASSET_STATUSES = ["in_use", "on_loan", "repair", "lost", "check", "unregistered", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  in_use: "사용중",
  on_loan: "대여중",
  repair: "수리중",
  lost: "분실",
  check: "확인필요",
  unregistered: "미등록",
  disposed: "폐기",
};

/**
 * 상태 → 뜻. 사용중=정상 · 대여중=남이 갖고 있는 진행 상태(info) · 수리중/확인필요=손을 대야 하는 주의 ·
 * 분실=실패 · 미등록=예외(라벨은 붙었는데 대장에 없다) · 폐기=끝난 것(색을 뺀다).
 */
export const ASSET_STATUS_TONE: Record<AssetStatus, SemanticTone> = {
  in_use: "positive",
  on_loan: "info",
  repair: "caution",
  lost: "critical",
  check: "caution",
  unregistered: "special",
  disposed: "inert",
};

export function isAssetStatus(v: unknown): v is AssetStatus {
  return typeof v === "string" && (ASSET_STATUSES as readonly string[]).includes(v);
}

/** 상태 코드 → 한글. 모르는 값은 원문 그대로(표시 전 매핑 추가가 정석 — 화면이 죽지는 않게). */
export function assetStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return isAssetStatus(status) ? ASSET_STATUS_LABEL[status] : status;
}

/** 상태 배지 한 벌(라벨+색). 자산 상태 배지를 그리는 모든 화면은 이걸 쓴다. */
export function assetStatusMeta(status: string): { label: string; color: PillColor; tone: SemanticTone } {
  const tone: SemanticTone = isAssetStatus(status) ? ASSET_STATUS_TONE[status] : "inert";
  return { label: assetStatusLabel(status), color: toneColor(tone), tone };
}

/**
 * **조치필요** 판정 — 스탯 '조치필요' · 필터 칩 '조치필요' · "지금 조치가 필요한 자산" 목록이
 * **전부 이 함수**를 쓴다. 세 곳이 갈리면 "15건인데 목록엔 14건"이 된다.
 * 시안의 캡션은 `분실·확인·미등록`이라 줄여 적혀 있지만 15건 안에 **수리중(NB-010) 1건**이 들어 있다.
 */
export function needsAction(status: string): boolean {
  return status === "lost" || status === "check" || status === "unregistered" || status === "repair";
}

/** 스탯 '전체 자산'의 분모 — 폐기는 뺀다(시안: 표 96행 / 전체 94, 폐기 2 제외). */
export function countable(status: string): boolean {
  return status !== "disposed";
}
