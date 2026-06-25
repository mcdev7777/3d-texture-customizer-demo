import clsx from 'clsx'
import {
  Upload,
  MousePointerClick,
  Sparkles,
  Layers,
  Grid3x3,
  Download,
  Box,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FileDropzone } from '../upload/FileDropzone'

interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
  comingSoon?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: 'load', label: 'Load Model', icon: Upload, active: true },
  { id: 'surface', label: 'Surface Selection', icon: MousePointerClick, comingSoon: true },
  { id: 'quick', label: 'Quick Texture', icon: Sparkles, comingSoon: true },
  { id: 'advanced', label: 'Advanced Texture', icon: Layers, comingSoon: true },
  { id: 'patterns', label: 'Pattern Library', icon: Grid3x3, comingSoon: true },
  { id: 'export', label: 'Export', icon: Download, comingSoon: true },
]

export function Sidebar() {
  return (
    <aside className="flex flex-col w-full lg:w-56 shrink-0 panel-glass rounded-xl overflow-hidden max-h-[40vh] lg:max-h-none">
      <div className="px-4 py-4 border-b border-purple-500/15 shrink-0">
        <div className="flex items-center gap-2">
          <Box className="h-5 w-5 text-purple-400" />
          <div>
            <h1 className="text-sm font-semibold text-white leading-tight">Spoolara</h1>
            <p className="text-[10px] text-purple-400/80">Texture Studio</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto min-h-0">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={item.comingSoon}
            className={clsx(
              'w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all',
              item.active &&
                'bg-purple-600/25 text-white border border-purple-500/30 shadow-[0_0_12px_rgba(124,58,237,0.15)]',
              item.comingSoon && 'opacity-45 cursor-not-allowed text-slate-400',
              !item.active && !item.comingSoon && 'text-slate-300 hover:bg-white/5',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.comingSoon && (
              <span className="text-[9px] uppercase tracking-wide text-purple-400/70 font-medium">
                Soon
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-purple-500/15 shrink-0 hidden lg:block">
        <FileDropzone />
      </div>
    </aside>
  )
}
