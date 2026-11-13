import { afterEach, expect, it, vi } from "vitest";
import { exportPhotoMarkup, hitPhotoMark, movePhotoMark, paintPhoto, photoEditOf, photoMarkBox, photoPoint, rememberPhotoEdit, type PhotoMark } from "./photo-markup";

afterEach(() => vi.restoreAllMocks());
const text: PhotoMark = { id: "text", kind: "text", text: "학생 노트", x: 0.5, y: 0.5, size: 0.08, color: "#ffffff" };
const sticker: PhotoMark = { ...text, id: "face", kind: "sticker", text: "😎", size: 0.2 };
function context() {
  return { globalAlpha: 0.2, font: "", fillStyle: "", strokeStyle: "", lineWidth: 1,
    save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    fillText: vi.fn(), strokeText: vi.fn(), strokeRect: vi.fn(), setLineDash: vi.fn(),
    measureText: vi.fn((value: string) => ({ width: value.length * 8 })) } as unknown as CanvasRenderingContext2D;
}
it("드래그 좌표는 확대/이동된 사진의 실제 표시 영역으로 환산하고 범위 밖을 제한한다", () => {
  expect(photoPoint(250, 150, { left: 50, top: 50, width: 400, height: 200 })).toEqual({ x: 0.5, y: 0.5 });
  expect(photoPoint(-50, 500, { left: 50, top: 50, width: 400, height: 200 })).toEqual({ x: 0, y: 1 });
  expect(movePhotoMark(text, 1.5, -0.3)).toEqual({ ...text, x: 1, y: 0 });
});
it("겹친 스티커는 맨 위부터 고르고 글자/스티커가 사진 경계 밖으로 잘리지 않는다", () => {
  const ctx = context();
  expect(hitPhotoMark(ctx, [text, sticker], 0.5, 0.5, 1000, 800)?.mark.id).toBe("face");
  const box = photoMarkBox(ctx, { ...sticker, x: 0, y: 1 }, 1000, 800);
  expect(box.x - box.w / 2).toBeGreaterThanOrEqual(0);
  expect(box.y + box.h / 2).toBeLessThanOrEqual(800);
});
it("얼굴 스티커는 완전 불투명 배경을 먼저 그리고 선택 테두리는 내보내기에 넣지 않는다", () => {
  const ctx = context();
  paintPhoto(ctx, {} as CanvasImageSource, 1000, 800, [sticker]);
  expect(ctx.globalAlpha).toBe(1);
  expect(ctx.arc).toHaveBeenCalled();
  expect(ctx.fill).toHaveBeenCalledBefore(vi.mocked(ctx.fillText));
  expect(ctx.strokeRect).not.toHaveBeenCalled();
});
it("재편집 때 원본과 편집 요소를 복구하며 다른 사진의 편집 내용은 섞지 않는다", () => {
  const original = new File(["original"], "original.jpg");
  const edited = new File(["flat"], "edited.jpg");
  rememberPhotoEdit(edited, original, [text]);
  const edit = photoEditOf(edited);
  expect(edit.source).toBe(original);
  edit.marks[0].text = "다른 글";
  expect(photoEditOf(edited).marks[0].text).toBe("학생 노트");
  expect(photoEditOf(new File(["other"], "other.jpg")).marks).toEqual([]);
});
it("적용은 합성된 JPEG만 만들며 원본/선택 테두리를 첨부 파일에 담지 않고 캔버스를 해제한다", async () => {
  const ctx = context();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  const canvases: HTMLCanvasElement[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, done, type) {
    canvases.push(this);
    expect([this.width, this.height, type]).toEqual([1200, 1600, "image/jpeg"]);
    done(new Blob(["flattened pixels"], { type: "image/jpeg" }));
  });
  const original = new File(["private original"], "note.jpg", { type: "image/jpeg" });
  const result = await exportPhotoMarkup({ naturalWidth: 3000, naturalHeight: 4000 } as HTMLImageElement, original, [sticker]);
  expect(result).not.toBe(original);
  expect(await result.text()).toBe("flattened pixels");
  expect(result.type).toBe("image/jpeg");
  expect(ctx.strokeRect).not.toHaveBeenCalled();
  expect([canvases[0].width, canvases[0].height]).toEqual([0, 0]);
});
it("인코딩 실패는 원본으로 몰래 대체하지 않는다", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context());
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(done => done(null));
  await expect(exportPhotoMarkup({ naturalWidth: 800, naturalHeight: 600 } as HTMLImageElement, new File(["source"], "a.jpg"), [sticker])).rejects.toThrow("photo-export-failed");
});
