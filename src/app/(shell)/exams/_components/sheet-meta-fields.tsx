"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";

/**
 * 성적표의 **시험일·만점** — 주소에 실어 격자·엑셀·저장이 같은 값을 보게 한다.
 *
 * 🔑 왜 주소인가: 내려받는 시트가 "무슨 시험의 몇 점 만점인지"를 스스로 말해야 하고(엑셀 안내 시트),
 *    저장도 같은 값을 써야 한다. 폼 안에만 두면 셋이 갈린다.
 * ⚠️ 이동은 `HrefSelect`와 같은 규약 — `startTransition` + `router.push(scroll:false)`(이전 화면 유지),
 *    창(iframe) 안이면 `embed=1` 동행.
 * ⚠️ 만점은 **커밋(blur·Enter)에서만** 이동한다 — 입력 한 글자마다 주소를 바꾸면 `1`→`10`→`100`을
 *    치는 동안 세 번 이동한다.
 */
export function SheetMetaFields({
  date,
  maxScore,
  dateHref,
  maxHref,
}: {
  date: string;
  maxScore: number;
  /** `__V__` 자리에 값을 끼워 이동한다(서버가 만든 주소 틀). */
  dateHref: string;
  maxHref: string;
}) {
  const router = useRouter();
  const embed = useEmbed();
  const [, start] = useTransition();
  // 🔴 만점 칸은 **비제어**다 — 서버 값이 바뀌면 `key`로 갈아 끼워 다시 선다. effect에서 setState로
  //    맞추면 React 규칙 위반이고(연쇄 렌더, [[#25]]) 타이핑 중 값이 되돌아간다.
  const maxRef = useRef<HTMLInputElement>(null);

  const go = (template: string, value: string) => {
    const href = template.replace("__V__", encodeURIComponent(value));
    start(() => router.push(embed ? withEmbed(href) : href, { scroll: false }));
  };

  const commitMax = () => {
    const el = maxRef.current;
    if (!el) return;
    const n = Number(el.value.trim());
    if (!Number.isFinite(n) || n <= 0 || n > 1000) {
      el.value = String(maxScore); // 못 쓰는 값은 조용히 되돌린다(주소를 더럽히지 않게)
      return;
    }
    const next = String(Math.round(n));
    if (next === String(maxScore)) return;
    go(maxHref, next);
  };

  return (
    <>
      <label className={`${TOOLBAR_SELECT} gap-1.5`}>
        <span className="text-text-dim shrink-0"><SheetText value={"시험일"} /></span>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) go(dateHref, e.target.value);
          }}
          className="text-foreground num bg-transparent focus:outline-none"
          aria-label="시험일"
        />
      </label>
      <label className={`${TOOLBAR_SELECT} gap-1.5`}>
        <span className="text-text-dim shrink-0"><SheetText value={"만점"} /></span>
        <input
          key={maxScore}
          ref={maxRef}
          type="number"
          min="1"
          max="1000"
          defaultValue={maxScore}
          onBlur={commitMax}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitMax();
            }
          }}
          className="text-foreground num w-14 bg-transparent text-right focus:outline-none"
          aria-label="만점"
        />
      </label>
    </>
  );
}
