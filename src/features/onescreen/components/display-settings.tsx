"use client";

import { Popover } from "@base-ui/react/popover";
import { HrefSelect } from "@/components/href-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { useDisplayOptions } from "./display-options-context";

export function DisplaySettingsFields() {
  const { options, change } = useDisplayOptions();
  const t = useSheetT();
  return <>
    <HrefSelect axisLabel={t("os.display.sort")} ariaLabel={t("os.display.sort")} value={options.sort}
      onSelect={sort => change({ sort: sort === "name" ? "name" : "class" })}
      options={[{ value: "class", label: t("os.display.byClass") }, { value: "name", label: t("os.display.byName") }]} />
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" checked={options.hidePrevious} onChange={e => change({ hidePrevious: e.target.checked })} />
      {t("os.display.hidePrevious")}
    </label>
  </>;
}

export function DisplaySettings() {
  const t = useSheetT();
  return <Popover.Root>
    <Popover.Trigger className={TOOLBAR_SELECT}>{t("os.toolbar.settings")}</Popover.Trigger>
    <Popover.Portal><Popover.Positioner sideOffset={6} className="z-50">
      <Popover.Popup className="border-line bg-card flex flex-col gap-3 rounded-lg border p-3 shadow-lg" aria-label={t("os.toolbar.settings")}>
        <DisplaySettingsFields />
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
