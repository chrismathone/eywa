import { getManualDriveReview, type ManualDriveReview } from "../server/manual-drive-review";

/**
 * 영상숙제 확인 화면 위 안내 한 줄 — 담임 폴더에 직접 올렸지만 세지 못한 영상(원장 2026-10-01 직접 제출).
 * 없으면 아무것도 그리지 않는다. 펼치면 파일 이름·사유·폴더 이름. 고치는 곳은 Drive(파일 이름)라 여기엔 버튼이 없고,
 * Drive로 나가는 링크도 두지 않는다(원장 2026-10-04) — 폴더 이름과 파일 이름으로 찾는다.
 * 같은 영상이 이미 있어 세지 않은 사본은 이름을 고쳐도 풀리지 않으므로 따로 센다(지워도 된다).
 */
export function ManualDriveReviewList({ review }: { review: ManualDriveReview | null }) {
  if (!review || !(review.fixable + review.duplicates)) return null;
  const shown = review.items.length;
  return <details className="border-line bg-bg-soft rounded-lg border px-3 py-2 text-xs">
    <summary className="cursor-pointer">
      {review.fixable ? <>담임 폴더에 직접 올린 영상 <strong className="num">{review.fixable}</strong>개는 학생·반을 찾지 못해 세지 않았습니다 —
        파일 이름(학생_반_학교학년_날짜)을 고치면 10분 안에 다시 확인합니다.</> : null}
      {review.fixable && review.duplicates ? " " : null}
      {review.duplicates ? <>이미 보관된 같은 영상이라 따로 세지 않은 사본 <strong className="num">{review.duplicates}</strong>개(지워도 됩니다).</> : null}
    </summary>
    <ul className="divide-line mt-2 divide-y">
      {review.items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
          <span className="font-bold break-all">{item.fileName ?? "이름 없는 파일"}</span>
          <span>{item.reason ?? "확인이 필요합니다."}</span>
          {item.folderName ? <span className="text-text-dim">{item.folderName}</span> : null}
        </li>
      ))}
    </ul>
    {review.fixable + review.duplicates > shown ? <p className="mt-1">최근 {shown}개만 보입니다.</p> : null}
  </details>;
}

/** 페이지 첫 페인트를 막지 않게 Suspense 안에서 따로 읽는다. */
export async function ManualDriveReviewNote({ tenantId }: { tenantId: string }) {
  return <ManualDriveReviewList review={await getManualDriveReview(tenantId)} />;
}
