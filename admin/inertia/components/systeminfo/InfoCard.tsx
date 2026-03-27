import classNames from '~/lib/classNames'

interface InfoCardProps {
  title: string
  icon?: React.ReactNode
  data: Array<{
    label: string
    value: string | number | undefined
  }>
  variant?: 'default' | 'bordered' | 'elevated'
}

export default function InfoCard({ title, icon, data, variant = 'default' }: InfoCardProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'bordered':
        return 'roachnet-card border-2 border-desert-green/40 bg-surface-elevated/95'
      case 'elevated':
        return 'roachnet-card border border-border-default bg-surface-elevated/95 shadow-xl'
      default:
        return 'roachnet-card border border-border-default bg-surface-secondary/90'
    }
  }

  return (
    <div
      className={classNames(
        'overflow-hidden rounded-[1.5rem] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl',
        getVariantStyles()
      )}
    >
      <div className="relative overflow-hidden border-b border-border-default bg-[linear-gradient(135deg,rgba(0,255,0,0.22),rgba(255,0,255,0.14)_60%,rgba(12,13,15,0.92))] px-6 py-4">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `repeating-linear-gradient(
              45deg,
              transparent,
              transparent 10px,
              rgba(255, 255, 255, 0.12) 10px,
              rgba(255, 255, 255, 0.12) 20px
            )`,
          }}
        />

        <div className="relative flex items-center gap-3">
          {icon && <div className="text-desert-green-light opacity-90">{icon}</div>}
          <h3 className="text-lg font-bold uppercase tracking-[0.14em] text-text-primary">{title}</h3>
        </div>
        <div className="absolute top-0 right-0 w-24 h-24 transform translate-x-8 -translate-y-8">
          <div className="h-full w-full rotate-45 bg-desert-orange/20" />
        </div>
      </div>
      <div className="p-6">
        <dl className="grid grid-cols-1 gap-4">
          {data.map((item, index) => (
            <div
              key={index}
              className={classNames(
                'flex items-center justify-between border-b border-border-subtle py-2 last:border-b-0'
              )}
            >
              <dt className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                {item.label}
              </dt>
              <dd className={classNames('text-right text-sm font-semibold text-text-primary')}>
                {item.value || 'N/A'}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="h-1 bg-[linear-gradient(90deg,#00ff00,#ff00ff,#9c6b2f)]" />
    </div>
  )
}
