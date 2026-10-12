import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_VIEW_MARK_COOKIE, tenantViewMarkValue } from "@/lib/auth/tenant-view-shared";
import { TenantViewSync } from "./tenant-view-sync";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — 탭에 그려진 화면과 브라우저의 실제 상태가 어긋났을 때.
 * 지키려는 것: 어긋난 화면에서는 **어떤 동작도 화면의 처리기에 닿기 전에** 멈추고, 화면을 다시 맞추러 간다.
 * 어긋나 있는 동안에는 이동이 막혀 있어도 동작을 흘려보내지 않는다(띠는 읽기 전용인데 저장이 본인 지점에 들어가지 않게).
 * 어긋나지 않은 화면에서는 아무것도 가로채지 않는다.
 */
const ME = "11111111-0000-4000-8000-000000000001";
const OTHER = "22222222-0000-4000-8000-000000000002";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TENANT_C = "cccccccc-0000-4000-8000-000000000003";

let assign: ReturnType<typeof vi.fn>;
let cookie = "";

const setMark = (operatorId: string, tenantId: string, secondsFromNow: number) => {
  cookie = `other=1; ${TENANT_VIEW_MARK_COOKIE}=${tenantViewMarkValue({ operatorId, tenantId, expiresAtSeconds: Date.now() / 1000 + secondsFromNow })}`;
};
const clearMark = () => { cookie = "other=1"; };

/** 화면의 버튼을 누른 것처럼 — 눌림(pointerdown)과 클릭이 화면 처리기에 닿았는지 본다. */
const press = () => {
  const reached = { pointerdown: false, click: false };
  const button = document.createElement("button");
  document.body.appendChild(button);
  button.addEventListener("pointerdown", () => { reached.pointerdown = true; });
  button.addEventListener("click", () => { reached.click = true; });
  button.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
  button.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  button.remove();
  return reached;
};

beforeEach(() => {
  assign = vi.fn();
  clearMark();
  window.sessionStorage.clear();
  vi.spyOn(document, "cookie", "get").mockImplementation(() => cookie);
  vi.spyOn(window.location, "assign").mockImplementation(assign as unknown as (url: string | URL) => void);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("지점 보기 화면 감시", () => {
  it("보는 중이 아니고 표식도 없으면 아무것도 가로채지 않는다", () => {
    render(<TenantViewSync userId={ME} viewingTenantId={null} serverNow={Date.now()} />);
    expect(press()).toEqual({ pointerdown: true, click: true });
    expect(assign).not.toHaveBeenCalled();
  });

  it("보는 중이고 표식이 같은 지점을 말하면 아무것도 가로채지 않는다", () => {
    setMark(ME, TENANT_B, 3600);
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
    expect(press()).toEqual({ pointerdown: true, click: true });
    expect(assign).not.toHaveBeenCalled();
  });

  it("남의 표식(이 브라우저에 남은 다른 계정의 것)은 없는 것과 같다", () => {
    setMark(OTHER, TENANT_B, 3600);
    render(<TenantViewSync userId={ME} viewingTenantId={null} serverNow={Date.now()} />);
    expect(press()).toEqual({ pointerdown: true, click: true });
    expect(assign).not.toHaveBeenCalled();
  });

  it("🔴 띠는 떠 있는데 보기가 끝났으면(다른 탭에서 끝냄) 뜨자마자 '보기 끝내기'로 가고, 그 사이 누른 것은 화면에 닿지 않는다", () => {
    clearMark();
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
    expect(assign).toHaveBeenCalledTimes(1);
    // 보던 지점을 함께 싣는다(쿠키가 먼저 지워졌어도 그 학원의 화면으로 돌아가게).
    expect(assign).toHaveBeenCalledWith(`/tenant-view/exit?why=ended&t=${TENANT_B}`);
    expect(press()).toEqual({ pointerdown: false, click: false });
    expect(assign).toHaveBeenCalledTimes(1); // 한 번만 옮긴다
  });

  it("🔴 화면을 연 뒤에 보기가 끝나면 다음에 누르는 순간 멈춘다 — 본인 지점에 저장되는 화면을 '읽기 전용'인 줄 알고 쓰지 않게", () => {
    setMark(ME, TENANT_B, 3600);
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
    expect(press()).toEqual({ pointerdown: true, click: true });
    clearMark(); // 다른 탭에서 '보기 끝내기'
    expect(press()).toEqual({ pointerdown: false, click: false });
    expect(assign).toHaveBeenCalledWith(`/tenant-view/exit?why=ended&t=${TENANT_B}`);
  });

  it("끝나기 직전(서버가 먼저 끝난 것으로 보는 구간)이면 끝난 것으로 본다", () => {
    setMark(ME, TENANT_B, 80); // 서버 60초 + 이 화면의 여유 30초 안쪽
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
    expect(assign).toHaveBeenCalledWith(`/tenant-view/exit?why=ended&t=${TENANT_B}`);
  });

  it("이 기기의 시계가 늦어도 서버 시각으로 끝나는 때를 맞춘다", () => {
    setMark(ME, TENANT_B, 600); // 이 기기 시계로는 10분 남음
    // 서버 시각은 이 기기보다 9분 30초 앞서 있다 → 실제로는 30초 남았다.
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now() + 570_000} />);
    expect(assign).toHaveBeenCalledWith(`/tenant-view/exit?why=ended&t=${TENANT_B}`);
  });

  it("🔴 본인 화면인 줄 아는데 다른 탭에서 보기를 열었으면 '화면 맞추기'로 간다(지금 주소를 실어서)", () => {
    setMark(ME, TENANT_B, 3600);
    render(<TenantViewSync userId={ME} viewingTenantId={null} serverNow={Date.now()} />);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]![0])).toMatch(/^\/tenant-view\/sync\?next=%2F/);
    expect(press()).toEqual({ pointerdown: false, click: false });
  });

  it("보는 지점이 다른 지점으로 바뀌었으면 '화면 맞추기'로 간다 — 보던 화면이었다는 것을 함께 싣는다", () => {
    setMark(ME, TENANT_C, 3600);
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
    expect(String(assign.mock.calls[0]![0])).toMatch(/^\/tenant-view\/sync\?next=.*&from=view$/);
  });

  it("🔴 저절로는 같은 어긋남에 한 번만 옮기지만, 어긋나 있는 동안 누른 것은 **끝까지 먹는다**(흘려보내지 않는다)", () => {
    setMark(ME, TENANT_B, 3600);
    const first = render(<TenantViewSync userId={ME} viewingTenantId={null} serverNow={Date.now()} />);
    expect(assign).toHaveBeenCalledTimes(1);
    first.unmount();
    // 맞추고 돌아온 화면(새 문서)인데 여전히 어긋나 있다 — 저절로 다시 옮기지는 않는다(끝없는 새로 고침 방지).
    render(<TenantViewSync userId={ME} viewingTenantId={null} serverNow={Date.now()} />);
    expect(assign).toHaveBeenCalledTimes(1);
    // 그래도 누른 것은 화면에 닿지 않고, 사람이 눌렀으니 다시 맞추러 간다.
    expect(press()).toEqual({ pointerdown: false, click: false });
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it("🔴 이동이 취소돼도(미저장 경고에서 '머무르기') 화면이 죽지 않는다 — 다시 누르면 잠깐 뒤 다시 옮기고, 그동안에도 먹는다", () => {
    vi.useFakeTimers();
    try {
      clearMark();
      render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
      expect(assign).toHaveBeenCalledTimes(1);
      // 방금 시도한 이동이 진행 중일 수 있다 — 곧바로 다시 옮기지는 않되 누른 것은 먹는다.
      expect(press()).toEqual({ pointerdown: false, click: false });
      expect(assign).toHaveBeenCalledTimes(1);
      // 이동이 취소된 채 시간이 지났다 — 다시 누르면 다시 옮긴다.
      vi.advanceTimersByTime(2_100);
      expect(press()).toEqual({ pointerdown: false, click: false });
      expect(assign).toHaveBeenCalledTimes(2);
      // 저절로 도는 확인(5초마다)은 이 문서에서 다시 옮기지 않는다.
      vi.advanceTimersByTime(20_000);
      expect(assign).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("뒤로 가기로 되살아난 화면(bfcache)은 이동 시도 기록을 지우고 다시 본다", () => {
    clearMark();
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
    expect(assign).toHaveBeenCalledTimes(1);
    window.sessionStorage.clear(); // 되살아난 화면은 한참 뒤일 수 있다(되풀이 방지 시간이 지났다)
    const shown = new Event("pageshow") as Event & { persisted: boolean };
    Object.defineProperty(shown, "persisted", { value: true });
    window.dispatchEvent(shown);
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it("🔴 사람이 '보기 끝내기'를 누른 직후에는 저절로 끝내러 가지 않는다 — 가던 길(보던 학원의 운영 콘솔 화면)을 덮지 않는다", () => {
    vi.useFakeTimers();
    try {
      setMark(ME, TENANT_B, 3600);
      render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
      const exit = document.createElement("a");
      exit.setAttribute("href", "/tenant-view/exit");
      exit.addEventListener("click", (e) => e.preventDefault()); // 시험 환경에서는 실제로 떠나지 않는다
      document.body.appendChild(exit);
      exit.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      // 끝내기 요청이 쿠키를 지웠다 — 새 화면이 뜨기 전에 이 문서의 타이머가 돈다.
      clearMark();
      vi.advanceTimersByTime(6_000);
      expect(assign).not.toHaveBeenCalled();
      // 그사이 사람이 누른 것은 여전히 먹는다(지키는 것은 그대로다) — 다시 끝내러 가지는 않고 가던 이동에 맡긴다.
      expect(press()).toEqual({ pointerdown: false, click: false });
      expect(assign).not.toHaveBeenCalled();
      exit.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("끝내기를 눌렀는데 떠나지 못했으면(이동이 취소됐다) 잠시 뒤에는 다시 저절로 견준다", () => {
    vi.useFakeTimers();
    try {
      setMark(ME, TENANT_B, 3600);
      render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
      const exit = document.createElement("a");
      exit.setAttribute("href", "/tenant-view/exit?why=x");
      exit.addEventListener("click", (e) => e.preventDefault());
      document.body.appendChild(exit);
      exit.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
      clearMark();
      vi.advanceTimersByTime(16_000);
      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith(`/tenant-view/exit?why=ended&t=${TENANT_B}`);
      exit.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("어긋남이 풀리면(다른 탭에서 같은 지점을 다시 열었다) 다시 아무것도 가로채지 않는다", () => {
    clearMark();
    render(<TenantViewSync userId={ME} viewingTenantId={TENANT_B} serverNow={Date.now()} />);
    expect(press()).toEqual({ pointerdown: false, click: false });
    setMark(ME, TENANT_B, 3600);
    expect(press()).toEqual({ pointerdown: true, click: true });
  });
});
