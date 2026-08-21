/**
 * ============================================================
 *  AI組織型コードレビュー済み
 *  レビュー日: 2026-08-21
 *  レビュー部署: バグチェック部 / セキュリティ部 / 改善提案部
 *  統合修正: 開発部
 * ============================================================
 */

import React, { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import heic2any from "heic2any";
import html2canvas from "html2canvas";
import "pdfjs-dist/web/pdf_viewer.css";
import { renderAsync as renderDocxAsync } from "docx-preview";
import * as XLSX from "xlsx";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  Circle,
  GripVertical,
  AlertTriangle,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Hand,
  Edit3,
  Sliders,
  Move
} from "lucide-react";

import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// PDF.js Worker Configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MAX_PDF_CANVAS_PIXELS = 12_000_000;
const MAX_PDF_CANVAS_SIDE = 8192;
const LARGE_PDF_FILE_BYTES = 50 * 1024 * 1024;
const LARGE_PDF_PAGE_COUNT = 100;
const PDFJS_ASSET_BASE = new URL("pdfjs/", document.baseURI).href;
const PDFJS_DOCUMENT_OPTIONS = {
  cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
  cMapPacked: true,
  iccUrl: `${PDFJS_ASSET_BASE}iccs/`,
  standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
  wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
  enableXfa: true,
  useSystemFonts: true,
  stopAtErrors: false
};

class ProcessingCancelledError extends Error {
  constructor() {
    super("処理をキャンセルしました");
    this.name = "ProcessingCancelledError";
  }
}

const generateId = () => crypto.randomUUID();

// [修正] バグチェック部指摘: 画像の安全な非同期ロードヘルパー（onerror漏れによるフリーズ防止）
const loadImageAsync = (src) => {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("画像ソースが指定されていません。"));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗しました。ファイルが破損している可能性があります。"));
    img.src = src;
  });
};

// [修正] セキュリティ部・バグチェック部指摘: HTMLエスケープヘルパー（XSS防止）
const escapeHtml = (str) => {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// [修正] バグチェック部指摘: Data URLから安全にBlobを生成する関数
const dataURLtoBlob = (dataurl) => {
  if (!dataurl || typeof dataurl !== "string") {
    throw new Error("有効なData URLが渡されていません。");
  }
  const parts = dataurl.split(",");
  if (parts.length < 2) {
    throw new Error("Data URLの形式が不正です。");
  }
  const match = parts[0].match(/:(.*?);/);
  const mime = match ? match[1] : "image/png";
  try {
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    throw new Error("Base64データのデコードに失敗しました: " + e.message);
  }
};

const canvasHasVisibleContent = (canvas) => {
  const sample = document.createElement("canvas");
  sample.width = 64;
  sample.height = 64;
  const context = sample.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, sample.width, sample.height);
  context.drawImage(canvas, 0, 0, sample.width, sample.height);

  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let visiblePixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] < 248 || pixels[i + 1] < 248 || pixels[i + 2] < 248) {
      visiblePixels += 1;
    }
  }
  return visiblePixels >= 4;
};

const renderPdfPageWithFallback = async (page, shouldCancel) => {
  const attempts = [
    { scale: 2, intent: "display" },
    { scale: 1.25, intent: "display" },
    { scale: 1, intent: "print" }
  ];
  const baseViewport = page.getViewport({ scale: 1 });
  let lastCanvas = null;
  let lastError = null;

  for (const attempt of attempts) {
    if (shouldCancel()) throw new ProcessingCancelledError();
    const pixelScale = Math.sqrt(
      MAX_PDF_CANVAS_PIXELS / (baseViewport.width * baseViewport.height)
    );
    const sideScale = Math.min(
      MAX_PDF_CANVAS_SIDE / baseViewport.width,
      MAX_PDF_CANVAS_SIDE / baseViewport.height
    );
    const safeScale = Math.max(0.25, Math.min(attempt.scale, pixelScale, sideScale));
    const viewport = page.getViewport({ scale: safeScale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));

    try {
      const renderTask = page.render({
        canvas,
        viewport,
        intent: attempt.intent,
        background: "#ffffff"
      });
      renderTask.onContinue = (continueRendering) => {
        if (shouldCancel()) {
          renderTask.cancel();
        } else {
          continueRendering();
        }
      };
      await renderTask.promise;
      lastCanvas = canvas;
      if (canvasHasVisibleContent(canvas)) {
        return { canvas, warning: null };
      }
      lastError = new Error("描画結果が白紙と判定されました");
    } catch (error) {
      if (shouldCancel()) throw new ProcessingCancelledError();
      lastError = error;
    }
  }

  if (lastCanvas) {
    return {
      canvas: lastCanvas,
      warning: "白紙の可能性があります。元のPDFも確認してください。"
    };
  }
  throw lastError || new Error("PDFページを描画できませんでした");
};

const renderXfaPage = async (page, shouldCancel) => {
  if (shouldCancel()) throw new ProcessingCancelledError();
  const xfaHtml = await page.getXfa();
  if (!xfaHtml) throw new Error("XFAフォームの内容を取得できませんでした");

  const baseViewport = pdfjsLib.XfaLayer.getPageViewport(xfaHtml, { scale: 1 });
  const pixelScale = Math.sqrt(
    MAX_PDF_CANVAS_PIXELS / (baseViewport.width * baseViewport.height)
  );
  const sideScale = Math.min(
    MAX_PDF_CANVAS_SIDE / baseViewport.width,
    MAX_PDF_CANVAS_SIDE / baseViewport.height
  );
  const scale = Math.max(0.25, Math.min(2, pixelScale, sideScale));
  const viewport = pdfjsLib.XfaLayer.getPageViewport(xfaHtml, { scale });
  const container = document.createElement("div");
  container.className = "xfaLayer";
  Object.assign(container.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    background: "#ffffff"
  });
  document.body.appendChild(container);

  try {
    pdfjsLib.XfaLayer.render({
      xfaHtml,
      div: container,
      viewport: viewport.clone({ dontFlip: true }),
      intent: "print",
      linkService: { addLinkAttributes() {} }
    });
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (shouldCancel()) throw new ProcessingCancelledError();

    const canvas = await html2canvas(container, {
      backgroundColor: "#ffffff",
      logging: false,
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height),
      scale: 1
    });
    return {
      canvas,
      warning: canvasHasVisibleContent(canvas)
        ? null
        : "XFAフォームの描画結果が白紙の可能性があります。"
    };
  } finally {
    container.remove();
  }
};

const SortableFileCard = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative bg-white rounded-xl overflow-hidden border transition-[transform,box-shadow,border-color,opacity] shadow-lg flex flex-col animate-fadeIn ${
        isDragging
          ? "z-50 border-orange-500 opacity-80 shadow-2xl ring-2 ring-orange-300"
          : "border-orange-200 hover:border-orange-500/50 hover:shadow-xl hover:shadow-orange-500/10"
      }`}
    >
      {children({ attributes, listeners, isDragging })}
    </div>
  );
};

// Image Editor Component
const ImageEditor = ({ file, onSave, onClose }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const canvasWrapperRef = useRef(null);

  // Tools: "select" | "hand" | "brush" | "rect" | "circle" | "text" | "stamp"
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(25);
  const [fontSize, setFontSize] = useState(40);
  const [useTextBg, setUseTextBg] = useState(true);
  const [shapeStyle, setShapeStyle] = useState("fill"); // "fill" | "stroke"
  const [stampType, setStampType] = useState("approved");
  const [stampText, setStampText] = useState("佐藤");
  const [stampColor, setStampColor] = useState("#ff0000");
  const [stampSize, setStampSize] = useState(70);

  // Zoom & Pan states
  const [zoomScale, setZoomScale] = useState(1);
  const [isFitMode, setIsFitMode] = useState(true);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  // Elements & History
  const [elements, setElements] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory] = useState([]);

  // Text Inline Editing state: { id?: string, text: string, canvasX: number, canvasY: number, fontSize: number, color: string, useBg: boolean }
  const [editingTextState, setEditingTextState] = useState(null);
  const textInputRef = useRef(null);

  const imgRef = useRef(null);
  const isLoaded = useRef(false);

  // Drag states
  const isMouseDown = useRef(false);
  const isDraggingElement = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const elementStartPos = useRef(null);

  // Shape drawing states
  const isDrawingShape = useRef(false);
  const activeShapeId = useRef(null);

  // Calculate Fit Zoom Scale
  const calculateFitScale = () => {
    if (!containerRef.current || !imgRef.current) return 1;
    const container = containerRef.current;
    const padding = 64;
    const availWidth = Math.max(100, container.clientWidth - padding);
    const availHeight = Math.max(100, container.clientHeight - padding);
    const scaleX = availWidth / imgRef.current.naturalWidth;
    const scaleY = availHeight / imgRef.current.naturalHeight;
    return Math.min(scaleX, scaleY, 1.0);
  };

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
      }
      if (isFitMode) {
        const fit = calculateFitScale();
        setZoomScale(fit);
      }
      drawAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Window resize handler for fit mode
  useEffect(() => {
    const handleResize = () => {
      if (isFitMode && isLoaded.current) {
        const fit = calculateFitScale();
        setZoomScale(fit);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isFitMode]);

  // Focus inline text area when editing text starts
  useEffect(() => {
    if (editingTextState && textInputRef.current) {
      textInputRef.current.focus();
      // Select all or move cursor to end
      const len = textInputRef.current.value.length;
      textInputRef.current.setSelectionRange(len, len);
    }
  }, [editingTextState]);

  // Redraw when elements, selection, or tool changes
  useEffect(() => {
    if (isLoaded.current) {
      drawAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedId, tool, editingTextState]);

  // Keyboard Shortcuts (Space for Pan, Delete/Backspace for removal, Undo, Esc)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't capture when typing in inputs/textareas
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        if (e.key === "Escape" && editingTextState) {
          setEditingTextState(null);
        }
        return;
      }

      if (e.code === "Space" && !isSpacePressed) {
        e.preventDefault();
        setIsSpacePressed(true);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          e.preventDefault();
          deleteSelectedElement();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setEditingTextState(null);
      } else if (selectedId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        moveSelectedElementBy(dx, dy);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, editingTextState, isSpacePressed, history, elements]);

  // Non-passive wheel listener for smooth zooming centered on mouse
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 1.15 : 0.87;
        applyZoom(zoomDelta, e.clientX, e.clientY);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoomScale]);

  // Apply zoom with focal point preserved
  const applyZoom = (factor, clientX, clientY) => {
    setIsFitMode(false);
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const focalX = clientX !== undefined ? clientX - rect.left : rect.width / 2;
    const focalY = clientY !== undefined ? clientY - rect.top : rect.height / 2;

    const currentScale = zoomScale;
    const nextScale = Math.max(0.15, Math.min(currentScale * factor, 6.0));

    // Adjust scroll so focal point remains stationary
    const ratio = nextScale / currentScale;
    const newScrollLeft = (container.scrollLeft + focalX) * ratio - focalX;
    const newScrollTop = (container.scrollTop + focalY) * ratio - focalY;

    setZoomScale(nextScale);
    requestAnimationFrame(() => {
      if (container) {
        container.scrollLeft = newScrollLeft;
        container.scrollTop = newScrollTop;
      }
    });
  };

  const handleZoomIn = () => applyZoom(1.25);
  const handleZoomOut = () => applyZoom(0.8);
  const handleZoom100 = () => {
    setIsFitMode(false);
    setZoomScale(1.0);
  };
  const handleFitScreen = () => {
    setIsFitMode(true);
    const fit = calculateFitScale();
    setZoomScale(fit);
  };

  // Convert browser client coordinates to original Canvas pixel coordinates
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

  // Helper to measure text multiline block dimensions
  const getTextMetrics = (ctx, el) => {
    const lines = String(el.text || "").split("\n");
    const fontSize = el.fontSize || 30;
    const lineHeight = fontSize * 1.3;
    const p = fontSize * 0.25;

    ctx.font = `bold ${fontSize}px "Inter", "Noto Sans JP", -apple-system, sans-serif`;
    let maxWidth = 0;
    lines.forEach((line) => {
      const w = ctx.measureText(line).width;
      if (w > maxWidth) maxWidth = w;
    });
    const totalHeight = Math.max(lines.length * lineHeight, fontSize);
    return { lines, fontSize, lineHeight, p, maxWidth, totalHeight };
  };

  // [修正] バグチェック部指摘: ディープコピー関数（Undo時のオブジェクト・配列参照共有バグ防止）
  const cloneElements = (els) =>
    els.map((el) => ({
      ...el,
      points: el.points ? el.points.map((p) => ({ ...p })) : undefined
    }));

  const pushHistory = (currentElements) => {
    setHistory((prev) => [...prev.slice(-19), cloneElements(currentElements)]);
  };

  // Draw text element supporting multiline & za-buton (background fill)
  const drawTextElement = (ctx, el) => {
    // [修正] バグチェック部指摘: 空文字または空白のみのテキストはゴミ描画防止のためスキップ
    if (!el.text || !el.text.trim()) return;

    const { lines, fontSize, lineHeight, p, maxWidth, totalHeight } = getTextMetrics(ctx, el);

    ctx.font = `bold ${fontSize}px "Inter", "Noto Sans JP", -apple-system, sans-serif`;
    ctx.textBaseline = "top";

    if (el.useBg) {
      ctx.fillStyle = el.bgColor || (el.color === "#ffffff" ? "#111827" : "#ffffff");
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(el.x - p, el.y - p, maxWidth + p * 2, totalHeight + p * 2, 4);
        ctx.fill();
        ctx.strokeStyle = el.color === "#ffffff" ? "#374151" : "#d1d5db";
        ctx.lineWidth = Math.max(1, fontSize * 0.03);
        ctx.stroke();
      } else {
        ctx.fillRect(el.x - p, el.y - p, maxWidth + p * 2, totalHeight + p * 2);
      }
    }

    ctx.fillStyle = el.color;
    lines.forEach((line, idx) => {
      ctx.fillText(line, el.x, el.y + idx * lineHeight + p * 0.15);
    });
  };

  // Main Canvas drawing routine
  const drawAll = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext("2d");

    // Clear and draw original image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0);

    // Draw elements
    elements.forEach((el) => {
      // If element is currently being edited in inline text overlay, hide or render lightly
      if (editingTextState && editingTextState.id === el.id) {
        return;
      }

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
        drawTextElement(ctx, el);
      } else if (el.type === "stamp") {
        ctx.save();
        ctx.translate(el.x, el.y);
        ctx.strokeStyle = el.color;
        ctx.fillStyle = el.color;

        if (el.stampType === "approved" || el.stampType === "confidential" || el.stampType === "urgent") {
          const w = el.size * 1.5;
          const h = el.size * 0.7;
          ctx.lineWidth = Math.max(3, w * 0.05);

          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(-w / 2, -h / 2, w, h, w * 0.1);
          } else {
            ctx.rect(-w / 2, -h / 2, w, h);
          }
          ctx.stroke();

          ctx.font = `bold ${h * 0.6}px "Meiryo", "MS Gothic", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(el.text, 0, 0);
        } else if (el.stampType === "done") {
          const r = el.size * 0.45;
          ctx.lineWidth = Math.max(3, r * 0.08);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = `bold ${r * 1.1}px "Meiryo", "MS Gothic", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(el.text, 0, 0);
        } else if (el.stampType === "circle_name") {
          const r = el.size * 0.5;
          ctx.lineWidth = Math.max(2, r * 0.06);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();

          const txt = el.text || "";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          if (txt.length === 1) {
            ctx.font = `bold ${r * 1.2}px "MS Mincho", "Noto Serif JP", serif`;
            ctx.fillText(txt, 0, 0);
          } else if (txt.length === 2) {
            ctx.font = `bold ${r * 0.9}px "MS Mincho", "Noto Serif JP", serif`;
            ctx.fillText(txt[0], 0, -r * 0.35);
            ctx.fillText(txt[1], 0, r * 0.35);
          } else if (txt.length === 3) {
            ctx.font = `bold ${r * 0.6}px "MS Mincho", "Noto Serif JP", serif`;
            ctx.fillText(txt[0], 0, -r * 0.5);
            ctx.fillText(txt[1], 0, 0);
            ctx.fillText(txt[2], 0, r * 0.5);
          } else {
            ctx.font = `bold ${r * 0.5}px "MS Mincho", "Noto Serif JP", serif`;
            ctx.fillText(txt.slice(0, 2), 0, -r * 0.3);
            ctx.fillText(txt.slice(2), 0, r * 0.3);
          }
        } else if (el.stampType === "square_name") {
          const w = el.size;
          ctx.lineWidth = Math.max(3, w * 0.05);
          ctx.strokeRect(-w / 2, -w / 2, w, w);

          const txt = el.text || "";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          if (txt.length <= 4) {
            ctx.font = `bold ${w * 0.32}px "MS Mincho", "Noto Serif JP", serif`;
            const t1 = txt.substring(0, 2);
            const t2 = txt.substring(2);
            ctx.fillText(t1, w * 0.2, -w * 0.2);
            ctx.fillText(t2, -w * 0.2, w * 0.2);
          } else {
            ctx.font = `bold ${w * 0.25}px "MS Mincho", "Noto Serif JP", serif`;
            const mid = Math.ceil(txt.length / 2);
            ctx.fillText(txt.slice(0, mid), w * 0.22, 0);
            ctx.fillText(txt.slice(mid), -w * 0.22, 0);
          }
        }
        ctx.restore();
      }

      // Selection bounding box indicator
      if (selectedId === el.id && (tool === "select" || !tool)) {
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = Math.max(2, Math.min(6, canvas.width * 0.0025));
        ctx.setLineDash([8, 6]);

        if (el.type === "text") {
          const { p, maxWidth, totalHeight } = getTextMetrics(ctx, el);
          ctx.strokeRect(
            el.x - p - 6,
            el.y - p - 6,
            maxWidth + p * 2 + 12,
            totalHeight + p * 2 + 12
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
          const xMin = Math.min(...xs) - el.brushSize / 2 - 6;
          const xMax = Math.max(...xs) + el.brushSize / 2 + 6;
          const yMin = Math.min(...ys) - el.brushSize / 2 - 6;
          const yMax = Math.max(...ys) + el.brushSize / 2 + 6;
          ctx.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
        } else if (el.type === "stamp") {
          const w = el.stampType.includes("square") || el.stampType === "circle_name" ? el.size : el.size * 1.5;
          const h = el.size * 0.8;
          ctx.strokeRect(el.x - w / 2 - 8, el.y - h / 2 - 8, w + 16, h + 16);
        }
      }
      ctx.restore();
    });
  };

  // Hit testing for selection & double-click
  const detectHitElement = (canvasPos) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");

    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.type === "text") {
        const { p, maxWidth, totalHeight } = getTextMetrics(ctx, el);
        if (
          canvasPos.x >= el.x - p - 8 &&
          canvasPos.x <= el.x + maxWidth + p + 8 &&
          canvasPos.y >= el.y - p - 8 &&
          canvasPos.y <= el.y + totalHeight + p + 8
        ) {
          return el;
        }
      } else if (el.type === "rect") {
        const xMin = Math.min(el.x, el.x + el.w);
        const xMax = Math.max(el.x, el.x + el.w);
        const yMin = Math.min(el.y, el.y + el.h);
        const yMax = Math.max(el.y, el.y + el.h);
        if (
          canvasPos.x >= xMin - 8 &&
          canvasPos.x <= xMax + 8 &&
          canvasPos.y >= yMin - 8 &&
          canvasPos.y <= yMax + 8
        ) {
          return el;
        }
      } else if (el.type === "circle") {
        const dist = Math.sqrt((canvasPos.x - el.x) ** 2 + (canvasPos.y - el.y) ** 2);
        if (dist <= el.r + 8) {
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
      } else if (el.type === "stamp") {
        const w = el.stampType.includes("square") || el.stampType === "circle_name" ? el.size : el.size * 1.5;
        const h = el.size * 0.8;
        if (
          canvasPos.x >= el.x - w / 2 - 8 &&
          canvasPos.x <= el.x + w / 2 + 8 &&
          canvasPos.y >= el.y - h / 2 - 8 &&
          canvasPos.y <= el.y + h / 2 + 8
        ) {
          return el;
        }
      }
    }
    return null;
  };

  // Move selected element by delta
  const moveSelectedElementBy = (dx, dy) => {
    if (!selectedId) return;
    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== selectedId) return el;
        if (el.type === "brush") {
          return {
            ...el,
            points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
          };
        }
        return {
          ...el,
          x: el.x + dx,
          y: el.y + dy
        };
      })
    );
  };

  // Pointer Down handler
  const handleStart = (clientX, clientY, button = 0) => {
    // If Space is pressed or Hand tool or Middle click, start pan
    if (isSpacePressed || tool === "hand" || button === 1) {
      isPanningRef.current = true;
      const container = containerRef.current;
      if (container) {
        panStartRef.current = {
          x: clientX,
          y: clientY,
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop
        };
      }
      return;
    }

    if (button !== 0) return; // Only primary mouse button for drawing

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
      pushHistory(elements);
      const newEl = {
        id: generateId(),
        type: "brush",
        points: [pos],
        color: color,
        brushSize: brushSize
      };
      setElements((prev) => [...prev, newEl]);
      activeShapeId.current = newEl.id;
    } else if (tool === "rect") {
      pushHistory(elements);
      const newEl = {
        id: generateId(),
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
      pushHistory(elements);
      const newEl = {
        id: generateId(),
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
    } else if (tool === "stamp") {
      pushHistory(elements);
      const text =
        stampType === "approved"
          ? "承認"
          : stampType === "confidential"
            ? "社外秘"
            : stampType === "urgent"
              ? "至急"
              : stampType === "done"
                ? "済"
                : stampText;

      const newEl = {
        id: generateId(),
        type: "stamp",
        stampType: stampType,
        text: text,
        x: pos.x,
        y: pos.y,
        color: stampColor,
        size: stampSize
      };
      setElements((prev) => [...prev, newEl]);
      setSelectedId(newEl.id);
      setTool("select");
    } else if (tool === "text") {
      // Start inline text editing at clicked canvas pos
      setEditingTextState({
        id: null,
        text: "",
        canvasX: pos.x,
        canvasY: pos.y,
        fontSize: fontSize,
        color: color,
        useBg: useTextBg
      });
    }
  };

  // Pointer Move handler
  const handleMove = (clientX, clientY) => {
    if (isPanningRef.current) {
      const container = containerRef.current;
      if (container) {
        const dx = clientX - panStartRef.current.x;
        const dy = clientY - panStartRef.current.y;
        container.scrollLeft = panStartRef.current.scrollLeft - dx;
        container.scrollTop = panStartRef.current.scrollTop - dy;
      }
      return;
    }

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

  // Pointer Up handler
  const handleEnd = () => {
    isPanningRef.current = false;
    isMouseDown.current = false;
    isDraggingElement.current = false;
    isDrawingShape.current = false;
    activeShapeId.current = null;
  };

  // Double Click handler -> Trigger inline text re-editing
  const handleDoubleClick = (e) => {
    const pos = getCanvasCoords(e.clientX, e.clientY);
    const hit = detectHitElement(pos);
    if (hit && hit.type === "text") {
      setEditingTextState({
        id: hit.id,
        text: hit.text,
        canvasX: hit.x,
        canvasY: hit.y,
        fontSize: hit.fontSize,
        color: hit.color,
        useBg: hit.useBg
      });
      setSelectedId(hit.id);
    }
  };

  // Submit Text (either new or existing)
  const submitText = () => {
    if (!editingTextState) return;

    const trimmed = (editingTextState.text || "").trim();
    if (!trimmed) {
      // If existing was emptied, delete it; if new, cancel
      if (editingTextState.id) {
        setElements((prev) => prev.filter((el) => el.id !== editingTextState.id));
      }
      setEditingTextState(null);
      return;
    }

    pushHistory(elements);

    if (editingTextState.id) {
      // Update existing
      setElements((prev) =>
        prev.map((el) =>
          el.id === editingTextState.id
            ? {
                ...el,
                text: editingTextState.text,
                fontSize: editingTextState.fontSize,
                color: editingTextState.color,
                useBg: editingTextState.useBg
              }
            : el
        )
      );
      setSelectedId(editingTextState.id);
    } else {
      // Create new text
      const newEl = {
        id: generateId(),
        type: "text",
        text: editingTextState.text,
        x: editingTextState.canvasX,
        y: editingTextState.canvasY,
        fontSize: editingTextState.fontSize,
        color: editingTextState.color,
        useBg: editingTextState.useBg
      };
      setElements((prev) => [...prev, newEl]);
      setSelectedId(newEl.id);
      setTool("select");
    }

    setEditingTextState(null);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prevElements = history[history.length - 1];
    setElements(prevElements);
    setHistory((prev) => prev.slice(0, -1));
    setSelectedId(null);
    setEditingTextState(null);
  };

  const deleteSelectedElement = () => {
    if (!selectedId) return;
    pushHistory(elements);
    setElements((prev) => prev.filter((el) => el.id !== selectedId));
    setSelectedId(null);
    if (editingTextState && editingTextState.id === selectedId) {
      setEditingTextState(null);
    }
  };

  // Update selected element property directly
  const updateSelectedElement = (updates) => {
    if (!selectedId) return;
    setElements((prev) =>
      prev.map((el) => (el.id === selectedId ? { ...el, ...updates } : el))
    );
  };

  const selectedElement = elements.find((e) => e.id === selectedId);

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSelectedId(null);
    setEditingTextState(null);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const dataUrl = canvas.toDataURL("image/png", 1.0);
        onSave(dataUrl);
      });
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-gray-950 text-white select-none">
      {/* Editor Header */}
      <div className="h-16 bg-gray-900 border-b border-gray-800 px-4 sm:px-6 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center space-x-3">
          <Pencil className="w-5 h-5 text-orange-500" />
          <span className="font-bold text-sm sm:text-base truncate max-w-[200px] sm:max-w-md text-gray-100">
            {file.name} を編集
          </span>
          <span className="hidden md:inline-block text-xs bg-gray-800 text-gray-400 px-2.5 py-1 rounded-full border border-gray-700">
            {imgRef.current ? `${imgRef.current.naturalWidth} × ${imgRef.current.naturalHeight} px` : ""}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            title="元に戻す (Ctrl+Z)"
            className="flex items-center space-x-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 px-3 py-1.5 rounded-lg text-xs sm:text-sm transition-colors border border-gray-700"
          >
            <Undo className="w-4 h-4" />
            <span className="hidden sm:inline">元に戻す</span>
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-1 bg-orange-600 hover:bg-orange-500 px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all shadow-lg shadow-orange-600/20"
          >
            <Check className="w-4 h-4" />
            <span>確定して保存</span>
          </button>
          <button
            onClick={onClose}
            title="閉じる"
            className="p-1.5 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors ml-2"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-grow flex flex-col md:flex-row overflow-hidden relative">
        {/* Sidebar Controls */}
        <div className="w-full md:w-80 bg-gray-900 border-r border-gray-800 p-4 sm:p-5 space-y-5 shrink-0 overflow-y-auto max-h-[40vh] md:max-h-full">
          {/* Tool Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
                編集ツール
              </label>
              <span className="text-[11px] text-gray-500">Space+ドラッグで移動</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setTool("select");
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "select"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <MousePointer className="w-4 h-4" />
                <span className="text-sm">選択・移動</span>
              </button>

              <button
                onClick={() => {
                  setTool("text");
                  setSelectedId(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "text"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Type className="w-4 h-4" />
                <span className="text-sm">文字入れ</span>
              </button>

              <button
                onClick={() => {
                  setTool("brush");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "brush"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Paintbrush className="w-4 h-4" />
                <span className="text-sm">墨消しペン</span>
              </button>

              <button
                onClick={() => {
                  setTool("rect");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "rect"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Square className="w-4 h-4" />
                <span className="text-sm">四角(□)</span>
              </button>

              <button
                onClick={() => {
                  setTool("circle");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "circle"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Circle className="w-4 h-4" />
                <span className="text-sm">丸(○)</span>
              </button>

              <button
                onClick={() => {
                  setTool("stamp");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "stamp"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Layers className="w-4 h-4" />
                <span className="text-sm">スタンプ</span>
              </button>
            </div>
          </div>

          {/* Selected Element Live Editor (DocuWorks-like instant modification) */}
          {selectedElement && tool === "select" && (
            <div className="space-y-3.5 p-3.5 bg-blue-950/40 border border-blue-800/60 rounded-xl animate-fadeIn">
              <div className="flex items-center justify-between border-b border-blue-800/40 pb-2">
                <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  選択中の要素を編集
                </span>
                <button
                  onClick={deleteSelectedElement}
                  title="削除 (Delete)"
                  className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1 hover:bg-red-950/50 px-2 py-1 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  削除
                </button>
              </div>
              {selectedElement.type === "text" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-gray-300">
                      文字の内容 (複数行可)
                    </label>
                    <textarea
                      rows={2}
                      value={selectedElement.text}
                      onChange={(e) => updateSelectedElement({ text: e.target.value })}
                      placeholder="文字を入力..."
                      className="w-full bg-white text-gray-900 text-xs border border-gray-300 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-500 font-sans leading-relaxed shadow-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">フォントサイズ</span>
                      <span className="text-blue-400 font-bold">{selectedElement.fontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="200"
                      value={selectedElement.fontSize || 30}
                      onChange={(e) => updateSelectedElement({ fontSize: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="text-xs text-gray-300 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedElement.useBg || false}
                        onChange={(e) => updateSelectedElement({ useBg: e.target.checked })}
                        className="w-4 h-4 rounded text-blue-600 bg-gray-800 border-gray-700 focus:ring-blue-500"
                      />
                      背景座布団をつける
                    </label>

                    <div className="flex items-center gap-1">
                      {["#000000", "#ffffff", "#ff0000", "#0000ff"].map((c) => (
                        <button
                          key={c}
                          onClick={() => updateSelectedElement({ color: c })}
                          className={`w-5 h-5 rounded-full border transition-transform ${
                            selectedElement.color === c ? "scale-125 ring-2 ring-blue-400" : "border-gray-600"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Shape specific inspector */}
              {(selectedElement.type === "rect" || selectedElement.type === "circle") && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateSelectedElement({ fillMode: "fill" })}
                      className={`py-1.5 rounded text-xs font-medium border ${
                        selectedElement.fillMode !== "stroke"
                          ? "bg-blue-600 border-blue-500 text-white font-bold"
                          : "bg-gray-800 border-gray-700 text-gray-300"
                      }`}
                    >
                      塗りつぶし
                    </button>
                    <button
                      onClick={() => updateSelectedElement({ fillMode: "stroke" })}
                      className={`py-1.5 rounded text-xs font-medium border ${
                        selectedElement.fillMode === "stroke"
                          ? "bg-blue-600 border-blue-500 text-white font-bold"
                          : "bg-gray-800 border-gray-700 text-gray-300"
                      }`}
                    >
                      枠線のみ
                    </button>
                  </div>

                  {selectedElement.fillMode === "stroke" && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300">枠線の太さ</span>
                        <span className="text-blue-400 font-bold">{selectedElement.brushSize || 5}px</span>
                      </div>
                      <input
                        type="range"
                        min="2"
                        max="60"
                        value={selectedElement.brushSize || 5}
                        onChange={(e) => updateSelectedElement({ brushSize: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-xs text-gray-400">色:</span>
                    {["#000000", "#ffffff", "#ff0000", "#0000ff", "#22c55e"].map((c) => (
                      <button
                        key={c}
                        onClick={() => updateSelectedElement({ color: c })}
                        className={`w-5 h-5 rounded-full border transition-transform ${
                          selectedElement.color === c ? "scale-125 ring-2 ring-blue-400" : "border-gray-600"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Stamp specific inspector */}
              {selectedElement.type === "stamp" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">スタンプサイズ</span>
                      <span className="text-blue-400 font-bold">{selectedElement.size}px</span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="250"
                      value={selectedElement.size || 70}
                      onChange={(e) => updateSelectedElement({ size: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-xs text-gray-400">色:</span>
                    {["#ff0000", "#0000ff", "#008000", "#000000"].map((c) => (
                      <button
                        key={c}
                        onClick={() => updateSelectedElement({ color: c })}
                        className={`w-5 h-5 rounded-full border transition-transform ${
                          selectedElement.color === c ? "scale-125 ring-2 ring-blue-400" : "border-gray-600"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Color Palette Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
              カラー選択
            </label>
            <div className="flex items-center space-x-3">
              {[
                { name: "黒 (墨消し/文字)", hex: "#000000" },
                { name: "白 (白消し)", hex: "#ffffff" },
                { name: "赤 (強調/スタンプ)", hex: "#ff0000" },
                { name: "青 (指示/チェック)", hex: "#0000ff" },
                { name: "緑 (完了)", hex: "#22c55e" }
              ].map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setColor(c.hex)}
                  title={c.name}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    color === c.hex
                      ? "border-orange-500 scale-110 ring-2 ring-orange-500/30"
                      : "border-gray-700 hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* Text Tool specific creation settings */}
          {tool === "text" && (
            <div className="space-y-3.5 p-3.5 bg-gray-850 rounded-xl border border-gray-800 animate-fadeIn">
              <span className="text-xs font-bold text-orange-400">文字入力の設定</span>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-300">フォントサイズ</span>
                  <span className="text-orange-500 font-bold">{fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="12"
                  max="150"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="textBgDefault"
                  checked={useTextBg}
                  onChange={(e) => setUseTextBg(e.target.checked)}
                  className="w-4 h-4 text-orange-600 bg-gray-800 border-gray-700 rounded focus:ring-orange-500"
                />
                <label
                  htmlFor="textBgDefault"
                  className="text-xs font-medium text-gray-300 select-none cursor-pointer"
                >
                  文字背景を塗りつぶす (座布団)
                </label>
              </div>
            </div>
          )}

          {/* Brush / Shape Thickness Settings */}
          {(tool === "brush" || ((tool === "rect" || tool === "circle") && shapeStyle === "stroke")) && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <label className="font-bold uppercase tracking-wider text-gray-400">
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

          {/* Shape Style Selector */}
          {(tool === "rect" || tool === "circle") && (
            <div className="space-y-2 animate-fadeIn">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
                図形スタイル
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShapeStyle("fill")}
                  className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                    shapeStyle === "fill"
                      ? "bg-gray-700 border-gray-600 text-white font-bold"
                      : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                  }`}
                >
                  塗りつぶし
                </button>
                <button
                  onClick={() => setShapeStyle("stroke")}
                  className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                    shapeStyle === "stroke"
                      ? "bg-gray-700 border-gray-600 text-white font-bold"
                      : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                  }`}
                >
                  枠線のみ
                </button>
              </div>
            </div>
          )}

          {/* Stamp Settings */}
          {tool === "stamp" && (
            <div className="space-y-3.5 p-3.5 bg-gray-850 rounded-xl border border-gray-800 animate-fadeIn">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
                スタンプの種類
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "approved", name: "承認 (角)" },
                  { id: "confidential", name: "社外秘 (角)" },
                  { id: "urgent", name: "至急 (角)" },
                  { id: "done", name: "済 (丸)" },
                  { id: "circle_name", name: "個人印 (丸)" },
                  { id: "square_name", name: "会社印 (角)" }
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStampType(s.id)}
                    className={`py-1.5 px-1 rounded-lg text-xs font-medium border transition-all ${
                      stampType === s.id
                        ? "bg-orange-600 border-orange-500 text-white shadow-md font-bold"
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>

              {(stampType === "circle_name" || stampType === "square_name") && (
                <div className="space-y-1.5 animate-fadeIn">
                  <label className="text-[11px] font-semibold text-gray-400">
                    印影の文字入力
                  </label>
                  <input
                    type="text"
                    maxLength={stampType === "circle_name" ? 4 : 8}
                    value={stampText}
                    onChange={(e) => setStampText(e.target.value)}
                    placeholder={stampType === "circle_name" ? "例: 佐藤" : "例: 八洲建設"}
                    className="w-full bg-white text-gray-900 border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-500 font-mono shadow-sm"
                  />
                </div>
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">サイズ</span>
                  <span className="text-orange-500 font-bold">{stampSize}px</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="200"
                  value={stampSize}
                  onChange={(e) => setStampSize(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* User Guide Card */}
          <div className="p-3.5 bg-gray-850/60 rounded-xl border border-gray-800 text-xs text-gray-400 space-y-1 leading-relaxed">
            <p className="font-semibold text-gray-300 flex items-center gap-1">
              💡 操作のヒント
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              <li><strong className="text-gray-200">拡大・縮小:</strong> 下部バーまたはホイール(Ctrl+)</li>
              <li><strong className="text-gray-200">画面移動:</strong> Spaceキーを押しながらドラッグ</li>
              <li><strong className="text-gray-200">文字編集:</strong> 文字をダブルクリックで再編集</li>
              <li><strong className="text-gray-200">微調整:</strong> 選択中に矢印キーで1px移動</li>
            </ul>
          </div>
        </div>

        {/* Canvas Display & Interaction Area */}
        <div
          ref={containerRef}
          className="flex-grow relative overflow-auto p-4 sm:p-8 flex items-center justify-center bg-gray-950"
          style={{
            cursor: isSpacePressed || isPanningRef.current ? "grab" : tool === "hand" ? "grab" : "default"
          }}
        >
          <div
            ref={canvasWrapperRef}
            className="relative inline-block shadow-2xl transition-[width,height] duration-75 ease-out"
            style={{
              width: imgRef.current ? `${imgRef.current.naturalWidth * zoomScale}px` : "auto",
              height: imgRef.current ? `${imgRef.current.naturalHeight * zoomScale}px` : "auto"
            }}
          >
            <canvas
              ref={canvasRef}
              onMouseDown={(e) => handleStart(e.clientX, e.clientY, e.button)}
              onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onDoubleClick={handleDoubleClick}
              onTouchStart={(e) => {
                if (e.touches.length > 0) handleStart(e.touches[0].clientX, e.touches[0].clientY, 0);
              }}
              onTouchMove={(e) => {
                if (e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY);
              }}
              onTouchEnd={handleEnd}
              className={`w-full h-full block bg-white border border-gray-800 ${
                isSpacePressed || tool === "hand"
                  ? "cursor-grab"
                  : tool === "select"
                    ? "cursor-default"
                    : tool === "text"
                      ? "cursor-text"
                      : "cursor-crosshair"
              }`}
            />

            {/* Inline Text Input Overlay (DocuWorks-like direct on-canvas WYSIWYG editing) */}
            {editingTextState && canvasRef.current && (
              <div
                className="absolute z-30 flex flex-col bg-white text-gray-900 border-2 border-orange-500 p-3 rounded-xl shadow-2xl animate-fadeIn ring-4 ring-black/20"
                style={{
                  left: `${(editingTextState.canvasX / canvasRef.current.width) * 100}%`,
                  top: `${(editingTextState.canvasY / canvasRef.current.height) * 100}%`,
                  minWidth: "260px",
                  maxWidth: "90vw",
                  transform: "translate(-10px, -10px)"
                }}
              >
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-200">
                  <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <Edit3 className="w-3.5 h-3.5 text-orange-500" />
                    {editingTextState.id ? "文字を再編集" : "文字を入力"}
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] text-gray-500 font-mono font-semibold">
                      {editingTextState.fontSize}px
                    </span>
                    <button
                      onClick={() =>
                        setEditingTextState((prev) => ({
                          ...prev,
                          useBg: !prev.useBg
                        }))
                      }
                      title="背景座布団の切り替え"
                      className={`text-[11px] px-2 py-0.5 rounded border transition-colors font-medium ${
                        editingTextState.useBg
                          ? "bg-orange-600 border-orange-500 text-white shadow-sm"
                          : "bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      座布団
                    </button>
                  </div>
                </div>

                <textarea
                  ref={textInputRef}
                  rows={Math.max(2, (editingTextState.text || "").split("\n").length)}
                  value={editingTextState.text}
                  onChange={(e) =>
                    setEditingTextState((prev) => ({
                      ...prev,
                      text: e.target.value
                    }))
                  }
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      submitText();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingTextState(null);
                    }
                  }}
                  placeholder="テキストを入力 (Shift+Enterで改行)"
                  className="w-full bg-white text-gray-900 border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-500 resize-none font-sans leading-relaxed shadow-inner placeholder-gray-400"
                />

                <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-gray-200">
                  <div className="flex items-center space-x-1.5">
                    {["#000000", "#ff0000", "#0000ff", "#22c55e", "#ffffff"].map((c) => (
                      <button
                        key={c}
                        onClick={() =>
                          setEditingTextState((prev) => ({ ...prev, color: c }))
                        }
                        title={c === "#000000" ? "黒" : c === "#ff0000" ? "赤" : c === "#0000ff" ? "青" : c === "#22c55e" ? "緑" : "白"}
                        className={`w-5 h-5 rounded-full border transition-all ${
                          editingTextState.color === c
                            ? "scale-125 ring-2 ring-orange-500 border-white shadow-sm"
                            : "border-gray-300 hover:scale-110"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  <div className="flex space-x-1.5">
                    <button
                      onClick={() => setEditingTextState(null)}
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition-colors border border-gray-300"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={submitText}
                      className="px-3.5 py-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition-all shadow-md shadow-orange-600/30 active:scale-95"
                    >
                      確定
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Floating Zoom Toolbar at bottom center */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900/90 backdrop-blur-md border border-gray-700/80 rounded-full px-4 py-2 flex items-center space-x-3 shadow-2xl">
            <button
              onClick={handleZoomOut}
              title="縮小 (Zoom Out)"
              className="p-1.5 hover:bg-gray-800 text-gray-300 hover:text-white rounded-full transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <button
              onClick={handleZoom100}
              title="等倍 (100%) にリセット"
              className="text-xs font-mono font-bold text-gray-200 hover:text-orange-400 px-2 py-0.5 rounded hover:bg-gray-800 transition-colors min-w-[52px] text-center"
            >
              {Math.round(zoomScale * 100)}%
            </button>

            <button
              onClick={handleZoomIn}
              title="拡大 (Zoom In)"
              className="p-1.5 hover:bg-gray-800 text-gray-300 hover:text-white rounded-full transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-gray-700" />

            <button
              onClick={handleFitScreen}
              title="画面サイズに合わせる"
              className={`flex items-center space-x-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                isFitMode
                  ? "bg-orange-600/20 border-orange-500/80 text-orange-400 font-bold"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">全体表示</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const settingsRunRef = useRef(0);
  const processingCancelledRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 }
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [, setLogs] = useState([]);
  const addLog = (msg) =>
    setLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 49)
    ]);

  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canCancelProcessing, setCanCancelProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [editingFile, setEditingFile] = useState(null);

  // Settings
  const [targetFormat, setTargetFormat] = useState("image/png");
  const [maxWidth, setMaxWidth] = useState("");
  const [maxHeight, setMaxHeight] = useState("");
  const [quality, setQuality] = useState(0.9);
  const [pdfPageRange, setPdfPageRange] = useState("");
  const [pdfPassword, setPdfPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pdfBlockPrinting, setPdfBlockPrinting] = useState(false);

  const cancelProcessing = () => {
    processingCancelledRef.current = true;
    setIsCancelling(true);
    setProcessStatus("処理を停止しています...");
  };

  // Rename Settings
  const [renamePrefix, setRenamePrefix] = useState("");
  const [renameSuffix, setRenameSuffix] = useState("");
  const [renameBase, setRenameBase] = useState("");
  const [renameStartNum, setRenameStartNum] = useState(1);
  const [renameDigits, setRenameDigits] = useState(3);

  const applyBulkRename = () => {
    if (files.length === 0) return;

    const newFiles = files.map((file, index) => {
      // file.typeではなくtargetFormatを参照する（変換後の形式を正確に反映するため）
      const ext = targetFormat === "image/png" ? ".png" : ".jpg";
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
    e.target.value = "";
    addLog(`Files selected: ${selectedFiles.length}`);
    await processFiles(selectedFiles);
  };

  // [修正] バグチェック部指摘: 範囲逆順救済・最大ページ制限・0以下除外によるフリーズ防止
  const parsePageRange = (rangeStr, maxPages = 5000) => {
    if (!rangeStr || !rangeStr.trim()) return null;
    const pages = new Set();
    const parts = rangeStr.split(",");

    parts.forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;
      const range = trimmed.split("-");
      if (range.length === 2) {
        let start = parseInt(range[0], 10);
        let end = parseInt(range[1], 10);
        if (!isNaN(start) && !isNaN(end)) {
          if (start > end) [start, end] = [end, start]; // 逆順入力の救済 (例: 5-1 -> 1-5)
          start = Math.max(1, start);
          end = Math.min(maxPages, end);
          // 最大1000ページの展開制限を設けてブラウザフリーズを防止
          if (end - start > 1000) end = start + 1000;
          for (let i = start; i <= end; i++) pages.add(i);
        }
      } else {
        const page = parseInt(trimmed, 10);
        if (!isNaN(page) && page > 0 && page <= maxPages) {
          pages.add(page);
        }
      }
    });
    return pages.size > 0 ? pages : null;
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
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const rotateImage = async (id, direction) => {
    const file = files.find((f) => f.id === id);
    if (!file) return;

    try {
      const angle = direction === "left" ? -90 : 90;

      // [修正] バグチェック部指摘: 安全な画像ロード（破損時の永久ハングアップ防止）
      const img = await loadImageAsync(file.originalSrc);

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

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                originalSrc: newOriginalSrc,
                src: newDisplaySrc,
                size: Math.round((newDisplaySrc.length * 3) / 4)
              }
            : f
        )
      );
    } catch (err) {
      console.error("Image rotation failed:", err);
      alert("画像の回転に失敗しました。");
    }
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

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setFiles((currentFiles) => {
      const oldIndex = currentFiles.findIndex((file) => file.id === active.id);
      const newIndex = currentFiles.findIndex((file) => file.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return currentFiles;
      return arrayMove(currentFiles, oldIndex, newIndex);
    });
  };

  // [修正] バグチェック部指摘: クリップボードコピーのPNG形式保証（JPG時のClipboardItemクラッシュ防止）
  const copyToClipboard = async (file) => {
    try {
      let pngBlob;
      if (file.type === "image/png" && file.src.startsWith("data:image/png")) {
        pngBlob = dataURLtoBlob(file.src);
      } else {
        const img = await loadImageAsync(file.src);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      }

      if (!pngBlob) throw new Error("画像データの変換に失敗しました");

      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": pngBlob
        })
      ]);
      alert("クリップボードにコピーしました！ (Ctrl+Vで貼り付け)");
    } catch (err) {
      console.error("Clipboard copy error:", err);
      alert("コピーに失敗しました。ブラウザが対応していないか、セキュリティ制限の可能性があります。");
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
    const runId = ++settingsRunRef.current;
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
        if (runId !== settingsRunRef.current) return;
        const newSize = Math.round((newSrc.length * 3) / 4);

        const newType = targetFormat === "application/pdf" ? "image/jpeg" : targetFormat;
        const ext = targetFormat === "image/png" ? ".png" : ".jpg";
        // [修正] バグチェック部指摘: userRenamedであっても拡張子は現在のtargetFormatに追従させる
        const baseWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        const newName = `${baseWithoutExt}${ext}`;

        if (file.src !== newSrc || file.type !== newType || file.name !== newName) {
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

      if (changed && runId === settingsRunRef.current) {
        setFiles(newFiles);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      settingsRunRef.current += 1;
    };
  // File changes are outputs of this effect; including them would create a conversion loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxWidth, maxHeight, quality, targetFormat]);

  const processFiles = async (fileList) => {
    processingCancelledRef.current = false;
    setIsCancelling(false);
    setCanCancelProcessing(true);
    setIsProcessing(true);
    setProcessStatus("ファイルを読み込んでいます...");
    addLog(`Processing ${fileList.length} files...`);

    const newProcessedFiles = [];

    for (const file of fileList) {
      if (processingCancelledRef.current) break;
      try {
        let processedItems = [];
        const isHeic =
          file.name.toLowerCase().endsWith(".heic") ||
          file.type === "image/heic";

        const isDocx =
          file.name.toLowerCase().endsWith(".docx") ||
          file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        const isXlsx =
          file.name.toLowerCase().endsWith(".xlsx") ||
          file.name.toLowerCase().endsWith(".xls") ||
          file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          file.type === "application/vnd.ms-excel";

        if (file.type === "application/pdf") {
          if (
            file.size >= LARGE_PDF_FILE_BYTES &&
            !confirm(
              `${file.name} は ${formatBytes(file.size)} あります。\n` +
                "処理に時間がかかり、ブラウザのメモリを多く使用する可能性があります。続行しますか？"
            )
          ) {
            continue;
          }
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
        } else if (isDocx) {
          setProcessStatus(`Word文書を変換中: ${file.name}`);
          const items = await convertDocxToImages(file, (current, total) => {
            setProcessStatus(`Word文書を変換中: ${file.name} (${current} / ${total} ページ)`);
          });
          processedItems = items;
        } else if (isXlsx) {
          setProcessStatus(`Excel文書を変換中: ${file.name}`);
          const items = await convertXlsxToImages(file, (current, total) => {
            setProcessStatus(`Excel文書を変換中: ${file.name} (${current} / ${total} シート)`);
          });
          processedItems = items;
        } else if (file.type.startsWith("image/")) {
          setProcessStatus(`画像を処理中: ${file.name}`);
          const item = await processImage(file);
          processedItems = [item];
        }

        // Apply settings immediately
        for (let i = 0; i < processedItems.length; i++) {
          if (processingCancelledRef.current) break;
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
        if (error instanceof ProcessingCancelledError) break;
        console.error("Processing Error:", error);
        alert(`エラーが発生しました: ${file.name}\n${error.message}`);
      }
    }

    setFiles((prev) => [...newProcessedFiles, ...prev]);
    setIsProcessing(false);
    setCanCancelProcessing(false);
    setIsCancelling(false);
    setProcessStatus("");
  };

  const convertPdfToImages = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      ...PDFJS_DOCUMENT_OPTIONS
    });
    let passwordCancelled = false;
    loadingTask.onPassword = (updatePassword, reason) => {
      const isRetry = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
      const password = window.prompt(
        isRetry
          ? `${file.name}\nパスワードが正しくありません。もう一度入力してください。`
          : `${file.name}\nこのPDFはパスワードで保護されています。パスワードを入力してください。`
      );
      if (password === null) {
        passwordCancelled = true;
        loadingTask.destroy();
        return;
      }
      updatePassword(password);
    };

    let pdf;
    try {
      pdf = await loadingTask.promise;
    } catch (error) {
      if (passwordCancelled) {
        throw new Error("パスワード入力がキャンセルされました", {
          cause: error
        });
      }
      throw error;
    }

    const pageCount = pdf.numPages;
    const images = [];
    const failedPages = [];

    const targetPages = parsePageRange(pdfPageRange);

    // ページ数チェックをtry/finally内に含めることでdestroy()の重複呼び出しを防ぐ
    try {
      if (
        pageCount >= LARGE_PDF_PAGE_COUNT &&
        !confirm(
          `${file.name} は ${pageCount}ページあります。\n` +
            "変換に時間がかかる可能性があります。続行しますか？"
        )
      ) {
        return images; // finallyブロックがdestroy()を呼ぶため、ここでは呼ばない
      }

      for (let i = 1; i <= pageCount; i++) {
        if (targetPages && !targetPages.has(i)) continue;
        if (processingCancelledRef.current) break;

        setProcessStatus(
          `${file.name} - ${i} / ${pageCount} ページ目を変換中...`
        );
        let page;
        try {
          page = await pdf.getPage(i);
          const shouldCancel = () => processingCancelledRef.current;
          const { canvas, warning } = page.isPureXfa
            ? await renderXfaPage(page, shouldCancel)
            : await renderPdfPageWithFallback(page, shouldCancel);
          const originalDataUrl = canvas.toDataURL("image/png", 1.0);
          const estimatedSize = Math.round((originalDataUrl.length * 3) / 4);

          images.push({
            id: generateId(),
            name: `${file.name.replace(/\.pdf$/i, "")}_page_${i}.png`,
            originalName: file.name,
            originalSrc: originalDataUrl,
            src: originalDataUrl,
            type: "image/png",
            size: estimatedSize,
            originalSize: estimatedSize,
            isPdfPage: true,
            pageNumber: i,
            renderWarning: warning
          });
        } catch (error) {
          if (error instanceof ProcessingCancelledError) break;
          console.error(`PDF page ${i} conversion failed:`, error);
          failedPages.push(i);
        } finally {
          page?.cleanup();
        }
      }
    } finally {
      // destroy()はここ1箇所だけで呼ぶ（早期リターン時も含めて確実に解放）
      await loadingTask.destroy();
    }

    if (failedPages.length > 0) {
      alert(
        `${file.name}\n${failedPages.join(", ")}ページ目を変換できませんでした。` +
          "\nその他のページは正常に取り込みました。"
      );
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

  const convertDocxToImages = async (file, onProgress) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuffer = e.target.result;

        // 一時的なコンテナを作成し、画面外に配置する
        const container = document.createElement("div");
        container.style.position = "fixed";
        container.style.left = "-9999px";
        container.style.top = "-9999px";
        container.style.width = "850px"; // A4幅相当の目安
        container.style.background = "#ffffff";
        container.style.padding = "40px";
        container.style.boxSizing = "border-box";
        document.body.appendChild(container);

        try {
          // docx-previewでDOMにレンダリングする
          await renderDocxAsync(arrayBuffer, container, null, {
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true // ページ分割を有効にする
          });

          // リソースやフォントの読み込み待機用バッファ
          await new Promise((r) => setTimeout(r, 1000));

          // ページごとの要素（通常は section.docx）を抽出する
          let pageElements = container.querySelectorAll("section.docx");
          if (pageElements.length === 0) {
            // クラス名が異なる場合のフォールバック（ラッパー直下の子要素）
            const wrapper = container.querySelector(".docx-wrapper");
            if (wrapper) {
              pageElements = wrapper.querySelectorAll(":scope > section");
            }
          }

          const images = [];

          if (pageElements && pageElements.length > 0) {
            // 各ページを個別に画像化する
            for (let i = 0; i < pageElements.length; i++) {
              // [修正] バグチェック部指摘: Word変換時のキャンセル判定
              if (processingCancelledRef.current) {
                throw new ProcessingCancelledError();
              }
              if (onProgress) {
                onProgress(i + 1, pageElements.length);
              }
              const pageEl = pageElements[i];

              // html2canvasで各ページ要素を画像化する
              const canvas = await html2canvas(pageEl, {
                scale: 1.5,
                useCORS: true,
                backgroundColor: "#ffffff",
                logging: false
              });

              const dataUrl = canvas.toDataURL("image/png", 1.0);
              const estimatedSize = Math.round((dataUrl.length * 3) / 4);

              images.push({
                id: generateId(),
                name: `${file.name.replace(/\.docx$/i, "")}_page_${i + 1}.png`,
                originalName: file.name,
                originalSrc: dataUrl,
                src: dataUrl,
                type: "image/png",
                size: estimatedSize,
                originalSize: file.size,
                isPdfPage: true,
                pageNumber: i + 1
              });
            }
          } else {
            // ページ要素が抽出できなかった場合は、全体を1枚として処理（フォールバック）
            if (processingCancelledRef.current) {
              throw new ProcessingCancelledError();
            }
            if (onProgress) {
              onProgress(1, 1);
            }
            const canvas = await html2canvas(container, {
              scale: 1.5,
              useCORS: true,
              backgroundColor: "#ffffff",
              logging: false
            });

            const dataUrl = canvas.toDataURL("image/png", 1.0);
            const estimatedSize = Math.round((dataUrl.length * 3) / 4);

            images.push({
              id: generateId(),
              name: file.name.replace(/\.docx$/i, "") + ".png",
              originalName: file.name,
              originalSrc: dataUrl,
              src: dataUrl,
              type: "image/png",
              size: estimatedSize,
              originalSize: file.size,
              isPdfPage: false
            });
          }

          // 一時要素を削除
          document.body.removeChild(container);
          resolve(images);
        } catch (err) {
          if (container.parentNode) {
            document.body.removeChild(container);
          }
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  };

  const convertXlsxToImages = async (file, onProgress) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result);
        let container = null;
        try {
          const workbook = XLSX.read(data, { type: "array" });
          const sheetNames = workbook.SheetNames;
          const images = [];

          // 一時コンテナの作成
          container = document.createElement("div");
          container.style.position = "fixed";
          container.style.left = "-9999px";
          container.style.top = "-9999px";
          container.style.background = "#ffffff";
          container.style.padding = "30px";
          container.style.boxSizing = "border-box";
          container.style.width = "1000px"; // Excelの表が収まりやすいように広め
          document.body.appendChild(container);

          for (let i = 0; i < sheetNames.length; i++) {
            // [修正] バグチェック部指摘: Excel変換時のキャンセル判定
            if (processingCancelledRef.current) {
              throw new ProcessingCancelledError();
            }
            if (onProgress) {
              onProgress(i + 1, sheetNames.length);
            }
            const sheetName = sheetNames[i];
            const worksheet = workbook.Sheets[sheetName];

            // 簡易的に空のシートかどうか確認
            const ref = worksheet["!ref"];
            if (!ref) continue; // データがないシートはスキップ

            const htmlTable = XLSX.utils.sheet_to_html(worksheet);

            // [修正] セキュリティ部指摘: sheetNameのサニタイズ（DOM XSS脆弱性の防止）
            container.innerHTML = `
              <div class="excel-sheet-render" style="font-family: 'Segoe UI', Meiryo, sans-serif; color: #333333; margin-bottom: 20px;">
                <h2 style="font-size: 18px; color: #107c41; border-bottom: 2px solid #107c41; padding-bottom: 6px; margin: 0 0 15px 0; display: flex; align-items: center; font-weight: 600;">
                  <span style="background: #107c41; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px;">SHEET</span>
                  ${escapeHtml(sheetName)}
                </h2>
                <div style="overflow-x: auto; width: 100%; border: 1px solid #e1e1e1; border-radius: 4px; background: #ffffff; padding: 10px; box-sizing: border-box;">
                  ${htmlTable}
                </div>
              </div>
            `;

            // スタイルの自動適用（Excel風の罫線とデザイン）
            const tables = container.querySelectorAll("table");
            tables.forEach((t) => {
              t.style.borderCollapse = "collapse";
              t.style.width = "100%";
              t.style.fontSize = "13px";
              t.style.fontFamily = "sans-serif";

              const tds = t.querySelectorAll("td");
              tds.forEach((td) => {
                td.style.border = "1px solid #d0d0d0";
                td.style.padding = "6px 8px";
                td.style.minWidth = "60px";
                // 数値セルの右寄せ補正
                if (/^[0-9,.\-%\\$]+$/.test(td.textContent.trim())) {
                  td.style.textAlign = "right";
                }
              });

              const ths = t.querySelectorAll("th");
              ths.forEach((th) => {
                th.style.border = "1px solid #d0d0d0";
                th.style.padding = "6px 8px";
                th.style.backgroundColor = "#f3f3f3";
                th.style.fontWeight = "bold";
              });
            });

            // html2canvasでシートを画像化
            const canvas = await html2canvas(container, {
              scale: 1.5,
              useCORS: true,
              backgroundColor: "#ffffff",
              logging: false
            });

            const dataUrl = canvas.toDataURL("image/png", 1.0);
            const estimatedSize = Math.round((dataUrl.length * 3) / 4);

            images.push({
              id: generateId(),
              name: `${file.name.replace(/\.xlsx?$/i, "")}_${sheetName}.png`,
              originalName: file.name,
              originalSrc: dataUrl,
              src: dataUrl,
              type: "image/png",
              size: estimatedSize,
              originalSize: file.size,
              isPdfPage: true,
              pageNumber: i + 1,
              sheetName: sheetName
            });
          }

          document.body.removeChild(container);
          resolve(images);
        } catch (err) {
          if (container?.parentNode) {
            document.body.removeChild(container);
          }
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
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

    const usedNames = new Set();
    files.forEach((file) => {
      // [修正] バグチェック部指摘: file.srcの安全なBase64分割
      const parts = (file.src || "").split(",");
      const data = parts.length > 1 ? parts[1] : "";
      if (!data) return;

      const safeName = getSafeName(file);
      const dotIndex = safeName.lastIndexOf(".");
      const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
      const ext = dotIndex > 0 ? safeName.slice(dotIndex) : "";
      let uniqueName = safeName;
      let suffix = 2;
      while (usedNames.has(uniqueName.toLocaleLowerCase())) {
        uniqueName = `${base}_${suffix}${ext}`;
        suffix += 1;
      }
      usedNames.add(uniqueName.toLocaleLowerCase());
      folder.file(uniqueName, data, { base64: true });
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
      const userPermissions = ["modify", "copy"];
      if (!pdfBlockPrinting) {
        userPermissions.push("print");
      }

      // [修正] セキュリティ部・バグチェック部指摘: 推測不可能なUUIDによるownerPassword生成
      const encryptionOptions = pdfPassword.trim()
        ? {
            encryption: {
              userPassword: pdfPassword.trim(),
              ownerPassword: crypto.randomUUID(),
              userPermissions: userPermissions
            }
          }
        : {};

      const doc = new jsPDF({
        orientation: "p",
        unit: "px",
        format: "a4",
        ...encryptionOptions
      });

      doc.deletePage(1);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          // [修正] バグチェック部指摘: 画像の安全なロード（onerror漏れによるフリーズ防止）
          const img = await loadImageAsync(file.src);
          const width = img.width;
          const height = img.height;

          doc.addPage([width, height], width > height ? "l" : "p");
          let format = file.type === "image/png" ? "PNG" : "JPEG";
          doc.addImage(file.src, format, 0, 0, width, height);
        } catch (imgErr) {
          console.error(`画像「${file.name}」の読み込みに失敗しました:`, imgErr);
        }
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

            {/* PDF Output Password */}
            {targetFormat === "application/pdf" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-orange-800">
                  PDF出力パスワード
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="保護用パスワードを入力"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    className="w-full bg-white border border-orange-200 text-gray-800 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5 pr-10 shadow-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-orange-400 hover:text-orange-600 transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Print blocking option */}
                <div className="flex items-center space-x-2 mt-1.5">
                  <input
                    type="checkbox"
                    id="blockPrint"
                    disabled={!pdfPassword.trim()}
                    checked={pdfPassword.trim() ? pdfBlockPrinting : false}
                    onChange={(e) => setPdfBlockPrinting(e.target.checked)}
                    className="w-4 h-4 text-orange-600 bg-white border-orange-200 rounded focus:ring-orange-500 focus:ring-offset-white disabled:opacity-50"
                  />
                  <label
                    htmlFor="blockPrint"
                    className={`text-xs font-medium select-none cursor-pointer ${
                      pdfPassword.trim() ? "text-orange-950" : "text-gray-400"
                    }`}
                  >
                    印刷を禁止する
                    {!pdfPassword.trim() && <span className="text-[10px] ml-1 text-gray-400 font-normal">※パスワード設定時のみ有効</span>}
                  </label>
                </div>
              </div>
            )}
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
                  onChange={(e) => {
                    const value = Number.parseInt(e.target.value, 10);
                    setRenameStartNum(Number.isNaN(value) ? 1 : value);
                  }}
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
            accept="image/*,.pdf,.heic,.docx,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
              {canCancelProcessing && (
                <button
                  type="button"
                  onClick={cancelProcessing}
                  disabled={isCancelling}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                >
                  <X className="h-4 w-4" />
                  {isCancelling ? "停止中..." : "処理をキャンセル"}
                </button>
              )}
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

            <p className="text-sm text-orange-700 bg-orange-100/70 border border-orange-200 rounded-lg px-3 py-2">
              <GripVertical className="inline w-4 h-4 mr-1 -mt-0.5" />
              ハンドルをドラッグして順番を変更できます。スマホでは長押しして移動してください。
            </p>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={files.map((file) => file.id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {files.map((file, index) => (
                    <SortableFileCard key={file.id} id={file.id}>
                      {({ attributes, listeners, isDragging }) => (
                        <>
                  {/* Image Preview & Controls */}
                  <div className="aspect-[3/2] bg-orange-100/50 relative overflow-hidden shrink-0">
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmN2VkIi8+CjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjgiIGZpbGw9IiNmZWQ3YWEiLz4KPHJlY3QgeD0iNCIgeT0iNCIgd2lkdGg9IjQiIGhlaWdodD0iNCIgZmlsbD0iI2ZlZDdhYSIvPgo8L3N2Zz4=')] opacity-50"></div>
                    <img
                      src={file.src}
                      alt={file.name}
                      className="absolute inset-0 w-full h-full object-contain p-4 transition-transform duration-500 group-hover:scale-105"
                    />

                    <button
                      type="button"
                      {...attributes}
                      {...listeners}
                      aria-label={`${index + 1}番目の画像を並び替え`}
                      className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-bold shadow-md select-none touch-none transition-colors ${
                        isDragging
                          ? "bg-orange-600 border-orange-600 text-white cursor-grabbing"
                          : "bg-white/95 border-orange-300 text-orange-700 cursor-grab hover:bg-orange-500 hover:text-white"
                      }`}
                      title="ドラッグして並び替え"
                    >
                      <GripVertical className="w-4 h-4" />
                      移動
                    </button>

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
                    <div className="absolute top-2 right-2 flex flex-col items-end gap-1 z-10">
                      <span className="bg-gray-900 text-white text-xs font-bold min-w-8 h-8 px-2 rounded-full shadow flex items-center justify-center">
                        {index + 1}
                      </span>
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
                    {file.renderWarning && (
                      <div
                        className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800"
                        role="status"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{file.renderWarning}</span>
                      </div>
                    )}
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
                        </>
                      )}
                    </SortableFileCard>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
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
