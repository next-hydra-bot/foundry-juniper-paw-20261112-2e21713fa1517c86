import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomerAccountHomeView } from "./home";

const labels = {
  details: "Your details",
  title: "Overview",
};

const render = (
  user: Parameters<typeof CustomerAccountHomeView>[0]["user"]
) => {
  const view = document.createElement("div");
  view.innerHTML = renderToStaticMarkup(
    <CustomerAccountHomeView labels={labels} user={user} />
  );
  return view;
};

describe("Account overview", () => {
  it("shows the signed-in identity in the overview", () => {
    const view = render({
      email: "shopper@example.com",
      firstName: "Grace",
      lastName: "Hopper",
    });
    expect(view.textContent).toContain("Grace Hopper");
    expect(view.textContent).toContain("shopper@example.com");
    expect(view.querySelector("h2")?.textContent).toBe("Overview");
  });

  it("keeps an email-only identity readable when names were not supplied", () => {
    const view = render({
      email: "shopper@example.com",
      firstName: null,
      lastName: null,
    });
    expect(view.querySelector("section")?.textContent).toContain(
      "shopper@example.com"
    );
  });
});
