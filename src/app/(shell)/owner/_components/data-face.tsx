import { findOrphans, type OrphanReport } from "@/features/admin/server/queries";
import { CleanupClient } from "@/app/(shell)/admin/cleanup/_client";

/**
 * 데이터 정리 면 (owner ?tab=data) — 고아 데이터(수강 없는 재원생·스케줄 없는 반 등) 검출·정리.
 * 구 /admin/cleanup 본문을 owner FaceTabs 면으로 흡수. CleanupClient(클라)는 그대로 재사용.
 *
 * `canManage` = 정리 작업(퇴원 · 삭제 · 수강 종료)을 할 수 있는가 — page.tsx가 **액션과 같은 판정**으로 정해 넘긴다.
 * 조회는 이 값과 무관하게 한다(목록은 설정을 볼 수 있는 사람 누구에게나 보인다).
 */
export async function DataFace({ canManage }: { canManage: boolean }) {
  // 조회 헬퍼는 규약상 던진다(B2/B3) — 그대로 새면 **데이터 정리 면 전체**가 죽어 아래 중복 의심·같은 이름 점검까지 함께 사라진다.
  // 이 구획 안에서 한글 안내로 접는다. 🔴 못 읽었을 때 빈 목록("문제 없음")을 보여 주지 않는다 — 그건 거짓말이다.
  let report: OrphanReport | null = null;
  try {
    report = await findOrphans();
  } catch (error) {
    console.error("[owner/data-face] 고아 데이터 점검 조회 실패", error);
  }
  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 데이터 정리</p>
        <h2 className="text-foreground text-lg font-bold">고아 데이터 점검</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          수강 없는 재원생·스케줄 없는 반 등 정합성이 깨진 데이터를 검출합니다.
        </p>
      </header>
      {report ? (
        <CleanupClient report={report} canManage={canManage} />
      ) : (
        <p role="alert" className="text-danger py-12 text-center text-sm">
          고아 데이터 점검을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요
        </p>
      )}
    </div>
  );
}
