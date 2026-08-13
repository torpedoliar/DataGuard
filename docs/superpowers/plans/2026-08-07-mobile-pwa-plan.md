# Mobile PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement offline-capable PWA wrapper for existing DC-Check app using manual Service Worker and IndexedDB, allowing audits without network connection.

**Architecture:** Client-side PWA wrapper adding Service Worker (`public/sw.js`) for shell precache and API staleness, with IndexedDB (`idb`) caching offline audits to be replayed upon network reconnection. No new backend routes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, idb, Service Worker, IndexedDB.

## Global Constraints

- No native app / Expo
- No next-pwa or Workbox plugin (manual SW only)
- No background sync (use manual replay via `online` listener)
- No new design tokens
- No Web Push
- Append-only offline audit sync, no conflict resolution

---

### Task 1: Dependencies setup

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: none
- Produces: installed `idb` and `fake-indexeddb`

- [ ] **Step 1: Install runtime package**

```bash
npm install idb
```

- [ ] **Step 2: Install test dev package**

```bash
npm install -D fake-indexeddb
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add idb and fake-indexeddb for PWA"
```

### Task 2: PWA Service Worker & Manifest

**Files:**
- Create: `public/sw.js`
- Create: `app/manifest.ts`
- Create: `lib/pwa/register-sw.ts`
- Modify: `app/[locale]/layout.tsx`

**Interfaces:**
- Consumes: Next 16 routing
- Produces: Service Worker caching shell (`/_next/static/*` cache-first, GET SWR, POST bypass)

- [ ] **Step 1: Write `app/manifest.ts`**

```typescript
import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DataGuard PWA',
    short_name: 'DataGuard',
    description: 'Data Center Audit PWA',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b1120',
    theme_color: '#0b1120',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
```

- [ ] **Step 2: Write `public/sw.js`**

```javascript
const CACHE_NAME = 'dataguard-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/offline.html']))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // POST (server actions) -> network only
  if (event.request.method === 'POST') {
    return;
  }

  // Next.js static assets -> cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((response) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // Network-first for other GET
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === 'navigate') {
          return caches.match('/offline.html');
        }
      });
    })
  );
});
```

- [ ] **Step 3: Write `lib/pwa/register-sw.ts`**

```typescript
'use client';
import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('SW register failed', err);
      });
    }
  }, []);
  return null;
}
```

- [ ] **Step 4: Update `app/[locale]/layout.tsx`**

```tsx
// Inside layout.tsx, import RegisterSW and add <RegisterSW /> inside body.
```
*(Engineer: ensure to add `<RegisterSW />` in body without removing existing providers.)*

- [ ] **Step 5: Commit**
```bash
git add public/sw.js app/manifest.ts lib/pwa/register-sw.ts app/\[locale\]/layout.tsx
git commit -m "feat: add service worker, manifest, and registration"
```

### Task 3: PWA Library Core (IndexedDB Wrapper)

**Files:**
- Create: `lib/pwa/db.ts`
- Create: `lib/pwa/cache-config.ts`

**Interfaces:**
- Consumes: `idb`
- Produces: `getDb()` wrapper, cache constants

- [ ] **Step 1: Write `lib/pwa/cache-config.ts`**

```typescript
export const CACHE_TTL = {
  grid: 5 * 60 * 1000,
  findings: 60 * 1000,
  rack: 10 * 60 * 1000,
};
```

- [ ] **Step 2: Write `lib/pwa/db.ts`**

```typescript
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface DataGuardDB extends DBSchema {
  auditQueue: {
    key: number;
    value: {
      localId?: number;
      clientCreatedAt: string;
      siteId: string;
      userId: string;
      checkDate: string;
      checkTime: string;
      shift: string;
      items: Array<{ deviceId: string; status: string; remarks: string; photoBlob?: Blob }>;
      status: 'pending' | 'syncing' | 'failed';
      attempts: number;
      lastError?: string;
    };
    indexes: { 'by-status': string };
  };
  readCache: {
    key: string;
    value: { url: string; data: any; fetchedAt: number; ttlMs: number };
  };
  meta: {
    key: string;
    value: any;
  };
}

let dbPromise: Promise<IDBPDatabase<DataGuardDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<DataGuardDB>('dataguard-pwa', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('auditQueue')) {
          const store = db.createObjectStore('auditQueue', { keyPath: 'localId', autoIncrement: true });
          store.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('readCache')) {
          db.createObjectStore('readCache', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      },
    });
  }
  return dbPromise;
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/pwa/db.ts lib/pwa/cache-config.ts
git commit -m "feat: idb wrapper and cache configs"
```

### Task 4: Offline Audit Queue & Test

**Files:**
- Create: `lib/pwa/audit-queue.ts`
- Create: `lib/pwa/audit-queue.test.ts`

**Interfaces:**
- Consumes: `lib/pwa/db.ts`
- Produces: `enqueue()`, `replay()` for audit offline queue.

- [ ] **Step 1: Write `lib/pwa/audit-queue.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { enqueue, getQueue } from './audit-queue';
import { getDb } from './db';

describe('audit-queue', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.clear('auditQueue');
  });

  it('enqueues payload', async () => {
    const localId = await enqueue({ siteId: '123', shift: 'Pagi', items: [] });
    const items = await getQueue();
    expect(items.length).toBe(1);
    expect(items[0].status).toBe('pending');
  });
});
```

- [ ] **Step 2: Run test (fails)**
```bash
npm run test -- lib/pwa/audit-queue.test.ts
```

- [ ] **Step 3: Write `lib/pwa/audit-queue.ts`**

```typescript
import { getDb } from './db';
// In complete implementation this will import `submitChecklist` server action.
// For now, it is a shell to queue and retrieve items.
export async function enqueue(payload: any) {
  const db = await getDb();
  return db.add('auditQueue', {
    ...payload,
    clientCreatedAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0
  });
}

export async function getQueue() {
  const db = await getDb();
  return db.getAll('auditQueue');
}

export async function replay(submitAction: Function) {
  const db = await getDb();
  const tx = db.transaction('auditQueue', 'readwrite');
  const index = tx.store.index('by-status');
  const pending = await index.getAll('pending');
  
  for (const item of pending) {
    item.status = 'syncing';
    await db.put('auditQueue', item);
    try {
      await submitAction(item);
      await db.delete('auditQueue', item.localId!);
    } catch (e: any) {
      item.attempts += 1;
      item.status = item.attempts >= 5 ? 'failed' : 'pending';
      item.lastError = e.message;
      await db.put('auditQueue', item);
    }
  }
}
```

- [ ] **Step 4: Run test (passes)**
```bash
npm run test -- lib/pwa/audit-queue.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add lib/pwa/audit-queue.ts lib/pwa/audit-queue.test.ts
git commit -m "feat: offline audit queue and test"
```

### Task 5: Mobile Hooks & Shell Components

**Files:**
- Create: `hooks/use-online-status.ts`
- Create: `components/mobile/bottom-nav.tsx`
- Create: `components/mobile/mobile-shell.tsx`
- Create: `components/mobile/offline-banner.tsx`

**Interfaces:**
- Consumes: `lib/pwa/audit-queue.ts`
- Produces: standard mobile wrapper components

- [ ] **Step 1: Write `hooks/use-online-status.ts`**
```typescript
import { useState, useEffect } from 'react';
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  return isOnline;
}
```

- [ ] **Step 2: Write `components/mobile/offline-banner.tsx`**
```tsx
'use client';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);
  
  if (isOnline || dismissed) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between bg-ops-surface-raised p-2 text-ops-warning border-b border-ops-border">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-sm">Offline — network disconnected</span>
      </div>
      <button onClick={() => setDismissed(true)}><X className="h-4 w-4" /></button>
    </div>
  );
}
```

- [ ] **Step 3: Write `components/mobile/bottom-nav.tsx`**
```tsx
import Link from 'next/link';
import { ClipboardCheck, LayoutGrid, ShieldAlert, Server, User } from 'lucide-react';

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 w-full bg-ops-surface-raised border-t border-ops-border flex justify-around pb-[env(safe-area-inset-bottom)] md:hidden">
      <Link href="/checklist" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <ClipboardCheck className="h-6 w-6" />
        <span className="text-xs">Audit</span>
      </Link>
      <Link href="/grid" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <LayoutGrid className="h-6 w-6" />
        <span className="text-xs">Grid</span>
      </Link>
      <Link href="/admin/siem/findings" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <ShieldAlert className="h-6 w-6" />
        <span className="text-xs">SIEM</span>
      </Link>
      <Link href="/admin/rack" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <Server className="h-6 w-6" />
        <span className="text-xs">Rack</span>
      </Link>
      <Link href="#" className="flex flex-col items-center p-2 text-ops-muted active:scale-95 active:opacity-80">
        <User className="h-6 w-6" />
        <span className="text-xs">Profile</span>
      </Link>
    </nav>
  );
}
```

- [ ] **Step 4: Commit**
```bash
git add hooks/ components/mobile/
git commit -m "feat: mobile shell, bottom nav, and offline banner components"
```

### Task 6: Responsive Tune Core Dashboard Pages

**Files:**
- Modify: `app/[locale]/(dashboard)/checklist/page.tsx`
- Modify: `app/[locale]/(dashboard)/grid/page.tsx`
- Modify: `app/[locale]/(dashboard)/admin/siem/findings/page.tsx`
- Modify: `app/[locale]/(dashboard)/admin/rack/page.tsx`

**Interfaces:**
- Consumes: Mobile shell components (`BottomNav`, `OfflineBanner`)

- [ ] **Step 1: Update Pages**
Update all mentioned pages to include `<OfflineBanner />` at top and `<BottomNav />` at bottom, adding `pb-20` on the main container.

- [ ] **Step 2: Commit**
```bash
git add app/
git commit -m "feat: responsive tuning and integrate mobile components"
```
