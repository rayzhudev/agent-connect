import fs from 'fs/promises'
import path from 'path'
import * as XLSX from 'xlsx'
import type { Spreadsheet, SpreadsheetMeta, SheetData, Version } from './types'

const SPREADSHEETS_DIR = path.join(process.cwd(), 'spreadsheets')
const VERSIONS_DIR = path.join(process.cwd(), 'spreadsheets', '.versions')

async function ensureDirectories() {
  await fs.mkdir(SPREADSHEETS_DIR, { recursive: true })
  await fs.mkdir(VERSIONS_DIR, { recursive: true })
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseFilename(filename: string): { id: string; name: string } | null {
  const match = filename.match(/^(.+)\.(csv|xlsx?)$/i)
  if (!match) return null
  return { id: filename, name: match[1] }
}

export async function listSpreadsheets(): Promise<SpreadsheetMeta[]> {
  await ensureDirectories()
  const files = await fs.readdir(SPREADSHEETS_DIR)
  const spreadsheets: SpreadsheetMeta[] = []

  for (const file of files) {
    if (file.startsWith('.')) continue
    const parsed = parseFilename(file)
    if (!parsed) continue

    const filePath = path.join(SPREADSHEETS_DIR, file)
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) continue

    spreadsheets.push({
      id: parsed.id,
      name: parsed.name,
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    })
  }

  return spreadsheets.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export async function readSpreadsheet(id: string): Promise<Spreadsheet> {
  await ensureDirectories()
  const filePath = path.join(SPREADSHEETS_DIR, id)
  const buffer = await fs.readFile(filePath)
  const stats = await fs.stat(filePath)

  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  const jsonData: string[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
  })

  const data: SheetData = jsonData.map(row =>
    row.map(cell => ({ value: String(cell ?? '') }))
  )

  const minRows = 50
  const minCols = 26
  while (data.length < minRows) {
    data.push([])
  }
  for (const row of data) {
    while (row.length < minCols) {
      row.push({ value: '' })
    }
  }

  const parsed = parseFilename(id)

  return {
    id,
    name: parsed?.name || id,
    data,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  }
}

export async function writeSpreadsheet(
  id: string | null,
  name: string,
  data: SheetData,
  saveVersion = true
): Promise<Spreadsheet> {
  await ensureDirectories()

  const filename = `${name}.csv`
  const filePath = path.join(SPREADSHEETS_DIR, filename)

  if (saveVersion && id) {
    try {
      await saveVersionSnapshot(id)
    } catch {
      // Ignore if original doesn't exist
    }
  }

  const plainData = data.map(row => row.map(cell => cell.value))
  const worksheet = XLSX.utils.aoa_to_sheet(plainData)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'csv' })
  await fs.writeFile(filePath, buffer)

  const stats = await fs.stat(filePath)

  return {
    id: filename,
    name,
    data,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  }
}

export async function deleteSpreadsheet(id: string): Promise<void> {
  const filePath = path.join(SPREADSHEETS_DIR, id)
  await fs.unlink(filePath)
}

export async function createEmptySpreadsheet(name: string): Promise<Spreadsheet> {
  const rows = 50
  const cols = 26
  const data: SheetData = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ value: '' }))
  )
  return writeSpreadsheet(null, name, data, false)
}

async function saveVersionSnapshot(id: string): Promise<Version> {
  const sourcePath = path.join(SPREADSHEETS_DIR, id)
  const versionId = generateId()
  const versionPath = path.join(VERSIONS_DIR, `${id}.${versionId}`)

  await fs.copyFile(sourcePath, versionPath)

  return {
    id: versionId,
    spreadsheetId: id,
    timestamp: new Date().toISOString(),
  }
}

export async function listVersions(spreadsheetId: string): Promise<Version[]> {
  await ensureDirectories()
  const files = await fs.readdir(VERSIONS_DIR)
  const versions: Version[] = []

  const prefix = `${spreadsheetId}.`
  for (const file of files) {
    if (!file.startsWith(prefix)) continue
    const versionId = file.slice(prefix.length)
    const filePath = path.join(VERSIONS_DIR, file)
    const stats = await fs.stat(filePath)

    versions.push({
      id: versionId,
      spreadsheetId,
      timestamp: stats.mtime.toISOString(),
    })
  }

  return versions.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
}

export async function restoreVersion(
  spreadsheetId: string,
  versionId: string
): Promise<Spreadsheet> {
  const versionPath = path.join(VERSIONS_DIR, `${spreadsheetId}.${versionId}`)
  const targetPath = path.join(SPREADSHEETS_DIR, spreadsheetId)

  await saveVersionSnapshot(spreadsheetId)
  await fs.copyFile(versionPath, targetPath)

  return readSpreadsheet(spreadsheetId)
}
