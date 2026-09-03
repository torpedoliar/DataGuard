import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTheme, ThemeToggle } from "./theme-toggle";

describe("ThemeToggle and applyTheme", () => {
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;

  let mockClassList: Set<string>;
  let mockStorage: Map<string, string>;

  beforeAll(() => {
    mockClassList = new Set<string>();
    mockStorage = new Map<string, string>();

    // Mock document
    (globalThis as unknown as { document: unknown }).document = {
      documentElement: {
        classList: {
          contains: (cls: string) => mockClassList.has(cls),
          toggle: (cls: string, force?: boolean) => {
            const shouldAdd = force !== undefined ? force : !mockClassList.has(cls);
            if (shouldAdd) mockClassList.add(cls);
            else mockClassList.delete(cls);
            return shouldAdd;
          },
        },
      },
      cookie: "",
    };

    // Mock localStorage
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      clear: () => mockStorage.clear(),
      removeItem: (key: string) => mockStorage.delete(key),
    };
  });

  afterAll(() => {
    (globalThis as unknown as { document: unknown }).document = originalDocument;
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalLocalStorage;
  });

  beforeEach(() => {
    mockClassList.clear();
    mockStorage.clear();
    document.cookie = "";
  });

  it("applies dark mode properly to DOM, localStorage, and cookie", () => {
    applyTheme(true);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.cookie).toContain("theme=dark");
  });

  it("applies light mode properly to DOM, localStorage, and cookie", () => {
    applyTheme(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    applyTheme(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.cookie).toContain("theme=light");
  });

  it("renders server placeholder without crashing", () => {
    const html = renderToStaticMarkup(React.createElement(ThemeToggle));
    expect(html).toContain("aria-label=\"Toggle theme\"");
  });
});
