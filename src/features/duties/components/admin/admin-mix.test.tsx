import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Counts } from "../../view-admin";
import { MIX_COLOR, MixBar, MixLegend, OntimeOnlyProvider, PROGRESS_COLOR } from "./admin-mix";

const c = (total: number, done: number, due: number, ontime: number, late = 0, o: Partial<Counts> = {}): Counts => ({ total, done, due, ontime, late, lateDone: 0, expired: 0, over7: 0, ...o });
/** 막대 안 조각들의 [색, 폭]. */
const segs = (html: string) => [...html.matchAll(/<span class="h-full" style="width:([\d.]+)%;min-width:2px;background:(#[0-9a-f]{6})"/g)].map((m) => [m[2], Math.round(Number(m[1]) * 100) / 100]);

describe("MixBar — 가로 막대 하나", () => {
  it("🔴 때가 된 업무 = 건수 비율 그대로 기한 내 · 기한 후 완료 · 미처리 순(남음은 조각 없이 빈 바탕) / 기한 내만 보기 = 기한 내 조각 하나", () => {
    // 원장이 든 예: 28 · 70 · 2
    const x = c(100, 98, 100, 28, 2, { lateDone: 70 });
    expect(segs(renderToStaticMarkup(<MixBar cell={x} />))).toEqual([[MIX_COLOR.ontime, 28], [MIX_COLOR.lateDone, 70], [MIX_COLOR.missed, 2]]);
    expect(segs(renderToStaticMarkup(<MixBar cell={x} ontimeOnly />))).toEqual([[MIX_COLOR.ontime, 28]]);
    // 남은 것(때는 됐고 기한 전) 13건은 조각이 없다 — 빈 바탕이 그 몫이다.
    expect(segs(renderToStaticMarkup(<MixBar cell={c(100, 85, 100, 85, 2)} />))).toEqual([[MIX_COLOR.ontime, 85], [MIX_COLOR.missed, 2]]);
    expect(renderToStaticMarkup(<MixBar cell={x} />)).toContain(`background:${MIX_COLOR.left}`);
  });
  it("🔴 때가 안 된 업무(기한 전의 학생 상담 · 월말평가)도 막대로 — 벌써 끝낸 몫을 옅은 노랑 하나로 · 0건이면 빈 바탕 · 진한 색은 쓰지 않는다", () => {
    expect(segs(renderToStaticMarkup(<MixBar cell={c(19, 9, 0, 0)} />))).toEqual([[PROGRESS_COLOR, 47.37]]); // 9/19
    expect(segs(renderToStaticMarkup(<MixBar cell={c(30, 0, 0, 0)} />))).toEqual([]);
    // 기한 내만 보기여도 진행 막대는 그대로다(벌써 끝낸 것은 모두 기한 안이다).
    expect(segs(renderToStaticMarkup(<MixBar cell={c(10, 5, 0, 0)} ontimeOnly />))).toEqual([[PROGRESS_COLOR, 50]]);
    // 때가 된 업무가 하나라도 있으면 진행 조각을 섞지 않는다(그 칸은 때가 된 것만 그린다).
    expect(segs(renderToStaticMarkup(<MixBar cell={c(40, 12, 10, 8, 1, { lateDone: 1 })} />)).map(([k]) => k)).toEqual([MIX_COLOR.ontime, MIX_COLOR.lateDone, MIX_COLOR.missed]);
    expect(PROGRESS_COLOR).not.toBe(MIX_COLOR.ontime);
    // 업무가 없으면 조각 없음
    expect(segs(renderToStaticMarkup(<MixBar cell={c(0, 0, 0, 0)} />))).toEqual([]);
  });
  it("풀이 — 숫자의 이름과 색 이름(기한 내 · 기한 후 완료 · 미처리 · 남음) · '진행'은 그 막대가 표에 있을 때만 / 기한 내만 보기면 기한 내(· 진행)", () => {
    const all = renderToStaticMarkup(<MixLegend progress />);
    for (const t of ["숫자 = 완료율", "기한 내", "기한 후 완료", "미처리", "남음", "진행"]) expect(all).toContain(t);
    // 일간 업무뿐인 표(하루 · 한 주)에는 진행 막대가 없다 — 표에 없는 색을 풀이에 세우지 않는다.
    expect(renderToStaticMarkup(<MixLegend />)).not.toContain("진행");
    const only = renderToStaticMarkup(<OntimeOnlyProvider value><MixLegend progress /></OntimeOnlyProvider>);
    expect(only).toContain("숫자 = 기한 내 완료율");
    expect(only).toContain("진행");
    for (const t of ["기한 후 완료", "미처리", "남음"]) expect(only).not.toContain(t);
  });
});
