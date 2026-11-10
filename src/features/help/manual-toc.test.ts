import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, SUBTABS_BY_MENU } from "@/lib/navigation";
import { OWNER_TABS } from "@/features/owner/tabs";
import { onboardingSteps } from "@/features/onboarding/steps";

/**
 * 사용 설명서(PDF) 목차가 앱과 어긋나지 않게 잠근다(원장 2026-09-23 *"업데이트할때마다 pdf도 업데이트해야"*).
 * 사이드바에 메뉴·하부탭을 새로 만들면 설명서 목차(docs/manual/toc.json)와 면 파일도 함께 만들어야 이 테스트가 통과한다.
 */
const MANUAL = path.resolve(__dirname, "../../../docs/manual");
const toc = JSON.parse(fs.readFileSync(path.join(MANUAL, "toc.json"), "utf8")) as {
  groups: { title: string; menus: { slug: string; title: string; faces: { slug: string; title: string }[] }[] }[];
};
const faces = toc.groups.flatMap((g) => g.menus.flatMap((m) => m.faces.map((f) => ({ id: `${m.slug}/${f.slug}`, file: path.join(MANUAL, "pages", m.slug, `${f.slug}.json`) }))));
const pages = faces.filter((f) => fs.existsSync(f.file)).map((f) => ({ ...f, page: JSON.parse(fs.readFileSync(f.file, "utf8")) as { href: string } }));
// 면 파일이 메뉴의 한 면(`/exams?tab=records`)을 찍으면 그 메뉴 입구(`/exams`)도 설명서가 다룬 것으로 본다 —
// 사이드바에 하부탭이 없는 메뉴가 안쪽 면(FaceTabs)을 골라 설명하는 경우(2026-09-30 성적관리).
const hrefs = new Set(pages.flatMap((p) => [p.page.href, p.page.href.split("?")[0]]));

/** 설명서가 일부러 다루지 않는 입구 — 이유와 함께. */
const NOT_IN_MANUAL = new Map<string, string>([
  ["/help/icons", "아이콘 목록은 개발 참고 화면이다"],
  ["/shuttle/classes", "새 화면(2026-10-27) — 설명서 면은 다음 설명서 갱신 때 만든다"],
  ["/admin", "숨은 관리자 도구(원장 화면이 아니다)"],
  ["/shuttle/track", "위치를 보내는 기능이 아직 없어 자리만 잡아 둔 화면"],
  ["/shuttle/nearby", "새 화면(2026-10-27) — 설명서 면은 다음 설명서 갱신 때 만든다"],
  ["/duties", "아직 공개 전인 화면(2026-11-10 · 원장 화면까지 끝나고 점검한 뒤 공개) — 설명서 면은 공개할 때 만든다"],
]);

describe("사용 설명서 목차", () => {
  it("목차의 모든 면에 내용 파일이 있다", () => {
    expect(faces.filter((f) => !fs.existsSync(f.file)).map((f) => f.id)).toEqual([]);
  });

  it("사이드바의 모든 메뉴·하부탭이 설명서에 있다", () => {
    const entrances = new Set<string>();
    for (const g of NAV_GROUPS) for (const item of g.items) if (!item.hidden || item.teacherMenuEntry) entrances.add(item.href);
    for (const tabs of Object.values(SUBTABS_BY_MENU)) for (const t of tabs ?? []) entrances.add(t.href);
    for (const t of OWNER_TABS) entrances.add(t.href);
    const missing = [...entrances].filter((h) => !NOT_IN_MANUAL.has(h) && !hrefs.has(h));
    expect(missing).toEqual([]);
  });

  it("'처음 시작하기'가 앱의 시작하기 카드 단계를 모두 설명한다", () => {
    const start = JSON.parse(fs.readFileSync(path.join(MANUAL, "pages/00-start.json"), "utf8")) as { steps: Record<string, { see?: string[] }> };
    const keys = onboardingSteps({} as never).map((s) => s.key);
    expect(keys.filter((k) => !start.steps[k])).toEqual([]);
    const ids = new Set(faces.map((f) => f.id));
    const dead = Object.values(start.steps).flatMap((s) => s.see ?? []).filter((id) => !ids.has(id));
    expect(dead).toEqual([]);
  });
});
