/**
 * 자산 QR — 순수 규약. 원장 2026-09-02: *"QR코드로 관리하고 싶어서 QR코드를 전부 만들어줘"* · *"QR코드를 찍으면 현재 상태가
 * 그대로 볼 수 있도록 … 모바일 뷰 기준 깔끔하게"* · *"앞으로도 추가할때 자동으로 QR 생성되도록"*.
 *
 * 🔑 QR은 **저장하지 않는다** — 자산ID에서 파생한 주소(`/inventory/asset/<자산ID>`)를 그 자리에서 그린다
 *    (`/api/inventory/qr/<자산ID>`). 그래서 자산을 새로 등록하면 QR도 **자동으로** 생긴다(표·라벨·상세가 같은 규약).
 * 🔑 QR 안엔 자산ID만 들어간다(상태·위치가 아니라) — 찍으면 **그때의 현재 상태**를 화면이 보여 준다. 상태를 QR에 넣으면
 *    라벨을 다시 붙여야 한다.
 */
import { normalizeAssetCode } from "./asset-code";

/** 스캔이 착지하는 상세 화면 경로. */
export function assetDetailPath(assetCode: string): string {
  return `/inventory/asset/${encodeURIComponent(normalizeAssetCode(assetCode))}`;
}

/** QR에 담는 절대 주소. `base`는 `NEXT_PUBLIC_APP_URL`(없으면 요청 origin). */
export function assetQrTarget(base: string, assetCode: string): string {
  return `${base.replace(/\/+$/, "")}${assetDetailPath(assetCode)}`;
}

/** QR 이미지(SVG) 주소 — 라우트가 그 자리에서 그린다. */
export function qrImageSrc(assetCode: string): string {
  return `/api/inventory/qr/${encodeURIComponent(normalizeAssetCode(assetCode))}`;
}

/** 라벨 시트 — A4 세로 한 장에 4열 × 7행 = 28장(약 42mm 라벨). */
export const QR_LABELS_PER_ROW = 4;
export const QR_LABELS_PER_PAGE = 28;

/**
 * 자산 번호(No) — 원장 2026-09-02: *"가장 왼쪽에 no 행 추가할것. 1번부터 차례대로"* + *"인쇄시에 전체 혹은 no를 지정해서
 * 1~8, 10~15 등으로"*. 번호는 **자산 마스터 순서(sort_order·자산ID)로 1부터** 매긴 고정 번호다 — 표를 정렬·필터해도
 * 그 자산의 번호는 그대로라(라벨 인쇄 범위가 그 번호를 가리킨다), 화면에 보이는 줄 순서가 아니다.
 */
export function numberAssets<T>(rows: ReadonlyArray<T>): Array<T & { no: number }> {
  return rows.map((r, i) => ({ ...r, no: i + 1 }));
}

/**
 * 번호 범위 문자열 → 번호 집합. `1~8, 10~15` · `3` · `1-4,9` (구분 `,`·공백 / 범위 `~`·`-`·`–`). 빈 문자열 = 전체(null).
 * 범위 밖·모양이 틀린 조각은 `error`로 돌려준다(조용히 무시하면 "왜 안 나오지"가 된다).
 */
export function parseNoRanges(input: string, max: number): { nos: Set<number> | null; error?: string } {
  const text = input.trim();
  if (!text) return { nos: null };
  const nos = new Set<number>();
  for (const raw of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)\s*(?:[~\-–]\s*(\d+))?$/.exec(raw);
    if (!m) return { nos: null, error: `"${raw}"는 번호나 범위(예: 1~8)가 아닙니다` };
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo < 1 || hi > max) return { nos: null, error: `"${raw}"는 1~${max} 범위를 벗어납니다` };
    for (let n = lo; n <= hi; n++) nos.add(n);
  }
  return { nos };
}
