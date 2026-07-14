import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MENU_KEYS } from "@/lib/permissions";
import { Loader2, Trash2 } from "./eywa-icon-compat";
import { EYWA_ICON_CATALOG, EyIcon, MENU_ICON } from "./eywa-icons";

describe("Eywa icon system", () => {
  it("renders every catalog entry as an accessible labelled image", () => {
    render(
      <>
        {EYWA_ICON_CATALOG.map((icon) => (
          <EyIcon key={icon.name} name={icon.name} aria-label={icon.label} />
        ))}
      </>,
    );

    const icons = screen.getAllByRole("img");
    expect(icons).toHaveLength(EYWA_ICON_CATALOG.length);
    for (const icon of EYWA_ICON_CATALOG) {
      const svg = screen.getByLabelText(icon.label);
      expect(svg.getAttribute("data-eywa-icon")).toBe(icon.name);
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    }
  });

  it("hides decorative icons from assistive technology by default", () => {
    const { container } = render(<EyIcon name="layoutGrid" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
  });

  it("assigns a registered Eywa icon to every menu key", () => {
    const registeredNames = new Set(EYWA_ICON_CATALOG.map((icon) => icon.name));

    expect(Object.keys(MENU_ICON)).toHaveLength(MENU_KEYS.length);
    for (const menuKey of MENU_KEYS) {
      expect(registeredNames.has(MENU_ICON[menuKey])).toBe(true);
    }
  });

  it("keeps the legacy component contract while rendering Eywa glyphs", () => {
    const { container } = render(
      <>
        <Trash2 aria-label="삭제 아이콘" size={16} className="size-4" />
        <Loader2 aria-label="처리 아이콘" size={12} strokeWidth={2} absoluteStrokeWidth />
      </>,
    );

    const [trash, loader] = Array.from(container.querySelectorAll("svg"));
    expect(trash.getAttribute("data-eywa-icon")).toBe("trash");
    expect(trash.getAttribute("width")).toBe("16");
    expect(loader.getAttribute("data-eywa-icon")).toBe("loader");
    expect(loader.getAttribute("stroke-width")).toBe("4");
  });
});
