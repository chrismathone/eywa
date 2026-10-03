"use client";

import { Popover } from "@base-ui/react/popover";
import { HrefSelect } from "@/components/href-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import {
  useSheetLang,
  useSheetT,
  useSheetTf,
} from "@/features/teacher-view/lang-context";
import {
  ONESCREEN_FONT_SIZES,
  onescreenFontSizeLabel,
  type OnescreenFontSize,
} from "../font-size";
import { setSentNoticeHidden, useSentNoticeHidden } from "./use-sent-notice";
import { DisplaySettingsFields } from "./display-settings";

export function TopBarSettings({
  noticeMode,
  academyNoticeMode,
  onNoticeMode,
  fontSize,
  onFontSize,
  classnoteOn,
}: {
  noticeMode: "A" | "B" | null;
  academyNoticeMode: "A" | "B";
  onNoticeMode: (mode: "A" | "B" | null) => void;
  fontSize: OnescreenFontSize;
  onFontSize: (size: OnescreenFontSize) => void;
  classnoteOn: boolean;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  const hidden = useSentNoticeHidden();
  return (
    <Popover.Root>
      <Popover.Trigger className={`${TOOLBAR_SELECT} shrink-0 cursor-pointer`}>
        {t("os.toolbar.settings")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup
            className="border-line bg-card flex max-w-[calc(100vw-24px)] flex-col gap-3 rounded-lg border p-3 shadow-lg outline-none"
            aria-label={t("os.toolbar.settings")}
          >
            <DisplaySettingsFields />
            <HrefSelect
              axisLabel={t("os.ment.axis")}
              ariaLabel={t("os.ment.title")}
              value={String(noticeMode)}
              onSelect={(v) =>
                onNoticeMode(v === "null" ? null : (v as "A" | "B"))
              }
              options={[
                {
                  value: "null",
                  label: tf("os.ment.academy", { mode: academyNoticeMode }),
                },
                { value: "A", label: t("os.ment.a"), hint: t("os.ment.aHint") },
                { value: "B", label: t("os.ment.b"), hint: t("os.ment.bHint") },
              ]}
            />
            <HrefSelect
              axisLabel={t("os.fontSize")}
              ariaLabel={t("os.fontSize.title")}
              value={fontSize}
              onSelect={(v) => onFontSize(v as OnescreenFontSize)}
              options={ONESCREEN_FONT_SIZES.map((size) => ({
                value: size,
                label: onescreenFontSizeLabel(size, lang),
              }))}
            />
            {classnoteOn ? (
              <div className="border-line border-t pt-2 text-xs">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={(e) => setSentNoticeHidden(!e.target.checked)}
                  />
                  {t("os.sentNotice.show")}
                </label>
                <p className="text-text-faint mt-1 max-w-64">
                  {t("os.sentNotice.localHint")}
                </p>
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
