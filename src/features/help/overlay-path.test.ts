import { describe, expect, it } from "vitest";
import { overlaySlugForPath } from "./overlay-path";

describe("overlaySlugForPath", () => {
  it("화면 주소는 그 설명서 슬러그", () => {
    expect(overlaySlugForPath("/timetable")).toBe("timetable");
    expect(overlaySlugForPath("/timetable?subject=math")).toBe("timetable");
    expect(overlaySlugForPath("/dashboard")).toBe("dashboard");
    expect(overlaySlugForPath("/onescreen")).toBe("onescreen");
    expect(overlaySlugForPath("/attendance")).toBe("attendance");
    expect(overlaySlugForPath("/attendance/live")).toBe("attendance-live");
    expect(overlaySlugForPath("/help")).toBe("help");
    expect(overlaySlugForPath("/help/posts/abc")).toBe("help");
    expect(overlaySlugForPath("/help/icons")).toBe("help");
  });
  it("원생 목록과 상세는 href 가 같아도 경로로 가른다", () => {
    expect(overlaySlugForPath("/students")).toBe("students");
    expect(overlaySlugForPath("/students/abc")).toBe("student-detail");
  });
  it("모르는 주소는 null", () => {
    expect(overlaySlugForPath("/login")).toBeNull();
  });
});
