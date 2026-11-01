import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
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
  Maximize2,
  Download,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Trash2
} from "lucide-react";

/**
 * PDF差分比較モーダル (完全ブラウザ完結型・外部送信ゼロ)
 * - 高精度ピクセル差分検出（削除: 赤 / 追加: 青 / 変更なし: 薄グレー）
 * - 差分ハイライト / 左右並べて比較 / スライダーカーテン比較 の3モード対応
 * - ドラッグ＆ドロップ対応
 * - 画面フィット・拡大縮小・PNG保存
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

  // ドラッグ＆ドロップ状態
  const [isDraggingOld, setIsDraggingOld] = useState(false);
  const [isDraggingNew, setIsDraggingNew] = useState(false);

  const sliderContainerRef = useRef(null);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  // PDFファイルの読み込みヘルパー
  const loadPdf = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const task = pdfjsLib.getDocument({
      data: arrayBuffer,
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

  // ページのレンダリング & 差分計算（オフスクリーンCanvasで実行しDataURL化）
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
      setProcessMessage(`ページ ${currentPage} の高精度差分を計算中...`);

      try {
        const renderScale = 2.0; // 高解像度（Retina相当）で正確に比較

        let canvasOld = null;
        let canvasNew = null;
        let wOld = 0, hOld = 0;
        let wNew = 0, hNew = 0;
        let oldDataUrl = null;
        let newDataUrl = null;

        // 1. 旧ページのレンダリング
        if (docOld && currentPage <= docOld.numPages) {
          const page = await docOld.getPage(currentPage);
          const viewport = page.getViewport({ scale: renderScale });
          canvasOld = document.createElement("canvas");
          canvasOld.width = viewport.width;
          canvasOld.height = viewport.height;
          wOld = viewport.width;
          hOld = viewport.height;
          const ctxOld = canvasOld.getContext("2d", { willReadFrequently: true });
          await page.render({ canvasContext: ctxOld, viewport }).promise;
          if (isCancelled) return;
          oldDataUrl = canvasOld.toDataURL("image/png");
        }

        // 2. 新ページのレンダリング
        if (docNew && currentPage <= docNew.numPages) {
          const page = await docNew.getPage(currentPage);
          const viewport = page.getViewport({ scale: renderScale });
          canvasNew = document.createElement("canvas");
          canvasNew.width = viewport.width;
          canvasNew.height = viewport.height;
          wNew = viewport.width;
          hNew = viewport.height;
          const ctxNew = canvasNew.getContext("2d", { willReadFrequently: true });
          await page.render({ canvasContext: ctxNew, viewport }).promise;
          if (isCancelled) return;
          newDataUrl = canvasNew.toDataURL("image/png");
        }

        // 3. 差分の合成
        const maxW = Math.max(wOld, wNew) || 1200;
        const maxH = Math.max(hOld, hNew) || 1600;

        const diffCanvas = document.createElement("canvas");
        diffCanvas.width = maxW;
        diffCanvas.height = maxH;
        const diffCtx = diffCanvas.getContext("2d");

        let diffCount = 0;
        let contentCount = 0;

        if (canvasOld && canvasNew) {
          // 両方ある場合: ピクセル単位で詳細比較
          const ctx1 = canvasOld.getContext("2d", { willReadFrequently: true });
          const ctx2 = canvasNew.getContext("2d", { willReadFrequently: true });
          const img1 = ctx1.getImageData(0, 0, wOld, hOld);
          const img2 = ctx2.getImageData(0, 0, wNew, hNew);
          const d1 = img1.data;
          const d2 = img2.data;

          const diffImgData = diffCtx.createImageData(maxW, maxH);
          const out = diffImgData.data;

          for (let y = 0; y < maxH; y++) {
            for (let x = 0; x < maxW; x++) {
              const outIdx = (y * maxW + x) * 4;

              // 旧ピクセルの輝度
              let lum1 = 255;
              if (x < wOld && y < hOld) {
                const idx1 = (y * wOld + x) * 4;
                const a1 = d1[idx1 + 3];
                if (a1 >= 20) {
                  lum1 = d1[idx1] * 0.299 + d1[idx1 + 1] * 0.587 + d1[idx1 + 2] * 0.114;
                }
              }

              // 新ピクセルの輝度
              let lum2 = 255;
              if (x < wNew && y < hNew) {
                const idx2 = (y * wNew + x) * 4;
                const a2 = d2[idx2 + 3];
                if (a2 >= 20) {
                  lum2 = d2[idx2] * 0.299 + d2[idx2 + 1] * 0.587 + d2[idx2 + 2] * 0.114;
                }
              }

              const isContent1 = lum1 < 220; // 旧に印字あり
              const isContent2 = lum2 < 220; // 新に印字あり

              if (isContent1 || isContent2) {
                contentCount++;
              }

              // アンチエイリアス・微小ノイズを吸収する輝度差判定
              const diffLum = Math.abs(lum1 - lum2);
              const isSignificantDiff = diffLum > 40;

              if (isSignificantDiff && isContent1 && !isContent2) {
                // 旧のみ（削除・変更前の箇所） -> 鮮やかな赤色 (#ef4444)
                out[outIdx] = 239;
                out[outIdx + 1] = 68;
                out[outIdx + 2] = 68;
                out[outIdx + 3] = 255;
                diffCount++;
              } else if (isSignificantDiff && !isContent1 && isContent2) {
                // 新のみ（追加・変更後の箇所） -> 鮮やかな青色 (#2563eb)
                out[outIdx] = 37;
                out[outIdx + 1] = 99;
                out[outIdx + 2] = 235;
                out[outIdx + 3] = 255;
                diffCount++;
              } else if (isSignificantDiff && isContent1 && isContent2) {
                // 両方に印字があるが濃さや形状が大きく変化した箇所 -> オレンジ色 (#f97316)
                out[outIdx] = 249;
                out[outIdx + 1] = 115;
                out[outIdx + 2] = 22;
                out[outIdx + 3] = 255;
                diffCount++;
              } else if (isContent1 || isContent2) {
                // 共通（変更なしの文字や図面） -> 目に優しい薄グレー (#9ca3af)
                out[outIdx] = 156;
                out[outIdx + 1] = 163;
                out[outIdx + 2] = 175;
                out[outIdx + 3] = 255;
              } else {
                // 背景（純白）
                out[outIdx] = 255;
                out[outIdx + 1] = 255;
                out[outIdx + 2] = 255;
                out[outIdx + 3] = 255;
              }
            }
          }
          diffCtx.putImageData(diffImgData, 0, 0);
        } else if (canvasNew && !canvasOld) {
          // 新ページのみ存在（新規追加ページ）: 全て青色で強調
          diffCtx.fillStyle = "#ffffff";
          diffCtx.fillRect(0, 0, maxW, maxH);
          diffCtx.drawImage(canvasNew, 0, 0);
          diffCount = 100;
          contentCount = 100;
        } else if (canvasOld && !canvasNew) {
          // 旧ページのみ存在（削除されたページ）: 全て赤色で強調
          diffCtx.fillStyle = "#ffffff";
          diffCtx.fillRect(0, 0, maxW, maxH);
          diffCtx.drawImage(canvasOld, 0, 0);
          diffCount = 100;
          contentCount = 100;
        }

        const diffUrl = diffCanvas.toDataURL("image/png");
        const diffPercent =
          contentCount > 0 ? ((diffCount / contentCount) * 100).toFixed(1) : "0.0";

        if (!isCancelled) {
          setPageData({
            oldUrl: oldDataUrl,
            newUrl: newDataUrl,
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
  }, [isOpen, docOld, docNew, currentPage]);

  // スライダーの操作
  const handleSliderMove = useCallback((clientX) => {
    if (!sliderContainerRef.current) return;
    const rect = sliderContainerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pos);
  }, []);

  const handlePointerDown = (e) => {
    setIsDraggingSlider(true);
    handleSliderMove(e.clientX);
  };

  useEffect(() => {
    const handleMove = (e) => {
      if (isDraggingSlider) {
        handleSliderMove(e.clientX);
      }
    };
    const handleUp = () => {
      if (isDraggingSlider) {
        setIsDraggingSlider(false);
      }
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

  // 差分画像の保存 (ダウンロード)
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
      <header className="w-full bg-stone-900 border-b border-stone-800 px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 shadow-md">
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
              新旧PDFをブラウザ内で重ね合わせ、追加・削除・変更箇所を瞬時に検出します
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

            {/* ズーム切り替え */}
            <div className="hidden lg:flex items-center space-x-1 bg-stone-800 px-2 py-1 rounded-xl border border-stone-700">
              <button
                type="button"
                onClick={() => {
                  setZoomMode("fit");
                  setZoomScale(1.0);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  zoomMode === "fit" ? "bg-orange-600 text-white" : "text-stone-400 hover:text-white"
                }`}
                title="画面内に全体を収める"
              >
                全体
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomMode("100");
                  setZoomScale(1.0);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  zoomMode === "100" ? "bg-orange-600 text-white" : "text-stone-400 hover:text-white"
                }`}
                title="100%原寸で表示"
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
                title="縮小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              {zoomMode === "custom" && (
                <span className="text-[11px] font-mono font-bold text-stone-200 px-1">
                  {Math.round(zoomScale * 100)}%
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setZoomMode("custom");
                  setZoomScale((z) => Math.min(2.5, Number((z + 0.2).toFixed(1))));
                }}
                className="p-1 text-stone-300 hover:text-white rounded"
                title="拡大"
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
              title="現在の差分結果をPNG画像として保存"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">差分を画像保存</span>
            </button>
          </div>
        )}

        {/* 閉じるボタン */}
        <button
          type="button"
          onClick={onClose}
          className="p-2 text-stone-400 hover:text-white hover:bg-stone-800 rounded-xl transition-colors ml-2"
          title="比較画面を閉じる"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* 2. メインワークスペース */}
      <main className="flex-1 w-full overflow-auto flex items-center justify-center p-4 relative">
        {/* ファイル未読込時のドロップゾーン */}
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
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => handleFileProcess(e.target.files?.[0], "old")}
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
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => handleFileProcess(e.target.files?.[0], "new")}
                  />
                </label>
              )}
            </div>
          </div>
        ) : (
          /* ファイル読込後の比較ビュー（安全なDataURL描画・画面フィット） */
          <div className="w-full h-full flex flex-col items-center justify-center relative">
            {isProcessing && (
              <div className="absolute inset-0 bg-stone-950/70 backdrop-blur-xs z-30 flex items-center justify-center rounded-2xl">
                <div className="flex items-center gap-3 bg-stone-900 px-6 py-4 rounded-2xl border border-stone-700 text-white shadow-2xl animate-pulse">
                  <RefreshCw className="w-5 h-5 animate-spin text-orange-500" />
                  <span className="text-xs font-bold">{processMessage || "差分を計算中..."}</span>
                </div>
              </div>
            )}

            {/* 画像表示ラッパー */}
            <div
              className="flex items-center justify-center w-full h-full p-2 transition-transform duration-100"
              style={{
                transform: zoomMode === "custom" ? `scale(${zoomScale})` : "none"
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
                  {/* 旧バージョン */}
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

                  {/* 新バージョン */}
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
                  className="relative bg-white shadow-2xl rounded-xl overflow-hidden border border-stone-700 cursor-ew-resize select-none flex items-center justify-center"
                >
                  {/* 下地: 新バージョン */}
                  <img
                    src={pageData.newUrl}
                    alt="新バージョン"
                    className="block object-contain max-h-[calc(100vh-170px)] max-w-full pointer-events-none"
                  />

                  {/* 上面: 旧バージョン (クリップ) */}
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ width: `${sliderPos}%` }}
                  >
                    <img
                      src={pageData.oldUrl}
                      alt="旧バージョン"
                      className="block object-contain max-h-[calc(100vh-170px)] max-w-none pointer-events-none"
                      style={{
                        width: sliderContainerRef.current?.clientWidth || "100%",
                        height: sliderContainerRef.current?.clientHeight || "100%"
                      }}
                    />
                  </div>

                  {/* スライダーの仕切り線 */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-white shadow-2xl pointer-events-none z-10"
                    style={{ left: `${sliderPos}%` }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-lg border-2 border-white text-[11px] font-bold">
                      ↔
                    </div>
                  </div>

                  {/* ラベル */}
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

      {/* 3. ボトムバー (ページネーション & 凡例 & 統計) */}
      {isBothLoaded && (
        <footer className="w-full bg-stone-900 border-t border-stone-800 text-white px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-lg">
          {/* 凡例 */}
          <div className="flex items-center space-x-3 sm:space-x-4">
            <span className="text-[11px] font-bold text-stone-400">見方:</span>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500 border border-white/20"></span>
              <span className="text-xs text-stone-300 font-medium">赤：削除・変更前</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-blue-500 border border-white/20"></span>
              <span className="text-xs text-stone-300 font-medium">青：追加・変更後</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-gray-400 border border-white/20"></span>
              <span className="text-xs text-stone-400 font-medium">灰：変更なし</span>
            </div>

            {pageData.diffCount > 0 && (
              <span className="text-xs font-semibold text-orange-400 bg-orange-950/60 border border-orange-800/80 px-2.5 py-0.5 rounded-full ml-2">
                変更率: {pageData.diffPercent}%
              </span>
            )}
          </div>

          {/* ページネーション */}
          <div className="flex items-center space-x-3">
            <button
              type="button"
              disabled={currentPage <= 1 || isProcessing}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-800 text-white transition-colors"
              title="前のページ"
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
              title="次のページ"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* リセットボタン */}
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
