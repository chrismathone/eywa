import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("테스트에서 DB를 부르지 않는다"); } }));
import { ManualDriveReviewList } from "./manual-drive-review-note";

const item = { id: "r1", driveFileId: "driveFile00001", fileName: "엉뚱한 이름.mp4",
  reason: "파일 이름이 ‘학생_반_학교학년_날짜’ 네 칸이 아닙니다.", folderName: "이수진 선생님", duplicate: false };

describe("직접 올린 영상 확인 필요 안내", () => {
  it("없으면 아무것도 그리지 않는다", () => {
    expect(render(<ManualDriveReviewList review={{ fixable: 0, duplicates: 0, items: [] }} />).container).toBeEmptyDOMElement();
    expect(render(<ManualDriveReviewList review={null} />).container).toBeEmptyDOMElement();
  });
  it("고칠 것과 같은 영상 사본을 따로 세고, 펼치면 파일 이름·사유·폴더·Drive 열기", () => {
    render(<ManualDriveReviewList review={{ fixable: 31, duplicates: 2, items: [item] }} />);
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/지워도 됩니다/)).toBeInTheDocument();
    expect(screen.getByText("엉뚱한 이름.mp4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Drive 열기" })).toHaveAttribute("href", "https://drive.google.com/file/d/driveFile00001/view");
    expect(screen.getByText("최근 1개만 보입니다.")).toBeInTheDocument();
  });
  it("사본만 있으면 '이름을 고치면' 안내를 하지 않는다", () => {
    render(<ManualDriveReviewList review={{ fixable: 0, duplicates: 1, items: [{ ...item, duplicate: true }] }} />);
    expect(screen.queryByText(/이름.*고치면/)).toBeNull();
    expect(screen.queryByText("최근 1개만 보입니다.")).toBeNull();
  });
});
