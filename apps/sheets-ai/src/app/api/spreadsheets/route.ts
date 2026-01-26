import { NextResponse } from 'next/server';
import { listSpreadsheets, createEmptySpreadsheet } from '@/lib/spreadsheet';

export async function GET() {
  try {
    const spreadsheets = await listSpreadsheets();
    return NextResponse.json(spreadsheets);
  } catch (error) {
    console.error('Failed to list spreadsheets:', error);
    return NextResponse.json({ error: 'Failed to list spreadsheets' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name } = await request.json();
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    const spreadsheet = await createEmptySpreadsheet(name);
    return NextResponse.json(spreadsheet);
  } catch (error) {
    console.error('Failed to create spreadsheet:', error);
    return NextResponse.json({ error: 'Failed to create spreadsheet' }, { status: 500 });
  }
}
