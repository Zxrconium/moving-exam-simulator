function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Two words are "compatible" when:
//   • one is a substring of the other (existing rule), OR
//   • they share a long enough common prefix relative to the user's word length
//     (handles stem variants like "adenoma" ↔ "adenocarcinoma").
function wordsCompatible(uw, cw) {
  if (cw.includes(uw) || uw.includes(cw)) return true
  const minLen = Math.min(uw.length, cw.length)
  let pfx = 0
  for (; pfx < minLen && uw[pfx] === cw[pfx]; pfx++) {}
  // Require at least 4 matching leading chars AND ≥70 % of the user's word.
  return pfx >= Math.min(uw.length, 4) && pfx / uw.length >= 0.7
}

/**
 * Returns true when the user's answer is a reasonable match for the correct answer.
 *
 * Checks (in order):
 *  1. Exact normalized match
 *  2. One string is a substring of the other  (handles short/long answers)
 *  3. Word-level: ≥80 % of significant user words (len > 2) match a word in
 *     the correct answer, using the wordsCompatible() rule above
 */
export function checkAnswer(userAnswer, correctAnswer) {
  if (!userAnswer || !correctAnswer) return false

  const user    = normalize(userAnswer)
  const correct = normalize(correctAnswer)

  if (!user) return false
  if (user === correct) return true

  if (correct.includes(user) || user.includes(correct)) return true

  const userWords    = user.split(' ').filter(w => w.length > 2)
  if (userWords.length === 0) return false

  const correctWords = correct.split(' ')
  const matched = userWords.filter(uw =>
    correctWords.some(cw => wordsCompatible(uw, cw))
  )

  return matched.length / userWords.length >= 0.8
}
