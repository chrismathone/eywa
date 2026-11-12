import {
  MODULE_IDS,
  effectiveDisabledModulesFromStored,
  type ModuleId,
} from "@/lib/modules";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type DemoModuleChange = {
  before: ModuleId[];
  after: ModuleId[];
  section: Record<string, unknown> & { disabled: ModuleId[]; known: ModuleId[] };
};

/** 데모 재원 교체는 지금 실효 목록에서 신규생 관리만 켜고, 다른 모듈 상태는 그대로 둔다. */
export function demoModulesWithNewcomers(stored: unknown): DemoModuleChange {
  const root = isObject(stored) ? stored : {};
  const modules = isObject(root.modules) ? root.modules : {};
  const genericStored = { ...root, preset: "generic", modules };
  const before = effectiveDisabledModulesFromStored(genericStored) as ModuleId[];
  const after = before.filter((id) => id !== "newcomers");
  return {
    before,
    after,
    section: { ...modules, disabled: after, known: [...MODULE_IDS] },
  };
}
