import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { emptyResume } from "@/features/staff/resume/resume";
import { ResumeSheet } from "./resume-sheet";

/**
 * 이력서 폼이 **실제로 IDB에 저장하는 값**에 주민번호·계좌·급여가 안 담기는지 확인한다.
 * 컴포넌트 → useFormDraft(exclude) → readFormValues → saveDraft 배선 전체를 태운다 —
 * saveDraft만 스파이로 가로채고 캡처 로직(readFormValues)은 진짜를 쓴다.
 * ⚠️ 이 테스트는 resume-sheet에서 `exclude`를 빼면 반드시 실패해야 한다(회귀 그물).
 */
const saveDraftSpy = vi.fn();
vi.mock("@/lib/form-draft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/form-draft")>();
  return {
    ...actual, // readFormValues·hasMeaningfulValues는 진짜(캡처 규칙을 그대로 태운다)
    saveDraft: (scope: string, values: Record<string, string>) => saveDraftSpy(scope, values),
    loadDraft: async () => null,
    clearDraft: async () => {},
  };
});

vi.mock("@/features/staff/resume/server/resume-actions", () => ({
  saveStaffResume: vi.fn(),
  deleteStaffResume: vi.fn(),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({
  useUnsavedGuard: () => ({ markSaved: vi.fn() }),
}));
vi.mock("@/features/presence/edit-presence", () => ({ useEditPresence: vi.fn() }));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBanner: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const SECRETS: Record<string, string> = {
  p_residentId: "900101-1234567",
  c_account: "110-1234-5678",
  c_bank: "국민은행",
  c_salaryMonthly: "3200000",
  c_salaryAnnual: "38400000",
  car_0_salary: "2800000",
  p_address: "서울시 어딘가 123",
};

beforeEach(() => {
  saveDraftSpy.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 폼을 렌더 → 민감칸 채움 → input 발화 → 디바운스(700ms) 경과 → 훅이 저장한 값 반환. */
function typeAndFlush(): Record<string, string> {
  const { container } = render(
    <ResumeSheet data={emptyResume()} userId="user-1" canWrite startEditing />,
  );
  const form = container.querySelector("form");
  expect(form, "편집 모드면 form이 렌더돼야 한다").toBeTruthy();

  for (const [name, value] of Object.entries({ ...SECRETS, p_name: "홍길동" })) {
    const el = form!.querySelector<HTMLInputElement>(`[name="${name}"]`);
    expect(el, `폼에 ${name} 칸이 없다 — 이름이 바뀌었으면 RESUME_DRAFT_EXCLUDE도 함께 고쳐야 한다`).toBeTruthy();
    el!.value = value;
  }
  act(() => {
    form!.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(800); // 700ms 디바운스 경과
  });

  expect(saveDraftSpy, "초안 자동저장이 아예 안 돌았다 — 테스트가 배선을 못 태우고 있다").toHaveBeenCalled();
  return saveDraftSpy.mock.calls.at(-1)![1] as Record<string, string>;
}

describe("이력서 초안 자동저장 — 민감정보 미포함", () => {
  it("주민번호·계좌·급여·주소를 IDB에 저장하지 않는다", () => {
    const saved = typeAndFlush();
    for (const name of Object.keys(SECRETS)) {
      expect(saved, `${name}이 초안에 담겼다 — IndexedDB에 평문으로 남는다`).not.toHaveProperty(name);
    }
    // 초안 기능 자체는 살아 있어야 한다(전부 비면 캡처가 죽은 것).
    expect(saved.p_name).toBe("홍길동");
  });

  it("저장된 초안 어디에도 민감 문자열이 남지 않는다(직렬화 전수 확인)", () => {
    const serialized = JSON.stringify(typeAndFlush());
    for (const secret of Object.values(SECRETS)) {
      expect(serialized, `초안에 "${secret}"가 남아 있다`).not.toContain(secret);
    }
  });

  it("초안 스코프에 userId가 들어간다(공용 PC에서 남의 초안 복구 방지)", () => {
    typeAndFlush();
    expect(saveDraftSpy.mock.calls.at(-1)![0]).toBe("staff-resume:user-1:new");
  });
});
