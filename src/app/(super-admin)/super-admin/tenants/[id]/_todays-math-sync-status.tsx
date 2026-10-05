import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { Panel } from "@/components/super-admin/parts";
import { sourceBindingForTenant, syncRpc } from "@/features/integrations/todays-math/sync-server";

const statusSchema = z.array(z.object({ bindingId: z.string(), tenantId: z.string(), mode: z.enum(["shadow", "active"]),
  healthy: z.boolean(), historyGap: z.boolean(), lastSuccessAt: z.string().nullable(), oldestPendingAt: z.string().nullable(),
  outbox: z.record(z.string(), z.number()) }));

/** Restricted operations console; no credentials or individual student/staff records. */
export async function TodaysMathSyncStatus({ tenantId }: { tenantId: string }) {
  await requireSuperAdmin();
  let configured = false;
  let status: z.infer<typeof statusSchema>[number] | undefined;
  try {
    const binding = sourceBindingForTenant(tenantId);
    if (binding) {
      configured = true;
      const statuses = statusSchema.parse(await syncRpc("tm_sync_status", { p_binding_id: binding.bindingId }));
      status = statuses.find((item) => item.bindingId === binding.bindingId && item.tenantId === tenantId);
    }
  } catch {
    return <Panel title="오늘의수학 동기화"><p className="text-danger text-sm">동기화 상태를 확인하지 못했습니다. 연결 설정과 DB 적용 상태를 확인해 주세요.</p></Panel>;
  }
  if (!configured) return <Panel title="오늘의수학 동기화"><p className="text-text-dim text-sm">이 지점의 연결 설정이 아직 등록되지 않았습니다.</p></Panel>;
    if (!status) return <Panel title="오늘의수학 동기화"><p className="text-text-dim text-sm">연결 등록 전입니다. 미리보기 검증 후 등록해 주세요.</p></Panel>;
    const pending = ["pending", "leased", "received", "retry"].reduce((sum, key) => sum + (status.outbox[key] ?? 0), 0);
    return <Panel title="오늘의수학 동기화" description="계정과 수강 정보 전달 상태입니다. 서비스 사용 여부는 위 라이선스 스위치를 따릅니다.">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-text-dim">연결 모드</dt><dd>{status.mode === "active" ? "적용 중" : "미리보기"}</dd></div>
        <div><dt className="text-text-dim">원본 검증</dt><dd>{status.healthy ? "정상" : "확인 필요"}</dd></div>
        <div><dt className="text-text-dim">처리 대기</dt><dd>{pending}건</dd></div>
        <div><dt className="text-text-dim">연결 충돌</dt><dd>{status.outbox.conflict ?? 0}건</dd></div>
        <div className="col-span-2"><dt className="text-text-dim">최근 적용</dt><dd>{status.lastSuccessAt
          ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastSuccessAt)) : "아직 적용된 기록이 없습니다."}</dd></div>
      </dl>
      {status.historyGap ? <p className="text-danger mt-3 text-sm">변경 이력 확인이 필요하여 새 권한 부여를 보류했습니다.</p> : null}
    </Panel>;
}
