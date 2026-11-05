import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 퇴원 상세의 사유 카드가 퇴원관리 **읽기 권한**에서 칸을 잠그고 '사유 저장'을 그리지 않는지 잠근다(원장 2026-11-05).
 * 판정은 서버 게이트(`updateWithdrawalReason`)와 같은 `canWriteTenant(…,"withdrawals")` — page가 이미 계산하는 `canWrite`.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("퇴원관리 읽기 권한 — 사유 카드", () => {
  it("상세 page가 쓰기 판정을 사유 카드·상담 추적 안내에 함께 내린다", () => {
    const src = read("src/app/(shell)/withdrawals/[studentId]/page.tsx");
    expect(src).toContain('canWriteTenant(user.systemRole, "withdrawals")');
    expect(src).toMatch(/<WithdrawalReasonCard[\s\S]*?readOnly=\{!canWrite\}/);
    // 상담 추적 카드는 읽기면 '즉시 저장'을 말하지 않는다. 권한 안내는 사유 카드 한 곳만(같은 문장이 두 번 뜨지 않게 · 2026-11-05 리뷰).
    expect(src).toContain('canWrite ? "체크하면 즉시 저장됩니다. 재등록 가능성 평가용 기록." : "재등록 가능성 평가용 기록."');
    expect(src).not.toContain('writeLockedNote("withdrawals")');
  });

  it("사유 카드는 fieldset째 비활성 + 안내, 저장 단추·초안을 끈다", () => {
    const src = read("src/app/(shell)/withdrawals/_components/reason-card.tsx");
    expect(src).toContain("readOnly = false");
    expect(src).toContain("<fieldset disabled={readOnly}");
    expect(src).toContain('writeLockedPlaceholder("withdrawals")');
    expect(src).toContain("enabled: !readOnly");
    expect(src).toMatch(/\{readOnly \? null : \(\s*<div className="flex justify-end">\s*<SubmitButton/);
  });
});
