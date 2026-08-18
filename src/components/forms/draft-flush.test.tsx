import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { useFormDraft } from "./use-form-draft";
import { useStateDraft } from "./use-state-draft";

/**
 * 초안 훅의 "타이핑 유실 0" 계약 — 배포 스큐 강제 리로드(회의록 녹음 사고 2026-08-18) 대응 2종:
 * ① 연속 타이핑 중에도 DRAFT_MAX_PENDING_MS마다 강제 저장(디바운스만 있으면 타이핑이 이어지는 동안
 *    한 번도 저장이 안 된다 — 이 테스트가 그 회귀를 잡는다).
 * ② pagehide 순간 saveDraftOnHide(동기 백스톱)로 마지막 타이핑까지 플러시. 단 미저장 변경이 없으면
 *    플러시하지 않는다(서버 저장 clear() 직후 초안 부활 방지).
 */
const saveDraftSpy = vi.fn();
const saveOnHideSpy = vi.fn();
vi.mock("@/lib/form-draft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/form-draft")>();
  return {
    ...actual, // readFormValues·hasMeaningfulValues·상수는 진짜
    saveDraft: async (scope: string, values: Record<string, string>) => saveDraftSpy(scope, values),
    saveDraftOnHide: (scope: string, values: Record<string, string>) => saveOnHideSpy(scope, values),
    loadDraft: async () => null,
    clearDraft: async () => {},
  };
});

function FormHarness({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLFormElement | null>(null);
  useFormDraft({ scope: "test-form", formRef: ref, enabled });
  return (
    <form ref={ref}>
      <input name="content" defaultValue="" />
    </form>
  );
}

type StateApi = { setText: (t: string) => void; clear: () => void };

function StateHarness({
  onReady,
  enabled = true,
}: {
  onReady: (api: StateApi) => void;
  enabled?: boolean;
}) {
  const [text, setText] = useState("");
  const draft = useStateDraft({
    scope: "test-state",
    snapshot: { text },
    enabled,
    hasContent: (s) => s.text.trim() !== "",
  });
  const clear = draft.clear;
  useEffect(() => {
    onReady({ setText, clear });
  }, [onReady, clear]);
  return null;
}

/** StateHarness를 렌더하고 setText/clear 핸들을 얻는다. */
async function renderStateHarness() {
  const api = {} as StateApi;
  const onReady = (a: StateApi) => Object.assign(api, a);
  const view = render(<StateHarness onReady={onReady} />);
  await act(async () => {});
  return {
    setText: (t: string) => api.setText(t),
    clear: () => api.clear(),
    setEnabled: (enabled: boolean) => view.rerender(<StateHarness onReady={onReady} enabled={enabled} />),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  saveDraftSpy.mockClear();
  saveOnHideSpy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

const typeInto = (input: HTMLInputElement, value: string) => {
  fireEvent.input(input, { target: { value } });
};

describe("useFormDraft — 강제 저장 + pagehide 플러시", () => {
  it("연속 타이핑(500ms 간격)이어도 MAX_PENDING을 넘으면 저장된다", async () => {
    const { container } = render(<FormHarness />);
    await act(async () => {});
    const input = container.querySelector("input[name=content]") as HTMLInputElement;
    act(() => {
      typeInto(input, "ㄱ");
    });
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(500); // 디바운스(700ms)가 계속 리셋되는 타이핑 패턴
        typeInto(input, `ㄱ${i}`);
      });
    }
    // 2초 경과 시점의 입력에서 강제 저장이 발화해야 한다(디바운스만이면 0회 — 회귀 시 실패).
    expect(saveDraftSpy).toHaveBeenCalled();
    expect(saveDraftSpy.mock.calls.at(-1)![1].content).toContain("ㄱ");
  });

  it("pagehide가 오면 디바운스 대기 중이던 입력을 즉시 백스톱 저장한다", async () => {
    const { container } = render(<FormHarness />);
    await act(async () => {});
    const input = container.querySelector("input[name=content]") as HTMLInputElement;
    act(() => {
      typeInto(input, "회의 중 메모");
      vi.advanceTimersByTime(300); // 디바운스 700ms 미만 — 아직 저장 전
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveOnHideSpy).toHaveBeenCalledTimes(1);
    expect(saveOnHideSpy.mock.calls[0]![1]).toMatchObject({ content: "회의 중 메모" });
    // 플러시가 타이머를 걷었으니 그 뒤 시간이 흘러도 중복 저장 없음.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveDraftSpy).not.toHaveBeenCalled();
  });

  it("미저장 변경이 없으면 pagehide에 저장하지 않는다(초안 부활 방지)", async () => {
    const { container } = render(<FormHarness />);
    await act(async () => {});
    const input = container.querySelector("input[name=content]") as HTMLInputElement;
    act(() => {
      typeInto(input, "메모");
      vi.advanceTimersByTime(800); // 디바운스 저장 완료 → pending 해소
    });
    expect(saveDraftSpy).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveOnHideSpy).not.toHaveBeenCalled();
  });
});

describe("useStateDraft — 강제 저장 + pagehide 플러시", () => {
  it("연속 상태 변경(500ms 간격)이어도 MAX_PENDING을 넘으면 저장된다", async () => {
    const { setText } = await renderStateHarness();
    act(() => setText("ㄱ"));
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(500);
        setText(`ㄱ${i}`);
      });
    }
    expect(saveDraftSpy).toHaveBeenCalled();
  });

  it("pagehide가 오면 마지막 스냅샷을 즉시 백스톱 저장한다", async () => {
    const { setText } = await renderStateHarness();
    act(() => setText("등록상담 정리 중"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveOnHideSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(saveOnHideSpy.mock.calls[0]![1].__json).text).toBe("등록상담 정리 중");
  });

  it("변경이 없으면 pagehide에 저장하지 않는다", async () => {
    await renderStateHarness();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveOnHideSpy).not.toHaveBeenCalled();
  });

  it("🔴 서버 저장(clear) → 닫기 → 재오픈 후의 첫 편집도 저장된다 — rebase가 삼키면 안 된다(적대 리뷰 중-2)", async () => {
    const h = await renderStateHarness();
    act(() => h.setText("A=김예원"));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(saveDraftSpy).toHaveBeenCalledTimes(1);
    // 서버 저장 성공 → clear + 편집기 닫힘(enabled=false) → 재오픈(enabled=true)
    act(() => h.clear());
    act(() => h.setEnabled(false));
    act(() => h.setEnabled(true));
    // 재오픈 세션의 유일한 편집 — rebase 잔존 시 "새 기준선"으로 삼켜져 영영 저장 안 되던 회귀.
    act(() => h.setText("A=박소선"));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(saveDraftSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(saveDraftSpy.mock.calls.at(-1)![1].__json).text).toBe("A=박소선");
  });
});

describe("useFormDraft — enabled 토글 세션 경계", () => {
  it("이전 세션의 미저장 꼬리가 재오픈 무변경 세션의 탭 숨김에서 유령 저장되지 않는다(적대 리뷰 경-1)", async () => {
    const view = render(<FormHarness />);
    await act(async () => {});
    const input = view.container.querySelector("input[name=content]") as HTMLInputElement;
    // 세션 1: 한 글자 치고 디바운스(700ms) 전에 닫는다 — pending이 잔존하던 조건.
    act(() => {
      typeInto(input, "ㄱ");
      vi.advanceTimersByTime(300);
    });
    act(() => view.rerender(<FormHarness enabled={false} />));
    // 세션 2: 재오픈만 하고 아무것도 안 친 채 탭 숨김.
    act(() => view.rerender(<FormHarness enabled />));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveOnHideSpy).not.toHaveBeenCalled();
  });
});
