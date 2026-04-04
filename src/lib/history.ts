/**
 * 历史记录管理（localStorage）
 */

import type { MindMapData } from '@/types/mindmap';

const STORAGE_KEY = 'ps-mindmap-history';
const MAX_RECORDS = 20;

export interface HistoryRecord {
  id: string;
  schoolName: string;
  programName: string;
  createdAt: string; // ISO string
  mindMapData: MindMapData;
  /** xmind ArrayBuffer 的 base64 编码 */
  xmindBase64: string;
}

/** 读取所有历史记录（按时间倒序） */
export function getRecords(): HistoryRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryRecord[];
  } catch {
    return [];
  }
}

/** 保存一条记录（自动去重、限数量） */
export function saveRecord(record: Omit<HistoryRecord, 'id' | 'createdAt'>): HistoryRecord {
  const records = getRecords();
  const newRecord: HistoryRecord = {
    ...record,
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  records.unshift(newRecord);
  // 超出上限时移除最旧的
  while (records.length > MAX_RECORDS) records.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  return newRecord;
}

export function updateRecord(
  id: string,
  updates: Pick<HistoryRecord, 'schoolName' | 'programName' | 'mindMapData' | 'xmindBase64'>,
): HistoryRecord | null {
  const records = getRecords();
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) return null;

  const updatedRecord: HistoryRecord = {
    ...records[index],
    ...updates,
  };
  records[index] = updatedRecord;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  return updatedRecord;
}

/** 删除一条记录 */
export function deleteRecord(id: string): void {
  const records = getRecords().filter((r) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/** ArrayBuffer → base64 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** base64 → ArrayBuffer */
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
