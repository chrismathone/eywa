import { WindowLink } from "@/components/workspace/window-link";
import { SheetText } from "@/features/teacher-view/interface-label";
import { siblingHint } from "@/features/students/siblings";
import type { SiblingView } from "@/features/students/server/siblings";
import type { SheetLang } from "@/features/teacher-view/i18n";

/**
 * 학생 상세 '프로필'의 형제 줄(원장 2026-10-19 *"프로필에 붙여"*) — 학부모 휴대폰·이름이 같은 원생 + 수정 화면에서 지정한 형제.
 * 판정은 `features/students/siblings.ts` 한 벌. 형제가 없으면 줄을 안 그린다. 누르면 그 원생을 따로 창으로 연다.
 */
export function ProfileSiblings({ siblings, lang }: { siblings: SiblingView[]; lang: SheetLang }) {
  if (siblings.length === 0) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs"><SheetText value={"형제"} /></dt>
      <dd className="text-foreground flex min-w-0 flex-wrap justify-end gap-x-3 gap-y-1 text-sm">
        {siblings.map((s) => {
          const hint = siblingHint(s, lang);
          return (
            <WindowLink key={s.id} href={`/students/${s.id}`} title={s.name} frameTarget="window" className="hover:underline">
              {s.name}
              {hint ? <span className="text-text-dim ml-1 text-xs">{hint}</span> : null}
            </WindowLink>
          );
        })}
      </dd>
    </div>
  );
}
