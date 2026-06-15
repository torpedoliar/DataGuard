import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { LoadingState } from "./loading-state";

describe("EmptyState", () => {
  it("renders the title", () => {
    const html = renderToStaticMarkup(React.createElement(EmptyState, { title: "No incidents" }));
    expect(html).toContain("No incidents");
  });
});

describe("LoadingState", () => {
  it("renders the label", () => {
    const html = renderToStaticMarkup(React.createElement(LoadingState, { label: "Loading events…" }));
    expect(html).toContain("Loading events…");
  });
});

describe("ErrorState", () => {
  it("renders title and description", () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        title: "Failed to load",
        description: "Check your network connection.",
      }),
    );
    expect(html).toContain("Failed to load");
    expect(html).toContain("Check your network connection.");
  });
});
