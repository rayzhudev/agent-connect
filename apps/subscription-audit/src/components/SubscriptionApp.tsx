'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import AgentConnectButton from '@/components/AgentConnectButton'
import { computeTotals, formatCurrency, normalizeSubscription, toAnnual, toMonthly } from '@/lib/analysis'
import type { AnalysisResult, SubscriptionItem } from '@/lib/types'

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
]

type NormalizedSubscription = SubscriptionItem & {
  annualCost: number
  monthlyCost: number
}

export default function SubscriptionApp() {
  const [files, setFiles] = useState<File[]>([])
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [selectedModel, setSelectedModel] = useState('default')
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback((incoming: FileList | File[]) => {
    const next = Array.from(incoming).filter((file) => {
      return ACCEPTED_TYPES.includes(file.type) || file.name.toLowerCase().endsWith('.pdf')
    })
    setFiles((prev) => [...prev, ...next])
  }, [])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (event.dataTransfer.files.length) {
      handleFiles(event.dataTransfer.files)
    }
  }, [handleFiles])

  const handleAnalyze = useCallback(async () => {
    if (!files.length || isLoading) return
    setError(null)
    setIsLoading(true)

    try {
      const formData = new FormData()
      files.forEach((file) => formData.append('files', file))
      formData.append('model', selectedModel)

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Analysis failed')
      }

      const data = await response.json()
      setAnalysis(data)
    } catch (err: any) {
      setError(err?.message || 'Analysis failed')
    } finally {
      setIsLoading(false)
    }
  }, [files, isLoading, selectedModel])

  const handleReset = useCallback(() => {
    setFiles([])
    setAnalysis(null)
    setError(null)
  }, [])

  const normalized = useMemo(() => {
    const subscriptions = (analysis?.subscriptions || []).map(normalizeSubscription)
    const withCosts: NormalizedSubscription[] = subscriptions.map((sub) => ({
      ...sub,
      annualCost: toAnnual(sub.amount, sub.cadence),
      monthlyCost: toMonthly(sub.amount, sub.cadence),
    }))
    const totals = computeTotals(subscriptions)
    const currency = analysis?.currency || 'USD'
    const sorted = withCosts.sort((a, b) => b.annualCost - a.annualCost)

    const potentialSavings = sorted
      .filter((sub) => sub.recommendation === 'cancel' || sub.recommendation === 'review')
      .reduce((sum, sub) => sum + sub.annualCost, 0)

    return {
      subscriptions: sorted,
      totals,
      currency,
      potentialSavings,
      cancelCount: sorted.filter((s) => s.recommendation === 'cancel').length,
      reviewCount: sorted.filter((s) => s.recommendation === 'review').length,
    }
  }, [analysis])

  const hasResults = analysis !== null

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-neutral-900">Subscription Audit</span>
          </div>
          <div className="flex items-center gap-4">
            <AgentConnectButton
              onConnected={(detail) => {
                setIsConnected(true)
                if (detail.model) setSelectedModel(detail.model)
              }}
              onSelectionChanged={(detail) => {
                if (detail.model) setSelectedModel(detail.model)
              }}
              onDisconnected={() => setIsConnected(false)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        {!hasResults ? (
          /* Upload State */
          <div className="flex flex-col items-center">
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
                Find subscriptions you can cancel
              </h1>
              <p className="mt-3 text-neutral-500">
                Upload bank statements or receipts. Analysis happens locally on your device.
              </p>
            </div>

            <div
              className={`w-full max-w-xl rounded-xl border-2 border-dashed transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-neutral-300 bg-white hover:border-neutral-400'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center px-8 py-16">
                <div className={`mb-4 rounded-full p-3 ${isDragging ? 'bg-blue-100' : 'bg-neutral-100'}`}>
                  <svg className={`h-6 w-6 ${isDragging ? 'text-blue-600' : 'text-neutral-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <p className="mb-1 text-sm font-medium text-neutral-900">
                  {isDragging ? 'Drop files here' : 'Drop files here or click to browse'}
                </p>
                <p className="mb-6 text-xs text-neutral-500">
                  PDF, PNG, JPG, or CSV files
                </p>
                <button
                  type="button"
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
                  onClick={() => inputRef.current?.click()}
                >
                  Select files
                </button>
              </div>
            </div>

            {files.length > 0 && (
              <div className="mt-6 w-full max-w-xl">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-700">
                    {files.length} file{files.length !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    type="button"
                    className="text-xs text-neutral-500 hover:text-neutral-700"
                    onClick={() => setFiles([])}
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-2">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-neutral-100">
                          <svg className="h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                        </div>
                        <span className="text-sm text-neutral-700">{file.name}</span>
                      </div>
                      <button
                        type="button"
                        className="text-neutral-400 hover:text-neutral-600"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== index))}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={isLoading}
                  className="mt-6 w-full rounded-lg bg-neutral-900 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleAnalyze}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Analyzing...
                    </span>
                  ) : (
                    'Analyze subscriptions'
                  )}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-6 w-full max-w-xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files)
              }}
            />
          </div>
        ) : (
          /* Results State */
          <div>
            {/* Hero Stats */}
            <div className="mb-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-8 text-white shadow-lg">
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="mb-1 text-sm font-medium text-emerald-100">Potential annual savings</p>
                  <p className="text-5xl font-bold tracking-tight">
                    {formatCurrency(normalized.potentialSavings, normalized.currency)}
                  </p>
                  {(normalized.cancelCount > 0 || normalized.reviewCount > 0) && (
                    <p className="mt-2 text-sm text-emerald-100">
                      {normalized.cancelCount > 0 && `${normalized.cancelCount} to cancel`}
                      {normalized.cancelCount > 0 && normalized.reviewCount > 0 && ' · '}
                      {normalized.reviewCount > 0 && `${normalized.reviewCount} to review`}
                    </p>
                  )}
                </div>
                <div className="flex gap-8">
                  <div>
                    <p className="text-sm text-emerald-100">Monthly spend</p>
                    <p className="text-2xl font-semibold">{formatCurrency(normalized.totals.monthly, normalized.currency)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-emerald-100">Annual spend</p>
                    <p className="text-2xl font-semibold">{formatCurrency(normalized.totals.yearly, normalized.currency)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-emerald-100">Subscriptions</p>
                    <p className="text-2xl font-semibold">{normalized.subscriptions.length}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            {analysis?.summary && (
              <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-6">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Summary</h2>
                <p className="text-neutral-700">{analysis.summary}</p>
                {analysis.insights && analysis.insights.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {analysis.insights.map((insight, index) => (
                      <span key={index} className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600">
                        {insight}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Subscription List */}
            <div className="rounded-xl border border-neutral-200 bg-white">
              <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
                <h2 className="font-semibold text-neutral-900">All Subscriptions</h2>
                <button
                  type="button"
                  className="text-sm text-neutral-500 hover:text-neutral-700"
                  onClick={handleReset}
                >
                  Start over
                </button>
              </div>
              <div className="divide-y divide-neutral-100">
                {normalized.subscriptions.length === 0 ? (
                  <div className="px-6 py-12 text-center text-neutral-500">
                    No subscriptions found in your documents.
                  </div>
                ) : (
                  normalized.subscriptions.map((sub, index) => (
                    <SubscriptionRow
                      key={`${sub.name}-${index}`}
                      subscription={sub}
                      currency={normalized.currency}
                    />
                  ))
                )}
              </div>
            </div>

            {error && (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function SubscriptionRow({ subscription, currency }: { subscription: NormalizedSubscription; currency: string }) {
  const status = subscription.recommendation || 'keep'

  const statusConfig = {
    keep: {
      bg: 'bg-neutral-100',
      text: 'text-neutral-600',
      label: 'Keep',
    },
    review: {
      bg: 'bg-amber-100',
      text: 'text-amber-700',
      label: 'Review',
    },
    cancel: {
      bg: 'bg-red-100',
      text: 'text-red-700',
      label: 'Cancel',
    },
  }

  const config = statusConfig[status]

  return (
    <div className="flex items-center justify-between px-6 py-4 hover:bg-neutral-50">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
          <span className="text-sm font-semibold text-neutral-600">
            {subscription.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div>
          <p className="font-medium text-neutral-900">{subscription.name}</p>
          <p className="text-sm text-neutral-500">
            {formatCurrency(subscription.amount, currency)} / {subscription.cadence}
            {subscription.notes && <span className="ml-2 text-neutral-400">· {subscription.notes}</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className="font-semibold text-neutral-900">{formatCurrency(subscription.annualCost, currency)}</p>
          <p className="text-xs text-neutral-500">per year</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${config.bg} ${config.text}`}>
          {config.label}
        </span>
      </div>
    </div>
  )
}
