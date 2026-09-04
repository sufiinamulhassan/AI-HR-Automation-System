# HR Bot Frontend - Agent Customization

## Tech Stack

**Build/Runtime:** Vite 6 + React 18 + TypeScript 5.7
**Routing:** React Router v6 (client-side SPA)
**State:** Zustand (with localStorage persistence)
**HTTP:** Axios with automatic bearer token injection
**Styling:** Module-scoped CSS files (co-located with components)

## Development & Build

```bash
npm run dev         # Vite dev server (localhost:5173), proxy /api/* to :8000
npm run build       # tsc + vite build → dist/
npm run lint        # ESLint check
```

**Backend:** Expects `http://localhost:8000` running with `/api/v1` endpoints. HTTP only - there is no WebSocket endpoint (the backend deploys serverless, where persistent connections are not available).
**Environment:** `VITE_API_BASE_URL` sets the API origin. Unset in dev it points at `http://localhost:8000`; unset in a production build it resolves to the empty string, meaning same-origin `/api/v1` - which is what the Vercel deployment relies on. Create `.env.local` to override.

## Project Structure

**Modules** (feature-scoped):
- `src/modules/m1-hrbot/` - Recruitment: job listings, candidate pipeline, resume uploads

Recruiting is the only feature module. A talent marketplace and an alumni network are out
of scope - see the root `README.md` before adding anything in that direction.

**Layout** (`src/components/layout/`):
- `DashboardLayout.tsx` - Main authenticated UI shell with ModelSelector

**State** (`src/store/`):
- `auth.store.ts` - Token and user (persisted to `hr-bot-auth`)
- `model.store.ts` - Active AI model selection

**API** (`src/lib/api.ts`):
- Organized by domain: `systemApi`, `authApi`, `jobsApi`, `candidatesApi`, etc.
- All requests include `Authorization: Bearer <token>` (auto-injected)
- 401 responses trigger logout + redirect to `/login` (except demo tokens)

## Component & Styling Patterns

```tsx
// src/modules/m1-hrbot/components/JobForm.tsx
import './JobForm.css'  // Co-located CSS module

export default function JobForm({ job, onSave, onClose }: Props) {
  const [form, setForm] = useState({...})
  return <form className="job-form">...</form>
}
```

- **CSS scope:** Each component has a `.css` file with component-specific class names (e.g., `.job-form`, `.modal-card`)
- **State:** Local `useState` for form state; Zustand for shared auth/model
- **Styling:** No CSS-in-JS or Tailwind; plain CSS classes

## Routing & Access Control

See [src/App.tsx](src/App.tsx#L24) for route definitions.

```tsx
function PrivateRoute({ children })    // Requires authentication token
function AdminRoute({ children })      // Requires admin or superadmin role
```

**Protected routes:**
- `/dashboard` - Overview, HR Bot and Activity (PrivateRoute)
- `/dashboard/{users,settings,organization,interview-automation}` - Admin Settings (AdminRoute)
- `/interview/:token`, `/offer/:token`, `/coding/:token` - public, token-gated

## Model Selection

Components access active AI model via `useModelStore(s => s.activeModel)`. Used when creating jobs, analyzing resumes, etc.

## Import Paths

- `@/` alias points to `src/`
- Use absolute imports: `import { jobsApi } from '@/lib/api'`

## Type Safety

- All API responses typed as `Record<string, unknown>` (loose) or custom interfaces
- `user.role` is checked as string against `'admin' | 'superadmin'`
- No strict null checks on API payloads; fallback to defaults in components
