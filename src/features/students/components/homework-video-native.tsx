"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** The browser reads bounded byte ranges from our authenticated endpoint; Drive's iframe is an explicit codec fallback. */
export function HomeworkVideoNative({ src, preview, title }: { src: string; preview: string; title: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [compatibility, setCompatibility] = useState(false);
  const retry = () => { setFailed(false); setCompatibility(false); setAttempt(n => n + 1); };
  return <div className="space-y-2">
    <div className="border-line bg-foreground relative aspect-video w-full overflow-hidden rounded-xl border">
      {compatibility ? <iframe src={preview} title={title} allow="autoplay; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 size-full" />
        : <video key={attempt} src={src} aria-label={title} controls playsInline preload="metadata" onError={() => setFailed(true)} className="absolute inset-0 size-full" />}
    </div>
    {failed && !compatibility ? <p role="alert" className="text-sm">영상을 불러오지 못했습니다. 다시 시도하거나 호환 재생을 선택해 주세요.</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={retry}>다시 불러오기</Button>
      {!compatibility ? <Button type="button" variant="outline" onClick={() => setCompatibility(true)}>호환 재생</Button>
        : <p className="text-sm">호환 재생이 열리지 않으면 다시 불러오기를 눌러 주세요.</p>}
    </div>
  </div>;
}
