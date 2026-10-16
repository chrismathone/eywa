"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/**
 * 저장은 끝났는데 이 화면에 머문다 — 같은 문서(단일 화면)에 다른 녹음이 살아 있어서, 저장 뒤의 풀 문서 이동(#102)을 하면
 * 그 녹음이 끝난다(recording-resume.ts `documentHasLiveRecording`). 링크는 문서 안 이동이라 녹음이 이어진다.
 * 나타나면 링크로 초점을 옮긴다(긴 폼의 아래에서 저장해도 보이게).
 */
export function SavedStayNotice({ href, saved }: { href: string; saved: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { link.current?.focus(); }, []);
  return (
    <p role="status" className="border-border bg-muted/30 text-foreground rounded-md border px-3 py-2 text-sm">
      {saved} 다른 녹음이 이어지도록 이 화면에 머뭅니다 —{" "}
      <Link ref={link} href={href} className="font-medium underline underline-offset-2">열기</Link>
    </p>
  );
}
