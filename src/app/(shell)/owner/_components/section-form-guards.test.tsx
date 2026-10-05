import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 섹션 폼 × **실제 두 가드**(미저장 가드 · 동시 편집 가드) — 저장 성공은 제출한 스냅샷에 대해서만 확정된다(2026-10-05).
 * 저장이 도는 동안 값이 더 바뀌면(이미 시작한 업로드가 끝나는 등) 그 변경은 계속 '미저장'이어야 한다:
 * 창을 닫으려 하면 확인이 뜨고, 다른 창이 같은 설정을 저장하면 경고를 받는다.
 * 가드는 모의하지 않는다 — 인자를 넘겼는지가 아니라 **실제로 dirty로 남는지**를 본다.
 */
const m = vi.hoisted(() => ({
  save: vi.fn(),
  published: vi.fn(),
  listeners: [] as ((message: { scope: string }) => void)[],
  warn: vi.fn(),
}));
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: m.save }));
vi.mock("@/features/owner/navigation-context", () => ({ useNavigationSettings: () => ({ tenantId: "tenant" }) }));
vi.mock("@/features/presence/edit-presence", () => ({ useEditPresence: () => undefined }));
vi.mock("@/lib/realtime/record-channel", () => ({
  publishRecordSaved: m.published,
  subscribeRecordSaved: (listener: (message: { scope: string }) => void) => {
    m.listeners.push(listener);
    return () => {
      m.listeners = m.listeners.filter((l) => l !== listener);
    };
  },
}));
vi.mock("sonner", () => ({ toast: { warning: m.warn } }));
vi.mock("@/components/forms/form-action-bar", () => ({
  FormActionBar: ({ children }: { children: ReactNode }) => <div data-testid="action-bar">{children}</div>,
}));

import { SectionForm } from "./section-form";
import { useSectionDraft } from "./use-section-draft";

/** 저장 중에도 폼 밖에서 값이 바뀌는 길(끝난 업로드의 콜백 등)을 흉내 낸다. */
let changeFromOutside: (value: string) => void = () => undefined;
function Harness() {
  const [name, setName] = useState("처음");
  useEffect(() => {
    changeFromOutside = setName;
  }, []);
  return (
    <SectionForm section="profile" payload={{ name }}>
      <input aria-label="이름" value={name} onChange={(e) => setName(e.target.value)} />
    </SectionForm>
  );
}

/** 미저장 가드는 입력 뒤 다음 틱에 다시 계산한다 — 그만큼 기다린다. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 5)));
/** 창을 닫으려 할 때 확인이 뜨는가(= 미저장으로 보고 있나). */
const leaveIsBlocked = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const otherWindowSaved = () => act(() => m.listeners.forEach((listener) => listener({ scope: "tenant-settings:profile" })));
function deferredSave() {
  let resolve!: (value: unknown) => void;
  m.save.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  return (value: unknown) => act(async () => resolve(value));
}
const typeName = (value: string) => fireEvent.change(screen.getByLabelText("이름"), { target: { value } });
const submit = (container: HTMLElement) => act(async () => fireEvent.submit(container.querySelector("form")!));

beforeEach(() => {
  vi.clearAllMocks();
  m.listeners = [];
});
afterEach(cleanup);

describe("저장 성공 뒤의 미저장 판정", () => {
  it("고친 것을 저장하면 깨끗해진다 — 닫아도 확인이 안 뜨고, 다른 창의 저장에도 경고하지 않는다", async () => {
    const finish = deferredSave();
    const { container } = render(<Harness />);
    typeName("저장할 값");
    await settle();
    expect(leaveIsBlocked()).toBe(true);

    await submit(container);
    await finish({ ok: true, nonce: 1 });
    await settle();
    expect(leaveIsBlocked()).toBe(false);
    expect(m.published).toHaveBeenCalledWith("tenant-settings:profile");

    await otherWindowSaved();
    expect(m.warn).not.toHaveBeenCalled();
  });

  it("🔴 저장이 도는 동안 값이 더 바뀌면 그 변경은 계속 미저장이다 — 닫으려 하면 확인이 뜬다", async () => {
    const finish = deferredSave();
    const { container } = render(<Harness />);
    typeName("저장할 값");
    await settle();
    await submit(container);

    // 저장 응답을 기다리는 동안 폼 밖에서 값이 바뀐다.
    act(() => changeFromOutside("저장 중에 바뀐 값"));
    await finish({ ok: true, nonce: 1 });
    await settle();

    expect((screen.getByLabelText("이름") as HTMLInputElement).value).toBe("저장 중에 바뀐 값");
    expect(leaveIsBlocked()).toBe(true);
  });

  it("🔴 그 상태에서 다른 창이 같은 설정을 저장하면 경고를 받는다(동시 편집 가드도 제출분을 기준으로 삼는다)", async () => {
    const finish = deferredSave();
    const { container } = render(<Harness />);
    typeName("저장할 값");
    await settle();
    await submit(container);
    act(() => changeFromOutside("저장 중에 바뀐 값"));
    await finish({ ok: true, nonce: 1 });
    await settle();

    await otherWindowSaved();
    expect(m.warn).toHaveBeenCalledTimes(1);
  });

  it("저장에 실패하면 미저장 그대로다", async () => {
    const finish = deferredSave();
    const { container } = render(<Harness />);
    typeName("저장할 값");
    await settle();
    await submit(container);
    await finish({ error: "저장 실패" });
    await settle();
    expect(leaveIsBlocked()).toBe(true);
    expect(m.published).not.toHaveBeenCalled();
  });
});

/**
 * 실제 훅(useSectionDraft) + 섹션 폼 + 실제 두 가드 — **새 값이 저장 응답보다 먼저 올 때**(2026-10-05 적대 리뷰 1b B1).
 * 훅은 저장이 도는 동안 서버 값을 미뤄 두고 응답을 먼저 반영한다. 폼의 가드도 그 순서로 기준을 잡아야 한다:
 * 받은 값이 화면에 서고 깨끗한 상태가 된 뒤, 그 값에서 벗어나게 고치면 다시 미저장이어야 한다.
 */
type FaceDraft = { name: string; other?: string };
function DraftFace({ initial, token, version }: { initial: FaceDraft; token: string; version?: number }) {
  const { draft, setDraft, baseline, noteSubmitted, confirmSaved, noteSaveFailed, adoptions } = useSectionDraft(initial, token, version);
  return (
    <SectionForm
      section="operations"
      payload={draft}
      extraFields={{ operationsFace: "subjects", operationsBaseline: baseline }}
      onSubmit={noteSubmitted}
      onSaved={(state) => confirmSaved(state.operations?.tokens.subjects, state.version)}
      onSaveFailed={noteSaveFailed}
      rebaselineNonce={adoptions}
    >
      <input aria-label="이름" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
    </SectionForm>
  );
}
const SAVED = (token: string, version?: number) => ({
  ok: true,
  nonce: Date.now(),
  version,
  operations: { tokens: { operations: "O", subjects: token } },
});
/** 저장 순번(문서의 `data.rev`). */
const STAMP = (n: number) => n;
const nameValue = () => (screen.getByLabelText("이름") as HTMLInputElement).value;
const otherWindowSavedOperations = () => act(() => m.listeners.forEach((listener) => listener({ scope: "tenant-settings:operations" })));

describe("새 값이 저장 응답보다 먼저 올 때 — 훅과 가드가 같은 순서로 맞춰진다", () => {
  it("🔴 응답보다 먼저 온 값은 응답 뒤에 화면에 서고, 그 상태는 깨끗하다(닫아도 확인이 없다)", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "처음" }} token="S0" />);
    await settle();
    await submit(container); // 고치지 않고 저장을 눌렀다

    // 서버 값이 응답보다 먼저 내려온다 — 저장이 도는 동안에는 받지 않는다.
    rerender(<DraftFace initial={{ name: "다른 창이 바꾼 값" }} token="S1" />);
    await settle();
    expect(nameValue()).toBe("처음");

    await finish(SAVED("S-응답"));
    await settle();
    expect(nameValue()).toBe("다른 창이 바꾼 값");
    expect(leaveIsBlocked()).toBe(false);
    await otherWindowSavedOperations();
    expect(m.warn).not.toHaveBeenCalled();
  });

  it("🔴 그 뒤 받은 값에서 벗어나게 고치면 — 예전 값으로 되돌리는 것이라도 — 미저장이다", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "처음" }} token="S0" />);
    await settle();
    await submit(container);
    rerender(<DraftFace initial={{ name: "다른 창이 바꾼 값" }} token="S1" />);
    await finish(SAVED("S-응답"));
    await settle();

    typeName("처음"); // 저장을 누르던 때의 값으로 되돌린다 — 지금 서버 값과는 다르다
    await settle();
    expect(leaveIsBlocked()).toBe(true);
    await otherWindowSavedOperations();
    expect(m.warn).toHaveBeenCalledTimes(1);

    // 다음 저장은 받은 값의 token으로 나간다(옛 응답의 token이 아니다).
    m.save.mockResolvedValueOnce(SAVED("S2"));
    await submit(container);
    expect((m.save.mock.calls.at(-1)![1] as FormData).get("operationsBaseline")).toBe("S1");
  });

  it("응답과 새 값이 한꺼번에 와도 결과는 같다", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "처음" }} token="S0" />);
    await settle();
    await submit(container);

    await act(async () => {
      rerender(<DraftFace initial={{ name: "다른 창이 바꾼 값" }} token="S1" />);
      await finish(SAVED("S-응답"));
    });
    await settle();
    expect(nameValue()).toBe("다른 창이 바꾼 값");
    expect(leaveIsBlocked()).toBe(false);

    typeName("처음");
    await settle();
    expect(leaveIsBlocked()).toBe(true);
  });

  it("고친 것을 저장한 뒤 서버가 다듬은 값이 내려와도 깨끗하다(받은 값으로 기준을 다시 잡는다)", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "처음" }} token="S0" />);
    await settle();
    typeName("  앞뒤 공백  ");
    await settle();
    await submit(container);
    await finish(SAVED("S1"));
    rerender(<DraftFace initial={{ name: "앞뒤 공백" }} token="S1" />);
    await settle();
    expect(nameValue()).toBe("앞뒤 공백");
    expect(leaveIsBlocked()).toBe(false);
  });

  it("저장에 실패하면 미뤄 둔 값은 수정 중인 폼을 덮지 않는다 — 미저장 그대로다", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "처음" }} token="S0" />);
    await settle();
    typeName("내가 고치는 중");
    await settle();
    await submit(container);
    rerender(<DraftFace initial={{ name: "다른 창이 바꾼 값" }} token="S1" />);
    await finish({ error: "다른 창에서 이 설정이 변경되었습니다." });
    await settle();
    expect(nameValue()).toBe("내가 고치는 중");
    expect(leaveIsBlocked()).toBe(true);
  });
});

/**
 * 내 저장이 반영되기 **전에 읽힌** 값이 저장 뒤에 도착하는 경우(2026-10-05 적대 리뷰 1c N1) — 실제 훅 + 폼 + 두 가드.
 * 저장이 도는 동안 다른 탐색(과목 세션의 연도 링크 등)이 화면 값을 다시 읽으면 생긴다. 받으면 방금 저장한 내용이
 * 화면에서 사라지고 token도 옛것이 되어, 이어서 한 정상 저장이 거절된다.
 */
describe("내 저장보다 먼저 읽힌 값이 뒤늦게 내려올 때", () => {
  it("🔴 저장한 내용이 화면에 그대로 있고 깨끗하다 — 다음 저장은 응답의 token으로 나간다", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "처음" }} token="S0" version={STAMP(0)} />);
    await settle();
    typeName("저장한 값");
    await settle();
    await submit(container);

    // 저장 전에 읽힌 값: 내 칸은 옛 값, 다른 칸(시간표 쪽)만 달라졌고 token은 옛것 그대로다.
    rerender(<DraftFace initial={{ name: "처음", other: "시간표에서 바뀐 값" }} token="S0" version={STAMP(1)} />);
    await finish(SAVED("S1", STAMP(2)));
    await settle();

    expect(nameValue()).toBe("저장한 값");
    expect(leaveIsBlocked()).toBe(false);
    await otherWindowSavedOperations();
    expect(m.warn).not.toHaveBeenCalled();

    typeName("이어서 고친 값");
    await settle();
    expect(leaveIsBlocked()).toBe(true);
    m.save.mockResolvedValueOnce(SAVED("S2", STAMP(3)));
    await submit(container);
    expect((m.save.mock.calls.at(-1)![1] as FormData).get("operationsBaseline")).toBe("S1");
  });

  it("저장이 끝난 뒤에 도착해도 받지 않는다 · 그보다 새로 읽힌 값은 받는다", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "처음" }} token="S0" version={STAMP(0)} />);
    await settle();
    typeName("저장한 값");
    await settle();
    await submit(container);
    await finish(SAVED("S1", STAMP(2)));
    await settle();

    rerender(<DraftFace initial={{ name: "처음", other: "옛 읽기" }} token="S0" version={STAMP(1)} />);
    await settle();
    expect(nameValue()).toBe("저장한 값");
    expect(leaveIsBlocked()).toBe(false);

    rerender(<DraftFace initial={{ name: "다른 창이 그 뒤에 바꾼 값" }} token="S3" version={STAMP(3)} />);
    await settle();
    expect(nameValue()).toBe("다른 창이 그 뒤에 바꾼 값");
    expect(leaveIsBlocked()).toBe(false);
  });
});

describe("첫 저장 — 설정 행이 아직 없던 때의 읽기", () => {
  it("🔴 행이 생긴 뒤에는, 행이 없던 때 읽힌 기본값이 뒤늦게 내려와도 받지 않는다", async () => {
    const finish = deferredSave();
    const { container, rerender } = render(<DraftFace initial={{ name: "기본값" }} token="S0" version={0} />);
    await settle();
    typeName("처음 저장한 값");
    await settle();
    await submit(container);
    await finish(SAVED("S1", 1)); // 첫 저장이 행을 만들었다(순번 1)
    rerender(<DraftFace initial={{ name: "처음 저장한 값" }} token="S1" version={1} />);
    await settle();

    rerender(<DraftFace initial={{ name: "기본값" }} token="S0" version={0} />);
    await settle();
    expect(nameValue()).toBe("처음 저장한 값");
    expect(leaveIsBlocked()).toBe(false);

    typeName("이어서 고친 값");
    await settle();
    m.save.mockResolvedValueOnce(SAVED("S2", 2));
    await submit(container);
    expect((m.save.mock.calls.at(-1)![1] as FormData).get("operationsBaseline")).toBe("S1");
  });
});
