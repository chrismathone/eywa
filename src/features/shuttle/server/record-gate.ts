import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant, getPermMatrix } from "@/lib/auth/perm-matrix";
import { canWrite } from "@/lib/permissions";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isReadonlyTeacherView, readonlyTeacherViewError } from "@/lib/auth/view-as";
import { hasShuttleRecordDuty } from "./duty";

/**
 * 등하원 **기록** 자격 — 편성 편집과 **다른 게이트**다.
 *
 * 🔴 왜 나눴나: 실측(2026-08-19) 셔틀 선생님은 **주영미 계정이고 역할이 `viewer`**다. 편성 권한
 *    (`canWriteTenant("shuttle")` = 사무실 full)만 두면 정작 차에 타는 사람이 아무것도 못 찍는다 —
 *    모바일 최적화한 화면을 쓸 수 없는 사람에게 준 꼴이 된다. 반대로 편성을 열어주면 viewer가
 *    학생 등하원 동선을 바꿀 수 있게 된다.
 *    → **편성 = 사무실 / 기록 = 현장**으로 축을 가른다.
 *
 * 🔑 "현장"의 판정 = **직원관리 '셔틀 담당' 토글**(0227a `users.shuttle_duty`, [duty.ts](./duty.ts)).
 *    원장이 직원관리에서 켜고 끄므로 사람이 바뀌어도 코드를 안 고친다.
 *    ⚠️ 2026-08-19 이전엔 `attendance_alert_optin`(클래스노트 학부모 연락 수신)을 겸용했는데, 한
 *    체크박스가 "알림을 받는다"와 "등하원을 찍는다" 두 뜻을 갖고 있어 원장 지시로 축을 갈랐다
 *    (*"셔틀 전용 권한을 만들어줘 … 따로 토글시켜야겠어"*). 알림 토글로 되돌리지 말 것.
 *
 * 🔑 **super_admin은 자동 통과**한다(원장 2026-08-13: *"superadmin은 앞으로 뭘 안해도 그냥 넣고봐"*).
 *    새 게이트에 명단만 두고 super_admin을 빼먹으면 총괄이 자기 시스템에서 잠긴다(payslip-gate 선례).
 *
 * ⚠️ 기록은 학생 레코드를 건드리지 않는다(셔틀 로그일 뿐) — 그래서 이 완화가 퇴원·출결 잠금과
 *    충돌하지 않는다. 출결 결석은 여전히 출결 게이트가 따로 판정한다("신호만" 원칙).
 * ⚠️ 토글 조회는 admin 클라이언트라 RLS를 우회한다 — tenant_id 필터는 duty.ts가 건다([[#104]]).
 *
 * 🔑 판정은 **화면 주인** — 강사뷰(다른 강사 뷰)면 검증된 대상의 역할·셔틀 담당 토글로 본다(기록 명의도 대상,
 *    actions.ts `recordGate`). 🔴 토글 갈래는 canWriteTenant를 지나지 않아 읽기 강사뷰가 대상의 토글로 기록할 수
 *    있었다 — 맨 앞에서 `readonlyTeacherViewError`로 막는다(2026-11-05 강사뷰 신원 점검).
 */
export const canRecordBoarding = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return false;
  if (await readonlyTeacherViewError()) return false;
  // 사무실(편성 권한 보유)은 당연히 기록할 수 있다 — 대부분의 호출이 여기서 끝난다(왕복 0).
  if (await canWriteTenant(user.systemRole, "shuttle")) return true;
  if (await hasShuttleRecordDuty(user.id, user.tenantId)) return true;
  return isCurrentUserSuperAdmin();
});

/**
 * 기록에 딸린 **읽기**(탑승 학생·학부모 연락처) 자격 — 기록 자격(`canRecordBoarding`)과 같은 사람들이되, 읽기 강사뷰 차단만 뺀다.
 *
 * 🔴 왜 나눴나: 연락처는 "찍는 사람이 전화하려고" 보는 정보라 기록 자격으로 열었는데, 읽기 강사뷰는 기록 자격이 늘 false라
 *    대상 X(셔틀 담당)의 화면을 읽기로 열면 X가 보는 연락처가 빈칸이었다 — X의 화면과 달라진다(2026-11-05 강사뷰 신원 적대 리뷰).
 *    쓰기(기록·변경)는 여전히 `canRecordBoarding`이 막는다.
 * 🔑 읽기 강사뷰에서는 쓰기 캡이 '사무실(편성 쓰기)' 판정을 지우므로, 대상 **역할**의 캡 이전 수준(지점 매트릭스)과 대상의 셔틀 담당
 *    토글로 다시 본다. 그 밖(평소 · 전체 강사뷰 · 지점 보기)은 기록 자격과 똑같다.
 * ⚠️ 대상 **개인 예외**(사람별 권한)는 이 갈래에서 보지 않는다 — 개인으로 넓어진 강사는 빈칸(좁아짐), 역할은 사무실인데 개인으로
 *    셔틀을 막은 사람은 번호가 보인다(넓어짐 — 읽기 전용 보기의 번호 열람뿐). 정확히 하려면 캡 이전 대상 수준을 돌려주는 공통 API가 필요하다.
 */
export const canSeeBoardingContacts = cache(async (): Promise<boolean> => {
  if (!(await isReadonlyTeacherView())) return canRecordBoarding();
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return false;
  if (canWrite(user.systemRole, "shuttle", await getPermMatrix())) return true;
  return hasShuttleRecordDuty(user.id, user.tenantId);
});
