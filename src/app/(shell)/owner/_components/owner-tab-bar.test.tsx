import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NavigationProvider } from "@/features/owner/navigation-context";
import { EmbedProvider } from "@/components/workspace/embed-context";
import { OWNER_FACES, type OwnerFaceKey } from "@/features/owner/tabs";
import { OwnerTabBar } from "./owner-tab-bar";

/**
 * 학원 설정 상단 탭(2026-10-06, 설정 정리 3단계) — 실제 탭 바를 세워 본다.
 * 줄 구성의 규칙은 `tab-rows.test.ts`가 맡고, 여기는 화면에 선 결과(줄 · 켜진 칸 · 주소 · 사용자 지정 이름)를 본다.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ subscribeRecordSaved: () => () => {} }));
afterEach(cleanup);

const CHINSAN = OWNER_FACES.filter((f) => !f.genericOnly);
const pick = (...keys: OwnerFaceKey[]) => OWNER_FACES.filter((f) => keys.includes(f.key));
const CATEGORY_NAV = "학원 설정 범주 전환";
const FACE_NAV = "학원 설정·관리 면 전환";
const names = (nav: HTMLElement) => within(nav).getAllByRole("link").map((a) => a.textContent);
const current = (nav: HTMLElement) => within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);

describe("두 줄", () => {
  it("원장: 범주 줄과 그 범주의 면 줄이 서고, 각 줄에서 지금 것이 켜진다", () => {
    render(<OwnerTabBar faces={CHINSAN} active="notifications" />);
    const categories = screen.getByRole("navigation", { name: CATEGORY_NAV });
    const faces = screen.getByRole("navigation", { name: FACE_NAV });
    expect(names(categories)).toEqual(["학원 정보", "수업·운영", "청구·안내", "권한·화면", "관리"]);
    expect(current(categories)).toEqual(["청구·안내"]);
    expect(names(faces)).toEqual(["수납·청구", "알림·약관", "상담 양식"]);
    expect(current(faces)).toEqual(["알림·약관"]);
  });

  it("범주 칸은 그 범주의 첫 면 주소로, 지금 범주 칸은 지금 면 주소로 간다", () => {
    render(<OwnerTabBar faces={CHINSAN} active="notifications" />);
    const categories = screen.getByRole("navigation", { name: CATEGORY_NAV });
    const href = (name: string) => within(categories).getByRole("link", { name }).getAttribute("href");
    expect(href("수업·운영")).toBe("/owner?tab=operations");
    expect(href("관리")).toBe("/owner?tab=popups");
    expect(href("청구·안내")).toBe("/owner?tab=notifications");
  });

  it("🔴 창 안에서는 두 줄 모두 창 표식(embed)을 싣고 간다 — 빼면 창 안에 전체 화면 틀이 뜬다", () => {
    render(
      <EmbedProvider embed>
        <OwnerTabBar faces={CHINSAN} active="subjects" />
      </EmbedProvider>,
    );
    for (const nav of [CATEGORY_NAV, FACE_NAV]) {
      for (const link of within(screen.getByRole("navigation", { name: nav })).getAllByRole("link")) {
        expect(link.getAttribute("href"), link.textContent ?? "").toContain("embed=1");
      }
    }
  });

  it("🔴 범주 칸은 묶음이지 목적지가 아니다 — 그 주소(범주의 첫 면)에 저장된 메뉴 구성 행이 범주 이름을 바꾸지 않는다", () => {
    // 설정의 면은 고정 목적지라 개명되지 않는다(menu-layout.ts). 그래도 그 주소의 행이 저장돼 있으면(옛 값 · 손상된 값)
    // 탭 바는 그 주소의 **면 이름**을 칸에 적는다 — 범주 칸이 그 길을 타면 '수업·운영'이 '운영 체계'로 바뀐다.
    render(
      <NavigationProvider menus={[{ href: "/owner?tab=operations", label: "우리 학원 운영" }, { href: "/owner", label: "학원 소개" }]}>
        <OwnerTabBar faces={CHINSAN} active="operations" />
      </NavigationProvider>,
    );
    expect(names(screen.getByRole("navigation", { name: CATEGORY_NAV }))).toEqual(["학원 정보", "수업·운영", "청구·안내", "권한·화면", "관리"]);
    // 면 줄은 종전 그대로 — 설정의 면은 개명 대상이 아니다.
    // 2026-10-22 원생 기여도 면(contribution, 운영 체계 범주 · 시범 지점만)이 더해졌다 — 고정값 CHINSAN은 OWNER_FACES 전부라 함께 선다.
    expect(names(screen.getByRole("navigation", { name: FACE_NAV }))).toEqual(["운영 체계", "과목 운영", "보강 운영", "강사평가", "원생 로열티"]);
  });

  it("원장 위에게만 서는 면(보강 운영)은 위임 계정의 면 줄에 없다", () => {
    render(<OwnerTabBar faces={CHINSAN.filter((f) => !f.masterOnly)} active="operations" />);
    expect(names(screen.getByRole("navigation", { name: FACE_NAV }))).toEqual(["운영 체계", "과목 운영"]);
  });

  it("입구가 안 서는 면에 주소로 직접 왔다 — 범주는 켜지고 면 줄에는 켜진 칸이 없다", () => {
    render(<OwnerTabBar faces={CHINSAN.filter((f) => !f.masterOnly)} active="audit" />);
    expect(current(screen.getByRole("navigation", { name: CATEGORY_NAV }))).toEqual(["관리"]);
    const faces = screen.getByRole("navigation", { name: FACE_NAV });
    expect(names(faces)).toEqual(["팝업 공지", "데이터 정리", "데이터 가져오기", "연동"]);
    expect(current(faces)).toEqual([]);
  });

  it("지금 범주에 열 수 있는 면이 없으면 면 줄을 세우지 않는다(빈 줄을 남기지 않는다)", () => {
    render(<OwnerTabBar faces={CHINSAN.filter((f) => f.category !== "학원 정보")} active="profile" />);
    expect(screen.getByRole("navigation", { name: CATEGORY_NAV })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: FACE_NAV })).not.toBeInTheDocument();
  });
});

describe("한 줄", () => {
  it("🔴 면을 조금만 맡은 사람에게는 범주 줄이 없다 — 종전 모양 그대로", () => {
    render(<OwnerTabBar faces={pick("operations", "subjects")} active="operations" />);
    expect(screen.queryByRole("navigation", { name: CATEGORY_NAV })).not.toBeInTheDocument();
    const faces = screen.getByRole("navigation", { name: FACE_NAV });
    expect(names(faces)).toEqual(["운영 체계", "과목 운영"]);
    expect(current(faces)).toEqual(["운영 체계"]);
  });
});

describe("배선", () => {
  it("설정 화면은 권한으로 거른 면을 이 탭 바에 넘긴다(면 목록을 따로 세우지 않는다)", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "(shell)", "owner", "page.tsx"), "utf8");
    // 2026-10-22 원생 기여도 면 스위치(showContribution)가 더해졌다 — 면 목록은 여전히 facesFor 한 곳.
    expect(page).toContain("<OwnerTabBar faces={facesFor(canReadAudit, isGenericTenant(settings), showMakeups, showEvaluation, showContribution).filter((face) => allowedTabs.get(face.key))} active={tab} />");
    expect(page).not.toMatch(/<FaceTabs\b/);
  });
});
