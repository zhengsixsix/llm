'use client';

import { useState, useEffect } from 'react';
import { getRecords, deleteRecord, type HistoryRecord } from '@/lib/history';

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  onLoad: (record: HistoryRecord) => void;
}

export default function HistoryDrawer({ open, onClose, onLoad }: HistoryDrawerProps) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    if (open) setRecords(getRecords());
  }, [open]);

  const handleDelete = (id: string) => {
    deleteRecord(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative ml-auto w-[380px] bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[#3e3832]">历史记录</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30 mb-3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              暂无历史记录
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="px-5 py-3 hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#3e3832] truncate">
                        {record.schoolName} - {record.programName}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(record.createdAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => onLoad(record)}
                        className="text-xs px-2 py-1 rounded bg-[#b20155] text-white hover:bg-[#9a0148] transition-colors"
                      >
                        加载
                      </button>
                      <button
                        onClick={() => handleDelete(record.id)}
                        className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
