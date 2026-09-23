"use client";

import { useEffect, useRef } from "react";
import styles from "@/components/public-site/public-site.module.css";

/**
 * 로그인 왼쪽 패널의 배경 영상 — 원장 2026-09-22 *"로그인 화면에서 음소거 상태로 이미지 대신에 이 영상 사용"*.
 *
 * 클라이언트 컴포넌트인 이유 둘:
 * - React는 `muted`를 속성이 아니라 프로퍼티로 다뤄 서버 렌더 HTML에 `muted`가 안 실린다. 그 상태로는 브라우저
 *   자동재생 정책에 걸려 첫 그림이 멈춰 있으므로, 붙자마자 `muted`를 확실히 켜고 `play()`를 부른다.
 * - 영상 주소는 마크업에 적지 않고 **패널이 실제로 보이는 폭(821px 이상)에서만** 넣는다. 폰에선 패널이
 *   `display:none`인데 `autoplay`가 달린 `<video src>`는 그래도 받아 온다(880KB 낭비).
 * 움직임 줄이기 설정이면 재생하지 않고 포스터(첫 장면)만 둔다. 소리는 어디서도 켜지지 않는다(음소거 고정).
 */
export function LoginVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wide = window.matchMedia("(min-width: 821px)");
    if (reduce.matches || !wide.matches) return;
    video.src = src;
    video.play().catch(() => {
      /* 자동재생이 막히면 포스터가 그대로 보인다 — 로그인과 무관한 장식이라 조용히 넘어간다 */
    });
  }, [src]);

  return (
    <video
      ref={ref}
      className={styles.loginVideo}
      poster={poster}
      muted
      playsInline
      loop
      preload="none"
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
