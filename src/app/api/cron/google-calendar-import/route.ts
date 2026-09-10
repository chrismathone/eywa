import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { runGoogleCalendarImport } from "@/features/calendar/server/google-import";

/**
 * **구글 캘린더 → eywa 한 방향 임포트** cron — 하루 2회(06:00 · 18:00 KST = 21:00 · 09:00 UTC).
 *
 * 원장 2026-09-10: *"캘린더 탭은 메뉴에서 제외시켜. 그냥 내부 구글 달력용으로 사용할예정임."* →
 * *"즉, 동기화하지만 외부로 보여주지않고 내부 끌어오기 참고용으로만 할것"* → *"하루 2회 정도, 오전 오후 6시쯤"*.
 *
 * 왜 필요했나: 2026-09-03에 **한 번** 퍼온 6,270건이 전부였고, 그 뒤 구글에 잡힌 일정은 eywa에 없었다.
 * 실측(2026-09-10) 구글엔 오늘 이후 일정이 **820건**인데 eywa엔 **16건**뿐이었다 — 화면이 "오늘 일정 없음"이라
 * 말하는 동안 실제로는 레테·설명회가 잡혀 있었다.
 *
 * 🔴 **읽기만 한다**(구글에 쓰지 않는다) · **손으로 만든 일정은 안 건드린다** · **사람이 고친 행은 안 덮는다**.
 * 🔴 캘린더 목록(`GOOGLE_CALENDAR_IDS`)이 없으면 **아무 일도 안 한다** — 목록을 모르면 삭제 정리를 할 수 없다.
 * ⚠️ 테넌트는 `tenants` 전건이 아니라 **캘린더를 실제로 쓰는 한 곳**만 돈다(지금 injaewon 단일 운영).
 *    여러 테넌트가 각자 구글을 붙이면 그때 env가 아니라 테넌트 설정으로 옮겨야 한다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // 캘린더를 쓰는 테넌트 = 지금은 유일한 운영 테넌트. 여럿이 되면 설정 기반으로 바꾼다.
  const { data: tenantRow, error: tErr } = await admin
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (tErr || !tenantRow?.id) {
    reportError(tErr ?? new Error("tenant 없음"), { where: "google-calendar-import:tenant" });
    return NextResponse.json({ error: "테넌트 조회 실패" }, { status: 500 });
  }

  try {
    const summary = await runGoogleCalendarImport(String(tenantRow.id));
    // 캘린더 화면은 메뉴에서 뺐지만 라우트는 살아 있다 — 열었을 때 최신이 보이게.
    revalidatePath("/calendar");
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    reportError(e, { where: "google-calendar-import" });
    return NextResponse.json({ error: "임포트 실패" }, { status: 500 });
  }
}
