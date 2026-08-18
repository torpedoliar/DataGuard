import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import FieldAuditCard, { handleChecklistPhotoFile } from "./field-audit-card";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderCard(props: {
  prefillStatus?: string;
  prefillRemarks?: string;
  isHighlighted?: boolean;
} = {}) {
  return renderToStaticMarkup(
    React.createElement(FieldAuditCard, {
      device: {
        id: 42,
        name: "UPS A1",
        locationName: "Room 1",
      },
      ...props,
    }),
  );
}

describe("FieldAuditCard", () => {
  it("keeps checklist form field names compatible with submitChecklist", () => {
    const html = renderCard();

    expect(html).toContain('name="status-42"');
    expect(html).toContain('name="remarks-42"');
    // deviceId must NOT be emitted by the card: ChecklistForm renders it once
    // per device in its hidden all-devices block, so a card-level duplicate
    // makes formData.getAll("deviceId") return each device twice → double entries.
    expect(html).not.toContain('name="deviceId"');
  });

  it("offers both radio option values (OK and NOT OK)", () => {
    const html = renderCard();

    expect(html).toContain('value="OK"');
    expect(html).toContain('value="NOT OK"');
  });

  // Finding #60: the photo input must be gated on the NOT OK state so OK
  // devices never submit evidence (and the input renders only when needed).
  it("renders the photo input only in the NOT OK state", () => {
    expect(renderCard({ prefillStatus: "OK" })).not.toContain('name="photo-42"');

    const html = renderCard({ prefillStatus: "NOT OK" });
    expect(html).toContain('name="photo-42"');
    expect(html).toContain('type="file"');
  });

  it("seeds the radio state and remarks from prefill values", () => {
    const html = renderCard({
      prefillStatus: "NOT OK",
      prefillRemarks: "Fan module LED blinking",
    });

    // The NOT OK radio is the checked one.
    expect(html).toContain('checked="" value="NOT OK"');
    expect(html).not.toContain('checked="" value="OK"');
    // The prefilled remarks land inside the textarea.
    expect(html).toContain("Fan module LED blinking");
  });

  it("seeds OK state by default (no radio checked aside from OK)", () => {
    const html = renderCard({ prefillStatus: "OK" });
    expect(html).toContain('checked="" value="OK"');
    expect(html).not.toContain('checked="" value="NOT OK"');
  });

  // Finding #60: a photo over 10MB must be rejected client-side — alert shown
  // and the input cleared. The repo's vitest environment is node (no jsdom),
  // so the extracted handler is covered directly with a mocked alert and a
  // fake input target instead of dispatching DOM events.
  it("clears the input and alerts for a photo over 10MB", () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);

    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
    const target = { files: [bigFile] as unknown as FileList, value: "C:\\fakepath\\big.png" };

    handleChecklistPhotoFile(target);

    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith("Ukuran file maksimal 10MB");
    expect(target.value).toBe("");
  });

  it("keeps a photo at or under 10MB", () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);

    const okFile = new File([new Uint8Array(10 * 1024 * 1024)], "ok.png", { type: "image/png" });
    const target = { files: [okFile] as unknown as FileList, value: "C:\\fakepath\\ok.png" };

    handleChecklistPhotoFile(target);

    expect(alertMock).not.toHaveBeenCalled();
    expect(target.value).toBe("C:\\fakepath\\ok.png");
  });

  it("ignores an empty file input", () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);

    const target = { files: null, value: "" };

    handleChecklistPhotoFile(target);

    expect(alertMock).not.toHaveBeenCalled();
  });
});