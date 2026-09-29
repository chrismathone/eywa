import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MenuMentionText } from "@/components/menu-mention-text";
import { NavigationProvider } from "./navigation-context";
import { menuMentionToken } from "./menu-mentions";
import { teacherNavigationSource } from "@/lib/teacher-navigation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ subscribeRecordSaved: () => () => {} }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children, ariaLabel }: { href: string; children: ReactNode; ariaLabel?: string }) => <a href={href} aria-label={ariaLabel}>{children}</a> }));
afterEach(cleanup);

const text = `${menuMentionToken("/timetable")} 업데이트`;
const menus = [{ href: "/timetable", label: "우리 수업 일정" }];

describe("공지·고객센터 @메뉴의 실제 읽기 컴포넌트", () => {
  it("같은 목적지가 지점 이름과 운영자 기본 이름으로 각각 보인다", () => {
    render(<NavigationProvider menus={menus}><p><MenuMentionText text={text} /></p><p><MenuMentionText text={text} defaultNames /></p></NavigationProvider>);
    expect(screen.getByRole("link", { name: "우리 수업 일정 열기" })).toHaveAttribute("href", "/timetable");
    expect(screen.getByRole("link", { name: "시간표 열기" })).toHaveAttribute("href", "/timetable");
  });
  it("저장된 글은 그대로 두고 설정 갱신/복원에 따라 표시만 바뀐다", () => {
    const { rerender } = render(<NavigationProvider menus={menus}><MenuMentionText text={text} /></NavigationProvider>);
    expect(screen.getByText("@우리 수업 일정")).toBeInTheDocument();
    rerender(<NavigationProvider menus={[{ href: "/timetable", label: "주간 계획" }]}><MenuMentionText text={text} /></NavigationProvider>);
    expect(screen.getByText("@주간 계획")).toBeInTheDocument();
    rerender(<NavigationProvider menus={[]}><MenuMentionText text={text} /></NavigationProvider>);
    expect(screen.getByText("@시간표")).toBeInTheDocument();
  });
  it("강사뷰 설정과 언어를 읽으며 운영자 이름은 한국어 기본값이다", () => {
    render(<NavigationProvider menus={[]} source={teacherNavigationSource("en")}><MenuMentionText text={text} /><MenuMentionText text={text} defaultNames link={false} /></NavigationProvider>);
    expect(screen.getByRole("link", { name: "Timetable 열기" })).toHaveAttribute("href", "/timetable");
    expect(screen.getByText("@시간표")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
  it("평문·HTML은 실행하거나 치환하지 않고, 폐기·외부 목적지는 링크로 만들지 않는다", () => {
    const { container } = render(<MenuMentionText text={'시간표 <img src=x onerror=alert(1)> @[옛 메뉴](menu:/retired) @[외부](menu:https://example.com)'} />);
    expect(container.textContent).toContain("시간표 <img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("@옛 메뉴");
    expect(container.textContent).toContain("@외부");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
  it("참조의 임의 이름을 신뢰하지 않고 실제 기본 메뉴 표를 사용한다", () => {
    render(<MenuMentionText text="@[가짜 결제 링크](menu:/timetable)" defaultNames />);
    expect(screen.getByRole("link", { name: "시간표 열기" })).toBeInTheDocument();
    expect(screen.queryByText(/가짜/)).not.toBeInTheDocument();
  });
});
