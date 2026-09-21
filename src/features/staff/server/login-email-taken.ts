import "server-only";

/**
 * **이 이메일을 다른 계정이 이미 로그인 아이디로 쓰는가 — 전 지점을 통틀어.**
 *
 * 왜 따로 있나(적대 리뷰 2026-09-21): 계정 **생성**(`createUser`)은 Auth가 422 `email_exists`로 또렷이 답하지만,
 * 이메일 **변경**(`updateUserById`)은 서버에 사전검사가 없어 유니크 위반이 500 `unexpected_failure`
 * "Error updating user"로 뭉개져 온다 — 오류만 봐서는 중복인지 알 수 없다. 그래서 변경 경로는 Auth를 부르기 **전에**
 * 여기서 확인한다(지점 안 중복 검사는 `(tenant_id, email)` 축이라 다른 지점의 같은 이메일을 못 잡는다).
 *
 * 🔴 **일부러 `tenant_id`로 거르지 않는다** — 로그인 이메일은 Auth가 전 지점에서 하나로 막는 값이고(`users_email_partial_key`),
 *    "계정이 곧 지점"(C안)이 그 위에 서 있다. admin(service_role) 클라이언트로 부를 것 — 세션 클라이언트는 RLS 때문에
 *    제 지점만 보여 항상 "없음"이라 답한다.
 * 🔴 돌려주는 것은 **있다/없다뿐**이고, 그것도 **글자까지 같은 이메일**에 대해서만이다(대소문자만 무시). 전 지점을 보는 조회라
 *    부분 일치를 허용하면 `updateMyEmail`(로그인한 누구나)로 남의 지점 이메일을 한 글자씩 좁혀 갈 수 있다(재리뷰 2026-09-21):
 *    ① `%` `_` `\`는 이스케이프한다 ② **`*`가 든 값은 조회하지 않는다** — PostgREST가 `*`를 `%`의 별칭으로 서버에서 치환해
 *    백슬래시로도 못 막는다(그런 주소는 Auth 유니크에 맡긴다 = 종전 동작) ③ 받은 행을 JS에서 완전 일치로 한 번 더 본다.
 * ⚠️ 조회가 실패하면 false(막지 않는다) — 최종 방어선은 여전히 Auth의 유니크다. 여기는 친절한 안내를 위한 앞문일 뿐.
 * ⚠️ `public.users`에 행이 없는 계정(super-admin 전용 계정 등)은 못 본다 — 그 경우는 Auth 오류로 떨어진다(종전 그대로).
 */
type UsersLookupClient = {
  from(table: "users"): {
    select(cols: string): {
      ilike(
        col: string,
        pattern: string,
      ): {
        neq(
          col: string,
          v: string,
        ): { limit(n: number): PromiseLike<{ data: { id: string; email: string | null }[] | null; error: unknown }> };
      };
    };
  };
};

/** `ilike` 패턴에서 와일드카드(`%` `_`)와 이스케이프 문자(`\`)를 글자 그대로 맞추게 한다 — 이메일엔 `_`가 흔하다. */
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function isLoginEmailTakenElsewhere(
  admin: unknown,
  email: string,
  exceptUserId: string,
): Promise<boolean> {
  const want = email.trim().toLowerCase();
  // `*` = PostgREST의 `%` 별칭(이스케이프 불가) — 글자 그대로 못 맞추는 값은 아예 묻지 않는다(위 🔴 ②).
  if (!want || want.includes("*")) return false;
  try {
    const { data, error } = await (admin as UsersLookupClient)
      .from("users")
      .select("id, email")
      .ilike("email", escapeLikePattern(want))
      .neq("id", exceptUserId)
      .limit(5);
    if (error) return false;
    return (data ?? []).some((r) => (r.email ?? "").trim().toLowerCase() === want);
  } catch {
    return false;
  }
}
