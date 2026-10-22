"use client";
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => { element.style.height = "0px"; element.style.height = `${element.scrollHeight}px`; };
    resize();
    let width = element.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (width !== element.clientWidth) { width = element.clientWidth; resize(); }
    });
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [props.value]);
  return <textarea {...props} rows={1} ref={ref} />;
}
