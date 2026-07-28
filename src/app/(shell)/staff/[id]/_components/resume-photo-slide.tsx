"use client";

import { useState } from "react";

/**
 * 기본정보 카드의 증명사진 뷰어 — 한 칸에서 ‹ › 로 넘기는 슬라이드(뷰 전용).
 * URL은 서버가 게이트(원장·관리자) 통과 시에만 resolve해 전달한다.
 */
export function ResumePhotoSlide({ urls }: { urls: (string | null)[] }) {
  const [slide, setSlide] = useState(0);
  const valid = urls.filter(Boolean);
  if (valid.length === 0) return null;
  const current = Math.min(slide, urls.length - 1);
  const url = urls[current];
  const step = (d: number) => setSlide((s) => (s + d + urls.length) % urls.length);
  return (
    <div className="w-24 shrink-0">
      <div className="border-line bg-bg-soft/40 flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg border">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL 미리보기(최적화 불필요)
          <img src={url} alt={`증명사진 ${current + 1}`} className="size-full object-cover" />
        ) : (
          <span className="text-text-faint text-[10px]">사진 {current + 1}</span>
        )}
      </div>
      {urls.length > 1 ? (
        <div className="mt-1 flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="이전 사진"
            className="text-text-dim hover:text-foreground px-0.5 text-[11px] leading-none"
          >
            ‹
          </button>
          {urls.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSlide(i)}
              aria-label={`사진 ${i + 1} 보기`}
              aria-current={i === current}
              className={`size-1.5 rounded-full transition ${i === current ? "bg-primary" : "bg-line"}`}
            />
          ))}
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="다음 사진"
            className="text-text-dim hover:text-foreground px-0.5 text-[11px] leading-none"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
