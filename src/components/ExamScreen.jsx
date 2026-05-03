import { useState, useEffect, useRef, useCallback } from 'react'
import TimerBar from './TimerBar'
import { checkAnswer } from '../utils/answerChecker'

const TIMER_SECONDS = 60

export default function ExamScreen({ slides, onComplete }) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState('answering')  // 'answering' | 'revealed'
  const [userAnswer, setUserAnswer] = useState('')
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS)
  const [isCorrect, setIsCorrect] = useState(null)
  const [results, setResults] = useState([])

  const timerRef = useRef(null)
  const inputRef = useRef(null)
  // Ref so the interval callback always calls the latest submitAnswer
  const submitRef = useRef(null)

  const currentSlide = slides[currentIdx]

  // ─── Submit answer ────────────────────────────────────────────────────────

  const submitAnswer = useCallback((answer, expired = false) => {
    clearInterval(timerRef.current)
    const correct = !expired && checkAnswer(answer, currentSlide.answer)
    setIsCorrect(correct)
    setPhase('revealed')
    setResults(prev => [
      ...prev,
      {
        slideId: currentSlide.id,
        source: currentSlide.source,
        answer: currentSlide.answer,
        userAnswer: answer,
        correct,
        expired,
        overridden: false,
      },
    ])
  }, [currentSlide])

  // Keep ref fresh on every render
  submitRef.current = submitAnswer

  // ─── Advance to next slide ─────────────────────────────────────────────────

  const advance = useCallback(() => {
    if (currentIdx + 1 >= slides.length) {
      onComplete(results)
    } else {
      setCurrentIdx(i => i + 1)
      setPhase('answering')
      setUserAnswer('')
      setTimeLeft(TIMER_SECONDS)
      setIsCorrect(null)
    }
  }, [currentIdx, slides.length, results, onComplete])

  // ─── Mark answer as "close enough" ───────────────────────────────────────

  const markCorrect = useCallback(() => {
    setIsCorrect(true)
    setResults(prev => {
      const updated = [...prev]
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        correct: true,
        overridden: true,
      }
      return updated
    })
  }, [])

  // ─── Timer ────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Restart timer whenever we move to a new slide
    setTimeLeft(TIMER_SECONDS)
    let remaining = TIMER_SECONDS

    timerRef.current = setInterval(() => {
      remaining -= 1
      setTimeLeft(remaining)
      if (remaining <= 0) {
        clearInterval(timerRef.current)
        // Use ref to avoid stale-closure over submitAnswer
        submitRef.current('', true)
      }
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [currentIdx])  // Only restart when slide changes; submitAnswer clears it on submit

  // ─── Focus input when answering ───────────────────────────────────────────

  useEffect(() => {
    if (phase === 'answering') {
      // Small delay lets the re-render complete before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    }
  }, [phase, currentIdx])

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (phase === 'answering') {
        submitAnswer(userAnswer)
      } else if (phase === 'revealed') {
        advance()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, userAnswer, submitAnswer, advance])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!currentSlide) return null

  const isLastSlide = currentIdx + 1 >= slides.length
  const effectiveCorrect = isCorrect

  const timerColor =
    timeLeft > 40 ? 'text-green-400' :
    timeLeft > 20 ? 'text-orange-400' : 'text-red-400'

  return (
    <div className="h-screen bg-gray-950 flex flex-col text-white overflow-hidden relative">
      {/* Timer bar — fixed at top */}
      <TimerBar timeLeft={timeLeft} paused={phase === 'revealed'} />

      {/* Slim status row */}
      <div className="flex items-center justify-between px-4 py-1.5 text-xs shrink-0 z-10">
        <span className="text-gray-500 font-mono">
          {currentIdx + 1} / {slides.length}
        </span>
        <span className={`font-mono font-bold tabular-nums ${
          phase === 'revealed' ? 'text-gray-700' : timerColor
        }`}>
          {phase === 'revealed' ? '—' : `${timeLeft}s`}
        </span>
      </div>

      {/* Image — fills remaining space */}
      <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
        <img
          key={currentSlide.id}
          src={currentSlide.imageUrl}
          alt="Exam slide"
          className="exam-image w-full h-full object-contain"
          draggable={false}
        />
      </div>

      {/* Answer panel — slim overlay pinned to bottom */}
      <div className="shrink-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 px-4 py-3">
        {phase === 'answering' ? (
          <div className="max-w-2xl mx-auto flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={userAnswer}
              onChange={e => setUserAnswer(e.target.value)}
              placeholder="Type your answer and press Enter…"
              className="
                flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg
                px-3 py-2 text-sm focus:outline-none focus:border-blue-500
                placeholder-gray-600 transition-colors
              "
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={() => submitAnswer(userAnswer)}
              className="
                bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                text-white px-5 py-2 rounded-lg font-semibold text-sm transition-colors shrink-0
              "
            >
              Submit
            </button>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-2">
            {/* Compact result row */}
            <div className={`rounded-lg px-3 py-2 border flex items-center gap-3 flex-wrap
              ${effectiveCorrect ? 'bg-green-950/60 border-green-800' : 'bg-red-950/60 border-red-900'}`}
            >
              <span className={`font-bold text-sm shrink-0 ${effectiveCorrect ? 'text-green-400' : 'text-red-400'}`}>
                {effectiveCorrect ? '✓ Correct!' : results[results.length - 1]?.expired ? '⏱ Time\'s up' : '✗ Wrong'}
              </span>
              <span className="text-gray-300 text-sm min-w-0">
                <span className="text-gray-500">Answer: </span>
                <span className="font-semibold text-white">{currentSlide.answer}</span>
              </span>
              {!effectiveCorrect && userAnswer && (
                <span className="text-gray-600 text-xs">You: &ldquo;{userAnswer}&rdquo;</span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {!effectiveCorrect && (
                <button onClick={markCorrect}
                  className="bg-amber-800 hover:bg-amber-700 text-amber-100 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0"
                >
                  Mark Correct
                </button>
              )}
              <button onClick={advance}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg font-semibold text-sm transition-colors"
              >
                {isLastSlide ? 'See Results →' : 'Next Slide →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
