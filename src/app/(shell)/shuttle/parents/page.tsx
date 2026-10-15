import { FaceTabs } from "@/components/face-tabs";
import { requireParentAccountsAccess } from "@/features/shuttle/parent-accounts/server/parent-access";
import { getParentAccounts, getParentStudentOptions } from "@/features/shuttle/parent-accounts/server/parents";
import { shuttleFaces } from "@/features/shuttle/faces";
import { SHUTTLE_PARENTS_PATH } from "@/features/shuttle/parent-accounts/parent-access";
import { ParentAccountForm } from "@/features/shuttle/parent-accounts/components/parent-account-form";
import { ParentAccountList } from "@/features/shuttle/parent-accounts/components/parent-account-list";

export const metadata = { title: "셔틀 학부모 관리 현황 — aywa" };

export default async function ShuttleParentsPage() {
  // 원장·관리자만 — 그 밖은 404. 입구(학원운영 메뉴판)도 같은 판정으로만 선다.
  await requireParentAccountsAccess();
  const [accounts, students] = await Promise.all([getParentAccounts(), getParentStudentOptions()]);
  // 🔑 셔틀 탭 줄(SUBTABS_BY_MENU)에는 이 면이 없다 — 거기 두면 셔틀을 보는 모든 역할의 탭 줄에 선다.
  //    이 화면에서만 제자리(운행 현황 뒤)에 끼워 넣는다.
  const faces = shuttleFaces("term", { track: true }); // 이 화면은 원장·관리자만 — 실시간 위치 탭도 붙는다
  const afterLive = faces.findIndex((f) => f.key === "/shuttle/live") + 1;
  const parentFaces = [...faces.slice(0, afterLive), { key: SHUTTLE_PARENTS_PATH, label: "학부모 관리 현황", href: SHUTTLE_PARENTS_PATH }, ...faces.slice(afterLive)];

  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <FaceTabs faces={parentFaces} active="/shuttle/parents" />
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <section className="border-line bg-card rounded-2xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">학부모 관리 현황</h1>
              <p className="text-text-dim mt-1 text-sm">학부모 계정과 연결된 원생의 기본 정보를 관리합니다.</p>
            </div>
            <span className="bg-bg-soft rounded-full px-3 py-1 text-sm font-bold">{accounts.length}명</span>
          </div>
          <div className="mt-5">
            <ParentAccountList accounts={accounts} />
          </div>
        </section>
        <ParentAccountForm students={students} />
      </div>
    </div>
  );
}