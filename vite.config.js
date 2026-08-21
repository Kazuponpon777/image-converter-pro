/**
 * ============================================================
 *  AI組織型コードレビュー済み
 *  レビュー日: 2026-08-21
 *  レビュー部署: バグチェック部 / セキュリティ部 / 改善提案部
 *  統合修正: 開発部
 * ============================================================
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'pdfjs/cmaps', rename: { stripBase: true } },
        { src: 'node_modules/pdfjs-dist/iccs/*', dest: 'pdfjs/iccs', rename: { stripBase: true } },
        { src: 'node_modules/pdfjs-dist/standard_fonts/*', dest: 'pdfjs/standard_fonts', rename: { stripBase: true } },
        { src: 'node_modules/pdfjs-dist/wasm/*', dest: 'pdfjs/wasm', rename: { stripBase: true } },
      ],
    }),
  ],
  base: './',
  build: {
    // [修正] 改善提案部指摘: 巨大ライブラリの Manual Chunks 分割による初回読み込み最適化
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pdfjs-dist') || id.includes('node_modules/jspdf')) {
            return 'vendor-pdf';
          }
          if (id.includes('node_modules/xlsx') || id.includes('node_modules/docx-preview') || id.includes('node_modules/html2canvas')) {
            return 'vendor-office';
          }
          if (id.includes('node_modules/@dnd-kit')) {
            return 'vendor-dnd';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
})
