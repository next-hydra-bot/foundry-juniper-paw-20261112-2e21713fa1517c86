/* oxlint-disable eslint/require-await -- Async React act flushes Suspense retries scheduled by synchronous renders. */
import { act, Suspense, use } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CustomerArea,
  CustomerAreaContent,
  CustomerAreaContentSkeleton,
  CustomerAreaNavigation,
} from "./customer-area";

const items = [
  { href: "/en-US/account", label: "Overview" },
  { href: "/en-US/account/orders", label: "Orders" },
];
function Content({
  content,
}: {
  readonly content: Promise<ReactNode>;
}): ReactNode {
  return use(content);
}
const deferredContent = () => {
  let complete: (content: ReactNode) => void;
  // oxlint-disable-next-line promise/avoid-new -- Control the native promise consumed by React.use at the content boundary.
  const promise = new Promise<ReactNode>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve: (content: ReactNode) => {
      complete(content);
    },
  };
};

describe("Customer area layout", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the sidebar mounted and updates its selection while page content loads", async () => {
    const render = async (href: string, content: Promise<ReactNode>) => {
      await act(async () => {
        root.render(
          <CustomerArea
            title="My account"
            description="Your account and shopping activity."
            navigation={
              <CustomerAreaNavigation
                items={items}
                label="Account navigation"
                currentHref={href}
              />
            }
          >
            <Suspense
              fallback={
                <CustomerAreaContentSkeleton>
                  <div />
                </CustomerAreaContentSkeleton>
              }
            >
              <Content content={content} />
            </Suspense>
          </CustomerArea>
        );
      });
    };
    await render(
      "/en-US/account",
      Promise.resolve(
        <CustomerAreaContent title="Overview">
          <p>Customer details</p>
        </CustomerAreaContent>
      )
    );
    const sidebar = container.querySelector("nav");
    const pending = deferredContent();
    await render("/en-US/account/orders", pending.promise);
    expect(container.querySelector("nav")).toBe(sidebar);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Orders"
    );
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label")
    ).toBe("Loading account content");
    await act(async () => {
      pending.resolve(
        <CustomerAreaContent title="Orders">
          <p>No orders yet</p>
        </CustomerAreaContent>
      );
    });
    expect(container.querySelector("nav")).toBe(sidebar);
    expect(container.querySelector("h2")?.textContent).toBe("Orders");
  });
});
