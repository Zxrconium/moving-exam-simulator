import { useCallback } from 'react'

function exportResultsText(results, score, total) {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const pct = total > 0 ? ((score / total) * 100).toFixed(1) : '0.0'

  const lines = [
    'Moving Exam Simulator — Results',
    `Date: ${date}`,
    `Score: ${score}/${total} (${pct}%)`,
    '',
    '─'.repeat(50),
    '',
  ]

  const correct = results.filter(r => r.correct)
  const wrong = results.filter(r => !r.correct)

  if (correct.length > 0) {
    lines.push(`CORRECT (${correct.length}):`)
    correct.forEach((r, i) => {
      const tag = r.overridden ? ' [marked correct]' : ''
      lines.push(`  ${i + 1}. ${r.source}`)
      lines.push(`     Answer: ${r.answer}${tag}`)
    })
    lines.push('')
  }

  if (wrong.length > 0) {
    lines.push(`INCORRECT (${wrong.length}):`)
    wrong.forEach((r, i) => {
      const status = r.expired ? '[time expired]' : `You answered: "${r.userAnswer || '(blank)'}"`
      lines.push(`  ${i + 1}. ${r.source}`)
      lines.push(`     Correct: ${r.answer}`)
      lines.push(`     ${status}`)
    })
  }

  return lines.join('\n')
}

function ResultRow({ result, index }) {
  const { correct, overridden, expired, source, answer, userAnswer } = result

  return (
    <div className={`
      flex gap-3 p-3 rounded-lg border text-sm
      ${correct
        ? 'bg-green-950/40 border-green-800/50'
        : 'bg-red-950/30 border-red-900/50'
      }
    `}>
      {/* Icon */}
      <span className={`text-lg shrink-0 ${correct ? 'text-green-400' : 'text-red-400'}`}>
        {correct ? '✓' : '✗'}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-gray-300 font-medium truncate text-xs mb-0.5">{source}</p>
        <p className="text-white font-semibold">{answer}</p>
        {!correct && (
          <p className="text-gray-500 text-xs mt-0.5">
            {expired ? 'Time expired — no answer given' : `Your answer: "${userAnswer || '(blank)'}" `}
          </p>
        )}
        {overridden && (
          <span className="inline-block bg-amber-900/50 text-amber-400 text-xs px-1.5 py-0.5 rounded mt-1">
            manually marked correct
          </span>
        )}
      </div>
    </div>
  )
}

export default function ResultsScreen({ results, slides, onRestart, onUploadNew }) {
  const score = results.filter(r => r.correct).length
  const total = results.length
  const pct = total > 0 ? (score / total) * 100 : 0

  const scoreColor =
    pct >= 80 ? 'text-green-400' :
    pct >= 60 ? 'text-yellow-400' : 'text-red-400'

  const handleExport = useCallback(() => {
    const text = exportResultsText(results, score, total)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `exam-results-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [results, score, total])

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-8 text-center shrink-0">
        <h1 className="text-3xl font-bold mb-1">Exam Complete</h1>

        {/* Score */}
        <div className={`text-6xl font-black mt-4 mb-1 ${scoreColor}`}>
          {score}/{total}
        </div>
        <p className="text-gray-400 text-lg">{pct.toFixed(1)}% correct</p>

        {/* Progress bar */}
        <div className="mt-4 mx-auto max-w-xs h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              backgroundColor:
                pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444',
            }}
          />
        </div>

        {/* Quick stats */}
        <div className="flex justify-center gap-6 mt-4 text-sm">
          <span className="text-green-400">
            ✓ {score} correct
          </span>
          <span className="text-red-400">
            ✗ {total - score} incorrect
          </span>
        </div>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto results-list px-6 py-4">
        <div className="max-w-2xl mx-auto space-y-2">
          {results.map((result, i) => (
            <ResultRow key={result.slideId ?? i} result={result} index={i} />
          ))}
        </div>
      </div>

      {/* Action bar */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-800 px-6 py-4">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3">
          <button
            onClick={onRestart}
            className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white py-3 rounded-xl font-semibold transition-colors"
          >
            Restart (same slides)
          </button>
          <button
            onClick={onUploadNew}
            className="flex-1 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 text-white py-3 rounded-xl font-semibold transition-colors"
          >
            Upload New Files
          </button>
          <button
            onClick={handleExport}
            className="sm:w-auto bg-gray-800 hover:bg-gray-700 active:bg-gray-900 text-gray-300 py-3 px-5 rounded-xl font-medium transition-colors border border-gray-700"
            title="Download results as a text file"
          >
            Export ↓
          </button>
        </div>
      </div>
    </div>
  )
}
