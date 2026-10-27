# 00 Design system – plan
1. Swap `Geist` in `app/layout.tsx` for `Plus_Jakarta_Sans` (next/font/google), keep `--font-sans` variable.
2. Edit `app/globals.css` `:root` tokens: background, card, muted, border, primary (green), primary-foreground, ring, radius (`--radius: 1rem`),
   sidebar-* tokens, chart-1..5 greens. Add custom tokens: `--success`, `--warning`, `--danger`, `--info` each with `-soft` bg variant.
3. Force light mode: remove/disable dark toggle in `components/theme-provider.tsx` (set `forcedTheme="light"` or default light).
4. Add small utility component `components/status-pill.tsx` (variant: urgent|high|normal|success|draft|info|neutral|danger) reused by 04/05/07/08.
5. Verify: swatches match PDF (eyedrop from rendered PDF page).
