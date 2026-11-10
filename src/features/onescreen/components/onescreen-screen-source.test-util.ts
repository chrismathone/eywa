/**
 * 테스트 전용 — 원스크린 화면(`onescreen-client.tsx`)과 그 화면에서 옮겨 낸 훅·모듈(수정 계획 P3-O)의 **소스 글**을 한 덩어리로 읽는다.
 * 🔴 운영 코드에서 import하지 말 것.
 *
 * 배선 가드는 예전에 화면 파일 하나를 읽고 `toContain`·정규식·개수로 단언했다. 코드를 옮겨도 같은 단언이 서도록
 * 화면 파일을 **맨 앞에**, 옮겨 낸 파일을 옮긴 순서대로 잇는다. 코드는 옮겼을 뿐 복제하지 않으므로 개수 단언도 그대로다.
 * ⚠️ 화면에서 코드를 새 파일로 옮기면 여기에 그 파일을 더할 것 — 빠뜨리면 그 코드에 걸린 가드가 조용히 비게 된다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `src/features/onescreen/` 기준 경로. */
export const ONESCREEN_SCREEN_FILES = [
  "components/onescreen-client.tsx",
  "session-input.ts",
  "components/use-session-autosave.ts",
  "components/use-roster-view.ts",
  "components/use-report-attachments.ts",
  "components/use-auto-write.ts",
  "components/use-bulk-ops.ts",
  "components/use-bulk-send.ts",
] as const;

export function readOnescreenScreen(): string {
  return ONESCREEN_SCREEN_FILES.map((f) =>
    readFileSync(join(process.cwd(), "src", "features", "onescreen", f), "utf8"),
  ).join("\n");
}
