'use client';

import { useEffect, useRef, useState } from 'react';

interface MindMapViewerProps {
  /** .xmind 文件的 ArrayBuffer */
  file: ArrayBuffer;
}

export default function MindMapViewer({ file }: MindMapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!containerRef.current || !file) return;

    // 清空上一次渲染的 iframe
    const container = containerRef.current;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    setStatus('loading');

    let cancelled = false;

    // 超时检测：30s 没加载出来就报错
    const timeout = setTimeout(() => {
      if (!cancelled) setStatus('error');
    }, 30000);

    import('xmind-embed-viewer').then(({ XMindEmbedViewer }) => {
      if (cancelled || !containerRef.current) return;

      // 拷贝 ArrayBuffer，避免 React state proxy 导致 postMessage DataCloneError
      const fileCopy = file.slice(0);

      const viewer = new XMindEmbedViewer({
        el: containerRef.current,
        region: 'cn',
        file: fileCopy,
        isPitchModeDisabled: true,
        styles: {
          height: '100%',
          width: '100%',
          border: 'none',
        },
      });

      viewerRef.current = viewer;

      viewer.addEventListener('sheets-load', () => {
        if (!cancelled) {
          clearTimeout(timeout);
          setStatus('ready');
          viewer.setFitMap();
        }
      });
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      viewerRef.current = null;
    };
  }, [file]);

  return (
    <div className="h-full w-full relative">
      {/* iframe 容器 */}
      <div className="h-full w-full" ref={containerRef} />

      {/* 加载中遮罩 */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10">
          <svg className="w-8 h-8 animate-spin text-[#b20155]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-3 text-sm text-[#3e3832] opacity-60">正在加载 XMind 预览…</p>
        </div>
      )}

      {/* 加载失败 */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-10">
          <p className="text-sm text-red-500">XMind 预览加载失败</p>
          <p className="text-xs text-[#3e3832] opacity-50 mt-1">请检查网络连接，或直接下载文件查看</p>
        </div>
      )}
    </div>
  );
}
