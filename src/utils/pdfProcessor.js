import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`

const RENDER_SCALE = 2.0

// ── Pixel-scan constants ────────────────────────────────────────────────────
// Luminance 0-255: rows/columns whose average exceeds this are background
// (white margins, gutters between images).  235 catches near-white without
// mis-classifying lightly-stained microscopy fields.
const BRIGHT_THRESHOLD = 235

// A bright run must span at least this many consecutive canvas pixels to count
// as a real separator (prevents isolated bright rows inside images from
// splitting cells falsely).
const MIN_SEP_PX = 10

// A dark band must be at least this many canvas pixels to be kept as a cell.
const MIN_CELL_PX = 80

// Sanity cap: if pixel scan reports > this many cells in one dimension, the
// detection is unreliable — fall back to the text-based approach.
const MAX_CELLS_PER_DIM = 12

// Bottom fraction of each pixel-detected cell that is the "label zone".
// This portion is cropped off so the answer text is never shown.
const LABEL_ZONE = 0.20

// ── Text-layer constants ────────────────────────────────────────────────────
const LABEL_MIN_CHARS = 2   // ignore stray marks / single chars
const Y_ROW_TOL       = 60  // canvas-px: baseline spread within one label row
const X_MERGE_GAP     = 120 // canvas-px: gap small enough to merge into same label
const CAPTURE_HEIGHT  = 440 // canvas-px above each label to capture (text fallback)

// ── Inline 2-D affine matrix multiply (avoids pdfjsLib.Util dependency) ─────
function matMul(a, b) {
  return [
    a[0]*b[0] + a[2]*b[1],
    a[1]*b[0] + a[3]*b[1],
    a[0]*b[2] + a[2]*b[3],
    a[1]*b[2] + a[3]*b[3],
    a[0]*b[4] + a[2]*b[5] + a[4],
    a[1]*b[4] + a[3]*b[5] + a[5],
  ]
}

// ── Map a pdfjs text item into canvas-space metrics ─────────────────────────
// Canvas y increases downward; the viewport transform flips PDF's y-up axis.
//   tx[4] = left edge,  canvas px
//   tx[5] = baseline Y, canvas px  (larger Y = lower on page)
//   tx[3] = −fontSize in canvas px (negative because of y-flip)
function itemToCanvas(item, viewport) {
  const tx    = matMul(viewport.transform, item.transform)
  const fontH = Math.abs(tx[3]) || Math.abs(tx[0]) || 14
  const textW = Math.max(item.width * RENDER_SCALE, fontH * 0.3)
  return {
    str:  item.str.trim(),
    x:    tx[4],
    y:    tx[5],
    fontH,
    textW,
    cx:   tx[4] + textW / 2,
    top:  tx[5] - fontH,   // top of glyph
  }
}

// ── Pixel-grid detection ─────────────────────────────────────────────────────

// Returns dark-region bands [[start,end], ...] separated by bright runs.
// Requires a bright run to be ≥ minSepPx pixels wide before treating it as a
// real separator; filters out dark bands shorter than minCellPx.
function darkBands(lum, length, threshold, minCellPx, minSepPx) {
  // 1. Mark pixels that belong to a qualifying bright separator run.
  const isSep   = new Uint8Array(length)
  let runStart  = -1
  for (let i = 0; i <= length; i++) {
    const bright = i < length && lum[i] >= threshold
    if (bright && runStart < 0) { runStart = i }
    if (!bright && runStart >= 0) {
      if (i - runStart >= minSepPx) {
        for (let j = runStart; j < i; j++) isSep[j] = 1
      }
      runStart = -1
    }
  }

  // 2. Collect dark (non-separator) regions.
  const bands = []
  let darkStart = -1
  for (let i = 0; i <= length; i++) {
    const dark = i < length && !isSep[i]
    if (dark  && darkStart < 0)  { darkStart = i }
    if (!dark && darkStart >= 0) {
      if (i - darkStart >= minCellPx) bands.push([darkStart, i - 1])
      darkStart = -1
    }
  }
  return bands
}

// Scan a rendered canvas and return horizontal + vertical dark-band arrays.
function detectPixelGrid(canvas, W, H) {
  const px = canvas.getContext('2d').getImageData(0, 0, W, H).data

  // Row luminance: sample ≤200 columns per row.
  const xStep  = Math.max(1, Math.floor(W / 200))
  const rowLum = new Float32Array(H)
  for (let y = 0; y < H; y++) {
    let s = 0, n = 0
    for (let x = 0; x < W; x += xStep) {
      const i = (y * W + x) * 4
      s += px[i]*0.299 + px[i+1]*0.587 + px[i+2]*0.114
      n++
    }
    rowLum[y] = s / n
  }

  // Column luminance: sample ≤200 rows per column.
  const yStep  = Math.max(1, Math.floor(H / 200))
  const colLum = new Float32Array(W)
  for (let x = 0; x < W; x++) {
    let s = 0, n = 0
    for (let y = 0; y < H; y += yStep) {
      const i = (y * W + x) * 4
      s += px[i]*0.299 + px[i+1]*0.587 + px[i+2]*0.114
      n++
    }
    colLum[x] = s / n
  }

  return {
    hBands: darkBands(rowLum, H, BRIGHT_THRESHOLD, MIN_CELL_PX, MIN_SEP_PX),
    vBands: darkBands(colLum, W, BRIGHT_THRESHOLD, MIN_CELL_PX, MIN_SEP_PX),
  }
}

// ── Answer assignment ────────────────────────────────────────────────────────

// Find the label text for the cell region (x0,y0)→(x1,y1).
// Searches the bottom LABEL_ZONE of the cell first, then just below it.
function answerForCell(canvasItems, x0, y0, x1, y1) {
  const cellH     = y1 - y0
  const labelTopY = y0 + cellH * (1 - LABEL_ZONE)

  // Items whose horizontal centre falls within the cell (±20 px tolerance).
  const inCol = canvasItems.filter(it => it.cx >= x0 - 20 && it.cx <= x1 + 20)

  // Prefer items in the label zone (bottom fraction of the cell or just below).
  const inLabel = inCol.filter(it => it.y >= labelTopY && it.y <= y1 + 40)
  if (inLabel.length > 0) {
    return inLabel.sort((a, b) => a.y - b.y || a.x - b.x).map(i => i.str).join(' ').trim()
  }

  // Fallback 1: nearest text row directly below the cell.
  const below = inCol.filter(it => it.y > y1).sort((a, b) => a.y - b.y)
  if (below.length > 0) {
    const nearY = below[0].y
    return below
      .filter(it => it.y - nearY < 40)
      .sort((a, b) => a.x - b.x)
      .map(it => it.str)
      .join(' ')
      .trim()
  }

  // Fallback 2: any text anywhere inside the cell.
  const inCell = inCol.filter(it => it.y >= y0 && it.y <= y1)
  if (inCell.length > 0) {
    return inCell.sort((a, b) => a.y - b.y || a.x - b.x).map(it => it.str).join(' ').trim()
  }

  return null
}

// ── Crop a rectangular region from a canvas into a new canvas ───────────────
function cropCanvas(src, x, y, w, h) {
  const dst = document.createElement('canvas')
  dst.width  = w
  dst.height = h
  dst.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h)
  return dst
}

// ── Text-based extraction (fallback) ─────────────────────────────────────────
// Groups text items into label rows, then crops a fixed height above each label.
function textBasedExtraction(canvas, W, canvasItems) {
  const sorted = [...canvasItems].sort((a, b) => a.y - b.y)
  const rows   = []
  for (const item of sorted) {
    let placed = false
    for (const row of rows) {
      if (item.y - row[0].y <= Y_ROW_TOL) { row.push(item); placed = true; break }
    }
    if (!placed) rows.push([item])
  }

  const labelRows = rows.map(row => {
    row.sort((a, b) => a.x - b.x)
    const merged = []
    for (const item of row) {
      const last = merged[merged.length - 1]
      if (last && item.x - (last.x + last.textW) <= X_MERGE_GAP) {
        last.str   = (last.str + ' ' + item.str).trim()
        last.textW = (item.x + item.textW) - last.x
        last.cx    = last.x + last.textW / 2
        last.y     = Math.max(last.y, item.y)
        last.fontH = Math.max(last.fontH, item.fontH)
        last.top   = Math.min(last.top, item.top)
      } else {
        merged.push({ ...item })
      }
    }
    return merged
  }).sort((a, b) => a[0].y - b[0].y)

  const cells = []
  for (let ri = 0; ri < labelRows.length; ri++) {
    const row  = labelRows[ri]
    const n    = row.length
    const colW = W / n
    for (let ci = 0; ci < n; ci++) {
      const label   = row[ci]
      const cropX   = Math.round(ci * colW)
      const cropW   = Math.round((ci + 1) * colW) - cropX
      const cropBot = Math.floor(label.top) - 4
      const cropTop = Math.max(0, cropBot - CAPTURE_HEIGHT)
      const cropH   = cropBot - cropTop
      if (cropW <= 0 || cropH < 20) continue
      cells.push({
        imageUrl: cropCanvas(canvas, cropX, cropTop, cropW, cropH).toDataURL('image/jpeg', 0.92),
        answer:   label.str,
        cellKey:  `${ri}-${ci}`,
      })
    }
  }
  return cells
}

// ── Core per-page extraction ─────────────────────────────────────────────────

async function extractCells(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE })
  const W = viewport.width
  const H = viewport.height

  // Render the full page to an offscreen canvas.
  const canvas  = document.createElement('canvas')
  canvas.width  = W
  canvas.height = H
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

  // Extract the text layer — this is the answer key and is NEVER shown.
  const { items: rawItems } = await page.getTextContent()
  const canvasItems = rawItems
    .filter(it => typeof it.str === 'string' && it.str.trim().length >= LABEL_MIN_CHARS)
    .map(it => itemToCanvas(it, viewport))

  // ── Strategy 1: pixel-scan grid detection ──────────────────────────────────
  const { hBands, vBands } = detectPixelGrid(canvas, W, H)

  const isRealGrid =
    hBands.length >= 1 && vBands.length >= 1 &&
    (hBands.length > 1 || vBands.length > 1) &&
    hBands.length <= MAX_CELLS_PER_DIM &&
    vBands.length <= MAX_CELLS_PER_DIM

  if (isRealGrid) {
    const cells = []

    for (let ri = 0; ri < hBands.length; ri++) {
      const [y0, y1] = hBands[ri]
      const cellH    = y1 - y0

      for (let ci = 0; ci < vBands.length; ci++) {
        const [x0, x1] = vBands[ci]
        const cellW    = x1 - x0

        // Crop the top (1−LABEL_ZONE) of the cell: the microscope image only.
        // The bottom LABEL_ZONE fraction (where the label text lives) is excluded.
        const imageH = Math.floor(cellH * (1 - LABEL_ZONE))
        if (imageH < 20 || cellW < 20) continue

        const answer = answerForCell(canvasItems, x0, y0, x1, y1)
        cells.push({
          imageUrl: cropCanvas(canvas, x0, y0, cellW, imageH).toDataURL('image/jpeg', 0.92),
          answer,
          cellKey: `${ri}-${ci}`,
        })
      }
    }

    if (cells.length > 0) return cells
  }

  // ── Strategy 2: text-position based (labels define crop boundaries) ────────
  if (canvasItems.length > 0) {
    const cells = textBasedExtraction(canvas, W, canvasItems)
    if (cells.length > 0) return cells
  }

  // ── Strategy 3: full page, no answer available ─────────────────────────────
  return [{ imageUrl: canvas.toDataURL('image/jpeg', 0.92), answer: null, cellKey: 'full' }]
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Process a PDF file.
 * Yields one question slide per image cell per page.
 * A 2-page PDF with 12 images per page produces 24 question slides.
 */
export async function processPDFFile(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data:       arrayBuffer,
    cMapUrl:    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  }).promise

  const slides = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.({ filename: file.name, page: pageNum, totalPages: pdf.numPages })

    const page  = await pdf.getPage(pageNum)
    const cells = await extractCells(page)
    const fallback = file.name.replace(/\.[^/.]+$/, '') + ` p${pageNum}`
    const multi    = cells.length > 1

    for (const cell of cells) {
      slides.push({
        id:       `${file.name}::p${pageNum}::${cell.cellKey}`,
        imageUrl:  cell.imageUrl,
        answer:    cell.answer || fallback,
        source:    multi
          ? `${file.name} – p${pageNum} [${cell.cellKey}]`
          : `${file.name} – p${pageNum}`,
      })
    }
  }

  return slides
}

/**
 * Process a standalone image file.
 * The filename (extension stripped, separators → spaces) is the answer.
 */
export async function processImageFile(file) {
  const imageUrl = await new Promise((resolve, reject) => {
    const reader  = new FileReader()
    reader.onload  = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const answer = file.name
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { id: file.name, imageUrl, answer, source: file.name }
}
