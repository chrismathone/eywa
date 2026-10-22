import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_BRANCH_STORAGE_KEY } from "@/features/video-submit/site";
import { VideoSiteForm } from "./video-site-form";

/**
 * 올리기 사이트 화면의 지점(2026-10-04) — 주소는 하나이고, 지점은 화면이 정해 **요청마다 실어 보낸다**.
 * 하나뿐이면 묻지 않고 그 지점에 고정, 여럿이거나 판정하지 못한 지점이 있으면 화면에서 고른다.
 * 서버 판정은 server/site.test.ts가 본다. 여기서는 화면이 지점을 어떻게 보내고, 서버의 '다시 고르라'를 어떻게 받는지만.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "99999999-9999-4999-8999-999999999999";
const BRANCHES = [{ id: A, name: "인재원 침산" }, { id: B, name: "인재원 수성" }];
const CHOICE = { id: "c".repeat(40), studentLabel: "류*경", className: "LT4", homeworkLabel: "10/1 (목)" };

let replies: unknown[];
const fetchMock = vi.fn(async () => new Response(JSON.stringify(replies.shift() ?? { ok: false, code: "error", error: "더 줄 답이 없다" })));
const bodies = () => fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>);
const fill = () => {
  fireEvent.change(screen.getByLabelText("휴대폰 번호 뒷 4자리"), { target: { value: "5678" } });
  fireEvent.change(screen.getByLabelText("내 이름"), { target: { value: "류태경" } });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
};

beforeEach(() => {
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("올리기 사이트 — 지점", () => {
  it("쓰는 지점이 하나면 지점을 묻지 않는다(화면은 지금까지와 같다) — 🔴 요청은 그 지점에 고정해 보낸다", async () => {
    replies = [{ ok: true, choices: [CHOICE] }, { ok: false, code: "limit", error: "잠시 동안 너무 많이 시도했습니다." }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    expect(screen.queryByText("다니는 지점을 골라 주세요")).toBeNull();
    expect(screen.queryByRole("button", { name: "지점 바꾸기" })).toBeNull();
    expect(screen.getByText("인재원")).toBeInTheDocument();
    fill();
    await screen.findByText("올릴 숙제를 골라 주세요");
    fireEvent.click(screen.getByRole("button", { name: /10\/1 \(목\) 수업 숙제/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("너무 많이 시도"));
    expect(bodies()).toEqual([
      { op: "lookup", last4: "5678", name: "류태경", tenant: A },
      { op: "open", last4: "5678", name: "류태경", choice: CHOICE.id, tenant: A },
    ]);
  });
  it("여럿이면 맨 먼저 지점을 고른다 — 고른 지점으로 조회하고, 열기도 같은 지점으로 보낸다", async () => {
    replies = [{ ok: true, choices: [CHOICE] }, { ok: false, code: "limit", error: "잠시 동안 너무 많이 시도했습니다." }];
    render(<VideoSiteForm academyName="학원" branches={BRANCHES} mustChoose maxLabel="1GB" />);
    expect(screen.getByText("다니는 지점을 골라 주세요")).toBeInTheDocument();
    // 지점을 고르기 전엔 번호·이름 칸이 없다(지점 없이 조회를 보내지 않는다)
    expect(screen.queryByLabelText("내 이름")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "인재원 수성" }));
    expect(screen.getAllByText("인재원 수성").length).toBeGreaterThan(0);
    fill();
    await screen.findByText("올릴 숙제를 골라 주세요");
    fireEvent.click(screen.getByRole("button", { name: /10\/1 \(목\) 수업 숙제/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("너무 많이 시도"));
    expect(bodies()).toEqual([
      { op: "lookup", last4: "5678", name: "류태경", tenant: B },
      { op: "open", last4: "5678", name: "류태경", choice: CHOICE.id, tenant: B },
    ]);
    // 주소에는 지점이 없다 — 요청 주소는 늘 같은 한 곳
    expect(new Set(fetchMock.mock.calls.map((call) => (call as unknown as [string])[0]))).toEqual(new Set(["/api/video-submit/site"]));
  });
  it("🔴 쓸 수 있는 지점이 하나여도 판정하지 못한 지점이 있으면(mustChoose) 자동으로 정하지 않고 고르게 한다", () => {
    render(<VideoSiteForm academyName="학원" branches={[BRANCHES[0]!]} mustChoose maxLabel="1GB" />);
    expect(screen.getByText("다니는 지점을 골라 주세요")).toBeInTheDocument();
    expect(screen.queryByLabelText("내 이름")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "인재원 침산" }));
    expect(screen.getByLabelText("내 이름")).toBeInTheDocument();
  });
  it("'지점 바꾸기'로 다시 고를 수 있다 · 고른 지점은 이 기기에 기억해 다음엔 미리 골라 둔다", () => {
    const { unmount } = render(<VideoSiteForm academyName="학원" branches={BRANCHES} mustChoose maxLabel="1GB" />);
    fireEvent.click(screen.getByRole("button", { name: "인재원 침산" }));
    expect(window.localStorage.getItem(SITE_BRANCH_STORAGE_KEY)).toBe(A);
    fireEvent.click(screen.getByRole("button", { name: "지점 바꾸기" }));
    expect(screen.getByText("다니는 지점을 골라 주세요")).toBeInTheDocument();
    unmount();
    // 다시 열면 기억해 둔 지점이 골라져 있다(바꿀 수 있다)
    render(<VideoSiteForm academyName="학원" branches={BRANCHES} mustChoose maxLabel="1GB" />);
    expect(screen.queryByText("다니는 지점을 골라 주세요")).toBeNull();
    expect(screen.getByRole("button", { name: "지점 바꾸기" })).toBeInTheDocument();
  });
  it("기억해 둔 지점이 목록에 없으면(그사이 꺼진 지점·남의 값) 쓰지 않고 다시 고르게 한다", () => {
    window.localStorage.setItem(SITE_BRANCH_STORAGE_KEY, B);
    render(<VideoSiteForm academyName="학원" branches={[BRANCHES[0]!]} mustChoose maxLabel="1GB" />);
    expect(screen.getByText("다니는 지점을 골라 주세요")).toBeInTheDocument();
  });
  it("🔴 기억해 둔 지점이 목록에서 빠졌으면(그 지점이 계정을 바꾸는 중·해제) 남은 지점이 하나여도 저절로 옮겨 가지 않는다 — 직접 고른 뒤에만 보낸다", async () => {
    replies = [{ ok: true, choices: [CHOICE] }];
    window.localStorage.setItem(SITE_BRANCH_STORAGE_KEY, B);
    // 서버가 그린 화면: 쓸 수 있는 지점은 침산 하나, 판정 못 한 지점 없음(mustChoose 아님) — 예전엔 묻지 않고 침산으로 보냈다.
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    expect(screen.getByText("다니는 지점을 골라 주세요")).toBeInTheDocument();
    expect(screen.queryByLabelText("내 이름")).toBeNull(); // 고르기 전엔 번호·이름을 넣을 수 없다
    expect(screen.queryByRole("button", { name: "인재원 수성" })).toBeNull(); // 빠진 지점은 선택지에 없다
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "인재원 침산" }));
    fill();
    await screen.findByText("올릴 숙제를 골라 주세요");
    expect(bodies()).toEqual([{ op: "lookup", last4: "5678", name: "류태경", tenant: A }]);
    expect(window.localStorage.getItem(SITE_BRANCH_STORAGE_KEY)).toBe(A); // 직접 고른 지점을 새로 기억한다
  });
  it("기억해 둔 지점이 그 하나뿐인 지점이면(또는 기억한 것이 없으면) 종전대로 묻지 않는다", () => {
    window.localStorage.setItem(SITE_BRANCH_STORAGE_KEY, A);
    const { unmount } = render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    expect(screen.queryByText("다니는 지점을 골라 주세요")).toBeNull();
    expect(screen.getByLabelText("내 이름")).toBeInTheDocument();
    unmount();
    window.localStorage.clear();
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    expect(screen.queryByText("다니는 지점을 골라 주세요")).toBeNull();
    expect(screen.getByLabelText("내 이름")).toBeInTheDocument();
  });
  it("🔴 고정해 둔 지점이 그사이 꺼지고 다른 지점만 남아도 그 지점으로 저절로 옮겨 가지 않는다 — 서버가 준 목록에서 직접 고르게 한다", async () => {
    replies = [{ ok: false, code: "branch", error: "지점을 골라 주세요.", branches: [BRANCHES[1]] }, { ok: true, choices: [CHOICE] }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    fill();
    await screen.findByText("다니는 지점을 골라 주세요");
    expect(screen.getByRole("alert")).toHaveTextContent("지점을 골라 주세요.");
    // 하나만 남았어도 번호·이름 칸으로 바로 가지 않는다 — 고르기 전엔 다시 보낼 수 없다
    expect(screen.queryByLabelText("내 이름")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "인재원 수성" }));
    // 넣어 둔 번호·이름은 남아 있다 — 다시 누르기만 하면 된다
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByText("올릴 숙제를 골라 주세요");
    expect(bodies().map((body) => body.tenant)).toEqual([A, B]);
  });
  it("서버가 여러 지점을 주면 그 자리에서 고르게 한다(지점이 늘어난 경우)", async () => {
    replies = [{ ok: false, code: "branch", error: "지점을 골라 주세요.", branches: BRANCHES }, { ok: true, choices: [CHOICE] }];
    render(<VideoSiteForm academyName="인재원" maxLabel="1GB" />);
    fill();
    await screen.findByText("다니는 지점을 골라 주세요");
    fireEvent.click(screen.getByRole("button", { name: "인재원 침산" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByText("올릴 숙제를 골라 주세요");
    // 지점 목록을 받지 못한 화면(옛 호출 모양)은 지점 없이 보낸다 — 서버가 그 요청을 스스로 판정한다
    expect(bodies().map((body) => body.tenant)).toEqual([undefined, A]);
  });
});

describe("올리기 사이트 — 지난 반 숙제(원장 2026-10-21)", () => {
  it("반을 옮기기 전 반에서 받은 숙제 줄에는 '지난 반'을 붙인다 · 지금 반 줄에는 없다", async () => {
    replies = [{ ok: true, choices: [
      { ...CHOICE, className: "BS2C", pastClass: true },
      { id: "d".repeat(40), studentLabel: "류*경", className: "BS2D", homeworkLabel: "", free: true },
    ] }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    fill();
    // 반이 둘이라 반부터 고른다(선생님 → 반 → 숙제 · 원장 2026-10-22) — 반 줄에 '지난 반'
    await screen.findByText("반을 골라 주세요");
    expect(screen.getByText("BS2C · 지난 반")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /BS2D/ })).not.toHaveTextContent("지난 반");
  });
});

describe("올리기 사이트 — 이미 낸 숙제를 다시 누르면 묻는다(원장 2026-10-22)", () => {
  // 김채현 건 — 남정화(BS1D)·허주연(BS1K) 두 선생님. 선생님 → 반 → 숙제.
  const SENT = { ...CHOICE, className: "BS1K", homeworkLabel: "10/20 (화)", sent: 1, teacherKey: "t2", teacherLabel: "허주연 (수학)", classKey: "c2" };
  const UNSENT = { ...CHOICE, id: "e".repeat(40), className: "BS1D", homeworkLabel: "10/19 (월)", teacherKey: "t1", teacherLabel: "남정화 (수학)", classKey: "c1" };
  const toHeo = async () => {
    await screen.findByText("숙제를 낸 선생님을 골라 주세요");
    fireEvent.click(screen.getByRole("button", { name: /허주연 \(수학\)/ }));
    await screen.findByText("올릴 숙제를 골라 주세요");
  };
  it("바로 열지 않고 '이미 냈어요 · 아직 안 낸 숙제(다른 선생님 숙제까지)'를 보인다 — '다른 숙제 고르기'는 상자만 닫는다", async () => {
    replies = [{ ok: true, choices: [UNSENT, SENT] }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    fill();
    await toHeo();
    fireEvent.click(screen.getByRole("button", { name: /10\/20 \(화\) 수업 숙제/ }));
    expect(screen.getByText("이 숙제에는 이미 영상 1개를 냈어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10/19 (월) 수업 숙제 · 남정화 (수학) · BS1D" })).toBeInTheDocument();
    expect(bodies().map((b) => b.op)).toEqual(["lookup"]);
    // 같은 줄을 또 눌러도 열리지 않는다(두 번 빠르게 누르면 상자를 읽기 전에 열리던 구멍)
    fireEvent.click(screen.getByRole("button", { name: /10\/20 \(화\) 수업 숙제/ }));
    expect(bodies().map((b) => b.op)).toEqual(["lookup"]);
    fireEvent.click(screen.getByRole("button", { name: "다른 숙제 고르기" }));
    expect(screen.queryByText("이 숙제에는 이미 영상 1개를 냈어요")).toBeNull();
    expect(bodies().map((b) => b.op)).toEqual(["lookup"]);
  });
  it("'이 숙제에 더 올리기'를 누르면 그 숙제를 연다(같은 숙제의 다른 단원 — 막지 않는다)", async () => {
    replies = [{ ok: true, choices: [UNSENT, SENT] }, { ok: false, code: "limit", error: "잠시 동안 너무 많이 시도했습니다." }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    fill();
    await toHeo();
    fireEvent.click(screen.getByRole("button", { name: /10\/20 \(화\) 수업 숙제/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 숙제에 더 올리기" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("너무 많이 시도"));
    expect(bodies()[1]).toMatchObject({ op: "open", choice: SENT.id });
    // 실패 뒤에도 같은 선생님·반 화면에 남는다(처음 단계로 튀지 않는다)
    expect(screen.getByText("올릴 숙제를 골라 주세요")).toBeInTheDocument();
  });
  it("확인 상자의 안 낸 숙제 줄을 누르면 그 숙제(다른 선생님 숙제)를 바로 연다", async () => {
    replies = [{ ok: true, choices: [UNSENT, SENT] }, { ok: false, code: "limit", error: "잠시 동안 너무 많이 시도했습니다." }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    fill();
    await toHeo();
    fireEvent.click(screen.getByRole("button", { name: /10\/20 \(화\) 수업 숙제/ }));
    fireEvent.click(screen.getByRole("button", { name: "10/19 (월) 수업 숙제 · 남정화 (수학) · BS1D" }));
    await waitFor(() => expect(bodies()[1]).toMatchObject({ op: "open", choice: UNSENT.id }));
  });
  it("선생님 단계 = 이름을 크게 + 반 · 안 낸 숙제 수 · '다른 선생님 고르기'로 돌아온다", async () => {
    replies = [{ ok: true, choices: [UNSENT, SENT] }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    fill();
    await screen.findByText("숙제를 낸 선생님을 골라 주세요");
    expect(screen.getByRole("button", { name: /남정화 \(수학\)/ })).toHaveTextContent("아직 안 낸 숙제 1개");
    expect(screen.getByRole("button", { name: /허주연 \(수학\)/ })).toHaveTextContent("모두 영상을 냈어요");
    fireEvent.click(screen.getByRole("button", { name: /허주연 \(수학\)/ }));
    await screen.findByText("올릴 숙제를 골라 주세요");
    fireEvent.click(screen.getByRole("button", { name: "다른 선생님 고르기" }));
    expect(screen.getByText("숙제를 낸 선생님을 골라 주세요")).toBeInTheDocument();
  });
  it("안 낸 숙제는 묻지 않고 바로 연다 · 안 낸 숙제가 없으면 '같은 숙제의 다른 단원' 안내만", async () => {
    replies = [{ ok: true, choices: [SENT] }];
    render(<VideoSiteForm academyName="인재원" branches={[BRANCHES[0]!]} maxLabel="1GB" />);
    fill();
    await screen.findByText("올릴 숙제를 골라 주세요");
    fireEvent.click(screen.getByRole("button", { name: /10\/20 \(화\) 수업 숙제/ }));
    expect(screen.getByText("같은 숙제의 다른 단원 영상이면 더 올려 주세요.")).toBeInTheDocument();
  });
});
