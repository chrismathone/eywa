/**
 * 학부모 화면 껍데기 — **직원 셸(사이드바·창·권한 매트릭스)을 전혀 쓰지 않는다.**
 *
 * 학부모는 직원 표에 없어서 `(shell)` 레이아웃의 `getCurrentUser()`가 null이다 — 그 셸에 넣으면
 * 로그인 화면으로 튕긴다. 폰으로 여는 화면이라 한 열·넉넉한 글자로 둔다.
 */
export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background min-h-dvh px-4 pb-10 pt-5">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">{children}</div>
    </div>
  );
}
