import { TOGGLE_FEATURES } from "./labels";

const NEW_TENANT_LICENSE_DEFAULTS = [
  {
    key: "ai_analysis",
    defaultOn: true,
    description: "상담·회의 등 AI 분석 기능을 처음부터 사용합니다.",
  },
  {
    key: "meeting_recording",
    defaultOn: false,
    description: "회의 녹음 파일을 올리고 외부 전사 서비스를 사용할 수 있습니다.",
  },
  {
    key: "google_sheets",
    defaultOn: false,
    description: "구글 시트 가져오기와 자동·수동 반영을 사용할 수 있습니다.",
  },
] as const;

export type NewTenantLicenseKey = (typeof NEW_TENANT_LICENSE_DEFAULTS)[number]["key"];
export type NewTenantLicenseSelection = Record<NewTenantLicenseKey, boolean>;

function labelOf(key: NewTenantLicenseKey): string {
  const feature = TOGGLE_FEATURES.find((item) => item.key === key);
  if (!feature) throw new Error(`새 학원 라이선스 라벨 누락: ${key}`);
  return feature.label;
}

/** 새 학원 발급 화면과 서버 저장이 함께 쓰는 세 기능·권장 기본값. 라벨은 TOGGLE_FEATURES가 단일 원본이다. */
export const NEW_TENANT_LICENSE_OPTIONS = NEW_TENANT_LICENSE_DEFAULTS.map((option) => ({
  ...option,
  label: labelOf(option.key),
}));

/**
 * 새 화면은 hidden(false) + checkbox(true)를 함께 보내 명시적인 끔과 켬을 가른다.
 * 배포 중 옛 화면이 필드를 보내지 않으면 권장 기본값으로 저장해, 새 지점에 라이선스 행이 빠지지 않게 한다.
 */
export function newTenantLicenseSelection(formData: Pick<FormData, "getAll">): NewTenantLicenseSelection {
  return Object.fromEntries(
    NEW_TENANT_LICENSE_OPTIONS.map((option) => {
      const values = formData.getAll(option.key).map(String);
      return [option.key, values.length === 0 ? option.defaultOn : values.includes("true")];
    }),
  ) as NewTenantLicenseSelection;
}
