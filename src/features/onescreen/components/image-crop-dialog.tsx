"use client";

/**
 * 사진 자르기 창(2026-09-11) — 영어 보고서 글 속에 사진을 넣기 전에 남길 부분을 고른다(사용자 *"사진 잘라서 쓰고 싶을 수도
 * 있자나"*). 네모 모서리를 끌어 크기를, 가운데를 끌어 자리를 바꾼다(마우스·손가락 같은 동작 — pointer events).
 *
 * 🔑 네모는 비율 좌표(crop-math.ts) — 화면에 그린 크기와 무관하게 같은 부분이 잘린다.
 * 🔑 전체 그대로면 원본을 그대로 넘긴다(다시 인코딩해 화질을 깎지 않게). 자른 그림은 원래 형식 그대로(resize-image.ts).
 * 🔴 자르기에 실패하면 알리고 넣지 않는다 — 말없이 원본을 넣으면 강사는 잘린 줄 알고 보낸다.
 * ⚠️ 부모가 파일마다 `key`를 바꿔 마운트한다(네모·미리 보기 주소가 파일마다 새로 선다).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { FULL_CROP, dragCrop, isFullCrop, type CropHandle, type CropRect } from "../crop-math";
import { cropImageFile } from "../resize-image";

const CORNERS: { key: Exclude<CropHandle, "move">; cls: string }[] = [
  { key: "nw", cls: "left-0 top-0 cursor-nwse-resize" },
  { key: "ne", cls: "right-0 top-0 cursor-nesw-resize" },
  { key: "sw", cls: "left-0 bottom-0 cursor-nesw-resize" },
  { key: "se", cls: "right-0 bottom-0 cursor-nwse-resize" },
];

/** 끌기 한 번의 출발점 — 비율로 바꾸려면 그 순간 그림의 화면 크기가 필요하다. */
type Drag = { handle: CropHandle; start: CropRect; px: number; py: number; w: number; h: number };

export function ImageCropDialog({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (file: File) => void;
}) {
  const t = useSheetT();
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [rect, setRect] = useState<CropRect>(FULL_CROP);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  // 미리 보기 주소 — 열 때 만들고 닫을 때 버린다. setState는 await 뒤에서만(#25 — effect 안 동기 setState 금지).
  useEffect(() => {
    let alive = true;
    const u = URL.createObjectURL(file);
    void Promise.resolve().then(() => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
      URL.revokeObjectURL(u);
    };
  }, [file]);

  function begin(e: ReactPointerEvent<HTMLElement>, handle: CropHandle) {
    const box = boxRef.current;
    const r = box?.getBoundingClientRect();
    if (!box || !r || !r.width || !r.height || busy) return;
    e.preventDefault();
    e.stopPropagation();
    // 틀(그림 전체)이 포인터를 붙잡는다 — 손잡이 밖으로 끌려 나가도 끝까지 따라온다.
    box.setPointerCapture(e.pointerId);
    drag.current = { handle, start: rect, px: e.clientX, py: e.clientY, w: r.width, h: r.height };
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    setRect(dragCrop(d.start, d.handle, (e.clientX - d.px) / d.w, (e.clientY - d.py) / d.h));
  }
  function end(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (boxRef.current?.hasPointerCapture(e.pointerId)) boxRef.current.releasePointerCapture(e.pointerId);
  }

  async function finish() {
    if (busy) return;
    if (isFullCrop(rect)) {
      onDone(file);
      return;
    }
    setBusy(true);
    try {
      const out = await cropImageFile(file, rect);
      if (!out) {
        toast.error(t("os.crop.fail"));
        return;
      }
      onDone(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onCancel() : undefined)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("os.crop.title")}</DialogTitle>
          <DialogDescription>{t(broken ? "os.crop.loadFail" : "os.crop.desc")}</DialogDescription>
        </DialogHeader>
        <div className="bg-bg-soft flex justify-center rounded-lg p-2">
          {url && !broken ? (
            <div
              ref={boxRef}
              className="relative inline-block touch-none overflow-hidden select-none"
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 고른 파일의 로컬 미리 보기(blob 주소) */}
              <img
                src={url}
                alt=""
                draggable={false}
                onError={() => setBroken(true)}
                className="block max-h-[60vh] max-w-full"
              />
              {/* 남길 부분 — 바깥은 어둡게(넓게 퍼진 그림자를 틀이 잘라 낸다). */}
              <div
                role="presentation"
                onPointerDown={(e) => begin(e, "move")}
                className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              >
                {CORNERS.map((c) => (
                  <span
                    key={c.key}
                    onPointerDown={(e) => begin(e, c.key)}
                    className={`bg-primary absolute size-6 rounded-sm border-2 border-white ${c.cls}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-text-faint py-10 text-sm">{broken ? t("os.crop.loadFail") : t("os.crop.loading")}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" disabled={busy || isFullCrop(rect)} onClick={() => setRect(FULL_CROP)}>
            {t("os.crop.reset")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            {t("os.crop.cancel")}
          </Button>
          <Button size="sm" disabled={busy || (!url && !broken)} onClick={() => void finish()}>
            {busy ? t("os.crop.working") : t("os.crop.done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
