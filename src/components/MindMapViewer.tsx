'use client';

import { useEffect, useRef } from 'react';
import G6 from '@antv/g6';
import { MindMapData, MindMapNode } from '@/types/mindmap';

interface MindMapViewerProps {
  data: MindMapData;
}

function convertToTreeData(node: MindMapNode): any {
  const treeNode: any = {
    id: Math.random().toString(36).substr(2, 9),
    label: node.title.length > 60 ? node.title.substring(0, 60) + '...' : node.title,
  };

  if (node.imageUrl) {
    treeNode.img = node.imageUrl;
  }

  if (node.children && node.children.length > 0) {
    treeNode.children = node.children.map(child => convertToTreeData(child));
  }

  return treeNode;
}

export default function MindMapViewer({ data }: MindMapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.offsetWidth;
    const height = containerRef.current.offsetHeight || 600;

    // 注册自定义节点支持图片和自适应文本
    G6.registerNode('image-node', {
      draw(cfg: any, group: any) {
        const hasImage = !!cfg.img;
        const label = cfg.label || '';
        const fontSize = 12;
        const padding = 10;
        const imageWidth = hasImage ? 70 : 0;

        // 计算文本宽度
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = `${fontSize}px sans-serif`;
          const textWidth = ctx.measureText(label).width;
          const nodeWidth = Math.max(150, textWidth + imageWidth + padding * 2);
          const nodeHeight = hasImage ? 80 : 50;

          const rect = group.addShape('rect', {
            attrs: {
              x: 0,
              y: 0,
              width: nodeWidth,
              height: nodeHeight,
              fill: '#ffffff',
              stroke: '#b20155',
              lineWidth: 2,
              radius: 5,
            },
          });

          if (hasImage) {
            group.addShape('image', {
              attrs: {
                x: 5,
                y: 10,
                width: 60,
                height: 60,
                img: cfg.img,
              },
            });
          }

          const textX = hasImage ? 70 : padding;
          group.addShape('text', {
            attrs: {
              text: label,
              x: textX,
              y: nodeHeight / 2,
              textAlign: 'left',
              textBaseline: 'middle',
              fill: '#3e3832',
              fontSize,
              fontWeight: 500,
            },
          });

          return rect;
        }
      },
    }, 'single-node');

    const treeData = {
      id: 'root',
      label: data.rootTitle,
      children: data.structure.map(node => convertToTreeData(node))
    };

    if (graphRef.current) {
      graphRef.current.destroy();
    }

    const graph = new G6.TreeGraph({
      container: containerRef.current,
      width,
      height,
      modes: {
        default: ['drag-canvas', 'zoom-canvas'],
      },
      defaultNode: {
        type: 'image-node',
      },
      defaultEdge: {
        type: 'cubic-horizontal',
        style: {
          stroke: '#b20155',
          lineWidth: 2,
        },
      },
      layout: {
        type: 'mindmap',
        direction: 'H',
        getHeight: (node: any) => node.img ? 80 : 50,
        getWidth: () => 200,
        getVGap: () => 20,
        getHGap: () => 150,
      },
    });

    graph.data(treeData);
    graph.render();
    graph.fitView();

    graphRef.current = graph;

    return () => {
      if (graphRef.current) {
        graphRef.current.destroy();
      }
    };
  }, [data]);

  return (
    <div className="h-full flex flex-col bg-white">
      <div ref={containerRef} className="flex-1" />

      {data.relationships && data.relationships.length > 0 && (
        <div className="border-t p-4 bg-gray-50 max-h-40 overflow-y-auto">
          <h3 className="text-sm font-semibold text-[#3e3832] mb-2">关联线 ({data.relationships.length})</h3>
          <div className="space-y-1">
            {data.relationships.map((rel, idx) => (
              <div key={idx} className="text-xs text-gray-600 flex items-center gap-2">
                <span className="font-medium truncate max-w-[200px]">{rel.end1Title}</span>
                <span>→</span>
                <span className="font-medium truncate max-w-[200px]">{rel.end2Title}</span>
                {rel.title && <span className="text-[#b20155]">({rel.title})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
