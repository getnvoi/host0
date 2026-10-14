// From vrcl ds/icon drawings.json and the Monochrome canvas icons. Paths are SVG path data.
import { palette } from "./tokens";

type Box = [x: number, y: number, width: number, height: number];

// A tool or category face on a 24 point grid: stroked paths, filled pixels and circles.
export type Drawing = { strokes: string[]; pixels: Box[]; rings: Box[] };

const all: Record<string, Drawing> = {
  agent: { strokes: ["M12 8.6V6.7M10.5 14.2h3M7.2 12.2h-.9M16.8 12.2h.9", "M7.2 8.6h9.6v8.0h-9.6z"], pixels: [], rings: [[11.2, 5.1, 1.6, 1.6]] },
  artifact: { strokes: ["M12 6.2l5.4 3v6l-5.4 3-5.4-3v-6zM6.6 9.2l5.4 3 5.4-3M12 12.2v6"], pixels: [], rings: [] },
  back: { strokes: [], pixels: [[7, 12, 10, 1], [8, 11, 1, 1], [9, 10, 1, 1], [10, 9, 1, 1], [8, 13, 1, 1], [9, 14, 1, 1], [10, 15, 1, 1]], rings: [] },
  bash: { strokes: ["M8 10.2l2 1.8-2 1.8", "M5.5 7.0h13.0v10.0h-13.0z"], pixels: [[12, 13, 4, 1]], rings: [] },
  changes: { strokes: [], pixels: [[7, 10, 3, 1], [8, 9, 1, 1], [8, 11, 1, 1], [14, 10, 3, 1], [9, 15, 1, 1], [10, 16, 4, 1], [14, 15, 1, 1]], rings: [] },
  click: { strokes: ["M10.5 10.5v7.6l2-1.9 1.5 3 1.3-.6-1.5-3h2.8z"], pixels: [[10, 6, 1, 2], [6, 10, 2, 1], [7, 7, 1, 1], [13, 7, 1, 1]], rings: [] },
  connector: { strokes: ["M10.4 9.6V7M13.6 9.6V7M12 15v3", "M8.4 9.6h7.2v5.4h-7.2z"], pixels: [], rings: [] },
  edit: { strokes: ["M8 15.5l.9-3.2 6.2-6.2 2.3 2.3-6.2 6.2zM13.8 7.4l2.3 2.3"], pixels: [[6, 18, 2, 1], [10, 18, 2, 1], [14, 18, 2, 1]], rings: [] },
  env: { strokes: ["M9.3 10.5h1.6M13.1 10.5h1.6M10 14.1v1.5M12 14.1v1.5M14 14.1v1.5", "M7.0 7.0h10.0v10.5h-10.0z"], pixels: [], rings: [] },
  gate: { strokes: ["M13.3 6.8l2.4-.7"], pixels: [[9, 9, 1, 2], [14, 9, 1, 2], [10, 15, 4, 1]], rings: [] },
  globe: { strokes: ["M7 12h10M12 7c1.4 1.4 2.1 3 2.1 5s-.7 3.6-2.1 5c-1.4-1.4-2.1-3-2.1-5s.7-3.6 2.1-5z"], pixels: [], rings: [[7, 7, 10, 10]] },
  grep: { strokes: ["M13.8 13.8l3.4 3.4"], pixels: [[9, 10, 4, 1], [9, 12, 2, 1]], rings: [[6.8, 6.8, 8, 8]] },
  history: { strokes: ["M7.4 12a4.6 4.6 0 1 0 4.6-4.6 4.97 4.97 0 0 0-3.44 1.4L7.4 9.96", "M7.4 7.4v2.56h2.56M12 9.45V12l2.04 1.02"], pixels: [[14, 13, 1, 1]], rings: [] },
  layers: { strokes: ["M12 6.8l5.4 2.8L12 12.4 6.6 9.6z"], pixels: [[10, 9, 1, 1], [13, 9, 1, 1], [7, 13, 1, 1], [9, 14, 1, 1], [11, 15, 2, 1], [14, 14, 1, 1], [16, 13, 1, 1], [7, 16, 1, 1], [9, 17, 1, 1], [11, 18, 2, 1], [14, 17, 1, 1], [16, 16, 1, 1]], rings: [] },
  library: { strokes: ["M6.8 11.7l5.2 1.2 5.2-1.2v3.6l-5.2 1.2-5.2-1.2zM12 12.9v3.6"], pixels: [[8, 8, 1, 1], [9, 9, 1, 1], [10, 8, 1, 1], [13, 8, 1, 1], [14, 9, 1, 1], [15, 8, 1, 1]], rings: [] },
  llm: { strokes: ["M9 8.2l.5 1.3 1.3.5-1.3.5L9 11.8l-.5-1.3-1.3-.5 1.3-.5zM15 8.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"], pixels: [[9, 15, 1, 1], [10, 16, 4, 1], [14, 15, 1, 1]], rings: [] },
  member: { strokes: ["M8.4 12.3c.6.5 1.6.5 2.2 0M13.4 14.1c.6.5 1.6.5 2.2 0"], pixels: [[8, 10, 1, 1], [10, 10, 1, 1], [13, 12, 1, 1], [15, 12, 1, 1]], rings: [[6.2, 7.7, 6.6, 6.6], [11.2, 9.5, 6.6, 6.6]] },
  mention: { strokes: ["M14.4 9.6v3.3c0 1.3 2.1 1.7 2.6-.4.8-3.4-1.7-6.5-5-6.5a5.9 5.9 0 1 0 2.9 11"], pixels: [], rings: [[9.6, 9.6, 4.8, 4.8]] },
  note: { strokes: ["M7.8 6.4h6l2.4 2.4v9.4H7.8zM13.8 6.4v2.4h2.4"], pixels: [[10, 10, 1, 2], [13, 10, 1, 2], [10, 14, 1, 1], [11, 15, 2, 1], [13, 14, 1, 1]], rings: [] },
  plan: { strokes: ["M7.4 8.6l1 1 1.8-1.8M7.4 12.6l1 1 1.8-1.8M12 9h4.6M12 13h4.6"], pixels: [[7, 16, 2, 1], [11, 16, 2, 1], [15, 16, 2, 1]], rings: [] },
  pr: { strokes: ["M8 8.9v6.2M16 15.1v-4.1a2 2 0 0 0-2-2h-3"], pixels: [[11, 8, 1, 1], [10, 9, 1, 1], [11, 10, 1, 1]], rings: [[6.6, 6.1, 2.8, 2.8], [6.6, 15.1, 2.8, 2.8], [14.6, 15.1, 2.8, 2.8]] },
  press: { strokes: ["M7.5 6.5h9.0v9.0h-9.0z"], pixels: [[14, 9, 1, 3], [10, 11, 4, 1], [11, 10, 1, 1], [11, 12, 1, 1], [7, 18, 10, 1]], rings: [] },
  preview: { strokes: ["M11.4 10h1.2", "M6.6 8.0h4.8v4.0h-4.8z", "M12.6 8.0h4.8v4.0h-4.8z"], pixels: [[8, 9, 2, 2], [14, 9, 2, 2], [9, 14, 1, 1], [10, 15, 4, 1], [14, 14, 1, 1]], rings: [] },
  push: { strokes: ["M12 16.5V7.5M8.8 10.7L12 7.5l3.2 3.2"], pixels: [[8, 18, 8, 1]], rings: [] },
  read: { strokes: ["M5.4 12c2.2-3.6 11-3.6 13.2 0-2.2 3.6-11 3.6-13.2 0z"], pixels: [[11, 11, 2, 2]], rings: [] },
  repo: { strokes: ["M7.4 7.2h2.8V10H7.4zM13.8 7.2h2.8V10h-2.8zM7.6 16H10v2.4H7.6zM8.8 10v6M15.2 10c0 3.1-6.4 2.3-6.4 5.4"], pixels: [], rings: [] },
  screenshot: { strokes: ["M9.5 8.5l1-1.6h3l1 1.6", "M5.5 8.5h13.0v9.0h-13.0z"], pixels: [[16, 10, 1, 1]], rings: [[9.6, 10.6, 4.8, 4.8]] },
  scroll: { strokes: ["M9 9.4l3-3 3 3M9 14.6l3 3 3-3"], pixels: [[11, 11, 2, 2]], rings: [] },
  secret: { strokes: ["M10.6 13.6v-1a1.4 1.4 0 0 1 2.8 0v1", "M9.4 13.6h5.2v4.0h-5.2z"], pixels: [[8, 8, 1, 1], [9, 9, 1, 1], [10, 8, 1, 1], [13, 8, 1, 1], [14, 9, 1, 1], [15, 8, 1, 1], [11, 15, 2, 1]], rings: [] },
  server: { strokes: ["M12.8 8.6h2M12.8 15.4h2", "M7.4 6.3h9.2v4.6h-9.2z", "M7.4 13.1h9.2v4.6h-9.2z"], pixels: [], rings: [] },
  session: { strokes: ["M16.6 9c.6.5.6 1.5 0 2M18.2 8c1.2 1 1.2 3 0 4"], pixels: [[8, 9, 1, 2], [14, 9, 1, 2], [10, 14, 3, 1], [10, 16, 3, 1], [9, 15, 1, 1], [13, 15, 1, 1]], rings: [] },
  settitle: { strokes: ["M12 7v10M10.4 7h3.2M10.4 17h3.2"], pixels: [[5, 11, 5, 1], [5, 13, 3, 1], [15, 11, 4, 1]], rings: [] },
  skill: { strokes: ["M7.7 11.4h2.9L9.15 8.9z", "M10.6 14.0h2.8v2.1h-2.8z"], pixels: [], rings: [[13.6, 8.9, 2.6, 2.6]] },
  subagent: { strokes: ["M9.3 7.4V6M8.2 11.8h2.2M14.3 12.2v-1.1M13.5 15.6h1.6", "M5.6 7.4h7.4v6.2h-7.4z", "M11.4 12.2h5.8v5.0h-5.8z"], pixels: [], rings: [] },
  task: { strokes: ["M9.4 15.2l2 1.2 3.8-3"], pixels: [[9, 8, 1, 2], [14, 8, 1, 2]], rings: [] },
  terminal: { strokes: ["M8 8.8l2 1.4-2 1.4"], pixels: [[13, 11, 4, 1], [9, 15, 1, 1], [10, 16, 4, 1], [14, 15, 1, 1]], rings: [] },
  tool: { strokes: ["M9.5 10V8.2h5V10M6.5 13h11", "M6.5 10.0h11.0v7.5h-11.0z"], pixels: [[9, 14, 1, 2], [14, 14, 1, 2]], rings: [] },
  type: { strokes: ["M5.5 8.0h13.0v8.0h-13.0z"], pixels: [[8, 10, 1, 1], [10, 10, 1, 1], [12, 10, 1, 1], [14, 10, 1, 1], [16, 10, 1, 1], [9, 13, 6, 1]], rings: [] },
  wait: { strokes: ["M8.2 6.5h7.6M8.2 17.5h7.6M9.2 6.5c0 3.2 2.8 3.4 2.8 5.5s-2.8 2.3-2.8 5.5M14.8 6.5c0 3.2-2.8 3.4-2.8 5.5s2.8 2.3 2.8 5.5"], pixels: [[11, 8, 2, 1], [11, 15, 2, 1], [10, 16, 4, 1]], rings: [] },
  workspace: { strokes: ["M6.8 11.6L12 7l5.2 4.6M8.4 10.3v7.2h7.2v-7.2M11 17.5v-2.4h2v2.4"], pixels: [], rings: [] },
  you: { strokes: ["M11 10h2"], pixels: [[9, 15, 1, 1], [10, 16, 4, 1], [14, 15, 1, 1]], rings: [[7, 8, 4, 4], [13, 8, 4, 4]] },
  zap: { strokes: ["M12 6.8l5.4 2.8L12 12.4 6.6 9.6zM6.6 12.6L12 15.4l5.4-2.8M6.6 15.6L12 18.4l5.4-2.8"], pixels: [[10, 9, 1, 1], [13, 9, 1, 1], [19, 3, 1, 1], [18, 4, 1, 1], [17, 5, 3, 1], [18, 6, 1, 1], [17, 7, 1, 1]], rings: [] },};

const bounds = new Map<string, Box>();

// The drawing's bounds: the strokes' geometry, the rings and the pixels.
function boundsOf(name: string, drawing: Drawing): Box {
  const known = bounds.get(name);
  if (known) return known;
  const parts: Box[] = [...drawing.rings, ...drawing.pixels];
  if (drawing.strokes.length && typeof document !== "undefined") {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("style", "position:absolute;width:0;height:0;visibility:hidden");
    document.body.appendChild(svg);
    for (const d of drawing.strokes) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
      const b = path.getBBox();
      parts.push([b.x, b.y, b.width, b.height]);
    }
    svg.remove();
  }
  if (!parts.length) return [0, 0, 24, 24];
  const x = Math.min(...parts.map((p) => p[0]));
  const y = Math.min(...parts.map((p) => p[1]));
  const right = Math.max(...parts.map((p) => p[0] + p[2]));
  const bottom = Math.max(...parts.map((p) => p[1] + p[3]));
  const box: Box = [x, y, right - x, bottom - y];
  bounds.set(name, box);
  return box;
}

export type FaceProps = { name: string; size?: number; disc?: string; line?: string };

// A tool or category face from vrcl: a disc and a hairline drawing with pixel features.
export function Face({ name, size = 20, disc = palette.page, line = palette.secondary }: FaceProps) {
  const drawing = all[name];
  const scale = size / 24;
  const weight = size <= 16 ? 1.35 : size <= 20 ? 1.15 : 1.0;
  let move = "";
  if (drawing) {
    // The drawings are not centred in their 24 grid: move their bounds onto the disc's centre.
    const [x, y, w, h] = boundsOf(name, drawing);
    move = `translate(${(12 - (x + w / 2)) * scale} ${(12 - (y + h / 2)) * scale}) scale(${scale})`;
  }
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" style={{ color: line }}>
      <circle cx={size / 2} cy={size / 2} r={size / 2} fill={disc} />
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 0.5} fill="none" stroke="currentColor" strokeOpacity={0.11} strokeWidth={1} />
      {drawing && (
        <g transform={move}>
          {drawing.strokes.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {drawing.rings.map(([x, y, w, h], i) => (
            <ellipse key={i} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke="currentColor" strokeWidth={weight} />
          ))}
          {drawing.pixels.map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} fill="currentColor" />
          ))}
        </g>
      )}
    </svg>
  );
}
