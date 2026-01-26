import { NextResponse } from 'next/server';
import { AgentConnect } from '@agentconnect/sdk';
import { ensureAgentConnectHost } from '@/lib/agentconnect-host';
import { extractFiles } from '@/lib/file-extract';
import type { AnalysisResult } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_CHARS = 18000;

function trimText(text: string, maxChars = MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[trimmed]';
}

function buildPrompt(payload: string) {
  return [
    'You are a subscription auditor.',
    'Extract recurring subscriptions, estimate their cadence, and highlight savings opportunities.',
    'Return JSON only with this schema:',
    '{"recordWindowMonths":number|null,"summary":string,"insights":string[],"subscriptions":[{"name":string,"amount":number,"cadence":"monthly|quarterly|yearly|annual|weekly|daily|unknown","notes":string,"recommendation":"keep|review|cancel","confidence":number}]}',
    'If amounts are unclear, estimate and set confidence lower.',
    'Only include subscriptions that look recurring.',
    'JSON only. No markdown, no extra text.',
    '',
    payload,
  ].join('\n');
}

function extractJson(text: string): AnalysisResult | null {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeResult(result: AnalysisResult | null): AnalysisResult {
  if (!result) {
    return { subscriptions: [], summary: 'No subscriptions found.' };
  }
  return {
    recordWindowMonths: result.recordWindowMonths ?? null,
    summary: result.summary || 'Subscription summary ready.',
    insights: Array.isArray(result.insights) ? result.insights : [],
    subscriptions: Array.isArray(result.subscriptions) ? result.subscriptions : [],
    currency: result.currency || 'USD',
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const model =
    typeof formData.get('model') === 'string' ? String(formData.get('model')) : 'default';
  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
  }

  const extracted = await extractFiles(files);
  const payload = extracted
    .map((file) => `File: ${file.name}\n${file.text}`)
    .filter((entry) => entry.trim().length > 0)
    .join('\n\n');

  if (!payload.trim()) {
    return NextResponse.json({ error: 'Unable to extract text from files.' }, { status: 400 });
  }

  await ensureAgentConnectHost();
  const client = await AgentConnect.connect();
  const session = await client.sessions.create({ model });

  let finalText = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const offFinal = session.on('final', (event) => {
        finalText = event.text || '';
        offFinal();
        offError();
        resolve();
      });
      const offError = session.on('error', (event) => {
        offFinal();
        offError();
        reject(new Error(event.message || 'Agent error'));
      });
      session.send(buildPrompt(trimText(payload))).catch(reject);
    });
  } finally {
    await session.close().catch(() => {});
  }

  const parsed = extractJson(finalText);
  const normalized = normalizeResult(parsed);
  return NextResponse.json({
    ...normalized,
    rawResponse: finalText,
  });
}
