# Component Architecture Guide

## Server vs Client Component Boundaries

### Current Architecture

This application uses Next.js App Router with a hybrid server/client component architecture.

### Component Classification

#### Server Components (Default)
Files without `'use client'` directive. Used for:
- Static layouts and page shells
- Components that don't need browser APIs
- Initial HTML rendering

**Current Server Components:**
- `app/page.tsx` - Dashboard page shell
- `app/layout.tsx` - Root layout (imports client components)

#### Client Components
Files with `'use client'` directive. Required for:
- Hooks (useState, useEffect, useContext)
- Browser APIs (localStorage, window)
- Event handlers (onClick, onChange)
- Auth context access
- Real-time data fetching

**Current Client Components:**
- All `/components/ui/*` - Interactive UI primitives
- All `/components/dashboard/*` - Data-fetching widgets
- All `/components/players/*` - Video players (WebRTC, HLS)
- All `/components/layout/*` - Navigation with auth state
- All `/app/*/page.tsx` (except dashboard) - Interactive pages

### Boundary Decisions

#### Why Dashboard Children are Client Components
```
app/page.tsx (Server)
├── StatsGrid (Client) - Fetches stats, auto-refresh
├── StreamResources (Client) - Real-time stream status
├── SystemHealth (Client) - Live health monitoring
└── RecentActivity (Client) - Activity timeline
```

Each dashboard widget needs:
1. `useEffect` for data fetching
2. `useState` for loading/error states
3. Auth context for API calls
4. Auto-refresh intervals

#### Why Pages are Client Components
- `devices/page.tsx` - CRUD operations, forms
- `streams/page.tsx` - Stream controls, modals
- `snapshots/page.tsx` - Image gallery, previews
- `bookmarks/page.tsx` - Video playback, filters

### Optimization Opportunities

#### Already Optimized
1. **Dashboard page** is a server component that composes client widgets
2. **Layout** imports client components at the boundary
3. **UI components** are properly marked as client

#### Potential Future Optimizations

1. **Split data-display from data-fetching**
   ```tsx
   // StatsGridContainer.tsx (Client) - handles fetching
   // StatsGridDisplay.tsx (Server) - pure rendering
   ```

2. **Server Actions for mutations**
   ```tsx
   // Instead of client-side API calls
   'use server'
   export async function createDevice(data: FormData) { }
   ```

3. **Streaming with Suspense**
   ```tsx
   <Suspense fallback={<SkeletonStatsGrid />}>
     <StatsGrid />
   </Suspense>
   ```

### Best Practices

1. **Keep `'use client'` as low as possible** in the component tree
2. **Pass server data as props** when possible
3. **Use Suspense boundaries** for loading states
4. **Colocate client code** - if a component needs interactivity, make the whole thing client

### File Structure

```
components/
├── ui/           # Client - Interactive primitives
├── layout/       # Client - Auth-aware navigation
├── dashboard/    # Client - Data widgets
├── players/      # Client - Video players
├── auth/         # Client - Auth flows
└── [feature]/    # Mixed - Feature components
```

### Migration Path

If converting to more server components:

1. Identify pure display components
2. Extract data fetching to server components
3. Pass data as props to client components
4. Use Suspense for loading states

Example migration:
```tsx
// Before: All client
'use client'
function DeviceList() {
  const [devices, setDevices] = useState([])
  useEffect(() => { fetch... }, [])
  return <ul>{devices.map(...)}</ul>
}

// After: Split boundary
// DeviceListServer.tsx (Server)
async function DeviceListServer() {
  const devices = await getDevices()
  return <DeviceListClient devices={devices} />
}

// DeviceListClient.tsx (Client)
'use client'
function DeviceListClient({ devices }) {
  // Only interactive parts
  const [selected, setSelected] = useState(null)
  return <ul onClick={...}>{devices.map(...)}</ul>
}
```
