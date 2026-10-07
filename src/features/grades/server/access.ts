import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";

/**
 * 성적 **쓰기 게이트 단일 소스** — 통과면 null, 막히면 한글 사유.
 *
 * 🔴 화면(격자 잠금)·서버 액션(저장)·엑셀 반영이 **같은 함수**를 지난다([[#77]]: 화면에서만 잠그면
 *    주소·POST로 우회된다). 새 성적 쓰기 표면을 만들면 여기부터 통과시킬 것.
 * ⚠️ 권한 키는 성적관리 메뉴(`exams`)다 — 옛 시험 등록과 같은 키를 그대로 쓴다(권한을 새로 만들면
 *    이미 성적을 맡던 사람이 조용히 잠긴다). 읽기(readonly)는 격자를 볼 수 있고 저장만 막힌다.
 * ⚠️ '다른 강사 뷰'(열람 전용)는 `accessLevelTenant`가 중앙에서 readonly로 눌러 준다 — 여기서 또 보지 않는다.
 */
export async function gradeWriteError(): Promise<string | null> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return "로그인이 필요합니다";
  const level = await accessLevelTenant(user.systemRole, "exams");
  if (level !== "full" && level !== "scoped") return "성적을 입력할 권한이 없습니다";
  return null;
}
