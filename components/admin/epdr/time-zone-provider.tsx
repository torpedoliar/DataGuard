"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { resolveEpdrTimeZone } from "@/lib/epdr/time-zone";

type TimeZoneContext = { timeZone: string; personalTimeZone: string | null; setPersonalTimeZone: (zone: string | null) => void };
const Context = createContext<TimeZoneContext>({ timeZone: "UTC", personalTimeZone: null, setPersonalTimeZone: () => {} });

export function EpdrTimeZoneProvider({ children, initialTimeZone, siteTimeZone }: {
  children: ReactNode; initialTimeZone: string | null; siteTimeZone?: string;
}) {
  const [personalTimeZone, setPersonalTimeZone] = useState(initialTimeZone);
  return <Context.Provider value={{ timeZone: resolveEpdrTimeZone(personalTimeZone, siteTimeZone), personalTimeZone, setPersonalTimeZone }}>
    {children}
  </Context.Provider>;
}

export function useEpdrTimeZone() { return useContext(Context); }
