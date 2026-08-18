import { describe, expect, it } from "vitest";
import { rollbackContainer, type RemainingEntry } from "./rollback";

/**
 * 진도 되감기 — 🔴 "빼기 산술"이 아니라 **남은 것으로 재계산**이고, 축은 **인제스트 순서**다.
 * ingest가 `container.lastPosition`(저장 순서) 기준으로 점프를 재므로 날짜축으로 재면 backfill에서 갈린다.
 */
const e = (createdAt: string, globalPosition: number | null): RemainingEntry => ({ createdAt, globalPosition });

describe("rollbackContainer", () => {
  it("🔴 남은 엔트리가 0이면 컨테이너를 **지우라고** 알린다 — 개시 위치로 되돌리면 지운 수업이 '현재 진도'로 남는다", () => {
    const out = rollbackContainer([], 100);
    expect(out.dropContainer).toBe(true);
    expect(out.chapterCount).toBe(0);
  });

  it("🔴 정렬축은 **인제스트 순서**다(날짜가 아니다) — 지난 날짜를 나중에 입력하는 backfill에서 갈린다", () => {
    // ingest는 저장 순서로 점프를 잰다: 274 → 275 → 278 = 최대 3.
    // 날짜순으로 재면 275(8/04) → 274(8/05) → 278 = 최대 4가 되어 저장값과 어긋난다(실측 2건).
    const out = rollbackContainer(
      [
        { createdAt: "2026-08-05T09:00:00Z", globalPosition: 274 },
        { createdAt: "2026-08-05T13:00:00Z", globalPosition: 275 },
        { createdAt: "2026-08-12T09:00:00Z", globalPosition: 278 },
      ],
      274,
    );
    expect(out.maxJump).toBe(3);
    expect(out.lastPosition).toBe(278);
    expect(out.dropContainer).toBe(false);
  });

  it("max_jump는 개시 위치부터 다시 잰다(뒤로 간 구간은 0)", () => {
    const out = rollbackContainer([e("2026-08-01", 105), e("2026-08-02", 120), e("2026-08-03", 118)], 100);
    // 100→105(5), 105→120(15), 120→118(뒤로 = 0)
    expect(out.maxJump).toBe(15);
  });

  it("입력 순서가 뒤섞여 있어도 인제스트 시각으로 정렬해 계산한다", () => {
    const out = rollbackContainer([e("2026-08-03", 130), e("2026-08-01", 110)], 100);
    expect(out.lastPosition).toBe(130);
    expect(out.maxJump).toBe(20);
  });

  it("위치가 없는 엔트리(원문만)는 위치 판정에서 빼되 개수에는 넣는다", () => {
    const out = rollbackContainer([e("2026-08-01", 110), e("2026-08-02", null)], 100);
    expect(out.lastPosition).toBe(110);
    expect(out.chapterCount).toBe(2);
  });

  it("위치가 하나도 없으면 개시 위치를 유지한다(지어내지 않는다)", () => {
    const out = rollbackContainer([e("2026-08-01", null)], 100);
    expect(out.lastPosition).toBe(100);
    expect(out.chapterCount).toBe(1);
  });

  it("개시 위치가 없는 옛 컨테이너에서도 터지지 않는다", () => {
    const out = rollbackContainer([e("2026-08-01", 110), e("2026-08-02", 120)], null);
    expect(out.lastPosition).toBe(120);
    expect(out.maxJump).toBe(10); // 첫 엔트리는 기준이 없어 건너뛰고 110→120만
  });

  it("입력 배열을 변형하지 않는다(정렬로 호출부 데이터를 흔들면 안 된다)", () => {
    const input = [e("2026-08-03", 130), e("2026-08-01", 110)];
    rollbackContainer(input, 100);
    expect(input[0]!.createdAt).toBe("2026-08-03");
  });
});
