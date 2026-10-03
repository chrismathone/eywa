"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import type { DisplayOptions } from "../display-options";

export async function saveDisplayOptions(value: DisplayOptions) {
  const error = await readonlyTeacherViewError();
  if (error) return { ok: false, error };
  if (!value || !["class", "name"].includes(value.sort) || typeof value.hidePrevious !== "boolean")
    return { ok: false, error: "잘못된 표시 설정입니다" };
  return patchMyUiPrefs("onescreen", { sort: value.sort, hidePrevious: value.hidePrevious });
}
