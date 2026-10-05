import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginForm } from "./login-form";

const { signInWithPassword } = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithPassword } }) }));

function submitCredentials() {
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "teacher@academy.kr" } });
  fireEvent.change(screen.getByLabelText("비밀번호", { exact: true }), { target: { value: "example-password" } });
  fireEvent.submit(screen.getByRole("button", { name: "로그인" }).closest("form")!);
}

beforeEach(() => { signInWithPassword.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("LoginForm", () => {
  it("uses POST in server-rendered HTML before hydration", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toMatch(/<form[^>]*method="post"/);
  });

  it.each([
    [{ code: "invalid_credentials", status: 400 }, "계정 또는 비밀번호가 올바르지 않습니다."],
    [{ code: "over_request_rate_limit", status: 429 }, "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요."],
    [{ code: "email_not_confirmed" }, "계정 확인이 필요합니다. 학원 관리자에게 문의해 주세요."],
    [{ message: "internal service details" }, "로그인하지 못했습니다. 잠시 후 다시 시도하거나 학원 관리자에게 문의해 주세요."],
  ])("explains authentication failures and allows retry", async (error, message) => {
    signInWithPassword.mockResolvedValue({ error });
    render(<LoginForm />);
    submitCredentials();
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "로그인" })).toBeEnabled();
  });

  it("recovers from a network rejection without leaving the form disabled", async () => {
    signInWithPassword.mockRejectedValue(new Error("offline"));
    render(<LoginForm />);
    submitCredentials();
    expect(await screen.findByRole("alert")).toHaveTextContent("연결 상태를 확인");
    expect(screen.getByLabelText("이메일")).toBeEnabled();
  });

  it.each([[undefined, "/home?login=1"], ["//example.com", "/home?login=1"], ["/login", "/home?login=1"], ["/attendance?view=live", "/home?login=1&next=%2Fattendance%3Fview%3Dlive"]])("navigates with a fresh document after login: %s", async (next, destination) => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginForm next={next} />);
    submitCredentials();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(destination));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "teacher@academy.kr", password: "example-password" });
  });

  it("prevents duplicate requests while a login is in flight", () => {
    signInWithPassword.mockReturnValue(new Promise(() => {}));
    render(<LoginForm />);
    submitCredentials();
    fireEvent.submit(screen.getByLabelText("이메일").closest("form")!);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "로그인 중…" })).toBeDisabled();
  });

  it("offers a keyboard-accessible password visibility toggle", () => {
    render(<LoginForm />);
    const toggle = screen.getByRole("button", { name: "비밀번호 표시" });
    expect(toggle.tabIndex).toBe(0);
    fireEvent.click(toggle);
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 숨기기" }));
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveAttribute("type", "password");
  });

  it("accepts the reserved admin ID and lands on /admin", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginForm next="/attendance" />);
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "admin7099" } });
    fireEvent.change(screen.getByLabelText("비밀번호", { exact: true }), { target: { value: "example-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "로그인" }).closest("form")!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/home?login=1&next=%2Fadmin"));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "admin7099@login.aywa.co.kr",
      password: "example-password",
    });
  });
});
