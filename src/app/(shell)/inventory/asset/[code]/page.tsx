import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { assetCategoryLabel } from "@/features/inventory/category";
import { auditResultLabel } from "@/features/inventory/audit-result";
import { loanStatusLabel } from "@/features/inventory/loan-status";
import { qrImageSrc } from "@/features/inventory/qr";
import { getAssetDetail } from "@/features/inventory/server/asset-queries";
import { dashIfEmpty, unknownIfEmpty } from "@/features/inventory/unknown-value";
import { AssetStatusPill, AuditResultPill, LoanStatusPill } from "../../_components/status-pill";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: `${decodeURIComponent((await params).code)} — 재고관리 — eywa` };
}

/**
 * 자산 한 대의 **현재 상태** — QR을 찍으면 여기로 온다(원장 2026-09-02: *"QR코드를 찍으면 현재 상태가 그대로 볼 수
 * 있도록 … 길게 행으로 보이라기보다 모바일 뷰 기준 깔끔하게"*). 표의 11칸을 세로 목록으로, 그 아래 최근 대여·실사.
 * 게이트는 목록과 같은 `inventory` 메뉴 권한(QR 주소를 아는 것만으로는 안 열린다).
 */
export default async function AssetDetailPage({ params }: { params: Promise<{ code: string }> }) {
  await requireAccess("inventory");
  const code = decodeURIComponent((await params).code);
  const detail = await getAssetDetail(code);
  if (!detail) notFound();
  const { asset, loans, audits } = detail;

  const rows: Array<[string, React.ReactNode]> = [
    ["상태", <AssetStatusPill key="s" status={asset.status} />],
    ["분류", assetCategoryLabel(asset.category)],
    ["제조사", <Faint key="mk" v={asset.maker} f={unknownIfEmpty} />],
    ["모델명", <Faint key="md" v={asset.model} f={unknownIfEmpty} />],
    ["시리얼번호", <Faint key="sn" v={asset.serialNo} f={unknownIfEmpty} />],
    ["입고일", <Faint key="aq" v={asset.acquiredOn} f={unknownIfEmpty} num />],
    ["현위치", <Faint key="lo" v={asset.status === "disposed" ? null : asset.location} f={dashIfEmpty} />],
    ["사용자", <Faint key="ho" v={asset.holderName} f={dashIfEmpty} />],
    ["최종실사", <Faint key="la" v={asset.lastAuditedOn} f={dashIfEmpty} num />],
    ["폐기일", <Faint key="di" v={asset.disposedOn} f={dashIfEmpty} num />],
    ["비고", <Faint key="no" v={asset.note} f={dashIfEmpty} />],
  ];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 p-3 md:p-5">
      <PageHeader
        eyebrow="재고관리"
        title={asset.assetCode}
        description={`${assetCategoryLabel(asset.category)} · ${asset.model ?? "모델 미기재"}`}
        embedLabel={`${asset.assetCode} · ${assetCategoryLabel(asset.category)} · ${asset.model ?? "모델 미기재"}`}
        actions={<AssetStatusPill status={asset.status} />}
      />

      <section className="bg-card shadow-card rounded-2xl p-4">
        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[14px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-dim text-[12.5px] font-bold">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bg-card shadow-card rounded-2xl p-4">
        <h3 className="text-foreground text-[13.5px] font-bold">최근 대여</h3>
        {loans.length === 0 ? (
          <p className="text-text-faint mt-1 text-[12.5px]">대여 이력이 없습니다</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
            {loans.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-2">
                <LoanStatusPill status={l.status} />
                <span className="font-medium">{l.borrowerName}{l.dept ? `(${l.dept})` : ""}</span>
                <span className="text-text-dim num">{l.lentOn ?? "미기재"} ~ {l.returnedOn ?? l.dueOn ?? l.dueNote ?? "미정"}</span>
                <span className="sr-only">{loanStatusLabel(l.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card shadow-card rounded-2xl p-4">
        <h3 className="text-foreground text-[13.5px] font-bold">최근 실사</h3>
        {audits.length === 0 ? (
          <p className="text-text-faint mt-1 text-[12.5px]">실사 이력이 없습니다</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
            {audits.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
                <AuditResultPill result={d.result} />
                <span className="num">{d.auditedOn}</span>
                <span className="text-text-dim">{d.location ?? "—"}{d.auditorName ? ` · ${d.auditorName}` : ""}{d.action ? ` · ${d.action}` : ""}</span>
                <span className="sr-only">{auditResultLabel(d.result)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card shadow-card flex items-center gap-4 rounded-2xl p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- 라우트가 그 자리에서 그리는 SVG */}
        <img src={qrImageSrc(asset.assetCode)} alt={`${asset.assetCode} QR`} width={96} height={96} className="shrink-0" />
        <p className="text-text-dim text-[12px]">이 QR을 찍으면 이 화면(그때의 현재 상태)이 열립니다. 라벨은 재고관리 목록의 [인쇄]에서 한꺼번에 뽑습니다.</p>
      </section>

      <Link href="/inventory" className="text-primary text-[12.5px] font-bold hover:underline">
        ← 재고관리 목록
      </Link>
    </div>
  );
}

function Faint({ v, f, num = false }: { v: string | null; f: (v: string | null) => string; num?: boolean }) {
  return v ? <span className={num ? "num" : ""}>{v}</span> : <span className="text-text-faint">{f(null)}</span>;
}
