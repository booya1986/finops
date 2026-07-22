import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpLeft,
  Banknote,
  Bell,
  BookOpenCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  FileText,
  Gauge,
  Info,
  Landmark,
  LayoutDashboard,
  ListFilter,
  Menu,
  MessageCircleQuestion,
  Moon,
  MoreHorizontal,
  Pause,
  PencilLine,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTheme } from "@/components/theme-provider"
import { getJson, postJson } from "@/lib/api"
import { cn } from "@/lib/utils"
import type {
  AccountsView,
  ChargeSummaries,
  DashboardSummary,
  Goal,
  TabId,
  Transaction,
  TransactionsResult,
  TransferDetail,
} from "@/types"

const tabs: Array<{
  id: TabId
  label: string
  description: string
  icon: typeof LayoutDashboard
}> = [
  {
    id: "overview",
    label: "תמונה פיננסית",
    description: "מה חשוב עכשיו",
    icon: LayoutDashboard,
  },
  {
    id: "accounts",
    label: "חשבונות וכרטיסים",
    description: "מקורות הכסף",
    icon: WalletCards,
  },
  {
    id: "spending",
    label: "הוצאות",
    description: "קטגוריות ותנועות",
    icon: ReceiptText,
  },
  {
    id: "commitments",
    label: "יעדים והתחייבויות",
    description: "קדימה בזמן",
    icon: Target,
  },
  {
    id: "manage",
    label: "ניהול",
    description: "הוראות ומערכת",
    icon: Settings2,
  },
]

const money = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
})
const compactMoney = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  notation: "compact",
  maximumFractionDigits: 1,
})
const date = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
})
const fullDate = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "long",
  year: "numeric",
})
const monthName = new Intl.DateTimeFormat("he-IL", {
  month: "long",
  year: "numeric",
})
// Defined per-theme in index.css so charts re-color on light/dark switch.
const DATA_COLORS = [
  "var(--data-1)",
  "var(--data-2)",
  "var(--data-3)",
  "var(--data-4)",
  "var(--data-5)",
  "var(--data-6)",
  "var(--data-7)",
  "var(--data-8)",
]
const SERIES_COLORS = {
  income: "var(--series-income)",
  expenses: "var(--series-expenses)",
  net: "var(--series-net)",
}
const CATEGORY_COLOR_ORDER = [
  "שכירות",
  "מסעדות וקפה",
  "כלי AI ותוכנה",
  "תחבורה",
  "דיור וחשבונות",
  "הלוואות",
  "מתנות",
  "בריאות",
  "העברות אישיות (ביט)",
  "סופרמרקט",
  "קניות ואופנה",
  "ביטוח",
  "פיתוח אישי וכושר",
  "עמלות בנק",
  "תרומות",
  "בידור וסטרימינג",
  "ילדים ופנאי",
  "ללא קטגוריה",
  "מזומן ומשיכות",
  'נסיעות וחו"ל',
  "פיתוח מקצועי",
]

type SpendingFocus = {
  category?: string
  accountId?: number
  query?: string
}

function categoryColor(label: string) {
  const knownIndex = CATEGORY_COLOR_ORDER.indexOf(label)
  if (knownIndex >= 0) return DATA_COLORS[knownIndex % DATA_COLORS.length]
  let hash = 0
  for (let index = 0; index < label.length; index += 1)
    hash = ((hash << 5) - hash + label.charCodeAt(index)) | 0
  return DATA_COLORS[Math.abs(hash) % DATA_COLORS.length]
}

function formatMonth(value: string) {
  return monthName.format(new Date(`${value}-01T12:00:00`))
}

function formatDate(value: string | null) {
  return value ? date.format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "—"
}

/**
 * SQLite datetime() returns "YYYY-MM-DD HH:MM:SS" in UTC. Safari refuses the
 * space-separated form, so normalise to ISO and mark it UTC before parsing —
 * without the Z the timestamp is read as local and drifts by the offset.
 */
function formatDateTime(value: string) {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("he-IL", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed)
}

function tone(value: number) {
  return value >= 0
    ? "text-positive"
    : "text-negative"
}

function percentChange(current: number, baseline: number) {
  return baseline > 0 ? ((current - baseline) / baseline) * 100 : null
}

function changeLabel(current: number, baseline: number) {
  const change = percentChange(current, baseline)
  if (change == null) return "אין בסיס להשוואה"
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`
}

function App() {
  const [tab, setTab] = useState<TabId>("overview")
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [selectedMonth, setSelectedMonth] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [revision, setRevision] = useState(0)
  const [spendingFocus, setSpendingFocus] = useState<SpendingFocus>({})
  // True when a background refresh failed but we still hold usable data.
  const [stale, setStale] = useState(false)
  // Read inside load() without making it a dependency (which would restart
  // the 5s interval on every successful poll).
  const summaryRef = useRef<DashboardSummary | null>(null)

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const suffix = selectedMonth ? `?month=${selectedMonth}` : ""
        const data = await getJson<DashboardSummary>(`/api/summary${suffix}`)
        setSummary(data)
        summaryRef.current = data
        setSelectedMonth((current) => current || data.month)
        setError("")
        setStale(false)
      } catch (caught) {
        // A failed BACKGROUND poll must not blank out a screen that is already
        // showing good data — a server restart or a moment of sleep would
        // otherwise replace the whole dashboard with an error. Surface the
        // problem only when there is nothing to fall back on.
        if (quiet && summaryRef.current) {
          setStale(true)
          return
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "לא הצלחנו לטעון את הנתונים"
        )
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [selectedMonth]
  )

  useEffect(() => {
    void load()
  }, [load, revision])
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5_000)
    return () => window.clearInterval(timer)
  }, [load])

  const mutate = async (path: string, body: unknown, message: string) => {
    await postJson(path, body)
    setNotice(message)
    window.setTimeout(() => setNotice(""), 3500)
    setRevision((value) => value + 1)
  }
  const openSpending = (focus: SpendingFocus = {}) => {
    setSpendingFocus(focus)
    setTab("spending")
  }

  if (loading && !summary) return <AppSkeleton />

  return (
    <TooltipProvider>
      <div className="min-h-svh">
        <DesktopSidebar tab={tab} onTab={setTab} summary={summary} />
        <div className="xl:pr-60">
          <AppHeader
            summary={summary}
            selectedMonth={selectedMonth}
            onMonth={setSelectedMonth}
            onRefresh={() => void load()}
            refreshing={loading}
            tab={tab}
            onTab={setTab}
          />
          <main className="mx-auto w-full max-w-[1480px] px-4 pt-6 pb-16 text-right sm:px-6 lg:px-8">
            {error && (
              <Alert variant="destructive" className="mb-5">
                <AlertCircle />
                <AlertTitle>הנתונים לא נטענו</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-4">
                  <span>{error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void load()}
                  >
                    נסה שוב
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {stale && !error && (
              <Alert className="mb-5 border-warn-border/40">
                <AlertCircle />
                <AlertTitle>הנתונים אינם מתעדכנים כרגע</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-4">
                  <span>
                    הרענון האוטומטי נכשל — מוצגים הנתונים האחרונים שנטענו.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void load()}
                  >
                    נסה שוב
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {notice && (
              <Alert className="fixed bottom-5 left-5 z-50 w-[min(360px,calc(100vw-40px))] border-positive/30 bg-positive/10 text-positive shadow-lg">
                <CheckCircle2 />
                <AlertTitle>בוצע</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}
            {/* key={tab} restarts the entrance animation on every screen
                change — state motion, not decoration. */}
            <div key={tab} className="screen-in">
              {summary && tab === "overview" && (
                <Overview
                  summary={summary}
                  onTab={setTab}
                  onOpenSpending={openSpending}
                  onMutate={mutate}
                />
              )}
              {summary && tab === "accounts" && (
                <Accounts
                  summary={summary}
                  month={selectedMonth}
                  revision={revision}
                  onOpenSpending={openSpending}
                />
              )}
              {summary && tab === "spending" && (
                <Spending
                  summary={summary}
                  month={selectedMonth}
                  revision={revision}
                  focus={spendingFocus}
                  onMutate={mutate}
                />
              )}
              {summary && tab === "commitments" && (
                <Commitments summary={summary} onMutate={mutate} />
              )}
              {summary && tab === "manage" && (
                <Manage summary={summary} onMutate={mutate} />
              )}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}

function AppHeader({
  summary,
  selectedMonth,
  onMonth,
  onRefresh,
  refreshing = false,
  tab,
  onTab,
}: {
  summary: DashboardSummary | null
  selectedMonth: string
  onMonth: (month: string) => void
  onRefresh: () => void
  refreshing?: boolean
  tab: TabId
  onTab: (tab: TabId) => void
}) {
  const current = tabs.find((item) => item.id === tab)!
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/92 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3 xl:invisible">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Gauge className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">FinOps</div>
            <div className="truncate text-xs text-muted-foreground">
              {current.description}
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <MonthSelect
            months={summary?.months_available ?? []}
            value={selectedMonth}
            onChange={onMonth}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="pill"
                onClick={onRefresh}
                aria-label="רענון נתונים"
              >
                <RefreshCw
                  className={cn("size-4", refreshing && "animate-spin")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>רענון עכשיו</TooltipContent>
          </Tooltip>
          <ThemeToggle />
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              aria-label="פתיחת ניווט"
            >
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[310px] p-4">
            <div className="mt-10 grid gap-2">
              <MonthSelect
                months={summary?.months_available ?? []}
                value={selectedMonth}
                onChange={onMonth}
              />
              <Separator className="my-2" />
              {tabs.map((item) => (
                <NavButton
                  key={item.id}
                  item={item}
                  active={tab === item.id}
                  onClick={() => {
                    onTab(item.id)
                    setMobileOpen(false)
                  }}
                />
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <nav
        className="mx-auto hidden max-w-[1480px] px-4 sm:px-6 md:block lg:px-8 xl:hidden"
        aria-label="מסכי הדשבורד"
      >
        <ScrollArea>
          <div className="flex h-12 items-end gap-1">
            {tabs.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={tab === item.id}
                onClick={() => onTab(item.id)}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </nav>
    </header>
  )
}

function DesktopSidebar({
  tab,
  onTab,
  summary,
}: {
  tab: TabId
  onTab: (tab: TabId) => void
  summary: DashboardSummary | null
}) {
  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 hidden w-60 flex-col border-l border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground xl:flex"
      aria-label="ניווט ראשי"
    >
      <div className="flex items-center gap-3 px-2 pb-5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
          <Gauge className="size-5" />
        </div>
        <div>
          <div className="text-sm font-semibold">FinOps</div>
          <div className="text-xs text-muted-foreground">מרכז פיננסי אישי</div>
        </div>
      </div>
      <Separator />
      <nav className="mt-4 grid gap-1.5">
        {tabs.map((item) => {
          const Icon = item.icon
          const active = item.id === tab
          return (
            /* Selected state is a soft tint plus an accent bar rather than a
               solid orange slab — the filled block shouted louder than the
               content it was pointing at. */
            <button
              key={item.id}
              onClick={() => onTab(item.id)}
              className={cn(
                // No background on the selected item — the bar alone marks it.
                // Without a filled shape there is nothing to clip, so the
                // button keeps no overflow rule and the bar can run full height.
                "focus-ring relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-right transition-colors duration-200",
                active
                  ? "text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
              aria-current={active ? "page" : undefined}
              /* Without this the accessible name is the label and the
                 description run together ("תמונה פיננסיתמה חשוב עכשיו"). */
              aria-label={item.label}
            >
              {/* Accent bar on the leading edge — right, since the UI is RTL. */}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-1 right-0 w-[3px] bg-primary"
                />
              )}
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  active && "text-primary"
                )}
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm",
                    active ? "font-semibold" : "font-medium"
                  )}
                >
                  {item.label}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block truncate text-[11px]",
                    active ? "text-sidebar-foreground/75" : "text-muted-foreground"
                  )}
                >
                  {item.description}
                </span>
              </span>
            </button>
          )
        })}
      </nav>
      <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/50 p-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="live-dot size-2 rounded-full bg-positive" />
          מקומי ומחובר
        </div>
        <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
          {summary
            ? `עודכן ${new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(new Date(summary.generated_at))}`
            : "טוען נתונים"}
          <br />
          קריאה בלבד · ללא פעולות תשלום
        </div>
      </div>
    </aside>
  )
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: (typeof tabs)[number]
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      className={cn(
        "focus-ring flex h-11 min-w-max items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-4" />
      {item.label}
    </button>
  )
}

function MonthSelect({
  months,
  value,
  onChange,
}: {
  months: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="pill w-[160px]" aria-label="בחירת חודש">
        <CalendarDays className="size-4" />
        <SelectValue placeholder="בחר חודש" />
      </SelectTrigger>
      <SelectContent>
        {months.map((month) => (
          <SelectItem key={month} value={month}>
            {formatMonth(month)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ThemeToggle() {
  // Through the provider, not a raw classList toggle — otherwise the choice
  // is lost on reload and fights the "d" shortcut and system-theme listener.
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : theme === "dark"
  const toggle = () => setTheme(dark ? "light" : "dark")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="pill"
          onClick={toggle}
          aria-label="החלפת ערכת צבעים"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "מצב בהיר" : "מצב כהה"}</TooltipContent>
    </Tooltip>
  )
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  helper,
  status = "neutral",
}: {
  icon: typeof Banknote
  label: string
  value: string
  helper: string
  status?: "good" | "bad" | "neutral"
}) {
  return (
    <Card className="surface gap-3 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              {label}
            </div>
            <div
              className={cn(
                "numeric mt-2 text-xl font-semibold tracking-tight",
                status === "good" && "text-positive",
                status === "bad" && "text-negative"
              )}
            >
              {value}
            </div>
          </div>
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{helper}</div>
      </CardContent>
    </Card>
  )
}

function ChartLegend({
  items,
}: {
  items: Array<{ label: string; color: string; line?: boolean }>
}) {
  return (
    <div
      data-testid="chart-legend"
      className="mb-2 flex flex-wrap justify-end gap-x-4 gap-y-2"
      aria-label="מקרא הגרף"
    >
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span
            className={
              item.line ? "h-0.5 w-4 rounded-full" : "size-2.5 rounded-sm"
            }
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}

/** The single number that changes day-to-day decisions. */
function LeftToSpend({ summary }: { summary: DashboardSummary }) {
  const d = summary.brief.discretionary
  const t = summary.brief.typical_month
  const over = d.left_to_spend < 0
  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="text-base">כמה נשאר לי החודש</CardTitle>
        <CardDescription>
          הכנסה צפויה, פחות ההוצאות הקבועות, פחות מה שכבר הוצאת
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={cn("numeric text-3xl font-bold", over ? "text-negative" : "text-positive")}>
          {money.format(d.left_to_spend)}
        </div>
        {d.per_day_remaining !== null && (
          <div className="mt-1 text-sm text-muted-foreground">
            {over
              ? `חריגה של ${money.format(Math.abs(d.per_day_remaining))} ליום עד סוף החודש`
              : `${money.format(d.per_day_remaining)} ליום עד סוף החודש`}
          </div>
        )}
        <div className="mt-4 grid gap-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">הכנסה צפויה</span>
            <span className="numeric">{money.format(d.expected_income)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">הוצאות קבועות</span>
            <span className="numeric">−{money.format(summary.brief.macro.fixed_monthly)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">כבר הוצאת (משתנה)</span>
            <span className="numeric">−{money.format(d.spent_so_far)}</span>
          </div>
        </div>
        {t.months_compared > 0 && (
          <div className="mt-4 border-t pt-3 text-sm text-muted-foreground">
            הוצאת {money.format(t.current_expenses)} —{" "}
            {t.delta === 0 ? (
              "בדיוק כמו חודש טיפוסי"
            ) : (
              <>
                <span className={t.delta > 0 ? "text-negative" : "text-positive"}>
                  {money.format(Math.abs(t.delta))} {t.delta > 0 ? "מעל" : "מתחת"}
                </span>{" "}
                החודש הטיפוסי שלך ({money.format(t.median_expenses)})
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Forward projection — turns the tool from a report into an early warning. */
function ForecastCard({ summary }: { summary: DashboardSummary }) {
  const f = summary.brief.forecast
  if (!f) return null
  return (
    <Card className={cn("surface", f.first_negative_date && "border-negative/40")}>
      <CardHeader>
        <CardTitle className="text-base">תחזית תזרים</CardTitle>
        <CardDescription>
          לפי חיובים קבועים, תשלומים ומשכורת צפויה — עד סוף החודש הבא
        </CardDescription>
      </CardHeader>
      <CardContent>
        {f.first_negative_date ? (
          <div className="rounded-lg border border-negative/30 bg-negative/5 p-3">
            <div className="text-sm font-semibold text-negative">
              {/* Already negative today is a fact, not a forecast — saying
                  "is expected to drop" about the present reads as wrong. */}
              {f.starting_balance < 0
                ? `החשבון כבר במינוס של ${money.format(Math.abs(f.starting_balance))}, וצפוי להעמיק ל־${money.format(f.lowest_point.balance)} ב־${formatDate(f.lowest_point.date)}`
                : `ב־${formatDate(f.first_negative_date)} היתרה צפויה לרדת ל־${money.format(f.first_negative_amount ?? 0)}`}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-positive/30 bg-positive/5 p-3 text-sm font-semibold text-positive">
            לא צפוי מינוס בתקופה הקרובה
          </div>
        )}
        <div className="mt-3 grid gap-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">יתרה היום</span>
            <span className="numeric">{money.format(f.starting_balance)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              נקודת השפל ({formatDate(f.lowest_point.date)})
            </span>
            <span className={cn("numeric", f.lowest_point.balance < 0 && "text-negative")}>
              {money.format(f.lowest_point.balance)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">יתרה צפויה בסוף התקופה</span>
            <span className={cn("numeric", f.projected_end_balance < 0 && "text-negative")}>
              {money.format(f.projected_end_balance)}
            </span>
          </div>
        </div>
        {f.upcoming.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              על מה התחזית מבוססת ({f.upcoming.length} חיובים צפויים)
            </summary>
            <div className="mt-2 max-h-56 overflow-y-auto">
              <Table>
                <TableBody>
                  {f.upcoming.map((e, i) => (
                    <TableRow key={`${e.date}-${e.label}-${i}`}>
                      <TableCell className="numeric text-xs whitespace-nowrap">
                        {formatDate(e.date)}
                      </TableCell>
                      <TableCell className="text-xs">{e.label}</TableCell>
                      <TableCell
                        className={cn(
                          "numeric text-xs",
                          e.amount > 0 ? "text-positive" : ""
                        )}
                      >
                        {money.format(e.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

/** Charges that quietly grew — price hikes first, then usage spikes. */
function PriceIncreases({ summary }: { summary: DashboardSummary }) {
  const items = summary.brief.price_increases
  if (items.length === 0) return null
  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="text-base">חיובים שגדלו בשקט</CardTitle>
        <CardDescription>
          התייקרות של מחיר, או אותו חיוב שקורה יותר פעמים
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.map((p) => (
          <div key={p.merchant} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{p.merchant}</div>
              <div className="text-xs text-muted-foreground">
                {p.kind === "price"
                  ? `התייקר מ־${money.format(p.old_amount)} ל־${money.format(p.new_amount)}`
                  : `${p.old_count}→${p.new_count} חיובים בחודש · ${money.format(p.old_amount)} → ${money.format(p.new_amount)}`}
              </div>
            </div>
            <div className="shrink-0 text-left">
              <div className="numeric text-sm font-semibold text-negative">
                +{money.format(p.delta)}
              </div>
              <div className="text-xs text-muted-foreground">
                {money.format(p.yearly_impact)}/שנה
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * The 20-second answer to "did anything happen?", so checking in does not
 * require scanning the whole dashboard. Hidden when there is nothing new,
 * and on a first visit (no marker yet — otherwise every existing row would
 * be reported as new).
 */
function SinceLastVisit({
  summary,
  onMutate,
}: {
  summary: DashboardSummary
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const d = summary.since_last_visit
  if (!d) return null
  const nothingNew =
    d.new_transactions === 0 &&
    d.new_alerts === 0 &&
    d.new_recommendations === 0
  if (nothingNew) return null
  const parts = [
    d.new_transactions > 0 &&
      `${d.new_transactions} חיובים חדשים · ${money.format(d.new_spend)}`,
    d.new_alerts > 0 && `${d.new_alerts} התראות`,
    d.new_recommendations > 0 && `${d.new_recommendations} המלצות`,
  ].filter(Boolean) as string[]
  return (
    <Card className="surface mb-5 border-primary/30">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
            <Sparkles className="size-4 shrink-0 text-primary" />
            מאז שהסתכלת · {formatDateTime(d.since)}
          </span>
          <span className="text-sm text-muted-foreground">
            {parts.join(" · ")}
          </span>
        </div>
        {d.top_new.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {d.top_new.map((t) => (
              <Badge
                key={`${t.merchant}-${t.date}-${t.amount}`}
                variant="outline"
                className="font-normal"
              >
                {t.merchant} · {money.format(t.amount)}
              </Badge>
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ms-auto"
          onClick={() => void onMutate("/api/seen", {}, "סומן כנקרא")}
        >
          <Check className="size-4" />
          הבנתי
        </Button>
      </CardContent>
    </Card>
  )
}

function Overview({
  summary,
  onTab,
  onOpenSpending,
  onMutate,
}: {
  summary: DashboardSummary
  onTab: (tab: TabId) => void
  onOpenSpending: (focus?: SpendingFocus) => void
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const { cashflow, macro, categories, top_movers } = summary.brief
  const totalBalance = cashflow.balances.reduce(
    (sum, item) => sum + item.balance,
    0
  )
  const change = cashflow.prev_month_expenses
    ? ((cashflow.expenses - cashflow.prev_month_expenses) /
        cashflow.prev_month_expenses) *
      100
    : 0
  // Months before the checking account's history begins have no salary data,
  // so plotting income as 0 would claim he earned nothing. null makes Recharts
  // leave a gap, which is the honest reading: unknown, not zero.
  const chartData = summary.history.map((item) => ({
    ...item,
    month: item.m.slice(5),
    income: item.partial ? null : item.income,
    net: item.partial ? null : item.income - item.expenses,
  }))
  const partialMonths = summary.history.filter((item) => item.partial).length
  const topCategories = categories
    .filter((item) => item.current_total > 0)
    .slice(0, 6)
  const maxCategory = Math.max(
    ...topCategories.map((item) => item.current_total),
    1
  )
  return (
    <>
      <SinceLastVisit summary={summary} onMutate={onMutate} />
      <PageHeading
        title={`התמונה הפיננסית של ${formatMonth(summary.month)}`}
        description="המספרים החשובים, החריגות והפעולות שכדאי לקחת עכשיו—לפני שנכנסים לפרטים."
        action={
          <Badge variant="outline" className="w-fit gap-1.5">
            <span className="live-dot size-1.5 rounded-full bg-positive" />
            מתעדכן אוטומטית
          </Badge>
        }
      />
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
        <Card className="surface overflow-hidden">
          <CardContent className="grid min-h-[300px] gap-6 p-6 sm:p-8 lg:grid-cols-[.8fr_1.2fr]">
            <div className="flex flex-col justify-between">
              <div>
                <Badge variant="outline">תזרים נטו החודש</Badge>
                <div
                  className={cn(
                    "numeric mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl",
                    cashflow.net >= 0
                      ? "text-positive"
                      : "text-negative"
                  )}
                >
                  {money.format(cashflow.net)}
                </div>
                <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
                  {cashflow.net >= 0
                    ? "החודש נמצא בעודף. זה הזמן להפנות חלק ממנו ליעד פעיל."
                    : `ההוצאות גבוהות מההכנסות. נשארו ${cashflow.days_left_in_month} ימים לחודש.`}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4">
                  <div>
                    <div className="text-xs text-muted-foreground">הכנסות</div>
                    <div className="numeric mt-1 font-semibold text-positive">
                      {money.format(cashflow.income)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">הוצאות</div>
                    <div className="numeric mt-1 font-semibold">
                      {money.format(cashflow.expenses)}
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 text-xs",
                        change > 0
                          ? "text-negative"
                          : "text-positive"
                      )}
                    >
                      {change > 0 ? "עלייה" : "ירידה"} של{" "}
                      {Math.abs(change).toFixed(1)}% מחודש קודם
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button onClick={() => onOpenSpending()}>
                  פירוט הוצאות <ArrowLeft className="size-4" />
                </Button>
                <Button variant="outline" onClick={() => onTab("commitments")}>
                  בדיקת יעדים
                </Button>
              </div>
            </div>
            <div className="flex min-h-[250px] min-w-0 flex-col">
              <ChartLegend
                items={[
                  { label: "הכנסות", color: SERIES_COLORS.income },
                  { label: "הוצאות", color: SERIES_COLORS.expenses },
                  { label: "נטו", color: SERIES_COLORS.net, line: true },
                ]}
              />
              {/* Explicit height: ResponsiveContainer measures its parent, and
                  a flex-1 parent can resolve to 0 during re-render, which makes
                  the bars silently fail to draw. */}
              <div className="h-[260px] min-h-0 flex-1" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 14, right: 4, left: 4, bottom: 0 }}
                  >
                    {/* var() resolves in inline style but not in the stopColor
                        presentation attribute — keep these as style objects. */}
                    <defs>
                      <linearGradient
                        id="gradIncome"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          style={{ stopColor: "var(--series-income)" }}
                          stopOpacity={0.95}
                        />
                        <stop
                          offset="100%"
                          style={{ stopColor: "var(--series-income)" }}
                          stopOpacity={0.45}
                        />
                      </linearGradient>
                      <linearGradient
                        id="gradExpenses"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          style={{ stopColor: "var(--series-expenses)" }}
                          stopOpacity={0.95}
                        />
                        <stop
                          offset="100%"
                          style={{ stopColor: "var(--series-expenses)" }}
                          stopOpacity={0.45}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="2 6"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      width={52}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                      tickFormatter={(value) =>
                        compactMoney.format(Number(value))
                      }
                      tickLine={false}
                      axisLine={false}
                    />
                    <RechartsTooltip
                      content={<ChartTooltip />}
                      cursor={{ fill: "var(--muted)", opacity: 0.45 }}
                    />
                    <Bar
                      dataKey="income"
                      name="הכנסות"
                      fill="url(#gradIncome)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={14}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="expenses"
                      name="הוצאות"
                      fill="url(#gradExpenses)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={14}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="net"
                      name="נטו"
                      stroke={SERIES_COLORS.net}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3.5, strokeWidth: 0 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-right text-xs text-muted-foreground">
                עמודות משוות הכנסות והוצאות בכל חודש; הקו מציג את ההפרש ביניהן.
                {partialMonths > 0 && (
                  <>
                    {" "}
                    ב־{partialMonths} החודשים הראשונים אין נתוני עו״ש — הבנק לא
                    מספק היסטוריה עמוקה יותר, ולכן ההכנסות שם חסרות ולא אפס.
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              תמונת מצב חכמה
            </CardTitle>
            <CardDescription>הקשר שמאחורי המספרים</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <InsightRow
              label="יתרה בעו״ש"
              value={money.format(totalBalance)}
              helper={
                cashflow.balances[0]
                  ? `נכון ל־${formatDate(cashflow.balances[0].as_of)}`
                  : "אין נתון יתרה"
              }
              good={totalBalance >= 0}
            />
            <InsightRow
              label="שיעור חיסכון"
              value={
                macro.savings_rate_pct == null
                  ? "אין נתון"
                  : `${macro.savings_rate_pct.toFixed(1)}%`
              }
              good={(macro.savings_rate_pct ?? -1) >= 0}
            />
            <InsightRow
              label="תחזית סוף חודש"
              value={
                cashflow.naive_eom_balance == null
                  ? "אין יתרה"
                  : money.format(cashflow.naive_eom_balance)
              }
              helper={`${money.format(cashflow.burn_rate_daily)} ליום${macro.runway_days == null ? "" : ` · כרית ${macro.runway_days.toFixed(0)} ימים`}`}
              good={(cashflow.naive_eom_balance ?? -1) >= 0}
            />
            <InsightRow
              label="בסיס חודשי"
              value={money.format(macro.avg_monthly_expenses_6m)}
              helper={`${money.format(macro.fixed_monthly)} קבועות · נטו 6 חודשים ${money.format(macro.totals_6m.net)}`}
            />
          </CardContent>
        </Card>
      </section>
      {/* Forward-looking block, above the historical detail: what is coming
          and what is left matter more than what already happened. */}
      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <ForecastCard summary={summary} />
        <LeftToSpend summary={summary} />
        <PriceIncreases summary={summary} />
      </section>
      {/* Narrative context only. urgent_actions used to render here as amber
          "action" boxes, but they are plain strings with no id or status —
          nothing to accept, dismiss or navigate to, so resolved items kept
          showing as urgent with no way to clear them. Anything genuinely
          actionable belongs in the recommendations panel, which has a real
          status lifecycle. */}
      {summary.advisor_review && (
        <Card className="surface mt-4 border-primary/25">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-primary" />
              הסקירה של היועץ
              <span className="text-xs font-normal text-muted-foreground">
                · הקשר, לא משימות — הפעולות נמצאות בהמלצות
              </span>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
              {summary.advisor_review.summary}
            </p>
          </CardContent>
        </Card>
      )}
      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <Card className="surface">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>לאן הכסף הלך</CardTitle>
              <CardDescription>
                שש הקטגוריות הגדולות בחודש; כל צבע נשמר גם בפירוט
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onOpenSpending()}>
              לכל ההוצאות <ChevronLeft className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4">
            {topCategories.map((item) => (
              <button
                key={item.category}
                className="focus-ring group grid grid-cols-[minmax(95px,1fr)_2fr_auto] items-center gap-3 text-right"
                onClick={() => onOpenSpending({ category: item.category })}
              >
                <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: categoryColor(item.category) }}
                  />
                  {item.category}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${(item.current_total / maxCategory) * 100}%`,
                      background: categoryColor(item.category),
                    }}
                  />
                </span>
                <span className="numeric text-sm text-muted-foreground">
                  {money.format(item.current_total)}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
        <ActionCenter summary={summary} onMutate={onMutate} />
      </section>
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="surface">
          <CardHeader>
            <CardTitle>מה השתנה</CardTitle>
            <CardDescription>תנועת קטגוריות לעומת החודש הקודם</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {top_movers.slice(0, 5).map((item) => (
              <div
                key={item.category}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg",
                    item.delta > 0
                      ? "bg-negative/10 text-negative"
                      : "bg-positive/10 text-positive"
                  )}
                >
                  {item.delta > 0 ? (
                    <TrendingUp className="size-4" />
                  ) : (
                    <TrendingDown className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.category}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {money.format(item.previous)} → {money.format(item.current)}
                  </div>
                </div>
                <div
                  className={cn(
                    "numeric text-sm font-semibold",
                    tone(-item.delta)
                  )}
                >
                  {item.delta > 0 ? "+" : ""}
                  {money.format(item.delta)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="surface">
          <CardHeader>
            <CardTitle>עומס לאורך החודש</CardTitle>
            <CardDescription>
              ממוצע הוצאה לפי שבוע בחודש, בשלושת החודשים האחרונים
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[250px]" dir="ltr">
            {/* Same guard as the cashflow chart above: ResponsiveContainer
                measures its PARENT, and CardContent's padded box can resolve to
                -1/0 mid-layout — Recharts then warns "width(-1) and height(-1)"
                and silently draws nothing. An explicit-height wrapper always
                gives it a real box to measure. */}
            <div className="h-full min-h-0 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={macro.week_of_month_spend.map((item) => ({
                    ...item,
                    name: `שבוע ${item.week}`,
                  }))}
                >
                  <defs>
                    <linearGradient id="gradWeekly" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        style={{ stopColor: "var(--series-net)" }}
                        stopOpacity={0.35}
                      />
                      <stop
                        offset="100%"
                        style={{ stopColor: "var(--series-net)" }}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="2 6"
                    stroke="var(--border)"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis hide />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="avg"
                    name="ממוצע"
                    fill="url(#gradWeekly)"
                    stroke="var(--series-net)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>
      <RecommendationsPanel summary={summary} onMutate={onMutate} />
    </>
  )
}

/**
 * One of exactly four consolidated KPIs (see DASHBOARD.md — these must not
 * be re-expanded back into eight cards). Rendered as a flat instrument well:
 * the figure is the loudest thing in the cell, and state is a dot+word chip —
 * never colour alone.
 */
function InsightRow({
  label,
  value,
  helper,
  good,
}: {
  label: string
  value: string
  helper?: string
  good?: boolean
}) {
  return (
    <div className="metric-cell">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {label}
        </div>
        {good !== undefined && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-[11px] font-medium",
              good ? "text-positive" : "text-warn"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                good ? "bg-positive" : "bg-warn"
              )}
            />
            {good ? "תקין" : "לתשומת לב"}
          </span>
        )}
      </div>
      <div className="numeric mt-2 text-xl font-semibold tracking-tight">
        {value}
      </div>
      {helper && (
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {helper}
        </div>
      )}
    </div>
  )
}

function TrendBadge({
  current,
  baseline,
}: {
  current: number
  baseline: number
}) {
  const change = percentChange(current, baseline)
  if (change == null)
    return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Badge
      variant="outline"
      className={cn(
        "numeric",
        change > 0
          ? "border-negative/30 text-negative"
          : "border-positive/30 text-positive"
      )}
    >
      {change > 0 ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
      )}
      {change > 0 ? "+" : ""}
      {change.toFixed(1)}%
    </Badge>
  )
}

function RecommendationsPanel({
  summary,
  onMutate,
}: {
  summary: DashboardSummary
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const stats = summary.recommendation_stats
  if (summary.recommendations.length === 0) return null
  return (
    <Card className="surface mt-6" data-testid="recommendations-panel">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>המלצות היועץ</CardTitle>
          <CardDescription>
            המלצות חדשות עם הבסיס המספרי, ההשפעה והצעדים המוצעים
          </CardDescription>
        </div>
        <Badge variant="outline" className="shrink-0">
          התקבלו {stats.accepted + stats.done} · נדחו {stats.dismissed}
        </Badge>
      </CardHeader>
      <CardContent>
        {summary.recommendations.length === 0 ? (
          <CompactEmpty
            icon={Sparkles}
            title="אין המלצות חדשות"
            description="אפשר להריץ npm run advise כדי ליצור ניתוח מעודכן."
          />
        ) : (
          <div className="divide-y rounded-xl border">
            {summary.recommendations.map((recommendation, index) => {
              const details = recommendation.details
              return (
                <details
                  key={recommendation.id}
                  className="group p-4"
                  open={index === 0}
                >
                  <summary className="focus-ring flex cursor-pointer list-none items-start gap-3 rounded-lg">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        {recommendation.title}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {details?.what_happened ?? recommendation.rationale}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {recommendation.category && (
                          <Badge variant="secondary">
                            {recommendation.category}
                          </Badge>
                        )}
                        {recommendation.est_saving_ils != null && (
                          <Badge
                            variant="outline"
                            className="text-positive"
                          >
                            חיסכון משוער{" "}
                            {money.format(recommendation.est_saving_ils)}/חודש
                          </Badge>
                        )}
                        {recommendation.effort && (
                          <Badge variant="outline">
                            מאמץ {recommendation.effort}
                          </Badge>
                        )}
                        {recommendation.confidence != null && (
                          <Badge variant="outline">
                            ביטחון{" "}
                            {(recommendation.confidence * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </div>
                    </div>
                    <ChevronLeft className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-open:-rotate-90" />
                  </summary>
                  <div className="mt-4 grid gap-4 pr-12 lg:grid-cols-2">
                    {details?.breakdown && details.breakdown.length > 0 && (
                      <div>
                        <div className="mb-2 text-sm font-medium">
                          ממה זה מורכב
                        </div>
                        <div className="divide-y rounded-lg bg-muted/45 px-3">
                          {details.breakdown.map((item) => (
                            <div
                              key={item.label}
                              className="flex justify-between gap-4 py-2 text-sm"
                            >
                              <span>{item.label}</span>
                              <span className="numeric font-medium">
                                {money.format(item.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {details?.change && (
                      <div>
                        <div className="mb-2 text-sm font-medium">מה השתנה</div>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg bg-muted/45 p-3 text-center">
                          <div>
                            <div className="text-xs text-muted-foreground">
                              {details.change.baseline_label}
                            </div>
                            <div className="numeric mt-1 font-semibold">
                              {money.format(details.change.baseline)}
                            </div>
                          </div>
                          <ArrowLeft className="size-4 text-muted-foreground" />
                          <div>
                            <div className="text-xs text-muted-foreground">
                              {details.change.current_label}
                            </div>
                            <div className="numeric mt-1 font-semibold">
                              {money.format(details.change.current)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {(details?.impact_monthly != null ||
                      details?.impact_yearly != null) && (
                      <div className="rounded-lg border border-warn-border bg-warn-surface p-3 text-sm text-warn">
                        עלות משוערת:{" "}
                        {details.impact_monthly != null &&
                          `${money.format(details.impact_monthly)} בחודש`}
                        {details.impact_monthly != null &&
                          details.impact_yearly != null &&
                          " · "}
                        {details.impact_yearly != null &&
                          `${money.format(details.impact_yearly)} בשנה`}
                      </div>
                    )}
                    {details?.steps && details.steps.length > 0 && (
                      <div>
                        <div className="mb-2 text-sm font-medium">
                          צעדים מוצעים
                        </div>
                        <ol className="grid list-decimal gap-1.5 pr-5 text-sm text-muted-foreground">
                          {details.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 pr-12">
                    <Button
                      size="sm"
                      onClick={() =>
                        void onMutate(
                          `/api/recommendations/${recommendation.id}`,
                          { status: "accepted" },
                          "ההמלצה התקבלה"
                        )
                      }
                    >
                      קבל המלצה
                    </Button>
                    {/* Marking done asks what was ACTUALLY saved — that figure
                        is the platform's quality metric (PLAN §17), and it is
                        often not the estimate. */}
                    <DoneDialog
                      recommendation={recommendation}
                      onMutate={onMutate}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        void onMutate(
                          `/api/recommendations/${recommendation.id}`,
                          { status: "dismissed" },
                          "ההמלצה הוסרה"
                        )
                      }
                    >
                      לא רלוונטי
                    </Button>
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ActionCenter({
  summary,
  onMutate,
}: {
  summary: DashboardSummary
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const items = summary.alerts
  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4 text-primary" />
          חריגות לבדיקה
        </CardTitle>
        <CardDescription>
          {items.length
            ? `${items.length} התראות פתוחות`
            : "אין כרגע חריגות פתוחות"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <CompactEmpty
            icon={ShieldCheck}
            title="הכול שקט"
            description="אין התראות פתוחות. ההמלצות מופיעות בהמשך הסקירה."
          />
        ) : (
          <div className="grid gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-warn-surface text-warn">
                  <AlertCircle className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-5 font-medium">
                    {item.message}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.severity === "high" ? "דורש תשומת לב" : "התראה"}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="פעולות">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() =>
                        void onMutate(
                          `/api/alerts/${item.id}/dismiss`,
                          {},
                          "ההתראה נסגרה"
                        )
                      }
                    >
                      <Check className="size-4" />
                      סמן כטופל
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Accounts({
  summary,
  month,
  revision,
  onOpenSpending,
}: {
  summary: DashboardSummary
  month: string
  revision: number
  onOpenSpending: (focus?: SpendingFocus) => void
}) {
  const [data, setData] = useState<AccountsView | null>(null)
  const [transferDetail, setTransferDetail] = useState<TransferDetail[]>([])
  useEffect(() => {
    void Promise.all([
      getJson<AccountsView>(`/api/accounts?month=${month}`),
      getJson<TransferDetail[]>(`/api/transfers-detail?month=${month}`),
    ]).then(([accounts, transfers]) => {
      setData(accounts)
      setTransferDetail(transfers)
    })
  }, [month, revision])
  return (
    <>
      <PageHeading
        title="חשבונות וכרטיסים"
        description="הפרדה ברורה בין חשבון העו״ש לבין הכרטיסים—כדי שלא לספור חיובים פעמיים."
      />
      {!data ? (
        <GridSkeleton />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              icon={CreditCard}
              label="הוצאות בכרטיסים"
              value={money.format(data.totals.card_spend)}
              helper="מקור האמת להוצאות כרטיס"
            />
            <Metric
              icon={Landmark}
              label="הוצאות עו״ש"
              value={money.format(data.totals.checking_spend)}
              helper="ללא חיובי אשראי מרוכזים"
            />
            <Metric
              icon={ArrowUpLeft}
              label="הכנסות לעו״ש"
              value={money.format(data.totals.income)}
              helper="הכנסות שאינן העברות"
              status="good"
            />
            <Metric
              icon={RefreshCw}
              label="העברות פנימיות"
              value={money.format(data.totals.transfers)}
              helper="מוחרגות מסיכום ההוצאות"
            />
          </section>
          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <AccountGroup
              title="כרטיסי אשראי"
              description="מקור אמת להוצאות המשתנות"
              icon={CreditCard}
              accounts={data.cards}
              onDetails={(accountId, detail) =>
                onOpenSpending({ accountId, ...detail })
              }
              cardStyle
            />
            <AccountGroup
              title="חשבונות עו״ש"
              description="הכנסות, התחייבויות ותנועות פנימיות"
              icon={Landmark}
              accounts={data.checking}
              onDetails={(accountId, detail) =>
                onOpenSpending({ accountId, ...detail })
              }
            />
          </section>
          <Card className="surface mt-6">
            <details className="group">
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl p-6">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="size-4 text-primary" />
                    מה כלול בהעברות הפנימיות?
                  </CardTitle>
                  <CardDescription className="mt-1">
                    פירוט חיובי אשראי מרוכזים והעברות שהוחרגו מכפל ספירה
                  </CardDescription>
                </div>
                <ChevronLeft className="size-5 text-muted-foreground transition-transform group-open:-rotate-90" />
              </summary>
              <CardContent
                className="border-t"
                data-testid="transfer-breakdown"
              >
                {transferDetail.length === 0 ? (
                  <CompactEmpty
                    icon={CheckCircle2}
                    title="אין העברות פנימיות בחודש"
                    description="לא נמצאו תנועות שהוחרגו מסיכום ההוצאות."
                  />
                ) : (
                  <div className="divide-y rounded-xl border px-4">
                    {transferDetail.map((item) => (
                      <div
                        key={item.merchant}
                        className="flex items-center justify-between gap-4 py-3 text-sm"
                      >
                        <span>{item.merchant}</span>
                        <span className="numeric font-semibold">
                          {money.format(item.total)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-4 py-3 font-semibold">
                      <span>סך הכול מוחרג</span>
                      <span className="numeric">
                        {money.format(data.totals.transfers)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </details>
          </Card>
        </>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        עודכן לאחרונה: {fullDate.format(new Date(summary.generated_at))}
      </p>
    </>
  )
}

function AccountGroup({
  title,
  description,
  icon: Icon,
  accounts,
  onDetails,
  cardStyle = false,
}: {
  title: string
  description: string
  icon: typeof CreditCard
  accounts: AccountsView["cards"]
  onDetails: (
    accountId: number,
    detail?: Pick<SpendingFocus, "category" | "query">
  ) => void
  cardStyle?: boolean
}) {
  return (
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {accounts.length === 0 ? (
          <CompactEmpty
            icon={Icon}
            title="אין חשבונות"
            description="לא נמצאו מקורות מהסוג הזה."
          />
        ) : (
          accounts.map((account) => (
            <div
              key={account.id}
              className={cn(
                "overflow-hidden rounded-xl border",
                cardStyle && "card-visual border-0 shadow-lg"
              )}
            >
              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div
                      className={cn(
                        "text-xs",
                        cardStyle
                          ? "text-white/65"
                          : "text-muted-foreground"
                      )}
                    >
                      {account.provider}
                    </div>
                    <div className="mt-1 font-semibold">
                      {account.display_name}
                    </div>
                  </div>
                  {cardStyle ? (
                    <div
                      className="card-chip grid h-8 w-10 grid-cols-3 gap-px rounded-md p-1 opacity-90"
                      aria-hidden
                    >
                      {Array.from({ length: 9 }, (_, i) => (
                        <span key={i} className="rounded-[1px] border" />
                      ))}
                    </div>
                  ) : (
                    <Landmark className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="numeric mt-6 text-2xl font-semibold">
                  {money.format(account.month_expenses)}
                </div>
                <div
                  className={cn(
                    "mt-1 text-xs",
                    cardStyle ? "text-white/65" : "text-muted-foreground"
                  )}
                >
                  {account.month_tx_count} תנועות · ממוצע חודשי{" "}
                  {money.format(account.avg_expenses_6m)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {account.avg_expenses_6m > 0 &&
                    account.month_expenses > 0 && (
                      <Badge
                        variant="outline"
                        className={cn(
                          cardStyle && "border-white/20 text-white"
                        )}
                      >
                        {changeLabel(
                          account.month_expenses,
                          account.avg_expenses_6m
                        )}{" "}
                        מהממוצע
                      </Badge>
                    )}
                  {account.month_income > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-positive",
                        cardStyle && "border-white/20 text-emerald-200"
                      )}
                    >
                      הכנסות {money.format(account.month_income)}
                    </Badge>
                  )}
                  {account.month_transfers > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(cardStyle && "border-white/20 text-white")}
                    >
                      העברות {money.format(account.month_transfers)}
                    </Badge>
                  )}
                  {account.month_fees > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-negative",
                        cardStyle && "border-white/20 text-rose-200"
                      )}
                    >
                      עמלות {money.format(account.month_fees)}
                    </Badge>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "grid gap-3 border-t p-4 sm:grid-cols-2",
                  cardStyle ? "border-white/10 bg-white/[.04]" : "bg-muted/30"
                )}
              >
                <MiniList
                  title="קטגוריות מובילות"
                  rows={account.top_categories.map((row) => ({
                    label: row.category,
                    value: row.total,
                    onClick: () =>
                      onDetails(account.id, { category: row.category }),
                  }))}
                  dark={cardStyle}
                />
                <MiniList
                  title="מוקדי הוצאה בחשבון"
                  rows={account.top_merchants.map((row) => ({
                    label: row.merchant,
                    value: row.total,
                    onClick: () =>
                      onDetails(account.id, { query: row.merchant }),
                  }))}
                  dark={cardStyle}
                />
              </div>
              <div
                className={cn(
                  "flex items-center justify-between border-t px-4 py-2",
                  cardStyle && "border-white/10"
                )}
              >
                <span
                  className={cn(
                    "text-xs",
                    cardStyle ? "text-white/65" : "text-muted-foreground"
                  )}
                >
                  תנועה אחרונה {formatDate(account.last_date)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className={
                    cardStyle
                      ? "text-white hover:bg-white/10 hover:text-white"
                      : ""
                  }
                  onClick={() => onDetails(account.id)}
                >
                  לתנועות <ChevronLeft className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function MiniList({
  title,
  rows,
  dark,
}: {
  title: string
  rows: Array<{ label: string; value: number; onClick?: () => void }>
  dark?: boolean
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-2 text-xs font-medium",
          dark ? "text-white/65" : "text-muted-foreground"
        )}
      >
        {title}
      </div>
      <div className="grid gap-1.5">
        {rows.slice(0, 5).map((row) => (
          <button
            key={row.label}
            type="button"
            onClick={row.onClick}
            className="focus-ring flex items-center justify-between gap-2 rounded-sm text-right text-xs hover:underline disabled:no-underline"
            disabled={!row.onClick}
          >
            <span className="truncate">{row.label}</span>
            <span className="numeric shrink-0">{money.format(row.value)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Spending({
  summary,
  month,
  revision,
  focus,
  onMutate,
}: {
  summary: DashboardSummary
  month: string
  revision: number
  focus: SpendingFocus
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [data, setData] = useState<ChargeSummaries | null>(null)
  const [transactions, setTransactions] = useState<TransactionsResult | null>(
    null
  )
  const [category, setCategory] = useState(focus.category ?? "all")
  const [accountId, setAccountId] = useState(
    focus.accountId ? String(focus.accountId) : "all"
  )
  const [query, setQuery] = useState(focus.query ?? "")
  const [merchantQuery, setMerchantQuery] = useState("")
  const [merchantCategory, setMerchantCategory] = useState("all")
  const [merchantSort, setMerchantSort] = useState("month")
  const [offset, setOffset] = useState(0)
  const [merchant, setMerchant] = useState("")
  const [questionTx, setQuestionTx] = useState<Transaction | null>(null)
  const params = useMemo(() => {
    const p = new URLSearchParams({
      month,
      limit: "40",
      offset: String(offset),
    })
    if (category !== "all") p.set("category", category)
    if (accountId !== "all") p.set("account", accountId)
    if (query.trim()) p.set("q", query.trim())
    return p
  }, [month, category, accountId, query, offset])
  useEffect(() => {
    void getJson<ChargeSummaries>(`/api/summaries?month=${month}`).then(setData)
  }, [month, revision])
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void getJson<TransactionsResult>(`/api/transactions?${params}`).then(
          setTransactions
        ),
      180
    )
    return () => window.clearTimeout(timer)
  }, [params, revision])
  const uncategorized =
    data?.merchants.filter(
      (row) => row.category === "ללא קטגוריה" && row.month_total > 0
    ) ?? []
  const merchantRows = useMemo(
    () =>
      [...(data?.merchants ?? [])]
        .filter(
          (row) =>
            (merchantCategory === "all" || row.category === merchantCategory) &&
            (!merchantQuery.trim() ||
              row.merchant
                .toLocaleLowerCase("he")
                .includes(merchantQuery.trim().toLocaleLowerCase("he")))
        )
        .sort((a, b) => {
          if (merchantSort === "six-months") return b.total_6m - a.total_6m
          if (merchantSort === "trend")
            return (
              (percentChange(b.month_total, b.avg_monthly_6m) ?? -Infinity) -
              (percentChange(a.month_total, a.avg_monthly_6m) ?? -Infinity)
            )
          if (merchantSort === "name")
            return a.merchant.localeCompare(b.merchant, "he")
          return b.month_total - a.month_total
        })
        .slice(0, 60),
    [data, merchantCategory, merchantQuery, merchantSort]
  )
  return (
    <>
      <PageHeading
        title="הוצאות"
        description="מתחילים מתמונת ההוצאות של משק הבית, ואז יורדים לקטגוריה, לספק ולחיוב הבודד."
      />
      {!data ? (
        <GridSkeleton />
      ) : (
        <>
          <section>
            <Card className="surface">
              <CardHeader>
                <CardTitle>פילוח הוצאות לפי קטגוריה</CardTitle>
                <CardDescription>
                  מתוך {money.format(data.totals.month_expenses)} בחודש הנבחר ·
                  מוצג מהגדול לקטן
                </CardDescription>
              </CardHeader>
              <CardContent data-testid="category-breakdown">
                <div className="grid gap-4">
                  {data.categories
                    .filter((row) => row.month_total > 0)
                    .sort((a, b) => b.month_total - a.month_total)
                    .slice(0, 8)
                    .map((row) => {
                      const share = data.totals.month_expenses
                        ? (row.month_total / data.totals.month_expenses) * 100
                        : 0
                      return (
                        <button
                          key={row.category}
                          onClick={() => {
                            setCategory(row.category)
                            setOffset(0)
                          }}
                          className="focus-ring group grid gap-2 rounded-lg px-2 py-1.5 text-right hover:bg-muted/40"
                        >
                          <span className="flex items-center gap-3">
                            <span
                              className="size-3 shrink-0 rounded-sm"
                              style={{
                                background: categoryColor(row.category),
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {row.category}
                            </span>
                            <span className="numeric text-sm font-semibold">
                              {money.format(row.month_total)}
                            </span>
                            <span className="numeric w-12 text-left text-xs text-muted-foreground">
                              {share.toFixed(1)}%
                            </span>
                          </span>
                          <span className="mr-6 h-2 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.min(100, share)}%`,
                                background: categoryColor(row.category),
                              }}
                            />
                          </span>
                        </button>
                      )
                    })}
                </div>
                <div className="mt-5 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    אורך הפס והאחוז מחושבים מתוך הוצאות החודש בלבד. לחיצה על
                    קטגוריה מסננת מיד את רשימת התנועות למטה.
                  </span>
                </div>
              </CardContent>
            </Card>
          </section>
          {uncategorized.length > 0 && (
            <Card className="surface mt-6 border-warn-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpenCheck className="size-4 text-warn" />
                  מיון שמחכה לך
                </CardTitle>
                <CardDescription>
                  {uncategorized.length} ספקים ושירותים טרם סווגו. סיווג ישפר את
                  תמונת ההוצאות ואת המלצות היועץ.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {uncategorized.slice(0, 9).map((row) => (
                  <button
                    key={row.merchant}
                    onClick={() => setMerchant(row.merchant)}
                    className="focus-ring flex items-center gap-3 rounded-lg border p-3 text-right hover:bg-muted/40"
                  >
                    <div className="flex size-9 items-center justify-center rounded-lg bg-warn-surface text-warn">
                      <ListFilter className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {row.merchant}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.month_count} חיובים
                      </div>
                    </div>
                    <span className="numeric text-sm font-semibold">
                      {money.format(row.month_total)}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
          <Card className="surface mt-6">
            <details className="group">
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl p-6">
                <div>
                  <CardTitle>כל הקטגוריות וההשוואה ההיסטורית</CardTitle>
                  <CardDescription className="mt-1">
                    כמות חיובים, ממוצע, מגמה וסיכום של שישה חודשים
                  </CardDescription>
                </div>
                <ChevronLeft className="size-5 text-muted-foreground transition-transform group-open:-rotate-90" />
              </summary>
              <CardContent className="max-h-[720px] overflow-auto border-t px-0">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                    <TableRow>
                      <TableHead className="pr-6">קטגוריה</TableHead>
                      <TableHead>החודש</TableHead>
                      <TableHead>חיובים</TableHead>
                      <TableHead>ממוצע</TableHead>
                      <TableHead>מגמה</TableHead>
                      <TableHead>6 חודשים</TableHead>
                      <TableHead>חלק מהחודש</TableHead>
                      <TableHead>חלק מ־6 חודשים</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.categories.map((row) => (
                      <TableRow
                        key={row.category}
                        className="cursor-pointer"
                        onClick={() => {
                          setCategory(row.category)
                          setOffset(0)
                        }}
                      >
                        <TableCell className="pr-6 font-medium">
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-sm"
                              style={{
                                background: categoryColor(row.category),
                              }}
                            />
                            {row.category}
                          </span>
                        </TableCell>
                        <TableCell className="numeric">
                          {money.format(row.month_total)}
                        </TableCell>
                        <TableCell className="numeric text-muted-foreground">
                          {row.month_count}
                        </TableCell>
                        <TableCell className="numeric text-muted-foreground">
                          {money.format(row.avg_monthly_6m)}
                        </TableCell>
                        <TableCell>
                          <TrendBadge
                            current={row.month_total}
                            baseline={row.avg_monthly_6m}
                          />
                        </TableCell>
                        <TableCell className="numeric text-muted-foreground">
                          {money.format(row.total_6m)}
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-[140px] items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${Math.min(100, data.totals.month_expenses ? (row.month_total / data.totals.month_expenses) * 100 : 0)}%`,
                                  background: categoryColor(row.category),
                                }}
                              />
                            </span>
                            <span className="numeric w-10 text-xs text-muted-foreground">
                              {(data.totals.month_expenses
                                ? (row.month_total /
                                    data.totals.month_expenses) *
                                  100
                                : 0
                              ).toFixed(1)}
                              %
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="numeric text-muted-foreground">
                          {row.pct_of_6m.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </details>
          </Card>
          <Card className="surface mt-6" data-testid="merchant-summary">
            <CardHeader className="gap-4">
              <div>
                <CardTitle>מוקדי ההוצאה של משק הבית</CardTitle>
                <CardDescription>
                  {merchantRows.length} מתוך {data.merchants.length} ספקים
                  ושירותים · החודש, ממוצע ומגמה לאורך שישה חודשים
                </CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pr-9"
                    placeholder="חיפוש ספק או שירות..."
                    value={merchantQuery}
                    onChange={(event) => setMerchantQuery(event.target.value)}
                  />
                </div>
                <Select
                  value={merchantCategory}
                  onValueChange={setMerchantCategory}
                >
                  <SelectTrigger className="sm:w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הקטגוריות</SelectItem>
                    {data.categories.map((item) => (
                      <SelectItem key={item.category} value={item.category}>
                        {item.category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={merchantSort} onValueChange={setMerchantSort}>
                  <SelectTrigger className="sm:w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">החודש — מהגדול לקטן</SelectItem>
                    <SelectItem value="six-months">שישה חודשים</SelectItem>
                    <SelectItem value="trend">העלייה החדה ביותר</SelectItem>
                    <SelectItem value="name">שם הספק או השירות</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="max-h-[720px] overflow-auto px-0">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                  <TableRow>
                    <TableHead className="pr-6">ספק / שירות</TableHead>
                    <TableHead>קטגוריה</TableHead>
                    <TableHead>החודש</TableHead>
                    <TableHead>חיובים</TableHead>
                    <TableHead>ממוצע</TableHead>
                    <TableHead>מגמה</TableHead>
                    <TableHead>6 חודשים</TableHead>
                    <TableHead>חודשים פעילים</TableHead>
                    <TableHead>אחרון</TableHead>
                    <TableHead className="pl-6">
                      <span className="sr-only">פעולות</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {merchantRows.map((row) => (
                    <TableRow key={row.merchant}>
                      <TableCell className="pr-6 font-medium">
                        {row.merchant}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            row.category === "ללא קטגוריה" &&
                              "border-warn-border text-warn"
                          )}
                        >
                          {row.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="numeric">
                        {row.month_total ? money.format(row.month_total) : "—"}
                      </TableCell>
                      <TableCell className="numeric text-muted-foreground">
                        {row.month_count}
                      </TableCell>
                      <TableCell className="numeric text-muted-foreground">
                        {money.format(row.avg_monthly_6m)}
                      </TableCell>
                      <TableCell>
                        <TrendBadge
                          current={row.month_total}
                          baseline={row.avg_monthly_6m}
                        />
                      </TableCell>
                      <TableCell className="numeric text-muted-foreground">
                        {money.format(row.total_6m)}
                      </TableCell>
                      <TableCell className="numeric text-muted-foreground">
                        {row.months_active}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.last_date)}
                      </TableCell>
                      <TableCell className="pl-6">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`פעולות עבור ${row.merchant}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setQuery(row.merchant)
                                setCategory("all")
                                setOffset(0)
                              }}
                            >
                              <Search className="size-4" />
                              הצג תנועות
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setMerchant(row.merchant)}
                            >
                              <PencilLine className="size-4" />
                              סיווג והערה
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      <Card className="surface mt-6">
        <CardHeader className="gap-4">
          <div>
            <CardTitle>תנועות</CardTitle>
            <CardDescription>
              {transactions
                ? `${transactions.total} תנועות · ${money.format(transactions.total_filtered)} הוצאות`
                : "טוען תנועות"}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pr-9"
                placeholder="חיפוש ספק או חיוב..."
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setOffset(0)
                }}
              />
            </div>
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value)
                setOffset(0)
              }}
            >
              <SelectTrigger className="sm:w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הקטגוריות</SelectItem>
                {summary.categories_all.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={accountId}
              onValueChange={(value) => {
                setAccountId(value)
                setOffset(0)
              }}
            >
              <SelectTrigger className="sm:w-[210px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל החשבונות</SelectItem>
                {summary.accounts.map((account) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          {!transactions ? (
            <div className="p-6">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : transactions.rows.length === 0 ? (
            <CompactEmpty
              icon={Search}
              title="אין תוצאות"
              description="אפשר לשנות את החיפוש או את הקטגוריה."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pr-6">תאריך</TableHead>
                  <TableHead>ספק / שירות</TableHead>
                  <TableHead>קטגוריה</TableHead>
                  <TableHead>חשבון</TableHead>
                  <TableHead>סכום</TableHead>
                  <TableHead className="pl-6">
                    <span className="sr-only">פעולות</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.rows.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="pr-6 text-muted-foreground">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {tx.normalized_merchant}
                      </div>
                      {tx.installment_total && (
                        <div className="text-xs text-muted-foreground">
                          תשלום {tx.installment_current}/{tx.installment_total}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {tx.is_transfer ? "העברה" : tx.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-muted-foreground">
                      {tx.account}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "numeric font-medium",
                        tx.amount_ils > 0 &&
                          "text-positive"
                      )}
                    >
                      {money.format(tx.amount_ils)}
                    </TableCell>
                    <TableCell className="pl-6">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`פעולות עבור ${tx.normalized_merchant}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setMerchant(tx.normalized_merchant)}
                          >
                            <PencilLine className="size-4" />
                            סיווג והערה
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setQuestionTx(tx)}>
                            <MessageCircleQuestion className="size-4" />
                            שאל את היועץ
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              void onMutate(
                                "/api/transfer",
                                { merchant: tx.normalized_merchant },
                                "הספק סומן כהעברה פנימית"
                              )
                            }
                          >
                            <RefreshCw className="size-4" />
                            סמן כהעברה
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <div className="flex items-center justify-between border-t p-4">
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 40))}
          >
            הקודם
          </Button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + 40, transactions?.total ?? 0)}
          </span>
          <Button
            variant="outline"
            disabled={!transactions || offset + 40 >= transactions.total}
            onClick={() => setOffset(offset + 40)}
          >
            הבא
          </Button>
        </div>
      </Card>
      <MerchantDialog
        merchant={merchant}
        categories={summary.categories_all}
        open={Boolean(merchant)}
        onOpen={(open) => !open && setMerchant("")}
        onMutate={onMutate}
      />
      <QuestionDialog
        tx={questionTx}
        open={Boolean(questionTx)}
        onOpen={(open) => !open && setQuestionTx(null)}
        onMutate={onMutate}
      />
    </>
  )
}

function MerchantDialog({
  merchant,
  categories,
  open,
  onOpen,
  onMutate,
}: {
  merchant: string
  categories: string[]
  open: boolean
  onOpen: (open: boolean) => void
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [category, setCategory] = useState("")
  const [note, setNote] = useState("")
  const save = async () => {
    if (note.trim())
      await onMutate(
        "/api/notes",
        { merchant, note, category: category || undefined },
        "ההוראה נשמרה והסיווג הוחל"
      )
    else if (category)
      await onMutate(
        "/api/categorize",
        { merchant, category },
        "הקטגוריה עודכנה"
      )
    onOpen(false)
    setNote("")
    setCategory("")
  }
  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ללמד את המערכת</DialogTitle>
          <DialogDescription className="break-words">
            ההוראה תחול גם על תנועות עתידיות של {merchant}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>קטגוריה</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="בחר קטגוריה" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="merchant-note">הערה ליועץ (רשות)</Label>
            <Textarea
              id="merchant-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="לדוגמה: כלי עבודה מקצועי, לא הוצאה פרטית"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpen(false)}>
            ביטול
          </Button>
          <Button
            disabled={!category && !note.trim()}
            onClick={() => void save()}
          >
            שמור והחל
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QuestionDialog({
  tx,
  open,
  onOpen,
  onMutate,
}: {
  tx: Transaction | null
  open: boolean
  onOpen: (open: boolean) => void
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [question, setQuestion] = useState("מה החיוב הזה? אני לא מזהה אותו.")
  const save = async () => {
    if (!tx) return
    await onMutate(
      "/api/questions",
      { tx_id: tx.id, question },
      "השאלה נשמרה ליועץ"
    )
    onOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>שאלה על התנועה</DialogTitle>
          <DialogDescription>
            {tx?.normalized_merchant} · {tx ? money.format(tx.amount_ils) : ""}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpen(false)}>
            ביטול
          </Button>
          <Button onClick={() => void save()}>שמור שאלה</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Commitments({
  summary,
  onMutate,
}: {
  summary: DashboardSummary
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [goalOpen, setGoalOpen] = useState(false)
  const subscriptions = summary.brief.recurring.filter(
    (item) => item.kind === "subscription"
  )
  const recurring = summary.brief.recurring.filter(
    (item) => item.kind === "recurring"
  )
  return (
    <>
      <PageHeading
        title="יעדים והתחייבויות"
        description="כל מה שכבר התחייבת אליו, לצד הדברים שאתה רוצה להשיג—באותו מסך."
        action={
          <Button onClick={() => setGoalOpen(true)}>
            <Plus className="size-4" />
            יעד חדש
          </Button>
        }
      />
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric
          icon={Target}
          label="יעדים פעילים"
          value={String(
            summary.goals.filter((goal) => goal.status === "active").length
          )}
          helper={`${summary.goals.filter((goal) => goal.state === "on_track").length} במסלול`}
        />
        <Metric
          icon={RefreshCw}
          label="חיובים קבועים"
          value={money.format(summary.brief.macro.fixed_monthly)}
          helper={`${summary.brief.macro.fixed_pct_of_income?.toFixed(0) ?? "—"}% מההכנסה`}
        />
        <Metric
          icon={CreditCard}
          label="יתרת תשלומים"
          value={money.format(
            summary.brief.cashflow.future_installment_obligations
          )}
          helper={`${summary.brief.installment_plans.length} פריסות פעילות`}
        />
      </section>
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">היעדים שלי</h2>
          <span className="text-xs text-muted-foreground">
            מחושבים דטרמיניסטית מהנתונים
          </span>
        </div>
        {summary.goals.length === 0 ? (
          <Card className="surface">
            <CompactEmpty
              icon={Target}
              title="עדיין אין יעד"
              description="יעד טוב הופך את המספרים לצעד חודשי ברור."
              action={
                <Button onClick={() => setGoalOpen(true)}>
                  <Plus className="size-4" />
                  הגדר יעד ראשון
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {summary.goals.map((goal) => (
              <GoalCard key={goal.id} goal={goal} onMutate={onMutate} />
            ))}
          </div>
        )}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <RecurringPanel
          title="מנויים דיגיטליים"
          description="שירותים שאפשר בדרך כלל לשנות או לבטל"
          items={subscriptions}
        />
        <RecurringPanel
          title="הוצאות קבועות"
          description="דיור, הלוואות, ביטוח ושירותים"
          items={recurring}
        />
      </section>
      <Card className="surface mt-6">
        <CardHeader>
          <CardTitle>תשלומים פעילים</CardTitle>
          <CardDescription>התקדמות בכל פריסה והיתרה שנותרה</CardDescription>
        </CardHeader>
        <CardContent className="max-h-[560px] overflow-y-auto">
          {summary.brief.installment_plans.length === 0 ? (
            <CompactEmpty
              icon={CheckCircle2}
              title="אין פריסות פעילות"
              description="לא נמצאו עסקאות שנותרו בהן תשלומים."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {summary.brief.installment_plans.map((plan, index) => (
                <div
                  key={`${plan.merchant}-${index}`}
                  className="rounded-xl border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {plan.merchant}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {money.format(plan.monthly_amount)} לחודש
                      </div>
                    </div>
                    <Badge variant="outline">
                      {plan.paid}/{plan.total}
                    </Badge>
                  </div>
                  <Progress
                    className="my-4 h-2"
                    value={(plan.paid / plan.total) * 100}
                  />
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">נותר</span>
                    <span className="numeric font-medium">
                      {money.format(plan.remaining_amount)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between border-t pt-2 text-xs">
                    <span className="text-muted-foreground">סך העסקה</span>
                    <span className="numeric font-medium">
                      {money.format(plan.monthly_amount * plan.total)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <GoalDialog
        open={goalOpen}
        onOpen={setGoalOpen}
        categories={summary.categories_all}
        onMutate={onMutate}
      />
    </>
  )
}

/** Five states from tracking.ts, each with its own reading. */
const GOAL_STATE: Record<
  Goal["state"],
  { label: string; className: string }
> = {
  on_track: {
    label: "במסלול",
    className: "bg-positive/12 text-positive",
  },
  at_risk: {
    label: "הקצב גבוה",
    className: "bg-warn-surface text-warn",
  },
  off_track: {
    label: "חריגה",
    className: "bg-negative/12 text-negative",
  },
  completed: {
    label: "הושג",
    className: "bg-positive/12 text-positive",
  },
  paused: {
    label: "מושהה",
    className: "bg-muted text-muted-foreground",
  },
}

function GoalCard({
  goal,
  onMutate,
}: {
  goal: Goal
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [progress, setProgress] = useState(String(goal.progress))
  return (
    <Card
      className={cn(
        "surface",
        (goal.state === "off_track" || goal.state === "at_risk") &&
          goal.status === "active" &&
          "border-warn-border"
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{goal.title}</CardTitle>
            <CardDescription>
              {goal.category ||
                (goal.deadline
                  ? `עד ${formatDate(goal.deadline)}`
                  : "יעד חודשי")}
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  void onMutate(
                    `/api/goals/${goal.id}/status`,
                    { status: goal.status === "paused" ? "active" : "paused" },
                    goal.status === "paused" ? "היעד הופעל" : "היעד הושהה"
                  )
                }
              >
                {goal.status === "paused" ? (
                  <Check className="size-4" />
                ) : (
                  <Pause className="size-4" />
                )}
                {goal.status === "paused" ? "הפעל" : "השהה"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void onMutate(
                    `/api/goals/${goal.id}/status`,
                    { status: "completed" },
                    "היעד הושלם"
                  )
                }
              >
                <CheckCircle2 className="size-4" />
                סמן כהושלם
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() =>
                  void onMutate(
                    `/api/goals/${goal.id}/status`,
                    { status: "archived" },
                    "היעד הועבר לארכיון"
                  )
                }
              >
                <Trash2 className="size-4" />
                העבר לארכיון
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <div className="numeric text-2xl font-semibold">
              {Math.min(100, Math.max(0, goal.progress_pct)).toFixed(0)}%
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {money.format(goal.current_value)} מתוך{" "}
              {money.format(goal.target_amount)}
            </div>
          </div>
          <Badge className={GOAL_STATE[goal.state]?.className ?? ""}>
            {GOAL_STATE[goal.state]?.label ?? goal.state}
          </Badge>
        </div>
        <Progress
          value={Math.min(100, Math.max(0, goal.progress_pct))}
          className="my-4 h-2"
        />
        <p className="text-sm leading-6 text-muted-foreground">
          {goal.corrective_action}
        </p>
        {goal.type === "save_by_date" && (
          <div className="mt-4 flex gap-2">
            <Input
              type="number"
              min="0"
              value={progress}
              onChange={(event) => setProgress(event.target.value)}
              aria-label="התקדמות נוכחית"
            />
            <Button
              variant="outline"
              onClick={() =>
                void onMutate(
                  `/api/goals/${goal.id}/progress`,
                  { progress: Number(progress) },
                  "התקדמות היעד עודכנה"
                )
              }
            >
              עדכן
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * "Mark as done" — but ask what was actually saved. PLAN §17 makes realized
 * saving over time the platform's quality metric, and until something writes
 * realized_saving_ils the agent can never tell which of its advice worked.
 * The estimate is offered as the default because it is usually close, but it
 * stays editable: the estimate is a guess, this figure is the outcome.
 */
function DoneDialog({
  recommendation,
  onMutate,
}: {
  recommendation: { id: number; title: string; est_saving_ils: number | null }
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const estimate = recommendation.est_saving_ils
  const start = (next: boolean) => {
    setOpen(next)
    if (next) setAmount(estimate != null ? String(Math.round(estimate)) : "")
  }
  const save = async () => {
    const parsed = Number(amount)
    await onMutate(
      `/api/recommendations/${recommendation.id}`,
      {
        status: "done",
        // Blank or invalid means "done, amount unknown" — better to record the
        // action than to force a number the user does not have.
        ...(amount.trim() !== "" && Number.isFinite(parsed) && parsed >= 0
          ? { realized_saving_ils: parsed }
          : {}),
      },
      "ההמלצה סומנה כבוצעה"
    )
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={start}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          סמן כבוצע
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>כמה באמת חסכת?</DialogTitle>
          <DialogDescription>
            {recommendation.title}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`realized-${recommendation.id}`}>
            חיסכון בפועל לחודש (₪)
          </Label>
          <Input
            id={`realized-${recommendation.id}`}
            type="number"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="אפשר להשאיר ריק אם עוד לא ידוע"
          />
          <p className="text-xs text-muted-foreground">
            {estimate != null
              ? `ההערכה של היועץ הייתה ${money.format(estimate)}. עדכן למה שקרה בפועל — זה מה שמלמד את הסוכן אילו המלצות באמת עובדות.`
              : "לא הייתה הערכה להמלצה הזו."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            ביטול
          </Button>
          <Button onClick={() => void save()}>שמור</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GoalDialog({
  open,
  onOpen,
  categories,
  onMutate,
}: {
  open: boolean
  onOpen: (open: boolean) => void
  categories: string[]
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [type, setType] = useState<Goal["type"]>("cap_monthly")
  const [title, setTitle] = useState("")
  const [amount, setAmount] = useState("")
  const [category, setCategory] = useState("")
  const [deadline, setDeadline] = useState("")
  const save = async () => {
    await onMutate(
      "/api/goals",
      {
        title,
        type,
        target_amount: Number(amount),
        category: type === "cut_category" ? category : undefined,
        deadline: type === "save_by_date" ? deadline : undefined,
      },
      "היעד נוצר"
    )
    onOpen(false)
    setTitle("")
    setAmount("")
  }
  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>יעד פיננסי חדש</DialogTitle>
          <DialogDescription>
            ההתקדמות תחושב מהנתונים המקומיים ותופיע גם ליועץ.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>סוג יעד</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as Goal["type"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cap_monthly">תקרת הוצאות חודשית</SelectItem>
                <SelectItem value="cut_category">תקרה לקטגוריה</SelectItem>
                <SelectItem value="save_by_date">חיסכון עד תאריך</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-title">שם היעד</Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="לדוגמה: לא לעבור 20,000 ₪ החודש"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-amount">סכום יעד</Label>
            <Input
              id="goal-amount"
              type="number"
              min="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          {type === "cut_category" && (
            <div className="grid gap-2">
              <Label>קטגוריה</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר קטגוריה" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "save_by_date" && (
            <div className="grid gap-2">
              <Label htmlFor="goal-date">תאריך יעד</Label>
              <Input
                id="goal-date"
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpen(false)}>
            ביטול
          </Button>
          <Button
            disabled={
              !title.trim() ||
              !Number(amount) ||
              (type === "cut_category" && !category) ||
              (type === "save_by_date" && !deadline)
            }
            onClick={() => void save()}
          >
            צור יעד
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecurringPanel({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: DashboardSummary["brief"]["recurring"]
}) {
  const active = items.filter((item) => item.status === "active")
  const dormantCount = items.length - active.length
  const activeMonthly = active.reduce(
    (sum, item) => sum + item.avg_monthly_amount,
    0
  )
  const sortedItems = [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1
    return b.avg_monthly_amount - a.avg_monthly_amount
  })
  return (
    <Card className="surface" data-testid="recurring-panel">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description} · {active.length} פעילים · {money.format(activeMonthly)}
          /חודש
          {dormantCount > 0 ? ` · ${dormantCount} נעצרו` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-[560px] overflow-y-auto">
        {items.length === 0 ? (
          <CompactEmpty
            icon={RefreshCw}
            title="אין חיובים חוזרים"
            description="לא זוהה דפוס קבוע מהסוג הזה."
          />
        ) : (
          <div className="grid gap-2">
            {sortedItems.map((item) => (
              <div
                key={item.merchant}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    item.status === "active"
                      ? "bg-primary/12 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <RefreshCw className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.merchant}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    חיוב אחרון {money.format(item.last_amount)} ·{" "}
                    {formatDate(item.last_date)}
                  </div>
                  {item.deviation_pct != null &&
                    Math.abs(item.deviation_pct) >= 10 && (
                      <div
                        className={cn(
                          "mt-1 text-xs",
                          item.deviation_pct > 0
                            ? "text-negative"
                            : "text-positive"
                        )}
                      >
                        {item.deviation_pct > 0 ? "התייקרות" : "ירידה"} של{" "}
                        {Math.abs(item.deviation_pct).toFixed(0)}% מהדפוס הרגיל
                      </div>
                    )}
                </div>
                <div className="text-left">
                  <div className="numeric text-sm font-semibold">
                    {money.format(item.avg_monthly_amount)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    ממוצע לחודש
                  </div>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {item.status === "active"
                      ? "פעיל"
                      : `נעצר · לפני ${item.days_since_last} ימים`}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Manage({
  summary,
  onMutate,
}: {
  summary: DashboardSummary
  onMutate: (path: string, body: unknown, message: string) => Promise<void>
}) {
  const [deleteMerchant, setDeleteMerchant] = useState("")
  const questions = [...summary.questions].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "open" ? -1 : 1
  )
  const openQuestions = questions.filter(
    (question) => question.status === "open"
  )
  return (
    <>
      <PageHeading
        title="ניהול המערכת"
        description="שאלות פתוחות, הוראות שלימדת את היועץ, דוחות מקומיים ובריאות התהליך האוטומטי."
      />
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]">
        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleQuestion className="size-4 text-primary" />
              שאלות על חיובים
            </CardTitle>
            <CardDescription>
              {openQuestions.length} פתוחות · תשובות ושאלות שטופלו נשמרות
              בהיסטוריה
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[760px] overflow-y-auto">
            {questions.length === 0 ? (
              <CompactEmpty
                icon={CheckCircle2}
                title="אין שאלות"
                description="אפשר לשאול את היועץ מתוך פעולות התנועה במסך ההוצאות."
              />
            ) : (
              <div className="grid gap-3">
                {questions.map((question) => (
                  <div key={question.id} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">
                          {question.question}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {question.merchant} · {formatDate(question.date)}
                        </div>
                      </div>
                      <span className="numeric text-sm font-semibold">
                        {money.format(question.amount)}
                      </span>
                    </div>
                    {question.answer ? (
                      <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm leading-6">
                        <span className="font-medium">תשובת היועץ: </span>
                        {question.answer}
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-muted-foreground">
                        ממתין לתשובת היועץ בריצת advise הבאה
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <Badge variant="outline">
                        {question.status === "open" ? "פתוחה" : "טופלה"}
                      </Badge>
                      {question.status === "open" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void onMutate(
                              `/api/questions/${question.id}/resolve`,
                              {},
                              "השאלה סומנה כטופלה"
                            )
                          }
                        >
                          <Check className="size-4" />
                          סמן כטופל
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              בריאות המערכת
            </CardTitle>
            <CardDescription>הכול נשאר מקומי ובקריאה בלבד</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SystemRow
              label="סריקת התראות"
              value={
                summary.last_event_scan
                  ? formatDate(summary.last_event_scan.scanned_at)
                  : "טרם רצה"
              }
              status={Boolean(summary.last_event_scan)}
            />
            <SystemRow
              label="מקורות שעודכנו"
              value={`${summary.last_ingest.length} ספקים`}
              status={summary.last_ingest.length > 0}
            />
            <SystemRow
              label="הרצות אוטומציה"
              value={`${summary.automation_runs.length} משימות`}
              status={summary.automation_runs.length > 0}
            />
            <SystemRow label="פרטיות" value="DB מקומי בלבד" status />
            {(summary.last_ingest.length > 0 ||
              summary.automation_runs.length > 0) && (
              <details className="rounded-lg border p-3">
                <summary className="focus-ring cursor-pointer text-sm font-medium">
                  פירוט פעילות אחרונה
                </summary>
                <div className="mt-3 grid gap-2 text-xs">
                  {summary.last_ingest.map((item) => (
                    <div
                      key={item.provider}
                      className="flex justify-between gap-3"
                    >
                      <span>משיכת {item.provider}</span>
                      <span className="text-muted-foreground">
                        {fullDate.format(new Date(item.updated_at))}
                      </span>
                    </div>
                  ))}
                  {summary.automation_runs.map((item) => (
                    <div key={item.job} className="flex justify-between gap-3">
                      <span>{item.job}</span>
                      <span className="truncate text-muted-foreground">
                        {item.value || formatDate(item.updated_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <Alert className="mt-2">
              <ShieldCheck />
              <AlertTitle>מצב קריאה בלבד</AlertTitle>
              <AlertDescription>
                אין במערכת פעולות תשלום, העברה או שינוי בחשבון הבנק.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="surface">
          <CardHeader>
            <CardTitle>הוראות שלימדת</CardTitle>
            <CardDescription>
              הקשר שהמערכת זוכרת על ספקים ושירותים
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[760px] overflow-y-auto">
            {summary.merchant_notes.length === 0 ? (
              <CompactEmpty
                icon={BookOpenCheck}
                title="אין הוראות שמורות"
                description="אפשר להוסיף הערה מתוך מסך ההוצאות."
              />
            ) : (
              <div className="grid gap-2">
                {summary.merchant_notes.map((note) => (
                  <div
                    key={note.merchant}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <BookOpenCheck className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {note.merchant}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {note.flag === "cancel" && (
                          <Badge
                            variant="outline"
                            className="border-warn-border text-warn"
                          >
                            לביטול
                          </Badge>
                        )}
                        {note.category && (
                          <Badge variant="secondary">{note.category}</Badge>
                        )}
                        {note.flag === "cancel" && (
                          <Badge
                            variant="outline"
                            className={cn(
                              (note.days_since ?? 0) > 45
                                ? "text-positive"
                                : "text-negative"
                            )}
                          >
                            {note.last_charge
                              ? `${(note.days_since ?? 0) > 45 ? "רדום" : "עדיין פעיל"} · חיוב אחרון ${formatDate(note.last_charge)} · ${money.format(note.last_amount ?? 0)}`
                              : "לא נמצאו חיובים"}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {note.note}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteMerchant(note.merchant)}
                      aria-label={`מחיקת הוראה עבור ${note.merchant}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              דוחות מקומיים
            </CardTitle>
            <CardDescription>
              קבצי Markdown נשמרים מקומית בהרשאות מוגבלות
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  void onMutate(
                    "/api/reports",
                    { period: "weekly", month: summary.month },
                    "דוח שבועי נוצר מקומית"
                  )
                }
              >
                <FileText className="size-4" />
                צור דוח שבועי
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void onMutate(
                    "/api/reports",
                    { period: "monthly", month: summary.month },
                    "דוח חודשי נוצר מקומית"
                  )
                }
              >
                <CalendarDays className="size-4" />
                צור דוח חודשי
              </Button>
            </div>
            <Separator className="my-5" />
            {summary.reports.length === 0 ? (
              <CompactEmpty
                icon={FileText}
                title="עדיין אין דוחות"
                description="הדוח הראשון יופיע כאן לאחר יצירה."
              />
            ) : (
              <div className="grid gap-2">
                {summary.reports.map((report) => (
                  <div
                    key={`${report.period}-${report.updated_at}`}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <FileText className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        דוח {report.period === "weekly" ? "שבועי" : "חודשי"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {report.path}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(report.generated_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      <AlertDialog
        open={Boolean(deleteMerchant)}
        onOpenChange={(open) => !open && setDeleteMerchant("")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את ההוראה?</AlertDialogTitle>
            <AlertDialogDescription>
              המערכת תשכח את ההקשר ששמרת עבור {deleteMerchant}. תנועות קיימות לא
              יימחקו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void onMutate(
                  "/api/notes/delete",
                  { merchant: deleteMerchant },
                  "ההוראה נמחקה"
                )
                setDeleteMerchant("")
              }}
            >
              מחק הוראה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SystemRow({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={cn(
            "size-2 rounded-full",
            status ? "bg-positive" : "bg-warn"
          )}
        />
        {label}
      </div>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

function CompactEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Search
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <Empty className="min-h-[180px] border-0 p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-md">
      <div className="mb-2 text-muted-foreground">{label}</div>
      {payload.map((item) => (
        <div
          key={item.name}
          className="mt-1 flex min-w-[150px] items-center justify-between gap-4"
        >
          <span>{item.name}</span>
          <span className="numeric font-medium">
            {money.format(item.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function AppSkeleton() {
  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      </div>
      <Skeleton className="mt-12 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-[420px] max-w-full" />
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[320px] lg:col-span-2" />
        <Skeleton className="h-[320px]" />
      </div>
      <GridSkeleton />
    </div>
  )
}
function GridSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-28" />
      ))}
    </div>
  )
}

export default App
