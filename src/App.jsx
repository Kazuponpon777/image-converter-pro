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
import { PdfCompareModal } from "./PdfCompareModal";
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
  ArrowUpRight,
  MessageSquare,
  StickyNote,
  GripVertical,
  GripHorizontal,
  AlertTriangle,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Hand,
  Edit3,
  Sliders,
  Move,
  Pipette,
  Crop,
  Sparkles,
  ShieldCheck,
  ScanFace,
  ClipboardPaste,
  Ratio,
  Grid,
  Film,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Camera,
  Video,
  FastForward,
  Rewind,
  Mail,
  Paperclip
} from "lucide-react";

import { parse as parseEmail, detectFormat as detectEmailFormat } from "omnimail";
import DOMPurify from "dompurify";

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

// Helper: フォーマット秒数 (例: 01:23.4)
const formatTimeWithFraction = (seconds) => {
  if (isNaN(seconds) || seconds == null) return "00:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
};

// Helper: フォーマットバイト数 (例: 1.2 MB)
const formatBytes = (bytes, decimals = 1) => {
  if (!+bytes) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

// マジックバイトからMIMEタイプと拡張子を自動判定・復元するヘルパー
const detectMimeFromBytes = (bytes) => {
  if (!bytes || bytes.length < 4) return { mime: "application/octet-stream", ext: "" };
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: ".jpg" };
  }
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ext: ".png" };
  }
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { mime: "image/gif", ext: ".gif" };
  }
  // PDF: 25 50 44 46 (%PDF)
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { mime: "application/pdf", ext: ".pdf" };
  }
  // ZIP / Office文書 (docx, xlsx, pptx): 50 4B 03 04
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return { mime: "application/zip", ext: ".zip" };
  }
  // WEBP: 52 49 46 46 ... 57 45 42 50
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes.length >= 12) {
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return { mime: "image/webp", ext: ".webp" };
    }
  }
  return { mime: "application/octet-stream", ext: "" };
};

// 日本語（Shift_JIS/CP932）とUTF-8を自動判別してデコードするヘルパー
const decodeTextSmart = (bytes) => {
  if (!bytes || bytes.length === 0) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\0+$/, "");
  } catch {
    try {
      return new TextDecoder("shift_jis").decode(bytes).replace(/\0+$/, "");
    } catch {
      return new TextDecoder("windows-1252").decode(bytes).replace(/\0+$/, "");
    }
  }
};

// MAPIプロパティから添付ファイル名や実データを抽出するヘルパー
const extractMapiAttachmentProps = (data, att) => {
  if (data.length < 4) return;
  const numProps = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] * 16777216);
  let pos = 4;

  for (let i = 0; i < numProps && pos + 4 <= data.length; i++) {
    const propType = data[pos] | (data[pos + 1] << 8);
    const propId = data[pos + 2] | (data[pos + 3] << 8);
    pos += 4;

    const isMulti = (propType & 0x1000) !== 0;
    const baseType = propType & ~0x1000;

    if (propId >= 0x8000 && propId <= 0xfffe) {
      if (pos + 20 > data.length) break;
      pos += 16;
      const kind = data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216);
      pos += 4;
      if (kind === 0) pos += 4;
      else {
        const nameLen = data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216);
        pos += 4 + nameLen + ((-nameLen) & 3);
      }
    }

    let valCount = isMulti ? (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216)) : 1;
    if (isMulti) pos += 4;

    for (let c = 0; c < valCount; c++) {
      let valLen = 0;
      if (baseType === 0x0002 || baseType === 0x000b) valLen = 2;
      else if (baseType === 0x0003 || baseType === 0x0004) valLen = 4;
      else if (baseType === 0x0005 || baseType === 0x0006 || baseType === 0x0007 || baseType === 0x0014 || baseType === 0x0040) valLen = 8;
      else if (baseType === 0x0048) valLen = 16;
      else {
        if (pos + 4 > data.length) break;
        valLen = (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216)) >>> 0;
        pos += 4;
      }

      if (pos + valLen > data.length) break;
      const valBytes = data.subarray(pos, pos + valLen);
      pos += valLen + ((-valLen) & 3);

      if (c === 0 && valBytes.length > 0) {
        // PR_ATTACH_LONG_FILENAME (0x3707): 日本語やスペース含む正式ファイル名
        if (propId === 0x3707) {
          att.filename = baseType === 0x001f
            ? new TextDecoder("utf-16le").decode(valBytes).replace(/\0+$/, "")
            : decodeTextSmart(valBytes);
        }
        // PR_ATTACH_FILENAME (0x3704): 8.3形式のファイル名（ロングネームがまだない場合）
        else if (propId === 0x3704 && !att.filename) {
          att.filename = baseType === 0x001f
            ? new TextDecoder("utf-16le").decode(valBytes).replace(/\0+$/, "")
            : decodeTextSmart(valBytes);
        }
        // PR_ATTACH_DATA_BIN (0x3701): 添付ファイル実データ
        else if (propId === 0x3701 && !att.data) {
          att.data = valBytes;
        }
        // PR_ATTACH_MIME_TAG (0x370E): MIME形式
        else if (propId === 0x370e) {
          att.mimeType = new TextDecoder("utf-8").decode(valBytes).replace(/\0+$/, "").toLowerCase();
        }
      }
    }
  }
};

const finalizeAttachment = (att, index) => {
  let filename = att.filename || "";
  let mimeType = att.mimeType || "";
  const detected = detectMimeFromBytes(att.data);

  if (!mimeType) mimeType = detected.mime;
  if (!filename) {
    filename = `attachment_${index + 1}${detected.ext}`;
  } else if (!filename.includes(".") && detected.ext) {
    filename += detected.ext;
  }

  return {
    filename,
    mimeType,
    size: att.data ? att.data.length : 0,
    content: att.data || new Uint8Array(0)
  };
};

// Outlook winmail.dat (TNEF) を正確に解凍・抽出する高精度パーサー
const parseTnefRobust = (buf) => {
  if (!buf || buf.length < 6) return null;
  const sig = buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] * 16777216);
  // TNEF signature: 0x223E9F78
  if (sig !== 0x223e9f78) return null;

  let offset = 6;
  let subject = "";
  let bodyText = "";
  let bodyHtml = "";
  const attachments = [];
  let currentAtt = null;

  while (offset < buf.length) {
    if (offset + 9 > buf.length) break;
    const level = buf[offset];
    const attrId = buf[offset + 1] | (buf[offset + 2] << 8);
    const attrType = buf[offset + 3] | (buf[offset + 4] << 8);
    const length = (buf[offset + 5] | (buf[offset + 6] << 8) | (buf[offset + 7] << 16) | (buf[offset + 8] * 16777216)) >>> 0;
    offset += 9;

    if (offset + length > buf.length) break;
    const data = buf.subarray(offset, offset + length);
    offset += length + 2; // 2 bytes checksum

    if (level === 1) { // メッセージレベル
      if (attrId === 0x8004) { // Subject
        subject = decodeTextSmart(data);
      } else if (attrId === 0x800c) { // Body text
        bodyText = decodeTextSmart(data);
      } else if (attrId === 0x9003) { // MAPIProps in Message
        // メッセージレベルのMAPIから件名やHTML本文を抽出
        try {
          extractMapiMessageProps(data, (res) => {
            if (res.subject && !subject) subject = res.subject;
            if (res.bodyText && !bodyText) bodyText = res.bodyText;
            if (res.bodyHtml && !bodyHtml) bodyHtml = res.bodyHtml;
          });
        } catch {
          // ignore
        }
      }
    } else if (level === 2) { // 添付ファイルレベル
      if (attrId === 0x9002) { // attAttachRendData (新規添付ファイルの区切り)
        if (currentAtt && (currentAtt.data || currentAtt.filename)) {
          attachments.push(finalizeAttachment(currentAtt, attachments.length));
        }
        currentAtt = { filename: "", data: null, mimeType: "" };
      }
      if (!currentAtt) currentAtt = { filename: "", data: null, mimeType: "" };

      if (attrId === 0x8010) { // attAttachTitle
        const title = decodeTextSmart(data);
        if (title && !currentAtt.filename) currentAtt.filename = title;
      } else if (attrId === 0x800f) { // attAttachData
        currentAtt.data = data;
      } else if (attrId === 0x9003) { // attMAPIProps in attachment
        try {
          extractMapiAttachmentProps(data, currentAtt);
        } catch {
          // ignore
        }
      }
    }
  }

  if (currentAtt && (currentAtt.data || currentAtt.filename)) {
    attachments.push(finalizeAttachment(currentAtt, attachments.length));
  }

  return {
    format: "tnef",
    subject: subject || "(件名なし)",
    body: {
      text: bodyText,
      html: bodyHtml
    },
    attachments
  };
};

// メッセージレベルのMAPIPropsをパースするヘルパー
const extractMapiMessageProps = (data, callback) => {
  if (data.length < 4) return;
  const numProps = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] * 16777216);
  let pos = 4;
  const res = {};

  for (let i = 0; i < numProps && pos + 4 <= data.length; i++) {
    const propType = data[pos] | (data[pos + 1] << 8);
    const propId = data[pos + 2] | (data[pos + 3] << 8);
    pos += 4;

    const isMulti = (propType & 0x1000) !== 0;
    const baseType = propType & ~0x1000;

    if (propId >= 0x8000 && propId <= 0xfffe) {
      if (pos + 20 > data.length) break;
      pos += 16;
      const kind = data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216);
      pos += 4;
      if (kind === 0) pos += 4;
      else {
        const nameLen = data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216);
        pos += 4 + nameLen + ((-nameLen) & 3);
      }
    }

    let valCount = isMulti ? (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216)) : 1;
    if (isMulti) pos += 4;

    for (let c = 0; c < valCount; c++) {
      let valLen = 0;
      if (baseType === 0x0002 || baseType === 0x000b) valLen = 2;
      else if (baseType === 0x0003 || baseType === 0x0004) valLen = 4;
      else if (baseType === 0x0005 || baseType === 0x0006 || baseType === 0x0007 || baseType === 0x0014 || baseType === 0x0040) valLen = 8;
      else if (baseType === 0x0048) valLen = 16;
      else {
        if (pos + 4 > data.length) break;
        valLen = (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] * 16777216)) >>> 0;
        pos += 4;
      }

      if (pos + valLen > data.length) break;
      const valBytes = data.subarray(pos, pos + valLen);
      pos += valLen + ((-valLen) & 3);

      if (c === 0 && valBytes.length > 0) {
        // PR_SUBJECT (0x0037)
        if (propId === 0x0037) {
          res.subject = baseType === 0x001f
            ? new TextDecoder("utf-16le").decode(valBytes).replace(/\0+$/, "")
            : decodeTextSmart(valBytes);
        }
        // PR_BODY (0x1000)
        else if (propId === 0x1000) {
          res.bodyText = baseType === 0x001f
            ? new TextDecoder("utf-16le").decode(valBytes).replace(/\0+$/, "")
            : decodeTextSmart(valBytes);
        }
        // PR_BODY_HTML (0x1013)
        else if (propId === 0x1013) {
          res.bodyHtml = decodeTextSmart(valBytes);
        }
      }
    }
  }

  callback(res);
};

// ==========================================
// メール / winmail.dat 解析・添付ファイル復元モーダル
// ==========================================
const EmailExtractorModal = ({ emailData, onImportAttachments, onClose }) => {
  const { file, parsed } = emailData;
  const [activeTab, setActiveTab] = useState("attachments"); // "attachments" | "body" | "info"
  const [copied, setCopied] = useState(false);
  const [importedIndices, setImportedIndices] = useState(new Set());

  const attachments = parsed?.attachments || [];
  const subject = parsed?.subject || "(件名なし)";
  const fromName = parsed?.from?.name || parsed?.from?.address || "不明な送信者";
  const fromAddress = parsed?.from?.address ? `<${parsed.from.address}>` : "";
  const dateStr = parsed?.date ? new Date(parsed.date).toLocaleString("ja-JP") : "日時不明";

  const textBody = parsed?.body?.text || "";
  const htmlBody = parsed?.body?.html || "";

  // 全添付ファイルをワークスペースに一括展開
  const handleImportAll = () => {
    onImportAttachments(attachments);
    onClose();
  };

  // 単一の添付ファイルをワークスペースに追加
  const handleImportSingle = (att, idx) => {
    onImportAttachments([att]);
    setImportedIndices((prev) => new Set([...prev, idx]));
  };

  // 添付ファイルをPCへダウンロード
  const handleDownloadSingle = (att, idx) => {
    const blob = new Blob([att.content], { type: att.mimeType || "application/octet-stream" });
    const name = att.filename || `attachment_${idx + 1}`;
    saveAs(blob, name);
  };

  // 本文をクリップボードにコピー
  const handleCopyBody = async () => {
    const content = textBody || htmlBody.replace(/<[^>]+>/g, "");
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("クリップボードへのコピーに失敗しました");
    }
  };

  // 本文をテキストファイル(.txt)としてワークスペースに追加
  const handleImportBodyAsTxt = () => {
    const content = textBody || htmlBody.replace(/<[^>]+>/g, "");
    const safeSubject = subject.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 30);
    const fileName = `メール本文_${safeSubject || "無題"}.txt`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const txtFile = new File([blob], fileName, { type: "text/plain" });
    onImportAttachments([], [txtFile]);
    onClose();
  };

  // 拡張子に応じたアイコン・バッジカラー
  const getFileBadge = (filename = "") => {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"].includes(ext)) {
      return { bg: "bg-blue-600/20 text-blue-400 border-blue-500/30", label: "画像" };
    }
    if (ext === "pdf") {
      return { bg: "bg-red-600/20 text-red-400 border-red-500/30", label: "PDF" };
    }
    if (["xlsx", "xls", "csv"].includes(ext)) {
      return { bg: "bg-emerald-600/20 text-emerald-400 border-emerald-500/30", label: "Excel" };
    }
    if (["docx", "doc"].includes(ext)) {
      return { bg: "bg-indigo-600/20 text-indigo-400 border-indigo-500/30", label: "Word" };
    }
    return { bg: "bg-gray-700 text-gray-300 border-gray-600", label: ext.toUpperCase() || "FILE" };
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn select-none">
      <div className="bg-gray-900 border border-gray-700/80 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-scaleUp">
        {/* モーダルヘッダー */}
        <div className="px-5 py-4 bg-gray-850 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-orange-600/20 border border-orange-500/30 flex items-center justify-center shrink-0 text-orange-400 shadow-inner">
              <Mail className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white truncate">
                  メール・添付ファイル復元プレビュー
                </h3>
                <span className="text-[11px] font-mono bg-orange-600/30 text-orange-300 px-2 py-0.5 rounded-full border border-orange-500/40">
                  {file.name} ({formatBytes(file.size)})
                </span>
              </div>
              <p className="text-xs text-gray-400 truncate mt-0.5">
                {file.name.toLowerCase().endsWith(".dat")
                  ? "Outlook独自のdat形式（TNEF）を安全に展開しました"
                  : "メールファイルから本文と添付ファイルを抽出しました"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* メール件名・差出人概要カード */}
        <div className="px-5 py-3 bg-gray-950/70 border-b border-gray-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-100 truncate">
              📌 件名: {subject}
            </p>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1 flex-wrap">
              <span>👤 差出人: <strong className="text-gray-300">{fromName}</strong> {fromAddress}</span>
              <span>🕒 日時: {dateStr}</span>
            </div>
          </div>

          {/* 添付ファイルがある場合の一括展開ボタン */}
          {attachments.length > 0 && (
            <button
              onClick={handleImportAll}
              className="px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-orange-600/20 transition-all flex items-center justify-center gap-1.5 shrink-0 self-start sm:self-auto cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>添付ファイル全{attachments.length}件を展開</span>
            </button>
          )}
        </div>

        {/* タブナビゲーション */}
        <div className="flex items-center border-b border-gray-800 px-5 bg-gray-900 shrink-0">
          <button
            onClick={() => setActiveTab("attachments")}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === "attachments"
                ? "border-orange-500 text-orange-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            <Paperclip className="w-4 h-4" />
            <span>救出された添付ファイル ({attachments.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("body")}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === "body"
                ? "border-orange-500 text-orange-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>メール本文</span>
          </button>
        </div>

        {/* タブコンテンツ */}
        <div className="flex-grow overflow-y-auto p-5 min-h-[300px] select-text">
          {/* 添付ファイルタブ */}
          {activeTab === "attachments" && (
            <div className="space-y-4">
              {attachments.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  <Paperclip className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p>添付ファイルは見つかりませんでした（本文のみのメールです）</p>
                  <p className="text-xs text-gray-600 mt-1">「メール本文」タブからメッセージ内容をご確認いただけます。</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {attachments.map((att, idx) => {
                    const badge = getFileBadge(att.filename);
                    const isImported = importedIndices.has(idx);
                    return (
                      <div
                        key={idx}
                        className="p-3.5 bg-gray-850 rounded-xl border border-gray-750 flex items-center justify-between gap-3 hover:border-gray-650 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`text-[10px] font-bold px-2 py-1 rounded border uppercase shrink-0 ${badge.bg}`}
                          >
                            {badge.label}
                          </span>
                          <div className="min-w-0">
                            <p
                              className="text-xs font-bold text-gray-200 truncate"
                              title={att.filename || `attachment_${idx + 1}`}
                            >
                              {att.filename || `attachment_${idx + 1}`}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {formatBytes(att.size || att.content?.length || 0)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 select-none">
                          <button
                            onClick={() => handleImportSingle(att, idx)}
                            disabled={isImported}
                            title="ワークスペースに読み込んで変換・編集"
                            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1 ${
                              isImported
                                ? "bg-emerald-900/30 border-emerald-700/50 text-emerald-300 opacity-80"
                                : "bg-orange-600 hover:bg-orange-500 border-orange-500 text-white cursor-pointer shadow-xs"
                            }`}
                          >
                            {isImported ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>追加済</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>追加</span>
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleDownloadSingle(att, idx)}
                            title="このファイルを直接パソコンに保存"
                            className="p-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* メール本文タブ */}
          {activeTab === "body" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-800 select-none">
                <span className="text-xs text-gray-400">
                  本文のプレビュー（個人情報は外部サーバーに送信されず、安全に表示されています）
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyBody}
                    className="px-2.5 py-1 bg-gray-800 hover:bg-gray-750 text-gray-300 hover:text-white border border-gray-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? "コピー完了！" : "本文をコピー"}</span>
                  </button>
                  <button
                    onClick={handleImportBodyAsTxt}
                    className="px-2.5 py-1 bg-gray-800 hover:bg-gray-750 text-orange-400 hover:text-orange-300 border border-gray-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>テキストとして追加</span>
                  </button>
                </div>
              </div>

              {htmlBody ? (
                <div
                  className="p-4 bg-white text-gray-900 rounded-xl overflow-auto max-h-[50vh] text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(htmlBody)
                  }}
                />
              ) : textBody ? (
                <pre className="p-4 bg-gray-950 text-gray-200 rounded-xl border border-gray-800 font-mono text-xs whitespace-pre-wrap leading-relaxed overflow-auto max-h-[50vh]">
                  {textBody}
                </pre>
              ) : (
                <div className="text-center py-12 text-gray-500 text-sm">
                  本文はありませんでした
                </div>
              )}
            </div>
          )}
        </div>

        {/* モーダルフッター */}
        <div className="px-5 py-3.5 bg-gray-850 border-t border-gray-800 flex items-center justify-between shrink-0 select-none">
          <span className="text-xs text-gray-400">
            🔒 すべてお使いのパソコン内だけで処理されています
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-750 text-gray-300 hover:text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              閉じる
            </button>
            {attachments.length > 0 && (
              <button
                onClick={handleImportAll}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-orange-600/20 flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>すべての添付ファイルを展開して閉じる</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Video Extractor Component (動画から静止画・サムネイルを最高画質で切り出す神モーダル)
const VideoExtractorModal = ({ file, onExtract, onClose }) => {
  const videoRef = useRef(null);
  const [videoSrc, setVideoSrc] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [capturedImages, setCapturedImages] = useState([]);
  const [isGeneratingAutoScenes, setIsGeneratingAutoScenes] = useState(false);
  const [autoScenes, setAutoScenes] = useState([]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    setVideoWidth(v.videoWidth || 0);
    setVideoHeight(v.videoHeight || 0);
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime || 0);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play();
      setIsPlaying(true);
    }
  };

  const stepTime = (delta) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    const newTime = Math.max(0, Math.min(duration, v.currentTime + delta));
    v.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (e) => {
    const v = videoRef.current;
    if (!v) return;
    const newTime = parseFloat(e.target.value);
    v.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // 現在のフレームを最高解像度でCanvasキャプチャ
  const captureCurrentFrame = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/png", 1.0);
    const timeFormatted = formatTimeWithFraction(v.currentTime).replace(":", "m").replace(".", "s");
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    const frameName = `${baseName}_${timeFormatted}.png`;
    const estimatedSize = Math.round((dataUrl.length * 3) / 4);

    const newImgItem = {
      id: generateId(),
      name: frameName,
      originalName: file.name,
      originalSrc: dataUrl,
      src: dataUrl,
      type: "image/png",
      size: estimatedSize,
      originalSize: estimatedSize,
      isFromVideo: true,
      timestampSeconds: v.currentTime
    };

    setCapturedImages((prev) => [...prev, newImgItem]);
  };

  // 自動等間隔シーン抽出 (4分割, 8分割, 12分割)
  const generateAutoScenes = async (count = 6) => {
    const v = videoRef.current;
    if (!v || !duration) return;

    setIsGeneratingAutoScenes(true);
    setAutoScenes([]);

    // 一時的な非表示video要素を作成してシーク
    const tempVideo = document.createElement("video");
    tempVideo.src = videoSrc;
    tempVideo.crossOrigin = "anonymous";
    tempVideo.muted = true;
    tempVideo.playsInline = true;

    await new Promise((res) => {
      tempVideo.onloadedmetadata = () => res();
    });

    const interval = duration / (count + 1);
    const scenes = [];

    for (let i = 1; i <= count; i++) {
      const targetTime = interval * i;
      tempVideo.currentTime = targetTime;
      await new Promise((res) => {
        tempVideo.onseeked = () => res();
      });

      const canvas = document.createElement("canvas");
      canvas.width = tempVideo.videoWidth;
      canvas.height = tempVideo.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/png", 1.0);
      const timeFormatted = formatTimeWithFraction(targetTime).replace(":", "m").replace(".", "s");
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const estimatedSize = Math.round((dataUrl.length * 3) / 4);

      scenes.push({
        id: generateId(),
        name: `${baseName}_scene_${i}_${timeFormatted}.png`,
        originalName: file.name,
        originalSrc: dataUrl,
        src: dataUrl,
        type: "image/png",
        size: estimatedSize,
        originalSize: estimatedSize,
        isFromVideo: true,
        timestampSeconds: targetTime,
        timeFormatted: formatTimeWithFraction(targetTime)
      });
    }

    setAutoScenes(scenes);
    setIsGeneratingAutoScenes(false);
  };

  const removeCaptured = (id) => {
    setCapturedImages((prev) => prev.filter((item) => item.id !== id));
  };

  const handleFinish = () => {
    if (capturedImages.length === 0) {
      alert("静止画がまだ取り込まれていません。「📸 このシーンを取り込む」を押して画像を追加してください。");
      return;
    }
    onExtract(capturedImages);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-gray-950 text-white select-none animate-fadeIn">
      {/* Header */}
      <div className="h-16 bg-gray-900 border-b border-gray-800 px-4 sm:px-6 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center space-x-3">
          <div className="bg-orange-600/20 p-2 rounded-lg border border-orange-500/30">
            <Film className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm sm:text-base text-gray-100 truncate max-w-[200px] sm:max-w-md">
                {file.name}
              </span>
              <span className="text-xs bg-orange-600/30 text-orange-400 border border-orange-500/40 px-2 py-0.5 rounded-full font-semibold">
                動画からサムネイル抽出
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              解像度: {videoWidth} × {videoHeight} px | 長さ: {formatTimeWithFraction(duration)}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleFinish}
            disabled={capturedImages.length === 0}
            className="flex items-center space-x-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all shadow-lg shadow-orange-600/20"
          >
            <Check className="w-4 h-4" />
            <span>選択した画像を取り込む ({capturedImages.length}枚)</span>
          </button>
          <button
            onClick={onClose}
            title="閉じる"
            className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: Video Player & Precision Controls */}
        <div className="flex-1 flex flex-col bg-black p-4 sm:p-6 justify-center items-center overflow-hidden">
          <div className="w-full max-w-4xl flex-1 flex flex-col justify-center items-center min-h-0">
            <video
              ref={videoRef}
              src={videoSrc}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              onClick={togglePlay}
              playsInline
              className="max-h-[60vh] max-w-full rounded-xl shadow-2xl border border-gray-800 object-contain cursor-pointer"
            />
          </div>

          {/* Timeline & Controls */}
          <div className="w-full max-w-4xl mt-4 space-y-3 bg-gray-900/90 backdrop-blur border border-gray-800 p-4 rounded-2xl shadow-xl">
            {/* Seek Bar */}
            <div className="flex items-center space-x-3">
              <span className="text-xs font-mono font-bold text-orange-400 min-w-[55px]">
                {formatTimeWithFraction(currentTime)}
              </span>
              <input
                type="range"
                min="0"
                max={duration || 100}
                step="0.01"
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-2 bg-gray-750 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
              <span className="text-xs font-mono text-gray-400 min-w-[55px] text-right">
                {formatTimeWithFraction(duration)}
              </span>
            </div>

            {/* Precision Button Group */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center space-x-1 sm:space-x-2">
                <button
                  type="button"
                  onClick={() => stepTime(-5)}
                  title="-5秒"
                  className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-mono border border-gray-700"
                >
                  -5s
                </button>
                <button
                  type="button"
                  onClick={() => stepTime(-1)}
                  title="-1秒"
                  className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-mono border border-gray-700"
                >
                  -1s
                </button>
                <button
                  type="button"
                  onClick={() => stepTime(-0.1)}
                  title="コマ戻し (-0.1秒)"
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-750 text-orange-400 rounded-lg text-xs font-bold border border-orange-500/30 shadow-xs"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                  <span>-0.1s</span>
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  className="p-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-full transition-transform active:scale-95 shadow-md shadow-orange-600/30 mx-1"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => stepTime(0.1)}
                  title="コマ送り (+0.1秒)"
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-750 text-orange-400 rounded-lg text-xs font-bold border border-orange-500/30 shadow-xs"
                >
                  <span>+0.1s</span>
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => stepTime(1)}
                  title="+1秒"
                  className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-mono border border-gray-700"
                >
                  +1s
                </button>
                <button
                  type="button"
                  onClick={() => stepTime(5)}
                  title="+5秒"
                  className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-mono border border-gray-700"
                >
                  +5s
                </button>
              </div>

              {/* Main Snapshot Capture Button */}
              <button
                type="button"
                onClick={captureCurrentFrame}
                className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-xl font-bold text-xs sm:text-sm shadow-lg shadow-orange-600/30 transition-transform active:scale-95 border border-orange-400/40"
              >
                <Camera className="w-4 h-4" />
                <span>📸 このシーンを静止画化</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Auto Scenes & Captured Thumbnails */}
        <div className="w-full lg:w-96 bg-gray-900 border-t lg:border-t-0 lg:border-l border-gray-800 flex flex-col overflow-hidden">
          {/* Auto Extract Toolbar */}
          <div className="p-4 border-b border-gray-800 space-y-2.5 bg-gray-850">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                自動シーン抽出 (おすすめ)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[4, 6, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={isGeneratingAutoScenes}
                  onClick={() => generateAutoScenes(n)}
                  className="py-1.5 px-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium border border-gray-700 transition-colors disabled:opacity-50"
                >
                  {n}シーン候補
                </button>
              ))}
            </div>

            {/* Auto Scenes Grid */}
            {autoScenes.length > 0 && (
              <div className="space-y-1.5 pt-2 animate-fadeIn">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>候補シーン一覧 (クリックで追加):</span>
                  <button
                    type="button"
                    onClick={() => setCapturedImages((prev) => [...prev, ...autoScenes])}
                    className="text-orange-400 hover:text-orange-300 font-semibold"
                  >
                    すべて追加 ({autoScenes.length})
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-1 bg-gray-900 rounded-lg border border-gray-800">
                  {autoScenes.map((scene) => (
                    <div
                      key={scene.id}
                      onClick={() => setCapturedImages((prev) => [...prev, scene])}
                      className="group relative cursor-pointer rounded overflow-hidden border border-gray-700 hover:border-orange-500 aspect-video transition-all shadow-xs hover:scale-105"
                    >
                      <img src={scene.src} alt={scene.name} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-center font-mono py-0.5 text-orange-300">
                        {scene.timeFormatted}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Captured Images List */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                取り込み予定の画像 ({capturedImages.length}枚)
              </span>
              {capturedImages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCapturedImages([])}
                  className="text-[11px] text-red-400 hover:text-red-300"
                >
                  全クリア
                </button>
              )}
            </div>

            {capturedImages.length === 0 ? (
              <div className="h-48 border-2 border-dashed border-gray-800 rounded-xl flex flex-col items-center justify-center p-4 text-center text-gray-500 space-y-2">
                <Camera className="w-8 h-8 text-gray-600" />
                <p className="text-xs">
                  「📸 このシーンを静止画化」を押すか、上の「自動シーン抽出」で静止画を追加してください。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {capturedImages.map((imgItem, idx) => (
                  <div
                    key={imgItem.id}
                    className="group relative bg-gray-800 rounded-lg overflow-hidden border border-gray-700 shadow-md animate-fadeIn"
                  >
                    <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
                      <img
                        src={imgItem.src}
                        alt={imgItem.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-1.5 flex items-center justify-between text-[11px] bg-gray-850">
                      <span className="font-mono text-orange-400 font-bold">
                        #{idx + 1} ({formatTimeWithFraction(imgItem.timestampSeconds)})
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCaptured(imgItem.id)}
                        className="text-gray-400 hover:text-red-400 p-0.5 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Image Editor Component
const ImageEditor = ({ file, onSave, onClose }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const canvasWrapperRef = useRef(null);

  // Tools: "select" | "hand" | "brush" | "rect" | "circle" | "text" | "stamp" | "mosaic" | "mask"
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(6); // 枠線の太さ・ブラシサイズ (初期値6px)
  const [fontSize, setFontSize] = useState(40);
  const [fontFamily, setFontFamily] = useState("sans"); // 選択中のフォント ("sans" | "serif" | "maru" | "hand" | "mono" | etc.)
  const [customFontInput, setCustomFontInput] = useState(""); // ユーザーPC直接指定フォント名
  const [textRotation, setTextRotation] = useState(0); // テキスト回転角度 (-180° 〜 180° / 0° 〜 360°)
  const [useTextBg, setUseTextBg] = useState(true);
  const [textBgColor, setTextBgColor] = useState("#ffffff"); // 座布団の背景色
  const [textShowBorder, setTextShowBorder] = useState(true); // 座布団の枠線あり/なし
  const [textBorderColor, setTextBorderColor] = useState("#d1d5db"); // 座布団の枠線色
  const [shapeStyle, setShapeStyle] = useState("stroke"); // 初期値を枠線(LINE)にして文字を囲みやすくする
  const [stampType, setStampType] = useState("approved");
  const [stampText, setStampText] = useState("佐藤");
  const [stampColor, setStampColor] = useState("#ff0000");
  const [stampSize, setStampSize] = useState(70);
  const [mosaicSize, setMosaicSize] = useState(16); // モザイクの粒の粗さ
  const [isDetectingFaces, setIsDetectingFaces] = useState(false);

  // 個別アスペクト比・トリミング＆位置配置（フレーミング）ステート
  const [cropPreset, setCropPreset] = useState("note_cover");
  const [customRatioW, setCustomRatioW] = useState(16);
  const [customRatioH, setCustomRatioH] = useState(9);
  const [customSizeW, setCustomSizeW] = useState(1280);
  const [customSizeH, setCustomSizeH] = useState(670);
  const [cropFitMode, setCropFitMode] = useState("crop"); // "crop" | "pad_white" | "pad_black" | "pad_blur"
  const [cropOffsetX, setCropOffsetX] = useState(50); // 0% (左) 〜 50% (中央) 〜 100% (右)
  const [cropOffsetY, setCropOffsetY] = useState(50); // 0% (上) 〜 50% (中央) 〜 100% (下)
  const [cropZoom, setCropZoom] = useState(1.0); // 1.0x 〜 3.0x

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

  // クロップ＆配置調整の適用
  const applyCropAndFraming = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;

    // クリーンな一時キャンバスを作成（クロップ枠・三分割点線・選択枠などのUI要素を完全に排除！）
    const cleanCanvas = document.createElement("canvas");
    cleanCanvas.width = canvas.width;
    cleanCanvas.height = canvas.height;
    const cleanCtx = cleanCanvas.getContext("2d");

    // 1. 純粋な元画像を描画
    cleanCtx.drawImage(imgRef.current, 0, 0);

    // 2. モザイクやスタンプ・ペン等の編集要素のみをクリーンに描画
    elements.forEach((el) => {
      cleanCtx.save();
      if (el.type === "brush" && el.points.length >= 2) {
        cleanCtx.beginPath();
        cleanCtx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          cleanCtx.lineTo(el.points[i].x, el.points[i].y);
        }
        cleanCtx.strokeStyle = el.color;
        cleanCtx.lineWidth = el.brushSize;
        cleanCtx.lineCap = "round";
        cleanCtx.lineJoin = "round";
        cleanCtx.stroke();
      } else if (el.type === "rect") {
        if (el.fillMode === "stroke") {
          cleanCtx.strokeStyle = el.color;
          cleanCtx.lineWidth = el.brushSize || 5;
          cleanCtx.strokeRect(el.x, el.y, el.w, el.h);
        } else {
          cleanCtx.fillStyle = el.color;
          cleanCtx.fillRect(el.x, el.y, el.w, el.h);
        }
      } else if (el.type === "circle") {
        cleanCtx.beginPath();
        cleanCtx.arc(el.x, el.y, el.r, 0, Math.PI * 2);
        if (el.fillMode === "stroke") {
          cleanCtx.strokeStyle = el.color;
          cleanCtx.lineWidth = el.brushSize || 5;
          cleanCtx.stroke();
        } else {
          cleanCtx.fillStyle = el.color;
          cleanCtx.fill();
        }
      } else if (el.type === "ellipse") {
        // 楕円（だ円）の描画
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        const rx = Math.abs(el.w / 2);
        const ry = Math.abs(el.h / 2);
        if (rx > 0 && ry > 0) {
          cleanCtx.beginPath();
          cleanCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          if (el.fillMode === "stroke") {
            cleanCtx.strokeStyle = el.color;
            cleanCtx.lineWidth = el.brushSize || 5;
            cleanCtx.stroke();
          } else {
            cleanCtx.fillStyle = el.color;
            cleanCtx.fill();
          }
        }
      } else if (el.type === "text") {
        drawTextElement(cleanCtx, el);
      } else if (el.type === "arrow") {
        drawArrowElement(cleanCtx, el);
      } else if (el.type === "callout") {
        drawCalloutElement(cleanCtx, el);
      } else if (el.type === "sticky") {
        drawStickyElement(cleanCtx, el);
      } else if (el.type === "mosaic") {
        const mSize = el.mosaicSize || 16;
        const xMin = Math.min(el.x, el.x + el.w);
        const yMin = Math.min(el.y, el.y + el.h);
        const mWidth = Math.abs(el.w);
        const mHeight = Math.abs(el.h);
        if (mWidth > 0 && mHeight > 0) {
          try {
            const imgData = cleanCtx.getImageData(xMin, yMin, mWidth, mHeight);
            const data = imgData.data;
            for (let py = 0; py < mHeight; py += mSize) {
              for (let px = 0; px < mWidth; px += mSize) {
                const pIndex = (py * mWidth + px) * 4;
                const r = data[pIndex];
                const g = data[pIndex + 1];
                const b = data[pIndex + 2];
                const a = data[pIndex + 3];
                cleanCtx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
                cleanCtx.fillRect(xMin + px, yMin + py, mSize, mSize);
              }
            }
          } catch (e) {
            console.error(e);
          }
        }
      } else if (el.type === "mask") {
        cleanCtx.fillStyle = el.color || "#000000";
        cleanCtx.fillRect(el.x, el.y, el.w, el.h);
      } else if (el.type === "stamp") {
        cleanCtx.save();
        cleanCtx.translate(el.x, el.y);
        cleanCtx.strokeStyle = el.color;
        cleanCtx.fillStyle = el.color;
        if (el.stampType === "approved" || el.stampType === "confidential" || el.stampType === "urgent") {
          const w = el.size * 1.5;
          const h = el.size * 0.7;
          cleanCtx.lineWidth = Math.max(3, w * 0.05);
          cleanCtx.beginPath();
          if (cleanCtx.roundRect) cleanCtx.roundRect(-w / 2, -h / 2, w, h, w * 0.1);
          else cleanCtx.rect(-w / 2, -h / 2, w, h);
          cleanCtx.stroke();
          cleanCtx.font = `bold ${h * 0.6}px "Meiryo", "MS Gothic", sans-serif`;
          cleanCtx.textAlign = "center";
          cleanCtx.textBaseline = "middle";
          cleanCtx.fillText(el.text, 0, 0);
        } else if (el.stampType === "done") {
          const r = el.size * 0.45;
          cleanCtx.lineWidth = Math.max(3, r * 0.08);
          cleanCtx.beginPath();
          cleanCtx.arc(0, 0, r, 0, Math.PI * 2);
          cleanCtx.stroke();
          cleanCtx.font = `bold ${r * 1.1}px "Meiryo", "MS Gothic", sans-serif`;
          cleanCtx.textAlign = "center";
          cleanCtx.textBaseline = "middle";
          cleanCtx.fillText(el.text, 0, 0);
        }
        cleanCtx.restore();
      }
      cleanCtx.restore();
    });

    const tempImg = cleanCanvas;
    const origW = cleanCanvas.width;
    const origH = cleanCanvas.height;

    // 目標アスペクト比およびターゲットサイズの計算
    let targetRatio = origW / origH;
    let targetW = origW;
    let targetH = origH;

    if (cropPreset === "note_cover") {
      targetW = 1280;
      targetH = 670;
      targetRatio = 1280 / 670;
    } else if (cropPreset === "x_post") {
      targetW = 1200;
      targetH = 675;
      targetRatio = 16 / 9;
    } else if (cropPreset === "insta_square") {
      targetW = 1080;
      targetH = 1080;
      targetRatio = 1 / 1;
    } else if (cropPreset === "insta_story") {
      targetW = 1080;
      targetH = 1920;
      targetRatio = 9 / 16;
    } else if (cropPreset === "ratio_4_3") {
      targetRatio = 4 / 3;
      targetW = origW;
      targetH = Math.round(origW / targetRatio);
    } else if (cropPreset === "ratio_3_2") {
      targetRatio = 3 / 2;
      targetW = origW;
      targetH = Math.round(origW / targetRatio);
    } else if (cropPreset === "ratio_golden") {
      targetRatio = 1.618;
      targetW = origW;
      targetH = Math.round(origW / 1.618);
    } else if (cropPreset === "custom_ratio") {
      const rw = Math.max(1, Number(customRatioW) || 1);
      const rh = Math.max(1, Number(customRatioH) || 1);
      targetRatio = rw / rh;
      targetW = origW;
      targetH = Math.round(origW / targetRatio);
    } else if (cropPreset === "custom_size") {
      targetW = Math.max(1, Number(customSizeW) || origW);
      targetH = Math.max(1, Number(customSizeH) || origH);
      targetRatio = targetW / targetH;
    }

    const outCanvas = document.createElement("canvas");
    outCanvas.width = targetW;
    outCanvas.height = targetH;
    const ctx = outCanvas.getContext("2d");

    const origRatio = origW / origH;
    const alignX = cropOffsetX / 100; // 0 = 左寄せ, 0.5 = 中央, 1 = 右寄せ
    const alignY = cropOffsetY / 100; // 0 = 上寄せ, 0.5 = 中央, 1 = 下寄せ

    let renderW, renderH;
    if (cropFitMode === "crop") {
      // 隙間なく切り抜き (Cover)
      if (origRatio > targetRatio) {
        renderH = targetH * cropZoom;
        renderW = renderH * origRatio;
      } else {
        renderW = targetW * cropZoom;
        renderH = renderW / origRatio;
      }
    } else {
      // ★写真全体を縮小して枠内に収める (Contain / 見切れなし)
      if (origRatio > targetRatio) {
        renderW = targetW * cropZoom;
        renderH = renderW / origRatio;
      } else {
        renderH = targetH * cropZoom;
        renderW = renderH * origRatio;
      }
    }

    const posX = (targetW - renderW) * alignX;
    const posY = (targetH - renderH) * alignY;

    if (cropFitMode === "crop") {
      ctx.drawImage(tempImg, posX, posY, renderW, renderH);
    } else if (cropFitMode === "pad_white") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(tempImg, posX, posY, renderW, renderH);
    } else if (cropFitMode === "pad_black") {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(tempImg, posX, posY, renderW, renderH);
    } else if (cropFitMode === "pad_transparent") {
      // 透過
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(tempImg, posX, posY, renderW, renderH);
    } else if (cropFitMode === "pad_blur") {
      // 背景ぼかし
      ctx.save();
      ctx.filter = "blur(24px) brightness(0.7)";
      const bgScale = Math.max(targetW / origW, targetH / origH) * 1.2;
      const bgW = origW * bgScale;
      const bgH = origH * bgScale;
      ctx.drawImage(tempImg, (targetW - bgW) / 2, (targetH - bgH) / 2, bgW, bgH);
      ctx.restore();

      ctx.drawImage(tempImg, posX, posY, renderW, renderH);
    }

    const newCroppedUrl = outCanvas.toDataURL("image/png", 1.0);
    const newCroppedImg = await loadImageAsync(newCroppedUrl);

    pushHistory(elements);
    imgRef.current = newCroppedImg;
    canvas.width = targetW;
    canvas.height = targetH;
    setElements([]); // クロップ適用後はベース画像に統合し要素リセット
    setSelectedId(null);
    setTool("select");
    redrawCanvas();
    alert("✨ 指定アスペクト比での配置・切り抜きを適用しました！");
  };

  // スポイト機能（EyeDropper API または ネイティブカラーピッカー）
  const pickColor = async (onColorPicked) => {
    if (window.EyeDropper) {
      try {
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        if (result && result.sRGBHex) {
          onColorPicked(result.sRGBHex);
        }
      } catch {
        // ユーザーがESC等でキャンセルした場合は何もしない
      }
    } else {
      const input = document.createElement("input");
      input.type = "color";
      input.onchange = (e) => onColorPicked(e.target.value);
      input.click();
    }
  };

  // 顔自動検出＆モザイク配置関数（APIキー不要・完全ローカル）
  const detectFaces = async () => {
    if (!imgRef.current) return;
    setIsDetectingFaces(true);
    try {
      let detectedBoxes = [];

      // 1. ブラウザ標準のFaceDetector APIを試行 (Chrome/Edge等)
      if (window.FaceDetector) {
        try {
          const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 10 });
          const faces = await detector.detect(imgRef.current);
          if (faces && faces.length > 0) {
            detectedBoxes = faces.map((f) => ({
              x: Math.round(f.boundingBox.x),
              y: Math.round(f.boundingBox.y),
              w: Math.round(f.boundingBox.width),
              h: Math.round(f.boundingBox.height)
            }));
          }
        } catch (e) {
          console.warn("Native FaceDetector failed, using local estimator fallback", e);
        }
      }

      // 2. ブラウザ標準API非対応または未検出時のローカル画像分析フォールバック
      if (detectedBoxes.length === 0 && canvasRef.current) {
        const cvs = document.createElement("canvas");
        const ctx = cvs.getContext("2d", { willReadFrequently: true });
        const scale = Math.min(1.0, 400 / imgRef.current.naturalWidth);
        cvs.width = Math.round(imgRef.current.naturalWidth * scale);
        cvs.height = Math.round(imgRef.current.naturalHeight * scale);
        ctx.drawImage(imgRef.current, 0, 0, cvs.width, cvs.height);

        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const data = imgData.data;
        const skinMap = new Uint8Array(cvs.width * cvs.height);

        // 肌色色域検出 (YCbCr / RGBベースの高速抽出)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const isSkin = r > 95 && g > 40 && b > 20 && (Math.max(r, g, b) - Math.min(r, g, b) > 15) && Math.abs(r - g) > 15 && r > g && r > b;
          if (isSkin) skinMap[i / 4] = 1;
        }

        // ブロックごとの密度クラスタリング
        const blockSize = Math.max(16, Math.round(cvs.width * 0.08));
        const gridW = Math.floor(cvs.width / blockSize);
        const gridH = Math.floor(cvs.height / blockSize);
        let maxDensity = 0;
        let bestX = 0, bestY = 0, bestW = 0, bestH = 0;

        for (let gy = 0; gy < gridH; gy++) {
          for (let gx = 0; gx < gridW; gx++) {
            let count = 0;
            for (let py = 0; py < blockSize; py++) {
              for (let px = 0; px < blockSize; px++) {
                const idx = (gy * blockSize + py) * cvs.width + (gx * blockSize + px);
                if (skinMap[idx]) count++;
              }
            }
            const density = count / (blockSize * blockSize);
            if (density > 0.35 && density > maxDensity) {
              maxDensity = density;
              bestX = Math.round((gx * blockSize) / scale);
              bestY = Math.round((gy * blockSize) / scale);
              bestW = Math.round((blockSize * 1.6) / scale);
              bestH = Math.round((blockSize * 1.8) / scale);
            }
          }
        }

        if (maxDensity > 0.35) {
          detectedBoxes.push({ x: bestX, y: bestY, w: bestW, h: bestH });
        }
      }

      if (detectedBoxes.length === 0) {
        alert("顔が自動検出されませんでした。左メニューの「モザイク(選)」または「黒塗り(選)」ツールで隠したい部分をドラッグして選択してください。");
        return;
      }

      pushHistory(elements);
      const newElements = detectedBoxes.map((box) => ({
        id: generateId(),
        type: "mosaic",
        x: Math.max(0, Math.round(box.x - box.w * 0.1)),
        y: Math.max(0, Math.round(box.y - box.h * 0.1)),
        w: Math.round(box.w * 1.2),
        h: Math.round(box.h * 1.2),
        mosaicSize: mosaicSize || 16
      }));

      setElements((prev) => [...prev, ...newElements]);
      alert(`✨ ${detectedBoxes.length}箇所の顔領域にモザイクを自動適用しました！\n枠線をドラッグして位置や大きさを微調整できます。`);
    } catch (err) {
      console.error("Face detection failed:", err);
      alert("顔の検出中にエラーが発生しました: " + err.message);
    } finally {
      setIsDetectingFaces(false);
    }
  };

  // Text Inline Editing state: { id?: string, text: string, canvasX: number, canvasY: number, fontSize: number, color: string, useBg: boolean, bgColor: string, showBorder: boolean, fontFamily: string }
  const [editingTextState, setEditingTextState] = useState(null);
  const textInputRef = useRef(null);

  // フローティング入力パネルのドラッグ移動ステート
  const [textPanelOffset, setTextPanelOffset] = useState({ x: 0, y: 0 });
  const isDraggingPanelRef = useRef(false);
  const panelDragStartRef = useRef({ mouseX: 0, mouseY: 0, initialOffsetX: 0, initialOffsetY: 0 });

  // 入力パネルのドラッグ移動開始ハンドラ（マウス＆タッチ対応）
  const handlePanelDragStart = (e) => {
    e.stopPropagation();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    isDraggingPanelRef.current = true;
    panelDragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      initialOffsetX: textPanelOffset.x,
      initialOffsetY: textPanelOffset.y
    };

    const handlePanelDragMove = (moveEvent) => {
      if (!isDraggingPanelRef.current) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const curX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const curY = moveEvent.touches ? moveEvent.touches[0].clientY : moveEvent.clientY;
      const dx = curX - panelDragStartRef.current.mouseX;
      const dy = curY - panelDragStartRef.current.mouseY;
      setTextPanelOffset({
        x: panelDragStartRef.current.initialOffsetX + dx,
        y: panelDragStartRef.current.initialOffsetY + dy
      });
    };

    const handlePanelDragEnd = () => {
      isDraggingPanelRef.current = false;
      window.removeEventListener("mousemove", handlePanelDragMove);
      window.removeEventListener("mouseup", handlePanelDragEnd);
      window.removeEventListener("touchmove", handlePanelDragMove);
      window.removeEventListener("touchend", handlePanelDragEnd);
    };

    window.addEventListener("mousemove", handlePanelDragMove, { passive: false });
    window.addEventListener("mouseup", handlePanelDragEnd);
    window.addEventListener("touchmove", handlePanelDragMove, { passive: false });
    window.addEventListener("touchend", handlePanelDragEnd);
  };

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

  // 図形の直接変形ドラッグ用ステート
  const isResizingElement = useRef(false);
  const resizeHandleType = useRef(null); // "se" | "sw" | "ne" | "nw" | "r"
  const resizeStartData = useRef(null);

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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        // 要素の複製ショートカット
        if (selectedId) {
          e.preventDefault();
          duplicateSelectedElement();
        }
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
      if (tool === "crop") {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        setCropZoom((prev) => Math.max(0.3, Math.min(4.0, parseFloat((prev + delta).toFixed(2)))));
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 1.15 : 0.87;
        applyZoom(zoomDelta, e.clientX, e.clientY);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoomScale, tool]);

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

  // 書体オプション（Windows / Mac 標準フォント + POP・手書き・等幅・カスタム）
  const FONT_OPTIONS = [
    { id: "sans", name: "ゴシック (標準)", label: "ゴシック体", desc: "標準・見やすい", family: '"Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif' },
    { id: "meiryo", name: "メイリオ", label: "メイリオ", desc: "Win標準・読みやすい", family: 'Meiryo, "メイリオ", "Hiragino Sans", sans-serif' },
    { id: "yugothic", name: "游ゴシック", label: "游ゴシック", desc: "Mac/Win標準・洗練", family: '"Yu Gothic", "游ゴシック体", YuGothic, "Hiragino Sans", sans-serif' },
    { id: "hiragino", name: "ヒラギノ角ゴ", label: "ヒラギノ", desc: "Mac/iOS標準・美麗", family: '"Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN", "Hiragino Sans", sans-serif' },
    { id: "serif", name: "明朝体", label: "明朝体", desc: "書類・上品・公式", family: '"Noto Serif JP", "Yu Mincho", "游明朝", "Hiragino Mincho ProN", "MS PMincho", serif' },
    { id: "maru", name: "丸ゴシック", label: "丸ゴシック", desc: "POP・やさしい", family: '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "BIZ UDPGothic", sans-serif' },
    { id: "impact", name: "太字インパクト", label: "太字・見出し", desc: "YouTubeサムネ向け", family: 'Impact, "Arial Black", "BIZ UDPGothic", sans-serif' },
    { id: "pop", name: "ポップ体", label: "POP体", desc: "チラシ・目立たせる", family: '"HG創英角ﾎﾟｯﾌﾟ体", "HGS創英角ﾎﾟｯﾌﾟ体", "Zen Maru Gothic", sans-serif' },
    { id: "hand", name: "手書き風", label: "手書き風", desc: "メモ・付箋向け", family: '"Klee One", "Yomogi", cursive, sans-serif' },
    { id: "mono", name: "等幅", label: "等幅", desc: "数字・コード", family: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
    { id: "custom", name: "✏️ PCフォント", label: "PCフォント", desc: "PC内のフォント名を直接指定", family: 'sans-serif' },
  ];

  const getFontString = (fontSize, fontFamilyKey = "sans", weight = "bold") => {
    switch (fontFamilyKey) {
      case "meiryo":
        return `${weight} ${fontSize}px Meiryo, "メイリオ", "Hiragino Sans", sans-serif`;
      case "yugothic":
        return `${weight} ${fontSize}px "Yu Gothic", "游ゴシック体", YuGothic, "Hiragino Sans", sans-serif`;
      case "hiragino":
        return `${weight} ${fontSize}px "Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN", "Hiragino Sans", sans-serif`;
      case "serif":
        return `${weight} ${fontSize}px "Noto Serif JP", "Yu Mincho", "游明朝", "Hiragino Mincho ProN", "MS PMincho", serif`;
      case "maru":
        return `${weight} ${fontSize}px "Zen Maru Gothic", "Hiragino Maru Gothic ProN", "BIZ UDPGothic", sans-serif`;
      case "impact":
        return `900 ${fontSize}px Impact, "Arial Black", "BIZ UDPGothic", sans-serif`;
      case "pop":
        return `${weight} ${fontSize}px "HG創英角ﾎﾟｯﾌﾟ体", "HGS創英角ﾎﾟｯﾌﾟ体", "Zen Maru Gothic", sans-serif`;
      case "hand":
        return `600 ${fontSize}px "Klee One", "Yomogi", cursive, sans-serif`;
      case "mono":
        return `${weight} ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      case "sans":
        return `${weight} ${fontSize}px "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif`;
      default:
        // PC環境の直接指定フォント（またはその他のフォント名）
        return `${weight} ${fontSize}px "${fontFamilyKey}", sans-serif`;
    }
  };

  const getFontCssFamily = (fontFamilyKey = "sans") => {
    switch (fontFamilyKey) {
      case "meiryo":
        return 'Meiryo, "メイリオ", "Hiragino Sans", sans-serif';
      case "yugothic":
        return '"Yu Gothic", "游ゴシック体", YuGothic, "Hiragino Sans", sans-serif';
      case "hiragino":
        return '"Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN", "Hiragino Sans", sans-serif';
      case "serif":
        return '"Noto Serif JP", "Yu Mincho", "游明朝", "Hiragino Mincho ProN", "MS PMincho", serif';
      case "maru":
        return '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "BIZ UDPGothic", sans-serif';
      case "impact":
        return 'Impact, "Arial Black", "BIZ UDPGothic", sans-serif';
      case "pop":
        return '"HG創英角ﾎﾟｯﾌﾟ体", "HGS創英角ﾎﾟｯﾌﾟ体", "Zen Maru Gothic", sans-serif';
      case "hand":
        return '"Klee One", "Yomogi", cursive, sans-serif';
      case "mono":
        return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      case "sans":
        return '"Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif';
      default:
        return `"${fontFamilyKey}", sans-serif`;
    }
  };

  // Helper to measure text multiline block dimensions
  const getTextMetrics = (ctx, el) => {
    const lines = String(el.text || "").split("\n");
    const fontSize = el.fontSize || 30;
    const lineHeight = fontSize * 1.3;
    const p = fontSize * 0.25;

    ctx.font = getFontString(fontSize, el.fontFamily || "sans", "bold");
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

  // Draw text element supporting multiline & za-buton (background fill & border options) & rotation
  const drawTextElement = (ctx, el) => {
    // 空文字または空白のみのテキストはゴミ描画防止のためスキップ
    if (!el.text || !el.text.trim()) return;

    const { lines, fontSize, lineHeight, p, maxWidth, totalHeight } = getTextMetrics(ctx, el);

    ctx.save();

    // 🔄 回転角度の適用 (テキスト矩形の中心を原点に回転)
    const rot = (el.rotation || 0) * (Math.PI / 180);
    const centerX = el.x + maxWidth / 2;
    const centerY = el.y + totalHeight / 2;

    if (rot !== 0) {
      ctx.translate(centerX, centerY);
      ctx.rotate(rot);
      ctx.translate(-centerX, -centerY);
    }

    ctx.font = getFontString(fontSize, el.fontFamily || "sans", "bold");
    ctx.textBaseline = "top";

    if (el.useBg) {
      // 背景色（未指定時は白またはダークグレー）
      ctx.fillStyle = el.bgColor || (el.color === "#ffffff" ? "#111827" : "#ffffff");
      const hasBorder = el.showBorder !== false; // デフォルトは枠線あり

      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(el.x - p, el.y - p, maxWidth + p * 2, totalHeight + p * 2, 4);
        ctx.fill();
        if (hasBorder) {
          ctx.strokeStyle = el.borderColor || (el.bgColor === "#000000" ? "#4b5563" : "#d1d5db");
          ctx.lineWidth = Math.max(1, fontSize * 0.03);
          ctx.stroke();
        }
      } else {
        ctx.fillRect(el.x - p, el.y - p, maxWidth + p * 2, totalHeight + p * 2);
        if (hasBorder) {
          ctx.strokeStyle = el.borderColor || (el.bgColor === "#000000" ? "#4b5563" : "#d1d5db");
          ctx.lineWidth = Math.max(1, fontSize * 0.03);
          ctx.strokeRect(el.x - p, el.y - p, maxWidth + p * 2, totalHeight + p * 2);
        }
      }
    }

    ctx.fillStyle = el.color;
    lines.forEach((line, idx) => {
      ctx.fillText(line, el.x, el.y + idx * lineHeight + p * 0.15);
    });

    ctx.restore();
  };

  // 矢印（アロー）の描画
  const drawArrowElement = (ctx, el) => {
    const fromX = el.x;
    const fromY = el.y;
    const toX = el.x + el.w;
    const toY = el.y + el.h;
    const len = Math.hypot(el.w, el.h);
    if (len < 6) return;

    const angle = Math.atan2(el.h, el.w);
    const lineWidth = el.brushSize || 6;
    const headLength = Math.max(16, Math.min(len * 0.45, lineWidth * 3.5));
    const headWidth = headLength * 0.65;

    ctx.save();
    ctx.strokeStyle = el.color || "#ff0000";
    ctx.fillStyle = el.color || "#ff0000";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 矢印の軸線
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    const shaftEndX = toX - (headLength * 0.7) * Math.cos(angle);
    const shaftEndY = toY - (headLength * 0.7) * Math.sin(angle);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // 矢じり（三角形）
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle) + headWidth * Math.sin(angle),
      toY - headLength * Math.sin(angle) - headWidth * Math.cos(angle)
    );
    ctx.lineTo(
      toX - headLength * 0.7 * Math.cos(angle),
      toY - headLength * 0.7 * Math.sin(angle)
    );
    ctx.lineTo(
      toX - headLength * Math.cos(angle) - headWidth * Math.sin(angle),
      toY - headLength * Math.sin(angle) + headWidth * Math.cos(angle)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // 吹き出し（スピーチバルーン）のしっぽ先端座標取得（未設定時は初期位置を自動計算）
  const getCalloutTailPos = (el) => {
    const xMin = Math.min(el.x, el.x + el.w);
    const yMin = Math.min(el.y, el.y + el.h);
    const w = Math.abs(el.w);
    const h = Math.abs(el.h);
    if (el.tailX !== undefined && el.tailY !== undefined) {
      return { x: el.tailX, y: el.tailY };
    }
    const tailDir = el.tailDirection || "bottom-left";
    const tailH = Math.max(25, h * 0.35);
    if (tailDir === "bottom-left") return { x: xMin + w * 0.2, y: yMin + h + tailH };
    if (tailDir === "bottom-right") return { x: xMin + w * 0.8, y: yMin + h + tailH };
    if (tailDir === "top-left") return { x: xMin + w * 0.2, y: yMin - tailH };
    if (tailDir === "top-right") return { x: xMin + w * 0.8, y: yMin - tailH };
    return { x: xMin + w * 0.2, y: yMin + h + tailH };
  };

  // 吹き出し（スピーチバルーン）の描画（しっぽ自由ドラッグ対応）
  const drawCalloutElement = (ctx, el) => {
    const xMin = Math.min(el.x, el.x + el.w);
    const yMin = Math.min(el.y, el.y + el.h);
    const w = Math.abs(el.w);
    const h = Math.abs(el.h);
    if (w < 20 || h < 20) return;

    ctx.save();
    const radius = Math.min(14, w * 0.15, h * 0.15);
    const cx = xMin + w / 2;
    const cy = yMin + h / 2;

    const tail = getCalloutTailPos(el);
    const tx = tail.x;
    const ty = tail.y;

    const dx = tx - cx;
    const dy = ty - cy;
    const baseW = Math.min(32, Math.max(16, (w + h) * 0.12));

    // 先端が上下・左右のどちらの辺から出るか判定
    const nx = dx / (w / 2 || 1);
    const ny = dy / (h / 2 || 1);
    const isVertical = Math.abs(ny) >= Math.abs(nx);

    // 吹き出しのパス構築（本体角丸四角形としっぽ三角形の一体結合パス）
    ctx.beginPath();
    ctx.moveTo(xMin + radius, yMin);

    // 上辺
    if (isVertical && ny < 0) {
      const baseX = Math.max(xMin + radius + baseW / 2, Math.min(xMin + w - radius - baseW / 2, tx));
      ctx.lineTo(baseX - baseW / 2, yMin);
      ctx.lineTo(tx, ty);
      ctx.lineTo(baseX + baseW / 2, yMin);
    }
    ctx.lineTo(xMin + w - radius, yMin);
    ctx.arcTo(xMin + w, yMin, xMin + w, yMin + radius, radius);

    // 右辺
    if (!isVertical && nx >= 0) {
      const baseY = Math.max(yMin + radius + baseW / 2, Math.min(yMin + h - radius - baseW / 2, ty));
      ctx.lineTo(xMin + w, baseY - baseW / 2);
      ctx.lineTo(tx, ty);
      ctx.lineTo(xMin + w, baseY + baseW / 2);
    }
    ctx.lineTo(xMin + w, yMin + h - radius);
    ctx.arcTo(xMin + w, yMin + h, xMin + w - radius, yMin + h, radius);

    // 下辺
    if (isVertical && ny >= 0) {
      const baseX = Math.max(xMin + radius + baseW / 2, Math.min(xMin + w - radius - baseW / 2, tx));
      ctx.lineTo(baseX + baseW / 2, yMin + h);
      ctx.lineTo(tx, ty);
      ctx.lineTo(baseX - baseW / 2, yMin + h);
    }
    ctx.lineTo(xMin + radius, yMin + h);
    ctx.arcTo(xMin, yMin + h, xMin, yMin + h - radius, radius);

    // 左辺
    if (!isVertical && nx < 0) {
      const baseY = Math.max(yMin + radius + baseW / 2, Math.min(yMin + h - radius - baseW / 2, ty));
      ctx.lineTo(xMin, baseY + baseW / 2);
      ctx.lineTo(tx, ty);
      ctx.lineTo(xMin, baseY - baseW / 2);
    }
    ctx.lineTo(xMin, yMin + radius);
    ctx.arcTo(xMin, yMin, xMin + radius, yMin, radius);
    ctx.closePath();

    // 塗りつぶし
    ctx.fillStyle = el.bgColor || "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.15)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fill();

    // 枠線
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = el.borderColor || el.color || "#000000";
    ctx.lineWidth = el.brushSize || 3;
    ctx.stroke();

    // テキストの描画
    if (el.text && el.text.trim()) {
      const fSize = el.fontSize || Math.max(14, Math.min(32, Math.round(h * 0.22)));
      ctx.font = getFontString(fSize, el.fontFamily || "sans", "bold");
      ctx.fillStyle = el.color || "#000000";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      const lines = el.text.split("\n");
      const lineHeight = fSize * 1.3;
      const startY = yMin + h / 2 - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, idx) => {
        ctx.fillText(line, xMin + w / 2, startY + idx * lineHeight);
      });
    }

    ctx.restore();
  };

  // 付箋（スティッキーノート）の描画（縦横比自由）
  const drawStickyElement = (ctx, el) => {
    const xMin = Math.min(el.x, el.x + el.w);
    const yMin = Math.min(el.y, el.y + el.h);
    const w = Math.abs(el.w);
    const h = Math.abs(el.h);
    if (w < 20 || h < 20) return;

    ctx.save();

    // ドロップシャドウ
    ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 5;

    // 付箋本体
    ctx.fillStyle = el.bgColor || "#fef08a";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(xMin, yMin, w, h, 2);
      ctx.fill();
    } else {
      ctx.fillRect(xMin, yMin, w, h);
    }

    // シャドウリセット
    ctx.shadowColor = "transparent";

    // 付箋の上部テープ風アクセント
    ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    ctx.fillRect(xMin, yMin, w, Math.min(18, h * 0.15));

    // 繊細な細い枠線
    ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(xMin, yMin, w, h);

    // テキストの描画
    if (el.text && el.text.trim()) {
      const fSize = el.fontSize || Math.max(14, Math.min(28, Math.round(h * 0.18)));
      ctx.font = getFontString(fSize, el.fontFamily || "hand", "500");
      ctx.fillStyle = el.color || "#1f2937";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      const padX = Math.max(10, w * 0.08);
      const padY = Math.max(12, h * 0.12);
      const lines = el.text.split("\n");
      const lineHeight = fSize * 1.35;

      lines.forEach((line, idx) => {
        const textY = yMin + padY + idx * lineHeight;
        if (textY + fSize <= yMin + h) {
          ctx.fillText(line, xMin + padX, textY, w - padX * 2);
        }
      });
    }

    ctx.restore();
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
      } else if (el.type === "ellipse") {
        // 楕円（だ円）のリアルタイム描画
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        const rx = Math.abs(el.w / 2);
        const ry = Math.abs(el.h / 2);
        if (rx > 0 && ry > 0) {
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          if (el.fillMode === "stroke") {
            ctx.strokeStyle = el.color;
            ctx.lineWidth = el.brushSize || 5;
            ctx.stroke();
          } else {
            ctx.fillStyle = el.color;
            ctx.fill();
          }
        }
      } else if (el.type === "text") {
        // インプレース直接文字入力中は二重表示を防ぐためキャンバス側の一時描画をスキップ
        if (editingTextState && editingTextState.id === el.id) {
          // skip
        } else {
          drawTextElement(ctx, el);
        }
      } else if (el.type === "arrow") {
        drawArrowElement(ctx, el);
      } else if (el.type === "callout") {
        drawCalloutElement(ctx, el);
      } else if (el.type === "sticky") {
        drawStickyElement(ctx, el);
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
      } else if (el.type === "mosaic") {
        const xMin = Math.min(el.x, el.x + el.w);
        const yMin = Math.min(el.y, el.y + el.h);
        const w = Math.abs(el.w);
        const h = Math.abs(el.h);
        if (w >= 2 && h >= 2) {
          const mSize = Math.max(4, el.mosaicSize || 16);
          const sampleW = Math.max(1, Math.floor(w / mSize));
          const sampleH = Math.max(1, Math.floor(h / mSize));

          const offCanvas = document.createElement("canvas");
          offCanvas.width = sampleW;
          offCanvas.height = sampleH;
          const offCtx = offCanvas.getContext("2d");
          if (offCtx) {
            offCtx.drawImage(imgRef.current, xMin, yMin, w, h, 0, 0, sampleW, sampleH);
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(offCanvas, 0, 0, sampleW, sampleH, xMin, yMin, w, h);
            ctx.restore();
          }
        }
      } else if (el.type === "mask") {
        const xMin = Math.min(el.x, el.x + el.w);
        const yMin = Math.min(el.y, el.y + el.h);
        const w = Math.abs(el.w);
        const h = Math.abs(el.h);
        ctx.fillStyle = "#000000";
        ctx.fillRect(xMin, yMin, w, h);
      }

      // Selection bounding box indicator
      if (selectedId === el.id && (tool === "select" || !tool)) {
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = Math.max(2, Math.min(6, canvas.width * 0.0025));
        ctx.setLineDash([8, 6]);

        if (el.type === "text") {
          const { p, maxWidth, totalHeight } = getTextMetrics(ctx, el);
          ctx.save();
          const rot = (el.rotation || 0) * (Math.PI / 180);
          const centerX = el.x + maxWidth / 2;
          const centerY = el.y + totalHeight / 2;
          if (rot !== 0) {
            ctx.translate(centerX, centerY);
            ctx.rotate(rot);
            ctx.translate(-centerX, -centerY);
          }
          ctx.strokeRect(
            el.x - p - 6,
            el.y - p - 6,
            maxWidth + p * 2 + 12,
            totalHeight + p * 2 + 12
          );
          ctx.restore();
        } else if (el.type === "rect" || el.type === "ellipse" || el.type === "callout" || el.type === "sticky" || el.type === "mosaic" || el.type === "mask") {
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

          // 四角形・楕円・吹き出し・付箋の四隅にドラッグ変形ハンドルを描画
          if (el.type === "rect" || el.type === "ellipse" || el.type === "callout" || el.type === "sticky") {
            const hSize = Math.max(8, Math.min(14, canvas.width * 0.006));
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#2563eb";
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            const corners = [
              { x: xMin - padding, y: yMin - padding },
              { x: xMax + padding, y: yMin - padding },
              { x: xMin - padding, y: yMax + padding },
              { x: xMax + padding, y: yMax + padding }
            ];
            corners.forEach((c) => {
              ctx.fillRect(c.x - hSize / 2, c.y - hSize / 2, hSize, hSize);
              ctx.strokeRect(c.x - hSize / 2, c.y - hSize / 2, hSize, hSize);
            });
            // 吹き出し（callout）の場合：しっぽ先端にぎゅっと引っ張れる丸いオレンジ色のハンドルを描画
            if (el.type === "callout") {
              const tail = getCalloutTailPos(el);
              ctx.save();
              ctx.beginPath();
              ctx.arc(tail.x, tail.y, 8, 0, Math.PI * 2);
              ctx.fillStyle = "#f97316";
              ctx.fill();
              ctx.lineWidth = 2.5;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();

              // 外側のリングインジケーター
              ctx.beginPath();
              ctx.arc(tail.x, tail.y, 12, 0, Math.PI * 2);
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "#f97316";
              ctx.stroke();
              ctx.restore();
            }

            ctx.setLineDash([8, 6]);
          }
        } else if (el.type === "arrow") {
          const fromX = el.x;
          const fromY = el.y;
          const toX = el.x + el.w;
          const toY = el.y + el.h;
          ctx.beginPath();
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(toX, toY);
          ctx.stroke();

          // 矢印の始点と先端にドラッグ変形ハンドルを描画
          const hSize = Math.max(8, Math.min(14, canvas.width * 0.006));
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#2563eb";
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          [ { x: fromX, y: fromY }, { x: toX, y: toY } ].forEach((p) => {
            ctx.fillRect(p.x - hSize / 2, p.y - hSize / 2, hSize, hSize);
            ctx.strokeRect(p.x - hSize / 2, p.y - hSize / 2, hSize, hSize);
          });
          ctx.setLineDash([8, 6]);
        } else if (el.type === "circle") {
          ctx.beginPath();
          ctx.arc(el.x, el.y, el.r + 6, 0, Math.PI * 2);
          ctx.stroke();

          // 正円の右端に変形ハンドルを描画
          const hSize = Math.max(8, Math.min(14, canvas.width * 0.006));
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#2563eb";
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.fillRect(el.x + el.r + 6 - hSize / 2, el.y - hSize / 2, hSize, hSize);
          ctx.strokeRect(el.x + el.r + 6 - hSize / 2, el.y - hSize / 2, hSize, hSize);
          ctx.setLineDash([8, 6]);
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

    // 🎯 リアルタイム・クロップ枠オーバーレイの描画 (tool === "crop" の時)
    if (tool === "crop") {
      const cropBox = getCropBox();
      if (cropBox) {
        ctx.save();
        // 1. 枠の外側を半透明黒（暗転）でマスクし、切り抜き範囲を浮き立たせる
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        // 上
        ctx.fillRect(0, 0, canvas.width, Math.max(0, cropBox.y));
        // 下
        ctx.fillRect(0, cropBox.y + cropBox.h, canvas.width, Math.max(0, canvas.height - (cropBox.y + cropBox.h)));
        // 左
        ctx.fillRect(0, cropBox.y, Math.max(0, cropBox.x), cropBox.h);
        // 右
        ctx.fillRect(cropBox.x + cropBox.w, cropBox.y, Math.max(0, canvas.width - (cropBox.x + cropBox.w)), cropBox.h);

        // 2. クロップ外枠線 (鮮やかなオレンジ)
        ctx.lineWidth = Math.max(2, Math.min(6, canvas.width * 0.003));
        ctx.strokeStyle = "#ea580c";
        ctx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);

        // 3. 三分割構図ガイド線 (Rule of Thirds)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        ctx.lineWidth = Math.max(1, Math.min(2.5, canvas.width * 0.0015));
        ctx.setLineDash([6, 6]);

        // 縦2本
        ctx.beginPath();
        ctx.moveTo(cropBox.x + cropBox.w / 3, cropBox.y);
        ctx.lineTo(cropBox.x + cropBox.w / 3, cropBox.y + cropBox.h);
        ctx.moveTo(cropBox.x + (cropBox.w * 2) / 3, cropBox.y);
        ctx.lineTo(cropBox.x + (cropBox.w * 2) / 3, cropBox.y + cropBox.h);

        // 横2本
        ctx.moveTo(cropBox.x, cropBox.y + cropBox.h / 3);
        ctx.lineTo(cropBox.x + cropBox.w, cropBox.y + cropBox.h / 3);
        ctx.moveTo(cropBox.x, cropBox.y + (cropBox.h * 2) / 3);
        ctx.lineTo(cropBox.x + cropBox.w, cropBox.y + (cropBox.h * 2) / 3);
        ctx.stroke();

        // 4. 四隅のL字ハンドル (白)
        ctx.setLineDash([]);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(3, Math.min(7, canvas.width * 0.004));
        const cornerSize = Math.min(cropBox.w, cropBox.h) * 0.08;

        // 左上
        ctx.beginPath();
        ctx.moveTo(cropBox.x, cropBox.y + cornerSize);
        ctx.lineTo(cropBox.x, cropBox.y);
        ctx.lineTo(cropBox.x + cornerSize, cropBox.y);
        // 右上
        ctx.moveTo(cropBox.x + cropBox.w - cornerSize, cropBox.y);
        ctx.lineTo(cropBox.x + cropBox.w, cropBox.y);
        ctx.lineTo(cropBox.x + cropBox.w, cropBox.y + cornerSize);
        // 右下
        ctx.moveTo(cropBox.x + cropBox.w, cropBox.y + cropBox.h - cornerSize);
        ctx.lineTo(cropBox.x + cropBox.w, cropBox.y + cropBox.h);
        ctx.lineTo(cropBox.x + cropBox.w - cornerSize, cropBox.y + cropBox.h);
        // 左下
        ctx.moveTo(cropBox.x + cornerSize, cropBox.y + cropBox.h);
        ctx.lineTo(cropBox.x, cropBox.y + cropBox.h);
        ctx.lineTo(cropBox.x, cropBox.y + cropBox.h - cornerSize);
        ctx.stroke();

        ctx.restore();
      }
    }
  };

  // クロッププレビュー枠の矩形計算 (キャンバス座標系)
  const getCropBox = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const origW = canvas.width;
    const origH = canvas.height;
    const origRatio = origW / origH;

    let targetRatio = origRatio;
    if (cropPreset === "note_cover") targetRatio = 1280 / 670;
    else if (cropPreset === "x_post") targetRatio = 16 / 9;
    else if (cropPreset === "insta_square") targetRatio = 1 / 1;
    else if (cropPreset === "insta_story") targetRatio = 9 / 16;
    else if (cropPreset === "ratio_4_3") targetRatio = 4 / 3;
    else if (cropPreset === "ratio_3_2") targetRatio = 3 / 2;
    else if (cropPreset === "ratio_golden") targetRatio = 1.618;
    else if (cropPreset === "custom_ratio") {
      const rw = Math.max(1, Number(customRatioW) || 1);
      const rh = Math.max(1, Number(customRatioH) || 1);
      targetRatio = rw / rh;
    } else if (cropPreset === "custom_size") {
      const sw = Math.max(1, Number(customSizeW) || origW);
      const sh = Math.max(1, Number(customSizeH) || origH);
      targetRatio = sw / sh;
    }

    let boxW, boxH;
    if (origRatio > targetRatio) {
      boxH = origH / cropZoom;
      boxW = boxH * targetRatio;
    } else {
      boxW = origW / cropZoom;
      boxH = boxW / targetRatio;
    }

    const maxOffsetX = origW - boxW;
    const maxOffsetY = origH - boxH;
    const boxX = maxOffsetX * (cropOffsetX / 100);
    const boxY = maxOffsetY * (cropOffsetY / 100);

    return { x: boxX, y: boxY, w: boxW, h: boxH, targetRatio };
  };

  const isDraggingCrop = useRef(false);
  const cropDragStartPos = useRef({ x: 0, y: 0, startX: 50, startY: 50 });

  // Hit testing for selection & double-click
  const detectHitElement = (canvasPos) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");

    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.type === "text") {
        const { p, maxWidth, totalHeight } = getTextMetrics(ctx, el);
        let checkX = canvasPos.x;
        let checkY = canvasPos.y;
        if (el.rotation) {
          const rad = (-el.rotation * Math.PI) / 180;
          const cx = el.x + maxWidth / 2;
          const cy = el.y + totalHeight / 2;
          const dx = canvasPos.x - cx;
          const dy = canvasPos.y - cy;
          checkX = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
          checkY = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
        }
        if (
          checkX >= el.x - p - 8 &&
          checkX <= el.x + maxWidth + p + 8 &&
          checkY >= el.y - p - 8 &&
          checkY <= el.y + totalHeight + p + 8
        ) {
          return el;
        }
      } else if (el.type === "rect" || el.type === "callout" || el.type === "sticky" || el.type === "mosaic" || el.type === "mask") {
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
      } else if (el.type === "arrow") {
        // 矢印の当たり判定（線分と点との距離計算）
        const x1 = el.x;
        const y1 = el.y;
        const x2 = el.x + el.w;
        const y2 = el.y + el.h;
        const lineLenSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        let dist;
        if (lineLenSq === 0) {
          dist = Math.hypot(canvasPos.x - x1, canvasPos.y - y1);
        } else {
          const t = Math.max(0, Math.min(1, ((canvasPos.x - x1) * (x2 - x1) + (canvasPos.y - y1) * (y2 - y1)) / lineLenSq));
          const projX = x1 + t * (x2 - x1);
          const projY = y1 + t * (y2 - y1);
          dist = Math.hypot(canvasPos.x - projX, canvasPos.y - projY);
        }
        if (dist <= (el.brushSize || 6) + 12) {
          return el;
        }
      } else if (el.type === "circle") {
        const dist = Math.sqrt((canvasPos.x - el.x) ** 2 + (canvasPos.y - el.y) ** 2);
        if (dist <= el.r + 8) {
          return el;
        }
      } else if (el.type === "ellipse") {
        // 楕円の当たり判定（数式に基づき判定）
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        const rx = Math.abs(el.w / 2) + 8;
        const ry = Math.abs(el.h / 2) + 8;
        if (rx > 0 && ry > 0) {
          const normalized = ((canvasPos.x - cx) / rx) ** 2 + ((canvasPos.y - cy) / ry) ** 2;
          if (normalized <= 1) {
            return el;
          }
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
        if (el.type === "callout") {
          const currentTail = getCalloutTailPos(el);
          return {
            ...el,
            x: el.x + dx,
            y: el.y + dy,
            tailX: currentTail.x + dx,
            tailY: currentTail.y + dy
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

  // 選択中要素のリサイズハンドル（四隅・矢印先端・吹き出しのしっぽ等）の当たり判定
  const getResizeHandleAtPos = (pos, el) => {
    if (!el) return null;
    const padding = 6;
    const hitRadius = 14;

    // 吹き出しのしっぽ先端ハンドルの当たり判定
    if (el.type === "callout") {
      const tail = getCalloutTailPos(el);
      if (Math.hypot(pos.x - tail.x, pos.y - tail.y) <= 18) {
        return "tail";
      }
    }

    if (el.type === "rect" || el.type === "ellipse" || el.type === "callout" || el.type === "sticky") {
      const xMin = Math.min(el.x, el.x + el.w) - padding;
      const xMax = Math.max(el.x, el.x + el.w) + padding;
      const yMin = Math.min(el.y, el.y + el.h) - padding;
      const yMax = Math.max(el.y, el.y + el.h) + padding;

      if (Math.hypot(pos.x - xMax, pos.y - yMax) <= hitRadius) return "se"; // 右下
      if (Math.hypot(pos.x - xMin, pos.y - yMax) <= hitRadius) return "sw"; // 左下
      if (Math.hypot(pos.x - xMax, pos.y - yMin) <= hitRadius) return "ne"; // 右上
      if (Math.hypot(pos.x - xMin, pos.y - yMin) <= hitRadius) return "nw"; // 左上
    } else if (el.type === "arrow") {
      const fromX = el.x;
      const fromY = el.y;
      const toX = el.x + el.w;
      const toY = el.y + el.h;
      if (Math.hypot(pos.x - toX, pos.y - toY) <= hitRadius) return "se"; // 先端
      if (Math.hypot(pos.x - fromX, pos.y - fromY) <= hitRadius) return "nw"; // 根元
    } else if (el.type === "circle") {
      if (Math.hypot(pos.x - (el.x + el.r + 6), pos.y - el.y) <= hitRadius) return "r";
    }
    return null;
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

    // 画面直接入力中にキャンバスの別の場所をクリックした場合、自動で文字を確定保存
    if (editingTextState) {
      submitText();
    }

    isMouseDown.current = true;
    const pos = getCanvasCoords(clientX, clientY);

    if (tool === "crop") {
      isDraggingCrop.current = true;
      cropDragStartPos.current = {
        x: clientX,
        y: clientY,
        startX: cropOffsetX,
        startY: cropOffsetY
      };
      return;
    }

    if (tool === "select") {
      // 選択中要素のリサイズハンドルをつかんだか判定（直接変形ドラッグ開始）
      if (selectedId) {
        const curEl = elements.find((e) => e.id === selectedId);
        const handle = getResizeHandleAtPos(pos, curEl);
        if (handle) {
          pushHistory(elements);
          isResizingElement.current = true;
          resizeHandleType.current = handle;
          resizeStartData.current = {
            pos,
            origX: curEl.x,
            origY: curEl.y,
            origW: curEl.w,
            origH: curEl.h,
            origR: curEl.r,
            origTailX: curEl.tailX !== undefined ? curEl.tailX : (curEl.type === "callout" ? getCalloutTailPos(curEl).x : undefined),
            origTailY: curEl.tailY !== undefined ? curEl.tailY : (curEl.type === "callout" ? getCalloutTailPos(curEl).y : undefined)
          };
          return;
        }
      }

      const hit = detectHitElement(pos);
      if (hit) {
        setSelectedId(hit.id);
        // 既存テキスト選択時にもスタイル（サイズ・色・座布団）をキープ
        if (hit.type === "text" && hit.fontSize) {
          setFontSize(hit.fontSize);
          if (hit.color) setColor(hit.color);
          if (hit.useBg !== undefined) setUseTextBg(hit.useBg);
          if (hit.bgColor) setTextBgColor(hit.bgColor);
          if (hit.showBorder !== undefined) setTextShowBorder(hit.showBorder);
        }
        isDraggingElement.current = true;
        dragStartPos.current = pos;
        if (hit.type === "brush") {
          elementStartPos.current = hit.points.map((p) => ({ ...p }));
        } else if (hit.type === "callout") {
          const currentTail = getCalloutTailPos(hit);
          elementStartPos.current = { x: hit.x, y: hit.y, tailX: currentTail.x, tailY: currentTail.y };
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
    } else if (tool === "rect" || tool === "ellipse" || tool === "callout" || tool === "sticky" || tool === "mosaic" || tool === "mask") {
      pushHistory(elements);
      const newEl = {
        id: generateId(),
        type: tool,
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
        color: color,
        fillMode: (tool === "callout" || tool === "sticky") ? "fill" : shapeStyle,
        brushSize: brushSize,
        fontSize: fontSize || 24,
        text: tool === "sticky" ? "メモ" : tool === "callout" ? "吹き出し" : "",
        bgColor: tool === "sticky" ? "#fef08a" : "#ffffff",
        borderColor: color || "#2563eb",
        tailDirection: "bottom-left",
        mosaicSize: mosaicSize || 16
      };
      setElements((prev) => [...prev, newEl]);
      activeShapeId.current = newEl.id;
      isDrawingShape.current = true;
      dragStartPos.current = pos;
    } else if (tool === "arrow") {
      pushHistory(elements);
      const newEl = {
        id: generateId(),
        type: "arrow",
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
        color: color,
        brushSize: Math.max(3, brushSize)
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
      setTextPanelOffset({ x: 0, y: 0 });
      setEditingTextState({
        id: null,
        text: "",
        canvasX: pos.x,
        canvasY: pos.y,
        fontSize: fontSize,
        color: color,
        useBg: useTextBg,
        bgColor: textBgColor,
        showBorder: textShowBorder,
        borderColor: textBorderColor,
        fontFamily: fontFamily,
        rotation: textRotation || 0
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

    if (tool === "crop" && isDraggingCrop.current) {
      const dx = clientX - cropDragStartPos.current.x;
      const dy = clientY - cropDragStartPos.current.y;
      // 感度調整（ドラッグでスムーズに動くように）
      const sensitivity = 0.25;
      const newX = Math.max(0, Math.min(100, cropDragStartPos.current.startX - dx * sensitivity));
      const newY = Math.max(0, Math.min(100, cropDragStartPos.current.startY - dy * sensitivity));
      setCropOffsetX(Math.round(newX));
      setCropOffsetY(Math.round(newY));
      return;
    }

    if (tool === "select" && isResizingElement.current && selectedId && resizeStartData.current) {
      const { pos: startPos, origX, origY, origW, origH, origR } = resizeStartData.current;
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      const handle = resizeHandleType.current;

      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== selectedId) return el;
          if (el.type === "callout" && handle === "tail") {
            // 吹き出しのしっぽをマウスの動きに合わせて引っ張る
            return {
              ...el,
              tailX: Math.round(pos.x),
              tailY: Math.round(pos.y)
            };
          }
          if (el.type === "rect" || el.type === "ellipse" || el.type === "callout" || el.type === "sticky") {
            let newX = origX;
            let newY = origY;
            let newW = origW;
            let newH = origH;

            if (handle === "se") {
              newW = origW + dx;
              newH = origH + dy;
            } else if (handle === "sw") {
              newX = origX + dx;
              newW = origW - dx;
              newH = origH + dy;
            } else if (handle === "ne") {
              newY = origY + dy;
              newW = origW + dx;
              newH = origH - dy;
            } else if (handle === "nw") {
              newX = origX + dx;
              newY = origY + dy;
              newW = origW - dx;
              newH = origH - dy;
            }
            return { ...el, x: newX, y: newY, w: newW, h: newH };
          } else if (el.type === "arrow") {
            if (handle === "se") {
              return { ...el, w: origW + dx, h: origH + dy };
            } else if (handle === "nw") {
              return { ...el, x: origX + dx, y: origY + dy, w: origW - dx, h: origH - dy };
            }
          } else if (el.type === "circle" && handle === "r") {
            return { ...el, r: Math.max(5, origR + dx) };
          }
          return el;
        })
      );
      return;
    }

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
          } else if (el.type === "callout") {
            const start = elementStartPos.current;
            return {
              ...el,
              x: start.x + dx,
              y: start.y + dy,
              tailX: start.tailX !== undefined ? start.tailX + dx : undefined,
              tailY: start.tailY !== undefined ? start.tailY + dy : undefined
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
    } else if ((tool === "rect" || tool === "ellipse" || tool === "callout" || tool === "sticky" || tool === "arrow" || tool === "mosaic" || tool === "mask") && isDrawingShape.current && activeShapeId.current) {
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
    if (isDrawingShape.current && activeShapeId.current) {
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== activeShapeId.current) return el;
          // もしクリックだけでドラッグしなかった場合、使いやすい初期サイズを付与
          if (Math.abs(el.w || 0) < 10 && Math.abs(el.h || 0) < 10) {
            if (el.type === "arrow") {
              return { ...el, w: 100, h: -70 };
            } else if (el.type === "callout") {
              return {
                ...el,
                w: 180,
                h: 90,
                tailX: el.x + 36,
                tailY: el.y + 90 + 35
              };
            } else if (el.type === "sticky") {
              return { ...el, w: 140, h: 140 };
            } else if (el.type === "rect") {
              return { ...el, w: 140, h: 90 };
            } else if (el.type === "ellipse") {
              return { ...el, w: 140, h: 90 };
            }
          }
          // rect, ellipse, callout, sticky の正規化（負の幅高さを解消して操作しやすくする）
          if (["rect", "ellipse", "callout", "sticky"].includes(el.type)) {
            const minX = Math.min(el.x, el.x + el.w);
            const minY = Math.min(el.y, el.y + el.h);
            const w = Math.abs(el.w);
            const h = Math.abs(el.h);
            if (el.type === "callout" && el.tailX === undefined) {
              return {
                ...el,
                x: minX,
                y: minY,
                w,
                h,
                tailX: minX + w * 0.2,
                tailY: minY + h + Math.max(30, h * 0.35)
              };
            }
            return { ...el, x: minX, y: minY, w, h };
          }
          return el;
        })
      );
      setSelectedId(activeShapeId.current);
      setTool("select");
    }
    isPanningRef.current = false;
    isMouseDown.current = false;
    isDraggingElement.current = false;
    isResizingElement.current = false;
    resizeHandleType.current = null;
    resizeStartData.current = null;
    isDrawingShape.current = false;
    isDraggingCrop.current = false;
    activeShapeId.current = null;
  };

  // クロップ設定やツール変更時にリアルタイムで枠線を再描画
  useEffect(() => {
    drawAll();
  }, [
    tool,
    cropPreset,
    customRatioW,
    customRatioH,
    customSizeW,
    customSizeH,
    cropOffsetX,
    cropOffsetY,
    cropZoom,
    cropFitMode,
    elements,
    selectedId
  ]);

  // Double Click handler -> Trigger inline text re-editing
  const handleDoubleClick = (e) => {
    const pos = getCanvasCoords(e.clientX, e.clientY);
    const hit = detectHitElement(pos);
    if (hit) {
      setTextPanelOffset({ x: 0, y: 0 });
      if (hit.type === "text") {
        setEditingTextState({
          id: hit.id,
          targetType: "text",
          text: hit.text,
          canvasX: hit.x,
          canvasY: hit.y,
          fontSize: hit.fontSize,
          color: hit.color,
          useBg: hit.useBg,
          bgColor: hit.bgColor || "#ffffff",
          showBorder: hit.showBorder !== false,
          borderColor: hit.borderColor || textBorderColor,
          fontFamily: hit.fontFamily || fontFamily,
          rotation: hit.rotation || 0
        });
        if (hit.borderColor) setTextBorderColor(hit.borderColor);
        if (hit.rotation !== undefined) setTextRotation(hit.rotation);
        setSelectedId(hit.id);
      } else if (hit.type === "callout" || hit.type === "sticky") {
        const xMin = Math.min(hit.x, hit.x + hit.w);
        const yMin = Math.min(hit.y, hit.y + hit.h);
        setEditingTextState({
          id: hit.id,
          targetType: hit.type,
          text: hit.text || "",
          canvasX: xMin + 16,
          canvasY: yMin + 16,
          fontSize: hit.fontSize || (hit.type === "sticky" ? 22 : 24),
          color: hit.color || (hit.type === "sticky" ? "#1f2937" : "#000000"),
          useBg: false,
          showBorder: false,
          fontFamily: hit.fontFamily || (hit.type === "sticky" ? "hand" : fontFamily)
        });
        setSelectedId(hit.id);
      }
    }
  };

  // Submit Text (either new or existing)
  const submitText = () => {
    if (!editingTextState) return;

    const trimmed = (editingTextState.text || "").trim();
    if (!trimmed && editingTextState.targetType !== "callout" && editingTextState.targetType !== "sticky") {
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
        prev.map((el) => {
          if (el.id !== editingTextState.id) return el;
          if (el.type === "callout" || el.type === "sticky") {
            return {
              ...el,
              text: editingTextState.text,
              fontSize: editingTextState.fontSize || el.fontSize,
              color: editingTextState.color || el.color,
              fontFamily: editingTextState.fontFamily || el.fontFamily || (el.type === "sticky" ? "hand" : fontFamily)
            };
          }
          return {
            ...el,
            text: editingTextState.text,
            fontSize: editingTextState.fontSize,
            color: editingTextState.color,
            useBg: editingTextState.useBg,
            bgColor: editingTextState.bgColor || "#ffffff",
            showBorder: editingTextState.showBorder !== false,
            borderColor: editingTextState.borderColor || el.borderColor || textBorderColor,
            fontFamily: editingTextState.fontFamily || el.fontFamily || fontFamily,
            rotation: editingTextState.rotation !== undefined ? editingTextState.rotation : (el.rotation || 0)
          };
        })
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
        useBg: editingTextState.useBg,
        bgColor: editingTextState.bgColor || "#ffffff",
        showBorder: editingTextState.showBorder !== false,
        borderColor: editingTextState.borderColor || textBorderColor,
        fontFamily: editingTextState.fontFamily || fontFamily,
        rotation: editingTextState.rotation || 0
      };
      setElements((prev) => [...prev, newEl]);
      setSelectedId(newEl.id);
      setTool("select");
    }

    // 作業中のフォントサイズやスタイルをキープ（次回に引き継ぐ）
    if (editingTextState.fontSize) setFontSize(editingTextState.fontSize);
    if (editingTextState.fontFamily) setFontFamily(editingTextState.fontFamily);
    if (editingTextState.rotation !== undefined) setTextRotation(editingTextState.rotation);
    if (editingTextState.color) setColor(editingTextState.color);
    if (editingTextState.useBg !== undefined) setUseTextBg(editingTextState.useBg);
    if (editingTextState.bgColor) setTextBgColor(editingTextState.bgColor);
    if (editingTextState.showBorder !== undefined) setTextShowBorder(editingTextState.showBorder);
    if (editingTextState.borderColor) setTextBorderColor(editingTextState.borderColor);

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

  // 選択中の要素（テキスト・図形等）を複製 (Ctrl+D / Cmd+D)
  const duplicateSelectedElement = () => {
    if (!selectedId) return;
    const target = elements.find((el) => el.id === selectedId);
    if (!target) return;
    pushHistory(elements);

    const offset = 24; // 少し右下にずらして見やすく複製
    let duplicated;
    if (target.type === "brush") {
      duplicated = {
        ...target,
        id: generateId(),
        points: target.points.map((p) => ({ x: p.x + offset, y: p.y + offset }))
      };
    } else {
      duplicated = {
        ...target,
        id: generateId(),
        x: (target.x || 0) + offset,
        y: (target.y || 0) + offset
      };
    }

    setElements((prev) => [...prev, duplicated]);
    setSelectedId(duplicated.id);
  };

  // Update selected element property directly
  const updateSelectedElement = (updates) => {
    if (!selectedId) return;
    setElements((prev) =>
      prev.map((el) => (el.id === selectedId ? { ...el, ...updates } : el))
    );
    // スタイル変更時も現在のフォントサイズやカラーをキープ
    if (updates.fontSize) setFontSize(updates.fontSize);
    if (updates.color) setColor(updates.color);
    if (updates.useBg !== undefined) setUseTextBg(updates.useBg);
    if (updates.bgColor) setTextBgColor(updates.bgColor);
    if (updates.showBorder !== undefined) setTextShowBorder(updates.showBorder);
    if (updates.borderColor) setTextBorderColor(updates.borderColor);
  };

  const selectedElement = elements.find((e) => e.id === selectedId);

  // 上部固定スリムテキストツールバー用のアクティブ判定とハンドラー
  const isTextModeActive = Boolean(
    editingTextState ||
    (selectedElement && selectedElement.type === "text") ||
    tool === "text"
  );

  const activeTextEl = editingTextState || (selectedElement?.type === "text" ? selectedElement : null);
  const activeFontSize = activeTextEl ? (activeTextEl.fontSize || fontSize) : fontSize;
  const activeFontFamily = activeTextEl ? (activeTextEl.fontFamily || fontFamily) : fontFamily;
  const activeColor = activeTextEl ? (activeTextEl.color || color) : color;
  const activeUseBg = activeTextEl ? (activeTextEl.useBg ?? useTextBg) : useTextBg;
  const activeBgColor = activeTextEl ? (activeTextEl.bgColor || textBgColor) : textBgColor;
  const activeShowBorder = activeTextEl ? (activeTextEl.showBorder ?? textShowBorder) : textShowBorder;
  const activeBorderColor = activeTextEl ? (activeTextEl.borderColor || textBorderColor) : textBorderColor;
  const activeRotation = activeTextEl ? (activeTextEl.rotation ?? textRotation) : textRotation;

  const handleToolbarFontSize = (size) => {
    const s = Math.max(8, Math.min(200, Number(size) || 24));
    setFontSize(s);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, fontSize: s }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ fontSize: s });
    }
  };

  const handleToolbarFontFamily = (family) => {
    setFontFamily(family);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, fontFamily: family }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ fontFamily: family });
    }
  };

  const handleToolbarColor = (c) => {
    setColor(c);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, color: c }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ color: c });
    }
  };

  const handleToolbarUseBg = (val) => {
    setUseTextBg(val);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, useBg: val }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ useBg: val });
    }
  };

  const handleToolbarBgColor = (c) => {
    setTextBgColor(c);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, bgColor: c }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ bgColor: c });
    }
  };

  const handleToolbarShowBorder = (val) => {
    setTextShowBorder(val);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, showBorder: val }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ showBorder: val });
    }
  };

  const handleToolbarBorderColor = (c) => {
    setTextBorderColor(c);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, borderColor: c }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ borderColor: c });
    }
  };

  const handleToolbarRotation = (deg) => {
    const norm = ((Number(deg) % 360) + 360) % 360;
    setTextRotation(norm);
    if (editingTextState) {
      setEditingTextState((prev) => ({ ...prev, rotation: norm }));
    } else if (selectedElement?.type === "text") {
      updateSelectedElement({ rotation: norm });
    }
  };

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
      <div className="flex-grow flex flex-col md:flex-row overflow-hidden relative min-h-0">
        {/* Sidebar Controls (完全に固定幅・独立スクロール) */}
        <div className="w-full md:w-80 bg-gray-900 border-r border-gray-800 p-4 sm:p-5 space-y-5 shrink-0 overflow-y-auto max-h-[40vh] md:max-h-full z-20 shadow-lg">
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
                  setTool("arrow");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "arrow"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <ArrowUpRight className="w-4 h-4 text-orange-400" />
                <span className="text-sm">矢印(↗)</span>
              </button>

              <button
                onClick={() => {
                  setTool("callout");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "callout"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <MessageSquare className="w-4 h-4 text-amber-400" />
                <span className="text-sm">吹き出し(💬)</span>
              </button>

              <button
                onClick={() => {
                  setTool("sticky");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "sticky"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <StickyNote className="w-4 h-4 text-yellow-300" />
                <span className="text-sm">付箋(📄)</span>
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
                  setTool("ellipse");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "ellipse"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <ellipse cx="12" cy="12" rx="10" ry="6" />
                </svg>
                <span className="text-sm">楕円(⬭)</span>
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
                  setTool("mosaic");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "mosaic"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Grid className="w-4 h-4 text-orange-400" />
                <span className="text-sm">モザイク</span>
              </button>

              <button
                onClick={() => {
                  setTool("mask");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "mask"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-sm">黒塗り</span>
              </button>

              <button
                onClick={() => {
                  setTool("stamp");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`col-span-2 flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "stamp"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                }`}
              >
                <Layers className="w-4 h-4" />
                <span className="text-sm">スタンプ (承認・社外秘・丸印)</span>
              </button>

              <button
                onClick={() => {
                  setTool("crop");
                  setSelectedId(null);
                  if (editingTextState && !editingTextState.id) setEditingTextState(null);
                }}
                className={`col-span-2 flex items-center justify-center space-x-2 py-2.5 rounded-lg border transition-all ${
                  tool === "crop"
                    ? "bg-orange-600 border-orange-500 text-white shadow-lg shadow-orange-600/20 font-bold"
                    : "bg-orange-950/40 border-orange-500/40 text-orange-400 hover:bg-orange-900/50"
                }`}
              >
                <Crop className="w-4 h-4" />
                <span className="text-sm font-bold">📐 比率・切り抜き＆位置調整</span>
              </button>
            </div>

            {/* AI・スマート自動モザイクボタン */}
            <div className="pt-2">
              <button
                type="button"
                onClick={detectFaces}
                disabled={isDetectingFaces}
                className="w-full flex items-center justify-center space-x-2 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:opacity-50 text-white rounded-lg text-xs sm:text-sm font-bold shadow-md shadow-orange-600/20 transition-all border border-orange-400/40"
              >
                <ScanFace className="w-4 h-4 animate-pulse" />
                <span>{isDetectingFaces ? "顔を検出中..." : "✨ 顔を自動検出してモザイク"}</span>
              </button>
            </div>
          </div>

          {/* Crop & Framing Panel */}
          {tool === "crop" && (
            <div className="space-y-4 p-3.5 bg-gray-850 rounded-xl border border-orange-500/30 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                <label className="font-bold text-xs uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                  <Crop className="w-4 h-4" />
                  比率・配置調整 (この画像専用)
                </label>
              </div>

              {/* 比率プリセット選択 */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-300">① 比率を選択:</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: "note_cover", label: "📝 note (1280×670)" },
                    { id: "x_post", label: "𝕏 16:9 (X/YouTube)" },
                    { id: "insta_square", label: "📷 1:1 (正方形)" },
                    { id: "insta_story", label: "📱 9:16 (ストーリー)" },
                    { id: "ratio_4_3", label: "📐 4:3 (標準)" },
                    { id: "ratio_3_2", label: "📐 3:2 (写真)" },
                    { id: "ratio_golden", label: "👑 黄金比" },
                    { id: "custom_ratio", label: "✏️ 任意比率指定" },
                    { id: "custom_size", label: "📏 任意px指定" }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setCropPreset(p.id)}
                      className={`p-2 rounded text-left text-xs transition-colors border ${
                        cropPreset === p.id
                          ? "bg-orange-600 border-orange-500 text-white font-bold"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 任意比率入力 */}
              {cropPreset === "custom_ratio" && (
                <div className="p-2.5 bg-gray-800 rounded-lg border border-gray-700 space-y-1.5 animate-fadeIn">
                  <span className="text-xs text-gray-300">カスタム比率 (横 : 縦):</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      value={customRatioW}
                      onChange={(e) => setCustomRatioW(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-white"
                      placeholder="横比率 (例: 5)"
                    />
                    <span className="text-orange-400 font-bold">:</span>
                    <input
                      type="number"
                      min="1"
                      value={customRatioH}
                      onChange={(e) => setCustomRatioH(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-white"
                      placeholder="縦比率 (例: 4)"
                    />
                  </div>
                </div>
              )}

              {/* 任意pxサイズ入力 */}
              {cropPreset === "custom_size" && (
                <div className="p-2.5 bg-gray-800 rounded-lg border border-gray-700 space-y-1.5 animate-fadeIn">
                  <span className="text-xs text-gray-300">出力ピクセルサイズ (幅 × 高さ):</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="10"
                      value={customSizeW}
                      onChange={(e) => setCustomSizeW(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-white"
                      placeholder="幅 px"
                    />
                    <span className="text-orange-400 font-bold">×</span>
                    <input
                      type="number"
                      min="10"
                      value={customSizeH}
                      onChange={(e) => setCustomSizeH(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-white"
                      placeholder="高さ px"
                    />
                  </div>
                </div>
              )}

              {/* 🎯 写真の配置場所（フレーミング）調整 */}
              <div className="space-y-2 pt-2 border-t border-gray-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-300">② 写真の配置場所（構図）:</span>
                  <span className="text-[10px] text-orange-400 font-mono">
                    X:{cropOffsetX}% Y:{cropOffsetY}%
                  </span>
                </div>

                <div className="p-2 bg-orange-950/40 border border-orange-500/30 rounded-lg flex items-center gap-1.5 text-[11px] text-orange-300">
                  <Move className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span>💡 画面上の枠内をマウスでドラッグして写真を直接動かせます！</span>
                </div>

                {/* クイック9方向位置合わせボタン */}
                <div className="grid grid-cols-3 gap-1 bg-gray-900 p-1.5 rounded-lg border border-gray-800">
                  {[
                    { label: "↖ 左上", x: 0, y: 0 },
                    { label: "⬆ 上", x: 50, y: 0 },
                    { label: "↗ 右上", x: 100, y: 0 },
                    { label: "⬅ 左", x: 0, y: 50 },
                    { label: "⏺ 中央", x: 50, y: 50 },
                    { label: "➡ 右", x: 100, y: 50 },
                    { label: "↙ 左下", x: 0, y: 100 },
                    { label: "⬇ 下", x: 50, y: 100 },
                    { label: "↘ 右下", x: 100, y: 100 }
                  ].map((pos) => (
                    <button
                      key={pos.label}
                      type="button"
                      onClick={() => {
                        setCropOffsetX(pos.x);
                        setCropOffsetY(pos.y);
                      }}
                      className={`py-1 text-[11px] font-semibold rounded border transition-colors ${
                        cropOffsetX === pos.x && cropOffsetY === pos.y
                          ? "bg-orange-600 text-white border-orange-500 shadow-xs"
                          : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-750 hover:text-gray-200"
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>

                {/* スライダー微調整 */}
                <div className="space-y-1.5 text-xs text-gray-400 pt-1">
                  <div className="flex justify-between">
                    <span>左右位置 (X):</span>
                    <span className="font-mono text-orange-400">{cropOffsetX}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropOffsetX}
                    onChange={(e) => setCropOffsetX(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer accent-orange-500"
                  />

                  <div className="flex justify-between pt-1">
                    <span>上下位置 (Y):</span>
                    <span className="font-mono text-orange-400">{cropOffsetY}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropOffsetY}
                    onChange={(e) => setCropOffsetY(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer accent-orange-500"
                  />

                  {/* 画像の拡大・縮小（大小調整）コントロール */}
                  <div className="pt-2 space-y-1.5 border-t border-gray-800">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-300">画像の大きさ (ズーム):</span>
                      <span className="font-mono text-orange-400 font-bold bg-orange-950/60 px-2 py-0.5 rounded border border-orange-500/30">
                        {Math.round(cropZoom * 100)}% ({cropZoom.toFixed(2)}x)
                      </span>
                    </div>

                    {/* ワンタッチ拡縮ボタン */}
                    <div className="grid grid-cols-4 gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setCropZoom((prev) => Math.max(0.3, parseFloat((prev - 0.1).toFixed(2))))}
                        className="py-1 bg-gray-800 hover:bg-gray-750 text-gray-300 rounded text-[11px] font-semibold border border-gray-700"
                        title="10%縮小"
                      >
                        🔍 -10%
                      </button>
                      <button
                        type="button"
                        onClick={() => setCropZoom(1.0)}
                        className="py-1 bg-gray-800 hover:bg-gray-750 text-gray-300 rounded text-[11px] font-semibold border border-gray-700"
                        title="等倍 (100%)"
                      >
                        100%
                      </button>
                      <button
                        type="button"
                        onClick={() => setCropZoom((prev) => Math.min(4.0, parseFloat((prev + 0.1).toFixed(2))))}
                        className="py-1 bg-gray-800 hover:bg-gray-750 text-gray-300 rounded text-[11px] font-semibold border border-gray-700"
                        title="10%拡大"
                      >
                        🔎 +10%
                      </button>
                      <button
                        type="button"
                        onClick={() => setCropZoom(1.0)}
                        className="py-1 bg-orange-950/60 hover:bg-orange-900/60 text-orange-300 rounded text-[11px] font-semibold border border-orange-500/40"
                        title="枠にピッタリ合わせる"
                      >
                        📐 フィット
                      </button>
                    </div>

                    <input
                      type="range"
                      min="0.3"
                      max="4.0"
                      step="0.05"
                      value={cropZoom}
                      onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer accent-orange-500 mt-1"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>30% (縮小・余白)</span>
                      <span>100%</span>
                      <span>400% (超拡大)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ③ 配置スタイル（切り抜き vs 縮小配置） */}
              <div className="space-y-2 pt-2 border-t border-gray-800">
                <span className="text-xs font-semibold text-gray-300">③ 配置スタイル:</span>
                
                {/* 2大モード選択ボタン */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCropFitMode("crop")}
                    className={`p-2 rounded text-xs font-semibold border flex flex-col items-center gap-1 transition-all ${
                      cropFitMode === "crop"
                        ? "bg-orange-600 border-orange-500 text-white shadow-sm font-bold"
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                    }`}
                  >
                    <span>✂️ 隙間なく切り抜き</span>
                    <span className="text-[10px] opacity-80">(枠一杯に埋める)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (cropFitMode === "crop") setCropFitMode("pad_white");
                    }}
                    className={`p-2 rounded text-xs font-semibold border flex flex-col items-center gap-1 transition-all ${
                      cropFitMode !== "crop"
                        ? "bg-orange-600 border-orange-500 text-white shadow-sm font-bold"
                        : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                    }`}
                  >
                    <span>🖼️ 全体を縮小して配置</span>
                    <span className="text-[10px] opacity-80">(見切れなし・余白)</span>
                  </button>
                </div>

                {/* 縮小配置時の余白デザイン選択 */}
                {cropFitMode !== "crop" && (
                  <div className="p-2.5 bg-gray-900 rounded-lg border border-orange-500/30 space-y-1.5 animate-fadeIn">
                    <span className="text-[11px] font-semibold text-orange-300">🎨 余白のデザイン・カラー:</span>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { id: "pad_white", label: "⬜ 白余白" },
                        { id: "pad_black", label: "⬛ 黒余白" },
                        { id: "pad_transparent", label: "🏁 透過余白(PNG)" },
                        { id: "pad_blur", label: "🌫️ 背景ぼかし" }
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setCropFitMode(item.id)}
                          className={`py-1 px-2 text-xs rounded border transition-colors ${
                            cropFitMode === item.id
                              ? "bg-orange-600 border-orange-500 text-white font-bold"
                              : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 適用ボタン */}
              <button
                type="button"
                onClick={applyCropAndFraming}
                className="w-full py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-orange-600/30 transition-transform active:scale-95 border border-orange-400/40"
              >
                ✨ この比率・配置で確定（適用）
              </button>
            </div>
          )}

          {/* Mosaic Settings */}
          {tool === "mosaic" && (
            <div className="space-y-2 p-3 bg-gray-850 rounded-xl border border-gray-800 animate-fadeIn">
              <div className="flex justify-between text-xs">
                <label className="font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                  <Grid className="w-3.5 h-3.5 text-orange-400" />
                  モザイクの強さ (粗さ)
                </label>
                <span className="text-orange-500 font-bold">{mosaicSize}px</span>
              </div>
              <input
                type="range"
                min="6"
                max="40"
                value={mosaicSize}
                onChange={(e) => setMosaicSize(parseInt(e.target.value))}
                className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
              />
              <p className="text-[11px] text-gray-400">
                画面上の隠したい範囲をドラッグで囲んでください。
              </p>
            </div>
          )}

          {tool === "mask" && (
            <div className="p-3 bg-gray-850 rounded-xl border border-gray-800 text-xs text-gray-400 animate-fadeIn">
              <p className="font-semibold text-emerald-400 flex items-center gap-1 mb-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                黒塗りマスキング
              </p>
              <p className="text-[11px]">
                画面上の個人情報や社外秘の文字・金額をドラッグで囲むと、一瞬で黒塗りされます。
              </p>
            </div>
          )}

          {/* Selected Element Live Editor */}
          {selectedElement && tool === "select" && (
            <div className="space-y-3.5 p-3.5 bg-blue-950/40 border border-blue-800/60 rounded-xl animate-fadeIn">
              <div className="flex items-center justify-between border-b border-blue-800/40 pb-2">
                <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  選択中の要素を編集
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={duplicateSelectedElement}
                    title="複製 (Ctrl+D / Cmd+D)"
                    className="text-blue-300 hover:text-white bg-blue-900/60 hover:bg-blue-800 text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors border border-blue-700/60 shadow-xs font-medium"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    複製
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedElement}
                    title="削除 (Delete)"
                    className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1 hover:bg-red-950/50 px-2 py-1 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    削除
                  </button>
                </div>
              </div>
              {selectedElement.type === "text" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-gray-300">
                        文字の内容 (複数行可)
                      </label>
                      <span className="text-[11px] text-blue-300 font-mono font-bold bg-blue-900/40 px-1.5 py-0.5 rounded border border-blue-800/50">
                        📝 {(selectedElement.text || "").length}文字
                      </span>
                    </div>
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

                  {/* 書体（フォント）の変更 */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300 font-semibold">書体（フォント）</span>
                      <span className="text-[10px] text-blue-300">Win/Mac標準フォント対応</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto pr-0.5">
                      {FONT_OPTIONS.map((f) => {
                        const isSelected = (selectedElement.fontFamily || "sans") === f.id;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => updateSelectedElement({ fontFamily: f.id })}
                            className={`px-2 py-1.5 rounded-lg text-xs font-bold transition-all border text-left flex flex-col ${
                              isSelected
                                ? "bg-blue-600 border-blue-400 text-white shadow-xs"
                                : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white hover:bg-gray-750"
                            }`}
                            style={{ fontFamily: f.family }}
                          >
                            <span className="truncate">{f.name}</span>
                            <span className="text-[9px] opacity-75 font-normal">{f.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                    {/* PCフォント直接指定時の入力欄 */}
                    {(selectedElement.fontFamily === "custom" || (!FONT_OPTIONS.some(f => f.id === selectedElement.fontFamily) && selectedElement.fontFamily)) && (
                      <div className="mt-1.5 p-2 bg-blue-900/40 rounded-lg border border-blue-700/60 animate-fadeIn space-y-1">
                        <label className="text-[10px] text-blue-200 font-bold block">
                          PC内フォント名を直接指定 (例: Meiryo, Yu Gothic, HG創英角ﾎﾟｯﾌﾟ体, Impact)
                        </label>
                        <input
                          type="text"
                          value={selectedElement.fontFamily === "custom" ? customFontInput : (selectedElement.fontFamily || "")}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomFontInput(val);
                            updateSelectedElement({ fontFamily: val || "sans" });
                          }}
                          placeholder="フォント名を入力..."
                          className="w-full bg-gray-900 text-white text-xs border border-blue-500/60 rounded px-2 py-1 focus:ring-1 focus:ring-blue-400 font-mono"
                        />
                      </div>
                    )}
                  </div>

                  {/* 🔄 文字の回転（角度調整） */}
                  <div className="space-y-1.5 pt-1.5 border-t border-blue-800/40">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-semibold flex items-center gap-1">
                        <RotateCw className="w-3.5 h-3.5 text-blue-400" />
                        文字の回転（角度）
                      </span>
                      <span className="text-blue-400 font-mono font-bold bg-blue-900/50 px-1.5 py-0.5 rounded border border-blue-800/60 text-[11px]">
                        {selectedElement.rotation || 0}°
                      </span>
                    </div>

                    {/* クイック角度ボタン */}
                    <div className="grid grid-cols-5 gap-1">
                      {[
                        { label: "0°", val: 0, title: "水平 (標準)" },
                        { label: "45°", val: 45, title: "斜め右上" },
                        { label: "90°", val: 90, title: "縦書き風・右向き" },
                        { label: "-45°", val: -45, title: "斜め左上" },
                        { label: "180°", val: 180, title: "反転" }
                      ].map((btn) => (
                        <button
                          key={btn.label}
                          type="button"
                          onClick={() => updateSelectedElement({ rotation: btn.val })}
                          title={btn.title}
                          className={`py-1 text-[11px] font-bold rounded border transition-colors ${
                            (selectedElement.rotation || 0) === btn.val
                              ? "bg-blue-600 border-blue-400 text-white shadow-xs"
                              : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white"
                          }`}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      value={selectedElement.rotation || 0}
                      onChange={(e) => updateSelectedElement({ rotation: parseInt(e.target.value, 10) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer mt-1"
                    />
                  </div>

                  {/* 文字色 */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-300">文字色</span>
                    <div className="flex items-center gap-1">
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

                  {/* 背景（座布団）設定 */}
                  <div className="space-y-2 pt-2 border-t border-blue-800/40">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-300 flex items-center gap-2 cursor-pointer font-medium">
                        <input
                          type="checkbox"
                          checked={selectedElement.useBg || false}
                          onChange={(e) => updateSelectedElement({ useBg: e.target.checked })}
                          className="w-4 h-4 rounded text-blue-600 bg-gray-800 border-gray-700 focus:ring-blue-500"
                        />
                        背景座布団をつける
                      </label>
                    </div>

                    {selectedElement.useBg && (
                      <div className="space-y-2 pl-2 border-l-2 border-blue-500/40 animate-fadeIn">
                        {/* 枠線のあり/なし */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">枠線</span>
                          <div className="grid grid-cols-2 gap-1 bg-gray-800 p-0.5 rounded-lg border border-gray-700">
                            <button
                              type="button"
                              onClick={() => updateSelectedElement({ showBorder: true })}
                              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                selectedElement.showBorder !== false
                                  ? "bg-blue-600 text-white font-bold"
                                  : "text-gray-400 hover:text-gray-200"
                              }`}
                            >
                              枠あり
                            </button>
                            <button
                              type="button"
                              onClick={() => updateSelectedElement({ showBorder: false })}
                              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                selectedElement.showBorder === false
                                  ? "bg-blue-600 text-white font-bold"
                                  : "text-gray-400 hover:text-gray-200"
                              }`}
                            >
                              枠なし
                            </button>
                          </div>
                        </div>

                        {/* 背景色 ＆ スポイト */}
                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-gray-300">背景色</span>
                          <div className="flex items-center gap-1.5">
                            {/* スポイトボタン */}
                            <button
                              type="button"
                              onClick={() =>
                                pickColor((picked) =>
                                  updateSelectedElement({ bgColor: picked })
                                )
                              }
                              title="スポイトで画面から色を取得"
                              className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-orange-400 border border-gray-700 rounded text-[11px] font-medium transition-colors"
                            >
                              <Pipette className="w-3.5 h-3.5" />
                              <span>スポイト</span>
                            </button>

                            {/* クイック背景色 */}
                            {["#ffffff", "#fef3c7", "#f3f4f6", "#000000"].map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => updateSelectedElement({ bgColor: c })}
                                className={`w-5 h-5 rounded-full border transition-transform ${
                                  (selectedElement.bgColor || "#ffffff") === c
                                    ? "scale-125 ring-2 ring-orange-400"
                                    : "border-gray-600"
                                }`}
                                style={{ backgroundColor: c }}
                              />
                            ))}

                            {/* カラーピッカー input */}
                            <label
                              title="自由な色を選択"
                              className="relative cursor-pointer w-5 h-5 rounded-full border border-gray-600 overflow-hidden flex items-center justify-center bg-gradient-to-tr from-red-500 via-green-500 to-blue-500"
                            >
                              <input
                                type="color"
                                value={selectedElement.bgColor || "#ffffff"}
                                onChange={(e) =>
                                  updateSelectedElement({ bgColor: e.target.value })
                                }
                                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Shape specific inspector (四角・丸・楕円のスタイル＆変形調整) */}
              {(selectedElement.type === "rect" || selectedElement.type === "circle" || selectedElement.type === "ellipse") && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateSelectedElement({ fillMode: "stroke" })}
                      className={`py-1.5 rounded text-xs font-medium border transition-colors ${
                        selectedElement.fillMode === "stroke"
                          ? "bg-blue-600 border-blue-500 text-white font-bold shadow-sm"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                      }`}
                    >
                      ⭕ 枠線のみ (LINE)
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSelectedElement({ fillMode: "fill" })}
                      className={`py-1.5 rounded text-xs font-medium border transition-colors ${
                        selectedElement.fillMode !== "stroke"
                          ? "bg-blue-600 border-blue-500 text-white font-bold shadow-sm"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                      }`}
                    >
                      ⬛ 塗りつぶし
                    </button>
                  </div>

                  {selectedElement.fillMode === "stroke" && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300">枠線の太さ (LINE)</span>
                        <span className="text-blue-400 font-bold">{selectedElement.brushSize || 5}px</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="60"
                        value={selectedElement.brushSize || 5}
                        onChange={(e) => updateSelectedElement({ brushSize: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}

                  {/* サイズ・変形スライダー（幅・高さのクイック調整） */}
                  {(selectedElement.type === "ellipse" || selectedElement.type === "rect") && (
                    <div className="space-y-2 pt-1 border-t border-blue-800/40">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-300">横幅 (変形)</span>
                          <span className="text-blue-400 font-bold">{Math.abs(Math.round(selectedElement.w || 0))}px</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="1200"
                          value={Math.abs(selectedElement.w || 50)}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            const sign = (selectedElement.w || 0) < 0 ? -1 : 1;
                            updateSelectedElement({ w: val * sign });
                          }}
                          className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-300">縦幅 (変形)</span>
                          <span className="text-blue-400 font-bold">{Math.abs(Math.round(selectedElement.h || 0))}px</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="1200"
                          value={Math.abs(selectedElement.h || 50)}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            const sign = (selectedElement.h || 0) < 0 ? -1 : 1;
                            updateSelectedElement({ h: val * sign });
                          }}
                          className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                  )}

                  {/* 正円の変形スライダー */}
                  {selectedElement.type === "circle" && (
                    <div className="space-y-1 pt-1 border-t border-blue-800/40">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300">半径 (変形)</span>
                        <span className="text-blue-400 font-bold">{Math.round(selectedElement.r || 0)}px</span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="600"
                        value={selectedElement.r || 30}
                        onChange={(e) => updateSelectedElement({ r: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-300">色</span>
                    <div className="flex items-center gap-1">
                      {["#ff0000", "#000000", "#ffffff", "#0000ff", "#22c55e", "#f59e0b"].map((c) => (
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

              {/* Arrow specific inspector */}
              {selectedElement.type === "arrow" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">矢印の太さ</span>
                      <span className="text-blue-400 font-bold">{selectedElement.brushSize || 5}px</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="40"
                      value={selectedElement.brushSize || 5}
                      onChange={(e) => updateSelectedElement({ brushSize: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-300">矢印の色</span>
                    <div className="flex items-center gap-1">
                      {["#ff0000", "#2563eb", "#000000", "#16a34a", "#f59e0b", "#ffffff"].map((c) => (
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

              {/* Callout (吹き出し) specific inspector */}
              {selectedElement.type === "callout" && (
                <div className="space-y-3">
                  {/* テキスト入力 */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300">吹き出しの文字</span>
                      <span className="text-[11px] font-mono text-blue-400">
                        {(selectedElement.text || "").length}文字
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      value={selectedElement.text || ""}
                      onChange={(e) => updateSelectedElement({ text: e.target.value })}
                      placeholder="吹き出しの文字を入力..."
                      className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* 文字サイズ */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">文字サイズ</span>
                      <span className="text-blue-400 font-bold">{selectedElement.fontSize || 24}px</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="80"
                      value={selectedElement.fontSize || 24}
                      onChange={(e) => updateSelectedElement({ fontSize: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* しっぽの方向・位置 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300">しっぽの向き</span>
                      <span className="text-[10px] text-orange-400 font-medium">● 先端をドラッグして自由伸縮可</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { id: "bottom-left", label: "左下" },
                        { id: "bottom-right", label: "右下" },
                        { id: "top-left", label: "左上" },
                        { id: "top-right", label: "右上" }
                      ].map((dir) => (
                        <button
                          key={dir.id}
                          type="button"
                          onClick={() => {
                            const xMin = Math.min(selectedElement.x, selectedElement.x + selectedElement.w);
                            const yMin = Math.min(selectedElement.y, selectedElement.y + selectedElement.h);
                            const w = Math.abs(selectedElement.w);
                            const h = Math.abs(selectedElement.h);
                            const tailH = Math.max(30, h * 0.4);
                            let tx = xMin + w * 0.2;
                            let ty = yMin + h + tailH;
                            if (dir.id === "bottom-right") { tx = xMin + w * 0.8; ty = yMin + h + tailH; }
                            else if (dir.id === "top-left") { tx = xMin + w * 0.2; ty = yMin - tailH; }
                            else if (dir.id === "top-right") { tx = xMin + w * 0.8; ty = yMin - tailH; }
                            updateSelectedElement({ tailDirection: dir.id, tailX: tx, tailY: ty });
                          }}
                          className={`py-1 text-[11px] rounded border transition-colors ${
                            (selectedElement.tailDirection || "bottom-left") === dir.id
                              ? "bg-blue-600 border-blue-500 text-white font-bold"
                              : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                          }`}
                        >
                          {dir.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 幅・高さスライダー（縦横比自由変形） */}
                  <div className="space-y-2 pt-1 border-t border-blue-800/40">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300">横幅</span>
                        <span className="text-blue-400 font-bold">{Math.abs(Math.round(selectedElement.w || 0))}px</span>
                      </div>
                      <input
                        type="range"
                        min="40"
                        max="1000"
                        value={Math.abs(selectedElement.w || 160)}
                        onChange={(e) => updateSelectedElement({ w: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300">縦幅</span>
                        <span className="text-blue-400 font-bold">{Math.abs(Math.round(selectedElement.h || 0))}px</span>
                      </div>
                      <input
                        type="range"
                        min="30"
                        max="800"
                        value={Math.abs(selectedElement.h || 90)}
                        onChange={(e) => updateSelectedElement({ h: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* 枠線の太さ */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">枠線の太さ</span>
                      <span className="text-blue-400 font-bold">{selectedElement.brushSize || 3}px</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={selectedElement.brushSize || 3}
                      onChange={(e) => updateSelectedElement({ brushSize: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* 背景色 */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-300">吹き出しの色</span>
                    <div className="flex items-center gap-1">
                      {["#ffffff", "#fef08a", "#bae6fd", "#bbf7d0", "#000000"].map((c) => (
                        <button
                          key={c}
                          onClick={() => updateSelectedElement({ bgColor: c })}
                          className={`w-5 h-5 rounded-full border transition-transform ${
                            (selectedElement.bgColor || "#ffffff") === c ? "scale-125 ring-2 ring-blue-400" : "border-gray-600"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* 枠線・文字の色 */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-300">文字・枠の色</span>
                    <div className="flex items-center gap-1">
                      {["#000000", "#ff0000", "#2563eb", "#16a34a", "#ffffff"].map((c) => (
                        <button
                          key={c}
                          onClick={() => updateSelectedElement({ color: c, borderColor: c })}
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

              {/* Sticky Note (付箋) specific inspector */}
              {selectedElement.type === "sticky" && (
                <div className="space-y-3">
                  {/* メモ内容 */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300">付箋のメモ</span>
                      <span className="text-[11px] font-mono text-blue-400">
                        {(selectedElement.text || "").length}文字
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      value={selectedElement.text || ""}
                      onChange={(e) => updateSelectedElement({ text: e.target.value })}
                      placeholder="付箋にメモを入力..."
                      className="w-full px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* 付箋のカラーパレット（パステルカラー） */}
                  <div className="space-y-1">
                    <span className="text-xs text-gray-300">付箋カラー</span>
                    <div className="flex items-center gap-1.5">
                      {[
                        { color: "#fef08a", name: "イエロー" },
                        { color: "#fbcfe8", name: "ピンク" },
                        { color: "#bbf7d0", name: "グリーン" },
                        { color: "#bae6fd", name: "ブルー" },
                        { color: "#fed7aa", name: "オレンジ" },
                        { color: "#ffffff", name: "ホワイト" }
                      ].map((item) => (
                        <button
                          key={item.color}
                          title={item.name}
                          onClick={() => updateSelectedElement({ bgColor: item.color })}
                          className={`w-6 h-6 rounded border transition-transform shadow-xs ${
                            (selectedElement.bgColor || "#fef08a") === item.color
                              ? "scale-115 ring-2 ring-blue-400 border-white"
                              : "border-gray-600 hover:scale-105"
                          }`}
                          style={{ backgroundColor: item.color }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* 文字サイズ */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">文字サイズ</span>
                      <span className="text-blue-400 font-bold">{selectedElement.fontSize || 22}px</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="60"
                      value={selectedElement.fontSize || 22}
                      onChange={(e) => updateSelectedElement({ fontSize: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* 幅・高さスライダー（縦横比自由変形） */}
                  <div className="space-y-2 pt-1 border-t border-blue-800/40">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300">横幅 (変形)</span>
                        <span className="text-blue-400 font-bold">{Math.abs(Math.round(selectedElement.w || 0))}px</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="800"
                        value={Math.abs(selectedElement.w || 140)}
                        onChange={(e) => updateSelectedElement({ w: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300">縦幅 (変形)</span>
                        <span className="text-blue-400 font-bold">{Math.abs(Math.round(selectedElement.h || 0))}px</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="800"
                        value={Math.abs(selectedElement.h || 140)}
                        onChange={(e) => updateSelectedElement({ h: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* 文字色 */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-300">文字色</span>
                    <div className="flex items-center gap-1">
                      {["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#ffffff"].map((c) => (
                        <button
                          key={c}
                          onClick={() => updateSelectedElement({ color: c })}
                          className={`w-5 h-5 rounded-full border transition-transform ${
                            (selectedElement.color || "#1f2937") === c ? "scale-125 ring-2 ring-blue-400" : "border-gray-600"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Stamp specific inspector */}
              {selectedElement.type === "stamp" && (
                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-300">スタンプサイズ</span>
                      <span className="text-blue-400 font-bold">{selectedElement.size}px</span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="250"
                      value={selectedElement.size || 60}
                      onChange={(e) => updateSelectedElement({ size: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-300">色</span>
                    <div className="flex items-center gap-1">
                      {["#dc2626", "#000000", "#2563eb"].map((c) => (
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
            </div>
          )}

          {/* Color Palette (Default for new elements) */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
              基本カラー
            </label>
            <div className="flex flex-wrap gap-2">
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
                  className={`w-7 h-7 rounded-full border-2 transition-transform shadow-sm ${
                    color === c.hex ? "scale-125 border-orange-500 ring-2 ring-orange-500/50" : "border-gray-700 hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* Text Settings (for new text) */}
          {tool === "text" && (
            <div className="space-y-3 p-3.5 bg-gray-850 rounded-xl border border-gray-800 animate-fadeIn">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
                文字入れの初期設定
              </label>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">フォントサイズ</span>
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

              {/* 書体（フォント）の初期設定 */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 font-medium">基本フォント（書体）</span>
                  <span className="text-[10px] text-orange-400">Win/Mac対応</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {FONT_OPTIONS.map((f) => {
                    const isSelected = fontFamily === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFontFamily(f.id)}
                        className={`px-2 py-1.5 rounded-lg text-xs font-bold transition-all border text-left flex flex-col cursor-pointer ${
                          isSelected
                            ? "bg-orange-600 border-orange-500 text-white shadow-xs"
                            : "bg-gray-800 border-gray-750 text-gray-300 hover:text-white hover:bg-gray-700"
                        }`}
                        style={{ fontFamily: f.family }}
                      >
                        <span className="truncate">{f.name}</span>
                        <span className="text-[9px] opacity-75 font-normal">{f.desc}</span>
                      </button>
                    );
                  })}
                </div>
                {/* PCフォント直接指定入力 */}
                {fontFamily === "custom" && (
                  <div className="mt-1 p-2 bg-gray-900 rounded-lg border border-orange-500/40 animate-fadeIn space-y-1">
                    <label className="text-[10px] text-orange-300 font-bold block">
                      PC内フォント名を直接指定 (例: Meiryo, Yu Gothic, Impact など)
                    </label>
                    <input
                      type="text"
                      value={customFontInput}
                      onChange={(e) => {
                        setCustomFontInput(e.target.value);
                      }}
                      placeholder="フォント名を入力..."
                      className="w-full bg-gray-800 text-white text-xs border border-gray-700 rounded px-2 py-1 focus:ring-1 focus:ring-orange-500 font-mono"
                    />
                  </div>
                )}
              </div>

              {/* 🔄 文字の初期回転角度 */}
              <div className="space-y-1.5 pt-1.5 border-t border-gray-800">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400 font-medium flex items-center gap-1">
                    <RotateCw className="w-3.5 h-3.5 text-orange-400" />
                    文字の角度（回転）
                  </span>
                  <span className="text-orange-400 font-mono font-bold bg-gray-900 px-1.5 py-0.5 rounded border border-gray-700 text-[11px]">
                    {textRotation}°
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-1">
                  {[
                    { label: "0°", val: 0, title: "水平 (標準)" },
                    { label: "45°", val: 45, title: "斜め右上" },
                    { label: "90°", val: 90, title: "縦書き風" },
                    { label: "-45°", val: -45, title: "斜め左上" },
                    { label: "180°", val: 180, title: "反転" }
                  ].map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      onClick={() => setTextRotation(btn.val)}
                      title={btn.title}
                      className={`py-1 text-[11px] font-bold rounded border transition-colors ${
                        textRotation === btn.val
                          ? "bg-orange-600 border-orange-500 text-white shadow-xs"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750 hover:text-white"
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={textRotation}
                  onChange={(e) => setTextRotation(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer mt-1"
                />
              </div>

              {/* 座布団ON/OFF */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center space-x-2">
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

                {useTextBg && (
                  <div className="space-y-2 pl-2 border-l-2 border-orange-500/40 animate-fadeIn">
                    {/* 枠線のあり/なし */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">枠線</span>
                      <div className="grid grid-cols-2 gap-1 bg-gray-800 p-0.5 rounded-lg border border-gray-700">
                        <button
                          type="button"
                          onClick={() => setTextShowBorder(true)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                            textShowBorder
                              ? "bg-orange-600 text-white font-bold"
                              : "text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          枠あり
                        </button>
                        <button
                          type="button"
                          onClick={() => setTextShowBorder(false)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                            !textShowBorder
                              ? "bg-orange-600 text-white font-bold"
                              : "text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          枠なし
                        </button>
                      </div>
                    </div>

                    {/* 背景色 ＆ スポイト */}
                    <div className="flex items-center justify-between text-xs pt-0.5">
                      <span className="text-gray-400">背景色</span>
                      <div className="flex items-center gap-1.5">
                        {/* スポイトボタン */}
                        <button
                          type="button"
                          onClick={() =>
                            pickColor((picked) => setTextBgColor(picked))
                          }
                          title="スポイトで画面から色を取得"
                          className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-750 text-orange-400 border border-gray-700 rounded text-[11px] font-medium transition-colors"
                        >
                          <Pipette className="w-3.5 h-3.5" />
                          <span>スポイト</span>
                        </button>

                        {/* クイック背景色 */}
                        {["#ffffff", "#fef3c7", "#f3f4f6", "#000000"].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setTextBgColor(c)}
                            className={`w-5 h-5 rounded-full border transition-transform ${
                              textBgColor === c
                                ? "scale-125 ring-2 ring-orange-400"
                                : "border-gray-600"
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}

                        {/* カラーピッカー */}
                        <label
                          title="自由な色を選択"
                          className="relative cursor-pointer w-5 h-5 rounded-full border border-gray-600 overflow-hidden flex items-center justify-center bg-gradient-to-tr from-red-500 via-green-500 to-blue-500"
                        >
                          <input
                            type="color"
                            value={textBgColor}
                            onChange={(e) => setTextBgColor(e.target.value)}
                            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Brush / Shape Thickness Settings */}
          {(tool === "brush" || tool === "arrow" || tool === "callout" || ((tool === "rect" || tool === "circle" || tool === "ellipse") && shapeStyle === "stroke")) && (
            <div className="space-y-2 animate-fadeIn">
              <div className="flex justify-between text-xs">
                <label className="font-bold uppercase tracking-wider text-gray-400">
                  {tool === "brush" ? "ブラシサイズ" : tool === "arrow" ? "矢印の太さ" : "枠線の太さ (LINE)"}
                </label>
                <span className="text-orange-500 font-bold">{brushSize}px</span>
              </div>
              <input
                type="range"
                min="1"
                max="60"
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full h-1.5 bg-gray-750 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          {/* Shape Style Selector (四角・丸・楕円でLINE/塗りつぶし切り替え) */}
          {(tool === "rect" || tool === "circle" || tool === "ellipse") && (
            <div className="space-y-2 animate-fadeIn">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
                図形スタイル
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShapeStyle("stroke")}
                  className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                    shapeStyle === "stroke"
                      ? "bg-orange-600 border-orange-500 text-white font-bold shadow-md shadow-orange-600/20"
                      : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                  }`}
                >
                  ⭕ 枠線のみ (LINE)
                </button>
                <button
                  type="button"
                  onClick={() => setShapeStyle("fill")}
                  className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                    shapeStyle === "fill"
                      ? "bg-orange-600 border-orange-500 text-white font-bold shadow-md shadow-orange-600/20"
                      : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-750"
                  }`}
                >
                  ⬛ 塗りつぶし
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

        {/* Canvas Display & Interaction Area (右側独立ビューポート) */}
        <div className="flex-grow h-full relative overflow-hidden flex flex-col min-w-0 bg-gray-950">
          {/* 上部固定スリムテキストツールバー（テキスト操作時に1行で常駐表示） */}
          {isTextModeActive && (
            <div className="h-11 bg-gray-900 border-b border-gray-800 px-3 py-1 flex items-center justify-between gap-2 shrink-0 z-30 shadow-md text-xs overflow-x-auto select-none">
              <div className="flex items-center space-x-2 shrink-0">
                <span className="font-bold text-orange-400 flex items-center gap-1">
                  <Type className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">文字ツール</span>
                </span>

                {/* フォント選択 */}
                <select
                  value={activeFontFamily}
                  onChange={(e) => handleToolbarFontFamily(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none"
                  title="フォント種類"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.name}
                    </option>
                  ))}
                </select>

                {/* フォントサイズ */}
                <div className="flex items-center bg-gray-800 rounded border border-gray-700 overflow-hidden" title="文字サイズ">
                  <button
                    type="button"
                    onClick={() => handleToolbarFontSize(Math.max(10, activeFontSize - 4))}
                    className="px-2 py-1 hover:bg-gray-700 text-gray-300 font-bold transition-colors"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="8"
                    max="200"
                    value={activeFontSize}
                    onChange={(e) => handleToolbarFontSize(Number(e.target.value))}
                    className="w-12 bg-transparent text-center text-xs font-bold text-white focus:outline-none"
                  />
                  <span className="text-[10px] text-gray-400 pr-1">px</span>
                  <button
                    type="button"
                    onClick={() => handleToolbarFontSize(Math.min(200, activeFontSize + 4))}
                    className="px-2 py-1 hover:bg-gray-700 text-gray-300 font-bold transition-colors"
                  >
                    +
                  </button>
                </div>

                {/* 文字色 */}
                <div className="flex items-center space-x-1 pl-1 border-l border-gray-800">
                  <input
                    type="color"
                    value={activeColor}
                    onChange={(e) => handleToolbarColor(e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border border-gray-700 bg-transparent p-0"
                    title="カスタム文字色"
                  />
                  {["#000000", "#ffffff", "#ff0000", "#0000ff", "#22c55e", "#f59e0b"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleToolbarColor(c)}
                      className={`w-4 h-4 rounded-full border transition-transform ${activeColor === c ? "ring-2 ring-orange-500 scale-110 border-white shadow-xs" : "border-gray-600 hover:scale-105"}`}
                      style={{ backgroundColor: c }}
                      title={`文字色: ${c}`}
                    />
                  ))}
                </div>

                {/* 座布団（背景色）設定 */}
                <div className="flex items-center space-x-1 pl-1 border-l border-gray-800">
                  <label className="flex items-center space-x-1 cursor-pointer bg-gray-800 px-2 py-0.5 rounded border border-gray-700 text-[11px] text-gray-300 hover:bg-gray-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={activeUseBg}
                      onChange={(e) => handleToolbarUseBg(e.target.checked)}
                      className="rounded text-orange-500 focus:ring-0 w-3 h-3"
                    />
                    <span>座布団</span>
                  </label>
                  {activeUseBg && (
                    <div className="flex items-center space-x-1">
                      <input
                        type="color"
                        value={activeBgColor}
                        onChange={(e) => handleToolbarBgColor(e.target.value)}
                        className="w-5 h-5 rounded cursor-pointer border border-gray-700 bg-transparent p-0"
                        title="背景の色"
                      />
                      {["#ffffff", "#111827", "#fef08a", "#ffedd5"].map((bg) => (
                        <button
                          key={bg}
                          type="button"
                          onClick={() => handleToolbarBgColor(bg)}
                          className={`w-3.5 h-3.5 rounded-full border transition-transform ${activeBgColor === bg ? "ring-2 ring-orange-500 scale-110 border-white shadow-xs" : "border-gray-600 hover:scale-105"}`}
                          style={{ backgroundColor: bg }}
                          title={`背景色: ${bg}`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* 枠線設定（座布団の枠の有無・色設定） */}
                {activeUseBg && (
                  <div className="flex items-center space-x-1 pl-1 border-l border-gray-800">
                    <label className="flex items-center space-x-1 cursor-pointer bg-gray-800 px-2 py-0.5 rounded border border-gray-700 text-[11px] text-gray-300 hover:bg-gray-700 transition-colors">
                      <input
                        type="checkbox"
                        checked={activeShowBorder}
                        onChange={(e) => handleToolbarShowBorder(e.target.checked)}
                        className="rounded text-orange-500 focus:ring-0 w-3 h-3"
                      />
                      <span>枠線</span>
                    </label>
                    {activeShowBorder && (
                      <div className="flex items-center space-x-1">
                        <input
                          type="color"
                          value={activeBorderColor}
                          onChange={(e) => handleToolbarBorderColor(e.target.value)}
                          className="w-5 h-5 rounded cursor-pointer border border-gray-700 bg-transparent p-0"
                          title="枠線の色"
                        />
                        {["#d1d5db", "#000000", "#ef4444", "#3b82f6"].map((bc) => (
                          <button
                            key={bc}
                            type="button"
                            onClick={() => handleToolbarBorderColor(bc)}
                            className={`w-3.5 h-3.5 rounded-full border transition-transform ${activeBorderColor === bc ? "ring-2 ring-orange-500 scale-110 border-white shadow-xs" : "border-gray-600 hover:scale-105"}`}
                            style={{ backgroundColor: bc }}
                            title={`枠線色: ${bc}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 回転角度 */}
                <div className="flex items-center space-x-1 pl-1 border-l border-gray-800">
                  <button
                    type="button"
                    onClick={() => handleToolbarRotation((activeRotation - 15 + 360) % 360)}
                    className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 text-gray-300 text-[11px] transition-colors"
                    title="左に15°回転"
                  >
                    ↺ -15°
                  </button>
                  <span className="text-[11px] font-mono text-orange-400 w-8 text-center">{activeRotation}°</span>
                  <button
                    type="button"
                    onClick={() => handleToolbarRotation((activeRotation + 15) % 360)}
                    className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 text-gray-300 text-[11px] transition-colors"
                    title="右に15°回転"
                  >
                    ↻ +15°
                  </button>
                  {activeRotation !== 0 && (
                    <button
                      type="button"
                      onClick={() => handleToolbarRotation(0)}
                      className="text-[10px] text-gray-400 hover:text-white px-1 underline"
                      title="回転を0°に戻す"
                    >
                      リセット
                    </button>
                  )}
                </div>
              </div>

              {/* 確定・キャンセルボタン */}
              <div className="flex items-center space-x-2 shrink-0">
                {editingTextState && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingTextState(null)}
                      className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-xs transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={submitText}
                      className="px-3.5 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded font-bold text-xs flex items-center gap-1 shadow-sm active:scale-95 transition-all"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>確定</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            className="w-full h-full overflow-auto p-6 sm:p-10 flex"
            style={{
              cursor: isSpacePressed || isPanningRef.current ? "grab" : tool === "hand" ? "grab" : "default"
            }}
          >
            {/* 中央揃えラッパー（画像拡大時にスクロール可能領域を正しく展開） */}
            <div className="m-auto flex items-center justify-center shrink-0">
              <div
                ref={canvasWrapperRef}
                className="relative shadow-2xl transition-[width,height] duration-75 ease-out"
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

                {/* キャンバス上の直接文字入力（枠線なし・点滅カーソルのみ・Canvasとピクセル完全一致） */}
                {editingTextState && canvasRef.current && (() => {
                  const curFontSize = editingTextState.fontSize || fontSize || 30;
                  const curFontFamily = editingTextState.fontFamily || fontFamily || "sans";
                  const curP = curFontSize * 0.25;
                  const scaledFontSize = curFontSize * zoomScale;
                  const hasBg = Boolean(editingTextState.useBg);
                  const hasBorder = editingTextState.showBorder !== false;
                  const bColor = editingTextState.borderColor || activeBorderColor || "#d1d5db";

                  const leftPct = hasBg
                    ? ((editingTextState.canvasX - curP) / canvasRef.current.width) * 100
                    : (editingTextState.canvasX / canvasRef.current.width) * 100;
                  const topPct = hasBg
                    ? ((editingTextState.canvasY - curP) / canvasRef.current.height) * 100
                    : ((editingTextState.canvasY + curP * 0.15) / canvasRef.current.height) * 100;

                  return (
                    <div
                      className="absolute z-30"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        transform: `rotate(${editingTextState.rotation || 0}deg)`,
                        transformOrigin: "top left"
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <textarea
                        ref={textInputRef}
                        autoFocus
                        rows={Math.max(1, (editingTextState.text || "").split("\n").length)}
                        value={editingTextState.text}
                        onChange={(e) =>
                          setEditingTextState((prev) => ({
                            ...prev,
                            text: e.target.value
                          }))
                        }
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            submitText();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingTextState(null);
                          }
                        }}
                        placeholder="文字を入力..."
                        style={{
                          fontSize: `${scaledFontSize}px`,
                          lineHeight: 1.3,
                          fontFamily: getFontCssFamily(curFontFamily),
                          fontWeight: "bold",
                          color: editingTextState.color || "#000000",
                          caretColor: editingTextState.color || "#f97316",
                          backgroundColor: hasBg ? (editingTextState.bgColor || "#ffffff") : "transparent",
                          border: hasBg && hasBorder ? `1px solid ${bColor}` : "none",
                          borderRadius: hasBg ? `${4 * zoomScale}px` : "0px",
                          outline: "none",
                          boxShadow: "none",
                          padding: hasBg
                            ? `${(curP + curP * 0.15) * zoomScale}px ${curP * zoomScale}px ${curP * zoomScale}px ${curP * zoomScale}px`
                            : "0px",
                          margin: "0px",
                          minWidth: `${Math.max(scaledFontSize * 2, (editingTextState.text ? editingTextState.text.length * scaledFontSize * 0.9 : scaledFontSize * 2))}px`,
                          minHeight: `${scaledFontSize * 1.3}px`,
                          resize: "none",
                          overflow: "visible",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word"
                        }}
                        className="font-bold select-text focus:outline-none"
                      />
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Floating Zoom Toolbar (キャンバス画面下部に完全固定) */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900/90 backdrop-blur-md border border-gray-700/80 rounded-full px-4 py-2 flex items-center space-x-3 shadow-2xl pointer-events-auto">
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
  const [rotatingFileIds, setRotatingFileIds] = useState(new Set());
  const rotatingFileIdsRef = useRef(new Set());
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canCancelProcessing, setCanCancelProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [editingFile, setEditingFile] = useState(null);
  const [videoToExtract, setVideoToExtract] = useState(null);
  const [emailToExtract, setEmailToExtract] = useState(null);
  const [isPdfCompareOpen, setIsPdfCompareOpen] = useState(false);

  // メール / winmail.dat から添付ファイルや本文を取り込んだ際のハンドラ
  const handleExtractFromEmail = async (selectedAttachments = [], extraFiles = []) => {
    setEmailToExtract(null);
    const newFiles = [
      ...selectedAttachments.map((att, idx) => {
        let mime = att.mimeType || "";
        const name = att.filename || `添付ファイル_${idx + 1}`;
        const ext = name.split(".").pop()?.toLowerCase();
        if (!mime || mime === "application/octet-stream") {
          if (["jpg", "jpeg"].includes(ext)) mime = "image/jpeg";
          else if (ext === "png") mime = "image/png";
          else if (ext === "gif") mime = "image/gif";
          else if (ext === "webp") mime = "image/webp";
          else if (ext === "bmp") mime = "image/bmp";
          else if (ext === "pdf") mime = "application/pdf";
          else if (ext === "docx") mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          else if (ext === "xlsx") mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        }
        const blob = new Blob([att.content], { type: mime || "application/octet-stream" });
        return new File([blob], name, { type: mime || "application/octet-stream" });
      }),
      ...extraFiles
    ];

    if (newFiles.length > 0) {
      await processFiles(newFiles);
    }
  };

  const getExtFromFormat = (format) => {
    if (format === "image/png") return ".png";
    if (format === "image/webp") return ".webp";
    if (format === "image/jpeg") return ".jpg";
    if (format === "application/pdf") return ".jpg";
    return ".jpg";
  };

  // 動画から静止画を取り込んだ際のハンドラ
  const handleExtractFromVideo = async (extractedImages) => {
    setVideoToExtract(null);
    if (!extractedImages || extractedImages.length === 0) return;

    const processedItems = [];
    for (const item of extractedImages) {
      const resizedDataUrl = await resizeImage(
        item.originalSrc,
        maxWidth,
        maxHeight,
        quality,
        targetFormat === "application/pdf" ? "image/jpeg" : targetFormat
      );
      const ext = getExtFromFormat(targetFormat);
      const base = item.name.replace(/\.[^/.]+$/, "");
      processedItems.push({
        ...item,
        src: resizedDataUrl,
        size: Math.round((resizedDataUrl.length * 3) / 4),
        type: targetFormat === "application/pdf" ? "image/jpeg" : targetFormat,
        name: `${base}${ext}`
      });
    }

    setFiles((prev) => [...processedItems, ...prev]);
    addLog(`動画から静止画を取り込みました: ${processedItems.length}枚`);
  };

  // Settings
  const [targetFormat, setTargetFormat] = useState("image/png");
  const [maxWidth, setMaxWidth] = useState("");
  const [maxHeight, setMaxHeight] = useState("");
  const [quality, setQuality] = useState(0.9);
  const [pdfPageRange, setPdfPageRange] = useState("");
  const [pdfPassword, setPdfPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pdfBlockPrinting, setPdfBlockPrinting] = useState(false);
  const [pdfAddPageNumber, setPdfAddPageNumber] = useState(false);
  const [pdfPageNumberPos, setPdfPageNumberPos] = useState("bottom-center");
  const [pdfPageNumberFormat, setPdfPageNumberFormat] = useState("page-total");
  const [pdfStripMetadata, setPdfStripMetadata] = useState(true);

  // SNS・アスペクト比プリセット & 画像つぶれ防止フィット方式
  const [aspectRatioPreset, setAspectRatioPreset] = useState("none");
  const [fitMode, setFitMode] = useState("crop"); // "crop" | "pad_white" | "pad_black" | "pad_blur"

  // クリップボードからの直接貼り付け（Cmd+V / Ctrl+V）
  useEffect(() => {
    const handleGlobalPaste = async (e) => {
      // 入力フォームやテキストエリア操作中は無視
      const targetTag = e.target?.tagName;
      if (targetTag === "INPUT" || targetTag === "TEXTAREA" || editingFile) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const now = new Date();
            const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
            const file = new File([blob], `clipboard_${timeStr}.png`, {
              type: blob.type || "image/png"
            });
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addLog(`クリップボードから画像を直接取り込みました: ${imageFiles.length}件`);
        await processFiles(imageFiles);
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => window.removeEventListener("paste", handleGlobalPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFile, maxWidth, maxHeight, quality, targetFormat, aspectRatioPreset, fitMode]);

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
      const ext = getExtFromFormat(targetFormat);
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

  // トップ画面の「やりたいこと」カードや追加ボタンから、最速でファイル選択ダイアログを起動する。
  const openWorkspaceAction = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    } else {
      document.getElementById("fileInput")?.click();
    }
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
    targetType,
    preset = aspectRatioPreset,
    fit = fitMode
  ) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const origW = img.width;
        const origH = img.height;
        let targetW = widthLimit && !isNaN(widthLimit) ? parseInt(widthLimit, 10) : null;
        let targetH = heightLimit && !isNaN(heightLimit) ? parseInt(heightLimit, 10) : null;

        // SNS・プラットフォーム比率プリセットの適用
        if (preset && preset !== "none") {
          const presetConfigs = {
            note_cover: { w: 1280, h: 670, ratio: 1280 / 670 },
            x_post: { w: 1200, h: 675, ratio: 16 / 9 },
            x_header: { w: 1500, h: 500, ratio: 3 / 1 },
            insta_square: { w: 1080, h: 1080, ratio: 1 / 1 },
            insta_portrait: { w: 1080, h: 1350, ratio: 4 / 5 },
            insta_story: { w: 1080, h: 1920, ratio: 9 / 16 },
            yt_thumb: { w: 1280, h: 720, ratio: 16 / 9 },
            ratio_16_9: { ratio: 16 / 9 },
            ratio_4_3: { ratio: 4 / 3 },
            ratio_3_2: { ratio: 3 / 2 },
            ratio_1_1: { ratio: 1 / 1 },
            ratio_golden: { ratio: 1.618 }
          };

          const cfg = presetConfigs[preset];
          if (cfg) {
            if (cfg.w && cfg.h && !targetW && !targetH) {
              targetW = cfg.w;
              targetH = cfg.h;
            } else if (cfg.ratio) {
              if (targetW && !targetH) {
                targetH = Math.round(targetW / cfg.ratio);
              } else if (!targetW && targetH) {
                targetW = Math.round(targetH * cfg.ratio);
              } else if (!targetW && !targetH) {
                // 元画像の長辺基準で比率を設定
                if (origW / origH > cfg.ratio) {
                  targetW = origW;
                  targetH = Math.round(origW / cfg.ratio);
                } else {
                  targetH = origH;
                  targetW = Math.round(origH * cfg.ratio);
                }
              }
            }
          }
        }

        let finalW = targetW || origW;
        let finalH = targetH || origH;

        // プリセットなしで幅・高さ制限がある場合の通常アスペクト比維持リサイズ
        if ((!preset || preset === "none") && (targetW || targetH)) {
          const ratio = origW / origH;
          if (targetW && !targetH) {
            if (origW > targetW) {
              finalW = targetW;
              finalH = Math.round(finalW / ratio);
            }
          } else if (!targetW && targetH) {
            if (origH > targetH) {
              finalH = targetH;
              finalW = Math.round(finalH * ratio);
            }
          } else if (targetW && targetH) {
            if (origW > targetW || origH > targetH) {
              let scale = targetW / origW;
              if (origH * scale > targetH) {
                scale = targetH / origH;
              }
              finalW = Math.round(origW * scale);
              finalH = Math.round(origH * scale);
            }
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, finalW);
        canvas.height = Math.max(1, finalH);
        const ctx = canvas.getContext("2d");

        if (preset && preset !== "none") {
          const targetRatio = finalW / finalH;
          const origRatio = origW / origH;

          if (fit === "crop") {
            // スマート中央クロップ（画像がつぶれない＆ピッタリ埋める）
            let sx = 0, sy = 0, sw = origW, sh = origH;
            if (origRatio > targetRatio) {
              // 元画像の方が横長 -> 左右を中央トリミング
              sw = origH * targetRatio;
              sx = (origW - sw) / 2;
            } else {
              // 元画像の方が縦長 -> 上下を中央トリミング
              sh = origW / targetRatio;
              sy = (origH - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, finalW, finalH);
          } else if (fit === "pad_white" || fit === "pad_black") {
            // 余白追加（画像を一切削らず、余白を埋める）
            ctx.fillStyle = fit === "pad_white" ? "#ffffff" : "#000000";
            ctx.fillRect(0, 0, finalW, finalH);
            let dw = finalW, dh = finalH, dx = 0, dy = 0;
            if (origRatio > targetRatio) {
              dh = finalW / origRatio;
              dy = (finalH - dh) / 2;
            } else {
              dw = finalH * origRatio;
              dx = (finalW - dw) / 2;
            }
            ctx.drawImage(img, 0, 0, origW, origH, dx, dy, dw, dh);
          } else if (fit === "pad_blur") {
            // 背景ぼかし余白（SNS風のおしゃれなぼかし背景）
            ctx.save();
            ctx.filter = "blur(24px) brightness(0.9)";
            ctx.drawImage(img, 0, 0, finalW, finalH);
            ctx.restore();
            let dw = finalW, dh = finalH, dx = 0, dy = 0;
            if (origRatio > targetRatio) {
              dh = finalW / origRatio;
              dy = (finalH - dh) / 2;
            } else {
              dw = finalH * origRatio;
              dx = (finalW - dw) / 2;
            }
            // ドロップシャドウをつけて前景画像を描画
            ctx.shadowColor = "rgba(0,0,0,0.3)";
            ctx.shadowBlur = 15;
            ctx.drawImage(img, 0, 0, origW, origH, dx, dy, dw, dh);
          }
        } else {
          ctx.drawImage(img, 0, 0, finalW, finalH);
        }

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
    if (!file || file.isUnsupported || rotatingFileIdsRef.current.has(id)) return;

    rotatingFileIdsRef.current.add(id);
    setRotatingFileIds(new Set(rotatingFileIdsRef.current));
    try {
      const angle = direction === "left" ? -90 : 90;
      const rotateSource = async (src, type) => {
        const img = await loadImageAsync(src);
        const canvas = document.createElement("canvas");
        canvas.width = img.height;
        canvas.height = img.width;
        const ctx = canvas.getContext("2d");
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        return canvas.toDataURL(type, Number(quality));
      };

      // 元画像と出力画像をそれぞれ回転し、サイズ・形式・トリミングを維持する。
      const newOriginalSrc = await rotateSource(file.originalSrc, "image/png");
      const newDisplaySrc = file.src === file.originalSrc && file.type === "image/png"
        ? newOriginalSrc
        : await rotateSource(file.src, file.type);

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id && f.originalSrc === file.originalSrc && f.src === file.src
            ? {
                ...f,
                originalSrc: newOriginalSrc,
                src: newDisplaySrc,
                size: dataURLtoBlob(newDisplaySrc).size
              }
            : f
        )
      );
      addLog(`Rotated ${file.name}: ${angle}°`);
    } catch (err) {
      console.error("Image rotation failed:", err);
      alert("ページ・画像の回転に失敗しました。もう一度お試しください。");
    } finally {
      rotatingFileIdsRef.current.delete(id);
      setRotatingFileIds(new Set(rotatingFileIdsRef.current));
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

  const changeSingleFileFormat = async (id, newFormat) => {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    const newSrc = await resizeImage(
      file.originalSrc,
      maxWidth,
      maxHeight,
      quality,
      newFormat
    );
    const ext = getExtFromFormat(newFormat);
    const baseWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    const newName = `${baseWithoutExt}${ext}`;
    const newSize = Math.round((newSrc.length * 3) / 4);

    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              src: newSrc,
              type: newFormat,
              name: newName,
              size: newSize,
              userRenamed: true
            }
          : f
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
        // 未対応形式はワークスペース内で保管・再ダウンロードできるが、画像変換の対象にはしない。
        if (file.isUnsupported) continue;
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
        const ext = getExtFromFormat(targetFormat);
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
  }, [maxWidth, maxHeight, quality, targetFormat, aspectRatioPreset, fitMode]);

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

        const isVideo =
          file.type.startsWith("video/") ||
          /\.(mp4|mov|webm|avi|m4v|mkv)$/i.test(file.name);

        if (isVideo) {
          // 動画ファイルの場合は動画サムネイル抽出モーダルを開く
          setVideoToExtract(file);
          continue;
        }

        const isEmailOrDat =
          file.name.toLowerCase().endsWith(".dat") ||
          file.name.toLowerCase().endsWith(".eml") ||
          file.name.toLowerCase().endsWith(".msg") ||
          file.type === "application/vnd.ms-tnef" ||
          file.type === "message/rfc822";

        if (isEmailOrDat) {
          setProcessStatus(`メール/datファイルを解析中: ${file.name}`);
          try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            // 1. まずOutlook winmail.dat (TNEF) 形式かを高精度パーサーで優先判定
            const tnefResult = parseTnefRobust(bytes);
            if (tnefResult && (tnefResult.attachments.length > 0 || tnefResult.body?.text || tnefResult.subject)) {
              addLog(`Parsed TNEF winmail.dat: ${file.name}, found ${tnefResult.attachments.length} attachments.`);
              setEmailToExtract({ file, parsed: tnefResult });
              processedItems = [{
                id: generateId(),
                name: file.name,
                originalName: file.name,
                type: "application/vnd.ms-tnef",
                size: file.size,
                originalSize: file.size,
                rawFile: file,
                isUnsupported: true,
                isEmailPackage: true,
                emailParsed: tnefResult,
                renderWarning: tnefResult.attachments.length > 0
                  ? `Outlookのwinmail.datを検出しました（添付ファイル: ${tnefResult.attachments.length}件）。「中身を展開する」から画像や文書をワークスペースに取り込めます。`
                  : "Outlookのwinmail.datを検出しました（本文のみ）。「中身を展開する」からメッセージをご確認いただけます。"
              }];
            } else {
              // 2. TNEF以外（.eml, .msg など）はOmniMailで解析
              const detected = detectEmailFormat(bytes);
              if (
                detected !== "unknown" ||
                file.name.toLowerCase().endsWith(".eml") ||
                file.name.toLowerCase().endsWith(".msg")
              ) {
                const parsed = await parseEmail(bytes);
                if (
                  parsed &&
                  (parsed.attachments?.length > 0 ||
                    parsed.body?.text ||
                    parsed.body?.html ||
                    parsed.subject)
                ) {
                  addLog(
                    `Parsed email file: ${file.name}, found ${parsed.attachments?.length || 0} attachments.`
                  );
                  setEmailToExtract({ file, parsed });
                  processedItems = [{
                    id: generateId(),
                    name: file.name,
                    originalName: file.name,
                    type: file.type || "message/rfc822",
                    size: file.size,
                    originalSize: file.size,
                    rawFile: file,
                    isUnsupported: true,
                    isEmailPackage: true,
                    emailParsed: parsed,
                    renderWarning: parsed.attachments?.length > 0
                      ? `メールファイルを検出しました（添付ファイル: ${parsed.attachments.length}件）。「中身を展開する」から画像や文書を取り込めます。`
                      : "メールファイルを検出しました（本文のみ）。「中身を展開する」からメッセージをご確認いただけます。"
                  }];
                }
              }
            }
          } catch (err) {
            console.warn("Email/dat parsing failed, fallback to normal file handling:", err);
            addLog(`Email/dat parsing failed for ${file.name}: ${err.message}`);
          }
        }

        if (processedItems.length > 0) {
          // メールパッケージ等として処理完了
        } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
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
        } else if (file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(file.name)) {
          setProcessStatus(`画像を処理中: ${file.name}`);
          // 🚀 超高速プレビュー: 0.001秒で画面に表示させるためのObject URLを即座に生成
          const instantUrl = URL.createObjectURL(file);
          const ext = getExtFromFormat(targetFormat);
          const baseWithoutExt = file.name.replace(/\.[^/.]+$/, "");
          const targetName = `${baseWithoutExt}${ext}`;
          const targetType = targetFormat === "application/pdf" ? "image/jpeg" : targetFormat;

          const instantItem = {
            id: generateId(),
            name: targetName,
            originalName: file.name,
            originalSrc: instantUrl,
            src: instantUrl,
            type: targetType,
            size: file.size,
            originalSize: file.size,
            isPdfPage: false,
            rawFile: file,
            isOptimizing: true
          };

          // 画面に即座に表示（体感0秒で作業スペースへ切り替え）
          setFiles((prev) => [instantItem, ...prev]);

          // バックグラウンドでBase64化とリサイズ・圧縮処理を非同期実行
          (async () => {
            try {
              const fullItem = await processImage(file);
              const resizedDataUrl = await resizeImage(
                fullItem.originalSrc,
                maxWidth,
                maxHeight,
                quality,
                targetType
              );
              const newSize = Math.round((resizedDataUrl.length * 3) / 4);
              setFiles((prev) =>
                prev.map((f) =>
                  f.id === instantItem.id
                    ? {
                        ...f,
                        originalSrc: fullItem.originalSrc,
                        src: resizedDataUrl,
                        size: newSize,
                        isOptimizing: false
                      }
                    : f
                )
              );
              try { URL.revokeObjectURL(instantUrl); } catch (_) {}
            } catch (err) {
              console.warn("Background optimization error:", err);
            }
          })();

          // instantItemは既にsetFilesしたため、ループ末尾のnewProcessedFilesには含めない
          continue;
        } else {
          // 形式が分からないファイルも、ワークスペースには追加する。
          // ブラウザでの編集非対応であることを明示し、元ファイルは保持する。
          processedItems = [{
            id: generateId(),
            name: file.name,
            originalName: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            originalSize: file.size,
            rawFile: file,
            isUnsupported: true,
            renderWarning: "この形式は現在プレビュー・編集には未対応です。ワークスペース内で保持し、そのままダウンロードできます。"
          }];
        }

        // Apply settings immediately
        for (let i = 0; i < processedItems.length; i++) {
          if (processingCancelledRef.current) break;
          if (processedItems[i].isUnsupported) continue;
          const resizedDataUrl = await resizeImage(
            processedItems[i].originalSrc,
            maxWidth,
            maxHeight,
            quality,
            targetFormat === "application/pdf" ? "image/jpeg" : targetFormat
          );
          processedItems[i].src = resizedDataUrl;
          processedItems[i].size = Math.round((resizedDataUrl.length * 3) / 4);

          const ext = getExtFromFormat(targetFormat);

          if (!processedItems[i].name.endsWith(ext)) {
            processedItems[i].name =
              processedItems[i].name.replace(/\.[^/.]+$/, "") + ext;
          }
          processedItems[i].type =
            targetFormat === "application/pdf" ? "image/jpeg" : targetFormat;
        }

        if (processedItems.length > 0) {
          setFiles((prev) => [...processedItems, ...prev]);
        }
      } catch (error) {
        if (error instanceof ProcessingCancelledError) break;
        console.error("Processing Error:", error);
        alert(`エラーが発生しました: ${file.name}\n${error.message}`);
      }
    }

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
    if (file.isUnsupported) return file.name;
    const ext = file.type === "image/png" ? ".png" : ".jpg";
    if (file.name.toLowerCase().endsWith(ext)) return file.name;
    return file.name.replace(/\.[^/.]+$/, "") + ext;
  };

  const downloadFile = async (file) => {
    if (file.isUnsupported && file.rawFile) {
      saveAs(file.rawFile, file.name);
      return;
    }
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
      if (file.isUnsupported && file.rawFile) {
        folder.file(file.name, file.rawFile);
        return;
      }
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

      // メタデータの消去（匿名化オプション）
      if (pdfStripMetadata) {
        doc.setProperties({
          title: "",
          subject: "",
          author: "",
          keywords: "",
          creator: "PDF Tool"
        });
      }

      doc.deletePage(1);

      const validFiles = files.filter((f) => !f.isUnsupported);
      const totalPages = validFiles.length;
      let currentPageNum = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.isUnsupported) continue;
        currentPageNum++;
        try {
          // [修正] バグチェック部指摘: 画像の安全なロード（onerror漏れによるフリーズ防止）
          const img = await loadImageAsync(file.src);
          const width = img.width;
          const height = img.height;

          doc.addPage([width, height], width > height ? "l" : "p");
          let format = file.type === "image/png" ? "PNG" : "JPEG";
          doc.addImage(file.src, format, 0, 0, width, height);

          // ページ番号の自動印字（視認性の高い白背景カプセル付き）
          if (pdfAddPageNumber && totalPages > 0) {
            let label = "";
            if (pdfPageNumberFormat === "page-total") {
              label = `${currentPageNum} / ${totalPages}`;
            } else if (pdfPageNumberFormat === "hyphen") {
              label = `- ${currentPageNum} -`;
            } else {
              label = `${currentPageNum}`;
            }

            const baseDim = Math.min(width, height);
            const fontSize = Math.max(12, Math.min(26, Math.round(baseDim * 0.024)));
            doc.setFontSize(fontSize);
            doc.setFont("helvetica", "bold");

            const marginX = Math.max(20, Math.round(width * 0.04));
            const marginY = Math.max(20, Math.round(height * 0.035));

            let posX = width / 2;
            let align = "center";
            if (pdfPageNumberPos === "bottom-right") {
              posX = width - marginX;
              align = "right";
            }

            const posY = height - marginY;

            // 背景カプセル（文字が写真や下地に紛れないよう半透明白座布団を描画）
            const textWidth = doc.getTextWidth(label);
            const padX = fontSize * 0.5;
            const padY = fontSize * 0.35;
            const badgeW = textWidth + padX * 2;
            const badgeH = fontSize + padY * 2;
            const badgeX = align === "center" ? posX - badgeW / 2 : posX - badgeW + padX;
            const badgeY = posY - fontSize + padY * 0.2;

            doc.setFillColor(255, 255, 255);
            doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 4, 4, "F");

            doc.setTextColor(40, 40, 40);
            doc.text(label, posX, posY, { align });
          }
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
            <div>
              <h1 className="text-xl font-bold text-white hidden sm:block leading-tight">
                Media Workspace Studio
              </h1>
              <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-orange-100 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                <span>EXIF情報(GPS・撮影情報) 完全消去・プライバシー保護</span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="hidden md:flex items-center space-x-2 text-xs text-white bg-white/20 px-3 py-1.5 rounded-full font-medium">
              <FileType className="w-3.5 h-3.5" />
              <span>PNG / JPG / PDF / HEIC / Word / Excel / 動画(MP4/MOV)</span>
            </div>

            <button
              type="button"
              onClick={() => setIsPdfCompareOpen(true)}
              className="flex items-center space-x-1.5 bg-orange-700/90 hover:bg-orange-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-orange-400/40 shadow-xs"
              title="新旧2つのPDFの変更点・修正箇所を比較"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>PDF差分比較</span>
            </button>
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

      {/* グローバル常駐ファイル入力（全画面で最速応答・OSファイルダイアログ即時起動） */}
      <input
        ref={fileInputRef}
        type="file"
        id="fileInput"
        className="hidden"
        multiple
        accept="image/*,application/pdf,.heic,.docx,.xlsx,.xls,.mp4,.mov,.webm,.avi,.dat,.eml,.msg"
        onChange={handleFileSelect}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Workspace guide: 初めての人でも目的から機能を選べる入口（ファイル未選択時のみ大きく表示） */}
        {files.length === 0 ? (
          <section className="overflow-hidden rounded-3xl border border-orange-200 bg-gradient-to-br from-white via-orange-50 to-amber-100/70 shadow-sm animate-fadeIn">
            <div className="px-6 py-7 sm:px-8 sm:py-8">
              <div className="max-w-3xl">
                <p className="text-xs font-extrabold tracking-[0.18em] text-orange-600">MEDIA WORKSPACE</p>
                <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-orange-950 sm:text-3xl">
                  ファイルを入れるだけで、作業をはじめられる。
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600 sm:text-base">
                  PDFか画像か分からなくても大丈夫。複数のファイルをまとめて追加すると、形式ごとにできる作業をご案内します。
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={openWorkspaceAction}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openWorkspaceAction();
                  }
                }}
                className={`group mt-6 flex w-full cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed px-5 py-5 text-left shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 sm:px-6 ${
                  isDragging ? "border-orange-500 bg-orange-100" : "border-orange-300 bg-white hover:border-orange-500 hover:bg-orange-50"
                }`}
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-600 text-white shadow-md transition-transform group-hover:scale-105">
                  <UploadCloud className="h-7 w-7" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-extrabold text-orange-950 sm:text-lg">ファイルをまとめて入れる</span>
                  <span className="mt-1 block text-xs leading-relaxed text-stone-600 sm:text-sm">形式は分からなくてOK。画像・動画・PDF・Word・Excel・メール添付（winmail.dat等）などを、複数まとめて選択またはドロップできます。</span>
                </span>
                <span className="hidden shrink-0 items-center gap-1 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors group-hover:bg-orange-600 sm:inline-flex">
                  ファイルを選ぶ <ArrowRight className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-orange-700/80">
                <ClipboardPaste className="h-3.5 w-3.5" />
                スクリーンショットは、画面上で Cmd+V（Ctrl+V）でも追加できます。
              </p>

              <div className="mt-8 flex items-center gap-3">
                <div className="h-px flex-1 bg-orange-200" />
                <p className="text-xs font-bold text-orange-800">目的が決まっている方はこちら</p>
                <div className="h-px flex-1 bg-orange-200" />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {[
                  {
                    title: "2つのPDFを比較",
                    description: "新旧PDFの変更箇所（文字・図面）を赤と青で自動検出します。",
                    action: "比較ツールを開く",
                    onClick: () => setIsPdfCompareOpen(true),
                    icon: Sparkles,
                    tone: "bg-indigo-50 text-indigo-700 border-indigo-200",
                    buttonTone: "bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-400"
                  },
                  {
                    title: "動画を扱う",
                    description: "必要なシーンを切り出し、静止画として保存できます。",
                    action: "動画を選ぶ",
                    icon: Video,
                    tone: "bg-rose-50 text-rose-600 border-rose-200",
                    buttonTone: "bg-rose-400 hover:bg-rose-500 focus:ring-rose-300"
                  },
                  {
                    title: "画像を整える",
                    description: "リサイズ・圧縮・形式変換・トリミングができます。",
                    action: "画像を選ぶ",
                    icon: Crop,
                    tone: "bg-orange-50 text-orange-600 border-orange-200",
                    buttonTone: "bg-orange-400 hover:bg-orange-500 focus:ring-orange-300"
                  },
                  {
                    title: "PDFに書き込む",
                    description: "PDFを開いた後、各ページの「編集」から文字や図形を追加できます。",
                    action: "PDFを選ぶ",
                    icon: Edit3,
                    tone: "bg-amber-50 text-amber-700 border-amber-200",
                    buttonTone: "bg-amber-400 hover:bg-amber-500 focus:ring-amber-300"
                  },
                  {
                    title: "PDFを隠す・まとめる",
                    description: "「編集」で黒塗り・モザイク。並べ替えて「PDFで保存」で結合できます。",
                    action: "PDFを選ぶ",
                    icon: ShieldCheck,
                    tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
                    buttonTone: "bg-emerald-500 hover:bg-emerald-600 focus:ring-emerald-300"
                  },
                  {
                    title: "書類を変換する",
                    description: "Word・Excel・PDFを読み込み、画像やPDFとして整えられます。",
                    action: "ファイルを選ぶ",
                    icon: FileText,
                    tone: "bg-sky-50 text-sky-700 border-sky-200",
                    buttonTone: "bg-sky-500 hover:bg-sky-600 focus:ring-sky-300"
                  }
                ].map(({ title, description, action, onClick, icon: Icon, tone, buttonTone }) => (
                  <article key={title} className="group flex min-h-52 flex-col rounded-2xl border border-orange-100 bg-white/90 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${tone}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-bold text-orange-950">{title}</h3>
                    <p className="mt-1.5 flex-1 text-xs leading-relaxed text-stone-600">{description}</p>
                    <button
                      type="button"
                      onClick={onClick || openWorkspaceAction}
                      className={`mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${buttonTone}`}
                    >
                      {action}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : (
          /* 取り込み済み時：最上部に表示されるコンパクトな追加ドロップゾーン */
          <div
            role="button"
            tabIndex={0}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={openWorkspaceAction}
            className={`flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border-2 border-dashed transition-all cursor-pointer shadow-xs animate-fadeIn ${
              isDragging ? "border-orange-500 bg-orange-100" : "border-orange-300/80 bg-orange-50/70 hover:bg-orange-100/70 hover:border-orange-400"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600 text-white shadow-sm shrink-0">
                <UploadCloud className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-extrabold text-orange-950">
                  ファイルをさらに追加・ドロップできます
                </p>
                <p className="text-xs text-orange-700/80">
                  画像・動画・PDF・Office文書（Cmd+Vでスクリーンショット貼り付けも可能）
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-xl bg-orange-500 hover:bg-orange-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors"
              >
                ＋ ファイルを追加
              </button>
            </div>
          </div>
        )}

        {/* Settings Bar (スマート＆スリム設計) */}
        <div className="p-4 sm:p-5 rounded-2xl glass-panel shadow-sm space-y-4 border border-orange-200/80">
          {/* Top Status & Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-200/70 pb-2.5">
            <div className="flex items-center space-x-2">
              <Settings2 className="w-4 h-4 text-orange-600" />
              <h2 className="font-bold text-gray-800 text-sm">一括変換設定</h2>
              <span className="text-xs text-orange-700/80 hidden sm:inline">（※各写真の個別比率や切り抜き位置の変更は、各カードの「編集」から行えます）</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-800 border border-emerald-300/80 px-2.5 py-1 rounded-full font-semibold shadow-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>EXIF情報削除済み</span>
            </div>
          </div>

          {/* 出力形式（拡張子）の選択 - スマートなピル型ボタングループ */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-orange-950 uppercase tracking-wider flex items-center gap-1">
                <FileType className="w-3.5 h-3.5 text-orange-600" />
                出力形式:
              </span>
              <div className="inline-flex p-1 bg-orange-100/70 rounded-xl border border-orange-200/80 space-x-1">
                {[
                  { id: "image/png", label: "PNG (透過)" },
                  { id: "image/jpeg", label: "JPG (写真)" },
                  { id: "image/webp", label: "WebP (超軽量)" },
                  { id: "application/pdf", label: "PDF (書類)" }
                ].map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setTargetFormat(fmt.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      targetFormat === fmt.id
                        ? "bg-orange-600 text-white shadow-sm ring-1 ring-orange-400 font-extrabold"
                        : "text-gray-700 hover:text-orange-900 hover:bg-white/60"
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 一括比率変換（任意） */}
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-orange-950 flex items-center gap-1">
                <Crop className="w-3.5 h-3.5 text-orange-600" />
                一括比率:
              </span>
              <select
                value={aspectRatioPreset}
                onChange={(e) => setAspectRatioPreset(e.target.value)}
                className="bg-white border border-orange-200 text-gray-800 text-xs font-medium rounded-lg px-2.5 py-1.5 focus:ring-orange-500 focus:border-orange-500 shadow-xs"
              >
                <option value="none">元の比率のまま</option>
                <option value="note_cover">note見出し (1280×670)</option>
                <option value="x_post">16:9 (X / YouTube)</option>
                <option value="insta_square">1:1 (正方形)</option>
                <option value="insta_story">9:16 (ストーリー/縦長)</option>
                <option value="ratio_4_3">4:3 (標準)</option>
                <option value="ratio_3_2">3:2 (一眼写真)</option>
                <option value="ratio_golden">黄金比 (1:1.618)</option>
              </select>

              {aspectRatioPreset !== "none" && (
                <select
                  value={fitMode}
                  onChange={(e) => setFitMode(e.target.value)}
                  className="bg-orange-50 border border-orange-300 text-orange-900 text-xs font-bold rounded-lg px-2 py-1.5 focus:ring-orange-500 focus:border-orange-500 shadow-xs animate-fadeIn"
                >
                  <option value="crop">✂️ 切り抜き (隙間なし)</option>
                  <option value="pad_white">⬜ 白余白</option>
                  <option value="pad_black">⬛ 黒余白</option>
                  <option value="pad_blur">🌫️ ぼかし余白</option>
                </select>
              )}
            </div>
          </div>

          {/* 詳細オプション（画質・px・PDF） */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-orange-200/60">
            {/* 画質 / 圧縮率 */}
            <div className="flex items-center space-x-2 bg-white/70 px-3 py-1.5 rounded-lg border border-orange-200">
              <label className="text-xs font-semibold text-orange-950 shrink-0">画質:</label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-orange-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs font-extrabold text-orange-600 min-w-[36px] text-right">
                {Math.round(quality * 100)}%
              </span>
            </div>

            {/* 手動カスタムサイズ */}
            <div className="flex items-center space-x-1.5 bg-white/70 px-3 py-1.5 rounded-lg border border-orange-200">
              <label className="text-xs font-semibold text-orange-950 shrink-0">一括px:</label>
              <input
                type="number"
                placeholder="幅"
                value={maxWidth}
                onChange={(e) => setMaxWidth(e.target.value)}
                className="w-full bg-white border border-orange-200 text-gray-800 text-xs rounded px-1.5 py-0.5 focus:ring-orange-500"
              />
              <span className="text-orange-400 text-xs">×</span>
              <input
                type="number"
                placeholder="高さ"
                value={maxHeight}
                onChange={(e) => setMaxHeight(e.target.value)}
                className="w-full bg-white border border-orange-200 text-gray-800 text-xs rounded px-1.5 py-0.5 focus:ring-orange-500"
              />
            </div>

            {/* PDFページ指定 */}
            <div className="flex items-center space-x-2 bg-white/70 px-3 py-1.5 rounded-lg border border-orange-200">
              <label className="text-xs font-semibold text-orange-950 shrink-0">PDF頁:</label>
              <input
                type="text"
                placeholder="例: 1, 3-5 (空欄=全頁)"
                value={pdfPageRange}
                onChange={(e) => setPdfPageRange(e.target.value)}
                className="w-full bg-white border border-orange-200 text-gray-800 text-xs rounded px-1.5 py-0.5 focus:ring-orange-500"
              />
            </div>
          </div>

          {/* PDF Password & Advanced Settings */}
          {targetFormat === "application/pdf" && (
            <div className="pt-3 border-t border-orange-200/50 space-y-3 animate-fadeIn">
              {/* パスワード保護 & 印刷制限 */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center space-x-2">
                  <label className="text-xs font-bold text-orange-900 shrink-0">
                    PDF出力パスワード:
                  </label>
                  <div className="relative w-64">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="保護用パスワードを入力"
                      value={pdfPassword}
                      onChange={(e) => setPdfPassword(e.target.value)}
                      className="w-full bg-white border border-orange-200 text-gray-800 text-xs rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 pr-8 shadow-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-2 flex items-center text-orange-400 hover:text-orange-600"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="blockPrint"
                    disabled={!pdfPassword.trim()}
                    checked={pdfPassword.trim() ? pdfBlockPrinting : false}
                    onChange={(e) => setPdfBlockPrinting(e.target.checked)}
                    className="w-4 h-4 text-orange-600 bg-white border-orange-200 rounded focus:ring-orange-500 disabled:opacity-50"
                  />
                  <label
                    htmlFor="blockPrint"
                    className={`text-xs font-medium cursor-pointer ${
                      pdfPassword.trim() ? "text-orange-950" : "text-gray-400"
                    }`}
                  >
                    印刷を禁止する
                  </label>
                </div>
              </div>

              {/* ページ番号（ノンブル） & メタデータ削除（匿名化） */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 border-t border-orange-100">
                {/* ページ番号チェック */}
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="addPageNum"
                    checked={pdfAddPageNumber}
                    onChange={(e) => setPdfAddPageNumber(e.target.checked)}
                    className="w-4 h-4 text-orange-600 bg-white border-orange-200 rounded focus:ring-orange-500 cursor-pointer"
                  />
                  <label
                    htmlFor="addPageNum"
                    className="text-xs font-bold text-orange-950 cursor-pointer flex items-center gap-1 select-none"
                  >
                    <span>🔢 ページ番号を印字</span>
                  </label>
                </div>

                {pdfAddPageNumber && (
                  <div className="flex items-center gap-3 bg-white/90 px-2.5 py-1 rounded-lg border border-orange-200 shadow-xs animate-fadeIn">
                    <div className="flex items-center space-x-1">
                      <span className="text-[11px] text-stone-600 font-medium">位置:</span>
                      <select
                        value={pdfPageNumberPos}
                        onChange={(e) => setPdfPageNumberPos(e.target.value)}
                        className="bg-orange-50 border border-orange-200 text-stone-800 text-[11px] font-semibold rounded px-1.5 py-0.5 focus:ring-orange-500"
                      >
                        <option value="bottom-center">中央下</option>
                        <option value="bottom-right">右下</option>
                      </select>
                    </div>

                    <div className="flex items-center space-x-1">
                      <span className="text-[11px] text-stone-600 font-medium">形式:</span>
                      <select
                        value={pdfPageNumberFormat}
                        onChange={(e) => setPdfPageNumberFormat(e.target.value)}
                        className="bg-orange-50 border border-orange-200 text-stone-800 text-[11px] font-semibold rounded px-1.5 py-0.5 focus:ring-orange-500"
                      >
                        <option value="page-total">1 / 5 （総ページ付き）</option>
                        <option value="hyphen">- 1 - （ハイフン）</option>
                        <option value="simple">1 （番号のみ）</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* メタデータ消去チェック */}
                <div className="flex items-center space-x-2 sm:ml-auto">
                  <input
                    type="checkbox"
                    id="stripMeta"
                    checked={pdfStripMetadata}
                    onChange={(e) => setPdfStripMetadata(e.target.checked)}
                    className="w-4 h-4 text-orange-600 bg-white border-orange-200 rounded focus:ring-orange-500 cursor-pointer"
                  />
                  <label
                    htmlFor="stripMeta"
                    className="text-xs font-medium text-stone-700 cursor-pointer flex items-center gap-1 select-none"
                    title="作成者名・PC情報・使用ソフト情報をPDFから消去して保存します"
                  >
                    <span>🛡️ メタデータを削除（匿名化）</span>
                  </label>
                </div>
              </div>
            </div>
          )}
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
              各ページの「左90°・右90°」で向きを変更できます。回転は保存にも反映されます。ハンドルをドラッグして並び替えできます。
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
                    {file.isUnsupported ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-gray-500">
                        {file.isEmailPackage ? (
                          <>
                            <div className="w-12 h-12 rounded-2xl bg-orange-500/20 text-orange-600 flex items-center justify-center shadow-inner border border-orange-300/40">
                              <Mail className="h-6 w-6" />
                            </div>
                            <span className="text-xs font-bold text-gray-800">メールパッケージ</span>
                            <span className="max-w-full truncate text-[11px] text-gray-500 font-mono">{file.name}</span>
                            {file.emailParsed?.attachments?.length > 0 ? (
                              <span className="text-[10px] font-semibold text-orange-700 bg-orange-100 border border-orange-200 px-2.5 py-0.5 rounded-full">
                                添付ファイル {file.emailParsed.attachments.length}件
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                本文のみ
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <FileType className="h-12 w-12 text-orange-400" />
                            <span className="text-xs font-bold">プレビュー未対応ファイル</span>
                            <span className="max-w-full truncate text-[10px]">{file.name}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <img
                        src={file.src}
                        alt={file.name}
                        className="absolute inset-0 w-full h-full object-contain p-4 transition-transform duration-500 group-hover:scale-105"
                      />
                    )}

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

                    {/* Badge */}
                    <div className="absolute top-2 right-2 flex flex-col items-end gap-1 z-10">
                      <span className="bg-gray-900 text-white text-xs font-bold min-w-8 h-8 px-2 rounded-full shadow flex items-center justify-center">
                        {index + 1}
                      </span>
                      {file.isUnsupported ? (
                        <span className={`text-[10px] font-bold px-2 py-1 rounded shadow-sm ${file.isEmailPackage ? "bg-orange-600 text-white" : "bg-slate-500 text-white"}`}>
                          {file.isEmailPackage ? "メール" : "保管"}
                        </span>
                      ) : file.isPdfPage ? (
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
                      {file.isUnsupported ? (
                        <div className="flex space-x-2">
                          {file.isEmailPackage && (
                            <button
                              onClick={() => {
                                if (file.emailParsed) {
                                  setEmailToExtract({ file: file.rawFile, parsed: file.emailParsed });
                                }
                              }}
                              className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg shadow-lg transform transition-transform hover:scale-105 flex items-center space-x-1 cursor-pointer"
                              title="メール内容・添付ファイルを展開"
                            >
                              <Mail className="w-4 h-4" />
                              <span className="text-xs font-bold">開く</span>
                            </button>
                          )}
                          <button
                            onClick={() => downloadFile(file)}
                            className="p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg shadow-lg transform transition-transform hover:scale-105 flex items-center space-x-1 cursor-pointer"
                            title="元ファイルをダウンロード"
                          >
                            <Download className="w-4 h-4" />
                            <span className="text-xs font-bold">保存</span>
                          </button>
                        </div>
                      ) : <div className="flex space-x-2">
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
                      </div>}
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
                    {!file.isUnsupported && (
                      <div className="mb-3 flex items-center gap-2 border-b border-orange-100 pb-3" aria-busy={rotatingFileIds.has(file.id)}>
                        <span className="mr-auto text-xs font-semibold text-orange-800">
                          {rotatingFileIds.has(file.id) ? "回転中…" : file.isPdfPage ? "ページ回転" : "画像回転"}
                        </span>
                        <button
                          type="button"
                          onClick={() => rotateImage(file.id, "left")}
                          disabled={rotatingFileIds.has(file.id) || isProcessing}
                          className="flex min-h-10 items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 text-xs font-semibold text-orange-800 transition-colors hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:cursor-wait disabled:opacity-50"
                          aria-label={`${index + 1}番目を左に90度回転`}
                          title="左に90度回転（保存にも反映）"
                        >
                          <RotateCcw className="h-4 w-4" />
                          左90°
                        </button>
                        <button
                          type="button"
                          onClick={() => rotateImage(file.id, "right")}
                          disabled={rotatingFileIds.has(file.id) || isProcessing}
                          className="flex min-h-10 items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 text-xs font-semibold text-orange-800 transition-colors hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:cursor-wait disabled:opacity-50"
                          aria-label={`${index + 1}番目を右に90度回転`}
                          title="右に90度回転（保存にも反映）"
                        >
                          <RotateCw className="h-4 w-4" />
                          右90°
                        </button>
                      </div>
                    )}
                    {file.renderWarning && (
                      <div
                        className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800"
                        role="status"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{file.renderWarning}</span>
                        </div>
                        {file.rawFile && (file.isEmailPackage || file.name.toLowerCase().endsWith(".dat") || file.name.toLowerCase().endsWith(".eml") || file.name.toLowerCase().endsWith(".msg")) && (
                          <button
                            onClick={async () => {
                              if (file.emailParsed) {
                                setEmailToExtract({ file: file.rawFile, parsed: file.emailParsed });
                                return;
                              }
                              try {
                                const buf = await file.rawFile.arrayBuffer();
                                const bytes = new Uint8Array(buf);
                                const tnef = parseTnefRobust(bytes);
                                if (tnef && (tnef.attachments.length > 0 || tnef.body?.text || tnef.subject)) {
                                  setEmailToExtract({ file: file.rawFile, parsed: tnef });
                                  return;
                                }
                                const eml = await parseEmail(bytes);
                                if (eml) {
                                  setEmailToExtract({ file: file.rawFile, parsed: eml });
                                  return;
                                }
                                alert("winmail.dat またはメール形式として認識できませんでした。通常のファイルです。");
                              } catch (err) {
                                alert("メールファイルの解析に失敗しました: " + (err.message || err));
                              }
                            }}
                            className="w-full py-1.5 px-3 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-md text-xs font-bold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            <span>中身（添付ファイル・本文）を展開する</span>
                          </button>
                        )}
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
                      {file.isUnsupported ? (
                        <span className="text-[10px] font-bold text-slate-500">編集対象外</span>
                      ) : <div className="flex items-center space-x-1">
                        <select
                          value={file.type}
                          onChange={(e) => changeSingleFileFormat(file.id, e.target.value)}
                          className="uppercase bg-orange-50 hover:bg-orange-100 text-orange-800 font-extrabold border border-orange-300 text-[10px] rounded px-1.5 py-0.5 cursor-pointer shadow-xs focus:ring-1 focus:ring-orange-500 transition-colors"
                          title="この画像だけの形式・拡張子を変更"
                        >
                          <option value="image/png">PNG</option>
                          <option value="image/jpeg">JPG</option>
                          <option value="image/webp">WEBP</option>
                        </select>
                      </div>}
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
              <h4 className="text-xs font-bold text-gray-600">PDF・画像の回転</h4>
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

      {/* Video Snapshot Extractor Modal */}
      {videoToExtract && (
        <VideoExtractorModal
          file={videoToExtract}
          onExtract={handleExtractFromVideo}
          onClose={() => setVideoToExtract(null)}
        />
      )}

      {/* Email / Winmail.dat Extractor Modal */}
      {emailToExtract && (
        <EmailExtractorModal
          emailData={emailToExtract}
          onImportAttachments={handleExtractFromEmail}
          onClose={() => setEmailToExtract(null)}
        />
      )}

      {/* PDF Diff Compare Modal (完全ローカル処理) */}
      <PdfCompareModal
        isOpen={isPdfCompareOpen}
        onClose={() => setIsPdfCompareOpen(false)}
        pdfjsOptions={PDFJS_DOCUMENT_OPTIONS}
      />
    </div>
  );
}
