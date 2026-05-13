// Extracted from settings/page.tsx. Memory-files manager: lists each
// .md memory file the AI loads into its system prompt, with inline edit
// and create/delete. State + the three handlers stay in
// SettingsPageContent so the data-loading useEffect doesn't need to move.

'use client'

interface MemoryFile {
  id: string
  name: string
  content: string
  description?: string
  created_at: string
  updated_at: string
}

interface MemoryTabProps {
  memoryFiles: MemoryFile[]
  setMemoryFiles: (files: MemoryFile[]) => void
  editingFile: MemoryFile | null
  setEditingFile: (f: MemoryFile | null) => void
  newFileName: string
  setNewFileName: (v: string) => void
  onCreate: (name: string) => void | Promise<void>
  onUpdate: (file: MemoryFile) => void | Promise<void>
  onDelete: (fileId: string) => void | Promise<void>
}

export function MemoryTab({
  memoryFiles,
  setMemoryFiles,
  editingFile,
  setEditingFile,
  newFileName,
  setNewFileName,
  onCreate,
  onUpdate,
  onDelete,
}: MemoryTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900">Memory Files</h3>
          <p className="mt-1 text-sm text-gray-500">
            Memory files are injected into AI system prompts to provide context and personalization.
          </p>

          {/* Create new file */}
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              placeholder="New file name (e.g., USER.md, CONTEXT.md)"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
            <button
              onClick={() => newFileName && onCreate(newFileName)}
              disabled={!newFileName}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300"
            >
              Create
            </button>
          </div>
        </div>
      </div>

      {/* Memory files list */}
      {memoryFiles.map((file) => (
        <div key={file.id} className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-sm font-medium text-gray-900">{file.name}</h4>
                {file.description && (
                  <p className="text-sm text-gray-500">{file.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingFile(file)}
                  className="text-sm text-indigo-600 hover:text-indigo-500"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(file.id)}
                  className="text-sm text-red-600 hover:text-red-500"
                >
                  Delete
                </button>
              </div>
            </div>

            {editingFile?.id === file.id ? (
              <div className="mt-4">
                <textarea
                  value={file.content}
                  onChange={(e) => {
                    const updated = memoryFiles.map((f) =>
                      f.id === file.id ? { ...f, content: e.target.value } : f
                    )
                    setMemoryFiles(updated)
                  }}
                  rows={10}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-sm"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => onUpdate(file)}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingFile(null)}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <pre className="mt-2 text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">
                {file.content}
              </pre>
            )}
          </div>
        </div>
      ))}

      {memoryFiles.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">No memory files yet. Create one to personalize your AI interactions.</p>
        </div>
      )}
    </div>
  )
}
