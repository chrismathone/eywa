import type { Face } from "@/components/face-tabs";

/** 고객센터 라우트 — 면은 `?tab=`으로 가른다(재고관리와 같은 메커니즘). */
export const SUPPORT_PATH = "/support";

export const SUPPORT_TABS = ["notices", "requests"] as const;
export type SupportTab = (typeof SUPPORT_TABS)[number];

/**
 * 면 정의 **단일 소스** — makeedu 고객센터의 '공지사항 · 개선요청'. 기본 착지는 공지사항(makeedu와 같다).
 * 사이드바 하부탭엔 넣지 않는다(면 두 개 — 화면 안 탭바로 충분, 재고관리 선례).
 */
export const SUPPORT_FACE_DEFS: ReadonlyArray<{ key: SupportTab; label: string; href: string }> = [
  { key: "notices", label: "공지사항", href: SUPPORT_PATH },
  { key: "requests", label: "개선요청", href: `${SUPPORT_PATH}?tab=requests` },
];

export function resolveSupportTab(v: unknown): SupportTab {
  return typeof v === "string" && (SUPPORT_TABS as readonly string[]).includes(v) ? (v as SupportTab) : "notices";
}

export function supportFaces(): Face[] {
  return SUPPORT_FACE_DEFS.map((f) => ({ key: f.key, label: f.label, href: f.href }));
}
