import SheetsApp from '@/components/SheetsApp';
import { listSpreadsheets, readSpreadsheet, listVersions } from '@/lib/spreadsheet';

export default async function Home() {
  const spreadsheets = await listSpreadsheets();
  const first = spreadsheets[0];
  const initialSpreadsheet = first ? await readSpreadsheet(first.id) : null;
  const initialVersions = first ? await listVersions(first.id) : [];

  return (
    <SheetsApp
      initialSpreadsheets={spreadsheets}
      initialSpreadsheet={initialSpreadsheet}
      initialVersions={initialVersions}
    />
  );
}
