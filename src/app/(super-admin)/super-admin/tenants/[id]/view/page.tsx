import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { notFound } from "next/navigation";
import { SuperAdminHeader } from "@/components/super-admin/header";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { getTenantSnapshot } from "@/features/super-admin/server/queries";
import { logImpersonateView } from "@/features/super-admin/server/actions";
import { studentStatusMeta } from "@/features/students/status-labels";

export const metadata = { title: "Super Admin · 지점장 보기 — aywa" };

const fmt = (n: number) => n.toLocaleString("ko-KR");
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "—");

export default async function TenantViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await getTenantSnapshot(id);
  if (!snap) notFound();

  // 진입 기록 (best-effort, 렌더 막지 않음)
  await logImpersonateView(snap.id, snap.name);

  return (
    <>
      <SuperAdminHeader
        title={`${snap.name} 들여다보기`}
        breadcrumb={[{ label: "학원 목록" }, { label: snap.name }, { label: "지점장 보기" }]}
        action={
          <Link
            href={`/super-admin/tenants/${id}`}
            className="border-line text-text-dim hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold"
          >
            <EyIcon name="arrowLeft" size={14} />
            나가기
          </Link>
        }
      />
      <div className="space-y-5 px-7 py-6">
        {/* read-only 배지 */}
        <div className="bg-amber-soft text-amber flex items-center gap-2 rounded-md px-4 py-2.5 text-xs font-bold">
          <span className="bg-amber inline-block size-2 rounded-full" />
          읽기 전용 · {snap.name} 현황을 들여다보는 중입니다 (조작 불가)
        </div>

        {/* KPI 4 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="등록 학생" value={fmt(snap.kpi.students)} unit="명" />
          <Kpi label="강사" value={fmt(snap.kpi.teachers)} unit="명" />
          <Kpi label="운영 반" value={fmt(snap.kpi.activeClasses)} unit="개" />
          <Kpi label="이번 달 청구" value={fmt(snap.kpi.monthBilling)} unit="원" />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* 최근 학생 */}
          <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
            <header className="border-line border-b px-5 py-3">
              <p className="micro">최근 등록</p>
              <h3 className="text-foreground mt-0.5 text-base font-bold">학생 {snap.recentStudents.length}명</h3>
            </header>
            {snap.recentStudents.length === 0 ? (
              <p className="text-text-dim px-5 py-8 text-center text-sm">학생이 없습니다.</p>
            ) : (
              <ul className="divide-line divide-y">
                {snap.recentStudents.map((s) => {
                  // 학생 상태 배지 = studentStatusMeta 단일 소스(목록·상세와 같은 색).
                  const meta = studentStatusMeta(s.status) ?? { label: s.status, color: "neutral" as PillColor };
                  return (
                    <li key={s.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="text-foreground text-sm font-medium">{s.name}</span>
                      <span className="text-text-dim text-xs">{s.grade ?? "—"}</span>
                      <span className="ml-auto">
                        <Pill color={meta.color} soft>
                          {meta.label}
                        </Pill>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 최근 회의 */}
          <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
            <header className="border-line border-b px-5 py-3">
              <p className="micro">최근 회의</p>
              <h3 className="text-foreground mt-0.5 text-base font-bold">회의록</h3>
            </header>
            {snap.recentMeetings.length === 0 ? (
              <p className="text-text-dim px-5 py-8 text-center text-sm">회의록이 없습니다.</p>
            ) : (
              <ul className="divide-line divide-y">
                {snap.recentMeetings.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <p className="text-foreground text-sm font-medium">{m.title}</p>
                    <p className="text-text-dim mt-0.5 font-mono text-xs">{formatDate(m.heldAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <p className="text-text-dim font-mono text-xs tracking-wider uppercase">{label}</p>
      <p className="text-foreground mt-1.5 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}
