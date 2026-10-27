# 03 Tasks Closed chart – plan
Files: rewrite `components/chart-area-interactive.tsx` → `components/tasks-closed-chart.tsx`.
1. recharts `BarChart` with `Bar radius={999}`, `barSize≈54`, custom `shape` to draw rounded pill + SVG `<pattern>` for diagonal stripes (weekend).
2. Data: `[{d:'W',v:12,t:'weekday'},{d:'T',v:18},{d:'F',v:21},{d:'S',v:8,t:'weekend'},{d:'S',v:7,t:'weekend'},{d:'M',v:17},{d:'T',v:16,t:'today',onTime:82}]`.
3. Custom `Tooltip` content + always-visible label on today bar (per PDF); hover on others shows same style.
4. Custom legend (plain HTML) matching PDF; hide axis lines, show only category labels.
