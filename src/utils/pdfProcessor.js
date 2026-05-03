import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`

const RENDER_SCALE = 2.0

// Labels whose baseline Y values are within this many canvas pixels
// are considered to be in the same row.
const Y_ROW_TOLERANCE = 50

// Gap between two text items in the same row smaller than this → they belong
// to the same label (handles multi-word labels pdfjs splits into pieces).
const X_LABEL_MERGE_GAP = 100

// Ignore single-char text items (page numbers, stray marks, etc.)
const LABEL_MIN_LEN = 2

// Skip any crop that turns out smaller than these dimensions.
const MIN_CELL_W = 60   // canvas px
const MIN_CELL_H = 60   // canvas px

// ─── Low-level helpers ────────────────────────────────────────────────────────

function cropCanvas(src, x, y, w, h) {
  const dst = document.createElement('canvas')
  dst.width = w
  dst.height = h
  dst.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h)
  return dst
}

/**
 * Convert a pdfjs text item into canvas-space metrics.
 *
 * Coordinate notes (canvas: y increases downward):
 *   tx[4]          = left edge of text, canvas px
 *   tx[5]          = baseline Y, canvas px
 *   Math.abs(tx[3])= font height in canvas px (tx[3] is negative for upright text)
 *   textTop        = top of glyph = tx[5] - fontH
 */
function toCanvasLabel(item, viewport) {
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
  const fontH = Math.abs(tx[3]) || Math.hypot(tx[0], tx[1]) || 16
  const textW = Math.max(item.width * RENDER_SCALE, fontH * 0.4)
  return {
    str: item.str.trim(),
    canvasX: tx[4],
    canvasY: tx[5],              // baseline (y-down)
    fontH,
    textW,
    centerX: tx[4] + textW / 2,
    textTop: tx[5] - fontH,      // top of glyph (smaller Y = higher on page)
    textBottom: tx[5] + fontH * 0.25,  // baseline + small descender margin
  }
}

// ─── Grid detection ───────────────────────────────────────────────────────────

/**
 * Group raw canvas-space labels into a 2-D grid:
 *   - Outer array = rows, sorted top-to-bottom
 *   - Inner array = merged labels within that row, sorted left-to-right
 *
 * Two items are in the same row  when |ΔY| ≤ Y_ROW_TOLERANCE.
 * Two items in the same row are the same label when the X gap between them
 * is ≤ X_LABEL_MERGE_GAP (multi-word labels that pdfjs splits into pieces).
 */
function detectGridLabels(rawLabels) {
  // 1. Cluster into Y-rows
  const sorted = [...rawLabels].sort((a, b) => a.canvasY - b.canvasY)
  const yRows = []
  for (const item of sorted) {
    const row = yRows.find(r => Math.abs(r[0].canvasY - item.canvasY) <= Y_ROW_TOLERANCE)
    if (row) row.push(item)
    else yRows.push([item])
  }

  // 2. Within each Y-row, sort left-to-right, then merge adjacent pieces
  const grid = yRows.map(row => {
    row.sort((a, b) => a.canvasX - b.canvasX)
    const merged = []

    for (const item of row) {
      const last = merged[merged.length - 1]
      if (last) {
        const gap = item.canvasX - (last.canvasX + last.textW)
        if (gap <= X_LABEL_MERGE_GAP) {
          // Extend the running label
          last.str = `${last.str} ${item.str}`.trim()
          last.textW = (item.canvasX + item.textW) - last.canvasX
          last.centerX = last.canvasX + last.textW / 2
          last.canvasY = Math.max(last.canvasY, item.canvasY)
          last.fontH = Math.max(last.fontH, item.fontH)
          last.textTop = Math.min(last.textTop, item.textTop)
          last.textBottom = Math.max(last.textBottom, item.textBottom)
          continue
        }
      }
      merged.push({ ...item })
    }

    return merged
  })

  // 3. Sort rows top-to-bottom (ascending canvas Y)
  grid.sort((a, b) => a[0].canvasY - b[0].canvasY)
  return grid
}

// ─── Cell cropping ────────────────────────────────────────────────────────────

/**
 * Render a single PDF page, detect its grid of labels, and return one cropped
 * canvas image per cell.  Labels are never rendered to the DOM or included in
 * the cropped image — each crop ends just above its label text.
 */
async function extractCells(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE })
  const W = viewport.width
  const H = viewport.height

  // --- Render full page ---
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise

  // --- Extract text layer (answer key, never shown) ---
  const textContent = await page.getTextContent()
  const rawLabels = textContent.items
    .filter(item => item.str?.trim().length >= LABEL_MIN_LEN)
    .map(item => toCanvasLabel(item, viewport))

  // No extractable text → return the full page (no answer available)
  if (rawLabels.length === 0) {
    return [{ imageUrl: canvas.toDataURL('image/jpeg', 0.92), answer: null, cellKey: 'full' }]
  }

  // --- Build grid ---
  const grid = detectGridLabels(rawLabels)

  // Each row's top boundary:
  //   row 0 → y = 0 (top of page)
  //   row N → just below the bottom of the labels in row N-1
  const rowTopBoundaries = grid.map((row, i) => {
    if (i === 0) return 0
    const prevRow = grid[i - 1]
    return Math.ceil(Math.max(...prevRow.map(l => l.textBottom))) + 4
  })

  // --- Crop each cell ---
  const cells = []

  for (let ri = 0; ri < grid.length; ri++) {
    const row = grid[ri]
    const n = row.length
    const rowTop = rowTopBoundaries[ri]

    for (let ci = 0; ci < n; ci++) {
      const label = row[ci]

      // Horizontal bounds: midpoint between this label's center and its neighbours.
      // Leftmost cell starts at x=0; rightmost cell ends at x=W.
      const leftCenter = ci > 0 ? row[ci - 1].centerX : 0
      const rightCenter = ci < n - 1 ? row[ci + 1].centerX : W

      const cellLeft  = ci === 0     ? 0 : Math.floor((label.centerX + leftCenter)  / 2)
      const cellRight = ci === n - 1 ? W : Math.ceil( (label.centerX + rightCenter) / 2)

      // Vertical bounds: from rowTop → just above the label text (4 px gap).
      // Cropping above the text means the label is never part of the shown image.
      const cellBottom = Math.floor(label.textTop) - 4

      const x = Math.max(0, cellLeft)
      const y = Math.max(0, rowTop)
      const w = Math.min(W - x, cellRight - cellLeft)
      const h = Math.min(H - y, cellBottom - rowTop)

      if (w < MIN_CELL_W || h < MIN_CELL_H) continue

      cells.push({
        imageUrl: cropCanvas(canvas, x, y, w, h).toDataURL('image/jpeg', 0.92),
        answer: label.str,
        cellKey: `${ri}-${ci}`,
      })
    }
  }

  // Fallback: if cropping produced nothing useful, return the full page with
  // labels blacked out (original behaviour).
  if (cells.length === 0) {
    ctx.save()
    ctx.fillStyle = '#000000'
    for (const lbl of rawLabels) {
      const PAD = 10
      ctx.fillRect(lbl.canvasX - PAD, lbl.textTop - PAD, lbl.textW + PAD * 2, lbl.fontH + PAD * 2)
    }
    ctx.restore()
    return [{
      imageUrl: canvas.toDataURL('image/jpeg', 0.92),
      answer: rawLabels.map(l => l.str).join(' '),
      cellKey: 'full',
    }]
  }

  return cells
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process a PDF file: extract one slide per image cell per page.
 * For a page with a 3×3 grid of labelled images this yields 9 slides.
 */
export async function processPDFFile(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  }).promise

  const slides = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.({ filename: file.name, page: pageNum, totalPages: pdf.numPages })

    const page = await pdf.getPage(pageNum)
    const cells = await extractCells(page)
    const fallback = `${file.name.replace(/\.[^/.]+$/, '')} p${pageNum}`
    const multiCell = cells.length > 1

    for (const cell of cells) {
      slides.push({
        id: `${file.name}::p${pageNum}::${cell.cellKey}`,
        imageUrl: cell.imageUrl,
        answer: cell.answer || fallback,
        source: multiCell
          ? `${file.name} – p${pageNum} [${cell.cellKey}]`
          : `${file.name} – p${pageNum}`,
      })
    }
  }

  return slides
}

/**
 * Process a standalone image file.
 * The filename (extension stripped, dashes/underscores → spaces) is the answer.
 */
export async function processImageFile(file) {
  const imageUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
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
