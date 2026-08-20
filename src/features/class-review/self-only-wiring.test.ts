import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 강사 자기 평가 전용(원장 2026-08-19)이 **표면마다 조건을 새로 쓰는 방식**으로
 * 흩어지지 않게 못 박는다([[#77]] "화면에서만 잠갔다"의 재발 방지).
 *
 * 지키는 것: 조회 초크포인트(목록·상세)와 **쓰기 액션 3종**(생성·채점·삭제)이 전부
 * `self-only.ts`의 판정을 지난다. 새 표면을 추가하면서 이 게이트를 빠뜨리면 여기서 깨진다.
 */

const ROOT = join(process.cwd(), "src/features/class-review");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("자기 평가 전용 배선", () => {
  it("조회 초크포인트가 판정·가림을 지난다", () => {
    const queries = read("server/queries.ts");
    expect(queries).toContain('from "../self-only"');
    // 목록·상세·자격 셋 다 같은 뷰어 판정을 지난다 — 한쪽만 막으면 강제 URL로 남의 평가지가 열린다.
    expect(queries.match(/getReviewViewer\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(queries).toContain("isSelfOnlyReviewer");
    expect(queries).toContain("redactForSelfOnly");
    expect(queries).toContain("isOwnReview");
  });

  it("쓰기 액션 3종(생성·채점·삭제)이 전부 막혀 있다", () => {
    const actions = read("server/actions.ts");
    expect(actions).toContain('from "../self-only"');
    // 화면을 안 거치는 POST가 진짜 벽 — 액션마다 한 번씩(생성·채점·삭제).
    expect(actions.match(/isSelfOnlyReviewer\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("'다른 강사 뷰'는 대상 강사의 눈으로 본다 — 뷰어 판정이 한 곳에서만 난다", () => {
    const queries = read("server/queries.ts");
    // 원장 제보 2026-08-19: 뷰어의 실 역할로 판정하니 '다른 강사 뷰'에서 남의 점수·평가자 이름이 그대로 보였다.
    expect(queries).toContain("getReviewViewer");
    expect(queries).toContain("viewAsTeacher");
    // 화면이 제 나름의 판정을 만들지 않게 — 페이지는 self-only.ts를 직접 부르지 않는다(#77).
    for (const page of ["page.tsx", "[id]/page.tsx", "[id]/score/page.tsx", "new/page.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src/app/(shell)/class-review", page), "utf-8");
      expect(src).not.toContain("isSelfOnlyReviewer");
    }
  });

  it("판정 축은 실 역할(system_role) — 뷰 전환으로 권한이 흔들리지 않는다", () => {
    const selfOnly = read("self-only.ts");
    expect(selfOnly).toContain('role === "teacher"');
    // 뷰 전환 축(view-mode)으로 판정하면 관리자가 강사뷰를 켠 순간 남의 평가가 사라진다 —
    // 왜 안 쓰는지는 주석으로 남겨 두므로 **호출·import**만 금지한다(문자열 등장 자체는 허용).
    expect(selfOnly).not.toContain('from "@/lib/auth/view-mode"');
    expect(selfOnly).not.toMatch(/effectiveTeacher(Id|Scope)\s*\(/);
  });
});
