import { NextResponse } from 'next/server'
import { listVersions, restoreVersion } from '@/lib/spreadsheet'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const versions = await listVersions(id)
    return NextResponse.json(versions)
  } catch (error) {
    console.error('Failed to list versions:', error)
    return NextResponse.json(
      { error: 'Failed to list versions' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const { versionId } = await request.json()
    if (!versionId) {
      return NextResponse.json(
        { error: 'Version ID is required' },
        { status: 400 }
      )
    }
    const spreadsheet = await restoreVersion(id, versionId)
    return NextResponse.json(spreadsheet)
  } catch (error) {
    console.error('Failed to restore version:', error)
    return NextResponse.json(
      { error: 'Failed to restore version' },
      { status: 500 }
    )
  }
}
