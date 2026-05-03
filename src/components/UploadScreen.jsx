import { useState, useRef, useCallback } from 'react'

const ACCEPTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf'])

function getFileExt(filename) {
  return '.' + filename.split('.').pop().toLowerCase()
}

function isAccepted(file) {
  return (
    ACCEPTED_EXTENSIONS.has(getFileExt(file.name)) ||
    file.type === 'application/pdf' ||
    file.type.startsWith('image/')
  )
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileRow({ file, onRemove }) {
  const isPDF = getFileExt(file.name) === '.pdf'
  return (
    <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 gap-2">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className="text-base shrink-0">{isPDF ? '📄' : '🖼️'}</span>
        <span className="text-sm text-gray-700 truncate font-medium">{file.name}</span>
        <span className="text-xs text-gray-400 shrink-0">{formatBytes(file.size)}</span>
      </div>
      <button
        onClick={() => onRemove(file)}
        className="text-gray-400 hover:text-red-500 transition-colors shrink-0 text-sm font-bold px-1"
        title="Remove file"
        aria-label={`Remove ${file.name}`}
      >
        ✕
      </button>
    </div>
  )
}

export default function UploadScreen({ onFilesReady, error: externalError }) {
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState('')
  const inputRef = useRef(null)

  const addFiles = useCallback((incoming) => {
    const valid = Array.from(incoming).filter(isAccepted)
    const rejected = Array.from(incoming).length - valid.length

    if (valid.length === 0 && rejected > 0) {
      setValidationError('Only JPG, PNG, and PDF files are supported.')
      return
    }
    setValidationError('')

    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name))
      return [...prev, ...valid.filter(f => !existingNames.has(f.name))]
    })
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    // Only clear if leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleInputChange = useCallback((e) => {
    addFiles(e.target.files)
    e.target.value = ''
  }, [addFiles])

  const removeFile = useCallback((file) => {
    setFiles(prev => prev.filter(f => f !== file))
  }, [])

  const displayError = validationError || externalError

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🔬</div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2 tracking-tight">
            Moving Exam Simulator
          </h1>
          <p className="text-gray-500 text-lg">
            Upload microscopy slides to begin your timed exam
          </p>
        </div>

        {/* Drop Zone */}
        <div
          role="button"
          tabIndex={0}
          className={`
            border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
            transition-all duration-200 select-none
            ${isDragging
              ? 'border-blue-500 bg-blue-50 shadow-inner'
              : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'
            }
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        >
          <p className="text-xl font-semibold text-gray-700 mb-1">
            {isDragging ? 'Drop to add files' : 'Drop files here or click to browse'}
          </p>
          <p className="text-sm text-gray-400">
            Supports JPG, PNG (images) and PDF (slides with labels)
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
            multiple
            className="hidden"
            onChange={handleInputChange}
          />
        </div>

        {/* Error message */}
        {displayError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm text-center">
            {displayError}
          </div>
        )}

        {/* File List */}
        {files.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-600">
                {files.length} file{files.length !== 1 ? 's' : ''} ready
              </p>
              <button
                onClick={() => setFiles([])}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {files.map((file, i) => (
                <FileRow key={`${file.name}-${i}`} file={file} onRemove={removeFile} />
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <button
          disabled={files.length === 0}
          onClick={() => onFilesReady(files)}
          className={`
            mt-5 w-full py-4 rounded-xl text-lg font-bold transition-all duration-200
            ${files.length > 0
              ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-lg hover:shadow-xl'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
            }
          `}
        >
          {files.length > 0 ? `Start Exam  →` : 'Select files to begin'}
        </button>

        <p className="text-center text-xs text-gray-400 mt-4">
          PDF text layers are extracted as answer keys and never shown during the exam
        </p>
      </div>
    </div>
  )
}
