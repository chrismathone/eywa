import { describe, expect, it, vi } from "vitest";
import { TENANT_VIEW_READONLY_MESSAGE } from "@/lib/auth/tenant-view-shared";
import { guardTenantViewFetch, isTenantViewWrite, tenantViewBlockedResponse } from "./tenant-view-guard";

const BASE = "https://abc.supabase.co";

describe("지점 보기(읽기 전용) — 쓰기 요청 판정", () => {
  it("읽기 요청은 쓰기가 아니다", () => {
    expect(isTenantViewWrite(`${BASE}/rest/v1/students?select=*`)).toBe(false);
    expect(isTenantViewWrite(`${BASE}/rest/v1/students?select=*`, { method: "GET" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/rest/v1/students?select=*`, { method: "head" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/sign/recordings/a.mp3`, { method: "GET" })).toBe(false);
  });

  it("표를 바꾸는 요청은 전부 쓰기다", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "post", "delete"]) {
      expect(isTenantViewWrite(`${BASE}/rest/v1/students`, { method })).toBe(true);
    }
    // upsert도 POST다(Prefer 헤더만 다르다).
    expect(isTenantViewWrite(`${BASE}/rest/v1/tenant_settings?on_conflict=tenant_id`, { method: "POST" })).toBe(true);
  });

  it("저장소 올리기·지우기·서명 주소 만들기와 엣지 함수도 쓰기다", () => {
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/recordings/a.mp3`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/recordings`, { method: "DELETE" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/upload/sign/recordings/a.mp3`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/functions/v1/anything`, { method: "POST" })).toBe(true);
  });

  it("저장소의 읽기용 POST(내려받기 서명 주소 · 파일 목록)는 통과한다 — 올리기용 서명은 아니다", () => {
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/sign/recordings/t/a.mp3`, { method: "POST" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/sign/recordings`, { method: "POST" })).toBe(false); // 묶음 서명(경로는 본문에)
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/list/recordings`, { method: "POST" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/upload/sign/recordings/t/a.mp3`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/move`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/copy`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/sign/recordings/t/a.mp3`, { method: "DELETE" })).toBe(true);
  });

  it("로그인 세션 유지(토큰 갱신·로그아웃)는 통과하지만 계정 관리 API는 쓰기다", () => {
    expect(isTenantViewWrite(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: "POST" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/auth/v1/logout`, { method: "POST" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/auth/v1/admin/users`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/auth/v1/admin/users/123`, { method: "PUT" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/auth/v1/admin/generate_link`, { method: "POST" })).toBe(true);
  });

  it("🔴 운영자 본인 계정을 바꾸거나 메일을 보내는 계정 요청은 쓰기다(통과하는 것은 세션 갱신 · 로그아웃뿐)", () => {
    expect(isTenantViewWrite(`${BASE}/auth/v1/user`, { method: "PUT" })).toBe(true); // 비밀번호 · 이메일 바꾸기
    expect(isTenantViewWrite(`${BASE}/auth/v1/recover`, { method: "POST" })).toBe(true); // 재설정 메일
    expect(isTenantViewWrite(`${BASE}/auth/v1/signup`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/auth/v1/otp`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/auth/v1/token/extra`, { method: "POST" })).toBe(true);
    // 읽기(GET)는 원래 통과한다.
    expect(isTenantViewWrite(`${BASE}/auth/v1/user`)).toBe(false);
  });

  it("🔴 보강관리 함수는 읽기 목록에 없다 — 지점을 로그인한 사람의 행에서 직접 읽어 본인 지점 기록이 섞인다", () => {
    for (const fn of ["makeup_list_cases", "makeup_case_detail", "makeup_list_participants", "makeup_projection_evidence"]) {
      expect(isTenantViewWrite(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST" }), fn).toBe(true);
    }
  });

  it("DB 함수는 목록에 있는 읽기 함수만 통과한다", () => {
    expect(isTenantViewWrite(`${BASE}/rest/v1/rpc/invoice_periods`, { method: "POST" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/rest/v1/rpc/dashboard_top_outstanding_admin`, { method: "POST" })).toBe(false);
    expect(isTenantViewWrite(`${BASE}/rest/v1/rpc/move_enrollments_batch`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/rest/v1/rpc/record_page_usage`, { method: "POST" })).toBe(true);
    // 모르는 이름은 막는다(새 함수를 목록에 안 넣으면 보기 화면에서만 막힌다 — 닫힌 쪽으로 실패).
    expect(isTenantViewWrite(`${BASE}/rest/v1/rpc/some_new_function`, { method: "POST" })).toBe(true);
    // 표 이름이 읽기 함수와 같아도 rpc 경로가 아니면 쓰기다.
    expect(isTenantViewWrite(`${BASE}/rest/v1/invoice_periods`, { method: "POST" })).toBe(true);
  });

  it("🔴 경로는 맨 앞부터 맞춘다 — 파일 경로의 끝이 통과 모양을 흉내 내도 쓰기다", () => {
    // 저장소에 올리는 파일의 경로가 통과시키는 주소로 끝나는 경우(끝만 보면 읽기로 넘어간다).
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/recordings/x/auth/v1/token`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/recordings/x/auth/v1/logout`, { method: "DELETE" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/recordings/x/rest/v1/rpc/invoice_periods`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/storage/v1/object/recordings/storage/v1/object/sign/a`, { method: "POST" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/functions/v1/x/rest/v1/rpc/invoice_periods`, { method: "POST" })).toBe(true);
    // 세션 갱신 · 로그아웃은 POST만 통과한다.
    expect(isTenantViewWrite(`${BASE}/auth/v1/token`, { method: "DELETE" })).toBe(true);
    expect(isTenantViewWrite(`${BASE}/auth/v1/logout`, { method: "PUT" })).toBe(true);
  });

  it("Request 객체 · URL 객체로 불려도 같은 판정이다", () => {
    expect(isTenantViewWrite(new Request(`${BASE}/rest/v1/students`, { method: "PATCH" }))).toBe(true);
    expect(isTenantViewWrite(new Request(`${BASE}/rest/v1/students`))).toBe(false);
    expect(isTenantViewWrite(new URL(`${BASE}/rest/v1/students`), { method: "DELETE" })).toBe(true);
    // init의 method가 Request의 method보다 먼저다(fetch 규약).
    expect(isTenantViewWrite(new Request(`${BASE}/rest/v1/students`), { method: "POST" })).toBe(true);
  });
});

describe("지점 보기(읽기 전용) — 가드 fetch", () => {
  const ok = () => new Response("[]", { status: 200 });

  it("보기 중이면 쓰기를 보내지 않고 권한 오류 모양으로 돌려준다", async () => {
    const base = vi.fn(async () => ok());
    const guarded = guardTenantViewFetch(() => true, base as unknown as typeof fetch);
    const res = await guarded(`${BASE}/rest/v1/students`, { method: "POST", body: "{}" });
    expect(base).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "42501", message: TENANT_VIEW_READONLY_MESSAGE });
  });

  it("보기 중이어도 읽기는 그대로 보낸다", async () => {
    const base = vi.fn(async () => ok());
    const guarded = guardTenantViewFetch(() => true, base as unknown as typeof fetch);
    expect((await guarded(`${BASE}/rest/v1/students?select=*`)).status).toBe(200);
    expect((await guarded(`${BASE}/rest/v1/rpc/invoice_periods`, { method: "POST" })).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("보기가 아니면 쓰기도 그대로 보낸다 — 읽기 요청에는 보기 여부를 묻지도 않는다", async () => {
    const base = vi.fn(async () => ok());
    const isViewing = vi.fn(async () => false);
    const guarded = guardTenantViewFetch(isViewing, base as unknown as typeof fetch);
    await guarded(`${BASE}/rest/v1/students?select=*`);
    expect(isViewing).not.toHaveBeenCalled();
    await guarded(`${BASE}/rest/v1/students`, { method: "POST" });
    expect(isViewing).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("인자를 바꾸지 않고 그대로 넘긴다", async () => {
    const base = vi.fn(async () => ok());
    const guarded = guardTenantViewFetch(() => false, base as unknown as typeof fetch);
    const init = { method: "PATCH", headers: { a: "b" }, body: "{}" };
    await guarded(`${BASE}/rest/v1/students?id=eq.1`, init);
    expect(base).toHaveBeenCalledWith(`${BASE}/rest/v1/students?id=eq.1`, init);
  });

  it("막은 응답은 매번 새 객체다(본문을 두 번 읽어도 된다)", async () => {
    const a = tenantViewBlockedResponse();
    const b = tenantViewBlockedResponse();
    expect(a).not.toBe(b);
    await a.text();
    expect((await b.json()).code).toBe("42501");
  });
});
