'use client'

import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import type { SheetData, CellData } from '@/lib/types'

interface SpreadsheetGridProps {
  data: SheetData
  onChange: (data: SheetData) => void
  onSelectionChange?: (selection: { row: number; col: number } | null) => void
}

function getColumnLabel(index: number): string {
  let label = ''
  let n = index
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

export default function SpreadsheetGrid({
  data,
  onChange,
  onSelectionChange,
}: SpreadsheetGridProps) {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const numRows = data.length
  const numCols = data[0]?.length || 26

  useEffect(() => {
    onSelectionChange?.(selectedCell)
  }, [selectedCell, onSelectionChange])

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus()
    }
  }, [editingCell])

  const handleCellClick = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col })
    setEditingCell(null)
  }, [])

  const handleCellDoubleClick = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col })
    setEditingCell({ row, col })
    setEditValue(data[row]?.[col]?.value || '')
  }, [data])

  const commitEdit = useCallback(() => {
    if (!editingCell) return

    const { row, col } = editingCell
    const newData = data.map((r, ri) =>
      r.map((c, ci) =>
        ri === row && ci === col ? { ...c, value: editValue } : c
      )
    )
    onChange(newData)
    setEditingCell(null)
  }, [editingCell, editValue, data, onChange])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!selectedCell) return

    const { row, col } = selectedCell

    if (editingCell) {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitEdit()
        setSelectedCell({ row: Math.min(row + 1, numRows - 1), col })
      } else if (e.key === 'Escape') {
        setEditingCell(null)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        commitEdit()
        setSelectedCell({ row, col: Math.min(col + 1, numCols - 1) })
      }
      return
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        setSelectedCell({ row: Math.max(row - 1, 0), col })
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedCell({ row: Math.min(row + 1, numRows - 1), col })
        break
      case 'ArrowLeft':
        e.preventDefault()
        setSelectedCell({ row, col: Math.max(col - 1, 0) })
        break
      case 'ArrowRight':
        e.preventDefault()
        setSelectedCell({ row, col: Math.min(col + 1, numCols - 1) })
        break
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) {
          setSelectedCell({ row, col: Math.max(col - 1, 0) })
        } else {
          setSelectedCell({ row, col: Math.min(col + 1, numCols - 1) })
        }
        break
      case 'Enter':
        e.preventDefault()
        setEditingCell({ row, col })
        setEditValue(data[row]?.[col]?.value || '')
        break
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        const newData = data.map((r, ri) =>
          r.map((c, ci) =>
            ri === row && ci === col ? { ...c, value: '' } : c
          )
        )
        onChange(newData)
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          setEditingCell({ row, col })
          setEditValue(e.key)
        }
    }
  }, [selectedCell, editingCell, data, onChange, commitEdit, numRows, numCols])

  return (
    <div
      ref={gridRef}
      className="overflow-auto border border-slate-200 rounded-lg bg-white focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <table className="border-collapse w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="w-12 min-w-[48px] h-8 bg-slate-100 border-b border-r border-slate-200 text-slate-500 font-medium text-xs" />
            {Array.from({ length: numCols }, (_, i) => (
              <th
                key={i}
                className="min-w-[100px] h-8 bg-slate-100 border-b border-r border-slate-200 text-slate-600 font-medium text-xs"
              >
                {getColumnLabel(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="w-12 min-w-[48px] h-8 bg-slate-50 border-b border-r border-slate-200 text-center text-slate-500 font-medium text-xs sticky left-0 z-[5]">
                {rowIndex + 1}
              </td>
              {row.map((cell, colIndex) => {
                const isSelected =
                  selectedCell?.row === rowIndex && selectedCell?.col === colIndex
                const isEditing =
                  editingCell?.row === rowIndex && editingCell?.col === colIndex

                return (
                  <td
                    key={colIndex}
                    className={`
                      min-w-[100px] h-8 border-b border-r border-slate-200 p-0
                      cursor-cell transition-colors duration-75
                      ${isSelected ? 'ring-2 ring-blue-500 ring-inset bg-blue-50' : 'hover:bg-slate-50'}
                    `}
                    onClick={() => handleCellClick(rowIndex, colIndex)}
                    onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
                  >
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        className="w-full h-full px-2 border-none outline-none bg-white text-sm"
                      />
                    ) : (
                      <div className="px-2 py-1 truncate text-slate-800">
                        {cell.value}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
