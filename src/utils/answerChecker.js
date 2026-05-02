/**
 * Normalizes a string for lenient comparison:
 * lowercase, strip punctuation, collapse whitespace.
 */
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Returns true if the user's answer is a reasonable match for the correct answer.
 *
 * Rules applied (in order):
 *  1. Exact normalized match
 *  2. One string is a substring of the other (handles partial answers)
 *  3. Word-level match: ≥80% of significant user words (len > 2) appear in
 *     the correct answer
 */
export function checkAnswer(userAnswer, correctAnswer) {
  if (!userAnswer || !correctAnswer) return false

  const user = normalize(userAnswer)
  const correct = normalize(correctAnswer)

  if (!user) return false
  if (user === correct) return true

  // Substring containment (case/punctuation-insensitive)
  if (correct.includes(user) || user.includes(correct)) return true

  // Word-level: check that the significant words the user typed all appear
  const userWords = user.split(' ').filter(w => w.length > 2)
  if (userWords.length === 0) return false

  const correctWords = correct.split(' ')
  const matched = userWords.filter(uw =>
    correctWords.some(cw => cw.includes(uw) || uw.includes(cw))
  )

  return matched.length / userWords.length >= 0.8
}
