import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ tx: vi.fn(), begin: vi.fn(), end: vi.fn(), connect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("postgres", () => ({ default: m.connect }));
import { saveEnglishName } from "./english-name-store";
const input = { tenantId: "branch", studentId: "student", englishName: "Lucy", previousEnglishName: null };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DATABASE_URL", "postgres://test");
  m.connect.mockReturnValue({ begin: m.begin, end: m.end });
  m.begin.mockImplementation(async (_mode, fn) => fn(m.tx));
  m.tx.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("returning id") ? [{ id: "student" }] : []);
});
afterEach(() => vi.unstubAllEnvs());
describe("영문 이름 저장 트랜잭션", () => {
  it("지점 잠금 뒤 중복을 검사하고 한 필드만 조건부 갱신한다", async () => {
    expect(await saveEnglishName(input)).toBe("saved");
    const calls = m.tx.mock.calls.map(([parts, ...values]) => ({ sql: parts.join("?"), values }));
    expect(calls[2].sql).toContain("pg_advisory_xact_lock");
    expect(calls[2].values).toEqual(["student-english-name:branch"]);
    expect(calls[3].sql).toContain("lower(btrim(english_name");
    expect(calls[3].values).toEqual(["branch", "student", "Lucy"]);
    expect(calls[4].sql).toContain("update public.students set english_name=");
    expect(calls[4].sql).toContain("english_name is not distinct from");
    expect(calls[4].values).toEqual(["Lucy", "branch", "student", null]);
    expect(m.begin).toHaveBeenCalledWith("isolation level read committed", expect.any(Function));
    expect(m.end).toHaveBeenCalledOnce();
  });
  it("중복이면 갱신하지 않는다", async () => {
    m.tx.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("select id from") ? [{ id: "other" }] : []);
    expect(await saveEnglishName(input)).toBe("duplicate");
    expect(m.tx.mock.calls.some(([parts]) => parts.join("").includes("update public.students"))).toBe(false);
  });
  it("빈 이름은 중복 검사 없이 null로 지운다", async () => {
    expect(await saveEnglishName({ ...input, englishName: null, previousEnglishName: "Lucy" })).toBe("saved");
    expect(m.tx.mock.calls.some(([parts]) => parts.join("").includes("select id from"))).toBe(false);
    expect(m.tx.mock.calls.at(-1)?.slice(1)).toEqual([null, "branch", "student", "Lucy"]);
  });
  it("다른 수정이 먼저 저장되면 덮어쓰지 않는다", async () => {
    m.tx.mockResolvedValue([]);
    expect(await saveEnglishName(input)).toBe("conflict");
  });
  it("실패해도 연결을 반납한다", async () => {
    m.tx.mockRejectedValue(new Error("offline"));
    await expect(saveEnglishName(input)).rejects.toThrow("offline");
    expect(m.end).toHaveBeenCalledOnce();
  });
});
