import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSectionDraft } from "./use-section-draft";

/**
 * 설정 폼의 draft · 확정 스냅샷 · 기준 token은 **함께만** 움직인다(2026-10-05).
 * token만 새것이 되면 옛 draft가 저장 검사를 통과해 그사이 다른 창이 한 저장을 되돌린다.
 */
type Draft = { label: string; items: string[] };
const v = (label: string, items: string[] = ["a"]): Draft => ({ label, items });
const mount = (initial: Draft, ...rest: [token?: string | undefined]) => {
  // 인자를 안 주면 "T0", 명시적으로 undefined를 주면 token 없음(읽기 전용 열람자).
  const token = rest.length === 0 ? "T0" : rest[0];
  return renderHook(
    ({ initial, token, version }: { initial: Draft; token: string | undefined; version?: number }) => useSectionDraft(initial, token, version),
    { initialProps: { initial, token } as { initial: Draft; token: string | undefined; version?: number } },
  );
};
/** 저장 순번(읽은 문서의 `data.rev`)까지 주는 마운트 — 읽기와 저장의 선후를 가리는 사례용. */
const mountAt = (initial: Draft, token: string, version: number) =>
  renderHook(
    ({ initial, token, version }: { initial: Draft; token: string | undefined; version?: number }) => useSectionDraft(initial, token, version),
    { initialProps: { initial, token, version } as { initial: Draft; token: string | undefined; version?: number } },
  );
/** 저장 순번 — 읽은 문서의 `data.rev`. */
const V = (n: number) => n;

describe("서버가 새 값을 내려보낼 때", () => {
  it("깨끗하면 draft와 token을 함께 바꾼다", () => {
    const { result, rerender } = mount(v("처음"));
    rerender({ initial: v("다른 창이 저장한 값"), token: "T1" });
    expect(result.current.draft).toEqual(v("다른 창이 저장한 값"));
    expect(result.current.baseline).toBe("T1");
    expect(result.current.isDirty()).toBe(false);
    expect(result.current.adoptions).toBe(1);
  });

  it("🔴 수정 중이면 draft도 token도 그대로 둔다 — 옛 token이 남아야 저장이 거절된다", () => {
    const { result, rerender } = mount(v("처음"));
    act(() => result.current.setDraft(v("내가 고치는 중")));
    rerender({ initial: v("다른 창이 저장한 값"), token: "T1" });
    expect(result.current.draft).toEqual(v("내가 고치는 중"));
    expect(result.current.baseline).toBe("T0");
    expect(result.current.isDirty()).toBe(true);
    expect(result.current.adoptions).toBe(0);
  });

  it("뜻이 같은 값(키 순서만 다름)이면 draft 객체는 그대로 두고 token만 옮긴다 — 폼이 흔들리지 않는다", () => {
    const first = v("같은 값");
    const { result, rerender } = mount(first);
    const reordered = { items: ["a"], label: "같은 값" } as Draft;
    rerender({ initial: reordered, token: "T1" });
    expect(result.current.draft).toBe(first);
    expect(result.current.baseline).toBe("T1");
    expect(result.current.adoptions).toBe(0);
  });

  it("같은 props로 다시 렌더해도 아무것도 바뀌지 않는다", () => {
    const initial = v("처음");
    const { result, rerender } = mount(initial);
    act(() => result.current.setDraft(v("고치는 중")));
    rerender({ initial, token: "T0" });
    expect(result.current.draft).toEqual(v("고치는 중"));
    expect(result.current.adoptions).toBe(0);
  });
});

describe("저장 성공", () => {
  it("제출한 값이 확정되고 서버가 돌려준 token으로 옮긴다", () => {
    const { result } = mount(v("처음"));
    act(() => result.current.setDraft(v("저장할 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.confirmSaved("T1"));
    expect(result.current.isDirty()).toBe(false);
    expect(result.current.baseline).toBe("T1");
  });

  it("🔴 저장이 도는 동안 더 고친 것은 계속 미저장이다", () => {
    const { result } = mount(v("처음"));
    act(() => result.current.setDraft(v("저장할 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.setDraft(v("저장 중에 더 고침")));
    act(() => result.current.confirmSaved("T1"));
    expect(result.current.isDirty()).toBe(true);
    expect(result.current.baseline).toBe("T1");
    expect(result.current.draft).toEqual(v("저장 중에 더 고침"));
  });

  it("서버가 새 token을 안 돌려주면 옛 token을 유지한다(다음 저장이 거절될 뿐 덮어쓰지 않는다)", () => {
    const { result } = mount(v("처음"));
    act(() => result.current.setDraft(v("저장할 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.confirmSaved(undefined));
    expect(result.current.baseline).toBe("T0");
  });

  it("저장 뒤 서버가 다듬은 값이 내려오면 그 값을 받는다(깨끗한 상태)", () => {
    const { result, rerender } = mount(v("처음"));
    act(() => result.current.setDraft(v("  앞뒤 공백  ")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.confirmSaved("T1"));
    rerender({ initial: v("앞뒤 공백"), token: "T1" });
    expect(result.current.draft).toEqual(v("앞뒤 공백"));
    expect(result.current.isDirty()).toBe(false);
    expect(result.current.adoptions).toBe(1);
  });

  it("저장에 실패하면 아무것도 확정하지 않는다 — 여전히 미저장이고 token도 그대로다", () => {
    const { result } = mount(v("처음"));
    act(() => result.current.setDraft(v("저장할 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.noteSaveFailed());
    expect(result.current.isDirty()).toBe(true);
    expect(result.current.baseline).toBe("T0");
  });
});

/**
 * 새 값이 저장 응답보다 **먼저** 도착하는 순서가 있다. 그때 바로 받으면 "이 값이 내 저장보다 새것인가"를 알 수 없다 —
 * 받은 뒤 늦은 응답을 반영하면 확정 상태가 옛 제출분으로 되돌아가고, 버리면 정상 저장의 확정을 잃는다.
 * 그래서 저장이 도는 동안에는 미뤄 두고, 응답(성공·실패)을 먼저 반영한 다음에 본다.
 */
describe("저장이 도는 동안 내려온 서버 값은 응답 뒤에 본다", () => {
  it("🔴 고치지 않고 저장한 폼 — 새 값이 먼저 와도 응답을 먼저 반영하고, 그다음 새 값을 받는다", () => {
    const { result, rerender } = mount(v("처음"));
    act(() => result.current.noteSubmitted()); // 아무것도 안 고치고 저장을 눌렀다
    rerender({ initial: v("처음", ["a", "시간표에서 바뀐 값"]), token: "T-새" });
    // 아직 받지 않는다.
    expect(result.current.draft).toEqual(v("처음"));
    expect(result.current.baseline).toBe("T0");
    expect(result.current.adoptions).toBe(0);

    act(() => result.current.confirmSaved("T-응답"));
    // 응답을 반영한 뒤 미뤄 둔 값을 본다 — 깨끗하므로 값과 token을 함께 받는다.
    expect(result.current.draft).toEqual(v("처음", ["a", "시간표에서 바뀐 값"]));
    expect(result.current.isDirty()).toBe(false);
    expect(result.current.baseline).toBe("T-새");
    expect(result.current.adoptions).toBe(1);
  });

  it("고친 것을 저장한 폼 — 새 값이 먼저 와도 기준은 응답의 token으로 맞춰진다", () => {
    const { result, rerender } = mount(v("처음"));
    act(() => result.current.setDraft(v("저장할 값")));
    act(() => result.current.noteSubmitted());
    rerender({ initial: v("저장할 값"), token: "T1" });
    expect(result.current.baseline).toBe("T0");
    act(() => result.current.confirmSaved("T1"));
    expect(result.current.baseline).toBe("T1");
    expect(result.current.isDirty()).toBe(false);
    // 뜻이 같은 값이라 draft를 갈아끼우지 않는다.
    expect(result.current.adoptions).toBe(0);
  });

  it("🔴 저장 중에 되돌려 놓은 폼 — 제출분이 확정되고(= 지금 폼은 미저장), 저장 전 시점의 서버 값이 그걸 덮지 않는다", () => {
    const { result, rerender } = mount(v("처음"));
    act(() => result.current.setDraft(v("저장할 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.setDraft(v("처음"))); // 저장이 도는 동안 원래대로 되돌렸다
    // 내 저장이 반영되기 **전에** 읽힌 서버 값이 먼저 도착했다.
    rerender({ initial: v("처음", ["a", "시간표에서 바뀐 값"]), token: "T-옛" });

    act(() => result.current.confirmSaved("T-응답"));
    // 서버에는 '저장할 값'이 들어갔다 — 지금 폼('처음')은 그와 다르므로 미저장이고, 기준은 응답의 token이다.
    expect(result.current.draft).toEqual(v("처음"));
    expect(result.current.isDirty()).toBe(true);
    expect(result.current.baseline).toBe("T-응답");
    expect(result.current.adoptions).toBe(0);
  });

  it("저장에 실패한 뒤에는 미뤄 둔 서버 값을 평소 규칙대로 본다 — 깨끗하면 받고, 수정 중이면 두고", () => {
    const clean = mount(v("처음"));
    act(() => clean.result.current.noteSubmitted());
    clean.rerender({ initial: v("다른 창이 저장한 값"), token: "T1" });
    act(() => clean.result.current.noteSaveFailed());
    expect(clean.result.current.draft).toEqual(v("다른 창이 저장한 값"));
    expect(clean.result.current.baseline).toBe("T1");

    const dirty = mount(v("처음"));
    act(() => dirty.result.current.setDraft(v("내가 고치는 중")));
    act(() => dirty.result.current.noteSubmitted());
    dirty.rerender({ initial: v("다른 창이 저장한 값"), token: "T1" });
    act(() => dirty.result.current.noteSaveFailed());
    expect(dirty.result.current.draft).toEqual(v("내가 고치는 중"));
    expect(dirty.result.current.baseline).toBe("T0");
  });

  it("다음 저장도 같은 규칙으로 확정된다(제출 중 상태가 눌어붙지 않는다)", () => {
    const { result, rerender } = mount(v("처음"));
    act(() => result.current.noteSubmitted());
    rerender({ initial: v("서버 값"), token: "T1" });
    act(() => result.current.confirmSaved("T-응답"));
    expect(result.current.draft).toEqual(v("서버 값"));

    act(() => result.current.setDraft(v("새로 고침")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.confirmSaved("T2"));
    expect(result.current.isDirty()).toBe(false);
    expect(result.current.baseline).toBe("T2");
    // 저장이 끝난 뒤의 서버 값은 바로 받는다.
    rerender({ initial: v("그 뒤 다른 창의 값"), token: "T3" });
    expect(result.current.draft).toEqual(v("그 뒤 다른 창의 값"));
    expect(result.current.baseline).toBe("T3");
  });
});

/**
 * 화면에 내려오는 값은 **도착한 순서가 읽힌 순서와 다를 수 있다**(2026-10-05 적대 리뷰 1c N1).
 * 내 저장이 반영되기 전에 읽힌 값이 저장 뒤에 도착하면, 받는 순간 방금 저장한 내용이 화면에서 사라지고 token도 옛것이 된다.
 * 읽은 문서의 저장 순번으로 선후를 가린다 — 내 확정 상태보다 먼저 읽힌 값은 버린다.
 */
describe("내 저장보다 먼저 읽힌 값은 받지 않는다", () => {
  it("🔴 고친 것을 저장한 뒤, 저장 전에 읽힌 값(다른 칸만 달라진)이 내려와도 저장한 내용이 그대로다", () => {
    const { result, rerender } = mountAt(v("처음"), "T0", V(0));
    act(() => result.current.setDraft(v("저장한 값")));
    act(() => result.current.noteSubmitted());
    // 내 저장이 반영되기 전에 읽힌 값 — 내 칸은 옛 값('처음')이고 시간표 칸만 달라져 있다. token도 옛것 그대로다.
    rerender({ initial: v("처음", ["a", "시간표에서 바뀐 값"]), token: "T0", version: V(1) });
    act(() => result.current.confirmSaved("T1", V(2)));

    expect(result.current.draft).toEqual(v("저장한 값"));
    expect(result.current.isDirty()).toBe(false);
    expect(result.current.baseline).toBe("T1");
    expect(result.current.adoptions).toBe(0);
  });

  it("저장이 끝난 뒤에 도착해도(미뤄 둔 것이 아니어도) 먼저 읽힌 값이면 받지 않는다", () => {
    const { result, rerender } = mountAt(v("처음"), "T0", V(0));
    act(() => result.current.setDraft(v("저장한 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.confirmSaved("T1", V(2)));
    rerender({ initial: v("처음", ["a", "옛 읽기"]), token: "T0", version: V(1) });
    expect(result.current.draft).toEqual(v("저장한 값"));
    expect(result.current.baseline).toBe("T1");
  });

  it("내 저장과 같은 시점이거나 그 뒤에 읽힌 값은 평소대로 받는다", () => {
    const { result, rerender } = mountAt(v("처음"), "T0", V(0));
    act(() => result.current.setDraft(v("저장한 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.confirmSaved("T1", V(2)));
    // 내 저장 직후의 읽기(순번이 같다) — 서버가 다듬은 값.
    rerender({ initial: v("저장한 값(다듬음)"), token: "T1", version: V(2) });
    expect(result.current.draft).toEqual(v("저장한 값(다듬음)"));
    // 그 뒤 다른 창의 저장.
    rerender({ initial: v("다른 창의 값"), token: "T3", version: V(3) });
    expect(result.current.draft).toEqual(v("다른 창의 값"));
    expect(result.current.baseline).toBe("T3");
  });

  it("먼저 읽힌 값을 버린 뒤에도, 그보다 새 값이 오면 받는다(버린 것이 눌어붙지 않는다)", () => {
    const { result, rerender } = mountAt(v("처음"), "T0", V(0));
    act(() => result.current.setDraft(v("저장한 값")));
    act(() => result.current.noteSubmitted());
    rerender({ initial: v("처음", ["a", "옛 읽기"]), token: "T0", version: V(1) });
    act(() => result.current.confirmSaved("T1", V(2)));
    rerender({ initial: v("저장한 값", ["a", "새 읽기"]), token: "T1", version: V(3) });
    expect(result.current.draft).toEqual(v("저장한 값", ["a", "새 읽기"]));
    expect(result.current.baseline).toBe("T1");
  });

  it("삭제로 받은 확정 상태보다 먼저 읽힌 값도 받지 않는다", () => {
    const { result, rerender } = mountAt(v("처음", ["a", "b"]), "T0", V(0));
    act(() => result.current.adopt(v("처음", ["b"]), "T2", V(2)));
    rerender({ initial: v("처음", ["a", "b", "옛 읽기"]), token: "T0", version: V(1) });
    expect(result.current.draft).toEqual(v("처음", ["b"]));
    expect(result.current.baseline).toBe("T2");
  });

  it("순번을 모르면(읽기 전용 등) 평소 규칙대로 다룬다", () => {
    const { result, rerender } = mount(v("처음"));
    rerender({ initial: v("다른 창의 값"), token: "T1" });
    expect(result.current.draft).toEqual(v("다른 창의 값"));
  });

  it("🔴 첫 저장 — 행이 없던 때의 읽기(순번 0)가 저장 뒤에 도착해도 받지 않는다", () => {
    const { result, rerender } = mountAt(v("기본값"), "T0", 0); // 설정 행이 아직 없다
    act(() => result.current.setDraft(v("처음 저장한 값")));
    act(() => result.current.noteSubmitted());
    act(() => result.current.confirmSaved("T1", 1)); // 첫 저장이 행을 만들었다
    rerender({ initial: v("처음 저장한 값"), token: "T1", version: 1 });
    // 행이 생기기 전에 읽힌 기본값이 뒤늦게 내려온다.
    rerender({ initial: v("기본값"), token: "T0", version: 0 });
    expect(result.current.draft).toEqual(v("처음 저장한 값"));
    expect(result.current.baseline).toBe("T1");
    expect(result.current.isDirty()).toBe(false);
  });

  it("순번이 같은 값은 받는다 — 순번을 올리지 않는 쓰기(시트 반영 등) 뒤의 읽기다", () => {
    const { result, rerender } = mountAt(v("처음"), "T0", 5);
    rerender({ initial: v("처음", ["a", "시트 반영으로 바뀐 값"]), token: "T0", version: 5 });
    expect(result.current.draft).toEqual(v("처음", ["a", "시트 반영으로 바뀐 값"]));
  });
});

describe("서버가 확정 상태를 직접 돌려줄 때(과목 삭제)", () => {
  it("값과 token을 통째로 받는다", () => {
    const { result } = mount(v("처음", ["a", "b"]));
    act(() => result.current.adopt(v("처음", ["b"]), "T2"));
    expect(result.current.draft).toEqual(v("처음", ["b"]));
    expect(result.current.baseline).toBe("T2");
    expect(result.current.isDirty()).toBe(false);
    expect(result.current.adoptions).toBe(1);
  });
});

describe("읽기 전용 열람자", () => {
  it("token 없이도 동작한다(저장 폼이 서지 않는다)", () => {
    const { result } = mount(v("처음"), undefined);
    expect(result.current.baseline).toBeUndefined();
    expect(result.current.isDirty()).toBe(false);
  });
});
