import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useFormDraft } from "./use-form-draft";

/**
 * 언로드 백스톱은 **localStorage**에 적힌다 — 초안이 사는 곳이 IDB 하나에서 둘로 늘었다는 뜻이다.
 * 그래서 "민감 필드는 초안에 담지 않는다"(gotcha #78)는 규약을 **백스톱 경로에서도** 못박는다.
 *
 * 🔴 이 파일은 `@/lib/form-draft`를 **모킹하지 않는다**(draft-flush.test.tsx는 스파이를 쓴다) —
 *    진짜 `readFormValues → saveDraftOnHide`를 통과시켜야 exclude가 실제로 지켜지는지 알 수 있다.
 *    모킹된 테스트는 "훅이 부르긴 했다"까지만 보증하고, 무엇이 저장됐는지는 못 본다.
 * (happy-dom엔 indexedDB가 없어 IDB 사본은 조용히 실패한다 — 이 테스트가 보려는 건 localStorage뿐이다.)
 */
function SensitiveForm() {
  const ref = useRef<HTMLFormElement | null>(null);
  useFormDraft({ scope: "backstop-exclude", formRef: ref, exclude: ["password"] });
  return (
    <form ref={ref}>
      <input name="name" defaultValue="" />
      <input name="password" type="password" defaultValue="" />
    </form>
  );
}

const KEY = "form-draft:hide:backstop-exclude";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("언로드 백스톱과 exclude", () => {
  it("🔴 exclude된 필드는 localStorage 백스톱에도 실리지 않는다", async () => {
    const { container } = render(<SensitiveForm />);
    await act(async () => {});
    act(() => {
      fireEvent.input(container.querySelector("input[name=name]")!, { target: { value: "박소선" } });
      fireEvent.input(container.querySelector("input[name=password]")!, {
        target: { value: "s3cret!" },
      });
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const raw = localStorage.getItem(KEY);
    expect(raw, "미저장 입력이 있었으니 백스톱은 기록돼야 한다").toBeTruthy();
    const values = (JSON.parse(raw!) as { values: Record<string, string> }).values;
    expect(values.name).toBe("박소선");
    expect("password" in values, "제외 필드가 평문으로 localStorage에 남으면 안 된다").toBe(false);
    expect(raw!).not.toContain("s3cret!");
  });
});
