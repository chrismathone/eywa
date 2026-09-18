"use client";

import { useMemo, useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { dotProps } from "@/features/calendar/color";
import type { CalendarTag } from "@/features/calendar/types";
import type { EventRowData } from "./event-row";
import { StatsCellDialog, type CellGroup, type PickedCell } from "./stats-cell-dialog";

/**
 * 분석 요약표(태그 × 연도 × 월 건수) — **숫자를 누르면 그 칸의 일정이 모달로 열린다**
 * (원장 2026-08-20: *"숫자로 된 거 누르면 모달로 무슨 행사가 몇 건인지 바로 볼 수 있게"*).
 *
 * 🔑 표를 클라이언트로 내린 이유: 모달이 보여줄 목록은 **그 칸을 만든 바로 그 일정들**이라야 한다.
 *    건수만 서버에서 세어 내려보내면 모달이 같은 규칙을 다시 구현하게 되고, 그 순간 표와 목록이
 *    갈릴 수 있다. 여기서는 `events` 하나에서 건수와 목록이 **같은 필터**(`inGroup`)로 나온다.
 * ⚠️ 집계 기준은 연대기와 같은 **시작일**이다(규칙이 갈리면 표와 목록의 숫자가 어긋난다).
 * ⚠️ 표는 드래그-팬(DragScrollArea) 안이지만 5px 임계값 아래 클릭은 그대로 전달된다 —
 *    끌었을 때만 뒤따르는 click 1회가 삼켜진다(팬과 열기가 안 다툰다, [[#97]]과 다른 경로).
 */

const NONE_KEY = "__none__";
const ALL_KEY = "__all__";
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * 열 구분선 — 표 규약(행 구분선보다 한 단계 옅게, `docs/design-conventions.md`).
 *
 * ⚠️ 규약은 "셀마다 말고 **표 한 곳**에서 `[&_tr>*:not(:first-child)]`로 걸라"고 하지만 이 표만
 *    예외다 — 태그 칸이 `rowSpan`이라 연도 2·3행에는 그 칸이 아예 없고, 그 행에서는 **연도 칸이
 *    `:first-child`가 된다**. 표 한 곳에서 걸면 그 행들만 태그↔연도 사이 선이 끊겨 세로선이
 *    계단처럼 토막 난다. 그래서 여기서만 칸마다 붙이되, 값은 이 상수 하나에서 온다.
 */
const DIVIDER = "border-line-faint border-l";

/**
 * 열 폭(%) — `table-fixed`이라 **내용이 폭을 못 흔든다**.
 *
 * 🔴 자동 폭이면 12개 월 열이 서로 다른 폭이 된다: 브라우저가 각 열의 최장 내용에서 폭을 뽑아
 *    `1월`보다 `12월`이 넓고, 두 자리 건수가 선 달이 또 넓어진다. 이 표는 태그 × 월 **행렬**이라
 *    열 폭이 균등해야 같은 달을 세로로 훑을 때 숫자가 줄을 이룬다(원장 2026-09-09 *"내용이 열정렬
 *    전혀 안되어있는것 같은데"*). 앱의 다른 데이터 표(재고·신규생·학생·자리 출석부)도 전부
 *    `table-fixed` + `colgroup`이고 이 표만 빠져 있었다.
 * ⚠️ **px이 아니라 %** — 태그 열만 폭을 비워 두면 창을 최대화했을 때 남는 폭을 그 열이 **혼자** 먹어
 *    태그 1,500px 옆에 50px짜리 월 열이 선다. %는 표 폭을 그대로 나눠 갖게 해서 넓히든 좁히든
 *    **월 12칸의 균등**이 유지된다(학생목록 colgroup과 같은 방식).
 * ⚠️ 하한(`min-w-[820px]`) 기준 실측: 월 6% = 49px ≥ `12월`(굵게 34 + px-1.5 12) · 연도 7% = 57 ≥
 *    `2026`(고정폭 38 + px-2 16) · 태그 14% = 115(점 8 + 틈 6 + px-3 24 + 이름 ~77).
 */
const TAG_W = "14%";
const YEAR_W = "7%";
const MONTH_W = "6%"; // × 12 = 72%
const TOTAL_W = "7%";

const emptyMonths = () => Array.from({ length: 12 }, () => 0);
const yearOf = (e: EventRowData) => Number(e.startDate.slice(0, 4));
const monthOf = (e: EventRowData) => Number(e.startDate.slice(5, 7));

/** 그룹(태그·태그없음·전체)에 속하는가 — 건수와 모달 목록이 **같은 판정**을 쓴다. */
function inGroup(e: EventRowData, key: string): boolean {
  if (key === ALL_KEY) return true;
  if (key === NONE_KEY) return !e.tag;
  return e.tag?.id === key;
}

/**
 * 숫자 칸 — 0건은 누를 게 없으니 점만, 1건 이상은 버튼.
 * ⚠️ `cursor-pointer`가 필요하다 — 넘치는 표 위에서는 컨테이너가 `cursor-grab`(끌기 손)이라
 *    아무 표시가 없으면 "누르는 것"이 아니라 "끄는 것"으로 읽힌다. 점선 밑줄은 터치처럼 hover가
 *    없는 환경에서도 남는 상시 단서다.
 */
function CountCell({
  n,
  strong,
  onOpen,
  label,
}: {
  n: number;
  strong?: boolean;
  onOpen: () => void;
  /** 스크린리더·툴팁용 — "설명회 2026년 5월 4건 보기". */
  label: string;
}) {
  if (n === 0) {
    return <span className={`text-text-faint ${strong ? "font-normal" : ""}`}>·</span>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={`decoration-line-faint hover:bg-primary-soft hover:text-primary focus-visible:ring-primary/60 -mx-1 cursor-pointer rounded px-1.5 py-0.5 underline decoration-dotted underline-offset-2 transition focus-visible:ring-2 focus-visible:outline-none ${
        strong ? "font-bold" : ""
      }`}
    >
      {n}
    </button>
  );
}

export function StatsMatrix({
  years,
  events,
  tags,
}: {
  /** 분석 창(오름차순) — 보통 [전년, 해당연도, 다음연도]. */
  years: number[];
  /** 창과 겹치는 수기 일정 전건(태그 필터 미적용 — 요약표는 전체가 있어야 비교가 된다). */
  events: EventRowData[];
  tags: CalendarTag[];
}) {
  const [picked, setPicked] = useState<PickedCell | null>(null);

  // 태그키 → 연도 → 월별 건수. 요약표의 모든 칸이 이 한 맵에서 나온다.
  const { counts, groups } = useMemo(() => {
    const map = new Map<string, Map<number, number[]>>();
    for (const e of events) {
      if (!years.includes(yearOf(e))) continue;
      const key = e.tag?.id ?? NONE_KEY;
      const byYear = map.get(key) ?? new Map<number, number[]>();
      const arr = byYear.get(yearOf(e)) ?? emptyMonths();
      arr[monthOf(e) - 1] += 1;
      byYear.set(yearOf(e), arr);
      map.set(key, byYear);
    }
    const gs: CellGroup[] = [
      ...tags.map((t) => ({ key: t.id, label: t.name, color: t.color })),
      ...(map.has(NONE_KEY) ? [{ key: NONE_KEY, label: "태그 없음" }] : []),
      { key: ALL_KEY, label: "전체", strong: true },
    ];
    return { counts: map, groups: gs };
  }, [events, years, tags]);

  function monthsFor(key: string, year: number): number[] {
    if (key !== ALL_KEY) return counts.get(key)?.get(year) ?? emptyMonths();
    const out = emptyMonths();
    for (const byYear of counts.values()) {
      const arr = byYear.get(year);
      if (arr) for (let i = 0; i < 12; i += 1) out[i]! += arr[i]!;
    }
    return out;
  }

  /** 열린 칸의 일정 — 건수를 만든 것과 **같은 조건**으로 뽑는다(모달이 다시 세지 않는다). */
  const pickedEvents = useMemo(() => {
    if (!picked) return [];
    return events
      .filter(
        (e) =>
          yearOf(e) === picked.year &&
          (picked.month === null || monthOf(e) === picked.month) &&
          inGroup(e, picked.group.key),
      )
      .sort(
        (a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, "ko"),
      );
  }, [picked, events]);

  return (
    <>
      <DragScrollArea className="bg-card shadow-card rounded-2xl">
        <table className="w-full min-w-[820px] table-fixed text-sm">
          <colgroup>
            {/* 태그 · 연도 · 12개월(균등) · 합계 = 100% */}
            <col style={{ width: TAG_W }} />
            <col style={{ width: YEAR_W }} />
            {MONTHS.map((m) => (
              <col key={m} style={{ width: MONTH_W }} />
            ))}
            <col style={{ width: TOTAL_W }} />
          </colgroup>
          <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
            <tr className="text-text-dim text-sm [&_th]:font-bold">
              {/* 태그는 제목·값 모두 왼쪽 — 색 점이 앞에 서서 가운데로 모으면 이름 길이마다 점이 들쭉날쭉해진다(원장 2026-09-18 실측). */}
              <th className="px-3 py-2 text-left">태그</th>
              <th className={`px-2 py-2 text-center ${DIVIDER}`}>연도</th>
              {MONTHS.map((m) => (
                <th key={m} className={`px-1.5 py-2 text-center ${DIVIDER}`}>
                  {m}월
                </th>
              ))}
              <th className={`px-2 py-2 text-center ${DIVIDER}`}>합계</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {groups.map((g) =>
              years.map((y, yi) => {
                const arr = monthsFor(g.key, y);
                const total = arr.reduce((a, b) => a + b, 0);
                const dot = g.color ? dotProps(g.color) : null;
                return (
                  <tr
                    key={`${g.key}-${y}`}
                    className={g.strong ? "bg-bg-soft/40" : "hover:bg-bg-soft/30"}
                  >
                    {yi === 0 ? (
                      // 고정 폭이 됐으니 긴 태그 이름은 칸 안에서 자른다(전문은 마우스 오버).
                      // ⚠️ `truncate`는 **점(dot)이 아니라 이름 span**에 건다 — 인라인 요소엔 overflow가
                      //    안 먹고([[#111]]), 점까지 같이 줄면 색 표식이 사라진다.
                      <td
                        rowSpan={years.length}
                        className={`overflow-hidden px-3 py-2 align-top text-sm ${
                          g.strong ? "font-bold" : ""
                        } ${g.key === NONE_KEY ? "text-text-dim" : ""}`}
                      >
                        <span className="flex items-center gap-1.5" title={g.label}>
                          {dot ? (
                            <span
                              className={`size-2 shrink-0 rounded-full ${dot.className}`}
                              style={dot.style}
                              aria-hidden
                            />
                          ) : null}
                          <span className="min-w-0 truncate">{g.label}</span>
                        </span>
                      </td>
                    ) : null}
                    <td className={`num text-text-dim px-2 py-2 text-center text-sm ${DIVIDER}`}>
                      {y}
                    </td>
                    {/* 🔑 건수는 **우측이 아니라 가운데**다 — 데이터 표 규약의 "본문 좌측"도, 금액·수량의
                        "숫자는 우측"도 여기선 아니다. 이 칸은 목록의 값이 아니라 **행렬의 눈금**이고
                        (같은 달을 세로로, 같은 태그를 가로로 읽는다) 1~2자리라 자릿수를 맞출 것도 없다.
                        위아래 줄맞춤은 `num`(고정폭 숫자) + 균등 열 폭이 이미 잡아 준다. */}
                    {arr.map((n, i) => (
                      <td key={i} className={`num px-1.5 py-2 text-center text-sm ${DIVIDER}`}>
                        <CountCell
                          n={n}
                          onOpen={() => setPicked({ group: g, year: y, month: i + 1 })}
                          label={`${g.label} ${y}년 ${i + 1}월 ${n}건 보기`}
                        />
                      </td>
                    ))}
                    <td className={`num px-2 py-2 text-center text-sm ${DIVIDER}`}>
                      <CountCell
                        n={total}
                        strong
                        onOpen={() => setPicked({ group: g, year: y, month: null })}
                        label={`${g.label} ${y}년 전체 ${total}건 보기`}
                      />
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
        <p className="text-text-faint border-line border-t px-3 py-1.5 text-xs">
          숫자를 누르면 그 칸의 일정이 열립니다 · 여러 날 일정은 시작일 기준 1건 ·{" "}
          <span className="num">{years[0]}</span>년 이전에 시작해 이어지는 일정은 집계·목록에 없습니다
        </p>
      </DragScrollArea>

      {picked ? (
        <StatsCellDialog picked={picked} events={pickedEvents} onClose={() => setPicked(null)} />
      ) : null}
    </>
  );
}
