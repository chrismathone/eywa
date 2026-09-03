import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN, clampPageSize, pageSizeCookieName } from "./page-size";

const here = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("page-size — 서버·클라 공용 쪽 크기 규약", () => {
  it("clamp: 비정상 값은 fallback, 정상 값은 [MIN, MAX] 안으로 반올림", () => {
    expect(clampPageSize(undefined, 7)).toBe(7);
    expect(clampPageSize("abc", 7)).toBe(7);
    expect(clampPageSize("0", 7)).toBe(7);
    expect(clampPageSize("-3", 7)).toBe(7);
    expect(clampPageSize("1", 7)).toBe(PAGE_SIZE_MIN);
    expect(clampPageSize("9999", 7)).toBe(PAGE_SIZE_MAX);
    expect(clampPageSize("12.6", 7)).toBe(13);
    expect(clampPageSize(40, 7)).toBe(40);
  });

  it("쿠키 이름은 화면 키에서 결정론적으로", () => {
    expect(pageSizeCookieName("consultations")).toBe("eywa-ps-consultations");
  });

  // [[#81]] — 적대적 리뷰 2026-09-03: 서버 페이지가 "use client" 모듈의 clampPageSize를 불러 요청마다 throw하던 결함.
  it('공용 헬퍼 모듈엔 "use client" 지시어가 없다(서버 컴포넌트가 함수를 부른다)', () => {
    const src = here("page-size.ts");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/server-only/);
  });

  it('AutoPageSize("use client")는 clampPageSize를 다시 내보내지 않는다 — 서버가 그쪽에서 import하면 같은 결함이 재발한다', () => {
    const src = here("auto-page-size.tsx");
    expect(src).toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/export\s+(function|const)\s+clampPageSize/);
    expect(src).not.toMatch(/export\s*\{[^}]*clampPageSize/);
    // 상하한은 page-size.ts 상수를 읽는다(서버 clamp와 같은 값이어야 왕복하지 않는다).
    expect(src).toMatch(/PAGE_SIZE_MIN/);
    expect(src).toMatch(/PAGE_SIZE_MAX/);
  });

  it("학생상담 페이지는 clampPageSize를 page-size.ts에서 import한다(auto-page-size가 아니라)", () => {
    const src = here("../app/(shell)/consultations/page.tsx");
    expect(src).toMatch(/import \{[^}]*clampPageSize[^}]*\} from "@\/components\/page-size"/);
    expect(src).not.toMatch(/import \{[^}]*clampPageSize[^}]*\} from "@\/components\/auto-page-size"/);
  });
});
