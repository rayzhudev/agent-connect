'use client'

import { useState } from 'react'
import type { SpreadsheetMeta, Version } from '@/lib/types'

interface SidebarProps {
  spreadsheets: SpreadsheetMeta[]
  currentId: string | null
  versions: Version[]
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onDelete: (id: string) => void
  onRestoreVersion: (versionId: string) => void
  onRefresh: () => void
}

export default function Sidebar({
  spreadsheets,
  currentId,
  versions,
  onSelect,
  onCreate,
  onDelete,
  onRestoreVersion,
  onRefresh,
}: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showVersions, setShowVersions] = useState(false)

  const handleCreate = () => {
    if (newName.trim()) {
      onCreate(newName.trim())
      setNewName('')
      setIsCreating(false)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <aside className="w-64 h-full bg-slate-50 border-r border-slate-200 flex flex-col">
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-slate-800">Sheets AI</h1>
          <button
            onClick={onRefresh}
            className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {isCreating ? (
          <div className="space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Spreadsheet name"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Create
              </button>
              <button
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 text-sm text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Spreadsheet
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide px-2 py-2">
          Files
        </div>
        {spreadsheets.length === 0 ? (
          <p className="text-sm text-slate-500 px-2 py-4 text-center">
            No spreadsheets yet
          </p>
        ) : (
          <ul className="space-y-1">
            {spreadsheets.map((sheet) => (
              <li key={sheet.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(sheet.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(sheet.id)
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors group cursor-pointer ${
                    currentId === sheet.id
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125" />
                      </svg>
                      <span className="truncate">{sheet.name}</span>
                    </div>
                    {currentId === sheet.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(sheet.id)
                        }}
                        className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {formatDate(sheet.updatedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {currentId && versions.length > 0 && (
        <div className="border-t border-slate-200 p-2">
          <button
            onClick={() => setShowVersions(!showVersions)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Version History
            </span>
            <svg className={`w-4 h-4 transition-transform ${showVersions ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showVersions && (
            <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    onClick={() => onRestoreVersion(version.id)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    {formatDate(version.timestamp)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  )
}
