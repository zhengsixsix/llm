'use client';

import { useEffect, useRef, useState } from 'react';

interface MindMapViewerProps {
  /** .xmind 文件的 ArrayBuffer */
  file: ArrayBuffer;
}

export default function MindMapViewer({ file }: MindMapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // 用 ref 存变换状态，避免 state 更新造成拖动卡顿
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const scaleRef = useRef(1);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });

  // 遮罩事件绑定
  useEffect(() => {
    if (status !== 'ready') return;
    const overlay = overlayRef.current;
    const inner = innerRef.current;
    if (!overlay || !inner) return;

    const onMouseDown = (e: MouseEvent) => {
      dragging.current = true;
      dragStart.current = { mx: e.clientX, my: e.clientY, tx: txRef.current, ty: tyRef.current };
      overlay.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      txRef.current = dragStart.current.tx + (e.clientX - dragStart.current.mx);
      tyRef.current = dragStart.current.ty + (e.clientY - dragStart.current.my);
      inner.style.transform = `translate(${txRef.current}px, ${tyRef.current}px) scale(${scaleRef.current})`;
    };

    const onMouseUp = () => {
      dragging.current = false;
      overlay.style.cursor = 'grab';
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.max(0.2, Math.min(5, scaleRef.current * factor));

      // 以鼠标位置为缩放中心
      const rect = overlay.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      txRef.current = cx - (cx - txRef.current) * (newScale / scaleRef.current);
      tyRef.current = cy - (cy - tyRef.current) * (newScale / scaleRef.current);
      scaleRef.current = newScale;

      inner.style.transform = `translate(${txRef.current}px, ${tyRef.current}px) scale(${scaleRef.current})`;
    };

    overlay.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    overlay.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      overlay.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      overlay.removeEventListener('wheel', onWheel);
    };
  }, [status]);

  // 文件切换时重置变换
  useEffect(() => {
    txRef.current = 0;
    tyRef.current = 0;
    scaleRef.current = 1;
    if (innerRef.current) innerRef.current.style.transform = '';
  }, [file]);

  // XMind viewer 初始化
  useEffect(() => {
    if (!containerRef.current || !file) return;

    const container = containerRef.current;
    while (container.firstChild) container.removeChild(container.firstChild);
    setStatus('loading');

    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) setStatus('error'); }, 30000);

    import('xmind-embed-viewer').then(({ XMindEmbedViewer }) => {
      if (cancelled || !containerRef.current) return;

      const viewer = new XMindEmbedViewer({
        el: containerRef.current,
        region: 'cn',
        file: file.slice(0),
        isPitchModeDisabled: true,
        styles: { height: '100%', width: '100%', border: 'none' },
      });

      viewerRef.current = viewer;

      viewer.addEventListener('sheets-load', () => {
        if (!cancelled) {
          clearTimeout(timeout);
          setStatus('ready');
          viewer.setFitMap();
        }
      });
    }).catch(() => { if (!cancelled) setStatus('error'); });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      viewerRef.current = null;
    };
  }, [file]);

  return (
    <div className="h-full w-full relative" style={{ overflow: 'hidden' }}>
      {/* XMind 内容层 */}
      <div
        ref={innerRef}
        style={{ width: '100%', height: '100%', transformOrigin: '0 0' }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '500px' }} />
      </div>

      {/* 透明遮罩：加载完成后覆盖，接管拖拽和滚轮 */}
      {status === 'ready' && (
        <div
          ref={overlayRef}
          style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'grab' }}
        />
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-20">
          <svg className="w-8 h-8 animate-spin text-[#b20155]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-3 text-sm text-[#3e3832] opacity-60">正在加载 XMind 预览…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-20">
          <p className="text-sm text-red-500">XMind 预览加载失败</p>
          <p className="text-xs text-[#3e3832] opacity-50 mt-1">请检查网络连接，或直接下载文件查看</p>
        </div>
      )}
    </div>
  );
}
