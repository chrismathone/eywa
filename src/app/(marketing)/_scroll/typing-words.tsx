"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

/** 선언문 한 조각 — `em`이면 밑줄 강조. */
export type TypingSegment = { text: string; em?: boolean };

const STEP_MS = 32;
const SPACE_MS = 20;
const PAUSE_MS = 250;
const CARET_HIDE_MS = 2000;
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
/** 겹모음 → 앞 모음(중성 순번) · 겹받침 → 앞 받침(종성 순번) — 'ㅇ → 우 → 워 → 원'처럼 실제 입력 순서로 조합한다. */
const VOWEL_FIRST: Record<number, number> = { 9: 8, 10: 8, 11: 8, 14: 13, 15: 13, 16: 13, 19: 18 };
const FINAL_FIRST: Record<number, number> = { 3: 1, 5: 4, 6: 4, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8, 14: 8, 15: 8, 18: 17 };
/** 낱말 잇기(U+2060, 폭 0 · 보이지 않음) — 커서를 앞 글자에 붙인다. */
const WJ = String.fromCharCode(0x2060);
const syl = (l: number, v: number, t: number) => String.fromCharCode(0xac00 + (l * 21 + v) * 28 + t);

/** 한 글자를 치는 동안 보이는 모양들(마지막 = 완성 글자). 한글 음절이 아니면 그 글자 하나. */
export function keystrokes(ch: string): string[] {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return [ch];
  const l = Math.floor(code / 588);
  const v = Math.floor((code % 588) / 28);
  const t = code % 28;
  const out = [CHO[l]];
  if (VOWEL_FIRST[v] !== undefined) out.push(syl(l, VOWEL_FIRST[v], 0));
  out.push(syl(l, v, 0));
  if (t > 0) {
    if (FINAL_FIRST[t] !== undefined) out.push(syl(l, v, FINAL_FIRST[t]));
    out.push(syl(l, v, t));
  }
  return out;
}

/** 타이핑 한 장면 — 조각 번호 · 완성된 글자 수 · 지금 조합 중인 모양("" = 없음) · 다음 장면까지 기다릴 시간. */
type Frame = { seg: number; len: number; partial: string; wait: number };

export function buildFrames(segments: TypingSegment[]): Frame[] {
  const frames: Frame[] = [];
  const lastSeg = segments.length - 1;
  segments.forEach((s, seg) => {
    const chars = Array.from(s.text);
    chars.forEach((ch, i) => {
      const keys = keystrokes(ch);
      keys.forEach((k, j) => {
        const done = j === keys.length - 1;
        const end = seg === lastSeg && i === chars.length - 1;
        const wait = ch === " " ? SPACE_MS : done && !end && /[.,]/.test(ch) ? PAUSE_MS : STEP_MS;
        frames.push({ seg, len: done ? i + 1 : i, partial: done ? "" : k, wait });
      });
    });
  });
  return frames;
}

type Phase = "full" | "armed" | "typing" | "done";

/**
 * 선언문 자모 타이핑(원장 2026-11-10 *"타이핑 되듯이 하나하나 글자 분리해서 자모"* · Codex 5차 협의) — 화면에 절반 넘게 들어오면 한 번만 친다
 * (읽는 글이라 반복해서 지우지 않는다). 아직 안 친 글자도 투명하게 깔아 줄바꿈 자리가 처음부터 끝까지 같다(치는 도중 낱말이 다음 줄로 튀지 않게).
 * 치는 도중 장면을 벗어나면 바로 완성. 처음 상태(서버·JS 전·움직임 줄이기·초기화 실패) = 전체 문장(`data-state` 없음).
 * 화면낭독기는 전체 문장 한 벌만(시각 층은 aria-hidden · 실시간 낭독 없음).
 */
export function TypingWords({ segments, className }: { segments: TypingSegment[]; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [phase, setPhase] = useState<Phase>("full");
  const [frame, setFrame] = useState(0);
  const frames = useMemo(() => buildFrames(segments), [segments]);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let i = 0;
    let typing = false;
    // 끝나면(다 쳤든 장면을 벗어났든) 관찰도 끊는다 — 다시 들어올 때 'typing'으로 돌아가 범례가 깜빡이지 않게.
    const finish = () => { window.clearTimeout(timer); typing = false; io.disconnect(); setPhase("done"); };
    const tick = () => {
      i += 1;
      setFrame(i);
      if (i >= frames.length) { finish(); return; }
      timer = window.setTimeout(tick, frames[i - 1].wait);
    };
    setPhase("armed");
    const io = new IntersectionObserver((es) => {
      const e = es[es.length - 1];
      if (typing) { if (!e.isIntersecting) finish(); return; }
      // 글이 화면보다 아주 커도(낮은 창·확대) 시작하게 — 절반 넘게 보이거나, 보이는 높이가 화면 절반 이상.
      const half = e.intersectionRect.height >= (e.rootBounds?.height ?? window.innerHeight) * 0.5;
      if (!e.isIntersecting || (e.intersectionRatio < 0.5 && !half)) return;
      typing = true;
      setPhase("typing");
      timer = window.setTimeout(tick, 400);
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1] });
    io.observe(el);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, [frames]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = window.setTimeout(() => ref.current?.setAttribute("data-caret", "off"), CARET_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  const cur: Frame | null = phase === "typing" ? (frames[frame - 1] ?? { seg: 0, len: 0, partial: "", wait: 0 }) : null;
  // 커서 속 낱말 잇기(WJ) — 빈 커서는 줄 끝 글자를 칠 때 다음 줄 맨 앞으로 먼저 넘어간다(크롬 실측). 글자에 붙여 둔다.
  // 막 친 빈칸 바로 뒤에서는 뺀다 — 빈칸 뒤 줄바꿈 기회를 지우면(유니코드 규칙대로 끊는 브라우저) 줄 끝 낱말이 한 박자 튈 수 있다.
  const caret = (glue: boolean) => <i className="ty-caret" aria-hidden="true">{glue ? WJ : null}</i>;
  const parts = segments.map((s, i) => {
    const em = s.em ? "em-rule" : undefined;
    // 안 친 부분도 강조 조각이면 같은 굵기·밑줄(밑줄은 투명) — 인쇄에서 되살아날 때 강조가 빠지지 않게.
    const restCls = s.em ? "ty-rest em-rule" : "ty-rest";
    if (phase === "full" || phase === "done") return <Fragment key={i}><span className={em}>{s.text}</span>{phase === "done" && i === segments.length - 1 ? caret(true) : null}</Fragment>;
    if (phase === "armed" || !cur || i > cur.seg) return <Fragment key={i}>{phase === "armed" && i === 0 ? caret(true) : null}<span className={restCls}>{s.text}</span></Fragment>;
    if (i < cur.seg) return <span key={i} className={em}>{s.text}</span>;
    const chars = Array.from(s.text);
    const glue = cur.partial !== "" || chars[cur.len - 1] !== " ";
    const rest = chars.slice(cur.partial ? cur.len + 1 : cur.len).join("");
    return <Fragment key={i}><span className={em}>{chars.slice(0, cur.len).join("") + cur.partial}</span>{caret(glue)}<span className={restCls}>{rest}</span></Fragment>;
  });

  return (
    <p ref={ref} className={`${className ?? ""} typing`} data-state={phase === "full" ? undefined : phase}>
      <span className="sr-only">{segments.map((s) => s.text).join("")}</span>
      <span aria-hidden="true">{parts}</span>
    </p>
  );
}
