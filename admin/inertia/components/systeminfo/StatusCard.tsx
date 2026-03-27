export type StatusCardProps = {
  title: string
  value: string | number
}

export default function StatusCard({ title, value }: StatusCardProps) {
  return (
    <div className="roachnet-card rounded-[1.35rem] border border-border-default p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium uppercase tracking-[0.16em] text-text-secondary">{title}</span>
        <div className="h-2 w-2 animate-pulse rounded-full bg-desert-green-light" />
      </div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
    </div>
  )
}
