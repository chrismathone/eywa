"use client";

import { useEffect, useRef } from "react";

/**
 * 스크롤이 재생 헤드인 walk-in 장면 — 입구 → 복도 → 좌회전 → 상담 데스크.
 *
 * 🔴 스크롤을 가로채지(scroll-jack) 않는다 — 긴 .ac-scene 안의 sticky 뷰포트라
 *    네이티브 스크롤 그대로다(되감기·건너뛰기·보조기술 정상).
 *
 * 왜 이미지 시퀀스가 아니라 영상인가:
 *   정지 이미지 100여 장으로 9초를 담으면 프레임 간 압축을 통째로 포기하는 셈이라 같은 용량에서
 *   화질이 크게 떨어진다(WebP 스틸 vs x264, 같은 순간 비교로 확인 — x264가 윤곽을 지킨다).
 * ⚠️ 단 반드시 **전(全)키프레임(-g 1)** 으로 인코딩할 것. 일반 인코딩(키프레임 2초 간격)은
 *    되감을 때마다 앞 프레임을 다시 풀어야 해서 스크럽이 끊긴다(실측 52ms → 32ms).
 */
const SRC = "/academy/walk.mp4";
const POSTER = "/academy/poster.webp";

/** 전체 진행도 t 안에서 [a,b] 구간만 0→1로 다시 편다 */
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));

export function WalkScene({ children }: { children?: React.ReactNode }) {
  const sceneRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const filmRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const viewport = viewportRef.current;
    const film = filmRef.current;
    if (!scene || !viewport || !film) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const topbar = document.getElementById("ac-topbar");

    let ready = false;
    let duration = 9;
    let disposed = false;
    // 매 프레임 querySelector를 돌리지 않도록 한 번만 잡아 둔다
    const deskPanel = viewport.querySelector<HTMLElement>(".ac-panel-desk");

    /* seek 합치기 ─────────────────────────────────────────
       ⚠️ 스크롤마다 currentTime을 찍으면 요청이 쌓여 화면이 스크롤보다 뒤처진다.
       진행 중이면 "가고 싶은 지점"만 갱신하고, 끝나는 즉시 최신 지점으로 한 번만 간다. */
    let want = 0;
    let seeking = false;
    const pump = () => {
      if (!ready || seeking) return;
      if (Math.abs(film.currentTime - want) < 0.02) return;
      seeking = true;
      film.currentTime = want;
    };
    const onSeeked = () => {
      seeking = false;
      pump();
    };
    film.addEventListener("seeked", onSeeked);

    /* ─────────────────────────────────────────────────────────────
       applyFrame — 재생 헤드가 t(0~1)일 때의 한 프레임.
       t 0.00~0.70 = 영상이 감긴다 (입구 → 복도 → 좌회전 → 데스크)
       t 0.70~0.78 = 도착한 화면을 선명하게 잠시 둔다
       t 0.78~0.92 = 초점이 풀리며(블러) 데스크 문구가 차례로 올라온다
       t 0.92~1.00 = 그대로 머문다
       ⚠️ 안무를 t=1까지 끌면 도착 화면이 마지막 픽셀에서야 완성돼 머무는 시간이 0이 된다.
       ⚠️ 도착하자마자 흐리면 벽면 사인을 못 본다 — 선명하게 보여준 뒤에 흐린다.
       ───────────────────────────────────────────────────────────── */
    const applyFrame = (t: number) => {
      want = seg(t, 0, 0.7) * (duration - 0.05);
      pump();
      const intro = 1 - seg(t, 0.03, 0.15);
      const txt = seg(t, 0.78, 0.92);
      // 도착하면서 시선을 위로 든다 — 벽면 인재원 사인이 프레임에 들어오게.
      // (가로를 채우면 세로가 많이 잘려서, 고정 시선으로는 사인이 화면 밖에 남는다)
      viewport.style.setProperty("--ac-focus", (46 + (18 - 46) * seg(t, 0.6, 0.76)).toFixed(2));
      // 초점 이동: 시작 5px → 걸을 땐 0 → 데스크 문구와 함께 다시 10px
      const blur = Math.max(intro * 5, txt * 10);
      viewport.style.setProperty("--ac-blur", blur.toFixed(2));
      viewport.dataset.soft = blur > 0.05 ? "1" : "0";
      viewport.style.setProperty("--ac-intro", intro.toFixed(4));
      viewport.style.setProperty("--ac-txt", txt.toFixed(4));
      viewport.style.setProperty("--ac-hud", (1 - seg(t, 0.4, 0.6)).toFixed(4));
      viewport.style.setProperty("--ac-t", t.toFixed(4));
      // 투명할 때 클릭을 먹지 않게 (보이지 않는 CTA가 아래 링크를 가로채는 것 방지)
      if (deskPanel) deskPanel.dataset.on = txt > 0.6 ? "1" : "0";
    };

    const progress = () => {
      const span = scene.offsetHeight - viewport.offsetHeight;
      if (span <= 0) return 0;
      return clamp(-scene.getBoundingClientRect().top / span);
    };

    let queued = false;
    const schedule = () => {
      if (queued || disposed) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (disposed) return;
        applyFrame(reduce ? 1 : progress());
        if (topbar) topbar.dataset.solid = scene.getBoundingClientRect().bottom <= 64 ? "1" : "0";
      });
    };

    // 아이폰은 사용자 제스처 없이는 디코더를 안 깨우는 경우가 있다 — 한 번만 깨워 준다
    const prime = () => {
      const p = film.play();
      if (p) p.then(() => film.pause()).catch(() => {});
    };
    addEventListener("touchstart", prime, { once: true, passive: true });
    addEventListener("pointerdown", prime, { once: true });

    // 🔴 대기 중인 임시 리스너를 언마운트 시 반드시 떼기 위한 레지스트리.
    //    {once:true}나 자체 cleanup()에만 기대면, 프라미스가 아직 안 끝난 상태로 언마운트되는
    //    경우(느린 네트워크·빠른 라우트 이탈) 리스너가 fire할 때까지 비디오 엘리먼트에 남는다.
    let teardownPending: (() => void) | null = null;

    const start = async () => {
      try {
        if (film.readyState < 1) {
          await new Promise<void>((res, rej) => {
            // ⚠️ function 선언은 호이스팅돼서 TS가 위쪽 null 좁히기를 못 믿는다 — 화살표로.
            const cleanup = () => {
              clearTimeout(timer);
              film.removeEventListener("loadedmetadata", ok);
              film.removeEventListener("error", bad);
              teardownPending = null;
            };
            const ok = () => {
              cleanup();
              res();
            };
            const bad = () => {
              cleanup();
              rej(new Error("video load failed"));
            };
            const timer = setTimeout(bad, 20000);
            film.addEventListener("loadedmetadata", ok);
            film.addEventListener("error", bad);
            teardownPending = cleanup;
          });
        }
        if (disposed) return;
        duration = film.duration || 9;
        // 첫 프레임을 실제로 그려 둔다 (아이폰은 seek 한 번을 거쳐야 그리기 시작한다)
        await new Promise<void>((res) => {
          const cleanup = () => {
            clearTimeout(timer);
            film.removeEventListener("seeked", done);
            teardownPending = null;
          };
          const done = () => {
            cleanup();
            res();
          };
          const timer = setTimeout(done, 2500);
          film.addEventListener("seeked", done);
          teardownPending = cleanup;
          film.currentTime = 0.02;
        });
        if (disposed) return;
        ready = true;
        film.dataset.ready = "1";
        schedule();
      } catch {
        // 🔴 조용히 죽지 말 것 — 포스터만 남으면 "스크롤이 안 먹는다"로 보인다.
        viewport.dataset.fallback = "1";
      }
    };
    void start();

    addEventListener("resize", schedule);
    if (!reduce) addEventListener("scroll", schedule, { passive: true });
    schedule();

    return () => {
      disposed = true;
      teardownPending?.(); // start()가 loadedmetadata/seeked 대기 중이면 그 임시 리스너까지 뗀다
      film.removeEventListener("seeked", onSeeked);
      removeEventListener("resize", schedule);
      removeEventListener("scroll", schedule);
      removeEventListener("touchstart", prime);
      removeEventListener("pointerdown", prime);
    };
  }, []);

  return (
    <section className="ac-scene" ref={sceneRef}>
      <div className="ac-viewport" ref={viewportRef}>
        <div className="ac-gate">
          {/* 영상이 준비되기 전/실패해도 화면이 서 있게 하는 한 장 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ac-poster" src={POSTER} alt="" aria-hidden="true" />
          <video
            className="ac-film"
            ref={filmRef}
            src={SRC}
            poster={POSTER}
            playsInline
            muted
            preload="auto"
            disablePictureInPicture
            aria-label="인재원 입구에서 들어와 복도를 지나 상담 데스크까지 걸어가는 장면"
          />
          <div className="ac-scrim" aria-hidden="true" />
        </div>
        {children}
      </div>
    </section>
  );
}
