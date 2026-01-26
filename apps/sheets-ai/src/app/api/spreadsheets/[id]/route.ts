import { NextResponse } from 'next/server';
import { readSpreadsheet, writeSpreadsheet, deleteSpreadsheet } from '@/lib/spreadsheet';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const spreadsheet = await readSpreadsheet(id);
    return NextResponse.json(spreadsheet);
  } catch (error) {
    console.error('Failed to read spreadsheet:', error);
    return NextResponse.json({ error: 'Spreadsheet not found' }, { status: 404 });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { name, data } = await request.json();
    const spreadsheet = await writeSpreadsheet(id, name, data);
    return NextResponse.json(spreadsheet);
  } catch (error) {
    console.error('Failed to update spreadsheet:', error);
    return NextResponse.json({ error: 'Failed to update spreadsheet' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    await deleteSpreadsheet(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete spreadsheet:', error);
    return NextResponse.json({ error: 'Failed to delete spreadsheet' }, { status: 500 });
  }
}
