"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="m-4 rounded-xl border border-line bg-card p-8"><h2 className="text-xl font-bold">방문 기록을 불러오지 못했습니다</h2><p className="my-4 text-sm">연결 상태를 확인한 뒤 다시 시도해 주세요. 조회 오류를 0건으로 표시하지 않습니다.</p><button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={reset}>다시 불러오기</button></section>;
}
