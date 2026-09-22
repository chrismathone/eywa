import { notFound } from "next/navigation";
import { buildCategoryMaps } from "@/features/inventory/category";
import { auditResultLabel } from "@/features/inventory/audit-result";
import { loanStatusLabel } from "@/features/inventory/loan-status";
import { getAssetDetail } from "@/features/inventory/server/asset-queries";
import { getInventoryCategoriesByTenantId } from "@/features/inventory/server/category-queries";
import { dashIfEmpty, unknownIfEmpty } from "@/features/inventory/unknown-value";
import { AssetStatusPill, AuditResultPill, LoanStatusPill } from "@/features/inventory/components/status-pill";

/** 기기 대장이라 검색엔진 색인은 막는다(자산ID가 추측 가능한 공개 주소 — (share)/r 선례와 같은 처리). */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return {
    title: `${decodeURIComponent((await params).code)} — 재고관리 — aywa`,
    robots: { index: false, follow: false },
  };
}

/**
 * 자산 한 대의 **현재 상태** — QR을 찍으면 여기로 온다(원장 2026-09-02: *"QR코드를 찍으면 현재 상태가 그대로 볼 수
 * 있도록 … 길게 행으로 보이라기보다 모바일 뷰 기준 깔끔하게"*).
 *
 * 🔴 **비로그인 공개 + 셸 없음**(원장 2026-09-03: *"그냥 안의 내용만 보이면 됨. seat/jj처럼 비로그인자도 볼 수 있게.
 *    목록으로 갈 필요도 없음. 최근 실사 까지 만 있으면 될듯"*) — 로고·메뉴·알림벨·계정 아이콘이 없는 `(asset)` 그룹이고,
 *    목록 링크와 맨 아래 QR 블록은 걷어냈다(QR을 찍고 들어온 사람에게 QR을 다시 보여줄 이유가 없다).
 * 🔴 **사람 이름(사용자·대여자·실사자)을 그대로 싣는다** — 원장 2026-09-03 *"괜찮아 QR은 우리내부에 사용중이니까
 *    이름도 넣어"*. 좌석 PIN 화면의 '직원 이름 조회 금지' 규약을 여기 가져오지 말 것(축이 다르다 — 그쪽은 학부모·외부인이
 *    PIN으로 여는 화면, 이쪽은 학원 안 기기에 붙은 라벨이다).
 * 🔴 **읽기 전용** — 상태 변경·대여·실사 버튼을 여기에 달지 말 것(공개 화면이다).
 * 🔴 **주소 불변**(`/inventory/asset/[code]`) — 이미 인쇄해 붙인 라벨이 이 주소를 가리킨다(`qr.ts` 규약).
 *    라우트 그룹 `(asset)`은 URL에 안 나타난다.
 * ⚠️ 공개 범위는 이 경로 하나뿐이다 — `/inventory` 목록·엑셀·편집 액션은 그대로 로그인+권한(proxy의 정확/슬래시 매칭).
 */
export default async function AssetDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code);
  const detail = await getAssetDetail(code);
  if (!detail) notFound();
  const { asset, loans, audits, tenantId } = detail;
  // 분류 라벨은 학원별 데이터(0247a)라 그 자산의 학원으로 읽는다 — 세션이 없어 `getInventoryCategories()`를 못 쓴다.
  const cats = buildCategoryMaps((await getInventoryCategoriesByTenantId(tenantId)).rows);

  const rows: Array<[string, React.ReactNode]> = [
    // 🔴 자산번호가 첫 행 — 머리글의 제목이던 값이라 여기 없으면 화면 어디에도 자산ID가 안 남는다.
    ["자산번호", <span key="ac" className="font-mono font-bold">{asset.assetCode}</span>],
    ["상태", <AssetStatusPill key="s" status={asset.status} />],
    ["분류", cats.labelOf(asset.category)],
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
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 p-3 pb-8 md:p-5 lg:pb-10">
      {/*
        원장 2026-09-03: *"헤더에 [HDS-006 · 헤드셋 · 타이디홈 고성능 · 사용중] 필요없고 다 1번 카드 안으로 넣어
        자산번호 HDS-006 그리고 나머진 중복이니까 필요없네"* + *"그냥 자산 관리 정보 라고 적당히 거대한 폰트로
        적어놓던지"* + *"그 아래에 카드 시작"*.
        🔴 여기에 자산ID·분류·모델·상태를 다시 적지 말 것 — 전부 아래 카드의 행이라 **중복**이다(그게 걷어낸 이유다).
        ⚠️ PageHeader를 쓰지 않는다(eyebrow·description·actions가 그 중복을 도로 만든다). 이 화면은 셸이 없어
           embedLabel도 소비처가 없다.
      */}
      {/* 카드와 왼쪽을 딱 맞춘다 — 4px쯤 들여쓰면 '거의 맞은' 어긋남으로 보인다(카드 링은 박스 밖이라 무시 가능, [[#114]]). */}
      <h1 className="text-foreground text-2xl font-extrabold tracking-tight md:text-2xl">자산 관리 정보</h1>

      <section className="bg-card shadow-card rounded-2xl p-4">
        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-dim text-xs font-bold">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bg-card shadow-card rounded-2xl p-4">
        <h3 className="text-foreground text-sm font-bold">최근 대여</h3>
        {loans.length === 0 ? (
          <p className="text-text-faint mt-1 text-xs">대여 이력이 없습니다</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 text-xs">
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
        <h3 className="text-foreground text-sm font-bold">최근 실사</h3>
        {audits.length === 0 ? (
          <p className="text-text-faint mt-1 text-xs">실사 이력이 없습니다</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 text-xs">
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

      {/* 원장 2026-09-03: *"최근 실사 아래에 문의는 2층 데스크로 부탁드립니다. 라는 멘트만"* — 다른 안내를 덧붙이지 말 것. */}
      <p className="text-text-dim text-center text-xs">문의는 2층 데스크로 부탁드립니다.</p>
    </div>
  );
}

function Faint({ v, f, num = false }: { v: string | null; f: (v: string | null) => string; num?: boolean }) {
  return v ? <span className={num ? "num" : ""}>{v}</span> : <span className="text-text-faint">{f(null)}</span>;
}
