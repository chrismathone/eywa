// tenant audio-path 검증은 순수 모듈(legacy-audio-path.ts)로 이동(Vitest 가능, server-only 회피).
// 기존 import 경로 호환을 위한 re-export shim — 4개 server action이 여기서 import 중.
export { isTenantAudioPath } from "./legacy-audio-path";
