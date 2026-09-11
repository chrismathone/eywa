// 학생 사진 첨부(P2b) 업로드 전 클라 다운스케일 — 원본 고해상도는 /r 표시(≈512px)·ClassNote 스샷(≈900px)에
// 불필요하고 헤드리스 이미지 로드·스토리지·전송을 낭비. 브라우저 canvas로 긴 변 maxEdge까지 축소(업스케일 없음).
// ⚠️ 클라 전용(브라우저 API) — server-only 금지. 서버는 여전히 10MB 캡·verifyUploadedObject로 백스톱.
import { cropPixels, type CropRect } from "./crop-math";

/** 목표 크기 — 긴 변이 maxEdge 초과면 비율 유지 축소, 이하면 그대로(업스케일 없음). 순수(테스트 대상). */
export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) };
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w: Math.round(w), h: Math.round(h) };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** File 또는 canvas로 그릴 수 있는 소스 → { source, width, height, cleanup }. createImageBitmap 우선(EXIF 회전 baked-in). */
async function decode(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void } | null> {
  // createImageBitmap: EXIF 회전 반영(폰 사진 눕는 문제 방지). 미지원/실패 시 <img> 폴백.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
    } catch {
      /* 폴백으로 진행 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지 디코드 실패"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * 업로드용 리사이즈 — 긴 변 maxEdge까지 다운스케일 + 재인코딩(포맷 보존). 어떤 실패든 **원본 File 반환**(업로드 무중단).
 * 포맷 보존이라 결과 type은 항상 입력과 동일(report_attachment allowCT: jpeg/png/webp 유지).
 */
export async function resizeImageForUpload(
  file: File,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.85;
  if (typeof document === "undefined") return file; // SSR 가드(호출은 클라지만 방어)

  const decoded = await decode(file);
  if (!decoded) return file;
  try {
    const { w, h } = fitWithin(decoded.width, decoded.height, maxEdge);
    if (w <= 0 || h <= 0) return file;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(decoded.source, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type, quality),
    );
    if (!blob || blob.size === 0) return file;
    // 축소·재인코딩이 오히려 커졌으면(작은 원본 등) 원본 유지.
    if (blob.size >= file.size) return file;
    return new File([blob], file.name, { type: file.type });
  } catch {
    return file;
  } finally {
    decoded.cleanup();
  }
}

/** 자른 그림의 형식 — 원래 형식(jpeg·png·webp)을 지킨다. 그 밖은 jpeg. */
const CROP_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/**
 * 자른 그림의 긴 변 상한 — 올릴 때 줄이는 크기(resizeImageForUpload 1600)와 같다. 원본 해상도 그대로 그리면 아이폰 사파리의
 * 캔버스 넓이 상한을 넘어(48MP 사진) `toBlob`이 빈손으로 돌아온다(적대 리뷰 2026-09-11).
 */
const CROP_MAX_EDGE = 1600;

/**
 * 사진 자르기(2026-09-11, 영어 글 속 사진) — 비율 네모(crop-math.ts)만큼 원본에서 잘라 **같은 형식** 파일로.
 * EXIF 회전은 decode가 반영한다(화면에 보인 방향 그대로 자른다). 🔴 실패하면 null — 원본으로 몰래 대신하지 않는다
 * (화면이 알린다. 말없이 원본을 넣으면 강사는 잘린 줄 알고 보낸다). 크기 줄이기는 올릴 때 resizeImageForUpload가 따로 한다.
 */
export async function cropImageFile(file: File, rect: CropRect): Promise<File | null> {
  if (typeof document === "undefined") return null;
  const decoded = await decode(file);
  if (!decoded) return null;
  try {
    const { sx, sy, sw, sh } = cropPixels(rect, { w: decoded.width, h: decoded.height });
    const { w: dw, h: dh } = fitWithin(sw, sh, CROP_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(decoded.source, sx, sy, sw, sh, 0, 0, dw, dh);
    const type = CROP_TYPES.has(file.type) ? file.type : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
    if (!blob || blob.size === 0) return null;
    const name = type === file.type ? file.name : `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
    return new File([blob], name, { type });
  } catch {
    return null;
  } finally {
    decoded.cleanup();
  }
}
