import {
  Upload,
  MousePointerClick,
  Grid3x3,
  Layers,
  Bookmark,
  Box,
  Download,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FileDropzone } from '../upload/FileDropzone'

interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  target?: string
}

function scrollToPanel(id?: string) {
  if (!id) return
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function Sidebar() {
  const navItems: NavItem[] = [
    { id: 'load', label: 'Load Model', icon: Upload, target: 'load-panel' },
    { id: 'select', label: 'Select', icon: MousePointerClick, target: 'selection-panel' },
    { id: 'library', label: 'Texture Library', icon: Grid3x3, target: 'patterns-panel' },
    { id: 'apply', label: 'Apply Texture', icon: Layers, target: 'texture-panel' },
    { id: 'export', label: 'Export Model', icon: Download, target: 'export-panel' },
    { id: 'variations', label: 'Variations', icon: Bookmark, target: 'variations-panel' },
  ]

  return (
    <aside className="flex flex-col w-full lg:w-56 shrink-0 panel-glass rounded-xl overflow-hidden max-h-[40vh] lg:max-h-none">
      <div className="px-4 py-4 border-b border-purple-500/15 shrink-0">
        <div className="flex items-center gap-2">
          <Box className="h-5 w-5 text-purple-400" />
          <div>
            <h1 className="text-sm font-semibold text-white leading-tight">Texture Studio</h1>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto min-h-0">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => scrollToPanel(item.target)}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 transition-all"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div id="load-panel" className="p-3 border-t border-purple-500/15 shrink-0 hidden lg:block">
        <FileDropzone />
      </div>
    </aside>
  )
}
