import { afterEach, describe, expect, it, vi } from "vitest";
import { saveFileAs } from "./download-file";

// 원장 제보 2026-08-17: 계약서(`김동후26.06(시용)근로계약서.pdf`)가 `%EA%B9%80…`로 저장됐다.
// 원인은 Supabase `?download=`의 헤더 인코딩 — 그래서 저장 이름은 **우리가** 정해야 한다.
const KOREAN = "김동후26.06(시용)근로계약서.pdf";

function spyAnchors() {
  const clicked: HTMLAnchorElement[] = [];
  const spy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  return { clicked, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saveFileAs (한글 파일명 그대로 저장)", () => {
  it("blob으로 받아 a.download에 원본 파일명을 그대로 넣는다(percent-encoding 없음)", async () => {
    const { clicked } = spyAnchors();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("%PDF-1.4", { status: 200 })),
    );
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);

    await saveFileAs("https://example.supabase.co/storage/v1/object/sign/x?token=t", KOREAN);

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe(KOREAN);
    expect(clicked[0].download).not.toContain("%"); // `%EA%B9%80…` 재발 방지
    expect(clicked[0].getAttribute("href")).toBe("blob:mock-url"); // 같은 출처라 download 속성이 유효
    expect(createObjectURL).toHaveBeenCalledOnce();
    // 저장 시작 전에 blob이 사라지면 안 되므로 즉시 revoke하지 않는다.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelectorAll("a")).toHaveLength(0); // 앵커는 클릭 후 정리
  });

  it("fetch가 실패하면 서명 URL로 직접 이동해 파일은 받게 한다(폴백)", async () => {
    const { clicked } = spyAnchors();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    const url = "https://example.supabase.co/storage/v1/object/sign/x?token=t";

    await saveFileAs(url, KOREAN);

    expect(clicked).toHaveLength(1);
    expect(clicked[0].getAttribute("href")).toBe(url);
  });

  it("HTTP 오류 응답(만료 토큰 등)도 폴백으로 떨어진다", async () => {
    const { clicked } = spyAnchors();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("expired", { status: 400 })),
    );
    const url = "https://example.supabase.co/storage/v1/object/sign/x?token=expired";

    await saveFileAs(url, KOREAN);

    expect(clicked).toHaveLength(1);
    expect(clicked[0].getAttribute("href")).toBe(url);
  });
});
