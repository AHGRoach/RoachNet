import clsx from 'clsx'

type RoachNetBrandProps = {
  size?: 'sm' | 'md' | 'lg'
  subtitle?: string
  align?: 'left' | 'center'
  className?: string
}

const sizeClasses = {
  sm: {
    mark: 'h-11 w-11',
    title: 'text-lg',
    subtitle: 'text-[0.65rem]',
    gap: 'gap-3',
  },
  md: {
    mark: 'h-16 w-16',
    title: 'text-2xl',
    subtitle: 'text-[0.72rem]',
    gap: 'gap-4',
  },
  lg: {
    mark: 'h-24 w-24',
    title: 'text-4xl md:text-5xl',
    subtitle: 'text-xs md:text-sm',
    gap: 'gap-5',
  },
}

export default function RoachNetBrand({
  size = 'md',
  subtitle,
  align = 'left',
  className,
}: RoachNetBrandProps) {
  const config = sizeClasses[size]

  return (
    <div
      className={clsx(
        'flex items-center',
        config.gap,
        align === 'center' ? 'justify-center text-center' : 'justify-start text-left',
        className
      )}
    >
      <img src="/roachnet-mark.svg" alt="RoachNet mark" className={clsx(config.mark, 'shrink-0')} />
      <div className="min-w-0">
        <div className={clsx('roachnet-wordmark leading-none', config.title)}>RoachNet</div>
        {subtitle && (
          <div className={clsx('roachnet-kicker mt-2 text-text-secondary', config.subtitle)}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  )
}
