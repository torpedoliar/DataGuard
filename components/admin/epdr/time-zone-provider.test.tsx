import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EpdrTimeZoneProvider, useEpdrTimeZone } from "./time-zone-provider";
function Probe() { const { timeZone } = useEpdrTimeZone(); return <span>{timeZone}</span>; }
describe("EPDR timezone context", () => {
  it("keeps isolated components deterministic outside the provider", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>UTC</span>");
  });
  it("inherits the site timezone immediately on server and client", () => {
    expect(renderToStaticMarkup(<EpdrTimeZoneProvider initialTimeZone={null} siteTimeZone="Asia/Jakarta"><Probe /></EpdrTimeZoneProvider>)).toBe("<span>Asia/Jakarta</span>");
  });
  it("falls back to UTC when no site zone exists", () => {
    expect(renderToStaticMarkup(<EpdrTimeZoneProvider initialTimeZone={null}><Probe /></EpdrTimeZoneProvider>)).toBe("<span>UTC</span>");
  });
  it("renders saved personal zones without depending on browser or scheduling zones", () => {
    expect(renderToStaticMarkup(<EpdrTimeZoneProvider initialTimeZone="Asia/Makassar" siteTimeZone="Asia/Jakarta"><Probe /></EpdrTimeZoneProvider>)).toBe("<span>Asia/Makassar</span>");
  });
});
