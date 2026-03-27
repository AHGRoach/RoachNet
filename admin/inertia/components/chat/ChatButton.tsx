import { IconMessages } from '@tabler/icons-react'

interface ChatButtonProps {
  onClick: () => void
}

export default function ChatButton({ onClick }: ChatButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 rounded-[1.35rem] border border-border-default bg-surface-primary/95 p-4 text-desert-green-light shadow-[0_18px_42px_rgba(0,0,0,0.35)] transition-all duration-200 hover:scale-105 hover:text-desert-orange-light focus:outline-none focus:ring-2 focus:ring-desert-green focus:ring-offset-2 cursor-pointer"
      aria-label="Open chat"
    >
      <IconMessages className="h-6 w-6" />
    </button>
  )
}
