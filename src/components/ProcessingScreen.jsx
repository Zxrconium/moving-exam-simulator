export default function ProcessingScreen({ status }) {
  const pageInfo =
    status?.totalPages && status.totalPages > 1
      ? ` — page ${status.page} of ${status.totalPages}`
      : ''

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white gap-6">
      {/* Spinner */}
      <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Processing Files</h2>

        {status?.filename && (
          <p className="text-gray-400 text-sm max-w-xs truncate mx-auto">
            {status.filename}{pageInfo}
          </p>
        )}

        <p className="text-gray-600 text-xs mt-3 max-w-xs mx-auto">
          Rendering pages and masking answer labels — this may take a moment for large PDFs
        </p>
      </div>
    </div>
  )
}
