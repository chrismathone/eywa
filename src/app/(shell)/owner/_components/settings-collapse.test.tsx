import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * 설정 화면의 접는 카드 · 보강 운영 면(원장 2026-10-06).
 *  · *"강의실과 공휴일은 접기 넣어줘 스크롤 너무 길어짐"* — 줄이 계속 느는 두 목록을 접어 둔다.
 *  · *"보강운영만 별도 저장버튼이 있는데 … 수업 운영에 '보강 운영'을 새로 만들어서 넣어줘"* — 운영 체계 면 아래에
 *    제 저장 버튼을 달고 붙어 있던 보강관리 운영을 제 면으로 옮긴다(다른 설정 묶음이라 저장이 따로다).
 */
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ subscribeRecordSaved: () => () => {}, publishRecordSaved: vi.fn() }));
import { SettingsCard } from "./section-form";

afterEach(cleanup);
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("접는 카드", () => {
  it("🔴 처음엔 접혀 있고, 제목 줄에 이름 · 설명 · 몇 개인지가 보인다", () => {
    const { container } = render(
      <SettingsCard title="강의실" description="강의실명·정원을 등록합니다." collapsible summary="12개">
        <input aria-label="강의실 이름" defaultValue="304호" />
      </SettingsCard>,
    );
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    const summary = details.querySelector("summary")!;
    expect(summary.querySelector("h3")?.textContent).toBe("강의실");
    expect(summary.textContent).toContain("강의실명·정원을 등록합니다.");
    expect(summary.textContent).toContain("12개");
    expect(summary.textContent).toContain("펼치기");
  });

  it("🔴 접혀 있어도 안의 입력을 지우지 않는다 — 내용은 제목 줄 밖 · 접는 틀 안에 그대로 있다", () => {
    const { container } = render(
      <SettingsCard title="공휴일·휴원일" collapsible summary="3일">
        <input aria-label="휴일 이름" defaultValue="개교기념일" />
      </SettingsCard>,
    );
    const input = container.querySelector<HTMLInputElement>('input[aria-label="휴일 이름"]')!;
    expect(input.value).toBe("개교기념일");
    // 내용은 제목 줄(summary) 밖 · details 안에 있다(제목 줄을 눌러 펼친다).
    expect(input.closest("details")).not.toBeNull();
    expect(input.closest("summary")).toBeNull();
  });

  it("펼친 상태에서 내용이 그대로 보인다(틀만 열고 닫는다 — 내용을 다시 만들지 않는다)", () => {
    const { container } = render(
      <SettingsCard title="강의실" collapsible>
        <p>내용</p>
      </SettingsCard>,
    );
    const details = container.querySelector("details")!;
    details.open = true; // 브라우저가 제목 줄 클릭에 하는 일
    expect(details.open).toBe(true);
    expect(screen.getByText("내용")).toBeInTheDocument();
  });

  it("보통 카드는 종전 그대로다(접는 틀이 없다)", () => {
    const { container } = render(
      <SettingsCard title="주말 교시" description="토·일 수업 시간대.">
        <p>내용</p>
      </SettingsCard>,
    );
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("h3")?.textContent).toBe("주말 교시");
    expect(container.querySelector("section > p")?.textContent).toBe("토·일 수업 시간대.");
  });

  it("강의실 · 공휴일 두 카드가 접는 카드다 — 몇 개인지 제목 줄에 적는다", () => {
    const classrooms = read("src", "app", "(shell)", "owner", "_components", "classroom-manager.tsx");
    expect(classrooms).toMatch(/title="강의실"[\s\S]{0,400}collapsible\s+summary=\{`\$\{live\.length\}개`\}/);
    const operations = read("src", "app", "(shell)", "owner", "_components", "operations-section.tsx");
    expect(operations).toMatch(/title="공휴일·휴원일"[\s\S]{0,400}collapsible\s+summary=\{`\$\{o\.holidays\.length\}일`\}/);
    // 그 밖의 카드는 접지 않는다(짧은 칸까지 접으면 한눈에 안 보인다).
    expect(operations.match(/\bcollapsible\b/g)).toHaveLength(1);
  });
});

describe("보강 운영 면", () => {
  const page = read("src", "app", "(shell)", "owner", "page.tsx");

  it("🔴 운영 체계 면 아래에 붙어 있지 않다 — 제 면(tab=makeups)에서만 선다", () => {
    const operationsBlock = page.slice(page.indexOf('{tab === "operations" && !settingsUnreadable ? ('), page.indexOf('{tab === "makeups" ? ('));
    expect(operationsBlock).toContain("<OperationsSection");
    expect(operationsBlock).not.toContain("MakeupsSection");
    expect(page.match(/<MakeupsSection\b/g)).toHaveLength(1);
    expect(page).toMatch(/\{tab === "makeups" \? \(\s*canReadAudit \? \(\s*<MakeupsSection initial=\{settings\.makeups\} readOnly=\{!canEditSettings\} \/>/);
  });

  it("🔴 다른 화면의 '보강관리 운영 모드 설정' 링크도 새 면으로 간다 — 옛 위치(운영 체계)에는 그 폼이 없다", () => {
    const modules = read("src", "app", "(shell)", "owner", "_components", "modules-section.tsx");
    expect(modules).toMatch(/<Link href="\/owner\?tab=makeups"[^>]*>보강관리 운영 모드 설정<\/Link>/);
    expect(modules).not.toContain('href="/owner?tab=operations"');
  });

  it("🔴 원장 위가 아니면 폼을 세우지 않고 안내한다 — 저장 액션과 같은 선이다", () => {
    const block = page.slice(page.indexOf('{tab === "makeups" ? ('), page.indexOf('{tab === "subjects" && !settingsUnreadable ? ('));
    expect(block).toContain("보강 운영은 원장만 바꿀 수 있습니다");
    const action = read("src", "features", "makeups", "server", "settings.ts");
    expect(action).toContain('canWriteTenant(actor.systemRole, "owner")');
    expect(action).toContain('actor.systemRole !== "master" && !(await isCurrentUserSuperAdmin())');
  });
});
