/**
 * 원스크린 개인 설정의 주인 — 표시 취향은 보는 사람, 반·보고서에 묶인 값은 화면 주인(2026-11-05 강사뷰 신원 적대 리뷰).
 * 결함 모양: '다른 강사 뷰'에서 글씨 크기를 대상 강사 행에 저장·읽기해, 관리자가 키운 글씨가 강사 X의 원스크린 크기를 바꿨다.
 * 표시 옵션·영상 마감 기본값은 저장이 실제 계정인데 읽기가 X 행이라 눌러도 안 바뀌었다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitOnescreenPrefs } from "./pref-owner";
import { LAST_TEMPLATE_BY_CLASS_PREF, LAST_TEMPLATE_PREF } from "./last-template";
import { TREND_OPTOUT_PREF } from "./trend-optout";
import { VIDEO_DUE_DEFAULT_PREF } from "@/features/video-homework/due-pref";

const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const CLASS = "22222222-2222-4222-8222-222222222222";
const owner = {
  onescreen: {
    fontSize: "lg", sort: "name", hidePrevious: true, [VIDEO_DUE_DEFAULT_PREF]: "next",
    [TREND_OPTOUT_PREF]: ["c1:s1"], [LAST_TEMPLATE_PREF]: TEMPLATE, [LAST_TEMPLATE_BY_CLASS_PREF]: { [CLASS]: TEMPLATE },
  },
};
const viewer = { onescreen: { fontSize: "md", sort: "class", hidePrevious: false } };

describe("splitOnescreenPrefs", () => {
  it("🔴 '다른 강사 뷰': 글씨 크기·표시 옵션·영상 마감 기본값은 보는 사람(실제 계정) 것", () => {
    const s = splitOnescreenPrefs({ viewingOtherTeacher: true, ownerPrefs: owner, viewerPrefs: viewer });
    expect(s.fontSize).toBe("md");
    expect(s.displayOptions).toEqual({ sort: "class", hidePrevious: false });
    expect(s.videoDueDefault).toBe("week"); // 보는 사람은 기본값(7일) — 대상 강사의 '다음 수업'이 새어 들지 않는다
  });

  it("'다른 강사 뷰': 반별 템플릿·학습 추세 미발송은 화면 주인(대상 강사) 것 — 그 강사의 반·학생 키다", () => {
    const s = splitOnescreenPrefs({ viewingOtherTeacher: true, ownerPrefs: owner, viewerPrefs: viewer });
    expect(s.trendOptOut).toEqual(["c1:s1"]);
    expect(s.templatePrefs.byClass[CLASS]).toBe(TEMPLATE);
  });

  it("강사뷰가 아니면 한 행(내 행)을 그대로 읽고 viewerPrefs는 보지 않는다", () => {
    const s = splitOnescreenPrefs({ viewingOtherTeacher: false, ownerPrefs: owner, viewerPrefs: viewer });
    expect(s.fontSize).toBe("lg");
    expect(s.displayOptions).toEqual({ sort: "name", hidePrevious: true });
    expect(s.videoDueDefault).toBe("next");
    expect(s.trendOptOut).toEqual(["c1:s1"]);
  });
});

describe("배선 — 로스터가 이 함수 하나로 나누고, 보는 사람 행은 강사뷰일 때만 읽는다", () => {
  const roster = readFileSync(join(process.cwd(), "src", "features", "onescreen", "server", "roster.ts"), "utf8");
  it("splitOnescreenPrefs에 강사뷰 여부·대상 행·보는 사람 행을 넘긴다", () => {
    expect(roster).toContain("splitOnescreenPrefs({");
    expect(roster).toContain("viewingOtherTeacher: !!viewAs,");
    expect(roster).toContain("ownerPrefs: meRow?.ui_prefs,");
    expect(roster).toContain("viewAs ? viewerUiPrefs(supabase) : Promise.resolve(undefined),");
    // 보는 사람 = 실제 계정(옵션 없는 getCurrentUser)
    const at = roster.indexOf("async function viewerUiPrefs(");
    expect(roster.slice(at, at + 300)).toContain("const me = await getCurrentUser();");
  });
});
