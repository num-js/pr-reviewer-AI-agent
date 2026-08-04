const DB_NAME = "pr-reviewer";
const DB_VERSION = 1;
const STORE = "reviews";
const MAX_ENTRIES = 200;

export type ReviewHistoryComment = {
  file: string;
  line: number;
  comment: string;
  suggestedCode?: string;
};

export type ReviewHistoryStatus = "generated" | "posted";

export type ReviewHistoryEntry = {
  id: string;
  savedAt: number;
  postedAt?: number;
  status: ReviewHistoryStatus;
  prUrl: string;
  owner: string;
  repo: string;
  pullNumber: number;
  prTitle?: string;
  comments: ReviewHistoryComment[];
  suggestionsCount: number;
  postedInlineCount: number;
  fallbackPosted: boolean;
  summaryPosted?: boolean;
};

function normalizeEntry(raw: ReviewHistoryEntry): ReviewHistoryEntry {
  const status: ReviewHistoryStatus =
    raw.status === "generated" || raw.status === "posted"
      ? raw.status
      : raw.postedInlineCount > 0 || raw.fallbackPosted
        ? "posted"
        : "generated";
  return { ...raw, status };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
    };
  });
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function pruneOldest(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const index = store.index("savedAt");
  const all = await reqToPromise(index.getAll());
  if (all.length <= MAX_ENTRIES) {
    await txDone(tx);
    return;
  }
  const overflow = all.length - MAX_ENTRIES;
  const oldest = all.slice(0, overflow);
  for (const entry of oldest) {
    store.delete(entry.id);
  }
  await txDone(tx);
}

export async function saveReview(
  entry: ReviewHistoryEntry
): Promise<ReviewHistoryEntry> {
  const db = await openDb();
  try {
    const normalized = normalizeEntry(entry);
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(normalized);
    await txDone(tx);
    await pruneOldest(db);
    return normalized;
  } finally {
    db.close();
  }
}

/** @deprecated use saveReview */
export const addReview = saveReview;

export async function listReviews(): Promise<ReviewHistoryEntry[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("savedAt");
    const all = await reqToPromise(index.getAll());
    await txDone(tx);
    return all.map(normalizeEntry).reverse();
  } finally {
    db.close();
  }
}

export async function getReview(
  id: string
): Promise<ReviewHistoryEntry | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const entry = await reqToPromise(tx.objectStore(STORE).get(id));
    await txDone(tx);
    return entry ? normalizeEntry(entry) : undefined;
  } finally {
    db.close();
  }
}

export async function deleteReview(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function clearReviews(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}
