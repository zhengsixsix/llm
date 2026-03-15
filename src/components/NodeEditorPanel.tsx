'use client';

import { useState } from 'react';
import type { MindMapData, MindMapNode } from '@/types/mindmap';
import { findNodeById, getNodePath } from '@/types/mindmap';

interface NodeEditorPanelProps {
  data: MindMapData;
  onUpdateNode: (nodeId: string, newTitle: string) => void;
}

/** 单个树节点 */
function TreeNode({
  node,
  depth,
  selectedIds,
  onSelect,
}: {
  node: MindMapNode;
  depth: number;
  selectedIds: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = node.id ? selectedIds.has(node.id) : false;
  const isImage = !!node.imageKeyword && !node.title;

  if (isImage) return null;

  const typeColor =
    node.type === 'explanation'
      ? 'text-amber-600'
      : node.type === 'image'
      ? 'text-gray-400'
      : 'text-[#3e3832]';

  const label =
    node.title.length > 50 ? node.title.slice(0, 50) + '…' : node.title;

  return (
    <div>
      <div
        className={`flex items-start gap-1 py-1 px-2 rounded cursor-pointer text-xs leading-relaxed transition-colors ${
          isSelected
            ? 'bg-[#b20155]/10 text-[#b20155]'
            : 'hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={(e) => node.id && onSelect(node.id, e.shiftKey || e.metaKey || e.ctrlKey)}
      >
        {/* 展开/折叠 */}
        {hasChildren ? (
          <button
            className="mt-0.5 w-4 h-4 flex-shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-600"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        {/* 类型标记 */}
        {node.type === 'explanation' && (
          <span className="mt-0.5 w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
        )}

        <span className={`${typeColor} break-all`}>{label}</span>
      </div>

      {/* 子节点 */}
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id || child.title}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function NodeEditorPanel({ data, onUpdateNode }: NodeEditorPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [editText, setEditText] = useState('');
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // 当只有一个被选中时，显示编辑区
  const singleSelectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  const singleSelectedNode = singleSelectedId ? findNodeById(data.structure, singleSelectedId) : null;

  const handleSelect = (id: string, multi: boolean) => {
    if (multi) {
      // Shift/Ctrl/Cmd 多选切换
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      // 单选
      setSelectedIds(new Set([id]));
      const node = findNodeById(data.structure, id);
      if (node) setEditText(node.title);
    }
  };

  /** 单节点 AI 重写 */
  const regenerateOne = async (nodeId: string) => {
    const node = findNodeById(data.structure, nodeId);
    if (!node) return;

    const nodePath = getNodePath(data.structure, nodeId) || [];
    const res = await fetch('/api/regenerate-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentTitle: node.title,
        nodePath,
        rootTitle: data.rootTitle,
        nodeType: node.type || 'content',
      }),
    });
    const result = await res.json();
    if (result.success && result.newTitle) {
      onUpdateNode(nodeId, result.newTitle);
      return result.newTitle;
    }
    throw new Error(result.error || '重新生成失败');
  };

  /** 单节点重写按钮 */
  const handleRegenerate = async () => {
    if (!singleSelectedId) return;
    setIsRegenerating(true);
    try {
      const newTitle = await regenerateOne(singleSelectedId);
      if (newTitle) setEditText(newTitle);
    } catch (err: any) {
      alert(err.message || '请求失败');
    } finally {
      setIsRegenerating(false);
    }
  };

  /** 批量 AI 重写 */
  const handleBatchRegenerate = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsRegenerating(true);
    setBatchProgress({ done: 0, total: ids.length });

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const r = await regenerateOne(id);
        setBatchProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        return r;
      }),
    );

    const failCount = results.filter((r) => r.status === 'rejected').length;
    if (failCount > 0) {
      alert(`${ids.length - failCount} 个节点重写成功，${failCount} 个失败`);
    }

    setIsRegenerating(false);
    setBatchProgress({ done: 0, total: 0 });
  };

  const handleManualSave = () => {
    if (singleSelectedId && editText.trim()) {
      onUpdateNode(singleSelectedId, editText.trim());
    }
  };

  if (panelCollapsed) {
    return (
      <button
        onClick={() => setPanelCollapsed(false)}
        className="absolute top-3 right-3 z-20 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-medium text-[#3e3832] shadow-sm hover:bg-gray-50 flex items-center gap-1.5"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        编辑节点
      </button>
    );
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[380px] z-20 bg-white border-l border-gray-200 shadow-lg flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[#3e3832]">节点编辑</h3>
          {selectedIds.size > 1 && (
            <span className="text-xs bg-[#b20155]/10 text-[#b20155] px-1.5 py-0.5 rounded">
              已选 {selectedIds.size} 个
            </span>
          )}
        </div>
        <button
          onClick={() => setPanelCollapsed(true)}
          className="text-gray-400 hover:text-gray-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* 多选提示 */}
      <div className="px-4 py-1.5 text-[10px] text-gray-400 bg-gray-50/50 border-b border-gray-50">
        按住 Shift/Cmd 点击可多选节点
      </div>

      {/* 树形列表 */}
      <div className="flex-1 overflow-y-auto border-b border-gray-100">
        <div className="px-2 py-1.5 text-xs font-semibold text-[#3e3832] bg-gray-50">
          {data.rootTitle}
        </div>
        {data.structure.map((node) => (
          <TreeNode
            key={node.id || node.title}
            node={node}
            depth={0}
            selectedIds={selectedIds}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* 批量操作栏（多选时显示） */}
      {selectedIds.size > 1 && (
        <div className="flex-shrink-0 px-3 py-2 bg-[#b20155]/5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs text-[#3e3832]">已选择 {selectedIds.size} 个节点</span>
          <button
            onClick={handleBatchRegenerate}
            disabled={isRegenerating}
            className="text-xs px-3 py-1 rounded bg-[#b20155] text-white hover:bg-[#9a0148] disabled:opacity-50 transition-colors flex items-center gap-1"
          >
            {isRegenerating ? (
              <>
                <svg className="w-3 h-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                {batchProgress.done}/{batchProgress.total}
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
                批量 AI 重写 ({selectedIds.size}个)
              </>
            )}
          </button>
        </div>
      )}

      {/* 单节点编辑区 */}
      {singleSelectedNode && (
        <div className="flex-shrink-0 p-3 space-y-2 bg-gray-50 max-h-[45%] flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#3e3832]">
              {singleSelectedNode.type === 'explanation' ? '📝 解释节点' : '📄 正文节点'}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={handleManualSave}
                className="text-xs px-2.5 py-1 rounded bg-gray-200 text-[#3e3832] hover:bg-gray-300 transition-colors"
              >
                保存修改
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="text-xs px-2.5 py-1 rounded bg-[#b20155] text-white hover:bg-[#9a0148] disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {isRegenerating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    生成中…
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
                    AI 重新生成
                  </>
                )}
              </button>
            </div>
          </div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="flex-1 min-h-[100px] w-full text-xs leading-relaxed text-[#3e3832] border border-gray-200 rounded-md p-2 resize-none focus:outline-none focus:border-[#b20155] focus:ring-1 focus:ring-[#b20155]/20"
          />
        </div>
      )}
    </div>
  );
}
