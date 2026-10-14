import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 녹음 캡슐 정보창(원장 2026-10-14) — "눌러서 정보창 띄워놓은채로 있으면 시간이 계속 보이게" ·
 * "정보창 위치도 녹음 아이콘 위치에 따라 스마트하게". 정보창은 X·캡슐 다시 누르기·Esc·바깥 클릭으로만 닫히고,
 * 캡슐을 끌거나 창 크기가 바뀌면 닫지 않고 자리만 다시 잡는다. 자리 계산 자체는 recording-panel-placement.test.ts.
 */
vi.mock("@/lib/recording-recovery", async (original) => ({
  ...await original<typeof import("@/lib/recording-recovery")>(),
  saveChunk: async () => {},
  startRecoverySession: async (kind: string, mimeType: string) => ({ id: "session", kind, mimeType, fileName: "회의.webm" }),
}));
vi.mock("@/lib/audio-upload", async (original) => ({ ...await original<typeof import("@/lib/audio-upload")>(), downloadFile: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/meetings/new", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/realtime/window-busy", () => ({ publishWindowBusy: vi.fn() }));

import { adoptRecordingOwner, dismissBrowserRecording, startBrowserRecording, stopBrowserRecording } from "@/lib/browser-recording";
import { RecordingRuntime } from "./recording-runtime";

const LONG_TITLE = "2026년 10월 정기 운영 회의 — 시간표 개편과 신입생 상담 일정 점검";
const scope = { tenantId: "t1", userId: "u1", recordKey: "meeting:new", label: LONG_TITLE };
class FakeRecorder {
  static isTypeSupported(mime: string) { return mime === "audio/webm;codecs=opus"; }
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["a"]) }); this.onstop?.(); }
}
/** happy-dom은 배치를 안 한다 — 앵커는 style 좌표, 정보창은 320×200으로 잰다. */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const left = parseFloat(this.style.left) || 0;
    const top = parseFloat(this.style.top) || 0;
    const [width, height] = this.dataset.recordingId ? [48, 48] : [320, 200];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.getAttribute("aria-label") === "녹음 진행" ? 320 : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.getAttribute("aria-label") === "녹음 진행" ? 200 : 0; });
  Object.assign(HTMLElement.prototype, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => true });
}
function resizeTo(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

beforeEach(async () => {
  vi.useFakeTimers();
  resizeTo(1440, 900);
  stubLayout();
  adoptRecordingOwner({ tenantId: "reset", userId: crypto.randomUUID() });
  adoptRecordingOwner(scope);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }), enumerateDevices: async () => [{ kind: "audioinput" }] } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (_key: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => callback({}),
    query: async () => ({ held: [] }),
  } });
  render(<RecordingRuntime />);
  await act(async () => { await startBrowserRecording("meeting", scope); });
});
afterEach(() => {
  act(() => { stopBrowserRecording(); dismissBrowserRecording(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const capsule = () => screen.getByRole("button", { name: /진행 확인$/ });
const panel = () => screen.queryByRole("region", { name: "녹음 진행" });
const anchor = () => capsule().parentElement as HTMLElement;
function open() {
  fireEvent.click(capsule(), { detail: 1 });
  expect(panel()).not.toBeNull();
}
/** 마우스 한 번 누르기 = pointerdown → pointerup → click(같은 자리) */
function press(element: Element, at = { clientX: 20, clientY: 20 }) {
  fireEvent.pointerDown(element, { pointerId: 9, isPrimary: true, button: 0, ...at });
  fireEvent.pointerUp(element, { pointerId: 9, ...at });
  fireEvent.click(element, { detail: 1, ...at });
}

describe("녹음 정보창 — 띄워 둔 동안 시간이 계속 보인다", () => {
  it("열어 둔 채 1초마다 올라가고 캡슐과 같은 시간을 말한다 · 열린 동안 캡슐도 펼친 채", () => {
    open();
    for (const expected of ["00:01", "00:02", "00:03", "00:10"]) {
      act(() => { vi.advanceTimersByTime(expected === "00:10" ? 7000 : 1000); });
      expect(panel()).toHaveTextContent(expected);
      expect(capsule()).toHaveAccessibleName(new RegExp(`· ${expected} ·`));
      expect(anchor().textContent).toContain(expected);
    }
    expect(anchor().dataset.open).toBe("true");
    expect(capsule()).toHaveAttribute("aria-expanded", "true");
    expect(panel()?.dataset.placed).toBe("true");
  });

  it("캡슐을 끌어도 닫지 않고 따라온다 — 끈 뒤의 클릭은 열고 닫기로 치지 않는다", () => {
    open();
    const before = panel()!.style.top;
    const button = capsule();
    fireEvent.pointerDown(button, { pointerId: 1, isPrimary: true, button: 0, clientX: 1400, clientY: 800 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 400, clientY: 200 });
    expect(panel()).not.toBeNull();
    expect(panel()!.style.top).not.toBe(before);
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 400, clientY: 200 });
    fireEvent.click(button, { detail: 1 });
    expect(panel()).not.toBeNull();
    // 위쪽으로 옮겼으니 이제 공간이 넓은 아래로 뜬다.
    expect(parseFloat(panel()!.style.top)).toBeGreaterThan(parseFloat(anchor().style.top));
  });

  it("창 크기가 바뀌어도 닫지 않고 자리만 다시 잡는다", () => {
    open();
    const before = panel()!.style.left;
    act(() => { resizeTo(800, 600); window.dispatchEvent(new Event("resize")); });
    expect(panel()).not.toBeNull();
    expect(panel()!.style.left).not.toBe(before);
    expect(parseFloat(panel()!.style.left) + 320).toBeLessThanOrEqual(800 - 16);
  });

  it("스크롤로는 닫지 않는다", () => {
    open();
    act(() => { window.dispatchEvent(new Event("scroll")); document.dispatchEvent(new Event("scroll")); });
    expect(panel()).not.toBeNull();
  });
});

describe("녹음 정보창 — 사용자가 닫을 때만 닫힌다", () => {
  it("X", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "녹음 진행 접기" }));
    expect(panel()).toBeNull();
    expect(anchor().dataset.open).toBeUndefined();
  });
  it("캡슐 다시 누르기", () => {
    open();
    fireEvent.click(capsule(), { detail: 1 });
    expect(panel()).toBeNull();
  });
  it("Esc — 정보창 안이면 캡슐로 초점을 돌려준다", () => {
    open();
    fireEvent.keyDown(screen.getByRole("button", { name: "녹음 중지" }), { key: "Escape" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(capsule());
    open();
    fireEvent.keyDown(capsule(), { key: "Escape" });
    expect(panel()).toBeNull();
  });
  it("정보창 안 클릭은 닫지 않는다", () => {
    open();
    press(panel()!.querySelector("p")!);
    expect(panel()).not.toBeNull();
  });
});

/** 원장 2026-10-14 "바깥 클릭은 그냥 창만 닫히는걸로 멈추고 이런 액션 없이 그냥 클릭하기 전처럼" */
describe("녹음 정보창 — 바깥 클릭은 정보창만 닫고 그 클릭은 아무 일도 안 한다", () => {
  function outside() {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const view = render(<div><button type="button" onClick={onClick} onPointerDown={onPointerDown}>바깥 버튼</button><input aria-label="바깥 입력" /></div>);
    return { onClick, onPointerDown, button: view.getByRole("button", { name: "바깥 버튼" }), input: view.getByRole("textbox", { name: "바깥 입력" }) };
  }
  it("바깥 버튼을 누르면 정보창만 닫히고 버튼은 안 눌린다 — 다음 클릭부터는 평소대로", () => {
    const { onClick, onPointerDown, button } = outside();
    open();
    press(button);
    expect(panel()).toBeNull();
    expect(anchor().dataset.open).toBeUndefined();
    expect(onClick).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    press(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("손 뗀 자리의 click이 늦게 와도(터치) 삼킨다 · 다른 자리의 click은 그대로", () => {
    const { onClick, button } = outside();
    open();
    fireEvent.pointerDown(button, { pointerId: 2, isPrimary: true, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(button, { pointerId: 2, clientX: 30, clientY: 30 });
    expect(panel()).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.click(button, { clientX: 300, clientY: 300 });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { clientX: 30, clientY: 30 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("바깥 입력칸을 눌러도 초점이 옮겨 가지 않는다(누르기 기본 동작도 막는다)", () => {
    const { input } = outside();
    open();
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 2, isPrimary: true, button: 0, clientX: 30, clientY: 30 });
    input.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent.pointerUp(input, { pointerId: 2, clientX: 30, clientY: 30 });
    expect(panel()).toBeNull();
  });
  it("터치 스크롤(pointercancel)·눌러서 끌기로는 닫지 않는다", () => {
    const { button } = outside();
    open();
    fireEvent.pointerDown(button, { pointerId: 3, isPrimary: true, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerCancel(button, { pointerId: 3 });
    expect(panel()).not.toBeNull();
    fireEvent.pointerDown(button, { pointerId: 4, isPrimary: true, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(button, { pointerId: 4, clientX: 30, clientY: 200 });
    expect(panel()).not.toBeNull();
  });
  it("오른쪽 버튼·보조 포인터는 건드리지 않는다", () => {
    const { button } = outside();
    open();
    fireEvent.pointerDown(button, { pointerId: 5, isPrimary: true, button: 2, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(button, { pointerId: 5, clientX: 30, clientY: 30 });
    expect(panel()).not.toBeNull();
  });
});

it("긴 회의 제목은 한 줄 말줄임 + 전체는 title", () => {
  open();
  const title = screen.getByText(LONG_TITLE);
  expect(title.className).toContain("truncate");
  expect(title).toHaveAttribute("title", LONG_TITLE);
});
