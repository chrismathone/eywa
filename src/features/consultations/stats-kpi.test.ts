import { describe, expect, it } from "vitest";
import { buildKpiLines } from "./stats-kpi";
import { statsScopeText } from "./stats-scope";
import { CONSULT_DEFAULT_PAGE_SIZE, consultationsHref, consultationsStatsHref, type ConsultationListParams } from "./list-href";
import type { ConsultationStats } from "./stats-model";

/**
 * 원생상담 요약 띠 ↔ 통계 화면이 **같은 함수**로 숫자·문구·주소를 짓는다(원장 2026-10-01 — 통계를 목록 옆에서 전용 화면으로).
 * 여기 잠그는 것: 두 표면이 같은 입력에서 같은 줄을 내는지 · 0318a 전 대체 경로 · 목록 ↔ 통계 주소 왕복에서 필터·쪽이 안 빠지는지.
 */

const totals = { n: 20, students: 8, done: 6, pending: 2, overdue: 1, audio: 4, ai: 2, synced: 15, mapped: 18, judged: 19, first: "2026-03-02", last: "2026-09-30" };
const full: ConsultationStats = { full: true, today: "2026-10-01", totals, buckets: { month: [], week: [] }, dims: {} };
const head: ConsultationStats = { full: false, today: "2026-10-01", totals: { n: 20, done: 6, pending: 2, overdue: 0, audio: 4, ai: 2, synced: 15 } };
const params: ConsultationListParams = { range: "all", cat: "all", urg: "all", who: "", subject: "", q: "", size: CONSULT_DEFAULT_PAGE_SIZE, page: 1 };

describe("상담 지표 줄(buildKpiLines)", () => {
  it("전체 경로 = 6줄, 꺼진 축은 흔적 없이", () => {
    expect(buildKpiLines(full, { syncOn: true, classOn: true }).map((l) => l.metric)).toEqual(["count", "perStudent", "follow", "media", "sync", "class"]);
    expect(buildKpiLines(full, { syncOn: false, classOn: true }).map((l) => l.metric)).not.toContain("sync");
  });

  it("값 — 1인당·후속 완료율·미매핑(판정 전 수 함께)", () => {
    const lines = buildKpiLines(full, { syncOn: true, classOn: true });
    const v = (m: string) => lines.find((l) => l.metric === m);
    expect(v("count")?.value).toBe("20건");
    expect(v("perStudent")?.value).toBe("2.5건");
    expect(v("follow")?.value).toBe("75%");
    expect(v("class")?.value).toBe("10%");
    expect(v("class")?.sub).toContain("아직 판정 안 한 기록 1건");
  });

  it("링크 주소를 안 주면(요약 띠) 링크가 없다 · 주면 지연이 먼저", () => {
    expect(buildKpiLines(full, { syncOn: true, classOn: true }).every((l) => !l.link)).toBe(true);
    const follow = buildKpiLines(full, { syncOn: true, classOn: true, overdueHref: "/o", doneHref: "/d" }).find((l) => l.metric === "follow");
    expect(follow?.link).toEqual({ href: "/o", text: "지연 1건" });
  });

  it("0318a 전(헤드 카운트) = 원생 수·반 칸이 없어 그 줄은 빠진다", () => {
    const lines = buildKpiLines(head, { syncOn: true, classOn: true, overdueHref: "/o", doneHref: "/d" });
    expect(lines.map((l) => l.metric)).toEqual(["count", "follow", "media", "sync"]);
    expect(lines[0]?.sub).toBeUndefined();
    expect(lines.find((l) => l.metric === "follow")?.link).toEqual({ href: "/d", text: "완료 보기" });
  });
});

describe("기간·범위 문구(statsScopeText)", () => {
  const o = { teacherScoped: false, whoLabel: "김선생", subjectLabel: "수학" };

  it("전체면 실제 첫·마지막 상담일 · 필터 없으면 학원 전체", () => {
    expect(statsScopeText(full, params, o)).toEqual({ period: "전체 기간(3/2~9/30)", rangeText: "전체 기간", scope: "학원 전체", searchExcluded: false });
  });

  it("걸린 필터를 다 적고, 검색어는 범위 문구가 아니라 따로 표시한다(말줄임에 먹히지 않게)", () => {
    const r = statsScopeText(full, { ...params, range: "7d", cat: "academic", urg: "overdue", who: "u1", subject: "math", q: "김" }, o);
    expect(r.rangeText).toBe("최근 7일");
    expect(r.scope).toBe("카테고리 학습 · 후속 지연 · 상담사 김선생 · 과목 수학");
    expect(r.searchExcluded).toBe(true);
  });

  it("강사는 '내가 기록한 상담' — 상담사 필터는 적지 않는다", () => {
    expect(statsScopeText(head, { ...params, who: "u1" }, { ...o, teacherScoped: true }).scope).toBe("내가 기록한 상담");
  });
});

describe("목록 ↔ 통계 주소", () => {
  const p: ConsultationListParams = { ...params, range: "30d", who: "u1", subject: "math", q: "김", size: 18, page: 3 };

  it("목록 → 통계 → '목록으로'가 필터·검색어·쪽·쪽 크기를 그대로 돌려준다", () => {
    const stats = consultationsStatsHref(p);
    expect(stats).toBe("/consultations/stats?range=30d&who=u1&subject=math&q=%EA%B9%80&size=18&page=3");
    expect(consultationsHref(p, CONSULT_DEFAULT_PAGE_SIZE)).toBe(stats.replace("/consultations/stats", "/consultations"));
  });

  it("통계 안에서 값 하나로 거르면 1쪽으로", () => {
    expect(consultationsStatsHref(p, { cat: "career" })).toBe("/consultations/stats?range=30d&cat=career&who=u1&subject=math&q=%EA%B9%80&size=18");
  });

  it("쪽 크기가 기본값이면 주소에서 뺀다(쿠키가 정한다)", () => {
    expect(consultationsStatsHref({ ...params, page: 1 })).toBe("/consultations/stats");
  });
});
