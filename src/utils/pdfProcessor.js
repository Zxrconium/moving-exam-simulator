import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`

const RENDER_SCALE = 2.0

// How many canvas pixels above each label to capture as the image crop.
// At RENDER_SCALE=2 this equals 220 screen-pixels.  Raise if image tops are
// clipped; lower if too much whitespace appears above the photo.
const CAPTURE_HEIGHT = 440

// Labels whose baseline Y values are within this many canvas pixels → same row.
const Y_ROW_TOLERANCE = 60

// Gap between two consecutive text items (canvas px) small enough that they
// belong to the same multi-word label rather than two separate labels.
const X_MERGE_GAP = 120

// Discard text items shorter than this (filters page numbers, stray marks).
const LABEL_MIN_CHARS = 2

// ─── Matrix math (inline so we have zero dependency on pdfjsLib.Util) ────────

// Multiply two 2-D affine transforms represented as [a,b,c,d,e,f].
function matMul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

// ─── Convert one pdfjs text item to canvas-space metrics ─────────────────────
//
// Canvas coordinate system: origin top-left, y increases downward.
// Viewport transform contains a y-flip so PDF's bottom-left origin maps to
// canvas top-left.  After applying matMul:
//   tx[4] = left edge of text baseline, canvas px
//   tx[5] = baseline Y, canvas px  (larger Y = lower on the page)
//   tx[3] = negative font-size-in-canvas-px  (negative because of y-flip)
//
// Therefore:
//   fontH = Math.abs(tx[3])  — font height in canvas px
//   textTop = tx[5] - fontH  — top of the glyph (this is the BOTTOM of the image
//                               crop, because the image lives ABOVE the label)

function itemToCanvas(item, viewport) {
  const tx = matMul(viewport.transform, item.transform)
  // Guard: if tx[3] is somehow 0 fall back to tx[0] then a sane default.
  const fontH = Math.abs(tx[3]) || Math.abs(tx[0]) || 14
  // item.width is in PDF user units.  Multiply by RENDER_SCALE for canvas px.
  const textW = Math.max(item.width * RENDER_SCALE, fontH * 0.3)
  return {
    str:   item.str.trim(),
    x:     tx[4],               // left edge, canvas px
    y:     tx[5],               // baseline Y, canvas px
    fontH,
    textW,
    cx:    tx[4] + textW / 2,  // horizontal centre of this text item
    top:   tx[5] - fontH,      // top of glyph = bottom edge of image crop
  }
}

// ─── Group text items into labelled cells ─────────────────────────────────────
//
// Returns an array of rows (sorted top-to-bottom).
// Each row is an array of merged labels (sorted left-to-right).
// A "merged label" is one or more adjacent text items that pdfjs may have
// split, reassembled into a single answer string.

function detectLabels(canvasItems) {
  // 1. Sort all items by baseline Y ascending (top of page first).
  const sorted = [...canvasItems].sort((a, b) => a.y - b.y)

  // 2. Cluster into rows.  Each item is compared against the FIRST item's Y in
  //    each existing row (the minimum Y in that row).  Items are processed in
  //    ascending Y order so new_item.y >= row_first.y always.
  const rows = []
  for (const item of sorted) {
    let placed = false
    for (const row of rows) {
      if (item.y - row[0].y <= Y_ROW_TOLERANCE) {
        row.push(item)
        placed = true
        break
      }
    }
    if (!placed) rows.push([item])
  }

  // 3. Within each row: sort left-to-right, then merge items whose X gap is
  //    small enough that they're parts of the same multi-word label.
  const labelRows = rows.map(row => {
    row.sort((a, b) => a.x - b.x)
    const merged = []

    for (const item of row) {
      const last = merged[merged.length - 1]
      if (last) {
        const gap = item.x - (last.x + last.textW)
        if (gap <= X_MERGE_GAP) {
          // Extend the running label to include this item.
          const rightEdge = item.x + item.textW
          last.str   = (last.str + ' ' + item.str).trim()
          last.textW = rightEdge - last.x
          last.cx    = last.x + last.textW / 2
          // Keep the most extreme metrics.
          last.y     = Math.max(last.y, item.y)
          last.fontH = Math.max(last.fontH, item.fontH)
          last.top   = Math.min(last.top,   item.top)
          continue
        }
      }
      merged.push({ ...item })
    }
    return merged
  })

  // 4. Sort rows top-to-bottom.
  return labelRows.sort((a, b) => a[0].y - b[0].y)
}

// ─── Core: render one page and crop individual cells ─────────────────────────

async function extractCells(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE })
  const W = viewport.width
  const H = viewport.height

  // --- Render the full page to an offscreen canvas ---
  const canvas = document.createElement('canvas')
  canvas.width  = W
  canvas.height = H
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

  // --- Pull the text layer.  This is the ANSWER KEY — it is never shown. ---
  const { items: rawItems } = await page.getTextContent()
  const significant = rawItems.filter(
    item => typeof item.str === 'string' && item.str.trim().length >= LABEL_MIN_CHARS
  )

  if (significant.length === 0) {
    // No extractable text — return the full page without an answer.
    return [{ imageUrl: canvas.toDataURL('image/jpeg', 0.92), answer: null, cellKey: 'full' }]
  }

  const canvasItems = significant.map(item => itemToCanvas(item, viewport))
  const labelRows   = detectLabels(canvasItems)

  const cells = []

  for (let ri = 0; ri < labelRows.length; ri++) {
    const row = labelRows[ri]
    const n   = row.length

    // Equal-width columns: divide the page width evenly by the number of labels
    // in this row.  Column ci spans [ci·colW, (ci+1)·colW].
    const colW = W / n

    for (let ci = 0; ci < n; ci++) {
      const label = row[ci]

      // --- Horizontal bounds (equal columns) ---
      const cropX = Math.round(ci * colW)
      const cropW = Math.round((ci + 1) * colW) - cropX

      // --- Vertical bounds (fixed height above the label) ---
      // The image sits ABOVE the label, so the crop's bottom edge is just above
      // the top of the label text, and we extend upward by CAPTURE_HEIGHT.
      const cropBottom = Math.floor(label.top) - 4       // 4 px gap above text
      const cropTop    = Math.max(0, cropBottom - CAPTURE_HEIGHT)
      const cropH      = cropBottom - cropTop

      // Only skip truly degenerate crops (e.g. label IS at the top of the page).
      if (cropW <= 0 || cropH < 20) continue

      // Crop this cell from the full-page canvas into its own canvas.
      const cell = document.createElement('canvas')
      cell.width  = cropW
      cell.height = cropH
      cell.getContext('2d').drawImage(
        canvas, cropX, cropTop, cropW, cropH,
        0, 0, cropW, cropH
      )

      cells.push({
        imageUrl: cell.toDataURL('image/jpeg', 0.92),
        answer:   label.str,
        cellKey:  `${ri}-${ci}`,
      })
    }
  }

  // --- Fallback: if nothing was cropped, return the full page with labels
  //     blacked out (safety net for unusual PDF layouts). ---
  if (cells.length === 0) {
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#000'
    for (const item of canvasItems) {
      ctx.fillRect(item.x - 10, item.top - 10, item.textW + 20, item.fontH + 20)
    }
    return [{
      imageUrl: canvas.toDataURL('image/jpeg', 0.92),
      answer:   canvasItems.map(i => i.str).join(' '),
      cellKey:  'full',
    }]
  }

  return cells
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process a PDF: yields one question slide per image cell per page.
 * A 3×3 grid page produces 9 slides.
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
 * The filename (extension stripped, separators → spaces) becomes the answer.
 */
export async function processImageFile(file) {
  const imageUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
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
