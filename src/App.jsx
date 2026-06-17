import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import heic2any from "heic2any";
import {
  ArrowRight,
  RotateCcw,
  RotateCw,
  Copy,
  Download,
  Trash2,
  Pencil,
  Settings2,
  Type,
  UploadCloud,
  Layers,
  FileType,
  FileText,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Undo,
  Paintbrush,
  MousePointer,
  Square,
  Circle
} from "lucide-react";

import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// PDF.js Worker Configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Image Editor Component
const ImageEditor = ({ file, onSave, onClose }) => {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState("select"); // "select" | "brush" | "rect" | "circle" | "text"
  const [color, setColor] = useState("#000000"); // Black by default
  const [brushSize, setBrushSize] = useState(25);
  const [fontSize, setFontSize] = useState(40);
  const [useTextBg, setUseTextBg] = useState(true);
  const [shapeStyle, setShapeStyle] = useState("fill"); // "fill" | "stroke"
  
  const [elements, setElements] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory] = useState([]);
  
  const [textInput, setTextInput] = useState("");
  const [textPos, setTextPos] = useState(null);
  const textInputRef = useRef(null);

  const imgRef = useRef(null);
  const isLoaded = useRef(false);

  // Drag states
  const isMouseDown = useRef(false);
  const isDraggingElement = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const elementStartPos = useRef(null); // original pos of the moving element

  // Shape drawing states
  const isDrawingShape = useRef(false);
  const activeShapeId = useRef(null);

  // Initialize background image
  useEffect(() => {
    const img = new Image();
    img.src = file.originalSrc;
    img.onload = () => {
      imgRef.current = img;
      isLoaded.current = true;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        drawAll();
      }
    };
  }, [file]);

  // Focus text input
  useEffect(() => {
    if (textPos && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [textPos]);

  // Redraw when elements or selection changes
  useEffect(() => {
    if (isLoaded.current) {
      drawAll();
    }
  }, [elements, selectedId, tool]);

  const getCanvasCoords = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const drawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext("2d");
    
    // Clear and draw background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0);

    // Draw all elements
    elements.forEach((el) => {
      ctx.save();
      if (el.type === "brush") {
        if (el.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            ctx.lineTo(el.points[i].x, el.points[i].y);
          }
          ctx.strokeStyle = el.color;
          ctx.lineWidth = el.brushSize;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
        }
      } else if (el.type === "rect") {
        if (el.fillMode === "stroke") {
          ctx.strokeStyle = el.color;
          ctx.lineWidth = el.brushSize || 5;
          ctx.strokeRect(el.x, el.y, el.w, el.h);
        } else {
          ctx.fillStyle = el.color;
          ctx.fillRect(el.x, el.y, el.w, el.h);
        }
      } else if (el.type === "circle") {
        ctx.beginPath();
        ctx.arc(el.x, el.y, el.r, 0, Math.PI * 2);
        if (el.fillMode === "stroke") {
          ctx.strokeStyle = el.color;
          ctx.lineWidth = el.brushSize || 5;
          ctx.stroke();
        } else {
          ctx.fillStyle = el.color;
          ctx.fill();
        }
      } else if (el.type === "text") {
        ctx.font = `bold ${el.fontSize}px "Inter", "Noto Sans JP", sans-serif`;
        ctx.textBaseline = "middle";
        const w = ctx.measureText(el.text).width;
        const p = el.fontSize * 0.2;

        if (el.useBg) {
          ctx.fillStyle = el.color === "#ffffff" ? "#000000" : "#ffffff";
          ctx.fillRect(
            el.x - p,
            el.y - el.fontSize / 2 - p,
            w + p * 2,
            el.fontSize + p * 2
          );
        }
        ctx.fillStyle = el.color;
        ctx.fillText(el.text, el.x, el.y);
      }

      // Selection indicator (draw dashed border around selected element)
      if (selectedId === el.id && tool === "select") {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = Math.max(3, canvas.width * 0.002);
        ctx.setLineDash([6, 6]);
        
        if (el.type === "text") {
          ctx.font = `bold ${el.fontSize}px "Inter", "Noto Sans JP", sans-serif`;
          const w = ctx.measureText(el.text).width;
          const p = el.fontSize * 0.2;
          ctx.strokeRect(
            el.x - p - 4,
            el.y - el.fontSize / 2 - p - 4,
            w + p * 2 + 8,
            el.fontSize + p * 2 + 8
          );
        } else if (el.type === "rect") {
          const padding = 6;
          const xMin = Math.min(el.x, el.x + el.w);
          const xMax = Math.max(el.x, el.x + el.w);
          const yMin = Math.min(el.y, el.y + el.h);
          const yMax = Math.max(el.y, el.y + el.h);
          ctx.strokeRect(
            xMin - padding,
            yMin - padding,
            (xMax - xMin) + padding * 2,
            (yMax - yMin) + padding * 2
          );
        } else if (el.type === "circle") {
          ctx.beginPath();
          ctx.arc(el.x, el.y, el.r + 6, 0, Math.PI * 2);
          ctx.stroke();
        } else if (el.type === "brush") {
          const xs = el.points.map((p) => p.x);
          const ys = el.points.map((p) => p.y);
          const xMin = Math.min(...xs) - el.brushSize / 2 - 4;
          const xMax = Math.max(...xs) + el.brushSize / 2 + 4;
          const yMin = Math.min(...ys) - el.brushSize / 2 - 4;
          const yMax = Math.max(...ys) + el.brushSize / 2 + 4;
          ctx.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
        }
      }
      ctx.restore();
    });
  };

  const detectHitElement = (canvasPos) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");

    // Hit test from top (last drawn element first)
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.type === "text") {
        ctx.font = `bold ${el.fontSize}px "Inter", "Noto Sans JP", sans-serif`;
        const w = ctx.measureText(el.text).width;
        const p = el.fontSize * 0.2;
        if (
          canvasPos.x >= el.x - p &&
          canvasPos.x <= el.x + w + p &&
          canvasPos.y >= el.y - el.fontSize / 2 - p &&
          canvasPos.y <= el.y + el.fontSize / 2 + p
        ) {
          return el;
        }
      } else if (el.type === "rect") {
        const xMin = Math.min(el.x, el.x + el.w);
        const xMax = Math.max(el.x, el.x + el.w);
        const yMin = Math.min(el.y, el.y + el.h);
        const yMax = Math.max(el.y, el.y + el.h);
        if (
          canvasPos.x >= xMin &&
          canvasPos.x <= xMax &&
          canvasPos.y >= yMin &&
          canvasPos.y <= yMax
        ) {
          return el;
        }
      } else if (el.type === "circle") {
        const dist = Math.sqrt((canvasPos.x - el.x) ** 2 + (canvasPos.y - el.y) ** 2);
        if (dist <= el.r) {
          return el;
        }
      } else if (el.type === "brush") {
        const threshold = el.brushSize / 2 + 10;
        const isHit = el.points.some(
          (p) => Math.sqrt((canvasPos.x - p.x) ** 2 + (canvasPos.y - p.y) ** 2) <= threshold
        );
        if (isHit) {
          return el;
        }
      }
    }
    return null;
  };

  const handleStart = (clientX, clientY) => {
    isMouseDown.current = true;
    const pos = getCanvasCoords(clientX, clientY);

    if (tool === "select") {
      const hit = detectHitElement(pos);
      if (hit) {
        setSelectedId(hit.id);
        isDraggingElement.current = true;
        dragStartPos.current = pos;
        if (hit.type === "brush") {
          elementStartPos.current = hit.points.map((p) => ({ ...p }));
        } else {
          elementStartPos.current = { x: hit.x, y: hit.y };
        }
      } else {
        setSelectedId(null);
      }
    } else if (tool === "brush") {
      setHistory((prev) => [...prev, elements]);
      const newEl = {
        id: Math.random().toString(36).substr(2, 9),
        type: "brush",
        points: [pos],
        color: color,
        brushSize: brushSize
      };
      setElements((prev) => [...prev, newEl]);
      activeShapeId.current = newEl.id;
    } else if (tool === "rect") {
      setHistory((prev) => [...prev, elements]);
      const newEl = {
        id: Math.random().toString(36).substr(2, 9),
        type: "rect",
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
        color: color,
        fillMode: shapeStyle,
        brushSize: brushSize
      };
      setElements((prev) => [...prev, newEl]);
      activeShapeId.current = newEl.id;
      isDrawingShape.current = true;
      dragStartPos.current = pos;
    } else if (tool === "circle") {
      setHistory((prev) => [...prev, elements]);
      const newEl = {
        id: Math.random().toString(36).substr(2, 9),
        type: "circle",
        x: pos.x,
        y: pos.y,
        r: 0,
        color: color,
        fillMode: shapeStyle,
        brushSize: brushSize
      };
      setElements((prev) => [...prev, newEl]);
      activeShapeId.current = newEl.id;
      isDrawingShape.current = true;
      dragStartPos.current = pos;
    }
  };

  const handleMove = (clientX, clientY) => {
    if (!isMouseDown.current) return;
    const pos = getCanvasCoords(clientX, clientY);

    if (tool === "select" && isDraggingElement.current && selectedId) {
      const dx = pos.x - dragStartPos.current.x;
      const dy = pos.y - dragStartPos.current.y;

      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== selectedId) return el;
          if (el.type === "brush") {
            const startPoints = elementStartPos.current;
            return {
              ...el,
              points: el.points.map((p, idx) => ({
                x: startPoints[idx].x + dx,
                y: startPoints[idx].y + dy
              }))
            };
          } else {
            const start = elementStartPos.current;
            return {
              ...el,
              x: start.x + dx,
              y: start.y + dy
            };
          }
        })
      );
    } else if (tool === "brush" && activeShapeId.current) {
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== activeShapeId.current) return el;
          return {
            ...el,
            points: [...el.points, pos]
          };
        })
      );
    } else if (tool === "rect" && isDrawingShape.current && activeShapeId.current) {
      const start = dragStartPos.current;
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== activeShapeId.current) return el;
          return {
            ...el,
            w: pos.x - start.x,
            h: pos.y - start.y
          };
        })
      );
    } else if (tool === "circle" && isDrawingShape.current && activeShapeId.current) {
      const start = dragStartPos.current;
      const r = Math.sqrt((pos.x - start.x) ** 2 + (pos.y - start.y) ** 2);
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== activeShapeId.current) return el;
          return {
            ...el,
            r: r
          };
        })
      );
    }
  };

  const handleEnd = () => {
    isMouseDown.current = false;
    isDraggingElement.current = false;
    isDrawingShape.current = false;
    activeShapeId.current = null;
  };

  const handleCanvasClick = (e) => {
    if (tool !== "text" || textPos) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTextPos({ x, y });
    setTextInput("");
  };

  const submitText = () => {
    if (!textInput.trim() || !textPos) {
      setTextPos(null);
      return;
    }

    setHistory((prev) => [...prev, elements]);
    const canvas = canvasRef.current;
    const canvasPos = getCanvasCoords(
      textPos.x + canvas.getBoundingClientRect().left,
      textPos.y + canvas.getBoundingClientRect().top
    );

    const newEl = {
      id: Math.random().toString(36).substr(2, 9),
      type: "text",
      text: textInput,
      x: canvasPos.x,
      y: canvasPos.y,
      fontSize: fontSize,
      color: color,
      useBg: useTextBg
    };

    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
    setTool("select"); // Automatically switch to select tool to allow dragging

    setTextPos(null);
    setTextInput("");
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prevElements = history[history.length - 1];
    setElements(prevElements);
    setHistory((prev) => prev.slice(0, -1));
    setSelectedId(null);
  };

  const deleteSelectedElement = () => {
    if (!selectedId) return;
    setHistory((prev) => [...prev, elements]);
    setElements((prev) => prev.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  };

  const updateSelectedShapeStyle = (mode) => {
    if (!selectedId) return;
    setHistory((prev) => [...prev, elements]);
    setElements((prev) =>
      prev.map((el) =>
        el.id === selectedId ? { ...el, fillMode: mode } : el
      )
    );
  };

  const updateSelectedShapeThickness = (thickness) => {
    if (!selectedId) return;
    setElements((prev) =>
      prev.map((el) =>
        el.id === selectedId ? { ...el, brushSize: thickness } : el
      )
    );
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Deselect before exporting to avoid drawing blue outline
    setSelectedId(null);
    
    // We defer slightly to allow state and render to complete without the selection border
    setTimeout(() => {
      const dataUrl = canvas.toDataURL("image/png", 1.0);
      onSave(dataUrl);
    }, 50);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90 text-white">
      {/* Editor Header */}
      <div className="h-16 bg-gray-900 border-b border-gray-800 px-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Pencil className="w-5 h-5 text-orange-500" />
          <span className="font-bold text-sm sm:text-base truncate max-w-[200px] sm:max-w-md">
            {file.name} を編集
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className="flex items-center space-x-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            <Undo className="w-4 h-4" />
            <span className="hidden sm:inline">元に戻す</span>
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-1 bg-orange-600 hover:bg-orange-500 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>確定して保存</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-grow flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar Controls */}
        <div className="w-full md:w-80 bg-gray-900 border-r border-gray-800 p-5 space-y-6 shrink-0 overflow-y-auto">
          {/* Tool Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              編集ツール
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setTool("select");
                  setTextPos(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2 rounded-lg border transition-all ${
                  tool === "select"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <MousePointer className="w-4 h-4" />
                <span className="text-sm font-medium">選択・移動</span>
              </button>
              <button
                onClick={() => {
                  setTool("brush");
                  setTextPos(null);
                  setSelectedId(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2 rounded-lg border transition-all ${
                  tool === "brush"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Paintbrush className="w-4 h-4" />
                <span className="text-sm font-medium">墨消しペン</span>
              </button>
              <button
                onClick={() => {
                  setTool("rect");
                  setTextPos(null);
                  setSelectedId(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2 rounded-lg border transition-all ${
                  tool === "rect"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Square className="w-4 h-4" />
                <span className="text-sm font-medium">四角(□)</span>
              </button>
              <button
                onClick={() => {
                  setTool("circle");
                  setTextPos(null);
                  setSelectedId(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2 rounded-lg border transition-all ${
                  tool === "circle"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Circle className="w-4 h-4" />
                <span className="text-sm font-medium">丸(○)</span>
              </button>
              <button
                onClick={() => {
                  setTool("text");
                  setTextPos(null);
                  setSelectedId(null);
                }}
                className={`col-span-2 flex items-center justify-center space-x-2 py-2 rounded-lg border transition-all ${
                  tool === "text"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Type className="w-4 h-4" />
                <span className="text-sm font-medium">文字入れ</span>
              </button>
            </div>
          </div>

          {/* Delete selected element */}
          {selectedId && tool === "select" && (
            <div className="space-y-1 animate-fadeIn">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                要素の操作
              </label>
              <button
                onClick={deleteSelectedElement}
                className="w-full flex items-center justify-center space-x-2 bg-red-950 border border-red-700 hover:bg-red-900 text-red-200 py-2.5 rounded-lg text-sm font-medium transition-all"
              >
                <Trash2 className="w-4 h-4" />
                <span>選択中の要素を削除</span>
              </button>
            </div>
          )}

          {/* Selected shape style controls */}
          {selectedId && tool === "select" && (() => {
            const el = elements.find(e => e.id === selectedId);
            if (el && (el.type === "rect" || el.type === "circle")) {
              return (
                <div className="space-y-4 p-4 bg-gray-850 rounded-xl border border-gray-800 animate-fadeIn">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      図形スタイル (選択中)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => updateSelectedShapeStyle("fill")}
                        className={`py-1.5 rounded text-xs font-medium border ${
                          el.fillMode !== "stroke"
                            ? "bg-orange-600 border-orange-500 text-white"
                            : "bg-gray-800 border-gray-755 text-gray-300 hover:bg-gray-700"
                        }`}
                      >
                        塗りつぶし
                      </button>
                      <button
                        onClick={() => updateSelectedShapeStyle("stroke")}
                        className={`py-1.5 rounded text-xs font-medium border ${
                          el.fillMode === "stroke"
                            ? "bg-orange-600 border-orange-500 text-white"
                            : "bg-gray-800 border-gray-755 text-gray-300 hover:bg-gray-700"
                        }`}
                      >
                        枠線のみ
                      </button>
                    </div>
                  </div>

                  {el.fillMode === "stroke" && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">枠線の太さ</span>
                        <span className="text-orange-500 font-bold">{el.brushSize}px</span>
                      </div>
                      <input
                        type="range"
                        min="2"
                        max="50"
                        value={el.brushSize || 5}
                        onChange={(e) => updateSelectedShapeThickness(parseInt(e.target.value))}
                        className="w-full h-1 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })()}

          {/* Color Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              カラー選択
            </label>
            <div className="flex items-center space-x-3">
              {[
                { name: "黒 (墨消し用)", hex: "#000000" },
                { name: "白 (白消し用)", hex: "#ffffff" },
                { name: "赤 (強調用)", hex: "#ff0000" },
                { name: "青", hex: "#0000ff" }
              ].map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setColor(c.hex)}
                  title={c.name}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    color === c.hex
                      ? "border-orange-500 scale-110 ring-2 ring-orange-500/20"
                      : "border-gray-750 hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* New shape style selector */}
          {(tool === "rect" || tool === "circle") && (
            <div className="space-y-2 animate-fadeIn">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                図形スタイル設定
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShapeStyle("fill")}
                  className={`py-2 rounded-lg text-sm font-medium border transition-all ${
                    shapeStyle === "fill"
                      ? "bg-gray-700 border-gray-650 text-white"
                      : "bg-gray-800 border-gray-755 text-gray-300 hover:bg-gray-750"
                  }`}
                >
                  塗りつぶし
                </button>
                <button
                  onClick={() => setShapeStyle("stroke")}
                  className={`py-2 rounded-lg text-sm font-medium border transition-all ${
                    shapeStyle === "stroke"
                      ? "bg-gray-700 border-gray-650 text-white"
                      : "bg-gray-800 border-gray-755 text-gray-300 hover:bg-gray-750"
                  }`}
                >
                  枠線のみ
                </button>
              </div>
            </div>
          )}

          {/* Tool specific settings */}
          {(tool === "brush" || ((tool === "rect" || tool === "circle") && shapeStyle === "stroke")) && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {tool === "brush" ? "ブラシサイズ" : "線の太さ"}
                </label>
                <span className="text-orange-500 font-bold">{brushSize}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="100"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          {tool === "text" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    文字サイズ
                  </label>
                  <span className="text-orange-500 font-bold">{fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="12"
                  max="200"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="textBg"
                  checked={useTextBg}
                  onChange={(e) => setUseTextBg(e.target.checked)}
                  className="w-4 h-4 text-orange-600 bg-gray-800 border-gray-700 rounded focus:ring-orange-500 focus:ring-offset-gray-900"
                />
                <label
                  htmlFor="textBg"
                  className="text-sm font-medium text-gray-300 select-none cursor-pointer"
                >
                  文字背景を塗りつぶす (座布団)
                </label>
              </div>
            </div>
          )}

          {/* Guide Message */}
          <div className="p-4 bg-gray-850 rounded-xl border border-gray-800/80 text-xs text-gray-400 leading-relaxed">
            {tool === "select" && (
              <p>
                「選択・移動」ツールです。配置済みのテキスト、四角、丸、ペンの線を直接クリックすると選択でき、そのままドラッグして自由に移動させることができます。削除も可能です。
              </p>
            )}
            {tool === "brush" && (
              <p>
                画像上をなぞると、選択した色で塗りつぶせます。文字消しや手書きマーカーにお使いください。
              </p>
            )}
            {tool === "rect" && (
              <p>
                画像上をドラッグすると、指定した色で「四角形」を描画します。広範囲の文字を一括で墨消しするのに便利です。
              </p>
            )}
            {tool === "circle" && (
              <p>
                画像上をドラッグすると、指定した色で「円（丸）」を描画します。チェックマークや強調マークに便利です。
              </p>
            )}
            {tool === "text" && (
              <p>
                文字を入れたい部分をクリックしてください。入力後、自動的に「選択ツール」に切り替わるため、ドラッグして微調整できます。
              </p>
            )}
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-grow relative overflow-auto p-6 flex items-center justify-center min-h-[300px]">
          <div className="relative inline-block max-w-full">
            <canvas
              ref={canvasRef}
              onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
              onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={(e) => {
                if (e.touches.length > 0) handleStart(e.touches[0].clientX, e.touches[0].clientY);
              }}
              onTouchMove={(e) => {
                if (e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY);
              }}
              onTouchEnd={handleEnd}
              onClick={handleCanvasClick}
              className={`max-h-[70vh] object-contain shadow-2xl bg-white border border-gray-850 ${
                tool === "select" ? "cursor-default" : tool === "text" ? "cursor-text" : "cursor-crosshair"
              }`}
            />

            {/* Inline Text Input Overlay */}
            {textPos && (
              <div
                className="absolute z-20 flex flex-col bg-gray-900/95 border border-orange-500/80 p-2.5 rounded-lg shadow-xl"
                style={{
                  left: `${textPos.x}px`,
                  top: `${textPos.y}px`
                }}
              >
                <input
                  ref={textInputRef}
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitText();
                    if (e.key === "Escape") setTextPos(null);
                  }}
                  placeholder="テキストを入力"
                  className="bg-gray-800 text-white border border-gray-700 rounded px-2.5 py-1 text-sm focus:outline-none focus:border-orange-500 w-48 sm:w-64"
                />
                <div className="flex justify-end space-x-1.5 mt-2">
                  <button
                    onClick={() => setTextPos(null)}
                    className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-xs rounded transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={submitText}
                    className="px-2.5 py-1 bg-orange-600 hover:bg-orange-500 text-xs font-semibold rounded transition-colors"
                  >
                    追加
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [logs, setLogs] = useState([]);
  const addLog = (msg) =>
    setLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 49)
    ]);

  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [editingFile, setEditingFile] = useState(null);

  // Settings
  const [targetFormat, setTargetFormat] = useState("image/png");
  const [maxWidth, setMaxWidth] = useState("");
  const [maxHeight, setMaxHeight] = useState("");
  const [quality, setQuality] = useState(0.9);
  const [pdfPageRange, setPdfPageRange] = useState("");

  // Rename Settings
  const [renamePrefix, setRenamePrefix] = useState("");
  const [renameSuffix, setRenameSuffix] = useState("");
  const [renameBase, setRenameBase] = useState("");
  const [renameStartNum, setRenameStartNum] = useState(1);
  const [renameDigits, setRenameDigits] = useState(3);

  const applyBulkRename = () => {
    if (files.length === 0) return;

    const newFiles = files.map((file, index) => {
      const ext = file.type === "image/png" ? ".png" : ".jpg";
      let baseName;

      if (renameBase.trim()) {
        const num = renameStartNum + index;
        const paddedNum = String(num).padStart(renameDigits, "0");
        baseName = `${renameBase}${paddedNum}`;
      } else {
        baseName = file.originalName.replace(/\.[^/.]+$/, "");
      }

      const newName = `${renamePrefix}${baseName}${renameSuffix}${ext}`;

      return {
        ...file,
        name: newName,
        userRenamed: true
      };
    });

    setFiles(newFiles);
    addLog(`Renamed ${newFiles.length} files`);
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    await processFiles(droppedFiles);
  };

  const handleFileSelect = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    addLog(`Files selected: ${selectedFiles.length}`);
    await processFiles(selectedFiles);
  };

  const parsePageRange = (rangeStr) => {
    if (!rangeStr.trim()) return null;
    const pages = new Set();
    const parts = rangeStr.split(",");

    parts.forEach((part) => {
      const range = part.trim().split("-");
      if (range.length === 2) {
        const start = parseInt(range[0]);
        const end = parseInt(range[1]);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) pages.add(i);
        }
      } else {
        const page = parseInt(part);
        if (!isNaN(page)) pages.add(page);
      }
    });
    return pages;
  };

  const resizeImage = (
    dataUrl,
    widthLimit,
    heightLimit,
    currentQuality,
    targetType
  ) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (
          (widthLimit && !isNaN(widthLimit)) ||
          (heightLimit && !isNaN(heightLimit))
        ) {
          const ratio = width / height;
          let newWidth = width;
          let newHeight = height;

          let targetW = widthLimit ? parseInt(widthLimit) : null;
          let targetH = heightLimit ? parseInt(heightLimit) : null;

          if (targetW && !targetH) {
            if (width > targetW) {
              newWidth = targetW;
              newHeight = Math.round(newWidth / ratio);
            }
          } else if (!targetW && targetH) {
            if (height > targetH) {
              newHeight = targetH;
              newWidth = Math.round(newHeight * ratio);
            }
          } else if (targetW && targetH) {
            if (width > targetW || height > targetH) {
              let scale = targetW / width;
              if (height * scale > targetH) {
                scale = targetH / height;
              }
              newWidth = Math.round(width * scale);
              newHeight = Math.round(height * scale);
            }
          }

          width = newWidth;
          height = newHeight;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        try {
          const data = canvas.toDataURL(
            targetType,
            parseFloat(currentQuality)
          );
          resolve(data);
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    });
  };

  const rotateImage = async (id, direction) => {
    const fileIndex = files.findIndex((f) => f.id === id);
    if (fileIndex === -1) return;

    const file = files[fileIndex];
    const angle = direction === "left" ? -90 : 90;

    const img = new Image();
    img.src = file.originalSrc;
    await new Promise((r) => (img.onload = r));

    const canvas = document.createElement("canvas");
    canvas.width = img.height;
    canvas.height = img.width;

    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    const newOriginalSrc = canvas.toDataURL("image/png", 1.0);
    addLog(`Rotating image: ${id}`);

    const newDisplaySrc = await resizeImage(
      newOriginalSrc,
      maxWidth,
      maxHeight,
      quality,
      targetFormat === "application/pdf" ? "image/jpeg" : targetFormat
    );

    const newFiles = [...files];
    newFiles[fileIndex] = {
      ...file,
      originalSrc: newOriginalSrc,
      src: newDisplaySrc,
      size: Math.round((newDisplaySrc.length * 3) / 4)
    };
    setFiles(newFiles);
  };

  // Move files (Reordering)
  const moveFile = (index, direction) => {
    const newFiles = [...files];
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newFiles.length) return;

    const temp = newFiles[index];
    newFiles[index] = newFiles[targetIndex];
    newFiles[targetIndex] = temp;
    setFiles(newFiles);
  };

  const copyToClipboard = async (file) => {
    try {
      const response = await fetch(file.src);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      alert("クリップボードにコピーしました！ (Ctrl+Vで貼り付け)");
    } catch (err) {
      console.error(err);
      alert("コピーに失敗しました。ブラウザが対応していない可能性があります。");
    }
  };

  const updateFileName = (id, newName) => {
    setFiles((prevFiles) =>
      prevFiles.map((f) =>
        f.id === id ? { ...f, name: newName, userRenamed: true } : f
      )
    );
  };

  // Re-process all files when settings change
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (files.length === 0) return;

      const newFiles = [...files];
      let changed = false;

      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const newSrc = await resizeImage(
          file.originalSrc,
          maxWidth,
          maxHeight,
          quality,
          targetFormat === "application/pdf" ? "image/jpeg" : targetFormat
        );
        const newSize = Math.round((newSrc.length * 3) / 4);

        const newType = targetFormat;
        const ext = targetFormat === "image/png" ? ".png" : ".jpg";
        const newName = file.userRenamed
          ? file.name
          : file.name.replace(/\.[^/.]+$/, "") + ext;

        if (file.src !== newSrc || file.type !== newType) {
          newFiles[i] = {
            ...file,
            src: newSrc,
            size: newSize,
            type: newType,
            name: newName
          };
          changed = true;
        }
      }

      if (changed) {
        setFiles(newFiles);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [maxWidth, maxHeight, quality, targetFormat]);

  const processFiles = async (fileList) => {
    setIsProcessing(true);
    setProcessStatus("ファイルを読み込んでいます...");
    addLog(`Processing ${fileList.length} files...`);

    const newProcessedFiles = [];

    for (const file of fileList) {
      try {
        let processedItems = [];
        const isHeic =
          file.name.toLowerCase().endsWith(".heic") ||
          file.type === "image/heic";

        if (file.type === "application/pdf") {
          setProcessStatus(`PDFを変換中: ${file.name}`);
          processedItems = await convertPdfToImages(file);
        } else if (isHeic) {
          setProcessStatus(`iPhone画像(HEIC)を変換中: ${file.name}`);
          const convertedBlob = await heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 1.0
          });

          const convertedFile = new File(
            [Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob],
            file.name.replace(/\.heic$/i, ".jpg"),
            { type: "image/jpeg" }
          );
          convertedFile.originalSize = file.size;

          const item = await processImage(convertedFile, true);
          processedItems = [item];
        } else if (file.type.startsWith("image/")) {
          setProcessStatus(`画像を処理中: ${file.name}`);
          const item = await processImage(file);
          processedItems = [item];
        }

        // Apply settings immediately
        for (let i = 0; i < processedItems.length; i++) {
          const resizedDataUrl = await resizeImage(
            processedItems[i].originalSrc,
            maxWidth,
            maxHeight,
            quality,
            targetFormat === "application/pdf" ? "image/jpeg" : targetFormat
          );
          processedItems[i].src = resizedDataUrl;
          processedItems[i].size = Math.round((resizedDataUrl.length * 3) / 4);

          const extMap = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "application/pdf": ".jpg"
          };
          const ext = extMap[targetFormat] || ".jpg";

          if (!processedItems[i].name.endsWith(ext)) {
            processedItems[i].name =
              processedItems[i].name.replace(/\.[^/.]+$/, "") + ext;
          }
          processedItems[i].type =
            targetFormat === "application/pdf" ? "image/jpeg" : targetFormat;
        }

        newProcessedFiles.push(...processedItems);
      } catch (error) {
        console.error("Processing Error:", error);
        alert(`エラーが発生しました: ${file.name}\n${error.message}`);
      }
    }

    setFiles((prev) => [...newProcessedFiles, ...prev]);
    setIsProcessing(false);
    setProcessStatus("");
  };

  const convertPdfToImages = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;
    const images = [];

    const targetPages = parsePageRange(pdfPageRange);

    for (let i = 1; i <= pageCount; i++) {
      if (targetPages && !targetPages.has(i)) continue;

      setProcessStatus(
        `${file.name} - ${i} / ${pageCount} ページ目を変換中...`
      );
      const page = await pdf.getPage(i);

      const scale = 2.0;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      const originalDataUrl = canvas.toDataURL("image/png", 1.0);
      const estimatedSize = Math.round((originalDataUrl.length * 3) / 4);

      images.push({
        id: generateId(),
        name: `${file.name.replace(".pdf", "")}_page_${i}.png`,
        originalName: file.name,
        originalSrc: originalDataUrl,
        src: originalDataUrl,
        type: "image/png",
        size: estimatedSize,
        originalSize: estimatedSize,
        isPdfPage: true,
        pageNumber: i
      });
    }
    return images;
  };

  const processImage = async (file, useFileOriginalSize = false) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve({
          id: generateId(),
          name: file.name,
          originalName: file.name,
          originalSrc: e.target.result,
          src: e.target.result,
          type: file.type,
          size: file.size,
          originalSize: useFileOriginalSize ? file.originalSize : file.size,
          isPdfPage: false
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (id) => {
    setFiles(files.filter((f) => f.id !== id));
  };

  const clearAll = () => {
    if (confirm("全てのファイルを削除しますか？")) {
      setFiles([]);
    }
  };

  const dataURLtoBlob = (dataurl) => {
    const arr = dataurl.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const getSafeName = (file) => {
    const ext = file.type === "image/png" ? ".png" : ".jpg";
    if (file.name.toLowerCase().endsWith(ext)) return file.name;
    return file.name.replace(/\.[^/.]+$/, "") + ext;
  };

  const downloadFile = async (file) => {
    const safeName = getSafeName(file);
    const blob = dataURLtoBlob(file.src);

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: safeName,
          types: [
            {
              description: "Image File",
              accept: {
                [file.type]: [
                  "." + file.type.split("/")[1].replace("jpeg", "jpg")
                ]
              }
            }
          ]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error(err);
          saveAs(blob, safeName);
        }
        return;
      }
    }
    saveAs(blob, safeName);
  };

  const downloadAllZip = async () => {
    if (files.length <= 1) return;

    setIsProcessing(true);
    setProcessStatus("ZIPファイルを作成中...");

    const zip = new JSZip();
    const folder = zip.folder("converted_images");

    files.forEach((file) => {
      const data = file.src.split(",")[1];
      folder.file(getSafeName(file), data, { base64: true });
    });

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `converted_files_${new Date().getTime()}.zip`);

    setIsProcessing(false);
    setProcessStatus("");
  };

  const downloadAllPdf = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setProcessStatus("PDFを作成中...");

    try {
      const doc = new jsPDF({
        orientation: "p",
        unit: "px",
        format: "a4"
      });

      doc.deletePage(1);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const img = new Image();
        img.src = file.src;
        await new Promise((r) => (img.onload = r));

        const width = img.width;
        const height = img.height;

        doc.addPage([width, height], width > height ? "l" : "p");
        let format = file.type === "image/png" ? "PNG" : "JPEG";
        doc.addImage(file.src, format, 0, 0, width, height);
      }

      doc.save(`converted_images_${new Date().getTime()}.pdf`);
    } catch (error) {
      console.error("PDF Gen Error:", error);
      alert("PDF作成に失敗しました: " + error.message);
    }

    setIsProcessing(false);
    setProcessStatus("");
  };

  const formatBytes = (bytes, decimals = 1) => {
    if (!+bytes) return "0 B";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const handleSaveEditedImage = async (dataUrl) => {
    if (!editingFile) return;
    const { id } = editingFile;
    const fileIndex = files.findIndex((f) => f.id === id);
    if (fileIndex === -1) return;

    const file = files[fileIndex];
    addLog(`Image edited and saved: ${file.name}`);

    const newDisplaySrc = await resizeImage(
      dataUrl,
      maxWidth,
      maxHeight,
      quality,
      targetFormat === "application/pdf" ? "image/jpeg" : targetFormat
    );

    const newFiles = [...files];
    newFiles[fileIndex] = {
      ...file,
      originalSrc: dataUrl, // Save new high-res base
      src: newDisplaySrc,
      size: Math.round((newDisplaySrc.length * 3) / 4)
    };
    setFiles(newFiles);
    setEditingFile(null);
  };

  return (
    <div className="min-h-screen pb-40 bg-orange-50 text-gray-800">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-orange-600 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Layers className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white hidden sm:block">
              Media Converter Pro
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="hidden md:flex items-center space-x-2 text-sm text-white bg-white/20 px-3 py-1.5 rounded-full">
              <FileType className="w-4 h-4" />
              <span>Supports: PNG, JPG, PDF, HEIC</span>
            </div>
            {files.length > 0 && (
              <div className="flex space-x-2">
                {targetFormat === "application/pdf" ? (
                  <button
                    onClick={downloadAllPdf}
                    disabled={isProcessing}
                    className="flex items-center space-x-2 bg-white hover:bg-orange-50 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                  >
                    <FileText className="w-4 h-4" />
                    <span>PDFで保存 (一括)</span>
                  </button>
                ) : (
                  <button
                    onClick={files.length === 1 ? () => downloadFile(files[0]) : downloadAllZip}
                    disabled={isProcessing}
                    className="flex items-center space-x-2 bg-white hover:bg-orange-50 text-orange-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    <span>{files.length === 1 ? "ダウンロード" : "一括ZIP"}</span>
                  </button>
                )}

                {targetFormat !== "application/pdf" && (
                  <button
                    onClick={downloadAllPdf}
                    disabled={isProcessing}
                    className="flex items-center space-x-2 bg-orange-700 hover:bg-orange-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                  >
                    <FileText className="w-4 h-4" />
                    <span>PDFで保存</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Settings Bar */}
        <div className="p-5 rounded-xl glass-panel shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-orange-200/60 pb-2 mb-2">
            <Settings2 className="w-5 h-5 text-orange-600" />
            <span className="font-semibold text-gray-700">詳細設定</span>
            <span className="text-xs text-orange-600/70 ml-2">
              ※変換前に設定してください
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Format */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-orange-800">
                出力形式
              </label>
              <select
                value={targetFormat}
                onChange={(e) => setTargetFormat(e.target.value)}
                className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5 shadow-sm"
              >
                <option value="image/png">PNG (透過・高画質)</option>
                <option value="image/jpeg">JPG (写真・軽量)</option>
                <option value="application/pdf">PDF (ドキュメント)</option>
              </select>
            </div>

            {/* Quality Slider */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <label className="text-sm font-medium text-orange-800">
                  画質 / 圧縮率
                </label>
                <span className="text-sm font-bold text-orange-600">
                  {Math.round(quality * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                className="w-full h-2 bg-orange-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-500">
                <span>低容量</span>
                <span>高画質</span>
              </div>
            </div>

            {/* Resize Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-orange-800">
                リサイズ (px)
              </label>
              <div className="flex space-x-2">
                <input
                  type="number"
                  placeholder="幅 (空欄=まま)"
                  value={maxWidth}
                  onChange={(e) => setMaxWidth(e.target.value)}
                  className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5 shadow-sm"
                />
                <span className="text-orange-300 self-center">x</span>
                <input
                  type="number"
                  placeholder="高さ (空欄=まま)"
                  value={maxHeight}
                  onChange={(e) => setMaxHeight(e.target.value)}
                  className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5 shadow-sm"
                />
              </div>
            </div>

            {/* PDF Page Range */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-orange-800">
                PDFページ指定
              </label>
              <input
                type="text"
                placeholder="例: 1, 3-5 (空欄=全頁)"
                value={pdfPageRange}
                onChange={(e) => setPdfPageRange(e.target.value)}
                className="page-input w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5 shadow-sm"
              />
            </div>
          </div>
        </div>

        {/* Rename Settings Panel */}
        {files.length > 0 && (
          <div className="p-5 rounded-xl glass-panel shadow-sm space-y-4">
            <div className="flex items-center space-x-2 border-b border-orange-200/60 pb-2 mb-2">
              <Type className="w-5 h-5 text-orange-600" />
              <span className="font-semibold text-gray-700">一括リネーム</span>
              <span className="text-xs text-orange-600/70 ml-2">※ファイル名を一括変更</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
              <div className="space-y-1">
                <label className="text-sm font-medium text-orange-800">プレフィックス</label>
                <input
                  type="text"
                  placeholder="先頭文字"
                  value={renamePrefix}
                  onChange={(e) => setRenamePrefix(e.target.value)}
                  className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 shadow-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-orange-800">ベース名 (連番用)</label>
                <input
                  type="text"
                  placeholder="例: image_"
                  value={renameBase}
                  onChange={(e) => setRenameBase(e.target.value)}
                  className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 shadow-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-orange-800">開始番号</label>
                <input
                  type="number"
                  min="0"
                  value={renameStartNum}
                  onChange={(e) => setRenameStartNum(parseInt(e.target.value) || 1)}
                  className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 shadow-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-orange-800">桁数</label>
                <select
                  value={renameDigits}
                  onChange={(e) => setRenameDigits(parseInt(e.target.value))}
                  className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 shadow-sm"
                >
                  <option value={1}>1桁</option>
                  <option value={2}>2桁</option>
                  <option value={3}>3桁</option>
                  <option value={4}>4桁</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-orange-800">サフィックス</label>
                <input
                  type="text"
                  placeholder="末尾文字"
                  value={renameSuffix}
                  onChange={(e) => setRenameSuffix(e.target.value)}
                  className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 shadow-sm"
                />
              </div>

              <div>
                <button
                  onClick={applyBulkRename}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-4 rounded-lg shadow-sm transition-colors flex items-center justify-center space-x-2"
                >
                  <Check className="w-4 h-4" />
                  <span>適用</span>
                </button>
              </div>
            </div>

            {(renamePrefix || renameSuffix || renameBase) && files.length > 0 && (
              <div className="mt-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
                <span className="text-xs text-orange-700 font-medium">プレビュー: </span>
                <span className="text-sm text-orange-900 font-mono">
                  {(() => {
                    const ext = targetFormat === "image/png" ? ".png" : ".jpg";
                    if (renameBase.trim()) {
                      const paddedNum = String(renameStartNum).padStart(renameDigits, "0");
                      return `${renamePrefix}${renameBase}${paddedNum}${renameSuffix}${ext}`;
                    } else {
                      const sampleBase = files[0]?.name.replace(/\.[^/.]+$/, "") || "filename";
                      return `${renamePrefix}${sampleBase}${renameSuffix}${ext}`;
                    }
                  })()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Drop Zone */}
        <div
          className={`drop-zone relative rounded-3xl p-10 text-center cursor-pointer border-2 border-transparent ${
            isDragging ? "active border-orange-500" : ""
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById("fileInput").click()}
        >
          <input
            type="file"
            id="fileInput"
            className="hidden"
            multiple
            accept="image/*,.pdf,.heic"
            onChange={handleFileSelect}
          />

          <div className="flex flex-col items-center justify-center space-y-4">
            <div
              className={`p-6 rounded-full bg-white/80 ring-1 ring-orange-200 shadow-2xl transition-transform duration-300 ${
                isDragging ? "scale-110" : ""
              }`}
            >
              <UploadCloud className="w-12 h-12 text-orange-500" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-gray-800">
                ファイルをここにドロップ
              </h3>
              <p className="text-orange-600 text-sm">
                または クリックして選択
              </p>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isProcessing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-orange-50/80 backdrop-blur-sm">
            <div className="bg-white p-6 rounded-2xl shadow-2xl border border-orange-200 flex flex-col items-center space-y-4">
              <div className="loader"></div>
              <p className="text-orange-600 font-medium animate-pulse">
                {processStatus}
              </p>
            </div>
          </div>
        )}

        {/* Results Grid */}
        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center space-x-2">
                <FileType className="w-5 h-5 text-orange-500" />
                <span>変換結果 ({files.length}枚)</span>
              </h2>
              <button
                onClick={clearAll}
                className="text-sm text-red-500 hover:text-red-600 flex items-center space-x-1"
              >
                <Trash2 className="w-4 h-4" />
                <span>全てクリア</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {files.map((file, index) => (
                <div
                  key={file.id}
                  className="group relative bg-white rounded-xl overflow-hidden border border-orange-200 hover:border-orange-500/50 transition-all shadow-lg hover:shadow-xl hover:shadow-orange-500/10 flex flex-col animate-fadeIn"
                >
                  {/* Image Preview & Controls */}
                  <div className="aspect-[3/2] bg-orange-100/50 relative overflow-hidden shrink-0">
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmN2VkIi8+CjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjgiIGZpbGw9IiNmZWQ3YWEiLz4KPHJlY3QgeD0iNCIgeT0iNCIgd2lkdGg9IjQiIGhlaWdodD0iNCIgZmlsbD0iI2ZlZDdhYSIvPgo8L3N2Zz4=')] opacity-50"></div>
                    <img
                      src={file.src}
                      alt={file.name}
                      className="absolute inset-0 w-full h-full object-contain p-4 transition-transform duration-500 group-hover:scale-105"
                    />

                    {/* Left/Right Reordering Controls */}
                    <div className="absolute bottom-2 left-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <button
                        onClick={() => moveFile(index, "left")}
                        disabled={index === 0}
                        className="p-1.5 bg-white/90 disabled:opacity-40 text-gray-600 rounded-full shadow-sm hover:bg-orange-500 hover:text-white transition-all border border-gray-200"
                        title="左へ移動"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveFile(index, "right")}
                        disabled={index === files.length - 1}
                        className="p-1.5 bg-white/90 disabled:opacity-40 text-gray-600 rounded-full shadow-sm hover:bg-orange-500 hover:text-white transition-all border border-gray-200"
                        title="右へ移動"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Rotation Controls */}
                    <div className="absolute top-2 left-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <button
                        onClick={() => rotateImage(file.id, "left")}
                        className="p-1.5 bg-white/90 text-gray-600 rounded-full shadow-sm hover:bg-orange-500 hover:text-white transition-all border border-gray-200"
                        title="左回転"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => rotateImage(file.id, "right")}
                        className="p-1.5 bg-white/90 text-gray-600 rounded-full shadow-sm hover:bg-orange-500 hover:text-white transition-all border border-gray-200"
                        title="右回転"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Badge */}
                    <div className="absolute top-2 right-2">
                      {file.isPdfPage ? (
                        <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm">
                          P.{file.pageNumber}
                        </span>
                      ) : (
                        <span className="bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm">
                          IMG
                        </span>
                      )}
                    </div>

                    {/* Overlay Actions */}
                    <div className="absolute inset-0 bg-white/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center space-y-2 backdrop-blur-[2px]">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => setEditingFile(file)}
                          className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg shadow-lg transform transition-transform hover:scale-105 flex items-center space-x-1"
                          title="墨消し・文字入れ"
                        >
                          <Pencil className="w-4 h-4" />
                          <span className="text-xs font-bold">編集</span>
                        </button>
                        <button
                          onClick={() => copyToClipboard(file)}
                          className="p-2 bg-green-600 hover:bg-green-500 text-white rounded-lg shadow-lg transform transition-transform hover:scale-105 flex items-center space-x-1"
                          title="コピー (Ctrl+Vで貼り付け)"
                        >
                          <Copy className="w-4 h-4" />
                          <span className="text-xs font-bold">Copy</span>
                        </button>
                        <button
                          onClick={() => downloadFile(file)}
                          className="p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg shadow-lg transform transition-transform hover:scale-105"
                          title="ダウンロード"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFile(file.id)}
                        className="px-3 py-1 bg-gray-200 hover:bg-red-500 text-gray-600 hover:text-white rounded-full text-xs font-medium shadow transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {/* Info Area with Input */}
                  <div className="p-3 bg-white flex flex-col justify-between flex-grow">
                    <div className="flex items-center space-x-2 mb-2 w-full">
                      <Pencil className="w-4 h-4 text-orange-400 flex-shrink-0" />
                      <div className="flex-grow min-w-0">
                        <input
                          type="text"
                          value={file.name}
                          onChange={(e) => updateFileName(file.id, e.target.value)}
                          className="w-full bg-transparent border-b border-orange-100 hover:border-orange-300 focus:border-orange-500 text-sm font-medium text-gray-800 focus:outline-none transition-colors px-1 py-0.5 rounded-sm"
                          placeholder="ファイル名"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-orange-600 pl-6">
                      <div className="flex items-center space-x-1">
                        {file.originalSize && file.originalSize !== file.size ? (
                          <>
                            <span className="text-gray-400 line-through">
                              {formatBytes(file.originalSize)}
                            </span>
                            <ArrowRight className="w-3 h-3 text-orange-400" />
                            <span className="font-bold text-orange-700">
                              {formatBytes(file.size)}
                            </span>
                          </>
                        ) : (
                          <span>{formatBytes(file.size)}</span>
                        )}
                      </div>
                      <span className="uppercase text-gray-500 font-medium tracking-wide text-[10px]">
                        {file.type.split("/")[1]}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Features Guide (Empty State) */}
        {files.length === 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 opacity-70">
            <div className="text-center p-4">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2 text-orange-600">
                <Copy className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-gray-600">コピー機能</h4>
              <p className="text-[10px] text-gray-500">ワンクリックでSlackへ</p>
            </div>
            <div className="text-center p-4">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2 text-orange-600">
                <RotateCw className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-gray-600">画像回転</h4>
              <p className="text-[10px] text-gray-500">スキャン時の向き補正</p>
            </div>
            <div className="text-center p-4">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2 text-orange-600">
                <Pencil className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-gray-600">墨消し・文字入れ</h4>
              <p className="text-[10px] text-gray-500">見せたくない部分の加工</p>
            </div>
            <div className="text-center p-4">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2 text-orange-600">
                <Layers className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-gray-600">ページ並び替え</h4>
              <p className="text-[10px] text-gray-500">PDF出力時の順序調整</p>
            </div>
          </div>
        )}
      </main>

      {/* Image Editor Modal */}
      {editingFile && (
        <ImageEditor
          file={editingFile}
          onSave={handleSaveEditedImage}
          onClose={() => setEditingFile(null)}
        />
      )}
    </div>
  );
}
