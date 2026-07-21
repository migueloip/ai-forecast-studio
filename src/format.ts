export function formatPercent(
  value: number | null | undefined,
  options: { digits?: 0 | 1; sign?: boolean; unavailable?: string } = {},
) {
  if (value === null || value === undefined || !Number.isFinite(value)) return options.unavailable ?? '—'
  const digits = options.digits ?? 1
  const magnitude = Math.abs(value).toFixed(digits)
  const prefix = value < 0 ? '−' : options.sign === false || value === 0 ? '' : '+'
  return `${prefix}${magnitude}%`
}

export function metricChangeSentence(metric: string, value: number | null | undefined, missingReason = 'required data is missing') {
  if (value === null || value === undefined || !Number.isFinite(value)) return `${metric} impact is unavailable because ${missingReason}.`
  if (Math.abs(value) < 0.05) return `${metric} is projected to remain stable.`
  const direction = value > 0 ? 'increase' : 'decrease'
  return `${metric} is projected to ${direction} by ${formatPercent(Math.abs(value), { sign: false })}.`
}

export function frequencyLabel(frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'irregular', periods: number) {
  const labels = {
    daily: ['day', 'daily periods'],
    weekly: ['week', 'weekly periods'],
    monthly: ['month', 'monthly periods'],
    quarterly: ['quarter', 'quarterly periods'],
    irregular: ['period', 'irregular periods'],
  } as const
  const [singular, plural] = labels[frequency]
  return periods === 1 ? `1 ${singular}` : `${periods} ${plural}`
}
