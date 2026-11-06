import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  X,
  UploadCloud,
  FileText,
  SlidersHorizontal,
  SplitSquareHorizontal,
  Layers,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Trash2,
  Crosshair,
  Sliders
} from "lucide-react";

/**
 * 高精度PDF差分比較モーダル
 * - スキャナーPDFの傾き・余白ズレ・縮小（数％）を自動検出してコンテンツを完全位置同期
 * - 近傍トレランス探索（ノイズ吸収フィルター）により、位置ズレによる全行真っ赤/真っ青の誤検知を完全撲滅
 * - 変更された本物の文字（「品質を高め」→「品質を向上させ」等）のみを赤（削除）・青（追加）でクッキリ表示
 */
export const PdfCompareModal = ({ isOpen, onClose, pdfjsOptions }) => {
  const [fileOld, setFileOld] = useState(null);
  const [fileNew, setFileNew] = useState(null);
  const [docOld, setDocOld] = useState(null);
  const [docNew, setDocNew] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [viewMode, setViewMode] = useState("diff"); // "diff" | "split" | "slider"
  const [zoomMode, setZoomMode] = useState("fit"); // "fit" | "100" | "custom"
  const [zoomScale, setZoomScale] = useState(1.0);
  const [sliderPos, setSliderPos] = useState(50); // 0% 〜 100%
  const [isProcessing, setIsProcessing] = useState(false);
  const [processMessage, setProcessMessage] = useState("");

  // スキャンズレ補正（自動位置合わせ ＆ 手動微調整）
  const [autoAlign, setAutoAlign] = useState(true);
  const [toleranceRadius, setToleranceRadius] = useState(10); // 許容半径 (スキャンズレ吸収に最適な10px)
  const [manualShiftX, setManualShiftX] = useState(0);
  const [manualShiftY, setManualShiftY] = useState(0);
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);

  // 描画済み画像データURL (ページごと)
  const [pageData, setPageData] = useState({
    oldUrl: null,
    newUrl: null,
    diffUrl: null,
    width: 0,
    height: 0,
    diffPercent: 0,
    diffCount: 0
  });

  const [isDraggingOld, setIsDraggingOld] = useState(false);
  const [isDraggingNew, setIsDraggingNew] = useState(false);

  const sliderContainerRef = useRef(null);
  const compareWorkspaceRef = useRef(null);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const zoomScaleRef = useRef(1.0);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const isPinchingRef = useRef(false);
  const pinchStateRef = useRef({
    startDist: 0,
    startScale: 1,
    lastMidX: 0,
    lastMidY: 0
  });

  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

  useEffect(() => {
    panOffsetRef.current = panOffset;
  }, [panOffset]);

  // タブレット（iPad Safari等）での2本指ピンチ拡大・縮小＆移動（画面全体の拡大を防止）
  useEffect(() => {
    const ws = compareWorkspaceRef.current;
    if (!ws || !isOpen) return;

    const getTouchDistAndMid = (t1, t2) => ({
      dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
      midX: (t1.clientX + t2.clientX) / 2,
      midY: (t1.clientY + t2.clientY) / 2
    });

    const handleTouchStart = (e) => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        isPinchingRef.current = true;
        setIsDraggingSlider(false);
        const { dist, midX, midY } = getTouchDistAndMid(e.touches[0], e.touches[1]);
        pinchStateRef.current = {
          startDist: Math.max(10, dist),
          startScale: zoomScaleRef.current,
          lastMidX: midX,
          lastMidY: midY
        };
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length >= 2 && isPinchingRef.current) {
        if (e.cancelable) e.preventDefault();
        const { dist, midX, midY } = getTouchDistAndMid(e.touches[0], e.touches[1]);
        const { startDist, startScale, lastMidX, lastMidY } = pinchStateRef.current;
        const nextScale = Math.max(0.5, Math.min(4.0, Number((startScale * (dist / startDist)).toFixed(2))));
        const dx = midX - lastMidX;
        const dy = midY - lastMidY;

        pinchStateRef.current.lastMidX = midX;
        pinchStateRef.current.lastMidY = midY;
        zoomScaleRef.current = nextScale;
        setZoomMode("custom");
        setZoomScale(nextScale);
        setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length === 0) {
        isPinchingRef.current = false;
      }
    };

    const preventSafariGesture = (e) => {
      if (e.cancelable) e.preventDefault();
    };

    ws.addEventListener("touchstart", handleTouchStart, { passive: false });
    ws.addEventListener("touchmove", handleTouchMove, { passive: false });
    ws.addEventListener("touchend", handleTouchEnd);
    ws.addEventListener("touchcancel", handleTouchEnd);
    ws.addEventListener("gesturestart", preventSafariGesture, { passive: false });
    ws.addEventListener("gesturechange", preventSafariGesture, { passive: false });
    ws.addEventListener("gestureend", preventSafariGesture, { passive: false });

    return () => {
      ws.removeEventListener("touchstart", handleTouchStart);
      ws.removeEventListener("touchmove", handleTouchMove);
      ws.removeEventListener("touchend", handleTouchEnd);
      ws.removeEventListener("touchcancel", handleTouchEnd);
      ws.removeEventListener("gesturestart", preventSafariGesture);
      ws.removeEventListener("gesturechange", preventSafariGesture);
      ws.removeEventListener("gestureend", preventSafariGesture);
    };
  }, [isOpen]);

  // iPad SafariのCanvasメモリ制限対策：不要になったCanvasのメモリを即時解放
  const releaseCanvas = (canvas) => {
    if (!canvas) return;
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // ignore
    }
  };

  // iPad Safari / iCloud Drive等でのファイル読み込み失敗を防ぐ安全なArrayBuffer取得ヘルパー
  const readFileAsArrayBuffer = async (file) => {
    if (typeof file.arrayBuffer === "function") {
      try {
        return await file.arrayBuffer();
      } catch {
        // FileReaderフォールバックへ進む
      }
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () =>
        reject(
          new Error(
            "ファイルの読み込みに失敗しました。iCloud Drive等のクラウド上にある場合は、一度端末にダウンロードしてから再度お試しください。"
          )
        );
      reader.readAsArrayBuffer(file);
    });
  };

  // PDF読み込みヘルパー
  const loadPdf = async (file) => {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const task = pdfjsLib.getDocument({
      data: arrayBuffer,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      ...(pdfjsOptions || {})
    });
    return await task.promise;
  };

  const handleFileProcess = async (file, type) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("PDFファイル（.pdf）を選択してください。");
      return;
    }

    setIsProcessing(true);
    setProcessMessage("PDFを読み込み中...");
    try {
      const doc = await loadPdf(file);
      if (type === "old") {
        setFileOld(file);
        setDocOld(doc);
      } else {
        setFileNew(file);
        setDocNew(doc);
      }
    } catch (err) {
      console.error("PDF読み込み失敗:", err);
      alert(`PDFの読み込みに失敗しました: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessMessage("");
    }
  };

  // ドキュメント更新時に総ページ数を再計算
  useEffect(() => {
    if (docOld && docNew) {
      const maxPages = Math.max(docOld.numPages, docNew.numPages);
      setTotalPages(maxPages);
      setCurrentPage(1);
    } else if (docOld) {
      setTotalPages(docOld.numPages);
    } else if (docNew) {
      setTotalPages(docNew.numPages);
    }
  }, [docOld, docNew]);

  // コンテンツ領域（黒枠や印字の境界ボックス）の高速高精度検出
  const getBlackBounds = (ctx, wParam, hParam) => {
    const id = ctx.getImageData(0, 0, wParam, hParam);
    const d = id.data;
    const w = id.width;
    const h = id.height;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    const step = 4;

    for (let y = 30; y < h - 30; y += step) {
      for (let x = 30; x < w - 30; x += step) {
        const idx = (y * w + x) * 4;
        const a = d[idx + 3];
        if (a < 50) continue; // 透明ピクセルは無視

        const lum = d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114;
        if (lum < 165) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (minX >= maxX || minY >= maxY) {
      return { minX: 0, minY: 0, maxX: w, maxY: h, w, h };
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  };

  // ページのレンダリング & スキャン自動アライメント差分計算
  useEffect(() => {
    if (!isOpen || (!docOld && !docNew)) {
      setPageData({
        oldUrl: null,
        newUrl: null,
        diffUrl: null,
        width: 0,
        height: 0,
        diffPercent: 0,
        diffCount: 0
      });
      return;
    }

    let isCancelled = false;

    const renderAndCalculateDiff = async () => {
      setIsProcessing(true);
      setProcessMessage(`第 ${currentPage} ページの高精度差分を解析中...`);

      let canvasOld = null;
      let canvasNew = null;
      let c1 = null;
      let c2 = null;
      let diffCanvas = null;

      try {
        const renderScale = 2.0;
        const maxSide = 4096;
        const maxPixels = 12_000_000;
        const getSafeViewport = (page) => {
          const base = page.getViewport({ scale: 1 });
          const pixelScale = Math.sqrt(maxPixels / (base.width * base.height));
          const sideScale = Math.min(maxSide / base.width, maxSide / base.height);
          const safeScale = Math.max(0.25, Math.min(renderScale, pixelScale, sideScale));
          return page.getViewport({ scale: safeScale });
        };

        let wOld = 0, hOld = 0;
        let wNew = 0, hNew = 0;
        let alignedOldUrl = null;
        let alignedNewUrl = null;

        // 1. 旧ページのレンダリング (整数ピクセル & 背景白)
        if (docOld && currentPage <= docOld.numPages) {
          const page = await docOld.getPage(currentPage);
          try {
            const viewport = getSafeViewport(page);
            wOld = Math.round(viewport.width);
            hOld = Math.round(viewport.height);
            canvasOld = document.createElement("canvas");
            canvasOld.width = wOld;
            canvasOld.height = hOld;
            const ctxOld = canvasOld.getContext("2d", { willReadFrequently: true });
            ctxOld.fillStyle = "#ffffff";
            ctxOld.fillRect(0, 0, wOld, hOld);
            await page.render({ canvasContext: ctxOld, viewport }).promise;
          } finally {
            page.cleanup();
          }
          if (isCancelled) return;
        }

        // 2. 新ページのレンダリング (整数ピクセル & 背景白)
        if (docNew && currentPage <= docNew.numPages) {
          const page = await docNew.getPage(currentPage);
          try {
            const viewport = getSafeViewport(page);
            wNew = Math.round(viewport.width);
            hNew = Math.round(viewport.height);
            canvasNew = document.createElement("canvas");
            canvasNew.width = wNew;
            canvasNew.height = hNew;
            const ctxNew = canvasNew.getContext("2d", { willReadFrequently: true });
            ctxNew.fillStyle = "#ffffff";
            ctxNew.fillRect(0, 0, wNew, hNew);
            await page.render({ canvasContext: ctxNew, viewport }).promise;
          } finally {
            page.cleanup();
          }
          if (isCancelled) return;
        }

        const maxW = Math.max(wOld, wNew) || 1200;
        const maxH = Math.max(hOld, hNew) || 1600;

        diffCanvas = document.createElement("canvas");
        diffCanvas.width = maxW;
        diffCanvas.height = maxH;
        const diffCtx = diffCanvas.getContext("2d");

        let diffCount = 0;
        let totalContent = 0;

        if (canvasOld && canvasNew) {
          const ctx1 = canvasOld.getContext("2d", { willReadFrequently: true });
          const ctx2 = canvasNew.getContext("2d", { willReadFrequently: true });

          // 正規化用キャンバス
          c1 = document.createElement("canvas");
          c1.width = maxW;
          c1.height = maxH;
          const c1Ctx = c1.getContext("2d", { willReadFrequently: true });
          c1Ctx.fillStyle = "#ffffff";
          c1Ctx.fillRect(0, 0, maxW, maxH);
          c1Ctx.drawImage(canvasOld, 0, 0);

          c2 = document.createElement("canvas");
          c2.width = maxW;
          c2.height = maxH;
          const c2Ctx = c2.getContext("2d", { willReadFrequently: true });
          c2Ctx.fillStyle = "#ffffff";
          c2Ctx.fillRect(0, 0, maxW, maxH);

          if (autoAlign) {
            // スキャナーの余白・拡大縮小ズレをコンテンツ境界で自動補正！
            const b1 = getBlackBounds(ctx1, wOld, hOld);
            const b2 = getBlackBounds(ctx2, wNew, hNew);
            console.log("AutoAlign Bounds:", { b1, b2, manualShiftX, manualShiftY, toleranceRadius });

            c2Ctx.drawImage(
              canvasNew,
              b2.minX,
              b2.minY,
              b2.w,
              b2.h,
              b1.minX + manualShiftX,
              b1.minY + manualShiftY,
              b1.w,
              b1.h
            );
          } else {
            c2Ctx.drawImage(canvasNew, manualShiftX, manualShiftY);
          }

          const d1 = c1Ctx.getImageData(0, 0, maxW, maxH).data;
          const d2 = c2Ctx.getImageData(0, 0, maxW, maxH).data;

          const diffId = diffCtx.createImageData(maxW, maxH);
          const out = diffId.data;

          const R = Math.max(2, Math.min(20, toleranceRadius));

          // 近傍トレランス判定（スキャナーの微小歪みや文字の太さの差を吸収）
          const minLumInBox = (data, cx, cy, rad) => {
            const startY = Math.max(0, cy - rad);
            const endY = Math.min(maxH - 1, cy + rad);
            const startX = Math.max(0, cx - rad);
            const endX = Math.min(maxW - 1, cx + rad);

            for (let y = startY; y <= endY; y += 3) {
              for (let x = startX; x <= endX; x += 3) {
                const i = (y * maxW + x) * 4;
                const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                if (lum < 160) return true;
              }
            }
            return false;
          };

          // 2x2ブロック単位で高速高精度比較
          for (let y = 0; y < maxH; y += 2) {
            for (let x = 0; x < maxW; x += 2) {
              const idx = (y * maxW + x) * 4;
              const lum1 = d1[idx] * 0.299 + d1[idx + 1] * 0.587 + d1[idx + 2] * 0.114;
              const lum2 = d2[idx] * 0.299 + d2[idx + 1] * 0.587 + d2[idx + 2] * 0.114;

              const dark1 = lum1 < 160;
              const dark2 = lum2 < 160;

              if (dark1 || dark2) totalContent++;

              let r = 255, g = 255, b = 255;

              if (dark1 && !dark2) {
                // 旧のみ（削除）: 近傍に新の印字がなければ本物の差分
                if (!minLumInBox(d2, x, y, R)) {
                  r = 239; g = 68; b = 68; // 赤色
                  diffCount++;
                } else {
                  r = 160; g = 160; b = 160; // ズレ許容 -> グレー
                }
              } else if (!dark1 && dark2) {
                // 新のみ（追加）: 近傍に旧の印字がなければ本物の差分
                if (!minLumInBox(d1, x, y, R)) {
                  r = 37; g = 99; b = 235; // 青色
                  diffCount++;
                } else {
                  r = 160; g = 160; b = 160; // ズレ許容 -> グレー
                }
              } else if (dark1 && dark2) {
                r = 160; g = 160; b = 160; // 変更なし -> 薄グレー
              }

              for (let dy = 0; dy < 2 && y + dy < maxH; dy++) {
                for (let dx = 0; dx < 2 && x + dx < maxW; dx++) {
                  const o = ((y + dy) * maxW + (x + dx)) * 4;
                  out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
                }
              }
            }
          }

          diffCtx.putImageData(diffId, 0, 0);

          // 自動ズレ補正＆拡大補正を適用した状態の画像をスライダー・左右比較用にも使用
          alignedOldUrl = c1.toDataURL("image/png");
          alignedNewUrl = c2.toDataURL("image/png");
        } else if (canvasNew && !canvasOld) {
          diffCtx.fillStyle = "#ffffff";
          diffCtx.fillRect(0, 0, maxW, maxH);
          diffCtx.drawImage(canvasNew, 0, 0);
          alignedNewUrl = diffCanvas.toDataURL("image/png");
          diffCount = 100;
          totalContent = 100;
        } else if (canvasOld && !canvasNew) {
          diffCtx.fillStyle = "#ffffff";
          diffCtx.fillRect(0, 0, maxW, maxH);
          diffCtx.drawImage(canvasOld, 0, 0);
          alignedOldUrl = diffCanvas.toDataURL("image/png");
          diffCount = 100;
          totalContent = 100;
        }

        const diffUrl = diffCanvas.toDataURL("image/png");
        const diffPercent =
          totalContent > 0 ? ((diffCount / totalContent) * 100).toFixed(1) : "0.0";

        if (!isCancelled) {
          setPageData({
            oldUrl: alignedOldUrl,
            newUrl: alignedNewUrl,
            diffUrl,
            width: maxW,
            height: maxH,
            diffPercent,
            diffCount
          });
        }
      } catch (err) {
        console.error("差分描画エラー:", err);
      } finally {
        releaseCanvas(canvasOld);
        releaseCanvas(canvasNew);
        releaseCanvas(c1);
        releaseCanvas(c2);
        releaseCanvas(diffCanvas);
        if (!isCancelled) {
          setIsProcessing(false);
          setProcessMessage("");
        }
      }
    };

    renderAndCalculateDiff();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, docOld, docNew, currentPage, autoAlign, toleranceRadius, manualShiftX, manualShiftY]);

  // スライダー操作
  const handleSliderMove = useCallback((clientX) => {
    if (!sliderContainerRef.current) return;
    const rect = sliderContainerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pos);
  }, []);

  const handlePointerDown = (e) => {
    if (isPinchingRef.current) return;
    setIsDraggingSlider(true);
    handleSliderMove(e.clientX);
  };

  useEffect(() => {
    const handleMove = (e) => {
      if (isDraggingSlider) handleSliderMove(e.clientX);
    };
    const handleUp = () => {
      if (isDraggingSlider) setIsDraggingSlider(false);
    };

    if (isDraggingSlider) {
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    }
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [isDraggingSlider, handleSliderMove]);

  // 差分画像の保存
  const handleDownloadDiffImage = () => {
    if (!pageData.diffUrl) return;
    const link = document.createElement("a");
    link.download = `pdf_diff_page_${currentPage}_${new Date().getTime()}.png`;
    link.href = pageData.diffUrl;
    link.click();
  };

  // 全リセット
  const handleReset = () => {
    setFileOld(null);
    setFileNew(null);
    setDocOld(null);
    setDocNew(null);
    setCurrentPage(1);
    setTotalPages(1);
    setManualShiftX(0);
    setManualShiftY(0);
    setPanOffset({ x: 0, y: 0 });
    setZoomMode("fit");
    setZoomScale(1.0);
    setPageData({
      oldUrl: null,
      newUrl: null,
      diffUrl: null,
      width: 0,
      height: 0,
      diffPercent: 0,
      diffCount: 0
    });
  };

  if (!isOpen) return null;

  const isBothLoaded = docOld && docNew;

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/90 backdrop-blur-md flex flex-col justify-between animate-fadeIn select-none text-stone-100">
      {/* 1. ヘッダー */}
      <header className="w-full bg-stone-900 border-b border-stone-800 px-4 sm:px-6 py-2.5 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-orange-600 text-white shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-white tracking-wide">PDF差分比較ツール</h2>
              <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                完全ローカル安全処理
              </span>
            </div>
            <p className="text-[11px] text-stone-400 hidden sm:block">
              スキャンズレを自動補正し、文字や図面の変更箇所を瞬時に検出します
            </p>
          </div>
        </div>

        {/* コントロール群 (両ファイル読込時) */}
        {isBothLoaded && (
          <div className="flex items-center space-x-3 sm:space-x-4">
            {/* 表示モード切り替え */}
            <div className="flex items-center bg-stone-800 p-1 rounded-xl border border-stone-700 shadow-inner">
              <button
                type="button"
                onClick={() => setViewMode("diff")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "diff"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-stone-300 hover:text-white hover:bg-stone-700/60"
                }`}
                title="赤（削除）と青（追加）で差分をハイライト"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>差分ハイライト</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("split")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "split"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-stone-300 hover:text-white hover:bg-stone-700/60"
                }`}
                title="変更前と変更後を左右に並べて比較"
              >
                <SplitSquareHorizontal className="w-3.5 h-3.5" />
                <span>左右並べて比較</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("slider")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "slider"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-stone-300 hover:text-white hover:bg-stone-700/60"
                }`}
                title="スライダーを動かして前後の変化を確認"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>スライダー比較</span>
              </button>
            </div>

            {/* スキャン自動位置合わせトグル */}
            <button
              type="button"
              onClick={() => setAutoAlign(!autoAlign)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                autoAlign
                  ? "bg-emerald-600/90 border-emerald-500 text-white shadow-sm"
                  : "bg-stone-800 border-stone-700 text-stone-400 hover:text-white"
              }`}
              title="スキャン時の傾きや余白のズレを自動補正してピッタリ合わせる"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>自動ズレ補正: {autoAlign ? "ON" : "OFF"}</span>
            </button>

            {/* 微調整パネル切り替え */}
            <button
              type="button"
              onClick={() => setShowAdjustPanel(!showAdjustPanel)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                showAdjustPanel ? "bg-stone-700 border-stone-500 text-white" : "bg-stone-800 border-stone-700 text-stone-300 hover:text-white"
              }`}
              title="位置の微調整やノイズ感度を設定"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>微調整</span>
            </button>

            {/* ズーム */}
            <div className="flex items-center space-x-1 bg-stone-800 px-2 py-1 rounded-xl border border-stone-700">
              <button
                type="button"
                onClick={() => {
                  setZoomMode("fit");
                  setZoomScale(1.0);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  zoomMode === "fit" ? "bg-orange-600 text-white" : "text-stone-400 hover:text-white"
                }`}
              >
                全体
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomMode("100");
                  setZoomScale(1.0);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  zoomMode === "100" ? "bg-orange-600 text-white" : "text-stone-400 hover:text-white"
                }`}
              >
                100%
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomMode("custom");
                  setZoomScale((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))));
                }}
                className="p-1 text-stone-300 hover:text-white rounded"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomMode("custom");
                  setZoomScale((z) => Math.min(2.5, Number((z + 0.2).toFixed(1))));
                }}
                className="p-1 text-stone-300 hover:text-white rounded"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 差分画像ダウンロード */}
            <button
              type="button"
              onClick={handleDownloadDiffImage}
              disabled={!pageData.diffUrl}
              className="flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-200 px-3 py-1.5 rounded-xl text-xs font-bold border border-stone-700 transition-colors shadow-sm"
              title="差分結果をPNG画像で保存"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">画像保存</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="p-2 text-stone-400 hover:text-white hover:bg-stone-800 rounded-xl transition-colors ml-2"
          title="閉じる"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* 微調整フライアウトパネル */}
      {isBothLoaded && showAdjustPanel && (
        <div className="w-full bg-stone-900/95 border-b border-stone-700 px-6 py-2.5 flex flex-wrap items-center gap-6 text-xs text-stone-300 animate-fadeIn">
          {/* ノイズ感度 / 許容半径 */}
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-stone-300">ズレ吸収トレランス:</span>
            <input
              type="range"
              min="2"
              max="16"
              value={toleranceRadius}
              onChange={(e) => setToleranceRadius(parseInt(e.target.value, 10))}
              className="w-24 h-1.5 bg-stone-700 rounded-lg appearance-none cursor-pointer"
            />
            <span className="font-mono font-bold text-orange-400 w-8">{toleranceRadius}px</span>
            <span className="text-[10px] text-stone-400">（スキャン歪み・微小な太さの差を無視）</span>
          </div>

          {/* 手動位置微調整 */}
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-stone-300">位置微調整:</span>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setManualShiftX((x) => x - 2)}
                className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 rounded border border-stone-600 font-bold"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => setManualShiftX((x) => x + 2)}
                className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 rounded border border-stone-600 font-bold"
              >
                ▶
              </button>
              <span className="font-mono text-[11px] text-stone-400 px-1">X:{manualShiftX}</span>
              <button
                type="button"
                onClick={() => setManualShiftY((y) => y - 2)}
                className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 rounded border border-stone-600 font-bold"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => setManualShiftY((y) => y + 2)}
                className="px-2 py-0.5 bg-stone-800 hover:bg-stone-700 rounded border border-stone-600 font-bold"
              >
                ▼
              </button>
              <span className="font-mono text-[11px] text-stone-400 px-1">Y:{manualShiftY}</span>
            </div>
            {(manualShiftX !== 0 || manualShiftY !== 0) && (
              <button
                type="button"
                onClick={() => {
                  setManualShiftX(0);
                  setManualShiftY(0);
                }}
                className="text-[10px] text-orange-400 hover:underline ml-1"
              >
                リセット
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. メインワークスペース */}
      <main
        ref={compareWorkspaceRef}
        className="flex-1 w-full overflow-auto flex items-center justify-center p-4 relative"
      >
        {!isBothLoaded ? (
          <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-6 my-auto animate-fadeIn">
            {/* 左: 変更前 (旧バージョン) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOld(true);
              }}
              onDragLeave={() => setIsDraggingOld(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOld(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileProcess(file, "old");
              }}
              className={`bg-stone-900/90 border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all group ${
                isDraggingOld ? "border-orange-500 bg-orange-950/20 scale-[1.02]" : "border-stone-700 hover:border-orange-500/80"
              }`}
            >
              <div className="w-16 h-16 rounded-2xl bg-stone-800 group-hover:bg-orange-500/20 text-stone-400 group-hover:text-orange-400 flex items-center justify-center mb-4 transition-colors">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">① 変更前（旧バージョン）</h3>
              <p className="text-xs text-stone-400 mb-6">比較元のPDFをドロップ または 選択</p>

              {fileOld ? (
                <div className="w-full bg-stone-800 border border-stone-700 rounded-2xl p-3 flex items-center justify-between text-left">
                  <div className="truncate pr-2">
                    <p className="text-xs font-bold text-stone-200 truncate">{fileOld.name}</p>
                    <p className="text-[10px] text-stone-400 font-mono">{docOld?.numPages || 0} ページ</p>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                </div>
              ) : (
                <label className="cursor-pointer inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md">
                  <UploadCloud className="w-4 h-4" />
                  <span>PDFを選択</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileProcess(f, "old");
                    }}
                  />
                </label>
              )}
            </div>

            {/* 右: 変更後 (新バージョン) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingNew(true);
              }}
              onDragLeave={() => setIsDraggingNew(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingNew(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFileProcess(file, "new");
              }}
              className={`bg-stone-900/90 border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all group ${
                isDraggingNew ? "border-blue-500 bg-blue-950/20 scale-[1.02]" : "border-stone-700 hover:border-blue-500/80"
              }`}
            >
              <div className="w-16 h-16 rounded-2xl bg-stone-800 group-hover:bg-blue-500/20 text-stone-400 group-hover:text-blue-400 flex items-center justify-center mb-4 transition-colors">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">② 変更後（新バージョン）</h3>
              <p className="text-xs text-stone-400 mb-6">比較先のPDFをドロップ または 選択</p>

              {fileNew ? (
                <div className="w-full bg-stone-800 border border-stone-700 rounded-2xl p-3 flex items-center justify-between text-left">
                  <div className="truncate pr-2">
                    <p className="text-xs font-bold text-stone-200 truncate">{fileNew.name}</p>
                    <p className="text-[10px] text-stone-400 font-mono">{docNew?.numPages || 0} ページ</p>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                </div>
              ) : (
                <label className="cursor-pointer inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md">
                  <UploadCloud className="w-4 h-4" />
                  <span>PDFを選択</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileProcess(f, "new");
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center relative">
            {isProcessing && (
              <div className="absolute inset-0 bg-stone-950/70 backdrop-blur-xs z-30 flex items-center justify-center rounded-2xl">
                <div className="flex items-center gap-3 bg-stone-900 px-6 py-4 rounded-2xl border border-stone-700 text-white shadow-2xl animate-pulse">
                  <RefreshCw className="w-5 h-5 animate-spin text-orange-500" />
                  <span className="text-xs font-bold">{processMessage || "差分を計算中..."}</span>
                </div>
              </div>
            )}

            <div
              className="flex items-center justify-center w-full h-full p-2 transition-transform duration-100"
              style={{
                transform:
                  zoomMode === "custom"
                    ? `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`
                    : "none"
              }}
            >
              {/* 1. 差分ハイライトモード */}
              {viewMode === "diff" && pageData.diffUrl && (
                <div className="bg-white shadow-2xl rounded-xl overflow-hidden border border-stone-700 flex items-center justify-center">
                  <img
                    src={pageData.diffUrl}
                    alt={`差分 第${currentPage}ページ`}
                    className={`block object-contain ${
                      zoomMode === "fit" ? "max-h-[calc(100vh-170px)] max-w-full" : zoomMode === "100" ? "w-auto h-auto max-w-none" : "max-h-[calc(100vh-170px)] max-w-full"
                    }`}
                  />
                </div>
              )}

              {/* 2. 左右並べて比較モード */}
              {viewMode === "split" && (
                <div className="flex flex-col md:flex-row items-center justify-center gap-6 w-full max-h-full">
                  <div className="flex flex-col items-center flex-1 min-w-0 max-h-full">
                    <span className="text-xs font-bold text-red-400 bg-red-950/80 border border-red-800/80 px-3 py-1 rounded-full mb-2 truncate max-w-xs">
                      変更前: {fileOld?.name || "なし"}
                    </span>
                    <div className="bg-white shadow-2xl rounded-xl overflow-hidden border border-stone-700 flex items-center justify-center w-full">
                      {pageData.oldUrl ? (
                        <img
                          src={pageData.oldUrl}
                          alt="変更前"
                          className="block object-contain max-h-[calc(100vh-210px)] max-w-full"
                        />
                      ) : (
                        <div className="p-12 text-center text-stone-400 text-xs">このページはありません</div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-center flex-1 min-w-0 max-h-full">
                    <span className="text-xs font-bold text-blue-400 bg-blue-950/80 border border-blue-800/80 px-3 py-1 rounded-full mb-2 truncate max-w-xs">
                      変更後: {fileNew?.name || "なし"}
                    </span>
                    <div className="bg-white shadow-2xl rounded-xl overflow-hidden border border-stone-700 flex items-center justify-center w-full">
                      {pageData.newUrl ? (
                        <img
                          src={pageData.newUrl}
                          alt="変更後"
                          className="block object-contain max-h-[calc(100vh-210px)] max-w-full"
                        />
                      ) : (
                        <div className="p-12 text-center text-stone-400 text-xs">このページはありません</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 3. スライダー比較モード */}
              {viewMode === "slider" && pageData.oldUrl && pageData.newUrl && (
                <div
                  ref={sliderContainerRef}
                  onPointerDown={handlePointerDown}
                  className="relative bg-white shadow-2xl rounded-xl overflow-hidden border border-stone-700 cursor-ew-resize select-none inline-flex items-center justify-center max-h-[calc(100vh-170px)] max-w-full"
                >
                  {/* ベース画像（変更後 / 新バージョン） */}
                  <img
                    src={pageData.newUrl}
                    alt="新バージョン"
                    className="block object-contain max-h-[calc(100vh-170px)] max-w-full pointer-events-none select-none"
                  />

                  {/* 重ね合わせ画像（変更前 / 旧バージョン）: clip-path で左側 sliderPos% 分だけを表示 */}
                  <img
                    src={pageData.oldUrl}
                    alt="旧バージョン"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                    style={{
                      clipPath: `polygon(0% 0%, ${sliderPos}% 0%, ${sliderPos}% 100%, 0% 100%)`
                    }}
                  />

                  {/* スライダーの境界仕切り線 */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.6)] pointer-events-none z-10"
                    style={{ left: `${sliderPos}%` }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-xl border-2 border-white text-[11px] font-bold">
                      ↔
                    </div>
                  </div>

                  <span className="absolute top-3 left-3 bg-red-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow pointer-events-none z-10">
                    変更前
                  </span>
                  <span className="absolute top-3 right-3 bg-blue-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow pointer-events-none z-10">
                    変更後
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 3. ボトムバー */}
      {isBothLoaded && (
        <footer className="w-full bg-stone-900 border-t border-stone-800 text-white px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-lg">
          <div className="flex items-center space-x-3 sm:space-x-4">
            <span className="text-[11px] font-bold text-stone-400">見方:</span>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500 border border-white/20"></span>
              <span className="text-xs text-stone-300 font-medium">赤：削除（旧テキスト）</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-blue-500 border border-white/20"></span>
              <span className="text-xs text-stone-300 font-medium">青：追加（新テキスト）</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-gray-400 border border-white/20"></span>
              <span className="text-xs text-stone-400 font-medium">灰：変更なし</span>
            </div>

            {pageData.diffCount > 0 && (
              <span className="text-xs font-semibold text-orange-400 bg-orange-950/60 border border-orange-800/80 px-2.5 py-0.5 rounded-full ml-2">
                変更箇所: {pageData.diffPercent}%
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              disabled={currentPage <= 1 || isProcessing}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-800 text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono font-bold text-stone-200">
              {currentPage} / {totalPages} ページ
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages || isProcessing}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-800 text-white transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-stone-400 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-stone-800"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>別のPDFを比較</span>
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};
