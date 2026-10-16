import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useFormDraft } from "./use-form-draft";
import { useStateDraft } from "./use-state-draft";
import { DraftBanner } from "./draft-banner";
import { readFormValues } from "@/lib/form-draft";
import { formDraftScope, formInstanceKey, pageFormHref, recordingSince, withFormInstance } from "@/lib/recording-resume";

/**
 * 녹음이 걸린 작성 화면으로 돌아오면(원장 2026-10-16 — 녹음 아이콘의 '작성 화면 열기'·뒤로 가기) 그 녹음을 누른 뒤의 임시
 * 저장을 안내 없이 바로 되살린다(restoreSince). 그보다 오래된 임시 저장(지난번에 쓰다 만 것)과 그 밖의 열기는 '복구' 안내만.
 */
const drafts = vi.hoisted(() => new Map<string, { scope: string; savedAt: number; values: Record<string, string> }>());
const recs = vi.hoisted(() => ({ local: [] as unknown[], foreign: [] as unknown[] }));
const saved = vi.hoisted(() => [] as { scope: string; values: Record<string, string> }[]);
vi.mock("@/lib/form-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/form-draft")>()),
  loadDraft: async (scope: string) => drafts.get(scope) ?? null,
  saveDraft: async (scope: string, values: Record<string, string>) => { saved.push({ scope, values }); },
  saveDraftOnHide: () => {},
  clearDraft: async () => {},
}));
vi.mock("@/lib/browser-recording", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/browser-recording")>()),
  getBrowserRecordings: () => recs.local,
}));
vi.mock("@/lib/browser-recording-channel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/browser-recording-channel")>()),
  getForeignRecordings: () => recs.foreign,
}));
afterEach(() => {
  drafts.clear();
  saved.length = 0;
  recs.local = [];
  recs.foreign = [];
});

function FormHarness({ since, onRestore, initialName = "" }: { since?: number; onRestore?: (values: Record<string, string>) => void; initialName?: string }) {
  const ref = useRef<HTMLFormElement | null>(null);
  const draft = useFormDraft({ scope: "consultation:new", formRef: ref, restoreSince: () => since, onRestore });
  return (
    <form ref={ref}>
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      <input name="prospectName" aria-label="이름" defaultValue={initialName} />
      <button type="button" onClick={draft.save}>지금 남기기</button>
    </form>
  );
}

function MeetingHarness({ since }: { since?: number }) {
  const [title, setTitle] = useState("");
  const draft = useStateDraft({
    scope: "meeting:new#b",
    snapshot: { title },
    hasContent: (s) => s.title !== "",
    autoRestore: (s) => setTitle(s.title),
    restoreSince: () => since,
  });
  return <><p>제목:{title}</p><DraftBanner savedAt={draft.draftSavedAt} onRestore={() => {}} onDiscard={draft.discard} /></>;
}

describe("useFormDraft restoreSince", () => {
  it("녹음을 누른 뒤의 임시 저장이면 안내 없이 바로 값을 채우고 onRestore를 부른다", async () => {
    drafts.set("consultation:new", { scope: "consultation:new", savedAt: 200, values: { prospectName: "김민준" } });
    const onRestore = vi.fn();
    render(<FormHarness since={100} onRestore={onRestore} />);
    await act(async () => {});
    expect(screen.getByLabelText("이름")).toHaveValue("김민준");
    expect(onRestore).toHaveBeenCalledWith({ prospectName: "김민준" });
    expect(screen.queryByRole("button", { name: "이어서 작성" })).toBeNull();
  });

  it("🔴 녹음보다 오래된 임시 저장(지난번에 쓰다 만 것)은 바로 채우지 않는다 — 복구 안내만", async () => {
    drafts.set("consultation:new", { scope: "consultation:new", savedAt: 50, values: { prospectName: "지난주" } });
    render(<FormHarness since={100} />);
    await act(async () => {});
    expect(screen.getByLabelText("이름")).toHaveValue("");
    expect(screen.getByRole("button", { name: "이어서 작성" })).toBeTruthy();
  });

  it("걸린 녹음이 없는 열기는 종전대로 값을 건드리지 않고 복구 안내만", async () => {
    drafts.set("consultation:new", { scope: "consultation:new", savedAt: 1, values: { prospectName: "김민준" } });
    render(<FormHarness />);
    await act(async () => {});
    expect(screen.getByLabelText("이름")).toHaveValue("");
    expect(screen.getByRole("button", { name: "이어서 작성" })).toBeTruthy();
  });

  it("🔴 녹음을 눌러도 고친 것이 없으면(서버 값 그대로인 수정 화면) 남기지 않는다 — 다음 열기의 가짜 복구 안내·남이 고친 값 되돌리기 방지", async () => {
    render(<FormHarness initialName="서버 값" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "지금 남기기" }));
    expect(saved).toEqual([]);
    fireEvent.input(screen.getByLabelText("이름"), { target: { value: "고친 값" } });
    fireEvent.click(screen.getByRole("button", { name: "지금 남기기" }));
    expect(saved.at(-1)).toEqual({ scope: "consultation:new", values: { prospectName: "고친 값" } });
  });

  it("🔴 녹음 중에 잠근 이름·연락처(readOnly)도 임시 저장에 남는다 — disabled는 빠져서 돌아온 화면에 녹음이 안 붙었다", () => {
    const form = document.createElement("form");
    form.innerHTML = '<input name="prospectName" value="김민준" readonly><input name="parentPhone" value="010" disabled>';
    expect(readFormValues(form)).toEqual({ prospectName: "김민준" });
  });
});

describe("useStateDraft restoreSince", () => {
  it("녹음을 누른 뒤의 임시 저장이면 그 작성 화면의 칸에서 바로 되살린다", async () => {
    drafts.set("meeting:new#b", { scope: "meeting:new#b", savedAt: 200, values: { __json: JSON.stringify({ title: "주간 회의" }) } });
    render(<MeetingHarness since={100} />);
    await act(async () => {});
    expect(screen.getByText("제목:주간 회의")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "이어서 작성" })).toBeNull();
  });

  it("오래된 임시 저장은 안내만", async () => {
    drafts.set("meeting:new#b", { scope: "meeting:new#b", savedAt: 50, values: { __json: JSON.stringify({ title: "주간 회의" }) } });
    render(<MeetingHarness since={100} />);
    await act(async () => {});
    expect(screen.getByText("제목:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "이어서 작성" })).toBeTruthy();
  });
});

describe("작성 화면 한 벌의 주소·칸·key", () => {
  it("form 표식이 없으면 종전 칸, 있으면 따로 · key도 따로", () => {
    expect(formDraftScope("consultation:new", undefined)).toBe("consultation:new");
    expect(formDraftScope("consultation:new", "b")).toBe("consultation:new#b");
    expect(formInstanceKey(undefined)).toBe("main");
    expect(formInstanceKey("b")).toBe("b");
    expect(withFormInstance("/enrollment/new", "b")).toBe("/enrollment/new?form=b");
    expect(withFormInstance("/meetings/new?embed=1", "c")).toBe("/meetings/new?embed=1&form=c");
  });

  it("recordingSince = 이 작성 화면(경로 + form)에 걸린 녹음의 시각 — 다른 작성 화면·파일 없이 끝난 녹음은 안 본다", () => {
    window.history.replaceState(null, "", "/enrollment/new");
    recs.local = [
      { status: "recording", href: "/enrollment/new?embed=1", startedAt: 100 },
      { status: "paused", href: "/enrollment/new?form=x", startedAt: 50 },
      { status: "failed", href: "/enrollment/new", startedAt: 10 },
    ];
    expect(recordingSince(undefined)).toBe(100);
    expect(recordingSince("x")).toBe(50);
    expect(recordingSince("y")).toBeUndefined();
    recs.local = [{ status: "ready", href: "/enrollment/new", startedAt: 30, file: new File(["a"], "a.webm") }];
    expect(recordingSince(undefined)).toBe(30);
  });

  it("단일 화면 '새 X' — 첫 작성 화면에 녹음이 걸려 있으면(이 탭·다른 탭) 새 작성 화면, 비어 있으면 첫 화면 그대로", () => {
    expect(pageFormHref("/enrollment/new")).toBe("/enrollment/new");
    recs.local = [{ status: "paused", href: "/enrollment/new?form=x", startedAt: 1 }];
    expect(pageFormHref("/enrollment/new")).toBe("/enrollment/new");
    recs.local = [{ status: "recording", href: "/enrollment/new", startedAt: 1 }];
    expect(pageFormHref("/enrollment/new")).toMatch(/^\/enrollment\/new\?form=.+/);
    recs.local = [];
    recs.foreign = [{ status: "recording", href: "/consultations/new?recordStudent=a", requestId: "f" }];
    expect(pageFormHref("/consultations/new?studentId=b")).toMatch(/^\/consultations\/new\?studentId=b&form=.+/);
  });
});
