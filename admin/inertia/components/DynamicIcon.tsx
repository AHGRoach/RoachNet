import classNames from 'classnames'
import type { IconProps } from '@tabler/icons-react'
import type { ComponentType, FC } from 'react'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowUp,
  IconBooks,
  IconBrain,
  IconCheck,
  IconChefHat,
  IconCircleCheck,
  IconCloudDownload,
  IconCloudUpload,
  IconCode,
  IconCpu,
  IconDatabase,
  IconDeviceFloppy,
  IconDownload,
  IconEraser,
  IconExternalLink,
  IconHome,
  IconInfoCircle,
  IconLogs,
  IconMap,
  IconNotes,
  IconPlant,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconRefreshAlert,
  IconReload,
  IconRobot,
  IconSchool,
  IconSearch,
  IconShieldCheck,
  IconSettings,
  IconStethoscope,
  IconTool,
  IconTrash,
  IconUpload,
  IconWand,
  IconXboxX,
  IconX,
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-react'

const iconRegistry = {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowUp,
  IconBooks,
  IconBrain,
  IconCheck,
  IconChefHat,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCloudDownload,
  IconCloudUpload,
  IconCode,
  IconCpu,
  IconDatabase,
  IconDeviceFloppy,
  IconDownload,
  IconEraser,
  IconExternalLink,
  IconHome,
  IconInfoCircle,
  IconLogs,
  IconMap,
  IconNotes,
  IconPlant,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRefresh,
  IconRefreshAlert,
  IconReload,
  IconRobot,
  IconSchool,
  IconSearch,
  IconShieldCheck,
  IconSettings,
  IconStethoscope,
  IconTool,
  IconTrash,
  IconUpload,
  IconWand,
  IconXboxX,
  IconX,
} satisfies Record<string, ComponentType<IconProps>>

export type DynamicIconName = keyof typeof iconRegistry

interface DynamicIconProps {
  icon?: DynamicIconName
  className?: string
  stroke?: number
  onClick?: () => void
}

const DynamicIcon: FC<DynamicIconProps> = ({ icon, className, stroke, onClick }) => {
  if (!icon) return null

  const Icon = iconRegistry[icon]

  if (!Icon) {
    console.warn(`Icon "${icon}" is not registered in DynamicIcon.`)
    return null
  }

  return <Icon className={classNames('h-5 w-5', className)} stroke={stroke || 2} onClick={onClick} />
}

export default DynamicIcon
