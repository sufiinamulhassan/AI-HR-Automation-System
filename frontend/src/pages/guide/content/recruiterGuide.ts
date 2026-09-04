
import type { GuideChapter, RoleGuide } from '../types'


const gettingStarted: GuideChapter = {
  id: 'getting-started',
  title: 'Getting Started',
  blurb: 'Signing in, finding your way around the sidebar, choosing the AI model your work runs on, and looking after your own account.',
  sections: [
    {
      id: 'signing-in',
      title: 'Signing in',
      path: '/login',
      summary: 'The sign-in screen for every role. Email and password, an optional one-time code step when your account has OTP switched on, and a Google single sign-on button.',
      access: 'Public',
      subsections: [
        {
          id: 'sign-in-walkthrough',
          title: 'Signing in with email and password',
          steps: [
            'Open the app and go to **/login** (the "Sign in" link on the landing page lands here too).',
            'Type your work address into **Email address**.',
            'Type your password into **Password**. Use the eye button inside the field if you want to check what you typed.',
            'Click **Sign in**.',
            'If your account does not require a one-time code you land straight on **/dashboard**, the Recruitment Overview.',
            'If your account requires OTP, the card switches to "Check your email". Read the 6-digit code from your inbox, type it into **One-time code**, then click **Verify code**.',
          ],
          controls: [
            { name: 'Email address', kind: 'field', what: 'The email your account was created with. Required; the browser validates that it looks like an email.', how: 'Auto-focused when the page loads, so you can start typing straight away.' },
            { name: 'Password', kind: 'field', what: 'Your password. Required.', how: 'Passwords are never pre-filled by the app itself; your browser may offer to fill it.' },
            { name: 'Show password / Hide password', kind: 'button', what: 'Toggles the password field between masked dots and readable text. Purely local, nothing is sent.', how: 'The small eye icon inside the password field. Handy when a manager dictates a temporary password to you.' },
            { name: 'Sign in', kind: 'button', what: 'Posts your credentials. Either signs you in and navigates to /dashboard, or switches the card into the one-time-code step if your account requires OTP.', how: 'Shows "Signing in…" and is disabled while the request is in flight, so double-clicking cannot submit twice.' },
            { name: 'One-time code', kind: 'field', what: 'The 6-digit code emailed to you. Capped at 6 characters. Only appears after a password check on an OTP-enabled account.', how: 'Auto-focused. If the code expires, use "← Back to login" and sign in again to trigger a fresh one.' },
            { name: 'Verify code', kind: 'button', what: 'Verifies the code and completes the sign-in. Replaces the "Sign in" button during the OTP step.', how: 'A wrong or expired code shows "Invalid OTP code. Please try again." and leaves you on the same step.' },
            { name: '← Back to login', kind: 'button', what: 'Abandons the one-time-code step and returns to the email and password fields.', how: 'Use this if you mistyped your email address and the code went to the wrong inbox.' },
            { name: 'Sign in with Google', kind: 'link', what: 'Hands you off to the backend Google SSO flow. You come back through /sso-callback already signed in.', how: 'Only works if your administrator has configured Google SSO. Hidden while the one-time-code step is showing.' },
            { name: '← Back to home', kind: 'link', what: 'Returns to the public landing page at /.', how: 'No effect on any sign-in attempt in progress.' },
          ],
          tips: [
            'Your session is stored in the browser under `hr-bot-auth`, so a refresh keeps you signed in.',
            'Whichever role you have decides what the sidebar shows after sign-in: Recruiter, HR Admin, or Super Admin. There is no role picker at sign-in.',
          ],
          faqs: [
            { q: 'I get "Login failed. Check your credentials."', a: 'The email and password combination was rejected. Check for a stray space, confirm the address, and if it persists ask an administrator to reset your password from Users & Roles.' },
            { q: 'I was signed in and suddenly got bounced back to the login screen.', a: 'Any request that comes back 401 clears your session and redirects you here. That means your token expired or was revoked. Sign in again; nothing you saved is lost.' },
            { q: 'No one-time code arrived.', a: 'The code goes to the same address you signed in with. Check spam, then ask an administrator to confirm OTP is switched on for your account and that outbound email is configured.' },
          ],
        },
      ],
    },
    {
      id: 'sidebar-navigation',
      title: 'The sidebar and app shell',
      path: '/dashboard',
      summary: 'Every signed-in screen sits inside the same shell: a left sidebar with the module links, the AI model selector, your user card and the sign-out button. On a narrow screen the sidebar collapses behind a hamburger menu.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'sidebar-modules',
          title: 'The module links',
          body: [
            'The top of the sidebar carries the five module links every signed-in user gets. They are the same for all three roles.',
            'Under the brand block you will see which portal you are in: "Recruiter Portal", "HR Admin Portal" or "Super Admin Portal".',
          ],
          controls: [
            { name: 'Dashboard', kind: 'link', what: 'Opens the Recruitment Overview analytics page at /dashboard. Highlighted only on an exact match, so it does not stay lit while you are inside a sub-page.', how: 'Your landing page after sign-in.' },
            { name: 'Recruiting', kind: 'link', what: 'Opens the recruiting workspace at /dashboard/hrbot - job descriptions on the left, candidate pipeline on the right.', how: 'Where you spend most of your day.' },
            { name: 'Activity', kind: 'link', what: 'Opens /dashboard/activity - the log of résumé upload batches and the list of expired job descriptions.', how: 'Go here first when an upload did not produce the candidates you expected.' },
            { name: 'Admin Settings', kind: 'menu', what: 'A collapsible group holding the administration pages. It auto-expands when you navigate into any page inside it and then stays open until you collapse it manually.', how: 'Not rendered at all for a Recruiter.', access: 'HR Admin & Super Admin' },
          ],
        },
        {
          id: 'sidebar-footer',
          title: 'The sidebar footer: model, profile and sign out',
          controls: [
            { name: 'AI Model', kind: 'field', what: 'Selects the AI model used for the work you kick off. See the next section for exactly what it affects.', how: 'Sits directly above your user card.' },
            { name: 'Your user card', kind: 'link', what: 'Shows your initial, your name and a role badge (Recruiter / HR Admin / Super Admin). Clicking it opens /dashboard/profile.', how: 'The role badge is the quickest way to confirm which permissions you actually hold.' },
            { name: 'Sign out', kind: 'button', what: 'Clears the stored token and user from the browser and returns you to /login.', how: 'Always sign out on a shared machine - a refresh alone keeps you signed in.' },
          ],
        },
        {
          id: 'mobile-shell',
          title: 'On a phone or narrow window',
          controls: [
            { name: 'Open menu / Close menu', kind: 'button', what: 'The hamburger button in the top bar slides the sidebar in and out. While the drawer is open the page behind it cannot scroll.', how: 'Tapping any nav link closes the drawer automatically, so it behaves like moving to a new screen.' },
            { name: 'Mobile top bar title', kind: 'link', what: 'Shows the name of the page you are on, derived from the nav entry that matches the current URL.', how: 'Reads "Profile" on the profile page even though profile is not a nav item.' },
          ],
        },
        {
          id: 'page-errors',
          title: 'If a page fails to render',
          body: [
            'Each page is wrapped in an error boundary. If something goes wrong the content area is replaced with "Something went wrong on this page.", the error message, and a **Retry** button. The sidebar keeps working, so you can navigate away without reloading.',
          ],
          tips: ['If Retry does not help, refresh the browser once. If it still fails, note the message shown - it is the exact error and is what an administrator will ask you for.'],
        },
      ],
    },
    {
      id: 'ai-model-selector',
      title: 'The AI model selector',
      summary: 'A single dropdown in the sidebar footer that decides which AI model runs the work you start. It is a per-user preference, saved to your account.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'model-what-it-does',
          title: 'What the model selector changes',
          body: [
            'The list of models comes from the backend when the app loads, and the model marked current there is pre-selected. If the list cannot be fetched the dropdown falls back to showing whatever is already selected locally.',
            'Your choice is sent to your account as your default model, and is also passed explicitly with the two operations that name it:',
            '**Creating or updating a job description** - the JD form sends the active model as `model_override`, so JD parsing (skills, seniority, targeting) runs on it.',
            '**Uploading résumés** - both the single-file and the bulk upload send the active model, so résumé classification and matching run on it.',
          ],
          controls: [
            { name: 'AI Model', kind: 'field', what: 'Changes the active model. The change applies immediately in your browser and is also saved to your account as your default. If saving to the server fails the local selection still sticks for this session.', how: 'Set it before you start an upload or create a JD - changing it afterwards does not re-run anything that already ran.' },
          ],
          warnings: ['Switching models mid-project means different résumés in the same pool were classified by different models. If you care about comparability, pick one and leave it alone for the duration of a hiring round.'],
        },
      ],
    },
    {
      id: 'your-profile',
      title: 'Your profile and password',
      path: '/dashboard/profile',
      summary: 'A read-only view of your own account details plus the form for changing your password. Reached from your user card at the bottom of the sidebar.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'account-information',
          title: 'Account Information',
          controls: [
            { name: 'Email', kind: 'column', what: 'The address your account is keyed on. Read-only here - only an administrator can change it.' },
            { name: 'Account Status', kind: 'badge', what: 'Green **Active** means you can sign in. Red **Inactive** means the account has been disabled by an administrator.', how: 'If this ever reads Inactive you will not be able to sign in again after your session ends.' },
            { name: 'OTP Login', kind: 'badge', what: 'Blue **Required** means sign-in asks for a one-time email code. Grey **Disabled** means password only.', how: 'Only an administrator can turn this on or off for you.' },
            { name: 'Member Since', kind: 'column', what: 'The date your account was created.' },
            { name: 'Last Login', kind: 'column', what: 'Date and time of your previous sign-in.', how: 'Worth a glance if you suspect someone else has your credentials.' },
          ],
        },
        {
          id: 'change-password',
          title: 'Changing your password',
          steps: [
            'Open **Profile** from your user card in the sidebar footer.',
            'Type your existing password into **Current Password**.',
            'Type the new one into **New Password**. The strength meter under the field updates as you type.',
            'Repeat it in **Confirm New Password**. A red "Passwords do not match" appears the moment the two differ.',
            'Click **Update Password**. On success a toast reads "Password changed successfully" and all three fields clear.',
          ],
          controls: [
            { name: 'Current Password', kind: 'field', what: 'Verifies it is really you. Required.', how: 'A wrong value here comes back as an error from the server, not a local validation message.' },
            { name: 'New Password', kind: 'field', what: 'The replacement password. Must be at least 8 characters - shorter values are rejected locally before any request is sent.', how: 'Each field has its own eye toggle to reveal what you typed.' },
            { name: 'Confirm New Password', kind: 'field', what: 'Must match New Password exactly. The field border turns red as soon as it diverges.' },
            { name: 'Password strength meter', kind: 'badge', what: 'Three bars labelled Weak, Fair or Strong. It scores four things: at least 8 characters, at least 12 characters, having both an uppercase letter and a digit, and having a symbol. One point or fewer is Weak, two is Fair, three or more is Strong.', how: 'Advisory only - the app enforces the 8-character minimum, nothing more. Aim for Strong anyway.' },
            { name: 'Update Password', kind: 'button', what: 'Submits the change. Disabled until all three fields are filled and the two new-password fields match.', how: 'Shows a spinner and "Updating…" while it runs.' },
          ],
          faqs: [
            { q: 'The page says "Profile unavailable in demo mode".', a: 'Your account details could not be loaded from the backend. The password form is still rendered but there is nothing to show in the Account Information card.' },
            { q: 'Do I get signed out after changing my password?', a: 'No. Your current session keeps working. Other devices signed in as you are not covered by this screen.' },
          ],
        },
      ],
    },
  ],
}


const dashboardOverview: GuideChapter = {
  id: 'dashboard-overview',
  title: 'Recruitment Overview',
  blurb: 'The analytics landing page: headline counters, the hiring funnel, time-to-hire and offer stats, and eight breakdown charts of your candidate pool.',
  sections: [
    {
      id: 'recruitment-overview',
      title: 'Recruitment Overview',
      path: '/dashboard',
      summary: 'A live snapshot of the talent pool, the hiring funnel and AI usage. Everything on the page is read-only except the three buttons in the header. It loads five sources in parallel on arrival; any one of them failing leaves that card empty rather than breaking the page.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'overview-header-actions',
          title: 'The three header buttons',
          body: ['These are shortcuts into the two things you do most often, so you do not have to walk into the Recruiting workspace first.'],
          controls: [
            { name: 'Create JD', kind: 'button', what: 'Navigates to /dashboard/hrbot?new=1, which opens the Recruiting workspace with the New Job Description form already open. The query parameter is cleared from the URL straight after.', how: 'Identical to opening Recruiting and clicking "+ Create New JD".' },
            { name: 'Import JDs', kind: 'button', what: 'Opens the Import Job Descriptions modal in place, without leaving the overview. When the import finishes, every counter on this page reloads.', how: 'See the Recruiting chapter for the full field-by-field breakdown of the import modal.' },
            { name: 'Upload Résumés', kind: 'button', what: 'Opens the résumé upload modal in place. Uploading is not tied to a selected job, so it opens here rather than deep-linking into the workspace. All counters reload once the upload is accepted.' },
          ],
        },
        {
          id: 'overview-kpis',
          title: 'The six headline counters',
          body: ['The strip is always exactly six tiles so the grid never has a ragged trailing row. Two of them fold an extra metric in as a sub-line rather than adding a seventh tile.'],
          controls: [
            { name: 'Total Résumés', kind: 'column', what: 'Every résumé that has been processed into the pool, across all jobs and all time.' },
            { name: 'Open JDs', kind: 'column', what: 'The total number of job descriptions. The sub-line "<n> active" underneath is the count still inside their application window.', how: 'The gap between the two numbers is your expired backlog - clear it from Activity → Job Descriptions.' },
            { name: 'Domains', kind: 'column', what: 'How many distinct job domains the classifier has assigned across the pool.', how: 'Falls back to counting the keys of the By Domain breakdown if the backend does not send an explicit total.' },
            { name: 'Distinct Skills', kind: 'column', what: 'The number of unique skills extracted across every résumé in the pool.' },
            { name: 'Seniority Levels', kind: 'column', what: 'How many distinct seniority levels the classifier has assigned across the pool.', how: 'Counts the keys of the By Seniority breakdown, so it moves only when a résumé lands in a band that was previously empty.' },
            { name: 'Hired', kind: 'column', what: 'Total hires across every job description.' },
          ],
        },
        {
          id: 'overview-spend',
          title: 'Total AI Spend · Lifetime (Super Admin only)',
          body: ['A full-width card showing estimated OpenAI cost across résumé processing, JD parsing and re-matching. Recruiters and HR Admins do not see this card at all.'],
          controls: [
            { name: 'Total AI Spend · Lifetime', kind: 'column', what: 'Running lifetime cost in USD. Shown to 2 decimal places at a dollar or more, and to 4 decimal places below that. The meta line underneath gives the number of processing runs and the date tracking started.', access: 'Super Admin only' },
            { name: 'Avg / Résumé', kind: 'column', what: 'Mean cost per processed résumé, to 4 decimal places.', access: 'Super Admin only' },
            { name: 'Résumés', kind: 'column', what: 'How many résumés that spend covers.', access: 'Super Admin only' },
            { name: 'Prompt / Completion / Embedding', kind: 'column', what: 'Token counts by type, abbreviated (45.3K, 1.2M).', access: 'Super Admin only' },
          ],
          tips: ['Spend is tracked independently of Activity. Clearing batch notifications from the Activity page never resets this number.'],
        },
        {
          id: 'overview-funnel',
          title: 'Hiring Funnel',
          body: [
            'Five stages left to right - **Total Résumés**, **Auto-Invited**, **Manually Invited**, **Interviewed**, **Hired** - each with a count, a proportional bar, and a conversion chip.',
            'The conversion chip reads "entry point" on the first stage and "<n>% of prev" on the rest, comparing each stage to the one immediately to its left.',
          ],
          controls: [
            { name: 'Total Résumés', kind: 'column', what: 'The whole pool. Every bar on the row is sized relative to this number.' },
            { name: 'Auto-Invited', kind: 'column', what: 'Candidates the matcher invited without anyone clicking anything, because they cleared the automatic-invite bar during upload.' },
            { name: 'Manually Invited', kind: 'column', what: 'Candidates a recruiter invited by hand from the pipeline using the envelope button.' },
            { name: 'Interviewed', kind: 'column', what: 'Candidates who completed an interview session.' },
            { name: 'Hired', kind: 'column', what: 'Candidates marked hired.' },
          ],
          faqs: [
            { q: 'Why is Manually Invited not a subset of Auto-Invited?', a: 'They are two separate routes into the same interview stage, not nested steps. The "% of prev" chip still compares each to the tile on its left, so read those percentages as a shape indicator rather than a strict funnel conversion.' },
          ],
        },
        {
          id: 'overview-stats',
          title: 'Time to Hire, Offer Acceptance and Drop-off',
          controls: [
            { name: 'Time to Hire', kind: 'column', what: 'Average days from invite to hire decision, with the sample size and the median underneath.', how: 'Reads "No data yet." until at least one hire has completed the cycle. A small sample size makes the average nearly meaningless - always read the count next to it.' },
            { name: 'Offer Acceptance Rate', kind: 'column', what: 'The share of sent offers that were accepted, as a whole-number percentage, with "<n> sent · <n> accepted · <n> declined" underneath.', how: 'Reads "No offers sent yet." until an offer has actually been sent (not merely created or approved).' },
            { name: 'Candidate Drop-off', kind: 'column', what: 'Attrition across pipeline stages, one card per stage with a "-<n>% drop" chip relative to the previous stage.', how: 'The whole section is hidden when the backend returns no stages.' },
            { name: 'Recruiter Performance', kind: 'column', what: 'A table of Recruiter, Invited, Hired and Avg. Time to Hire, one row per recruiter email. A dash in the last column means not enough hires to compute an average.', how: 'Reads "No recruiter activity yet." when empty. There is no sorting or filtering on this table.' },
          ],
        },
        {
          id: 'overview-charts',
          title: 'The eight breakdown charts',
          body: [
            'Each card shows horizontal bars sorted from most to least, with the row count as a pill in the header. The bars are scaled against the largest value in that card, so they compare within a card and not across cards.',
            'A search box appears inside a card only when it has more than 7 rows. It filters the bars in that card, client-side, on a substring of the label.',
          ],
          controls: [
            { name: 'By Domain', kind: 'column', what: 'Candidate pool split by the job domain the classifier assigned.' },
            { name: 'By Seniority', kind: 'column', what: 'Experience-level distribution across the pool.' },
            { name: 'By Experience', kind: 'column', what: 'Distribution by years of professional experience.' },
            { name: 'By Education', kind: 'column', what: 'Highest education level across the pool.' },
            { name: 'Top Skills', kind: 'column', what: 'The most common skills across every résumé in the pool.', how: 'Almost always has more than 7 rows, so it gets the in-card search box.' },
            { name: 'JDs by Source', kind: 'column', what: 'Where your job descriptions came from - manual, or a named import source. Empty state: "No job descriptions yet."' },
            { name: 'Applications by Source', kind: 'column', what: 'Where applications originated. Empty state: "No application source data yet."', how: 'Only rendered when the analytics endpoint responded.' },
            { name: 'Search <chart name>…', kind: 'filter', what: 'Filters the bars in that one card by a case-insensitive substring of the label. Purely local - nothing is re-queried.', how: 'Only appears on cards with more than 7 rows. The ✕ clears it. No matches shows: No matches for "…".' },
          ],
        },
        {
          id: 'overview-recommendations',
          title: 'AI Recommendations and Diversity Metrics',
          controls: [
            { name: 'AI Recommendations', kind: 'column', what: 'Suggested actions derived from current pipeline data, each with a count on the right. Read-only - there is nothing to click.', how: 'Reads "No recommendations right now." when the backend returns none.' },
            { name: 'Diversity Metrics', kind: 'column', what: 'A placeholder card. It prints whatever note the analytics endpoint returns, defaulting to "Diversity metrics aren\'t available yet."', how: 'Nothing to configure - the feature is not implemented behind this card yet.' },
          ],
        },
        {
          id: 'overview-refresh',
          title: 'Refreshing the page',
          body: [
            'There is no refresh button. The five data sources load once when you arrive, and reload only after you import JDs or upload résumés from this page. To pull fresh numbers otherwise, navigate away and back, or reload the browser.',
          ],
          faqs: [
            { q: 'A card is empty but I know there is data.', a: 'Each source is fetched independently and failures degrade silently to an empty object. Reload the page; if one card is still empty while the rest fill in, that specific endpoint is failing and an administrator should look at it.' },
          ],
        },
      ],
    },
  ],
}


const recruiting: GuideChapter = {
  id: 'recruiting',
  title: 'Recruiting',
  blurb: 'The core workflow: write or import a job description, upload résumés, work the candidate pipeline, run AI interviews and coding assessments, and make an offer.',
  sections: [
    {
      id: 'hrbot-workspace',
      title: 'The Recruiting workspace',
      path: '/dashboard/hrbot',
      summary: 'A two-panel workspace. The left rail lists your job descriptions with a search box, counters and the upload button; the right panel shows the selected job as either a Candidate Pipeline or Job Details.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'workspace-layout',
          title: 'Finding your way around',
          body: [
            'When you arrive, the workspace loads your first 50 job descriptions and automatically opens the first one on its Candidate Pipeline tab, so you never land on a blank screen.',
            'If you arrived from the overview via **Create JD** or **Upload Résumés**, the matching modal opens for you and the query parameter is stripped from the URL.',
          ],
          controls: [
            { name: 'Job Descriptions', kind: 'column', what: 'The heading of the left rail. Below it sits the 2x2 counter grid, the upload button, the search box and the job list itself.' },
            { name: 'Resumes', kind: 'column', what: 'Counter: total processed résumés across the whole pool. Not scoped to the selected job.' },
            { name: 'Open JDs', kind: 'column', what: 'Counter: the total number of job descriptions matching the current job search box. It moves when you type in the search box, because it is the total of that query.', how: 'Clear the search box to see the true total again.' },
            { name: 'Invited', kind: 'column', what: 'Counter: auto-invited candidates only. Manually invited candidates are not included here.', how: 'The Recruitment Overview funnel is the place to see auto and manual invites side by side.' },
            { name: 'Hired', kind: 'column', what: 'Counter: total hires across the whole pool.' },
            { name: 'Upload Resumes', kind: 'button', what: 'Opens the résumé upload modal. This is the only upload entry point in the workspace - it is deliberately dashboard-level, not per-job, because the target job is optional and chosen inside the form.' },
            { name: 'Search jobs…', kind: 'filter', what: 'Re-queries the job list from the server on every keystroke with `search=<text>`. It is not a local filter, and it also changes the Open JDs counter.', how: 'Clearing the box re-fetches the unfiltered first 50 jobs.' },
            { name: 'Re-match', kind: 'button', what: 'Runs a similarity match of every résumé against every job description and rebuilds every candidate pipeline. Opens a confirmation dialog first; on completion the message "Matched <n> across <m> JDs" appears for five seconds and the open pipeline reloads.', how: 'Only shown to Super Admins. Use it after a bulk import of JDs, or when pipelines look stale.', access: 'Super Admin only' },
            { name: 'Yes, re-match all', kind: 'button', what: 'Confirms the re-match. Cancel backs out with nothing done.', access: 'Super Admin only' },
            { name: 'Back to jobs', kind: 'button', what: 'On a narrow screen, returns from the selected job back to the job list.', how: 'On a wide screen both panels are visible at once and you rarely need it.' },
            { name: 'Candidate Pipeline', kind: 'tab', what: 'The default tab for a selected job. Lists everyone the matcher put against this JD.' },
            { name: 'Job Details', kind: 'tab', what: 'The read-only view of the JD itself: description, AI-parsed criteria, targeting and metadata.' },
          ],
          warnings: ['Re-match processes the entire résumé pool in one pass. It is a heavy operation and can take a while - only run it when you genuinely intend to refresh every pipeline.'],
          faqs: [
            { q: 'The workspace shows "No job descriptions yet".', a: 'You have none, or your search box excludes them all. The empty state offers "+ Create New JD" directly.' },
            { q: 'It says "Select a job description" instead.', a: 'You have jobs but none is open - pick one from the left rail.' },
          ],
        },
      ],
    },
    {
      id: 'job-descriptions',
      title: 'Creating and editing job descriptions',
      path: '/dashboard/hrbot',
      summary: 'The New Job Description form, the job list rows, and the Job Details tab that shows what the AI extracted from your text.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'create-jd',
          title: 'Writing a job description',
          steps: [
            'From the Recruiting workspace click **+ Create New JD** (on the empty state), or use **Create JD** from the Recruitment Overview.',
            'Fill in **Job Title** and **Job Description** - those two are required, everything else is optional.',
            'Set **Difficulty**, **Employment Type**, **Location** and the salary range if you have them.',
            'Set **Days open**. It defaults to 30 and controls the application window.',
            'Click **Create JD**. The modal closes and the new JD appears in the left rail.',
            'Open the **Job Details** tab. The AI-Parsed Criteria block will read "AI is parsing criteria - check back shortly after creating the job." for a moment, then fill in with the extracted skills and requirements.',
          ],
          controls: [
            { name: 'Job Title *', kind: 'field', what: 'The role name. Required. Example placeholder: "Senior React Developer".' },
            { name: 'Company', kind: 'field', what: 'Optional company name, shown as a badge on the Job Details tab and in the job list row.' },
            { name: 'Job Description *', kind: 'field', what: 'The full text of the role. Required. This is the text the AI parses for required skills, nice-to-haves, key requirements, certifications, experience level and industry.', how: 'The more structured your text - headings, bulleted requirements - the better the parse. Job Details renders headings, bullets and paragraphs back to you, so you can see how it read your text.' },
            { name: 'Difficulty', kind: 'field', what: 'One of junior, mid, senior, lead. Defaults to **mid**. Shown as an accent badge on Job Details.' },
            { name: 'Employment Type', kind: 'field', what: 'One of full-time, part-time, contract, internship. Defaults to **full-time**.' },
            { name: 'Location', kind: 'field', what: 'Free text, e.g. "London, UK". Displayed with a pin icon on Job Details.' },
            { name: 'Salary Min (£)', kind: 'field', what: 'Optional lower bound, a number. Left blank it is sent as null.' },
            { name: 'Salary Max (£)', kind: 'field', what: 'Optional upper bound, a number. Left blank it is sent as null.' },
            { name: 'Remote OK', kind: 'toggle', what: 'Marks the role as remote. Adds a green "Remote" badge on Job Details and a "· Remote" suffix in the job list row.' },
            { name: 'Days open', kind: 'field', what: 'The application window in days, 0 to 365, default 30. After the window ends no new candidates are matched to this JD. **0 means no deadline.**', how: 'This is what drives the deadline bar and what puts a JD onto the expired list in Activity.' },
            { name: 'Create JD / Update JD', kind: 'button', what: 'Saves the job. The button label depends on whether you opened the form empty or from Edit. The currently selected AI model is sent with the request as the model override for parsing.', how: 'Shows "Saving…" while in flight. A server-side rejection is printed at the top of the form.' },
            { name: 'Cancel', kind: 'button', what: 'Closes the form without saving. Clicking the dimmed background does the same.' },
          ],
          tips: ['Editing a JD re-opens the same form pre-filled, and re-saving re-runs the AI parse with your current model selection.'],
        },
        {
          id: 'job-list-rows',
          title: 'The job list rows',
          controls: [
            { name: 'Job row', kind: 'link', what: 'Clicking a row selects that job, switches the right panel to the Candidate Pipeline tab and fetches the full job detail.' },
            { name: '<n> candidates', kind: 'column', what: 'The count printed under each row. It counts pipeline entries with a match score of **0.5 or higher** - a fixed threshold baked into the row, unrelated to the pipeline\'s own score slider.', how: 'If this says 12 but the pipeline shows more or fewer, the slider on the pipeline is set to something other than 50%.' },
            { name: 'Edit', kind: 'button', what: 'The pencil icon. Opens the job form pre-filled with the full JD (it fetches the complete record first, so you are editing the real text and not a truncated list entry).' },
            { name: 'Delete', kind: 'button', what: 'The red trash icon. Asks "Delete this job?" and, on confirmation, deletes the job description. If the deleted job was open, the right panel clears.', how: 'A failure shows "Failed to delete job. Please try again." above the list for four seconds.' },
          ],
          warnings: ['Deleting a job description cannot be undone from the UI. The candidate pipeline attached to it goes with it.'],
        },
        {
          id: 'job-details-tab',
          title: 'The Job Details tab',
          body: ['Read-only. Everything here is either what you typed or what the AI extracted from it.'],
          controls: [
            { name: 'Application Deadline', kind: 'column', what: 'A coloured bar showing how much of the application window has elapsed. It starts green at posting and shifts through to red as the deadline approaches.', how: 'Labels you will see: "● Open · no deadline" when Days open was 0; "<n> days left"; "Closes today"; and "⏱ Closed - not accepting candidates" once it has passed.' },
            { name: 'Description', kind: 'column', what: 'Your JD text, re-formatted into headings, bullet lists and paragraphs. Headings are detected conservatively - an explicit marker from the importer, a short line ending in a colon, or a short all-caps line.', how: 'Reads "Full description loading…" while the full record is still being fetched.' },
            { name: 'Required Skills', kind: 'column', what: 'The skills the AI decided are mandatory. These are the skills the pipeline\'s Skills column checks each candidate against.' },
            { name: 'Preferred Skills', kind: 'column', what: 'Nice-to-haves extracted from your text.' },
            { name: 'Key Requirements', kind: 'column', what: 'Extracted requirement bullets.' },
            { name: 'Certifications', kind: 'column', what: 'Certifications the AI found in the description.' },
            { name: 'Experience Level / Industry', kind: 'column', what: 'The two single-value criteria the parse produces.' },
            { name: 'Targeting', kind: 'column', what: 'Domain and Seniority the matcher will target. Only rendered when the parse produced them.', how: 'The domain here is also what pre-fills the Job Domain field when you assign a coding question to a candidate on this job.' },
            { name: 'Source', kind: 'badge', what: 'Where the JD came from: Manual, LinkedIn, Naukri, Remotive, Arbeitnow, RemoteOK, The Muse or Jobicy.' },
            { name: 'View original ↗', kind: 'link', what: 'Opens the original posting in a new tab. Only present on imported JDs that carried a source URL.' },
            { name: 'Created by / Created / Updated', kind: 'column', what: 'Who created the JD and when it was created and last changed.' },
          ],
          faqs: [
            { q: 'AI-Parsed Criteria still says it is parsing.', a: 'Parsing runs in the background after the save. Switch tabs and come back, or re-select the job from the left rail to re-fetch it.' },
          ],
        },
      ],
    },
    {
      id: 'importing-jds',
      title: 'Importing job descriptions from job boards',
      summary: 'Pulls job descriptions from an external board. Imported JDs are tagged with their origin and are parsed and matched exactly like one you typed yourself.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'import-walkthrough',
          title: 'Running an import',
          steps: [
            'Click **Import JDs** on the Recruitment Overview.',
            'Pick a source tile. Sources without an API key configured are greyed out and tagged **Key needed**.',
            'Type **Keywords** for the roles you want. Pressing Enter in this field starts the import.',
            'Optionally narrow with **Location**, **Date posted**, **Job type** and **Remote only**.',
            'Set **Max** (how many to pull, 1-50) and **Days open** (the application window each imported JD gets).',
            'Click **Import JDs** and read the result note.',
          ],
          controls: [
            { name: 'Source tiles', kind: 'button', what: 'One tile per configured source: LinkedIn, Naukri, Remotive, Arbeitnow, RemoteOK, The Muse, Jobicy. The first configured source is pre-selected. Unconfigured tiles are disabled and tagged "Key needed".', how: 'Remotive and Arbeitnow need no API key, so they are the ones to reach for when nothing else is set up.' },
            { name: 'Keywords', kind: 'field', what: 'The search terms sent to the board, e.g. "DevOps Engineer". Pressing Enter here triggers the import.', how: 'If you get nothing back, broaden - a single word like "React" often beats a full job title.' },
            { name: 'Location (optional)', kind: 'field', what: 'Free-text location filter passed to the board, e.g. "Remote, USA".', how: 'The most common cause of a zero-result import. Clear it before you change anything else.' },
            { name: 'Max', kind: 'field', what: 'How many postings to fetch, clamped to 1-50, default 10.' },
            { name: 'Date posted', kind: 'filter', what: 'Any time (default), Past 24 hours, Past week, Past month. "Any time" sends no date filter at all.' },
            { name: 'Job type', kind: 'filter', what: 'Any type (default), Full-time, Contract, Part-time, Internship.' },
            { name: 'Days open', kind: 'field', what: 'The application window given to every JD in this import, 0-365, default 30. 0 means no deadline.' },
            { name: 'Remote only', kind: 'toggle', what: 'Restricts the import to remote postings. When off, no remote filter is sent at all.' },
            { name: 'Import JDs', kind: 'button', what: 'Runs the import. Disabled unless a source is selected **and** that source is configured.', how: 'Shows "Importing…" while it runs. The button stays available so you can run several keyword passes back to back.' },
            { name: 'Close', kind: 'button', what: 'Closes the modal. Anything already imported stays imported.' },
          ],
          faqs: [
            { q: 'The result says "No jobs found on <source> for those keywords."', a: 'The board returned nothing. Try broader terms, or clear the Location field - location strings are the usual culprit.' },
            { q: 'It says "All <n> matching JDs from <source> are already imported."', a: 'Duplicates are skipped by design. You already have those postings; nothing new was created.' },
            { q: 'The imported JDs are not showing their parsed criteria.', a: 'The success note tells you they appear as parsing completes. Give it a moment and re-select the job.' },
          ],
        },
      ],
    },
    {
      id: 'resume-upload',
      title: 'Uploading résumés',
      summary: 'One modal handles everything. There is a single drop zone; how many files you pick decides whether the résumé is pinned to one job or matched against every open job description.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'upload-walkthrough',
          title: 'Uploading a batch',
          steps: [
            'Click **Upload Resumes** in the Recruiting left rail, or **Upload Résumés** on the Recruitment Overview.',
            'Drag files onto the drop zone, or click it to browse. You can drop up to **500** PDF or DOCX files in one go - a single file or a whole folder.',
            'Check the file list. It shows the first ten by name and size, then "+<n> more". **Clear** empties the selection.',
            'Optionally choose a **Target job description**. This is only available when you have picked exactly one file.',
            'Click **Upload <n> files**. The modal closes as soon as the backend accepts the upload.',
            'Watch the floating progress widget in the bottom-right corner. Processing continues in the background - you can navigate anywhere in the app.',
          ],
          controls: [
            { name: 'Drag & drop files here, or click to browse', kind: 'field', what: 'The drop zone. Accepts .pdf and .docx only. Anything else you drop is silently discarded, as are Word and OS temporary files (names starting with "~$", "._" or a dot).', how: 'Legacy .doc files are not supported at all - save them as PDF or DOCX first.' },
            { name: 'Clear', kind: 'button', what: 'Empties the current file selection and any error or duplicate message. Does not cancel an upload already in progress.' },
            { name: 'Target job description (optional)', kind: 'filter', what: 'A searchable dropdown of up to 100 job descriptions, defaulting to **Match against all open jobs**. Choosing a job pins that résumé to that job\'s pipeline even if the matcher would not have surfaced it.', how: 'Disabled the moment you select more than one file - only the single-file endpoint accepts a target. The hint under the control changes to say so.' },
            { name: 'Search job descriptions…', kind: 'filter', what: 'Filters the job list inside the dropdown by a case-insensitive substring of the title. Local only.', how: 'Typing here hides the "Match against all open jobs" row; clear the search to get it back.' },
            { name: 'Upload <n> files / Upload <n> file to this JD', kind: 'button', what: 'Starts the upload. The label tells you which route it will take: with "to this JD" it pins a single résumé to the chosen job; without it, the batch is matched against every open JD. Disabled while an upload is running or when nothing is selected.' },
          ],
          tips: [
            'A pinned résumé still carries its real match score. If it does not appear in the pipeline after upload, drag the pipeline\'s Min match score slider down - it is being hidden by the cutoff, not missing.',
            'The active AI model is sent with the upload, so set it before you start rather than after.',
          ],
          warnings: ['Do not close the browser expecting the upload to stop. Processing happens on the server; closing the tab only stops you watching it.'],
        },
        {
          id: 'upload-progress',
          title: 'Batch progress and the floating widget',
          body: [
            'While a batch runs, both the upload modal and a floating widget in the bottom-right corner show the same live status, polled every two seconds until the batch reaches completed or failed.',
            'The batch is saved in your browser, so it survives a refresh or even closing and reopening the browser - polling picks straight back up.',
          ],
          controls: [
            { name: 'Batch status badge', kind: 'badge', what: 'The raw batch state: **queued** (accepted, not started), **processing** (running), **completed** (finished), **failed** (the batch itself failed).' },
            { name: 'Processed', kind: 'column', what: 'Résumés successfully parsed, classified and matched.' },
            { name: 'Auto-Invited', kind: 'column', what: 'How many of them cleared the automatic-invite bar and were invited without you doing anything.' },
            { name: 'Skipped', kind: 'column', what: 'Duplicates. A file whose content already exists in the pool is skipped - no second record is created.' },
            { name: 'Failed', kind: 'column', what: 'Files that could not be processed. The per-file reasons are in the batch summary on the Activity page.' },
            { name: 'Progress bar', kind: 'column', what: 'Percentage complete, computed as (processed + skipped + failed) ÷ total files.', how: 'This is why the bar can hit 100% with a non-zero Failed count - every file was handled, not every file succeeded.' },
            { name: 'Upload progress widget', kind: 'button', what: 'The floating card. Reads "Processing resumes…", then "Upload complete", "Done - <n> failed", or "Upload failed". Clicking it re-opens the upload modal.', how: 'The ✕ on the widget dismisses it and stops the polling; it does not cancel or undo anything.' },
          ],
          faqs: [
            { q: 'My upload says 0 matched.', a: 'Open Activity → Resumes and click into the batch. "Matched to JDs" versus "Not matched" is broken out there, along with per-JD counts. The usual causes are: no open JD in that domain, every JD past its deadline, or scores below the matching bar.' },
            { q: 'I uploaded one file and got a duplicate warning.', a: 'That exact résumé is already in the pool. Nothing was created; the warning shows the first eight characters of the existing record\'s ID.' },
            { q: 'Some files were ignored before processing even started.', a: 'Word and OS lock files ("~$name.docx") and dotfiles are filtered out client-side, and the batch summary counts any others as "temp/invalid files ignored".' },
          ],
        },
      ],
    },
    {
      id: 'candidate-pipeline',
      title: 'The candidate pipeline',
      path: '/dashboard/hrbot',
      summary: 'Everyone the matcher put against the selected job, sorted by match score. Two filters at the top, five columns, and a row of icon actions that drive the whole rest of the hiring process.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'pipeline-filters',
          title: 'The two filters',
          body: [
            'The full pipeline for the job is fetched once when you select it. **Both filters are client-side** - they narrow what is already on screen and never re-query the server. The heading count "(n)" is the unfiltered total.',
          ],
          controls: [
            { name: 'all', kind: 'filter', what: 'Stage filter: shows every candidate on this job regardless of stage. The default.' },
            { name: 'matched', kind: 'filter', what: 'Only candidates the matcher surfaced but nobody has acted on yet. The number on the button is how many are in that stage.' },
            { name: 'shortlisted', kind: 'filter', what: 'Only candidates moved to shortlisted. The app sets this automatically when you invite someone who was still in "matched".' },
            { name: 'invited', kind: 'filter', what: 'Only candidates who have an interview link.' },
            { name: 'interviewing', kind: 'filter', what: 'Only candidates between the invite and a submitted session. The app treats this identically to "invited" - the Resend / Regenerate Interview Link button stays available.' },
            { name: 'completed', kind: 'filter', what: 'Only candidates whose interview session was submitted. This is the only stage where the AI report button works.' },
            { name: 'hired', kind: 'filter', what: 'Only candidates you marked hired.' },
            { name: 'rejected', kind: 'filter', what: 'Only candidates you rejected. Rejecting does not delete anyone - they stay here.' },
            { name: 'Min match score', kind: 'filter', what: 'A slider from 0% to 100% in 5% steps, **defaulting to 50%**. Hides every candidate whose match score is below the value. Applied on top of the stage filter.', how: 'The note "<n> hidden below cutoff" appears to the right whenever it is actually hiding anyone. Drag it to 0% when you are hunting for a specific person who is not showing up.' },
          ],
          faqs: [
            { q: 'A résumé I pinned to this JD is not in the list.', a: 'It is almost certainly under the 50% default cutoff. Pinning forces a candidate into the pipeline but does not change their real match score. Drag Min match score to 0%.' },
            { q: 'The list says "No candidates in this stage."', a: 'Either that stage genuinely is empty, or the score slider has hidden everyone in it. Check the "hidden below cutoff" note.' },
          ],
        },
        {
          id: 'pipeline-columns',
          title: 'The table columns',
          controls: [
            { name: 'Candidate', kind: 'column', what: 'The candidate\'s name from their résumé, with "<domain> · <seniority>" underneath from the AI classification. A dash means no name could be extracted.' },
            { name: 'Stage', kind: 'badge', what: 'The current pipeline stage as a coloured badge. See the glossary for what each stage means.' },
            { name: 'Score', kind: 'column', what: 'The AI match score between this résumé and this job description, shown as a whole-number percentage. A dash means no score was computed.', how: 'Rows are sorted by this, highest first. This is the same number the Min match score slider filters on.' },
            { name: 'Skills', kind: 'column', what: 'When the JD has parsed required skills, this shows up to 3 the candidate **has** (green) followed by up to 2 they are **missing** (red). When the JD has no parsed required skills, it falls back to the candidate\'s first 3 skills with no colour meaning.', how: 'Green versus red only means anything once the Job Details tab shows Required Skills. Check there if the colours look wrong.' },
            { name: 'Actions', kind: 'column', what: 'The icon button row. Which icons appear depends on the stage and on whether a candidate record exists yet.' },
          ],
        },
        {
          id: 'pipeline-actions',
          title: 'Every action button',
          body: ['These buttons are icon-only. The names below are the tooltips you get on hover, which is how you identify them on screen.'],
          controls: [
            { name: 'View Resume', kind: 'button', what: 'Opens the résumé viewer. PDFs render in an embedded viewer; DOCX files are rendered with real Word fidelity - fonts, margins, page breaks, headers and footers. If neither can be rendered it falls back to the extracted plain text.', how: 'Always available. The modal also has **Download** and **Open** buttons for the original file.' },
            { name: 'View AI Report', kind: 'button', what: 'Opens the interview report. **Only works when the candidate is in the completed stage and has an interview token** - otherwise it shows the toast "AI report available after interview is completed".' },
            { name: 'Send Interview Invite', kind: 'button', what: 'The envelope. For a candidate not yet invited, opens the Send Interview Invite form. If the candidate was still in "matched", sending shortlists them first.' },
            { name: 'Resend / Regenerate Interview Link', kind: 'button', what: 'The circular arrows. One click invalidates the candidate\'s current interview link, generates a new one, emails it to them, and copies it to your clipboard - the same clipboard behavior as Send Interview Invite. Only shown for candidates in **invited** or **interviewing**.', how: 'Asks for confirmation first, since it invalidates the old link. The new link is also shown in an alert so you can grab it even if the clipboard write is blocked.' },
            { name: 'Mark as Hired', kind: 'button', what: 'The tick. Records a hire decision on the candidate and moves them to the **hired** stage. Toast: "✓ Marked as hired".', how: 'Clicking it on someone already hired just shows "Candidate is already hired" and does nothing.' },
            { name: 'Reject Candidate', kind: 'button', what: 'The trash icon. Records a reject decision and moves them to the **rejected** stage. Toast: "✕ Candidate rejected".', how: 'Despite the icon this is **not a delete** - the candidate stays in the pipeline under the rejected filter. Clicking it on someone already rejected does nothing.' },
            { name: 'Manage Offers', kind: 'button', what: 'The dollar sign. Opens the Offers modal for this candidate. Only shown once a candidate record exists (i.e. after they were invited).' },
            { name: 'Recruiter Notes', kind: 'button', what: 'The notepad. Opens per-job private notes about this candidate.', how: 'Not rendered for Recruiters - the notes endpoint is admin-gated, so the button is hidden rather than shown and failing.', access: 'HR Admin & Super Admin' },
            { name: 'Cross-Job History', kind: 'button', what: 'The clock. Shows every other application this same person has made across every job, matched by email, normalised phone number or LinkedIn URL.', how: 'Available to everyone. The best way to spot a repeat applicant before you invest an interview slot.' },
            { name: 'Assign Coding Question', kind: 'button', what: 'The angle brackets. Opens the coding-assessment assignment modal.' },
            { name: 'Schedule Interview', kind: 'button', what: 'The calendar. Sets the earliest UTC time the candidate may start their interview, and offers a downloadable .ics invite.', how: 'The button is visible to everyone, but saving a schedule is an admin-only backend operation - as a Recruiter you can open it and read the current schedule, and a save will be rejected.' },
            { name: 'Communication Center', kind: 'button', what: 'The speech bubble. Sends templated emails to the candidate and shows the full email log.', how: 'Everyone can read the Email History tab. Sending is admin-only, and the Send tab tells you so rather than failing.' },
          ],
          warnings: [
            'Regenerating an interview link immediately invalidates the old one. If the candidate is mid-session with the old link, they lose it.',
          ],
        },
        {
          id: 'send-invite',
          title: 'Sending an interview invite',
          steps: [
            'Click the envelope on the candidate\'s row.',
            'Check **Candidate Name** - it is pre-filled from the résumé and is editable.',
            'Type the **Candidate Email**. This is required; the Create button stays disabled until it is filled.',
            'Optionally pick a **Scenario** to run a specific interview script instead of the default questions.',
            'Click **Create Interview Link**. The link is copied to your clipboard, shown to you in a browser alert, and the pipeline refreshes.',
          ],
          controls: [
            { name: 'Candidate Name', kind: 'field', what: 'Pre-filled from the résumé. Editable - this is the name the candidate is greeted with in the interview lobby.' },
            { name: 'Candidate Email', kind: 'field', what: 'Where the invite goes. Required.', how: 'The résumé\'s email is not pre-filled here; type or paste it. Get it from the résumé viewer.' },
            { name: 'Scenario (optional)', kind: 'filter', what: 'Picks an interview scenario from the active scenario list, or "- None -" for the default question set.', how: 'Scenarios are created by an administrator under Interview & Automation. If the dropdown only has "- None -", none have been set up.' },
            { name: 'Create Interview Link', kind: 'button', what: 'Creates the candidate record and the interview token. Shortlists the candidate first if they were still in "matched". Disabled until an email is entered.', how: 'The resulting URL is /interview/<token> on this site. It is copied to your clipboard automatically.' },
            { name: 'Cancel', kind: 'button', what: 'Closes the form. No candidate record is created and no stage change happens.' },
          ],
          tips: ['The alert box exists so you still have the link if the clipboard copy was blocked by the browser. Copy it out of the alert before dismissing it.'],
        },
      ],
    },
    {
      id: 'candidate-record',
      title: 'Working a candidate record',
      summary: 'The three modals that hold everything you know about a person: recruiter notes, their history across every job, and the email log.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'recruiter-notes',
          title: 'Recruiter Notes (HR Admin & Super Admin)',
          body: [
            'Private, freely editable notes attached to this candidate on this job. They are never shared with the candidate and can be edited at any pipeline stage. Deliberately separate from the one-shot decision note recorded at hire or reject time.',
          ],
          controls: [
            { name: 'Notes textarea', kind: 'field', what: 'Free text. Nothing is saved until you click Save Notes.', access: 'HR Admin & Super Admin' },
            { name: 'Save Notes', kind: 'button', what: 'Saves and stamps a "Last updated" time under the box. Toast: "Notes saved".', access: 'HR Admin & Super Admin' },
          ],
          faqs: [
            { q: 'Why can I not see the notes button?', a: 'Editing recruiter notes is restricted to HR Admins and Super Admins, so the button is hidden for Recruiters rather than shown and then failing. Use the cross-job notes in Cross-Job History, which are visible to everyone, if you need context.' },
          ],
        },
        {
          id: 'cross-job-history',
          title: 'Cross-Job History',
          body: [
            'Every other candidate or invite record, across every job, that shares this person\'s email, normalised phone number, or normalised LinkedIn URL. Read-only and open to everyone.',
            'Above the timeline sits the person\'s **cross-job notes** - notes about the human being, shared across every job they have ever applied to, as opposed to the per-job Recruiter Notes.',
          ],
          controls: [
            { name: 'Notes about this person', kind: 'field', what: 'The shared, cross-job note on this person\'s master profile. Only rendered when a master profile exists for them.', how: 'Read-only for Recruiters - the box is disabled and the label underneath reads "Admin-only to edit".' },
            { name: 'Save Notes', kind: 'button', what: 'Saves the cross-job note. Toast: "Cross-job notes saved".', access: 'HR Admin & Super Admin' },
            { name: 'Timeline entry', kind: 'column', what: 'One row per other application: the job title, a status badge, the invite type, the decision, when they applied and when a decision was made.' },
            { name: 'Status badge', kind: 'badge', what: 'Green = hired, red = rejected, blue = invited or interviewing, yellow = completed, grey = anything else or unknown.' },
          ],
          faqs: [
            { q: 'It says no other applications were found.', a: 'This person has no other record matching on email, phone or LinkedIn. It does not prove they never applied - a different email address on a different résumé will not match.' },
          ],
        },
        {
          id: 'communication-center',
          title: 'Communication Center',
          body: ['Two tabs: sending a templated email to the candidate, and the complete log of everything the system has ever emailed them.'],
          controls: [
            { name: 'Send Email', kind: 'tab', what: 'The composer. For Recruiters this tab shows "Sending candidate emails requires an admin account. You can still view the Email History tab." instead of the form.' },
            { name: 'Email History', kind: 'tab', what: 'The full email log for this candidate, newest first. Open to everyone. Loaded the first time you open the tab.' },
            { name: 'Template', kind: 'filter', what: 'Which email to send: **Assessment Invitation**, **Offer Letter**, **Reminder** or **Follow-up**.', access: 'HR Admin & Super Admin' },
            { name: 'Salary / Joining Date / Benefits', kind: 'field', what: 'Three extra fields that only appear when the template is Offer Letter, and are only sent for that template.', access: 'HR Admin & Super Admin' },
            { name: 'Send <template name>', kind: 'button', what: 'Sends the email. Success and failure are both recorded in the log - a failure is not silent, it becomes a "failed" row you can point at.', access: 'HR Admin & Super Admin' },
            { name: 'Refresh', kind: 'button', what: 'Re-fetches the email history. The header above it reads "<n> emails logged".' },
            { name: 'Status badge (history)', kind: 'badge', what: 'Green **sent** means the mail was handed off successfully. Red **failed** means delivery failed. Grey is any other state.' },
          ],
          faqs: [
            { q: 'The coding assessment said the email could not be sent.', a: 'Open Communication Center → Email History. The failed attempt is logged there with its subject and timestamp, which is what an administrator needs to diagnose the mail configuration.' },
          ],
        },
      ],
    },
    {
      id: 'interviews',
      title: 'AI interviews',
      summary: 'What happens after you send the link: the candidate takes a spoken, proctored interview in their browser, and you read the AI report when they are done.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'scheduling',
          title: 'Scheduling an interview slot',
          body: [
            'By default a candidate can start their interview the moment they open their link. Scheduling sets the earliest UTC time they are allowed to begin.',
            'All times on this screen are **UTC, not your local timezone** - that is deliberate, so there is one unambiguous source of truth.',
          ],
          controls: [
            { name: 'Scheduled Start (UTC)', kind: 'field', what: 'A date and time picker. The candidate cannot begin their session before this moment; opening the link earlier shows them "This interview isn\'t open yet".', how: 'Read it as UTC. Do the conversion yourself before you tell the candidate a time.' },
            { name: 'Save Schedule / Update Schedule', kind: 'button', what: 'Stores the slot. The label changes once a schedule already exists.', how: 'The underlying endpoint is admin-only, so a Recruiter can read the current schedule but a save will be rejected.', access: 'HR Admin & Super Admin' },
            { name: 'Clear Schedule', kind: 'button', what: 'Removes the slot so the candidate can start immediately. Asks for confirmation first. Any video meeting attached to the slot is cleared alongside it.', access: 'HR Admin & Super Admin' },
            { name: 'Create a video meeting for this slot', kind: 'toggle', what: 'Creates a real Zoom or Teams meeting for the slot and shows the join link. **Only rendered when a meeting provider is actually configured** - you will not see the checkbox otherwise.', how: 'A provider dropdown appears next to it only when more than one provider is configured. The schedule still saves even if the meeting creation fails; you get two separate messages.', access: 'HR Admin & Super Admin' },
            { name: '⬇ Download Calendar Invite (.ics)', kind: 'button', what: 'Downloads a standard calendar file for the slot. Only appears once a schedule exists.', how: 'Imports directly into Google Calendar, Outlook or Apple Calendar with no account connection. Forward it to the candidate yourself.' },
          ],
        },
        {
          id: 'candidate-experience',
          title: 'What the candidate sees at /interview/[token]',
          body: [
            'The interview link is public and token-gated - the candidate does not sign in. It is worth knowing exactly what they go through, because they will ask you.',
          ],
          steps: [
            'They open the link and land in a lobby explaining that this is a **spoken** interview and that the microphone and camera are required.',
            'They click **Allow access & start interview** and grant permissions. The clock does not start until this point, so granting permissions never eats into their time.',
            'The AI interviewer reads a question aloud, then the candidate clicks **Record your answer**, speaks, and clicks **Stop & submit answer**. Answers are capped at 3 minutes each.',
            'Their answer is transcribed and played back to them as text: "Here\'s what we heard - is this right?" They can **Record again** or **Use this answer →**.',
            'This repeats through every question. They can end early with **End Interview**.',
            'When the session is submitted, their answers and the integrity log are sent for evaluation, and they see "Interview complete. Your responses have been recorded."',
          ],
          controls: [
            { name: 'Interview timer', kind: 'column', what: 'Counts down the session duration, which is set per interview by the backend. Visible to the candidate in the header.' },
            { name: 'Question progress', kind: 'column', what: 'Reads "<current> / <total>" so the candidate knows how far through they are.' },
            { name: 'Violation counter', kind: 'badge', what: 'Appears as "⚠ n / 3" once the candidate has switched away from the tab at least once.' },
            { name: 'End Interview', kind: 'button', what: 'Submits whatever the candidate has answered so far and ends the session. Ignored while an answer is being transcribed or the next question is being prepared.' },
          ],
          tips: [
            'Camera video is analysed **in the candidate\'s browser only** and is never uploaded or recorded. Only boolean integrity signals are reported. Say this plainly when candidates ask.',
            'A session that has already been completed cannot be re-opened with the same link. Use Resend / Regenerate Interview Link if someone genuinely needs another attempt.',
          ],
          warnings: [
            'Tab switching is enforced. Each switch away from the interview tab is recorded and shows the candidate a warning; **after 3 the interview is submitted automatically and ended**. Leaving fullscreen is also recorded and prompts them to return.',
          ],
          faqs: [
            { q: 'The candidate says their link shows "This interview isn\'t open yet".', a: 'You have a schedule set on them and it is before the scheduled UTC start. Either wait, or clear the schedule.' },
            { q: 'The candidate says "Session Error" or the link is invalid.', a: 'The token is wrong, or the session was already completed. Regenerate the interview link from the pipeline.' },
            { q: 'The interview ended by itself.', a: 'They navigated away three times. The banner tells them their answers so far were submitted and that their recruiter has been notified - the flags are on their report.' },
          ],
        },
        {
          id: 'reading-the-report',
          title: 'Reading the AI report',
          body: ['Open it with the chart icon on a candidate in the **completed** stage.'],
          controls: [
            { name: '⬇ PDF', kind: 'button', what: 'Downloads the whole report as a PDF, named report_<first 8 characters of the token>.pdf.', how: 'Disabled until the report has loaded.' },
            { name: 'Eval Score', kind: 'column', what: 'The headline evaluation score for the session.', how: 'Deliberately hidden when no answer content was captured, so you never read a "0" as a genuine zero.' },
            { name: 'Match Score', kind: 'column', what: 'The résumé-to-JD match percentage, repeated here so you can weigh the interview against the paper fit.' },
            { name: 'Overall / Technical / Communication / Problem Solving / Cultural Fit / Confidence / Integrity', kind: 'column', what: 'The seven standard scoring dimensions. A dash means that dimension could not be derived.' },
            { name: 'Coding (tests) / Coding (quality)', kind: 'column', what: 'Two extra score tiles that appear **only** when the candidate actually submitted a coding assessment. Tests is how many test cases passed; quality is the AI\'s read on the code itself.' },
            { name: 'Recommendation', kind: 'badge', what: 'The AI\'s overall recommendation, shown in capitals in its own tile.' },
            { name: 'Scenario scores', kind: 'column', what: 'A second score grid, one tile per evaluation dimension, shown only when the interview ran a scenario.' },
            { name: 'Strengths / Areas for Improvement', kind: 'column', what: 'Two bulleted lists from the evaluation.' },
            { name: 'Integrity Assessment', kind: 'column', what: 'The AI\'s prose assessment of session integrity.' },
            { name: '⚠ Integrity Flags', kind: 'badge', what: 'The raw flag list - tab switches, fullscreen exits, and the proctoring signals (no face detected, more than one face, sustained gaze off screen).', how: 'Read these before you weigh the scores. A short session with three flags is a different conversation from a clean one.' },
            { name: 'Transcript', kind: 'column', what: 'The full question and answer exchange with timestamps, headed by the message count.' },
          ],
          faqs: [
            { q: 'The report says no answer content was captured.', a: 'The banner reads "⚠ No answer content was captured for this session, so the general score dimensions could not be derived. Integrity scoring is computed separately and remains valid." The candidate\'s audio never made it through. Integrity scoring is still trustworthy; the rest is not.' },
            { q: 'The report modal says it is not available yet.', a: '"Report not available yet. The evaluation may still be processing." Give it a few minutes and re-open it.' },
          ],
        },
      ],
    },
    {
      id: 'coding-assessments',
      title: 'Coding assessments',
      summary: 'Assign a coding question to a candidate from a shared question bank, or have the AI generate one on the spot. The candidate solves it on a public link and the result folds into their interview report.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'assigning',
          title: 'Assigning a question',
          steps: [
            'Click the angle-brackets icon on the candidate\'s pipeline row.',
            'Either stay on **Pick from Bank** and choose an existing question, or switch to **Generate with AI**.',
            'Read the preview panel: title, difficulty badge, the problem description, which languages have starter templates, and how many test cases there are and how many of those are hidden.',
            'Click **Assign to Candidate**. The candidate is emailed an assessment invite.',
          ],
          controls: [
            { name: 'Pick from Bank', kind: 'tab', what: 'Lists up to 100 existing questions as "<title> · <domain> · <difficulty>".', how: 'Empty bank message: "No coding questions yet - try Generate with AI, or add one from the Coding Questions admin page."' },
            { name: 'Generate with AI', kind: 'tab', what: 'Generates a brand-new question. The generated question is saved into the shared bank straight away, but is **never auto-assigned** - you must still click Assign.' },
            { name: 'Job Domain *', kind: 'field', what: 'Required for generation. Pre-filled from the selected job\'s parsed domain or its targeting domain when either exists.', how: 'Use the same style as the classifier, e.g. "software_engineering".' },
            { name: 'Difficulty', kind: 'filter', what: 'Easy, Medium (default) or Hard for the generated question.' },
            { name: 'Topic Hint (optional)', kind: 'field', what: 'Steers what the question is about, e.g. "binary trees, string parsing".' },
            { name: '✨ Generate with AI', kind: 'button', what: 'Generates the question and selects it for preview. Disabled until Job Domain has a value.', how: 'A failure prints "AI question generation failed - please try again" under the button.' },
            { name: 'Difficulty badge', kind: 'badge', what: 'In the preview: green for easy, yellow for medium, red for hard.' },
            { name: 'Assign to Candidate', kind: 'button', what: 'Assigns the selected question and emails the candidate their assessment link. Disabled until a question is selected.', how: 'The confirmation tells you whether the email actually went out. If it did not, the failure is in the Communication Center log.' },
          ],
          tips: ['Generated questions land in the shared bank, so a good one is reusable. Generate once, then pick it from the bank for the next candidate.'],
        },
        {
          id: 'candidate-coding-experience',
          title: 'What the candidate sees at /coding/[token]',
          body: [
            'A public, token-gated page with the problem on the left and a simple code editor on the right. No sign-in.',
          ],
          controls: [
            { name: 'Sample Test Cases', kind: 'column', what: 'The visible test cases with their input and expected output. Hidden test cases are not shown to the candidate at all.' },
            { name: 'Language select', kind: 'filter', what: 'Switches between the languages that have starter templates. Each language keeps its own draft, so switching never loses code they already wrote.' },
            { name: 'Submit', kind: 'button', what: 'Runs their code against every test case, visible and hidden, and returns a score. Disabled once submitted.', how: 'The editor locks after submission - it is one attempt.' },
            { name: 'Score', kind: 'column', what: 'The percentage of test cases passed. Visible cases are listed individually as PASS or FAIL with expected and actual output; hidden cases are summarised as "<x> of <y> hidden tests passed".' },
          ],
          tips: ['Once a candidate has submitted, their interview report grows two extra tiles: Coding (tests) and Coding (quality).'],
        },
      ],
    },
    {
      id: 'offers',
      title: 'Offers',
      summary: 'Create, approve, send and withdraw offers for a candidate, and see what the candidate sees when they open their offer link.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'offer-lifecycle',
          title: 'The offer lifecycle',
          body: [
            'Open the Offers modal with the dollar icon on a candidate row. Every offer this candidate has is listed with its status badge and salary.',
            'The lifecycle runs **draft or pending approval → approved → sent → accepted or declined**, with **withdrawn** available at any point before the candidate responds.',
            'Creating, approving, sending and withdrawing are all administrator operations. A Recruiter sees the offer list and its statuses but no create form and no action buttons.',
          ],
          controls: [
            { name: 'Salary *', kind: 'field', what: 'Free text, e.g. "£55,000 / year". Required - the Create button stays disabled without it.', access: 'HR Admin & Super Admin' },
            { name: 'Benefits', kind: 'field', what: 'Free text, e.g. "Private healthcare, 25 days leave".', access: 'HR Admin & Super Admin' },
            { name: 'Joining Date', kind: 'field', what: 'A date picker for the proposed start date.', access: 'HR Admin & Super Admin' },
            { name: 'Create Offer', kind: 'button', what: 'Creates the offer against this candidate. It does **not** send anything to the candidate.', access: 'HR Admin & Super Admin' },
            { name: 'Approve', kind: 'button', what: 'Moves an offer from draft or pending approval to approved. Only shown on offers in those two states.', access: 'HR Admin & Super Admin' },
            { name: 'Send', kind: 'button', what: 'Sends an approved offer to the candidate - this is the step that emails them their offer link. Only shown on approved offers.', access: 'HR Admin & Super Admin' },
            { name: 'Withdraw', kind: 'button', what: 'Withdraws the offer. Asks "Withdraw this offer? The candidate will no longer be able to respond." Shown on any offer that is not already accepted, declined or withdrawn.', access: 'HR Admin & Super Admin' },
          ],
          warnings: ['Withdrawing is terminal. The candidate\'s offer link stops working immediately and there is no un-withdraw - you would have to create a new offer.'],
          faqs: [
            { q: 'The offer says "sent" but the Offer Acceptance Rate on the dashboard did not move.', a: 'That card counts sent offers. It only updates when the overview page reloads its data - navigate away and back.' },
            { q: 'There are no buttons on any of the offer rows.', a: 'Either every offer is in a terminal state (accepted, declined, withdrawn), or you are signed in as a Recruiter, in which case offer management is read-only for you.' },
          ],
        },
        {
          id: 'offer-statuses',
          title: 'Offer status badges',
          controls: [
            { name: 'draft', kind: 'badge', what: 'Yellow. Created but not approved. Can be approved or withdrawn.' },
            { name: 'pending approval', kind: 'badge', what: 'Yellow. Waiting on an approver. Can be approved or withdrawn.' },
            { name: 'approved', kind: 'badge', what: 'Yellow. Signed off internally but not yet sent to the candidate. Can be sent or withdrawn.' },
            { name: 'sent', kind: 'badge', what: 'Blue. The candidate has been emailed their offer link and can respond. Can still be withdrawn.' },
            { name: 'accepted', kind: 'badge', what: 'Green. The candidate accepted. Terminal - no actions remain.' },
            { name: 'declined', kind: 'badge', what: 'Red. The candidate declined, optionally with a reason. Terminal.' },
            { name: 'withdrawn', kind: 'badge', what: 'Red. You pulled the offer. Terminal.' },
          ],
        },
        {
          id: 'candidate-offer-page',
          title: 'What the candidate sees at /offer/[token]',
          body: [
            'A public, token-gated page showing Job Title, Company, Salary, Benefits and Joining Date, with two buttons.',
          ],
          controls: [
            { name: 'Accept Offer', kind: 'button', what: 'Records the acceptance immediately. The candidate then sees "Offer Accepted - the hiring team will be in touch with next steps."' },
            { name: 'Decline', kind: 'button', what: 'Opens a "Reason for declining (optional)" box with **Back** and **Confirm Decline**. The reason is stored on the offer.' },
          ],
          faqs: [
            { q: 'The candidate says the link shows "Invalid Link".', a: 'The token does not match any active offer. Confirm the offer was actually **sent** and not just approved.' },
            { q: 'The candidate says "Offer No Longer Active".', a: 'They already responded to it, or it was withdrawn. Their response is recorded on the offer row in the modal.' },
          ],
        },
      ],
    },
  ],
}


const activity: GuideChapter = {
  id: 'activity',
  title: 'Activity',
  blurb: 'The audit trail for processing: what happened to every résumé upload batch, and which job descriptions have passed their deadline.',
  sections: [
    {
      id: 'activity-resumes',
      title: 'Resume processing',
      path: '/dashboard/activity',
      summary: 'The last 25 upload batches, paginated 10 at a time, each expandable into a full summary with costs, per-JD counts and per-file failure reasons. This is the first place to look when an upload did not do what you expected.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'batch-list',
          title: 'The batch list',
          controls: [
            { name: 'Resumes', kind: 'tab', what: 'The résumé processing view. The default tab.' },
            { name: '↻ Refresh', kind: 'button', what: 'Re-fetches the batch list and returns you to page 1.', how: 'The list also refreshes by itself when a background upload finishes while you are on this page.' },
            { name: 'Batch row', kind: 'link', what: 'Reads "✓ Processed", "✕ Failed" or "⏳ Processing" followed by "<processed>/<total> resumes", then who uploaded it, when, and the batch cost. Click anywhere on it (or press Enter) for the full summary.' },
            { name: 'View details →', kind: 'link', what: 'The affordance on each row. Opens the batch summary modal.' },
            { name: 'Clear all', kind: 'button', what: 'Removes every batch notification from this list. Asks for confirmation, which spells out that **processed résumés are kept** - only the notifications go.', access: 'Super Admin only' },
            { name: 'Dismiss notification', kind: 'button', what: 'The ✕ on a single row. Removes that one batch notification, again keeping the processed résumés.', access: 'Super Admin only' },
            { name: '← Prev / Next →', kind: 'button', what: 'Pagination at 10 batches per page, with "showing X-Y of N".' },
          ],
          faqs: [
            { q: 'The list is empty.', a: '"No upload batches yet. Upload resumes to see processing activity here." Either nothing has been uploaded, or a Super Admin has cleared the notifications.' },
          ],
        },
        {
          id: 'batch-summary',
          title: 'The batch summary',
          body: ['Seven counters that between them explain exactly where every file went.'],
          controls: [
            { name: 'Uploaded', kind: 'column', what: 'How many files the batch started with.' },
            { name: 'Processed', kind: 'column', what: 'How many were successfully parsed and classified.' },
            { name: 'Duplicates skipped', kind: 'column', what: 'Files whose content already existed in the pool. No second record was created.' },
            { name: 'Failed', kind: 'column', what: 'Files that could not be processed. Each one is listed by name with its error under "Failed files".' },
            { name: 'Matched to JDs', kind: 'column', what: 'How many of the processed résumés were matched to at least one job description.' },
            { name: 'Not matched', kind: 'column', what: 'Processed résumés that matched no open JD.', how: 'A large number here usually means no open JD covers that domain, or your JDs are past their deadlines.' },
            { name: 'Auto-invited', kind: 'column', what: 'How many cleared the automatic-invite bar and were invited without anyone clicking.' },
            { name: 'OpenAI cost (this batch)', kind: 'column', what: 'The estimated cost of this batch to four decimal places, with the prompt, completion and embedding token counts underneath.' },
            { name: 'Resumes per Job Description', kind: 'column', what: 'How many résumés from this batch landed on each JD, by title.', how: 'Empty note: "No resumes from this batch matched an open JD." This is the single most useful line when an upload looks like it did nothing.' },
            { name: 'Failed files (n)', kind: 'column', what: 'The filename and the exact error for every failure in the batch.' },
            { name: 'Ignored files note', kind: 'column', what: 'When present, tells you how many temp or invalid files were dropped before processing even began - Word "~$" lock files and similar.' },
          ],
          faqs: [
            { q: 'Processed is high but Matched to JDs is 0.', a: 'The résumés are in the pool but nothing matched. Check that you have an open JD in that domain and that it has not passed its deadline. A Super Admin can force a full Re-match from the Recruiting workspace.' },
            { q: 'Everything shows as a duplicate.', a: 'Those exact files are already in the pool. Duplicate detection is on content, so re-uploading the same PDFs from a different folder still skips them.' },
          ],
        },
        {
          id: 'purge-resumes',
          title: 'Delete resumes by date (Super Admin only)',
          body: ['A danger zone at the bottom of the Resumes tab, headed "⚠ Delete resumes by date (super admin)". Not rendered for Recruiters or HR Admins.'],
          controls: [
            { name: 'From', kind: 'field', what: 'The start of the deletion window. Optional if To is set - leaving it blank means "from the beginning".', access: 'Super Admin only' },
            { name: 'To', kind: 'field', what: 'The end of the window. Optional if From is set - leaving it blank means "to now".', access: 'Super Admin only' },
            { name: 'Delete resumes', kind: 'button', what: 'Permanently deletes every résumé created in the window from the database, the file store and every JD pipeline. Requires at least one date ("Pick at least one date.") and a confirmation that spells out the range.', access: 'Super Admin only' },
          ],
          warnings: ['This is a real, irreversible deletion - not a notification tidy-up. It removes the résumés from every store at once and cannot be undone. Do not confuse it with "Clear all", which only clears batch notifications.'],
        },
      ],
    },
    {
      id: 'activity-jds',
      title: 'Job descriptions activity',
      path: '/dashboard/activity',
      summary: 'The list of job descriptions that have passed their application deadline, plus the automatic cleanup switch.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'expired-jds',
          title: 'The expired list',
          controls: [
            { name: 'Job Descriptions', kind: 'tab', what: 'Switches to the JD lifecycle view.' },
            { name: '↻ Refresh', kind: 'button', what: 'Re-fetches the expired list and the auto-delete setting.' },
            { name: 'Expired row', kind: 'column', what: 'The JD title, the company, "closed <date>", the source, and an **Expired** badge.', how: 'An expired JD accepts no new candidate matches. Its existing pipeline is still reachable from the Recruiting workspace.' },
            { name: '<n> expired JDs', kind: 'column', what: 'The count above the list.' },
            { name: 'Auto-delete expired JDs', kind: 'toggle', what: 'When on, job descriptions are removed automatically once their deadline passes, and this tab shows a summary instead of a list - including how many were just cleaned up.', access: 'Super Admin only' },
            { name: 'Delete all expired', kind: 'button', what: 'Deletes every expired JD in one go, after a confirmation naming the count.', access: 'Super Admin only' },
            { name: 'Delete this JD', kind: 'button', what: 'The ✕ on a single expired row. Deletes that one JD after a confirmation.', access: 'Super Admin only' },
            { name: '← Prev / Next →', kind: 'button', what: 'Pagination at 10 JDs per page, with "showing X-Y of N".' },
          ],
          warnings: ['Deleting a job description here is permanent and takes its candidate pipeline with it. Turning on auto-delete makes that happen without anyone confirming each one.'],
          faqs: [
            { q: 'The tab says auto-delete is on and shows no list.', a: 'That is expected - with auto-delete on there is nothing to clean up manually. The message also tells you how many were just removed.' },
            { q: 'A job I still need is on the expired list.', a: 'Open it in Recruiting, click Edit, and raise **Days open** (or set it to 0 for no deadline). It drops off this list on the next refresh.' },
          ],
        },
      ],
    },
  ],
}


const reference: GuideChapter = {
  id: 'reference',
  title: 'Reference',
  blurb: 'The built-in API browser, and a glossary of every status, stage and score term the product uses.',
  sections: [
    {
      id: 'api-reference',
      title: 'API Reference',
      path: '/dashboard/api-reference',
      summary: 'A browsable catalogue of every backend endpoint, grouped by area, with request and response examples you can copy. It documents the API; it does not call it.',
      access: 'All signed-in users (not linked from the sidebar - reach it by URL)',
      subsections: [
        {
          id: 'api-reference-controls',
          title: 'Browsing the endpoints',
          body: [
            'This page is not in the sidebar. Type **/dashboard/api-reference** into the address bar to open it. Any signed-in user can view it.',
            'The header shows the API version, the auth scheme, and the base URL the app is pointed at.',
          ],
          controls: [
            { name: 'Search endpoints, paths, methods…', kind: 'filter', what: 'Filters endpoints by a case-insensitive substring of the path, description, method or identifier. Local - the whole catalogue is already loaded.', how: 'The ✕ clears it.' },
            { name: 'All Methods', kind: 'filter', what: 'Narrows to one HTTP method: GET, POST, PATCH, DELETE or WEBSOCKET.' },
            { name: 'All Auth', kind: 'filter', what: 'All Auth (default), **Auth Required** (needs a bearer token), or **Public** (no token).' },
            { name: '<n> of <m> endpoints', kind: 'column', what: 'How many endpoints your filters leave visible out of the total.' },
            { name: 'Group header', kind: 'button', what: 'Collapses or expands a group. The groups are System, Auth, Jobs, Resumes, Candidates, Interview and Intel. The first visible group is open by default; the rest start collapsed.' },
            { name: 'Endpoint card', kind: 'button', what: 'Click to expand. Shows Path Params, Query Params, request body examples and response examples.' },
            { name: 'JWT / Public', kind: 'badge', what: 'On each endpoint: **JWT** means it needs a bearer token, **Public** means it does not.' },
            { name: 'Role badge', kind: 'badge', what: 'Any extra role the endpoint requires, printed next to the auth badge. This is the authoritative answer to "why can I not do X" for a given operation.' },
            { name: 'Copy', kind: 'button', what: 'Copies that JSON block to your clipboard and flashes "Copied!" for a moment.' },
          ],
          tips: ['If a button in the product is hidden for your role, find the matching endpoint here - its role badge tells you exactly which role it needs.'],
        },
      ],
    },
    {
      id: 'glossary',
      title: 'Glossary',
      summary: 'Every status, stage, score and badge the product shows you, in one place.',
      access: 'All signed-in users',
      subsections: [
        {
          id: 'glossary-stages',
          title: 'Candidate pipeline stages',
          controls: [
            { name: 'matched', kind: 'badge', what: 'The matcher surfaced this résumé against this job description. Nobody has acted on it yet. This is where everyone starts.' },
            { name: 'shortlisted', kind: 'badge', what: 'Moved forward from matched. The app sets it automatically when you send an interview invite to someone who was still in matched.' },
            { name: 'invited', kind: 'badge', what: 'A candidate record and an interview link exist. The envelope becomes a disabled "already sent" indicator, and the "Resend / Regenerate Interview Link" button becomes available.' },
            { name: 'interviewing', kind: 'badge', what: 'Between the invite and a submitted session. The app treats it exactly like invited - the same invite action remains available.' },
            { name: 'completed', kind: 'badge', what: 'The interview session was submitted. **This is the only stage where the AI report button works.**' },
            { name: 'hired', kind: 'badge', what: 'You marked them hired. Feeds the Hired counters and the hiring funnel.' },
            { name: 'rejected', kind: 'badge', what: 'You rejected them. They stay in the pipeline under the rejected filter - rejecting is not deleting.' },
          ],
        },
        {
          id: 'glossary-scores',
          title: 'Scores and score bands',
          controls: [
            { name: 'Match score', kind: 'column', what: 'The AI similarity between one résumé and one job description, 0-100%. Shown in the pipeline\'s Score column, repeated on the interview report, and the thing the Min match score slider filters on.', how: 'The pipeline slider defaults to 50%, and the job list\'s "<n> candidates" count uses a fixed 50% threshold. Both numbers therefore describe candidates at 50% and above unless you move the slider.' },
            { name: 'Eval Score', kind: 'column', what: 'The headline score for an interview session. Suppressed on the report when no answer content was captured, so a visible 0 is never an artefact.' },
            { name: 'Profile score / completeness', kind: 'column', what: 'How rich the extracted profile is, 0-100%. Banded **green at 75 and above**, **amber 50 to 74**, **red below 50**.', how: 'It measures extraction quality, not candidate quality.' },
            { name: 'Coding (tests) / Coding (quality)', kind: 'column', what: 'Two report tiles that only exist once a coding assessment was submitted: the proportion of test cases passed, and the AI\'s judgement of the code itself.' },
          ],
        },
        {
          id: 'glossary-invites',
          title: 'Invite types and integrity',
          controls: [
            { name: 'Auto-invited', kind: 'badge', what: 'The candidate was invited during upload processing because they cleared the automatic-invite bar. Nobody clicked anything.' },
            { name: 'Manually invited', kind: 'badge', what: 'A recruiter invited them from the pipeline using the envelope button.' },
            { name: 'Integrity flags', kind: 'badge', what: 'Events recorded during an interview session: switching away from the tab, leaving fullscreen, no face detected, more than one face detected, and sustained gaze away from the screen.', how: 'Face and gaze signals are computed in the candidate\'s browser; the video itself is never uploaded. Three tab switches end the session automatically.' },
            { name: 'insufficient_transcript', kind: 'badge', what: 'The evaluation status when no answer content was captured. The general score dimensions cannot be derived; integrity scoring is computed separately and stays valid.' },
          ],
        },
        {
          id: 'glossary-batches',
          title: 'Upload batch statuses',
          controls: [
            { name: 'queued', kind: 'badge', what: 'The batch was accepted but has not started processing.' },
            { name: 'processing', kind: 'badge', what: 'Files are being parsed, classified and matched.' },
            { name: 'completed', kind: 'badge', what: 'Every file has been handled. Note that this does not mean every file succeeded - check the Failed counter.' },
            { name: 'failed', kind: 'badge', what: 'The batch itself failed. Different from individual files failing inside a completed batch.' },
            { name: 'Skipped / Duplicates skipped', kind: 'column', what: 'Files whose content already existed in the pool. No second record is created and nothing is overwritten.' },
          ],
        },
        {
          id: 'glossary-other',
          title: 'Other statuses',
          controls: [
            { name: 'Offer statuses', kind: 'badge', what: 'draft, pending approval, approved (all yellow); sent (blue); accepted (green); declined and withdrawn (red). Accepted, declined and withdrawn are terminal.' },
            { name: 'Referral statuses', kind: 'badge', what: 'submitted (blue), reviewing (yellow), hired (green), rejected (red).' },
            { name: 'Email log status', kind: 'badge', what: 'sent (green), failed (red), anything else grey. Every send attempt is logged whether or not it succeeded.' },
            { name: 'Expired (JD)', kind: 'badge', what: 'A job description past its application deadline. It accepts no new candidate matches; its existing pipeline is still readable.' },
            { name: 'Open · no deadline', kind: 'badge', what: 'What the deadline bar shows when Days open was set to 0. The JD never expires.' },
          ],
        },
      ],
    },
  ],
}


export const coreChapters: GuideChapter[] = [
  gettingStarted,
  dashboardOverview,
  recruiting,
  activity,
  reference,
]

export const recruiterGuide: RoleGuide = {
  role: 'standard',
  label: 'Recruiter',
  tagline: 'Day-to-day hiring: job descriptions, résumés, the candidate pipeline, interviews and offers.',
  intro: [
    'This is the guide for the **Recruiter** role. It covers every screen you can open and every control on them, in the order you meet them: signing in, the dashboard, the Hirely.ai recruiting workspace, the activity log, and a glossary at the end.',
    'Your day usually runs in one loop: write or import a job description, upload résumés against it, work the candidate pipeline, send interview invites, read the AI reports, and hand the strongest people to an administrator for an offer.',
    'A handful of controls on these screens belong to HR Admins or Super Admins. They are still documented - each one is marked with the role it needs - so that when a button is missing from your screen you can see exactly why and who to ask.',
    'Two things are worth internalising before you start. The candidate pipeline hides anyone below a **50% match score** by default, which is the single most common reason a candidate "is missing". And the **Activity** page explains what happened to every upload, which is the single most common reason an upload "did nothing".',
  ],
  chapters: coreChapters,
}

export default recruiterGuide
