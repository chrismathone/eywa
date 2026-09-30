import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { runGoogleCalendarImport } from "@/features/calendar/server/google-import";
import { ensureCalendarChannels } from "@/features/calendar/server/google-channels";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

/**
 * **구글 캘린더 → aywa 한 방향 임포트** cron — 하루 2회(06:00 · 18:00 KST = 21:00 · 09:00 UTC).
 * 2026-09-30부터 평소 반영은 **푸시 알림(웹훅) + 증분**(`/api/calendar/google-push`)이 하고, 이 크론은 ① 알림을 놓쳐도
 * 12시간 안에 맞추는 **안전망**(전체 임포트) ② 푸시 채널 **열기·갱신**(만료 36시간 전)을 맡는다.
 *
 * 원장 2026-09-10: *"캘린더 탭은 메뉴에서 제외시켜. 그냥 내부 구글 달력용으로 사용할예정임."* →
 * *"즉, 동기화하지만 외부로 보여주지않고 내부 끌어오기 참고용으로만 할것"* → *"하루 2회 정도, 오전 오후 6시쯤"*.
 *
 * 왜 필요했나: 2026-09-03에 **한 번** 퍼온 6,270건이 전부였고, 그 뒤 구글에 잡힌 일정은 aywa에 없었다.
 * 실측(2026-09-10) 구글엔 오늘 이후 일정이 **820건**인데 aywa엔 **16건**뿐이었다 — 화면이 "오늘 일정 없음"이라
 * 말하는 동안 실제로는 레테·설명회가 잡혀 있었다.
 *
 * 🔴 **읽기만 한다**(구글에 쓰지 않는다) · **손으로 만든 일정은 안 건드린다** · **사람이 고친 행은 안 덮는다**.
 * 🔴 캘린더 목록(`GOOGLE_CALENDAR_IDS`)이 없으면 **아무 일도 안 한다** — 목록을 모르면 삭제 정리를 할 수 없다.
 * ⚠️ 테넌트는 `tenants` 전건이 아니라 **캘린더를 실제로 쓰는 한 곳**만 돈다 — 원장 2026-09-18 *"전부 모두 침산(cs)
 *    테넌트로. 현재 존재하는 모든것"*: env `GOOGLE_CALENDAR_TENANT_ID`(침산 id)가 있으면 그 학원, 없으면 학원이 **정확히
 *    1개일 때만** 그 학원이다. 🔴 학원이 둘 이상인데 env가 없으면 **아무 학원도 고르지 않는다**(종전 "created_at 첫
 *    학원"은 둘째 지점이 생기는 날 조용히 남의 학원에 일정을 부을 수 있는 규칙이었다 — ClassNote 워커의 fail-closed와
 *    같은 결). 여러 테넌트가 각자 구글을 붙이면 그때 env가 아니라 테넌트 설정으로 옮겨야 한다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // 캘린더를 쓰는 테넌트 = env로 못박은 침산, 없으면 학원이 정확히 1개일 때만(위 주석). 2행만 받아 단일/복수를 가른다.
  const pinned = process.env.GOOGLE_CALENDAR_TENANT_ID?.trim();
  let tenantId: string | null = null;
  if (pinned) {
    // 🔴 env 값이 실제 학원인지 확인한다 — 임포트는 쓰기 오류를 세지 않아(`if (!error)`), 없는 id(오타)를 그대로 넘기면
    //    calendar_events FK에 막힌 insert가 전부 조용히 실패하고 크론은 `{ok:true, inserted:0}`으로 초록이 된다(리뷰 2026-09-18).
    const { data: row, error: pErr } = await admin.from("tenants").select("id").eq("id", pinned).maybeSingle();
    if (pErr || !row?.id) {
      reportError(pErr ?? new Error(`GOOGLE_CALENDAR_TENANT_ID=${pinned} 에 해당하는 학원이 없음`), {
        where: "google-calendar-import:tenant",
      });
      return NextResponse.json({ error: "GOOGLE_CALENDAR_TENANT_ID가 가리키는 학원이 없음" }, { status: 500 });
    }
    tenantId = String(row.id);
  }
  if (!tenantId) {
    const { data: rows, error: tErr } = await admin.from("tenants").select("id").limit(2);
    if (tErr) {
      reportError(tErr, { where: "google-calendar-import:tenant" });
      return NextResponse.json({ error: "테넌트 조회 실패" }, { status: 500 });
    }
    if ((rows?.length ?? 0) !== 1) {
      reportError(new Error(`tenant ${rows?.length ?? 0}개 — GOOGLE_CALENDAR_TENANT_ID env를 지정해야 함`), {
        where: "google-calendar-import:tenant",
      });
      return NextResponse.json({ error: "테넌트를 특정할 수 없음 — GOOGLE_CALENDAR_TENANT_ID 필요" }, { status: 500 });
    }
    tenantId = String(rows![0]!.id);
  }

  // 학원 캘린더 기능(모듈)이 꺼진 학원은 가져오지 않는다(2026-09-30 "꺼지면 흔적 없이").
  if (!isModuleEnabled((await getTenantSettingsByTenantId(tenantId)).modules.disabled, "calendar")) {
    return NextResponse.json({ ok: true, skipped: "calendar module off" });
  }
  try {
    const summary = await runGoogleCalendarImport(tenantId);
    // 캘린더 화면은 메뉴에서 뺐지만 라우트는 살아 있다 — 열었을 때 최신이 보이게.
    revalidatePath("/calendar");
    // 푸시 채널 열기·갱신 — 실패해도 임포트 결과는 그대로(다음 크론이 다시 연다). 채널이 없으면 12시간 주기로만 맞춰진다.
    let channels: Awaited<ReturnType<typeof ensureCalendarChannels>> | { error: string };
    try {
      channels = await ensureCalendarChannels(tenantId);
      if ("failed" in channels && channels.failed.length > 0) {
        reportError(new Error(`구글 캘린더 알림 채널 ${channels.failed.length}개 열기 실패`), { where: "google-calendar-channels" });
      }
    } catch (e) {
      reportError(e, { where: "google-calendar-channels" });
      channels = { error: "알림 채널 갱신 실패" };
    }
    return NextResponse.json({ ok: true, ...summary, channels });
  } catch (e) {
    reportError(e, { where: "google-calendar-import" });
    return NextResponse.json({ error: "임포트 실패" }, { status: 500 });
  }
}
