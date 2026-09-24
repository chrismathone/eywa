import Link from "next/link";
import { notFound } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { buttonVariants } from "@/components/ui/button";
import { Panel, fmtDate, fmtNum } from "@/components/super-admin/parts";
import { getTenantSnapshot } from "@/features/super-admin/server/queries";
import { logImpersonateView } from "@/features/super-admin/server/actions";
import { studentStatusMeta } from "@/features/students/status-labels";

export const metadata = { title: "슈퍼관리자 · 지점장 보기 — aywa" };

export default async function TenantViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await getTenantSnapshot(id);
  if (!snap) notFound();

  // 진입 기록 (best-effort, 렌더 막지 않음)
  await logImpersonateView(snap.id, snap.name);

  return (
    <>
      <PageHeader
        eyebrow="지점장 보기"
        title={snap.name}
        description="이 학원의 현황을 읽기 전용으로 봅니다. 여기서는 아무것도 바꿀 수 없습니다."
        embedLabel={`${snap.name} · 읽기 전용`}
        actions={
          <Link href={`/super-admin/tenants/${id}`} className={buttonVariants({ variant: "outline" })}>
            <EyIcon name="arrowLeft" size={16} strokeWidth={1.8} /> 학원 상세로
          </Link>
        }
        stats={
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <BigStat label="등록 학생" value={fmtNum(snap.kpi.students)} unit="명" icon={<EyIcon name="graduationCap" size={16} />} tone="green" />
            <BigStat label="강사" value={fmtNum(snap.kpi.teachers)} unit="명" icon={<EyIcon name="users" size={16} />} tone="blue" />
            <BigStat label="운영 반" value={fmtNum(snap.kpi.activeClasses)} unit="개" icon={<EyIcon name="layers" size={16} />} tone="primary" />
            <div className="col-span-2 lg:col-span-1">
              <BigStat label="이번 달 청구" value={fmtNum(snap.kpi.monthBilling)} unit="원" icon={<EyIcon name="receipt" size={16} />} tone="gold" />
            </div>
          </div>
        }
      />

      <p className="bg-amber-soft text-amber flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold">
        <EyIcon name="lock" size={16} strokeWidth={1.8} />
        읽기 전용 — 들어온 기록이 감사 로그에 남았습니다.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Panel title="최근 등록 학생" description={`${fmtNum(snap.recentStudents.length)}명`} flush>
          {snap.recentStudents.length === 0 ? (
            <p className="text-foreground px-4 py-8 text-center text-sm">학생이 없습니다.</p>
          ) : (
            <ul className="divide-line divide-y">
              {snap.recentStudents.map((s) => {
                // 학생 상태 배지 = studentStatusMeta 단일 소스(목록·상세와 같은 색).
                const meta = studentStatusMeta(s.status) ?? { label: "알 수 없음", color: "neutral" as PillColor };
                return (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-foreground min-w-0 truncate text-sm font-bold">{s.name}</span>
                    <span className="text-foreground shrink-0 text-sm">{s.grade ?? "—"}</span>
                    <span className="ml-auto shrink-0">
                      <Pill color={meta.color}>{meta.label}</Pill>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="최근 회의록" flush>
          {snap.recentMeetings.length === 0 ? (
            <p className="text-foreground px-4 py-8 text-center text-sm">회의록이 없습니다.</p>
          ) : (
            <ul className="divide-line divide-y">
              {snap.recentMeetings.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <p className="text-foreground text-sm font-bold">{m.title}</p>
                  <p className="num text-foreground mt-0.5 text-xs">{fmtDate(m.heldAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
