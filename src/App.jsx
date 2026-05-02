import { useState, useCallback } from 'react'
import UploadScreen from './components/UploadScreen'
import ProcessingScreen from './components/ProcessingScreen'
import ExamScreen from './components/ExamScreen'
import ResultsScreen from './components/ResultsScreen'
import { processPDFFile, processImageFile } from './utils/pdfProcessor'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function App() {
  const [screen, setScreen] = useState('upload')
  const [slides, setSlides] = useState([])
  const [results, setResults] = useState([])
  const [processingStatus, setProcessingStatus] = useState(null)
  const [processingError, setProcessingError] = useState(null)

  const handleFilesReady = useCallback(async (files) => {
    setScreen('processing')
    setProcessingError(null)
    const allSlides = []

    try {
      for (const file of files) {
        const isPDF =
          file.type === 'application/pdf' ||
          file.name.toLowerCase().endsWith('.pdf')

        if (isPDF) {
          const pdfSlides = await processPDFFile(file, (status) => {
            setProcessingStatus(status)
          })
          allSlides.push(...pdfSlides)
        } else {
          setProcessingStatus({ filename: file.name, page: 1, totalPages: 1 })
          const slide = await processImageFile(file)
          allSlides.push(slide)
        }
      }
    } catch (err) {
      console.error('Processing error:', err)
      setProcessingError(err.message || 'Failed to process one or more files.')
      setScreen('upload')
      return
    }

    if (allSlides.length === 0) {
      setProcessingError('No slides could be extracted from the uploaded files.')
      setScreen('upload')
      return
    }

    setSlides(shuffle(allSlides))
    setResults([])
    setScreen('exam')
  }, [])

  const handleExamComplete = useCallback((examResults) => {
    setResults(examResults)
    setScreen('results')
  }, [])

  const handleRestart = useCallback(() => {
    setSlides(prev => shuffle([...prev]))
    setResults([])
    setScreen('exam')
  }, [])

  const handleUploadNew = useCallback(() => {
    setSlides([])
    setResults([])
    setProcessingError(null)
    setScreen('upload')
  }, [])

  if (screen === 'upload') {
    return <UploadScreen onFilesReady={handleFilesReady} error={processingError} />
  }
  if (screen === 'processing') {
    return <ProcessingScreen status={processingStatus} />
  }
  if (screen === 'exam') {
    return <ExamScreen slides={slides} onComplete={handleExamComplete} />
  }
  if (screen === 'results') {
    return (
      <ResultsScreen
        results={results}
        slides={slides}
        onRestart={handleRestart}
        onUploadNew={handleUploadNew}
      />
    )
  }
  return null
}
