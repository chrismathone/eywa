import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "../onescreen/components/onescreen-screen-source.test-util";

/**
 * 🔴 영상 숙제 취소 배선 가드(원장 2026-10-16 *"미확인이나 미제출인 숙제에 한해서 숙제 취소할 수 있게"* · *"약점은 수정해"*).
 * 원스크린 세션 초안은 보고서 값보다 이긴다 — 장부에서 취소해도 초안의 옛 '있음'이 화면에 남고 발송 때 다시 적혔다.
 * 세 겹(첫 화면 · 저장 관문 · 다음 수업 검사)이 취소 기록(`cancels.ts`)을 지나는지 코드 모양으로 잠근다.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("영상 숙제 취소 — 원스크린이 취소한 숙제를 되살리지 않는다", () => {
  it("첫 화면: 취소 기록 + 보고서 '없음'이면 초안보다 '없음'이 이기고, 읽은 시각을 공급자에 싣는다", () => {
    const page = read("src/app/(shell)/onescreen/page.tsx");
    expect(page).toContain("readVideoHomeworkCancels(user.tenantId, rosterStudentIds, roster.date)");
    expect(page).toMatch(/videoHwCancels\.cancels\.has\(assignmentKey\(st\.id, roster\.date, su\.classId\)\)\s*&& assignmentOf\(videoHomeworkAssignments, st\.id, roster\.date, su\.classId\) === false/);
    expect(page).toContain("cancelInfo={{ readAt: videoHwCancels.readAt, overridden: cancelOverridden }}");
    // 🔴 읽은 시각은 마운트 때 한 번만 — 새로고침(출결 저장의 revalidatePath)이 내려보낸 새 시각으로 옛 '있음'이 통과하지 않게.
    expect(read("src/features/video-homework/components/video-homework-provider.tsx")).toContain("const [mountedSeenAt] = useState(cancelInfo.readAt);");
  });
  it("저장: 화면은 맞춘 시각을 함께 보내고, 관문은 모른 채 보낸 '있음'을 지키며, 그 줄은 보내지 않는다", () => {
    const client = readOnescreenScreen();
    expect(client).toContain("videoHomeworkSeenAt: videoHwStore?.seenAtOf(student.id, su.classId) ?? null");
    expect(client).toContain("videoHwStore?.markSeen(studentId, keptClassId, res.videoHomeworkSeenAt)");
    const actions = read("src/features/onescreen/server/actions.ts");
    expect(actions).toMatch(/const cancelKept = !ownerKept && videoHwReady && input\.videoHomework === true && priorRow\?\.video_homework === false/);
    expect(actions).toContain("cancelledAfterSeen(createAdminClient(), user.tenantId");
    expect(actions).toContain("const keptVideoHw = ownerKept ?? (cancelKept ? { kept: false } : null);");
    expect(actions).toMatch(/if \(saved\.videoHomeworkCancelled \|\| saved\.videoHomeworkDue\?\.fellBack/);
  });
  it("다음 수업 검사: 취소한 숙제(다시 내지 않음)엔 기록을 만들지 않는다 — 한 칸 · 일괄 둘 다 같은 함수", () => {
    const marks = read("src/features/video-homework/server/actions.ts");
    expect(marks).toContain("isCancelledHomework(db, user.tenantId");
    expect(marks.match(/writeCheckedMark\(/g)?.length).toBeGreaterThanOrEqual(3); // 정의 + 한 칸 + 일괄
  });
  it("장부의 두 입구(칸 편집 창 · 따로 낸 숙제 우클릭)는 같은 취소 액션을 부른다 — 옛 '따로 낸 숙제만 취소'는 없다", () => {
    expect(read("src/features/video-homework/components/cancel-homework-button.tsx")).toContain("cancelVideoHomework(");
    expect(read("src/features/video-homework/components/issue-menu.tsx")).toContain("cancelVideoHomework(");
    expect(read("src/features/video-homework/server/issue-actions.ts")).not.toContain("cancel_video_homework_extra_issue");
  });
});
