import classNames from '~/lib/classNames'

interface HorizontalBarChartProps {
  items: Array<{
    label: string
    value: number // percentage
    total: string
    used: string
    type?: string
  }>
  statuses?: Array<{
    label: string
    min_threshold: number
    color_class: string
  }>
  progressiveBarColor?: boolean
}

export default function HorizontalBarChart({
  items,
  statuses,
  progressiveBarColor = false,
}: HorizontalBarChartProps) {
  const sortedStatus = statuses?.sort((a, b) => b.min_threshold - a.min_threshold) || []

  const getBarColor = (value: number) => {
    if (!progressiveBarColor) return 'bg-desert-green'
    if (value >= 90) return 'bg-desert-red'
    if (value >= 75) return 'bg-desert-orange'
    if (value >= 50) return 'bg-desert-tan'
    return 'bg-desert-olive'
  }

  const getGlowColor = (value: number) => {
    if (value >= 90) return 'shadow-desert-red/50'
    if (value >= 75) return 'shadow-desert-orange/50'
    if (value >= 50) return 'shadow-desert-tan/50'
    return 'shadow-desert-olive/50'
  }

  const getStatusLabel = (value: number) => {
    if (sortedStatus.length === 0) return ''
    for (const status of sortedStatus) {
      if (value >= status.min_threshold) {
        return status.label
      }
    }
    return ''
  }

  const getStatusColor = (value: number) => {
    if (sortedStatus.length === 0) return ''
    for (const status of sortedStatus) {
      if (value >= status.min_threshold) {
        return status.color_class
      }
    }
    return ''
  }

  return (
    <div className="space-y-6">
      {items.map((item, index) => (
        <div key={index} className="space-y-2">
          <div className="flex justify-between items-baseline">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-desert-green-light">{item.label}</span>
              {item.type && (
                <span className="rounded-full border border-border-subtle bg-surface-secondary/90 px-2 py-0.5 font-mono text-xs text-text-secondary">
                  {item.type}
                </span>
              )}
            </div>
            <div className="font-mono text-sm text-text-secondary">
              {item.used} / {item.total}
            </div>
          </div>
          <div className="relative">
            <div className="h-8 overflow-hidden rounded-lg border border-border-subtle bg-surface-secondary/80">
              <div
                className={classNames(
                  'h-full rounded-lg transition-all duration-1000 ease-out relative overflow-hidden',
                  getBarColor(item.value),
                  'shadow-lg',
                  getGlowColor(item.value)
                )}
                style={{
                  width: `${item.value}%`,
                  animationDelay: `${index * 100}ms`,
                }}
              ></div>
            </div>
            <div
              className={classNames(
                'absolute top-1/2 -translate-y-1/2 font-bold text-sm',
                item.value > 15
                  ? 'left-3 text-white drop-shadow-md'
                  : 'right-3 text-desert-green-light'
              )}
            >
              {Math.round(item.value)}%
            </div>
          </div>
          {getStatusLabel(item.value) && (
            <div className="flex items-center gap-2">
              <div
                className={classNames(
                  'w-2 h-2 rounded-full animate-pulse',
                  getStatusColor(item.value)
                )}
              />
              <span className="text-xs text-text-secondary">{getStatusLabel(item.value)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
