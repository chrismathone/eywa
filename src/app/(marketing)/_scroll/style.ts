import type { CSSProperties } from "react";

/** 인라인 CSS 변수(`--d`·`--steps`·`--a` 등)를 React style로 — `CSSProperties`는 사용자 정의 속성 키를 모른다. */
export const sv = (o: Record<string, string>) => o as CSSProperties;
