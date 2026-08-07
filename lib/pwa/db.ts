import { openDB, DBSchema, IDBPDatabase } from 'idb';

// ponytail: photo stored as File (structured-clone friendly in IDB), reconstructed to
// FormData on replay. No base64 round-trip (memory waste). Upgrade: extract to dedicated
// photo store only if IDB quota becomes a real problem.
export interface QueuedAuditItem {
  deviceId: string;
  status: 'OK' | 'Warning' | 'Error';
  remarks: string;
  photoFile?: File;
}

export interface QueuedAudit {
  localId?: number;
  clientCreatedAt: string;
  siteId: string;
  userId: string;
  checkDate: string;
  checkTime: string;
  shift: 'Pagi' | 'Siang' | 'Malam';
  items: QueuedAuditItem[];
  status: 'pending' | 'syncing' | 'failed';
  attempts: number;
  lastError?: string;
}

interface DataGuardDB extends DBSchema {
  auditQueue: {
    key: number;
    value: QueuedAudit;
    indexes: { 'by-status': string };
  };
  readCache: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: { url: string; data: any; fetchedAt: number; ttlMs: number };
  };
  meta: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
