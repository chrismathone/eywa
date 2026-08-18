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

function FormHarness() {
  const ref = useRef<HTMLFormElement | null>(null);
  useFormDraft({ scope: "test-form", formRef: ref });
  return (
    <form ref={ref}>
      <input name="content" defaultValue="" />
    </form>
  );
}

function StateHarness({ onReady }: { onReady: (set: (t: string) => void) => void }) {
  const [text, setText] = useState("");
  useEffect(() => {
    onReady(setText);
  }, [onReady]);
  useStateDraft({
    scope: "test-state",
    snapshot: { text },
    hasContent: (s) => s.text.trim() !== "",
  });
  return null;
}

/** StateHarness를 렌더하고 setText 핸들을 얻는다. */
async function renderStateHarness() {
  let setText: ((t: string) => void) | undefined;
  render(
    <StateHarness
      onReady={(s) => {
        setText = s;
      }}
    />,
  );
  await act(async () => {});
  return { setText: setText! };
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
});
