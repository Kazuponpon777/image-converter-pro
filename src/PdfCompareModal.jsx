import React, { useState, useEffect, useRef } from "react";
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
  Download,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Sparkles
} from "lucide-react";

/**
 * PDF差分比較モーダル (完全ブラウザ完結型・外部送信ゼロ)
 */
export const PdfCompareModal = ({ isOpen, onClose, pdfjsOptions }) => {
  const [fileOld, setFileOld] = useState(null);
  const [fileNew, setFileNew] = useState(null);
  const [docOld, setDocOld] = useState(null);
  const [docNew, setDocNew] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [viewMode, setViewMode] = useState("diff"); // "diff" | "split" | "slider"
  const [zoom, setZoom] = useState(1.0);
  const [sliderPos, setSliderPos] = useState(50); // 0% 〜 100%
  const [isProcessing, setIsProcessing] = useState(false);
  const [diffStats, setDiffStats] = useState({ diffCount: 0, percent: 0 });

  const canvasOldRef = useRef(null);
  const canvasNewRef = useRef(null);
  const canvasDiffRef = useRef(null);
  const sliderContainerRef = useRef(null);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  // ファイル読み込み処理
  const loadPdfDocument = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const task = pdfjsLib.getDocument({
      data: arrayBuffer,
      ...(pdfjsOptions || {})
    });
    return await task.promise;
  };

  const handleFileChange = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("PDFファイルを選択してください。");
      return;
    }

    setIsProcessing(true);
    try {
      const doc = await loadPdfDocument(file);
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
    }
  };

  // ドキュメント変更時に総ページ数を計算
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

  // ページレンダリング & 差分計算
  useEffect(() => {
    if (!isOpen || (!docOld && !docNew)) return;

    let isCancelled = false;

    const renderPagesAndDiff = async () => {
      setIsProcessing(true);
      try {
        const scale = 2.0; // 高解像度でレンダリングして比較精度を高める

        let imgDataOld = null;
        let imgDataNew = null;
        let wOld = 0, hOld = 0;
        let wNew = 0, hNew = 0;

        // 1. 旧ページ描画
        if (docOld && currentPage <= docOld.numPages) {
          const page = await docOld.getPage(currentPage);
          const viewport = page.getViewport({ scale });
          const canvas = canvasOldRef.current || document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          wOld = viewport.width;
          hOld = viewport.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (isCancelled) return;
          imgDataOld = ctx.getImageData(0, 0, wOld, hOld);
        }

        // 2. 新ページ描画
        if (docNew && currentPage <= docNew.numPages) {
          const page = await docNew.getPage(currentPage);
          const viewport = page.getViewport({ scale });
          const canvas = canvasNewRef.current || document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          wNew = viewport.width;
          hNew = viewport.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (isCancelled) return;
          imgDataNew = ctx.getImageData(0, 0, wNew, hNew);
        }

        // 3. 差分計算 (Diff)
        if (imgDataOld && imgDataNew && canvasDiffRef.current) {
          const maxW = Math.max(wOld, wNew);
          const maxH = Math.max(hOld, hNew);

          const diffCanvas = canvasDiffRef.current;
          diffCanvas.width = maxW;
          diffCanvas.height = maxH;
          const diffCtx = diffCanvas.getContext("2d");
          const diffImgData = diffCtx.createImageData(maxW, maxH);
          const out = diffImgData.data;

          const data1 = imgDataOld.data;
          const data2 = imgDataNew.data;

          let diffPixelCount = 0;
          let contentPixelCount = 0;

          // ピクセルごとの差分判定
          for (let y = 0; y < maxH; y++) {
            for (let x = 0; x < maxW; x++) {
              const outIdx = (y * maxW + x) * 4;

              // 旧画像の色
              let lum1 = 255;
              if (x < wOld && y < hOld) {
                const idx1 = (y * wOld + x) * 4;
                const a1 = data1[idx1 + 3];
                if (a1 >= 10) {
                  lum1 = data1[idx1] * 0.299 + data1[idx1 + 1] * 0.587 + data1[idx1 + 2] * 0.114;
                }
              }

              // 新画像の色
              let lum2 = 255;
              if (x < wNew && y < hNew) {
                const idx2 = (y * wNew + x) * 4;
                const a2 = data2[idx2 + 3];
                if (a2 >= 10) {
                  lum2 = data2[idx2] * 0.299 + data2[idx2 + 1] * 0.587 + data2[idx2 + 2] * 0.114;
                }
              }

              const isDark1 = lum1 < 215; // 旧に文字/線がある
              const isDark2 = lum2 < 215; // 新に文字/線がある

              if (isDark1 || isDark2) {
                contentPixelCount++;
              }

              if (isDark1 && !isDark2) {
                // 旧のみ (削除・変更前の部分) -> 赤色 (#ef4444)
                out[outIdx] = 239;
                out[outIdx + 1] = 68;
                out[outIdx + 2] = 68;
                out[outIdx + 3] = 255;
                diffPixelCount++;
              } else if (!isDark1 && isDark2) {
                // 新のみ (追加・変更後の部分) -> 鮮やかな青色 (#2563eb)
                out[outIdx] = 37;
                out[outIdx + 1] = 99;
                out[outIdx + 2] = 235;
                out[outIdx + 3] = 255;
                diffPixelCount++;
              } else if (isDark1 && isDark2) {
                // 共通 (変更なしの部分) -> 落ち着いた薄グレー (#9ca3af)
                out[outIdx] = 160;
                out[outIdx + 1] = 160;
                out[outIdx + 2] = 160;
                out[outIdx + 3] = 255;
              } else {
                // 背景 (白)
                out[outIdx] = 255;
                out[outIdx + 1] = 255;
                out[outIdx + 2] = 255;
                out[outIdx + 3] = 255;
              }
            }
          }

          diffCtx.putImageData(diffImgData, 0, 0);

          const percent = contentPixelCount > 0 ? ((diffPixelCount / contentPixelCount) * 100).toFixed(1) : 0;
          setDiffStats({ diffCount: diffPixelCount, percent });
        }
      } catch (err) {
        console.error("差分計算エラー:", err);
      } finally {
        if (!isCancelled) setIsProcessing(false);
      }
    };

    renderPagesAndDiff();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, docOld, docNew, currentPage]);

  // スライダードラッグハンドラ
  const handleSliderMove = (clientX) => {
    if (!sliderContainerRef.current) return;
    const rect = sliderContainerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pos = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pos);
  };

  const handlePointerDown = (e) => {
    setIsDraggingSlider(true);
    handleSliderMove(e.clientX);
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (isDraggingSlider) {
        handleSliderMove(e.clientX);
      }
    };
    const handlePointerUp = () => {
      if (isDraggingSlider) {
        setIsDraggingSlider(false);
      }
    };

    if (isDraggingSlider) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDraggingSlider]);

  // 差分画像の保存 (ダウンロード)
  const handleDownloadDiffImage = () => {
    if (!canvasDiffRef.current) return;
    const link = document.createElement("a");
    link.download = `pdf_diff_page_${currentPage}.png`;
    link.href = canvasDiffRef.current.toDataURL("image/png");
    link.click();
  };

  if (!isOpen) return null;

  const isBothLoaded = docOld && docNew;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-between animate-fadeIn select-none">
      {/* 1. トップバー */}
      <header className="w-full bg-stone-900 border-b border-stone-800 text-white px-5 py-3 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-600 text-white shadow-sm">
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
            <p className="text-[11px] text-stone-400">
              サーバー送信なし。新旧PDFを重ね合わせ、変更点を瞬時に検出します
            </p>
          </div>
        </div>

        {/* コントロール群 (両方読み込み時) */}
        {isBothLoaded && (
          <div className="flex items-center space-x-4">
            {/* 表示モード切り替え */}
            <div className="flex items-center bg-stone-800 p-1 rounded-xl border border-stone-700">
              <button
                type="button"
                onClick={() => setViewMode("diff")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "diff"
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-stone-300 hover:text-white hover:bg-stone-700"
                }`}
                title="赤（削除）と青（追加）で差分をハイライト表示"
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
                    : "text-stone-300 hover:text-white hover:bg-stone-700"
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
                    : "text-stone-300 hover:text-white hover:bg-stone-700"
                }`}
                title="スライダーを動かして前後の変化を確認"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>スライダー比較</span>
              </button>
            </div>

            {/* ズーム */}
            <div className="flex items-center space-x-1 bg-stone-800 px-2 py-1 rounded-lg border border-stone-700">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.2).toFixed(1))))}
                className="p-1 text-stone-300 hover:text-white rounded"
                title="縮小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono font-bold text-stone-200 px-1.5">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.2).toFixed(1))))}
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
              className="flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-1.5 rounded-lg text-xs font-bold border border-stone-700 transition-colors"
              title="現在の差分表示をPNG画像として保存"
            >
              <Download className="w-3.5 h-3.5" />
              <span>差分を画像保存</span>
            </button>
          </div>
        )}

        {/* 閉じるボタン */}
        <button
          type="button"
          onClick={onClose}
          className="p-2 text-stone-400 hover:text-white hover:bg-stone-800 rounded-xl transition-colors"
          title="比較画面を閉じる"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* 2. メインワークスペース */}
      <main className="flex-1 w-full overflow-auto flex flex-col items-center justify-center p-6 relative">
        {/* ファイル未読込時のドロップゾーン */}
        {!isBothLoaded ? (
          <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 my-auto animate-fadeIn">
            {/* 左: 変更前 (旧バージョン) */}
            <div className="bg-stone-900/90 border-2 border-dashed border-stone-700 hover:border-orange-500 rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all group">
              <div className="w-16 h-16 rounded-2xl bg-stone-800 group-hover:bg-orange-500/20 text-stone-400 group-hover:text-orange-400 flex items-center justify-center mb-4 transition-colors">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">① 変更前（旧バージョン）</h3>
              <p className="text-xs text-stone-400 mb-6">比較元のPDFファイルを選択してください</p>

              {fileOld ? (
                <div className="w-full bg-stone-800 border border-stone-700 rounded-xl p-3 flex items-center justify-between text-left">
                  <div className="truncate pr-2">
                    <p className="text-xs font-bold text-stone-200 truncate">{fileOld.name}</p>
                    <p className="text-[10px] text-stone-400 font-mono">{docOld?.numPages || 0} ページ</p>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                </div>
              ) : (
                <label className="cursor-pointer inline-flex items-center gap-2 bg-stone-800 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm">
                  <UploadCloud className="w-4 h-4" />
                  <span>PDFを選択</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => handleFileChange(e, "old")}
                  />
                </label>
              )}
            </div>

            {/* 右: 変更後 (新バージョン) */}
            <div className="bg-stone-900/90 border-2 border-dashed border-stone-700 hover:border-blue-500 rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all group">
              <div className="w-16 h-16 rounded-2xl bg-stone-800 group-hover:bg-blue-500/20 text-stone-400 group-hover:text-blue-400 flex items-center justify-center mb-4 transition-colors">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">② 変更後（新バージョン）</h3>
              <p className="text-xs text-stone-400 mb-6">比較先のPDFファイルを選択してください</p>

              {fileNew ? (
                <div className="w-full bg-stone-800 border border-stone-700 rounded-xl p-3 flex items-center justify-between text-left">
                  <div className="truncate pr-2">
                    <p className="text-xs font-bold text-stone-200 truncate">{fileNew.name}</p>
                    <p className="text-[10px] text-stone-400 font-mono">{docNew?.numPages || 0} ページ</p>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                </div>
              ) : (
                <label className="cursor-pointer inline-flex items-center gap-2 bg-stone-800 hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm">
                  <UploadCloud className="w-4 h-4" />
                  <span>PDFを選択</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => handleFileChange(e, "new")}
                  />
                </label>
              )}
            </div>
          </div>
        ) : (
          /* ファイル読込後の比較ビュー */
          <div className="w-full h-full flex flex-col items-center justify-center relative">
            {isProcessing && (
              <div className="absolute inset-0 bg-stone-950/60 backdrop-blur-xs z-30 flex items-center justify-center rounded-2xl">
                <div className="flex items-center gap-3 bg-stone-900 px-5 py-3 rounded-2xl border border-stone-800 text-white shadow-xl animate-pulse">
                  <RefreshCw className="w-5 h-5 animate-spin text-orange-500" />
                  <span className="text-xs font-bold">高精度差分を計算中...</span>
                </div>
              </div>
            )}

            <div
              className="transition-transform duration-150 origin-center"
              style={{ transform: `scale(${zoom})` }}
            >
              {/* 1. 差分ハイライトモード */}
              {viewMode === "diff" && (
                <div className="relative bg-white shadow-2xl rounded-lg overflow-hidden border border-stone-700">
                  <canvas ref={canvasDiffRef} className="max-w-none block" />
                </div>
              )}

              {/* 2. 左右並べて比較モード */}
              {viewMode === "split" && (
                <div className="flex items-center gap-6">
                  {/* 旧バージョン */}
                  <div className="flex flex-col items-center">
                    <span className="text-xs font-bold text-red-400 bg-red-950/80 border border-red-800/80 px-3 py-1 rounded-full mb-2">
                      変更前（旧）: {fileOld?.name}
                    </span>
                    <div className="bg-white shadow-2xl rounded-lg overflow-hidden border border-stone-700">
                      <canvas ref={canvasOldRef} className="max-w-none block" />
                    </div>
                  </div>

                  {/* 新バージョン */}
                  <div className="flex flex-col items-center">
                    <span className="text-xs font-bold text-blue-400 bg-blue-950/80 border border-blue-800/80 px-3 py-1 rounded-full mb-2">
                      変更後（新）: {fileNew?.name}
                    </span>
                    <div className="bg-white shadow-2xl rounded-lg overflow-hidden border border-stone-700">
                      <canvas ref={canvasNewRef} className="max-w-none block" />
                    </div>
                  </div>
                </div>
              )}

              {/* 3. スライダー比較モード */}
              {viewMode === "slider" && (
                <div
                  ref={sliderContainerRef}
                  onPointerDown={handlePointerDown}
                  className="relative bg-white shadow-2xl rounded-lg overflow-hidden border border-stone-700 cursor-ew-resize select-none"
                  style={{
                    width: canvasOldRef.current?.width || 800,
                    height: canvasOldRef.current?.height || 1100
                  }}
                >
                  {/* 下地: 新バージョン */}
                  <canvas
                    ref={canvasNewRef}
                    className="absolute inset-0 w-full h-full block"
                  />

                  {/* 上面: 旧バージョン (クリップ) */}
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ width: `${sliderPos}%` }}
                  >
                    <canvas
                      ref={canvasOldRef}
                      className="absolute inset-0 w-full h-full block max-w-none"
                      style={{
                        width: canvasOldRef.current?.width || 800,
                        height: canvasOldRef.current?.height || 1100
                      }}
                    />
                  </div>

                  {/* スライダーの仕切り線 */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-white shadow-lg pointer-events-none"
                    style={{ left: `${sliderPos}%` }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-md border-2 border-white text-[10px] font-bold">
                      ↔
                    </div>
                  </div>

                  {/* ラベル表示 */}
                  <span className="absolute top-3 left-3 bg-red-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow pointer-events-none">
                    変更前
                  </span>
                  <span className="absolute top-3 right-3 bg-blue-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow pointer-events-none">
                    変更後
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 3. ボトムバー (ページ送り & 凡例 & 統計) */}
      {isBothLoaded && (
        <footer className="w-full bg-stone-900 border-t border-stone-800 text-white px-6 py-3 flex items-center justify-between shrink-0 shadow-lg">
          {/* 凡例 */}
          <div className="flex items-center space-x-4">
            <span className="text-[11px] font-bold text-stone-400">差分の見方:</span>
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
            {diffStats.diffCount > 0 && (
              <span className="text-xs font-semibold text-orange-400 bg-orange-950/60 border border-orange-800/80 px-2.5 py-0.5 rounded-full">
                変更箇所: {diffStats.percent}%
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

          {/* 別ファイル選択ボタン */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => {
                setDocOld(null);
                setDocNew(null);
                setFileOld(null);
                setFileNew(null);
              }}
              className="text-xs text-stone-400 hover:text-white underline transition-colors"
            >
              別のPDFを比較する
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};
