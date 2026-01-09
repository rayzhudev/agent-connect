import pdf from 'pdf-parse'
import { createWorker } from 'tesseract.js'

export type ExtractedFile = {
  name: string
  type: string
  text: string
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

function isText(file: File): boolean {
  return (
    file.type.startsWith('text/') ||
    file.name.toLowerCase().endsWith('.csv') ||
    file.name.toLowerCase().endsWith('.txt')
  )
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const result = await pdf(buffer)
  return result.text || ''
}

async function extractImage(buffer: Buffer): Promise<string> {
  const worker = await createWorker()
  await worker.loadLanguage('eng')
  await worker.initialize('eng')
  const { data } = await worker.recognize(buffer)
  await worker.terminate()
  return data.text || ''
}

async function extractText(buffer: Buffer): Promise<string> {
  return buffer.toString('utf8')
}

export async function extractFiles(files: File[]): Promise<ExtractedFile[]> {
  const results: ExtractedFile[] = []

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer())
    let text = ''

    if (isPdf(file)) {
      text = await extractPdf(buffer)
    } else if (isImage(file)) {
      text = await extractImage(buffer)
    } else if (isText(file)) {
      text = await extractText(buffer)
    } else {
      continue
    }

    results.push({
      name: file.name,
      type: file.type || 'unknown',
      text: text.trim(),
    })
  }

  return results
}
