# 交个朋友·广告智投工作台 — UI Redesign Specification
**Version**: 1.0 | **Date**: 2026-04-30 | **Status**: Draft for Review

---

## 1. Design Philosophy

### Core Principles
1. **Role-First**: Every screen is designed for a specific user role. If the design doesn't serve a role's actual task, it's wrong.
2. **Signal over Noise**: The most important thing is visible in 2 seconds. Secondary info lives one click away.
3. **Confidence, not Clutter**: Each view answers exactly one question. If it's answering two, split it.
4. **Consistency everywhere**: One design system, one token set, one pattern library. No exceptions.

### What Stays the Same
- Purple gradient brand identity (preserves brand recognition)
- Card-based layout structure (users already understand it)
- Supabase + Feishu auth stack (already working)

### What Changes
- Information architecture — reorganized by role task flows
- Layout system — sidebar → role-specific workspaces
- Data density — more data per screen, but better hierarchy
- Component library — consistent, accessible, composable tokens

---

## 2. Color & Token System

### Brand Colors (refined, not replaced)
```
--brand-primary:       #6B5CE7   /* Slightly richer purple */
--brand-primary-hover: #5946D4
--brand-secondary:    #A78BFA   /* Lighter purple for accents */
--brand-accent:       #F472B6   /* Pink accent for alerts/CTAs */
--brand-gradient:     linear-gradient(135deg, #6B5CE7 0%, #A78BFA 100%)

/* Neutrals */
--bg-base:            #F8F7FF   /* Warm off-white with subtle purple tint */
--bg-surface:         #FFFFFF
--bg-elevated:        #FAFAFF
--bg-sidebar:         #1E1B3A   /* Deep purple-black for sidebar */
--bg-sidebar-hover:  #2A2750

--text-primary:       #1A1730   /* Near-black with warmth */
--text-secondary:     #5B5780
--text-muted:         #9490B0
--text-on-dark:       #FFFFFF
--text-on-dark-muted: rgba(255,255,255,0.65)

/* Borders */
--border-subtle:      #E8E4FF
--border-default:     #D4CCFF
--border-strong:      #B8ACFF

/* Semantic */
--success:            #059669
--success-bg:        #ECFDF5
--warning:            #D97706
--warning-bg:        #FFFBEB
--error:             #DC2626
--error-bg:          #FEF2F2
--info:              #2563EB
--info-bg:           #EFF6FF
```

### Typography Scale
```
--font-family:        "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
--font-mono:          "JetBrains Mono", "Fira Code", monospace

--text-xs:            11px / 1.4
--text-sm:            13px / 1.5
--text-base:          15px / 1.7
--text-lg:            17px / 1.5
--text-xl:            20px / 1.4
--text-2xl:           24px / 1.3
--text-3xl:           30px / 1.2

/* Weight scale */
--font-normal:        400
--font-medium:        500
--font-semibold:      600
--font-bold:          700
```

### Spacing System (4pt grid)
```
--space-1:   4px
--space-2:   8px
--space-3:   12px
--space-4:   16px
--space-5:   20px
--space-6:   24px
--space-8:   32px
--space-10:  40px
--space-12:  48px
--space-16:  64px
```

### Border Radius Scale
```
--radius-sm:  6px
--radius-md:  10px
--radius-lg:  16px
--radius-xl:  24px
--radius-2xl: 32px
--radius-full: 9999px
```

### Shadow System
```
--shadow-sm:  0 1px 3px rgba(26,23,48,0.06), 0 1px 2px rgba(26,23,48,0.04)
--shadow-md:  0 4px 12px rgba(26,23,48,0.08), 0 2px 4px rgba(26,23,48,0.04)
--shadow-lg:  0 12px 32px rgba(26,23,48,0.10), 0 4px 8px rgba(26,23,48,0.05)
--shadow-xl:  0 24px 48px rgba(26,23,48,0.12), 0 8px 16px rgba(26,23,48,0.06)
--shadow-glow: 0 0 0 3px rgba(107,92,231,0.15)
```

### Motion Tokens
```
--duration-fast:    120ms
--duration-base:    200ms
--duration-slow:    350ms
--ease-default:     cubic-bezier(0.4, 0, 0.2, 1)
--ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1)
--ease-out:         cubic-bezier(0, 0, 0.2, 1)
```

---

## 3. Layout Architecture

### Global Layout (All Pages)
```
┌─────────────────────────────────────────────────────┐
│  Sidebar (240px fixed)  │  Main Content Area         │
│  ─────────────────────  │  ─────────────────────────  │
│  Logo + Brand           │  Page Header               │
│  ─────────────────────  │  (title + breadcrumb)       │
│  Role Switcher          │  ─────────────────────────  │
│  ─────────────────────  │  Content Zone              │
│  Nav Groups            │  (role-specific)           │
│    · Monitor           │                            │
│    · Analyze          │                            │
│    · Archive          │                            │
│    · Configure        │                            │
│  ─────────────────────  │                            │
│  User Profile         │                            │
└─────────────────────────────────────────────────────┘
```

### Sidebar Design (NEW)
- Dark background (#1E1B3A) for visual anchoring and contrast
- Logo area with brand gradient accent
- **Role Switcher**: Toggle between 投手/运营/管理者 — changes which nav items are highlighted and what's shown in main area
- **Nav groups**: Organized by workflow step (Monitor → Analyze → Archive → Configure), not by page
- **Active state**: Left purple border accent + background tint
- **User area**: Avatar, name, quick logout — always visible at bottom

### Page Header Design
```
┌────────────────────────────────────────────────────┐
│  [← Back? optional]   Page Title          [Actions] │
│  Subtitle / context text                            │
└────────────────────────────────────────────────────┘
```
- Page title: 24px, semibold, left-aligned
- Context: 13px, muted color, describes what's shown
- Actions: Right-aligned, primary action is a filled button, secondary actions are icon buttons or text links

### Responsive Strategy
- **Desktop (1280px+)**: Full sidebar + content
- **Tablet (768-1279px)**: Collapsible sidebar (icon-only mode), expandable on hover
- **Mobile (< 768px)**: Bottom navigation bar replaces sidebar

---

## 4. Component Library

### 4.1 Navigation Components

#### Sidebar Nav Item
```
States: default | hover | active | disabled
- Default: icon + label, text-muted color
- Hover: bg-sidebar-hover, text-on-dark
- Active: left border 3px brand-primary, bg rgba(107,92,231,0.15), text-on-dark
- Badge: red dot for unread/new (optional)
```

#### Role Switcher
```
[🎯 投手] [📊 运营] [👁 管理者]
- Pill tabs, horizontal layout
- Active: brand-gradient background, white text
- Inactive: transparent bg, text-on-dark-muted, hover shows border
- Switching role updates sidebar highlight AND main content context
```

### 4.2 Data Display Components

#### Metric Card (KPI Display)
```
┌─────────────────────────────────┐
│  Label              [trend arrow] │
│  ───────────────────────────────  │
│  Value (large, bold)             │
│  ───────────────────────────────  │
│  Comparison / Change            │
└─────────────────────────────────┘
Variants: neutral | positive (green) | negative (red) | warning (amber)
- Use color semantics, not just text
- Trend: ↑ green, ↓ red, → neutral (convention: down = bad for ROI, up = bad for cost if over budget)
```

#### Data Table
```
- Sticky header with sort indicators
- Zebra rows (subtle, --bg-base)
- Row hover: highlight with --border-subtle border
- Inline actions: appear on row hover (edit, view, delete)
- Empty state: illustration + action CTA
- Loading state: skeleton rows (pulse animation)
- Pagination: bottom right, showing "1-20 of 149"
```

#### Chart Card
```
┌─────────────────────────────────┐
│  Title         [time-range-sel]  │
│  ────────────────────────────   │
│  [Chart Area]                   │
│  ────────────────────────────   │
│  Legend (if needed)            │
└─────────────────────────────────┘
- Chart types: Line (trend), Bar (comparison), Donut (composition)
- Tooltip: dark background card with values
- Responsive: scrollable on small screens with touch-friendly handles
```

### 4.3 Form Components

#### Input Field
```
States: default | focus | error | disabled | readonly
- Default: border --border-default, bg white
- Focus: border --brand-primary, box-shadow --shadow-glow
- Error: border --error, red label below, red bg tint
- Label: above field, 13px medium
- Helper text: below field, 12px muted
- Required: red asterisk
```

#### Select / Dropdown
```
- Native select styled OR custom dropdown
- Search filter for long lists (> 10 items)
- Multi-select with chips variant
```

#### Button
```
Variants: primary | secondary | ghost | danger
Sizes: sm (32px) | md (40px) | lg (48px)

Primary:
  bg: brand-gradient
  color: white
  hover: brightness(1.05) + translateY(-1px) + shadow
  active: translateY(0) + reduced shadow
  disabled: opacity 0.5

Secondary:
  bg: white
  border: --border-strong
  color: --text-primary
  hover: bg --bg-base

Ghost:
  bg: transparent
  color: --text-secondary
  hover: bg --bg-base

Danger:
  bg: --error
  color: white
  hover: --error with brightness adjustment
```

#### Date Range Picker
```
Preset options: 今日 | 昨日 | 近7天 | 近30天 | 本月 | 上月 | 自定义
Calendar: two-month view for range selection
Time: optional time pickers for precise ranges
```

### 4.4 Feedback Components

#### Toast / Notification
```
Position: top-right, stacked
Types: success (green) | error (red) | warning (amber) | info (blue)
Auto-dismiss: 5s (adjustable), pause on hover
Action: optional inline action link
```

#### Loading States
```
- Skeleton: pulse animation, matches content shape
- Spinner: only for small actions (< 5s expected)
- Progress bar: for known-duration operations
- Full-page loading: large spinner + context message
```

#### Empty State
```
┌──────────────────────────────────────┐
│  [Illustration]                      │
│  标题：暂无数据                      │
│  说明：描述为什么没有 + 期望行为      │
│  [Primary CTA] [Secondary CTA]       │
└──────────────────────────────────────┘
```

---

## 5. Page-by-Page Redesign

### 5.1 首页 (index.rewrite.html)

**Current Pain Points:**
- Role selection cards feel like a quiz, not a dashboard
- Hero section takes too much space
- Latest insights section is below the fold but should be more prominent for returning users

**Redesign:**
```
┌────────────────────────────────────────────────────┐
│  Sidebar: [Role = Trader Active by Default]         │
│  ──────────────────────────────────────────────── │
│  Main:                                             │
│  ┌─ Quick Stats Bar ───────────────────────────┐ │
│  │  [今日花费] [今日ROI] [异常数] [待处理洞察]  │ │
│  └──────────────────────────────────────────────┘ │
│  ┌─ Role Workspace ──────────────────────────────┐ │
│  │  [根据当前角色显示不同内容]                  │ │
│  │                                              │ │
│  │  Trader: Live KPIs + Recent Alerts + Quick   │ │
│  │  Action to run AI analysis                   │ │
│  │                                              │ │
│  │  Operator: Recent Reports + Team Activity     │ │
│  │  + Pending Reviews                          │ │
│  │                                              │ │
│  │  Manager: Executive Summary + Key Metrics   │ │
│  │  + Week-over-Week trends                    │ ���
│  └──────────────────────────────────────────────┘ │
│  ┌─ Insights Feed ──────────────────────────────┐ │
│  │  [Latest AI reports, scrollable card list]    │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**Key Changes:**
1. Remove hero section (wasteful for returning users)
2. Add quick stats bar — always visible
3. Role workspace is the main content area
4. Insights feed is prominent, not buried
5. Responsive: quick stats become a swipeable row on mobile

### 5.2 数据看板 (supabase-dashboard.rewrite.html)

**Current Pain Points:**
- Too many metrics shown at once — hard to find the signal
- Date range selector buried in toolbar
- Charts don't tell you what changed and why

**Redesign:**
```
┌────────────────────────────────────────────────────┐
│  Page Header: 数据看板              [日期范围][刷新] │
│  Subtitle: 实时监控 · 最后更新 3分钟前              │
│  ───────────────────────────────────────────────── │
│  ┌─ KPI Strip ──────────────────────────────────┐   │
│  │ [花费] [ROI] [转化数] [CPM] [CPC] [CTR]     │   │
│  └─────────────────────────────────────────────┘   │
│  ───────────────────────────────────────────────── │
│  ┌─ Alert Feed (left 40%) ─┐ ┌─ Charts (right 60%)┐ │
│  │ [Real-time alerts,    ] │ [ROI trend line]   │ │
│  │  color-coded by risk]  │ [Spend bar chart]   │ │
│  └────────────────────────┘ └───────────────────┘   │
│  ───────────────────────────────────────────────── │
│  ┌─ Plan Performance Table ─────────────────────┐ │
│  │ [Sortable, filterable, with sparklines]        │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**Key Changes:**
1. Date range prominently in header
2. KPI strip uses color semantics (green=good, red=concern)
3. Alert feed is LEFT of charts — alerts are more important than trend charts
4. Table is the last section — most detail-oriented view
5. "Last updated" timestamp — builds trust in data freshness

### 5.3 GenBI AI分析 (genbi.rewrite.html)

**Current Pain Points:**
- Question input is too small
- Example questions list is cluttered
- Result display has complex markdown that doesn't render well

**Redesign:**
```
┌────────────────────────────────────────────────────┐
│  Page Header: GenBI              [History] [Rules] │
│  ────────────────────────────────────────────────── │
│  ┌─ Query Panel ───────────────────────────────┐   │
│  │                                              │   │
│  │  Large textarea (200px min)                │   │
│  │  Placeholder: "描述你想了解的问题..."       │   │
│  │                                              │   │
│  │  [Attachment] [Clear] ─────── [Run Analysis]│   │
│  └──────────────────────────────────────────────┘   │
│  ────────────────────────────────────────────────── │
│  ┌─ Example Questions ──────────────────────────┐   │
│  │  [Chip] [Chip] [Chip] [+ Add to favorites]    │   │
│  └──────────────────────────────────────────────┘   │
│  ────────────────────────────────────────────────── │
│  ┌─ Result Panel ───────────────────────────────┐   │
│  │  Report title + date range                   │   │
│  │  ─────────────────────────────────────────  │   │
│  │  [Rendered markdown article with]           │   │
│  │   proper heading hierarchy,                   │   │
│  │   callout boxes, tables                      │   │
│  │  ─────────────────────────────────────────  │   │
│  │  [Save to Insights] [Copy] [Export]        │   │
│  └──────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

**Key Changes:**
1. Larger, more comfortable textarea (200px min)
2. Example questions as clickable chips, not a list
3. Better markdown rendering with semantic HTML
4. Action buttons in result panel (save, copy, export)
5. History panel accessible via header button

### 5.4 洞察中心 (insights.rewrite.html)

**Current Pain Points:**
- Report list doesn't filter well by role
- Risk level colors are hard to distinguish
- Tags are visual noise

**Redesign:**
```
┌───────────────────────��────────────────────────────┐
│  Page Header: 洞察中心          [New Analysis] [Export] │
│  ────────────────────────────────────────────────── │
│  ┌─ Filter Bar ──────────────────────────────────┐   │
│  │ [报告] [经营洞察] [周会复盘] | [风险等级▾]  │   │
│  │ Search: ___________  Sort: [最新 ▾]          │   │
│  └──────────────────────────────────────────────┘   │
│  ────────────────────────────────────────────────── │
│  ┌─ Insights Grid ──────────────────────���────────┐   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐           │   │
│  │  │ Card   │ │ Card   │ │ Card   │           │   │
│  │  └────────┘ └────────┘ └────────┘           │   │
│  └──────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

**Card Design:**
```
┌────────────────────────────────────┐
│  [Risk Badge]         [Date]         │
│  ───────────────────────────────── │
│  Report Title (bold)               │
│  ───────────────────────────────── │
│  Summary text (2 lines max)         │
│  ───────────────────────────────── │
│  [ROI] [去退ROI] | [Tags...]      │
│  [View →]                         │
└────────────────────────────────────┘
```

### 5.5 Prompt管理 (prompt-admin.rewrite.html)

**Current Pain Points:**
- Too technical for non-technical operators
- No preview of what the prompt actually produces
- Edit mode is disruptive

**Redesign:**
```
┌────────────────────────────────────────────────────┐
│  Page Header: Prompt 管理      [New Prompt] [Templates]  │
│  ────────────────────────────────────────────────── │
│  ┌─ Prompt List (left 45%) ─┐ ┌─ Preview (right 55%)┐ │
│  │ [Search + filter]       │ │ Live preview of      │ │
│  │  • Prompt A            │ │  selected prompt     │ │
│  │  • Prompt B            │ │  output              │ │
│  │  • Prompt C            │ │                      │ │
│  └────────────────────────┘ └─────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**Key Changes:**
1. Split view: list on left, live preview on right
2. Inline editing instead of modal
3. "Test" button to run with sample data

---

## 6. Interaction Patterns

### 6.1 Onboarding Flow (First Visit)
1. Role selection screen (pick one, can change later)
2. Quick tour of the selected role's workspace (3 screens, skippable)
3. Land on the role's homepage

### 6.2 Alert → Analysis → Archive Flow
```
1. Alert appears in feed (highlighted, pulse animation)
2. User clicks → expands inline to show context
3. "Run AI Analysis" button pre-fills the question
4. Analysis result shows in GenBI panel
5. "Save to Insights" saves to archive
6. Alert marked as resolved
```

### 6.3 Date Range Behavior
- Default: "近7天" for most views
- "今日" for real-time dashboards
- Date picker remembers last selection per user
- URL params encode date range for shareable links

### 6.4 Error Handling
- API errors: inline red banner with retry button (don't clear the form)
- Auth errors: redirect to login with return URL preserved
- Empty states: friendly illustration + action button

---

## 7. Accessibility (A11y) Requirements

- All interactive elements keyboard-accessible (Tab, Enter, Escape)
- Focus states: 2px solid brand-primary with 2px offset
- Color contrast: WCAG AA minimum (4.5:1 for text, 3:1 for UI)
- ARIA labels on all icon-only buttons
- Screen reader announces: role changes, alert arrivals, loading states
- Motion: respect `prefers-reduced-motion`

---

## 8. Implementation Phases

### Phase 1 — Foundation (Do First)
1. Update CSS token system (variables, typography, shadows)
2. Build new sidebar component
3. Apply new button/input/table components globally
4. Apply new layout shell to all pages

### Phase 2 — Homepage (Quick Win)
1. Redesign quick stats bar
2. Add role switcher to sidebar
3. Implement role workspace areas
4. Remove hero section

### Phase 3 — Dashboard
1. Implement KPI strip with color semantics
2. Redesign alert feed
3. Update chart cards
4. Improve date range picker UX

### Phase 4 — GenBI
1. Redesign query panel (larger textarea)
2. Implement example chips
3. Improve markdown rendering
4. Add result actions (save, copy)

### Phase 5 — Polish
1. Transitions and micro-animations
2. Empty/loading/error states
3. Mobile responsiveness
4. Accessibility audit

---

## 9. Migration Notes

### CSS Changes
- Keep old `style.css` as `style-legacy.css`
- Create new `design-system.css` for tokens
- Create new `layout.css` for shell
- Create new `components.css` for component library
- Old pages load both legacy + new system files
- New pages load only new system files

### JavaScript Changes
- Dashboard modules remain functional (no changes needed)
- Sidebar state managed in new `shell.js`
- Role switcher state in `auth.js`
- No backend changes required

### File Naming
- New versions: `*.rewrite.html`
- New CSS: `ds-*.css`
- Old files: keep in place, deprecated via comments
- Remove after 6-month transition period