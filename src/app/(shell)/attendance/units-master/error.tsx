"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div role="alert" className="p-6 text-sm">
    <p>시수 자료를 모두 불러오지 못했습니다. 일부 합계로 표시하지 않고 조회를 중단했습니다.</p>
    <button type="button" onClick={reset} className="mt-3 rounded border px-3 py-2">다시 불러오기</button>
  </div>;
}
