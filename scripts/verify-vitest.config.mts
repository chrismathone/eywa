/**
 * 로컬 게이트(`verify-changed.mjs`) 전용 vitest 설정 — 프로젝트 설정 그대로에 **값을 줄여 쓰지 않기**만 더한다.
 * 기본값이면 실패 메시지가 `expected { …(8) } to deeply equal { …(7) }`처럼 내용을 숨겨, 기준선 비교가 "같은 실패"로 오판한다
 * (위반 하나를 고치고 다른 하나를 더하면 개수가 같다). vitest 4는 이걸 명령줄로 받지 않아 설정으로 준다.
 */
import { mergeConfig } from "vitest/config";
import base from "../vitest.config";

export default mergeConfig(base, {
  root: process.cwd(),
  test: { chaiConfig: { truncateThreshold: 0 } },
});
