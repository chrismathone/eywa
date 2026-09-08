import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import {
  CONTROL_H,
  CONTROL_H_LG,
  CONTROL_H_SM,
  CONTROL_ICON,
  CONTROL_LABEL,
  CONTROL_LABEL_LG,
  CONTROL_LABEL_SM,
  CONTROL_SQUARE,
  CONTROL_SQUARE_LG,
  CONTROL_SQUARE_SM,
} from "./control-scale"

const buttonVariants = cva(
  // cursor-pointer: Tailwind v4가 preflight의 `button{cursor:pointer}`를 삭제해(v3→v4 breaking change)
  // 명시하지 않으면 앱 전역 버튼이 화살표로 보인다(원장 지적 2026-07-29 — ECS에서 발견, 전역 동일).
  // disabled는 pointer-events-none이라 커서 분기 불요.
  // 치수(높이·라벨)는 size 변형이 control-scale.ts 상수로 준다 — 여기 text-*·h-*를 적지 말 것.
  `group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 ${CONTROL_ICON}`,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // xs·sm은 같은 "작은 컨트롤" 한 벌이다(옛 h-6/h-7 두 단계를 합침 — 한 줄에 서면 밑선이 갈렸다).
      size: {
        default: `${CONTROL_H} ${CONTROL_LABEL} gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2`,
        xs: `${CONTROL_H_SM} ${CONTROL_LABEL_SM} gap-1 rounded-[min(var(--radius-md),10px)] px-2 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5`,
        sm: `${CONTROL_H_SM} ${CONTROL_LABEL_SM} gap-1 rounded-[min(var(--radius-md),10px)] px-2 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5`,
        lg: `${CONTROL_H_LG} ${CONTROL_LABEL_LG} gap-2 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5`,
        icon: `${CONTROL_SQUARE} ${CONTROL_LABEL}`,
        "icon-xs": `${CONTROL_SQUARE_SM} ${CONTROL_LABEL_SM} rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg`,
        "icon-sm": `${CONTROL_SQUARE_SM} ${CONTROL_LABEL_SM} rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg`,
        "icon-lg": `${CONTROL_SQUARE_LG} ${CONTROL_LABEL_LG}`,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  // render prop이 있으면 (Link/a 등 다른 element로 교체되는 경우) nativeButton false가 기본.
  // 명시적으로 nativeButton을 받았으면 그대로 존중.
  const resolvedNative = render ? (nativeButton ?? false) : nativeButton
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      nativeButton={resolvedNative}
      {...props}
    />
  )
}

export { Button, buttonVariants }
