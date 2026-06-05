import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AIExtractionCandidate, RenewalItem } from "../types";
import { makeDemoItems } from "../data/demoData";

interface DuePocketDB extends DBSchema {
  items: {
    key: string;
    value: RenewalItem;
    indexes: {
      "by-type": string;
      "by-nextChargeDate": string;
    };
  };
  candidates: {
    key: string;
    value: AIExtractionCandidate;
    indexes: {
      "by-status": string;
      "by-createdAt": string;
    };
  };
}

const DB_NAME = "duepocket-local-first";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<DuePocketDB>> | undefined;

function getDB() {
  dbPromise ??= openDB<DuePocketDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const itemStore = db.createObjectStore("items", { keyPath: "id" });
      itemStore.createIndex("by-type", "type");
      itemStore.createIndex("by-nextChargeDate", "nextChargeDate");

      const candidateStore = db.createObjectStore("candidates", { keyPath: "id" });
      candidateStore.createIndex("by-status", "status");
      candidateStore.createIndex("by-createdAt", "createdAt");
    },
  });
  return dbPromise;
}

export async function listItems(): Promise<RenewalItem[]> {
  const db = await getDB();
  return (await db.getAll("items")).sort((a, b) => a.nextChargeDate.localeCompare(b.nextChargeDate));
}

export async function saveItem(item: RenewalItem): Promise<void> {
  const db = await getDB();
  await db.put("items", item);
}

export async function saveItems(items: RenewalItem[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("items", "readwrite");
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function deleteItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("items", id);
}

export async function replaceItems(items: RenewalItem[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("items", "readwrite");
  await tx.store.clear();
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function ensureDemoData(): Promise<void> {
  const db = await getDB();
  const count = await db.count("items");
  if (count === 0) await saveItems(makeDemoItems());
}

export async function listCandidates(): Promise<AIExtractionCandidate[]> {
  const db = await getDB();
  return (await db.getAll("candidates")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveCandidate(candidate: AIExtractionCandidate): Promise<void> {
  const db = await getDB();
  await db.put("candidates", candidate);
}

export async function replaceCandidates(candidates: AIExtractionCandidate[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("candidates", "readwrite");
  await tx.store.clear();
  await Promise.all(candidates.map((candidate) => tx.store.put(candidate)));
  await tx.done;
}

export async function updateCandidateStatus(id: string, status: AIExtractionCandidate["status"]): Promise<void> {
  const db = await getDB();
  const candidate = await db.get("candidates", id);
  if (!candidate) return;
  await db.put("candidates", { ...candidate, status });
}

export async function resetDemoData(): Promise<void> {
  await replaceItems(makeDemoItems());
  await replaceCandidates([]);
}
