const TOTAL = 60

export default function TimerBar({ timeLeft, paused = false }) {
  const pct = Math.max(0, Math.min(100, (timeLeft / TOTAL) * 100))

  // Green → orange → red based on remaining time
  let color, glow
  if (pct > 66) {
    color = '#22c55e'  // green-500
    glow = 'rgba(34,197,94,0.4)'
  } else if (pct > 33) {
    color = '#f97316'  // orange-500
    glow = 'rgba(249,115,22,0.4)'
  } else {
    color = '#ef4444'  // red-500
    glow = 'rgba(239,68,68,0.5)'
  }

  return (
    <div className="w-full h-2 bg-gray-900 overflow-hidden shrink-0">
      <div
        className="h-full timer-bar-fill"
        style={{
          width: paused ? '0%' : `${pct}%`,
          backgroundColor: color,
          boxShadow: `0 0 10px ${glow}`,
        }}
      />
    </div>
  )
}
