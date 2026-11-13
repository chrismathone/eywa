export type PhotoMark = { id: string; kind: "text" | "sticker"; text: string; x: number; y: number; size: number; color: string };
type PhotoEdit = { source: File; marks: PhotoMark[] };
const edits = new WeakMap<File, PhotoEdit>();
export const PHOTO_STICKERS = ["😎", "🙂", "🙈", "🐱", "❤️", "⭐"] as const;
const FONT = "system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function photoEditOf(file: File): PhotoEdit {
  const edit = edits.get(file);
  return { source: edit?.source ?? file, marks: edit?.marks.map(mark => ({ ...mark })) ?? [] };
}
export function rememberPhotoEdit(file: File, source: File, marks: PhotoMark[]) {
  edits.set(file, { source, marks: marks.map(mark => ({ ...mark })) });
}
export function movePhotoMark(mark: PhotoMark, x: number, y: number): PhotoMark {
  return { ...mark, x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}
export function photoPoint(clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">) {
  return { x: clamp((clientX - rect.left) / (rect.width || 1), 0, 1), y: clamp((clientY - rect.top) / (rect.height || 1), 0, 1) };
}
function linesOf(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.slice(0, 120).split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = ""; }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
export function photoMarkBox(ctx: CanvasRenderingContext2D, mark: PhotoMark, width: number, height: number) {
  let font = Math.min(clamp(mark.size, 0.025, 0.3) * width, height * 0.4);
  ctx.font = `700 ${font}px ${FONT}`;
  let lines = mark.kind === "sticker" ? [mark.text] : linesOf(ctx, mark.text, width * 0.9);
  if (lines.length * font * 1.2 > height * 0.85) {
    font = height * 0.85 / (lines.length * 1.2);
    ctx.font = `700 ${font}px ${FONT}`;
    lines = mark.kind === "sticker" ? [mark.text] : linesOf(ctx, mark.text, width * 0.9);
  }
  const w = mark.kind === "sticker" ? font * 1.4 : Math.max(font, ...lines.map(line => ctx.measureText(line).width)) + font * 0.16;
  const h = mark.kind === "sticker" ? font * 1.4 : font * 1.2 * lines.length;
  return { x: clamp(mark.x * width, w / 2, width - w / 2), y: clamp(mark.y * height, h / 2, height - h / 2), w, h, font, lines };
}
export function hitPhotoMark(ctx: CanvasRenderingContext2D, marks: PhotoMark[], x: number, y: number, width: number, height: number) {
  for (const mark of [...marks].reverse()) {
    const box = photoMarkBox(ctx, mark, width, height);
    const pad = Math.max(8, width * 0.015);
    if (Math.abs(x * width - box.x) <= box.w / 2 + pad && Math.abs(y * height - box.y) <= box.h / 2 + pad) return { mark, box };
  }
  return null;
}

/** Stickers have an opaque backing; exported photos contain flattened pixels, with no original image layer. */
export function paintPhoto(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, marks: PhotoMark[], selected?: string) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff"; // Photo pixel colors, independent of the application theme.
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const mark of marks) {
    const box = photoMarkBox(ctx, mark, width, height);
    if (mark.kind === "sticker") {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(box.x, box.y, box.w / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111111";
      ctx.fillText(mark.text, box.x, box.y);
    } else {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, box.font * 0.09);
      ctx.strokeStyle = "#111111";
      ctx.fillStyle = mark.color;
      box.lines.forEach((line, i) => {
        const y = box.y + (i - (box.lines.length - 1) / 2) * box.font * 1.2;
        ctx.strokeText(line, box.x, y); ctx.fillText(line, box.x, y);
      });
    }
    if (selected === mark.id) {
      ctx.strokeStyle = "#2563eb"; ctx.lineWidth = Math.max(2, width * 0.003);
      ctx.setLineDash([width * 0.008, width * 0.004]);
      ctx.strokeRect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

export async function exportPhotoMarkup(source: HTMLImageElement, original: File, marks: PhotoMark[]): Promise<File> {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(source.naturalWidth, source.naturalHeight));
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx || !source.naturalWidth || !source.naturalHeight) throw new Error("photo-not-ready");
    paintPhoto(ctx, source, canvas.width, canvas.height, marks);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob?.size) throw new Error("photo-export-failed");
    const name = `${original.name.replace(/\.[^.]+$/, "").slice(0, 80)}-edit-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const file = new File([blob], name, { type: "image/jpeg" });
    rememberPhotoEdit(file, original, marks);
    return file;
  } finally { canvas.width = 0; canvas.height = 0; }
}
