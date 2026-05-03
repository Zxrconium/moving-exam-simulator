import * as pdfjsLib from 'pdfjs-dist'

// Worker must match the installed pdfjs-dist version
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`

const RENDER_SCALE = 2.0   // 2× for crisp display on HiDPI screens
const TEXT_PADDING = 10    // Extra pixels to black out around each text item

/**
 * Renders a PDF page to a canvas, extracts text content, then blacks out
 * every text region so the answer is hidden. Returns a data URL and the
 * extracted text as the answer key.
 */
async function renderPageMasked(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')

  // Render all page content (raster images + vector graphics + text in stream)
  await page.render({ canvasContext: ctx, viewport }).promise

  // Extract text content separately (this is the TEXT LAYER — never rendered to DOM)
  const textContent = await page.getTextContent()
  const textItems = textContent.items.filter(item => item.str?.trim().length > 0)

  // Build answer string from every text item on the page
  const answer = textItems
    .map(item => item.str.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Black out all text regions so the student cannot read the answer
  ctx.save()
  ctx.fillStyle = '#000000'

  for (const item of textItems) {
    if (!item.str.trim()) continue

    // Transform from PDF user-space to canvas/viewport coordinates.
    // viewport.transform includes the y-axis flip, so after this:
    //   tx[4], tx[5] = baseline position in canvas pixels (y increases down)
    //   tx[3] = negative font-size-in-canvas-px (magnitude = font height)
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)

    // Font height: magnitude of the y-scale component of the combined transform
    const fontH = Math.abs(tx[3]) || Math.hypot(tx[0], tx[1]) || 16

    // Text width: item.width is in PDF user units; multiply by viewport scale
    // (viewport.scale ≈ RENDER_SCALE for simple upright text)
    const textW = item.width * RENDER_SCALE

    // Baseline is at (tx[4], tx[5]). Text extends UP from baseline, which in
    // canvas coords (y-down) means from (tx[5] - fontH) to tx[5].
    ctx.fillRect(
      tx[4] - TEXT_PADDING,
      tx[5] - fontH - TEXT_PADDING,
      Math.max(textW, fontH * 0.4) + TEXT_PADDING * 2,
      fontH + TEXT_PADDING * 2,
    )
  }

  ctx.restore()

  return {
    imageUrl: canvas.toDataURL('image/jpeg', 0.92),
    answer,
  }
}

/**
 * Process a PDF file: render every page as a masked canvas image.
 * Each page becomes one exam slide; the answer is the extracted page text.
 * @param {File} file
 * @param {(info: {filename: string, page: number, totalPages: number}) => void} [onProgress]
 * @returns {Promise<Slide[]>}
 */
export async function processPDFFile(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    // CMap support for CJK fonts (harmless for Latin PDFs)
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  }).promise

  const slides = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.({ filename: file.name, page: pageNum, totalPages: pdf.numPages })

    const page = await pdf.getPage(pageNum)
    const { imageUrl, answer } = await renderPageMasked(page)

    // Fall back to filename + page number if the page has no extractable text
    const fallbackAnswer = `${file.name.replace(/\.[^/.]+$/, '')} page ${pageNum}`

    slides.push({
      id: `${file.name}::p${pageNum}`,
      imageUrl,
      answer: answer || fallbackAnswer,
      source: `${file.name} – page ${pageNum}`,
    })
  }

  return slides
}

/**
 * Process a standalone image file (JPG / PNG).
 * The filename (without extension, with dashes/underscores → spaces) is the answer.
 * @param {File} file
 * @returns {Promise<Slide>}
 */
export async function processImageFile(file) {
  const imageUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const answer = file.name
    .replace(/\.[^/.]+$/, '')   // strip extension
    .replace(/[_-]+/g, ' ')    // underscores/dashes → spaces
    .replace(/\s+/g, ' ')
    .trim()

  return {
    id: file.name,
    imageUrl,
    answer,
    source: file.name,
  }
}
