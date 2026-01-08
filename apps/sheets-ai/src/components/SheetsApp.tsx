'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import SpreadsheetGrid from '@/components/SpreadsheetGrid'
import AIPanel from '@/components/AIPanel'
import AgentConnectButton from '@/components/AgentConnectButton'
import type { Spreadsheet, SpreadsheetMeta, SheetData, Version } from '@/lib/types'

type HistoryEntry = {
  data: SheetData
  timestamp: number
}

interface SheetsAppProps {
  initialSpreadsheets: SpreadsheetMeta[]
  initialSpreadsheet: Spreadsheet | null
  initialVersions: Version[]
}

export default function SheetsApp({
  initialSpreadsheets,
  initialSpreadsheet,
  initialVersions,
}: SheetsAppProps) {
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetMeta[]>(initialSpreadsheets)
  const [currentSpreadsheet, setCurrentSpreadsheet] = useState<Spreadsheet | null>(
    initialSpreadsheet
  )
  const [versions, setVersions] = useState<Version[]>(initialVersions)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>('default')
  const [isAgentConnected, setIsAgentConnected] = useState(false)

  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const fetchSpreadsheets = useCallback(async () => {
    try {
      const res = await fetch('/api/spreadsheets')
      const data = await res.json()
      setSpreadsheets(data)
    } catch (err) {
      console.error('Failed to fetch spreadsheets:', err)
    }
  }, [])

  const fetchVersions = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/spreadsheets/${encodeURIComponent(id)}/versions`)
      const data = await res.json()
      setVersions(data)
    } catch (err) {
      console.error('Failed to fetch versions:', err)
      setVersions([])
    }
  }, [])

  const loadSpreadsheet = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/spreadsheets/${encodeURIComponent(id)}`)
      const data = await res.json()
      setCurrentSpreadsheet(data)
      historyRef.current = [{ data: data.data, timestamp: Date.now() }]
      historyIndexRef.current = 0
      fetchVersions(id)
    } catch (err) {
      console.error('Failed to load spreadsheet:', err)
    }
  }, [fetchVersions])

  const saveSpreadsheet = useCallback(async (spreadsheet: Spreadsheet) => {
    setIsSaving(true)
    try {
      await fetch(`/api/spreadsheets/${encodeURIComponent(spreadsheet.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: spreadsheet.name,
          data: spreadsheet.data,
        }),
      })
      setLastSaved(new Date())
      fetchVersions(spreadsheet.id)
    } catch (err) {
      console.error('Failed to save spreadsheet:', err)
    } finally {
      setIsSaving(false)
    }
  }, [fetchVersions])

  const debouncedSave = useCallback((spreadsheet: Spreadsheet) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveSpreadsheet(spreadsheet)
    }, 1500)
  }, [saveSpreadsheet])

  useEffect(() => {
    if (historyIndexRef.current !== -1 || !currentSpreadsheet) return
    historyRef.current = [{ data: currentSpreadsheet.data, timestamp: Date.now() }]
    historyIndexRef.current = 0
  }, [currentSpreadsheet])

  const handleDataChange = useCallback((newData: SheetData) => {
    if (!currentSpreadsheet) return

    const newEntry: HistoryEntry = { data: newData, timestamp: Date.now() }
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
    newHistory.push(newEntry)
    if (newHistory.length > 50) newHistory.shift()
    historyRef.current = newHistory
    historyIndexRef.current = newHistory.length - 1

    const updated = { ...currentSpreadsheet, data: newData }
    setCurrentSpreadsheet(updated)
    debouncedSave(updated)
  }, [currentSpreadsheet, debouncedSave])

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--
      const entry = historyRef.current[historyIndexRef.current]
      if (currentSpreadsheet && entry) {
        setCurrentSpreadsheet({ ...currentSpreadsheet, data: entry.data })
      }
    }
  }, [currentSpreadsheet])

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++
      const entry = historyRef.current[historyIndexRef.current]
      if (currentSpreadsheet && entry) {
        setCurrentSpreadsheet({ ...currentSpreadsheet, data: entry.data })
      }
    }
  }, [currentSpreadsheet])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  const handleCreate = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/spreadsheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      await fetchSpreadsheets()
      loadSpreadsheet(data.id)
    } catch (err) {
      console.error('Failed to create spreadsheet:', err)
    }
  }, [fetchSpreadsheets, loadSpreadsheet])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to delete this spreadsheet?')) return
    try {
      await fetch(`/api/spreadsheets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (currentSpreadsheet?.id === id) {
        setCurrentSpreadsheet(null)
        setVersions([])
      }
      fetchSpreadsheets()
    } catch (err) {
      console.error('Failed to delete spreadsheet:', err)
    }
  }, [currentSpreadsheet, fetchSpreadsheets])

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    if (!currentSpreadsheet) return
    try {
      const res = await fetch(
        `/api/spreadsheets/${encodeURIComponent(currentSpreadsheet.id)}/versions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId }),
        }
      )
      const data = await res.json()
      setCurrentSpreadsheet(data)
      fetchVersions(data.id)
    } catch (err) {
      console.error('Failed to restore version:', err)
    }
  }, [currentSpreadsheet, fetchVersions])

  return (
    <div className="h-screen flex">
      <Sidebar
        spreadsheets={spreadsheets}
        currentId={currentSpreadsheet?.id || null}
        versions={versions}
        onSelect={loadSpreadsheet}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRestoreVersion={handleRestoreVersion}
        onRefresh={fetchSpreadsheets}
      />

      <main className="flex-1 flex flex-col min-w-0">
        {currentSpreadsheet ? (
          <>
            <header className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  {currentSpreadsheet.name}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isSaving ? (
                    'Saving...'
                  ) : lastSaved ? (
                    `Last saved ${lastSaved.toLocaleTimeString()}`
                  ) : (
                    'Not saved yet'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleUndo}
                    disabled={historyIndexRef.current <= 0}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Undo (Cmd+Z)"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                  </button>
                  <button
                    onClick={handleRedo}
                    disabled={historyIndexRef.current >= historyRef.current.length - 1}
                    className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Redo (Cmd+Shift+Z)"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
                    </svg>
                  </button>
                </div>
                <div className="h-6 w-px bg-slate-200" />
                <AgentConnectButton
                  onConnected={(detail) => {
                    setIsAgentConnected(true)
                    if (detail.model) setSelectedModel(detail.model)
                  }}
                  onSelectionChanged={(detail) => {
                    if (detail.model) setSelectedModel(detail.model)
                  }}
                  onDisconnected={() => {
                    setIsAgentConnected(false)
                  }}
                />
              </div>
            </header>

            <div className="flex-1 flex min-h-0">
              <div className="flex-1 p-4 overflow-hidden">
                <SpreadsheetGrid
                  data={currentSpreadsheet.data}
                  onChange={handleDataChange}
                  onSelectionChange={setSelectedCell}
                />
              </div>

              <div className="w-80 border-l border-slate-200 p-4">
                <AIPanel
                  spreadsheetData={currentSpreadsheet.data}
                  selectedCell={selectedCell}
                  selectedModel={selectedModel}
                  isAgentConnected={isAgentConnected}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-50">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-200 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125" />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-slate-700 mb-2">No spreadsheet selected</h2>
              <p className="text-sm text-slate-500">
                Create a new spreadsheet or select one from the sidebar
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
