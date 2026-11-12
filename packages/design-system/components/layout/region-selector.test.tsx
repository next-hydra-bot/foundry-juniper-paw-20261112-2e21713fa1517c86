import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { RegionSelector } from "./region-selector";

let root: ReturnType<typeof createRoot> | undefined;
const options = [
  {
    description: "CAD",
    id: "canada",
    label: "Canada (English)",
    shortLabel: "CA",
  },
  {
    description: "EUR",
    id: "europe",
    label: "Europe (English)",
    shortLabel: "EU",
  },
];
const mount = (
  selectedId: string,
  onSelect = vi.fn<(id: string) => void>()
) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <RegionSelector
        options={options}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    );
  });
  const button = document.querySelector("button");
  if (!button) {
    throw new Error("Missing selector trigger");
  }
  return button;
};

describe("Region selector presentation", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    document.body.replaceChildren();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("renders supplied selling options and reports the chosen identity", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const button = mount("canada", onSelect);
    expect(button.getAttribute("aria-label")).toBe(
      "Current region Canada (English)"
    );
    act(() => {
      button.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 })
      );
    });
    expect(document.body.textContent).toContain("CAD");
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((element) => element.textContent?.includes("Europe (English)"));
    if (!item) {
      throw new Error("Missing configured Europe option");
    }
    act(() => {
      item.click();
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("europe");
  });

  it("does not claim the first option is selected for an unknown identity", () => {
    const button = mount("unknown");
    expect(button.getAttribute("aria-label")).toBe("Current region ");
    expect(button.textContent).not.toContain("CA");
  });
});
