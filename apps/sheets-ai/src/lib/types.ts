export interface CellData {
  value: string
  formula?: string
}

export type SheetData = CellData[][]

export interface Spreadsheet {
  id: string
  name: string
  data: SheetData
  createdAt: string
  updatedAt: string
}

export interface SpreadsheetMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Version {
  id: string
  spreadsheetId: string
  timestamp: string
  description?: string
}
