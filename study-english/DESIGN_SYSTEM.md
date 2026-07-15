# Pulse English - Design System & UI Specs

## 1. Complete Design System

### Product Category Fit
**Pulse English** is an EdTech + Language Learning + Habit-building product aimed at Gen Z, college students, and young professionals. It replaces high-pressure exam cramming with lightweight, rewarding, and confidence-building daily sessions.

### Recommended Pattern & Style Mix
- **Primary Aesthetic:** Soft UI Evolution (clean, light mode first, airy)
- **Secondary Aesthetic:** Claymorphism (tactile, friendly, deformable surfaces)
- **Accents:** Modern minimal UI with gentle gamification. Avoid neon chaos; embrace fresh, clean momentum.

### Color Tokens
- **Backgrounds:** `var(--page-bg)` #f8fafc (Clean warm white/slate)
- **Surfaces:** `var(--surface-default)` #ffffff, `var(--surface-raised)` #ffffff
- **Primary:** `var(--brand-primary)` #10b981 (Fresh Mint), Light: #d1fae5, Dark: #059669
- **Secondary:** `var(--brand-secondary)` #0ea5e9 (Sky Blue)
- **Accent:** `var(--brand-accent)` #f97316 (Coral/Apricot)
- **Text:** `var(--text-primary)` #0f172a (Charcoal), `var(--text-secondary)` #475569 (Slate)

### Typography System
- **Headings (Display):** Plus Jakarta Sans (or Outfit), weight: 600-700, tight tracking.
- **Body:** Inter, weight: 400-500, relaxed line-height (1.5 - 1.6).

### Spacing Scale & Radii
- **Radii:** Extreme rounded corners. `sm: 16rpx`, `md: 24rpx`, `lg: 32rpx`, `xl: 48rpx`, `full: 9999px`.
- **Spacing:** Base 8rpx scale. `p-4 (32rpx)`, `p-6 (48rpx)` for breathable sections.

### Shadow System
- **Soft Shadows:** `0 8rpx 24rpx rgba(15, 23, 42, 0.06)` for cards.
- **Clay Shadows:** `inset 0 -8rpx 0 rgba(0,0,0,0.04), inset 0 8rpx 0 rgba(255,255,255,0.8), 0 16rpx 32rpx rgba(15, 23, 42, 0.05)` for primary tactile buttons.

### Icon Rules
- Lucide or Heroicons (stroke width 2px, rounded). No emojis for core navigation. Soft pastel background shapes behind icons.

### Motion Rules
- 180–250ms smooth cubic-bezier transitions (`cubic-bezier(0.16, 1, 0.3, 1)`).
- Gentle scale-down on active press (`transform: scale(0.97)`).

### Anti-patterns to Avoid
- No dark heavy dashboards.
- No childish mascots or cluttered sticker visuals.
- No generic AI gradients (pink/purple).
- No anxiety-inducing red warning colors for mistakes. Use gentle coaching colors.

---

## 2. Page-by-Page UI Specs

### 1. Onboarding & Goal Selection
- **Layout:** Edge-to-edge breathable background. Large headline "Your Fresh Start in English".
- **Interaction:** Selectable large clay cards for Goals (e.g., "Career", "Travel"). Smooth transition on selection.
- **CTA:** Bottom-fixed bouncy Primary Button.

### 2. Home Dashboard
- **Header:** Personalized greeting ("Morning, Alex"), current streak badge (fire icon, orange text), and an avatar.
- **Primary Card:** "Continue Learning" large mint-colored clay card with today's lesson title and progress ring.
- **Secondary Cards:** 2-column grid. "Word Review" (Sky Blue) and "Speaking Challenge" (Coral).
- **Gamification:** Small horizontal scroll for daily achievements or XP progress bar.

### 3. Learn Path (Roadmap)
- **Layout:** Vertical timeline with connected nodes.
- **Node States:** Locked (greyed out, low opacity), Current (pulsing mint border, large shadow), Completed (solid mint with checkmark).

### 4. Vocabulary Flashcards
- **Card UI:** Absolute center screen, massive 48rpx border radius.
- **Typography:** Enormous English word in display font. Phonetic spelling below it.
- **Actions:** Tactile "Flip" and "Got it / Need Review" buttons floating below.

### 5. Speaking Practice
- **Visuals:** Audio waveform visualization (animated). Soft glowing orb when recording.
- **Feedback:** Confidence score ring. "Great pronunciation!" in mint green.

### 6. Profile & Progress
- **Layout:** Avatar, Total XP, and Level badge.
- **Stats:** Bento-grid style stat cards for "Words Mastered", "Days Active", and "Speaking Score".
