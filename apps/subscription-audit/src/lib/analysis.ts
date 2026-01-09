import type { SubscriptionCadence, SubscriptionItem } from './types'

const cadenceMap: Record<string, SubscriptionCadence> = {
  month: 'monthly',
  monthly: 'monthly',
  quarter: 'quarterly',
  quarterly: 'quarterly',
  year: 'yearly',
  yearly: 'yearly',
  annual: 'annual',
  weekly: 'weekly',
  daily: 'daily',
}

export function normalizeCadence(value: string | undefined): SubscriptionCadence {
  if (!value) return 'unknown'
  const normalized = value.trim().toLowerCase()
  return cadenceMap[normalized] || 'unknown'
}

export function normalizeSubscription(item: SubscriptionItem): SubscriptionItem {
  const amount = Number(item.amount)
  return {
    ...item,
    name: item.name || 'Unknown subscription',
    amount: Number.isFinite(amount) ? amount : 0,
    cadence: normalizeCadence(item.cadence),
  }
}

export function toMonthly(amount: number, cadence: SubscriptionCadence): number {
  if (!Number.isFinite(amount)) return 0
  switch (cadence) {
    case 'monthly':
      return amount
    case 'quarterly':
      return amount / 3
    case 'yearly':
    case 'annual':
      return amount / 12
    case 'weekly':
      return (amount * 52) / 12
    case 'daily':
      return (amount * 365) / 12
    default:
      return 0
  }
}

export function toAnnual(amount: number, cadence: SubscriptionCadence): number {
  return toMonthly(amount, cadence) * 12
}

export function computeTotals(subscriptions: SubscriptionItem[]) {
  const monthly = subscriptions.reduce(
    (sum, sub) => sum + toMonthly(sub.amount, sub.cadence),
    0
  )
  return {
    monthly,
    quarterly: monthly * 3,
    yearly: monthly * 12,
  }
}

export function pickPrimaryPeriod(recordWindowMonths?: number | null): 'monthly' | 'quarterly' | 'yearly' {
  if (!recordWindowMonths || !Number.isFinite(recordWindowMonths)) return 'monthly'
  if (recordWindowMonths < 3) return 'monthly'
  if (recordWindowMonths < 12) return 'quarterly'
  return 'yearly'
}

export function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}
