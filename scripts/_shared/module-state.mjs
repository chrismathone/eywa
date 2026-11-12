import { effectiveDisabledModulesFromStored } from "../../src/lib/module-state.mjs";

/** 앱의 모듈 해석과 같은 순수 계산을 DB 원문을 읽는 워커·수동 도구에 제공한다. */
export function isRawModuleEnabled(stored, module) {
  return !effectiveDisabledModulesFromStored(stored).includes(module);
}
