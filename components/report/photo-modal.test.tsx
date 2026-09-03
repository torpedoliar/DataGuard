import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhotoModal from "./photo-modal";
import PhotoModalTrigger from "./photo-modal-trigger";

describe("PhotoModal", () => {
  it("safely returns null during SSR when document is undefined or unmounted", () => {
    const html = renderToStaticMarkup(
      React.createElement(PhotoModal, {
        photoPath: "/uploads/devices/photo-1.jpg",
        deviceName: "Test Switch",
        onClose: () => {},
      })
    );
    expect(html).toBe("");
  });

  it("PhotoModalTrigger renders a button with type=button and title", () => {
    const html = renderToStaticMarkup(
      React.createElement(PhotoModalTrigger, {
        photoPath: "/uploads/devices/photo-1.jpg",
        deviceName: "Test Switch",
      })
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('title="View photo"');
    expect(html).toContain("photo");
  });
});
