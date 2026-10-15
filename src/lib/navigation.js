import {
  Home, Sun, CalendarClock, CalendarDays, CheckSquare, Wallet, Target, FolderKanban, Lightbulb, Repeat,
  BookOpen, StickyNote, Heart, LifeBuoy, PenLine, Bell, BellRing, LineChart, ClipboardCheck, Bot, Search, Settings, ShieldCheck,
} from 'lucide-react'

// Labels are translation KEYS (see src/i18n). The AI Assistant is flagged `highlight` so every layout can make it stand out.
export const NAV_ITEMS = [
  { to: '/dashboard', labelKey: 'nav.home', icon: Home },
  { to: '/today', labelKey: 'nav.today', icon: Sun },
  { to: '/ai', labelKey: 'nav.ai', icon: Bot, highlight: true },
  { to: '/planner', labelKey: 'nav.planner', icon: CalendarClock },
  { to: '/goals', labelKey: 'nav.goals', icon: Target },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { to: '/finance', labelKey: 'nav.finance', icon: Wallet },
  { to: '/habits', labelKey: 'nav.habits', icon: Repeat },
  { to: '/motivation', labelKey: 'nav.motivation', icon: Heart },
  { to: '/safe-mode', labelKey: 'nav.safeMode', icon: ShieldCheck },
  { to: '/knowledge', labelKey: 'nav.learning', icon: BookOpen },
  { to: '/notes', labelKey: 'nav.notes', icon: StickyNote },
  { to: '/brainstorm', labelKey: 'nav.ideas', icon: Lightbulb },
  { to: '/insights', labelKey: 'nav.insights', icon: LineChart },
  { to: '/notifications', labelKey: 'nav.notifications', icon: BellRing },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
]

// Less frequent screens that are still reachable (More menu, sidebar).
export const SECONDARY_ITEMS = [
  { to: '/reflections', labelKey: 'nav.reflections', icon: PenLine },
  { to: '/calm', labelKey: 'nav.calm', icon: LifeBuoy },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare },
  { to: '/schedule', labelKey: 'nav.schedule', icon: CalendarDays },
  { to: '/reminders', labelKey: 'nav.reminders', icon: Bell },
  { to: '/reviews/daily', labelKey: 'nav.reviews', icon: ClipboardCheck, match: '/reviews' },
  { to: '/search', labelKey: 'nav.search', icon: Search },
]

export const ALL_ITEMS = [...NAV_ITEMS, ...SECONDARY_ITEMS]

// Mobile bottom bar, left to right. The AI Assistant sits in the middle as a raised button; "More" opens everything else.
export const BOTTOM_NAV_PATHS = ['/dashboard', '/today', '/ai', '/finance']
