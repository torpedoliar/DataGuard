import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { routing } from "@/i18n/routing";

import { cookies } from "next/headers";
import { getSettings } from "@/actions/settings";

// Fonts are committed as variable WOFF2 (SIL OFL 1.1, see app/fonts/OFL.txt) and
// loaded by next/font/local. The Docker builder has no outbound internet access,
// so a Google Fonts fetch at build time would fail the image build.
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
});

// viewportFit cover enables env(safe-area-inset-*) on iOS so the fixed
// bottom nav clears the home indicator and the top bar clears the notch.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();

  return {
    title: {
      template: `%s | ${settings.appName}`,
      default: settings.appName,
    },
    description: "Data Center Audit Management System",
    icons: settings.faviconPath ? {
      icon: settings.faviconPath
    } : undefined,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  // Validate the locale we resolve; fall back to default for unknown values
  // so client components consuming the provider always see a supported one.
  const validLocale = routing.locales.includes(locale as (typeof routing.locales)[number])
    ? locale
    : routing.defaultLocale;
  const messages = await getMessages();

  // Server-side theme detection via cookie to eliminate FOUC and theme drifting
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const isDark = themeCookie !== undefined ? themeCookie === "dark" : true;

  return (
    <html
      lang={validLocale}
      className={`${geistSans.variable} ${geistMono.variable}${isDark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var c=document.cookie.match(/(?:^|; )theme=([^;]*)/);var v=t||(c?c[1]:null);if(v){var d=v==='dark';document.documentElement.classList.toggle('dark',d);if(!c||c[1]!==v){document.cookie='theme='+v+';path=/;max-age=31536000;SameSite=Lax';}}else{var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var d=m!==false;document.documentElement.classList.toggle('dark',d);localStorage.setItem('theme',d?'dark':'light');document.cookie='theme='+(d?'dark':'light')+';path=/;max-age=31536000;SameSite=Lax';}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased bg-ops-bg text-ops-text min-h-dvh flex flex-col">
        <a href="#main-content" className="sr-only focus:absolute focus:z-50 focus:rounded-bl-lg focus:border-2 focus:border-ops-accent focus:bg-ops-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ops-accent">Skip to content</a>
        <NextIntlClientProvider locale={validLocale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
