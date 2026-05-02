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
    <div className="h-screen bg-gray-950 flex flex-col text-white overflow-hidden">
      {/* Timer bar */}
      <TimerBar timeLeft={timeLeft} paused={phase === 'revealed'} />

      {/* Top bar: slide counter + timer */}
      <div className="flex items-center justify-between px-6 py-2.5 text-sm shrink-0">
        <span className="text-gray-400 font-mono tracking-wide">
          Slide {currentIdx + 1} / {slides.length}
        </span>
        <span className={`font-mono font-bold text-base tabular-nums ${
          phase === 'revealed' ? 'text-gray-700' : timerColor
        }`}>
          {phase === 'revealed' ? '—' : `${timeLeft}s`}
        </span>
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center px-4 pb-2 min-h-0">
        <img
          key={currentSlide.id}
          src={currentSlide.imageUrl}
          alt="Exam slide"
          className="exam-image max-w-full max-h-full object-contain rounded-xl shadow-2xl"
          style={{ maxHeight: 'calc(100vh - 240px)' }}
          draggable={false}
        />
      </div>

      {/* Answer panel */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-800 px-6 py-4">
        {phase === 'answering' ? (
          <div className="max-w-2xl mx-auto flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={userAnswer}
              onChange={e => setUserAnswer(e.target.value)}
              placeholder="Type your answer and press Enter…"
              className="
                flex-1 bg-gray-800 text-white border border-gray-700 rounded-xl
                px-4 py-3 text-base focus:outline-none focus:border-blue-500
                placeholder-gray-600 transition-colors
              "
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={() => submitAnswer(userAnswer)}
              className="
                bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                text-white px-6 py-3 rounded-xl font-semibold transition-colors
                shrink-0
              "
            >
              Submit
            </button>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            {/* Result card */}
            <div className={`
              rounded-xl p-4 border
              ${effectiveCorrect
                ? 'bg-green-950/60 border-green-700'
                : 'bg-red-950/60 border-red-800'
              }
            `}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className={`text-lg font-bold mb-1 ${effectiveCorrect ? 'text-green-400' : 'text-red-400'}`}>
                    {effectiveCorrect
                      ? '✓ Correct!'
                      : results[results.length - 1]?.expired
                        ? '⏱ Time\'s up'
                        : '✗ Incorrect'
                    }
                  </p>
                  <p className="text-sm text-gray-400">
                    Correct answer:{' '}
                    <span className="text-white font-semibold">{currentSlide.answer}</span>
                  </p>
                  {!effectiveCorrect && userAnswer && (
                    <p className="text-xs text-gray-600 mt-1">
                      You answered: &ldquo;{userAnswer}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              {!effectiveCorrect && (
                <button
                  onClick={markCorrect}
                  className="
                    bg-amber-800 hover:bg-amber-700 active:bg-amber-900
                    text-amber-100 px-4 py-2.5 rounded-xl text-sm font-medium
                    transition-colors shrink-0
                  "
                  title="Override: count this answer as correct"
                >
                  Mark as Correct
                </button>
              )}
              <button
                onClick={advance}
                className="
                  flex-1 bg-gray-700 hover:bg-gray-600 active:bg-gray-800
                  text-white py-2.5 rounded-xl font-semibold transition-colors
                "
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
