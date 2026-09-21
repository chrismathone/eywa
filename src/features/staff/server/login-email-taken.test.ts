import { describe, expect, it } from "vitest";
import { escapeLikePattern, isLoginEmailTakenElsewhere } from "./login-email-taken";

type Row = { id: string; email: string | null };

/** 호출 인자를 기록하는 가짜 admin — 실제 체인 모양(from→select→ilike→neq→limit)만 흉내 낸다. */
function fakeAdmin(result: { data: Row[] | null; error: unknown } | Error) {
  const calls: { table?: string; cols?: string; ilike?: [string, string]; neq?: [string, string]; limit?: number; queried: number } = {
    queried: 0,
  };
  const admin = {
    from(table: string) {
      calls.table = table;
      calls.queried += 1;
      return {
        select(cols: string) {
          calls.cols = cols;
          return {
            ilike(col: string, pattern: string) {
              calls.ilike = [col, pattern];
              return {
                neq(c: string, v: string) {
                  calls.neq = [c, v];
                  return {
                    limit(n: number) {
                      calls.limit = n;
                      if (result instanceof Error) return Promise.reject(result);
                      return Promise.resolve(result);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { admin, calls };
}

describe("isLoginEmailTakenElsewhere — 로그인 이메일은 전 지점을 통틀어 하나", () => {
  it("다른 계정이 쓰고 있으면 true — 지점(tenant_id)으로 거르지 않고, 본인은 뺀다", async () => {
    const { admin, calls } = fakeAdmin({ data: [{ id: "other", email: "Kim_Teacher@ex.com" }], error: null });
    expect(await isLoginEmailTakenElsewhere(admin, " kim_teacher@EX.com ", "me")).toBe(true);
    expect(calls.table).toBe("users");
    expect(calls.cols).toBe("id, email"); // 지점·이름은 읽지 않는다
    expect(calls.ilike).toEqual(["email", "kim\\_teacher@ex.com"]);
    expect(calls.neq).toEqual(["id", "me"]);
  });

  it("아무도 안 쓰면 false", async () => {
    const { admin } = fakeAdmin({ data: [], error: null });
    expect(await isLoginEmailTakenElsewhere(admin, "a@b.com", "me")).toBe(false);
  });

  it("🔴 부분 일치로는 true가 안 된다 — 서버가 넓게 돌려줘도 글자까지 같아야 한다(남의 지점 이메일 열거 차단)", async () => {
    const { admin } = fakeAdmin({ data: [{ id: "other", email: "abXYZ@gmail.com" }], error: null });
    expect(await isLoginEmailTakenElsewhere(admin, "ab_yz@gmail.com", "me")).toBe(false);
  });

  it("🔴 `*`가 든 값은 아예 묻지 않는다 — PostgREST가 `*`를 `%`로 치환해 이스케이프할 수 없다", async () => {
    const { admin, calls } = fakeAdmin({ data: [{ id: "other", email: "abc@gmail.com" }], error: null });
    expect(await isLoginEmailTakenElsewhere(admin, "ab*@gmail.com", "me")).toBe(false);
    expect(calls.queried).toBe(0);
  });

  it("조회 실패·예외는 false — 막지 않는다(최종 방어선은 Auth 유니크)", async () => {
    expect(await isLoginEmailTakenElsewhere(fakeAdmin({ data: null, error: { message: "boom" } }).admin, "a@b.com", "me")).toBe(false);
    expect(await isLoginEmailTakenElsewhere(fakeAdmin(new Error("network")).admin, "a@b.com", "me")).toBe(false);
  });
});

describe("escapeLikePattern", () => {
  it("와일드카드와 이스케이프 문자를 글자 그대로", () => {
    expect(escapeLikePattern("a_b%c\\d@x.com")).toBe("a\\_b\\%c\\\\d@x.com");
    expect(escapeLikePattern("plain@x.com")).toBe("plain@x.com");
  });
});
