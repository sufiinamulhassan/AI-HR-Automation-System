import type { GuideChapter, RoleGuide } from '../types'
import { coreChapters } from './recruiterGuide'
import { adminChapters } from './hrAdminGuide'

export const superAdminChapters: GuideChapter[] = [
  {
    id: 'sa-powers',
    title: 'Powers only you have',
    blurb:
      'Every control in the product that is gated behind the superadmin role, in one place. Some live on the Super-Admin-only screen; most are individual buttons hidden inside screens an HR Admin can otherwise use in full. If a colleague says "I cannot see that button", it is almost certainly on this list.',
    sections: [
      {
        id: 'powers-index',
        title: 'The complete list',
        summary:
          'A dozen or so capabilities are reserved to Super Admin. Most are enforced by the API itself and will return 403 to anyone else regardless of what the interface shows; a few are enforced only by the interface hiding or disabling the control. Both kinds are listed, and the difference is called out per row, because it changes what happens if someone works around the UI.',
        subsections: [
          {
            id: 'powers-table',
            title: 'Capability index',
            body: [
              'Each row names the control, what it does, and where in this guide the surrounding screen is documented.',
            ],
            controls: [
              {
                name: 'Delete (user)',
                kind: 'button',
                what: 'The trash icon in the Actions column on Users & Roles. Permanently removes a user account.',
                how: 'See Users & Roles below. Hidden entirely from an HR Admin, and API-enforced on top of that.',
                access: 'API-enforced',
              },
              {
                name: 'Seeing every user in the list',
                kind: 'filter',
                what: 'The Users tab list. You get every account; an HR Admin\'s request is answered with Recruiter accounts only.',
                how: 'See Users & Roles below. This is why an HR Admin sees Recruiters, Active and Inactive cards where you see Total Users, Super Admins, HR Admins and Active.',
                access: 'API-enforced',
              },
              {
                name: 'Assigning any role',
                kind: 'field',
                what: 'Changing which role a user holds, from either the Create/Edit User modal or the RBAC endpoint. Also the reason only you see Super Admin in the Role dropdown.',
                how: 'See Users & Roles below. Attempting a role write as an HR Admin returns 403 "Only a Super Admin can change a user\'s role".',
                access: 'API-enforced',
              },
              {
                name: 'Creating, editing and deleting custom roles',
                kind: 'button',
                what: '+ New Role, the pencil and trash icons on a custom role column, and every checkbox in the permission matrix.',
                how: 'See The permission matrix below. For an HR Admin these controls are disabled and carry the tooltip "Only a Super Admin can do this".',
                access: 'API-enforced (rbac:manage)',
              },
              {
                name: 'Save Changes (Security Policies)',
                kind: 'button',
                what: 'Changes the password rules, account lockout and session timeout for every account, on Platform Settings → Security Policies.',
                how: 'An HR Admin can open the tab and read the policy, with the fields disabled and a "Read only" badge, but has no Save button.',
                access: 'API-enforced (security:manage)',
              },
              {
                name: 'Setting a department on an admin account',
                kind: 'field',
                what: 'The Department field on the Create/Edit User modal. An HR Admin can set it for Recruiter accounts only.',
                how: 'See Users & Roles below.',
                access: 'Super Admin for any account',
              },
              {
                name: 'Clear all',
                kind: 'button',
                what: 'Wipes the whole batch-notification list on Activity → Resumes.',
                how: 'See Activity below.',
                access: 'API-enforced',
              },
              {
                name: 'Dismiss notification (✕)',
                kind: 'button',
                what: 'Per-row dismiss on a single resume batch.',
                how: 'See Activity below.',
                access: 'API-enforced',
              },
              {
                name: '⚠ Delete resumes by date (super admin)',
                kind: 'button',
                what: 'The date-range resume purge. The most destructive control in the product.',
                how: 'See Activity below. Read its warnings before you touch it.',
                access: 'API-enforced',
              },
              {
                name: 'Auto-delete expired JDs',
                kind: 'toggle',
                what: 'A company-wide switch that deletes every expired job description on sight.',
                how: 'See Activity below.',
                access: 'API-enforced',
              },
              {
                name: 'Delete all expired',
                kind: 'button',
                what: 'One-shot deletion of every expired job description.',
                how: 'See Activity below.',
                access: 'API-enforced',
              },
              {
                name: 'Delete this JD (✕)',
                kind: 'button',
                what: 'Per-row delete on an expired job description in the Activity list.',
                how: 'See Activity below. UI-gated only: the underlying delete-job endpoint accepts any admin, and an HR Admin can delete the same job from the Recruiting workspace. What is reserved is doing it from this list.',
                access: 'UI-gated only',
              },
              {
                name: 'Re-match',
                kind: 'button',
                what: 'Re-runs matching for every resume against every job description.',
                how: 'See AI model and spend below. UI-gated only: the endpoint accepts any admin.',
                access: 'UI-gated only',
              },
              {
                name: 'Super Admin option in the Role dropdown',
                kind: 'field',
                what: 'The Super Admin entry in the Create/Edit User modal\'s Role select. Filtered out of the list for anyone else.',
                how: 'See Users & Roles below. Backed by the API-enforced role-write rule, so hiding it is defence in depth rather than the only barrier.',
                access: 'API-enforced',
              },
              {
                name: 'Models by Job (Platform Settings)',
                kind: 'field',
                what: 'Changing a job\'s model writes your company\'s choice for that job, for everyone in it, not a personal preference, for you and for an HR Admin alike.',
                how: 'See AI model and spend below. It is on this list because the consequence reaches everyone in your company.',
                access: 'Admin & Super Admin (shared)',
              },
            ],
            warnings: [
              'The rows marked "UI-gated only" are hidden, not forbidden. An HR Admin who calls the API directly can trigger them. Treat the UI gate as a guardrail against accidents, not as a security boundary. The security boundary is the API-enforced rows.',
            ],
          },
        ],
      },
      {
        id: 'powers-activity',
        title: 'Activity, the destructive controls',
        path: '/dashboard/activity',
        access: 'Page is open to all signed-in users; the controls below are Super Admin only',
        summary:
          'Every role can read Activity, the resume-processing batch history and the expired job-description list. Reach it from the bell icon on the right of the top bar on any dashboard page. There is no Activity entry in the sidebar itself. What only you see are the deletion controls layered on top: dismissing batch notifications, purging resumes by date, and clearing out expired job descriptions manually or automatically. Two of these permanently destroy candidate data.',
        subsections: [
          {
            id: 'pa-resumes',
            title: 'Resumes tab',
            body: [
              'The Resumes tab lists the most recent upload batches, newest first, ten per page, up to twenty-five in total. Each row shows the outcome and count, who uploaded it, when, and the batch\'s AI cost. Clicking a row opens the batch summary modal.',
              'A batch record is a notification, not the data. Dismissing or clearing batches removes only the processing history from this list; the resumes themselves are untouched and stay in the pipeline and the search index. Both confirm dialogs say so explicitly.',
            ],
            controls: [
              {
                name: 'Clear all',
                kind: 'button',
                what: 'Deletes every batch notification record in one call. The list empties immediately. Processed resumes are not affected.',
                how: 'Only rendered when there is at least one batch and you are Super Admin. Confirm text: "Clear all batch notifications? (Processed resumes are kept.)" Use it when the list is cluttered with old runs and nobody needs the history.',
                access: 'Super Admin only',
              },
              {
                name: '✕ (Dismiss notification)',
                kind: 'button',
                what: 'Deletes one batch notification record. Tooltip reads "Dismiss notification".',
                how: 'Sits at the right end of each batch row and stops the click from also opening the batch modal. Confirm text: "Dismiss this batch notification? (Processed resumes are kept.)" Failures are swallowed silently. If the row does not disappear, the delete did not happen.',
                access: 'Super Admin only',
              },
              {
                name: '↻ Refresh',
                kind: 'button',
                what: 'Re-fetches the batch list and returns to page 1. Available to every role.',
                how: 'The list also refreshes on its own when a background upload finishes.',
              },
              {
                name: '⚠ Delete resumes by date (super admin)',
                kind: 'button',
                what: 'The section header of the danger panel at the bottom of the tab. Its body reads "Permanently remove resumes created in a date range from all stores."',
                how: 'Only rendered for Super Admin. This panel is the only place in the product that deletes resumes in bulk.',
                access: 'Super Admin only',
              },
              {
                name: 'From',
                kind: 'field',
                what: 'Date input. Inclusive lower bound on the resume\'s creation date. Leave blank to mean "from the very beginning".',
                how: 'Compared against the stored creation timestamp as a date string, so a blank From with a filled To means "everything up to and including that day".',
                access: 'Super Admin only',
              },
              {
                name: 'To',
                kind: 'field',
                what: 'Date input. Inclusive upper bound. Leave blank to mean "up to now". The whole of the chosen day is included, to the last microsecond.',
                how: 'Because it is inclusive to end-of-day, picking today deletes resumes uploaded minutes ago.',
                access: 'Super Admin only',
              },
              {
                name: 'Delete resumes',
                kind: 'button',
                what: 'Runs the purge. Label becomes "Deleting…". On success the panel reports "Deleted N resumes." and the batch list reloads.',
                how: 'With both dates blank it refuses and shows "Pick at least one date.", but note this is the only guard: with one date filled and the other blank, the unbounded side is genuinely unbounded. The confirm dialog spells out the resolved range, e.g. "Permanently delete ALL resumes created between the beginning → 2026-08-07?"',
                access: 'Super Admin only',
              },
            ],
            warnings: [
              'The resume purge is permanent and there is no undo. The confirm dialog states the scope exactly: "This removes them from the database, file store, and JD pipelines. This cannot be undone."',
              'It deletes four things at once: the resume records, the original uploaded files, the candidates\' rows inside every job description\'s pipeline, and the vectors in the search index. A candidate who was mid-pipeline simply vanishes from that job.',
              'A blank From means "since the beginning of time". Filling only To and pressing Delete resumes wipes the entire resume history up to that date. Always fill both boxes unless you genuinely intend an unbounded purge.',
              'The purge is capped at 100,000 resumes per run. On a very large tenant that means one press may not finish the job, and the reported count will be lower than the true range. Re-run until it reports 0.',
            ],
            faqs: [
              {
                q: 'It says "Delete failed."',
                a: 'The request errored. Nothing is partially deleted at the record level, but the operation is a sequence of steps. If it failed midway, re-running the same range is safe and idempotent.',
              },
              {
                q: 'I purged resumes but the lifetime AI spend figure did not go down.',
                a: 'Correct and intentional. The cost ledger is append-only and is never touched by batch clears or resume purges, so the platform\'s lifetime spend total survives any amount of Activity housekeeping.',
              },
            ],
          },
          {
            id: 'pa-jds',
            title: 'Job Descriptions tab',
            body: [
              'This tab lists job descriptions whose application deadline has passed, most-recently-expired first, ten per page. An expired job description stops accepting new resume matches but is otherwise still in the system.',
            ],
            controls: [
              {
                name: 'Auto-delete expired JDs',
                kind: 'toggle',
                what: 'A company-wide switch. When on, expired job descriptions are deleted the moment anyone opens this tab, and the list is always empty. Its own caption reads "When on, JDs are removed automatically once their deadline passes. Super-admin only."',
                how: 'The deletion happens on read, not on a schedule, so nothing is removed until a person visits the page, and then everything expired goes at once. Turning it off stops future deletions but does not bring anything back. With it on, the list is replaced by "Auto-delete is on. Expired JDs are removed automatically." plus a count of what was just cleaned up.',
                access: 'Super Admin only',
              },
              {
                name: 'Delete all expired',
                kind: 'button',
                what: 'Deletes every expired job description in one call and reports "Deleted N expired JDs."',
                how: 'Only shown when auto-delete is off and there is at least one expired job. Confirm text names the count: "Delete ALL N expired job descriptions? This cannot be undone."',
                access: 'Super Admin only',
              },
              {
                name: '✕ (Delete this JD)',
                kind: 'button',
                what: 'Deletes one expired job description. Tooltip reads "Delete this JD".',
                how: 'Confirm text: "Delete this expired job description? This cannot be undone." Use it to clear a single stale posting without touching the rest.',
                access: 'Super Admin only in this list',
              },
              {
                name: 'Expired',
                kind: 'badge',
                what: 'Red badge on every row in this list. Every row here is expired by definition. The badge is a label, not a filter result.',
              },
              {
                name: '↻ Refresh',
                kind: 'button',
                what: 'Re-fetches the expired list and returns to page 1. Available to every role.',
                how: 'With auto-delete on, pressing this is what triggers the deletion sweep.',
              },
            ],
            warnings: [
              'Deleting a job description is permanent and takes its candidate pipeline with it. Every candidate\'s stage, notes and history for that job are gone. The resumes survive, the recruiting context does not.',
              'Auto-delete is the single most consequential toggle on this page, because it removes the human confirmation step forever. With it on, nobody is ever asked "are you sure" again. A job description whose deadline passes is destroyed the next time anyone loads the Activity page. Leave it off unless you have a written retention policy that says otherwise.',
              'Turning auto-delete on hides the list. You lose the ability to review what is about to be deleted, because it is already gone by the time the page renders.',
              'A job description with no deadline never expires and never appears here. Auto-delete cannot touch it.',
            ],
          },
        ],
      },
      {
        id: 'powers-users',
        title: 'Users & Roles, what changes for you',
        path: '/dashboard/users',
        access: 'HR Admin & Super Admin, with several controls reserved to Super Admin',
        summary:
          'An HR Admin can open this screen and see all three tabs, but the page narrows for them: the user list holds Recruiter accounts only, deletion is hidden, the Role field is not shown on the edit form, and the permission-matrix controls are disabled. This section covers only those differences. The screen itself is documented in the Administration chapters.',
        subsections: [
          {
            id: 'pu-users',
            title: 'Users tab',
            controls: [
              {
                name: 'The user list itself',
                kind: 'column',
                what: 'You receive every account. An HR Admin\'s request is filtered server-side to Recruiters only, so admin and Super Admin accounts are not in what they see at all.',
                how: 'Your summary cards read Total Users, Super Admins, HR Admins and Active. An HR Admin\'s read Recruiters, Active and Inactive. The list loads 100 accounts at a time with a Load more button under it, and the search box asks the server, so it finds accounts that are not loaded yet. A green 2FA chip marks an account that has an authenticator app. If the list cannot be read, the table and the cards are replaced by a red message with a Retry button for both of you.',
                access: 'Super Admin sees every account',
              },
              {
                name: 'Delete',
                kind: 'button',
                what: 'Trash icon in the Actions column. Permanently deletes the user account. Confirm text: "Delete user {email}? This cannot be undone."',
                how: 'Hidden entirely for an HR Admin, and refused by the API on top of that. On your own row it is disabled with the tooltip "You cannot delete your own account"; the API returns 400 "Cannot delete yourself". Because only a Super Admin can delete, and nobody can delete themselves, at least one Super Admin always remains after a delete.',
                access: 'Super Admin only',
              },
              {
                name: 'Role',
                kind: 'field',
                what: 'The role select in the Create/Edit User modal. Only you get it. An HR Admin sees no Role field on the edit form, and on the create form a Recruiter badge in its place, because Recruiter is the only account they can create.',
                how: 'The field\'s own hint reads "This is the only place a user\'s role is assigned. Permissions for each role are set on the Roles & Permissions tab." A role change is sent as a separate request from the name, department, status and OTP changes, so it can succeed or fail independently. On your own account the select is disabled: nobody changes their own role.',
                access: 'Super Admin only',
              },
              {
                name: 'Department',
                kind: 'field',
                what: 'The department an account is placed in. A Recruiter with a department only sees that department\'s jobs and candidates. The Users table has a Department column.',
                how: 'An HR Admin can set a department on a Recruiter and on nobody else. You can set it on any account. An admin account with a department set is still not confined to it, because the admin roles bypass department limits.',
                access: 'Super Admin for any account',
              },
              {
                name: 'Edit / Reset PW',
                kind: 'button',
                what: 'Available to any admin. Editing covers name, department, Active account and Require OTP on login; Reset PW sets a new password directly, subject to the password policy. Reset authenticator, on a row with a 2FA chip, switches that account\'s authenticator app off after a confirmation so the person can set it up again.',
                how: 'An HR Admin can do both, but only for Recruiter accounts: on an admin or Super Admin account the buttons are disabled with the tooltip "Only a Super Admin can do this", and the API refuses the call as well. On your own account Active account is disabled.',
              },
              {
                name: '+ Add User',
                kind: 'button',
                what: 'Opens the Create New User modal. Available to any admin. An HR Admin always creates a Recruiter.',
                how: 'The Password field is optional and is subject to your current password policy. The rules are stated under the field, and under New Password on Reset PW, and the request fails at submit with the API\'s message if the password does not comply. Leave it blank, or tick Send an invitation email instead, and the person is emailed a link (good for seven days) to choose their own; the list shows Invited until they do, and Resend invitation sends it again.',
              },
            ],
            warnings: [
              'Deleting a user is permanent and there is no undo in the product. Their audit-log entries survive (the log records the email as a string, not a link), but the account itself is gone. Deactivating with the Active account toggle is almost always the better move. It blocks login with 403 "Account disabled" and keeps the record.',
              'The platform keeps one active Super Admin for you. The last active Super Admin cannot be deactivated or demoted, and nobody can change their own role. Even so, keep a second Super Admin held by a different person, so that a lockout or a mistaken role change is an inconvenience rather than an outage.',
              'A role change takes effect on the target user\'s very next API request, because the role is re-read from the database on every call. Their sidebar and nav will not change until they sign out and in again, so they can be looking at a menu of screens the API has already started refusing.',
            ],
          },
          {
            id: 'pu-matrix',
            title: 'Roles & Permissions tab',
            body: [
              'This tab shows the permission matrix: one row per permission, grouped by category, with a fixed read-only column for each built-in role (Super Admin, HR Admin, Recruiter) and one editable column per custom role.',
              'The built-in columns carry a lock icon titled "Built-in role, permissions are fixed" and are disabled for everyone, including you. The names standard, admin and superadmin are reserved, so they cannot be reused for a custom role to change what a built-in role can do. See the RBAC chapter.',
            ],
            controls: [
              {
                name: 'Custom role checkboxes',
                kind: 'toggle',
                what: 'For you: toggling one writes the role\'s full new permission list immediately, with an optimistic flip and a rollback plus the toast "Failed to update permission" if the write fails.',
                how: 'For an HR Admin the checkbox is disabled, so it cannot be ticked. Every box is a live write, and the routes the permission names enforce it from the next request.',
                access: 'Super Admin only',
              },
              {
                name: '+ New Role',
                kind: 'button',
                what: 'Creates a custom role with no permissions, which you then grant by ticking its column. Its modal hint says exactly that.',
                how: 'For an HR Admin the button is disabled with the tooltip "Only a Super Admin can do this". Roles cannot be renamed after creation. The Name field is disabled on edit with the hint "A role cannot be renamed after creation." A reserved name is refused with "This role name is reserved for a built-in role. Choose a different name."',
                access: 'Super Admin only',
              },
              {
                name: 'Delete role (trash)',
                kind: 'button',
                what: 'Opens a delete dialog for a custom role. When accounts still hold the role, it asks you to choose a role to move them to before it will delete.',
                how: 'The column header shows how many users hold each role. The dialog reads "N users hold this role. Move them to *", and Delete Role stays disabled until you pick a role. Everyone is moved in the same step and the toast says how many, for example "Role deleted, 3 users moved". For an HR Admin the trash icon is disabled.',
                access: 'Super Admin only',
              },
              {
                name: 'Edit description (pencil)',
                kind: 'button',
                what: 'Edits a custom role\'s description only.',
                access: 'Super Admin only',
              },
              {
                name: 'Filter permissions…',
                kind: 'filter',
                what: 'Client-side filter across the permission list. Available to any admin.',
                how: 'With 57 permissions across 23 categories, use it. When nothing matches you get "No permissions match" plus a Clear filter button.',
              },
            ],
            warnings: [
              'Deleting a custom role moves its holders to the role you choose, so they keep a login and the access of that role. Choose carefully: a mistaken target is a role change on each of those accounts, and moving them back is done one account at a time on the Users tab.',
              'The matrix controls are disabled for an HR Admin. If you are training admins, tell them the matrix is read-only for them.',
            ],
          },
        ],
      },
      {
        id: 'powers-ai',
        title: 'AI model, spend and re-matching',
        access: 'Mixed, see each control',
        summary:
          'Three controls related to the AI layer behave differently for you. Two are simply hidden from other roles; the third, Models by Job, is shared with HR Admin and changes cost and behaviour for everyone in your company.',
        subsections: [
          {
            id: 'pai-model',
            title: 'Models by Job is not a personal preference',
            body: [
              'Models by Job sits in Platform Settings, on the System tab. Each AI job (interview scoring, CV classification, job description parsing, embeddings, speech and the rest) has a dropdown for the model it runs on.',
              'A choice is written for your whole company: it applies to every user in it and to every future run of that job. An HR Admin has the same control and the same effect. A Recruiter cannot open Platform Settings.',
              'Embeddings need extra care. Switching the embedding model leaves the CVs and jobs made by the old one unmatched until Re-embed now has re-made them, in batches of a few at a time. The page counts how many are waiting.',
            ],
            controls: [
              {
                name: 'Job dropdown',
                kind: 'field',
                what: 'One select per job. Default follows the job\'s standard model; choosing a model writes your company\'s choice for that job, and choosing Default removes it.',
                how: 'Models are grouped by provider, Anthropic then OpenAI, cheapest first, each job showing the list price of the model it runs on. A model whose provider has no key is greyed out and cannot be chosen. Verify a switch by running one small interview question generation or one job description parse before you leave it in place.',
                access: 'Company-wide effect for Admin & Super Admin',
              },
              {
                name: 'Re-embed now',
                kind: 'button',
                what: 'Appears after the embedding model changes. Re-makes the vectors of the jobs and CVs the previous model made.',
                how: 'It is billed as embedding spend, one batch per request, and stops with the reason when the monthly AI budget is spent. Re-match skips a job until it has been re-embedded.',
                access: 'Admin & Super Admin',
              },
            ],
            warnings: [
              'A change has no confirmation dialog. Treat every touch of a job dropdown as a platform configuration change for your whole company.',
              'Cost changes immediately and by a lot. List prices differ by two orders of magnitude between the cheapest and dearest models offered. One CV is a single short call, about 1,370 input and 210 output tokens, roughly $0.0024 on Claude Haiku 4.5 as measured on the real service, so 200 CVs cost about $0.50 plus a few cents of embeddings. Check the Total AI Spend card on the dashboard after switching.',
              'Models that think before answering bill that thinking as output, so the platform asks them for low reasoning effort by default. The LLM_EFFORT deployment setting takes low, medium, high, xhigh or max. Claude Haiku 4.5 does not think, so the setting does not apply to it.',
            ],
          },
          {
            id: 'pai-spend',
            title: 'Cost on the Dashboard',
            body: [
              'Under the funnel, the Dashboard overview shows what the platform has cost: one overall price, Total cost, and one price for each area of the product. It is for anyone whose role holds cost:read, which both admin roles do, so an HR Admin sees the same figures. For a Recruiter the same space holds a short note that cost data is not available, and the server sends them no figures.',
              'Every price is an estimate in US dollars. The areas add up to Total cost: Résumé parsing, Interviews, Report generation, Interview voice, Job descriptions, Coding assessments, Offers, Matching, Email and, once it has something in it, Other. A call site added later that has no area yet is counted in Other rather than lost.',
            ],
            controls: [
              {
                name: 'Total cost',
                kind: 'badge',
                what: 'Estimated lifetime cost in USD: AI model spend, interview voice and the estimated email cost. Shows two decimal places above a dollar and four below it, so small tenants see a real number rather than $0.00.',
                how: 'The ledger behind it is tracked independently of Activity, so clearing batch history never resets it.',
                access: 'Admin & Super Admin',
              },
              {
                name: 'Avg / Résumé',
                kind: 'badge',
                what: 'What reading a résumé has cost on average, to four decimal places: Résumé parsing divided by the résumés it covers. The most useful number for forecasting.',
                how: 'Multiply by your expected monthly résumé volume to budget. Re-check it after any model change. This is the figure that moves.',
                access: 'Admin & Super Admin',
              },
              {
                name: 'Résumés / AI calls / Prompt / Completion / Embedding',
                kind: 'badge',
                what: 'The volume behind the cost: résumés processed, AI calls, and prompt, completion and embedding token counts. Token counts are abbreviated to K and M.',
                how: 'A jump in Prompt tokens without a matching jump in Résumés usually means re-matching, not new uploads.',
                access: 'Admin & Super Admin',
              },
              {
                name: 'Price of an area',
                kind: 'badge',
                what: 'One card per area with its price, its share of Total cost as a small pill with a bar, and what the money bought: résumés and the cost of one, AI calls, TTS and STT with the minutes, or emails sent and the cost of one.',
                how: 'To see the effect of a Models by Job change, watch the one area it touches: the CV classification row moves Résumé parsing, interview scoring moves Interviews, and so on.',
                access: 'Admin & Super Admin',
              },
            ],
            tips: [
              'The spend ledger is append-only and is never touched by any deletion in the product. It is the one number that survives a full purge, so it is a reliable long-term baseline.',
              'Per-batch cost is visible to every role on the Activity page, on each batch row and in the batch summary modal. If an HR Admin needs to justify a spend, point them there.',
            ],
          },
          {
            id: 'pai-rematch',
            title: 'Re-match',
            body: [
              'The Re-match button sits beside the Job Descriptions heading in the Recruiting workspace. It is shown only to Super Admin, with the reasoning that it is a heavy all-resumes-by-all-job-descriptions operation.',
              'It re-runs similarity matching for the entire resume pool against every parsed job description and rebuilds all candidate pipelines. It never sends invitations. The invite flag is hard-wired off from this button.',
            ],
            controls: [
              {
                name: 'Re-match',
                kind: 'button',
                what: 'Opens a confirmation modal, then runs the full re-match. Label becomes "Matching…" with a spinning icon; the button is disabled throughout.',
                how: 'Tooltip: "Re-match all resumes against all job descriptions". The confirm modal is headed "Re-match all resumes?" and warns that it processes the entire resume pool in one pass and may take a while. Confirm with "Yes, re-match all"; back out with "Cancel".',
                access: 'Super Admin only (interface)',
              },
              {
                name: 'Matched N across M JDs',
                kind: 'badge',
                what: 'Transient banner after a successful run, showing the number of matches made and job descriptions covered. Clears itself after five seconds. On failure it reads "Re-match failed".',
                how: 'Note the count and the Total cost figure before and after. A full re-match on a large pool is one of the more expensive single actions in the product.',
                access: 'Super Admin only (interface)',
              },
            ],
            warnings: [
              'Re-matching rebuilds pipelines. Automatically-matched candidates are recomputed from scratch; candidates a recruiter manually advanced are preserved, but anything sitting at the initial matched stage is regenerated. Recruiters watching a pipeline will see it change under them.',
              'It costs real money, proportional to your resume pool, and it charges the whole pool every time. Do not use it as a refresh button. Legitimate reasons are: you changed the matching thresholds, you changed the AI model, or you fixed a job description that was parsed wrongly.',
              'It can outlast a short session timeout. If you have set an aggressive session lifetime, start a re-match right after signing in.',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'sa-rbac',
    title: 'Roles & permissions, end to end',
    blurb:
      'The complete access-control model: three built-in roles, two route guards in the interface, one permission catalog of 57 entries enforced by the routes that name them, and the custom-role mechanism. Read this before you edit the permission matrix, because a ticked box only matters on the routes that check it, and most admin routes also check the role.',
    sections: [
      {
        id: 'rbac-roles',
        title: 'The three built-in roles',
        summary:
          'Every account holds exactly one role, stored as a single string on the user record. The three built-in values are superadmin, admin and standard; the interface labels them Super Admin, HR Admin and Recruiter, and that mapping is fixed. A user may also hold a custom role name, in which case none of the built-in shortcuts apply to them.',
        subsections: [
          {
            id: 'rbac-roles-list',
            title: 'What each role is for',
            controls: [
              {
                name: 'Super Admin (superadmin)',
                kind: 'badge',
                what: 'Full platform authority. Everything an HR Admin can do, plus user deletion, role assignment, custom-role management, changing the security policy, the Activity purge controls and the spend view. Sidebar reads "Super Admin Portal"; the role badge is amber.',
                how: 'This is an operator role, not a daily-driver role. Have at least two, and ideally use an HR Admin account for routine work so that a mistake cannot be a company-wide one.',
              },
              {
                name: 'HR Admin (admin)',
                kind: 'badge',
                what: 'Runs recruiting operations and all configuration except access control and platform security. Gets the whole Admin Settings nav group: Users & Roles, Platform Settings, Organization, Interview & Automation. Sidebar reads "HR Admin Portal".',
                how: 'The right role for whoever owns your recruiting process. They can configure email templates, webhooks, departments, scenarios and workflow rules, and they can create and manage Recruiter accounts, but they cannot see or touch admin accounts, cannot assign roles, and cannot reach anything on the Super Admin list.',
              },
              {
                name: 'Recruiter (standard)',
                kind: 'badge',
                what: 'Day-to-day recruiting. Sees the two sidebar module screens, Dashboard and Recruiting, plus Activity via the top bar\'s bell icon and their own profile via the top bar\'s user block. The entire Admin Settings nav group is absent. Sidebar reads "Recruiter Portal".',
                how: 'The default for a new account, and the right default. A Recruiter holds read permissions only. A Recruiter does not receive interview reports, scores, transcripts, integrity data or scorecards, anywhere in the product; only admins do. A Recruiter still sees the match percentage. A Recruiter with a department set only sees that department\'s jobs and candidates. See the matrix section below.',
              },
              {
                name: 'A custom role',
                kind: 'badge',
                what: 'Any role name you create on the Roles & Permissions tab. Shown with a neutral badge and the raw role name, since there is no friendly label for it.',
                how: 'Custom roles participate in the permission system but not in the role-string checks. Read the custom-role section below before assigning one to a real person. The practical effect is usually narrower than intended.',
              },
            ],
          },
        ],
      },
      {
        id: 'rbac-guards',
        title: 'How access is actually enforced',
        summary:
          'There are two independent enforcement layers, and they do not agree with each other. The interface hides screens using two route guards; the API protects endpoints using a role check, a permission check, or both together. Understanding which layer stops what is the difference between configuring access correctly and thinking you have.',
        subsections: [
          {
            id: 'guards-frontend',
            title: 'Layer 1, route guards in the interface',
            body: [
              'Two guards wrap the dashboard routes. They read the role from the copy of the user record cached in browser storage at login, so they are fast, and they are stale until the next sign-in.',
            ],
            controls: [
              {
                name: 'PrivateRoute',
                what: 'Requires a stored token. No token means redirect to /login. Wraps the entire /dashboard tree.',
                how: 'It checks only for a token\'s presence, not its validity. An expired token passes this guard and then fails the first API call, which is why an expired session shows the dashboard for an instant before bouncing you to /login.',
              },
              {
                name: 'AdminRoute',
                what: 'Requires role admin or superadmin. Anyone else is redirected to /dashboard. Wraps Users & Roles, Platform Settings, Organization and Interview & Automation.',
                how: 'Redirects silently. There is no "access denied" screen anywhere in the product. A user who follows an admin link just lands back on the dashboard with no explanation.',
              },
            ],
            warnings: [
              'The guards read a cached role. If you change someone\'s role while they are signed in, their nav and route access do not change until they sign out and back in, but the API starts enforcing the new role on their very next request. The window between the two is when you get confused support tickets: menus that are visible but produce errors.',
            ],
          },
          {
            id: 'guards-backend',
            title: 'Layer 2, the API',
            body: [
              'Every API request re-reads the user record from the database using the email inside the token. That means a deactivated or deleted account stops working immediately, on the next request, with no need to wait for a session to expire. It also means a role change is live server-side at once.',
              'From there, an endpoint is protected in one of four ways.',
            ],
            controls: [
              {
                name: 'Signed-in only',
                what: 'Any valid token. Used for reads: job and resume listings, candidate lists, analytics, the batch and expired-JD lists on Activity, saved filters, the model list.',
                how: 'What a Recruiter gets back from these reads is trimmed to what a Recruiter may see. Candidate and pipeline responses leave out the interview report, scores, transcript, integrity data, scorecards, reviewer notes and the interview link, and keep the match percentage.',
              },
              {
                name: 'Admin or Super Admin (role check)',
                what: 'Rejects anything other than admin or superadmin with 403 "Admin access required". It protects the great majority of write endpoints across jobs, candidates, interviews, offers, coding, scenarios, workflows, webhooks, branding, company settings, email templates, prompt config, departments, designations, bulk uploads, user creation and password resets, and every read of an interview report.',
                how: 'This check reads the role string directly, so a custom role never passes it. Most of these endpoints add the permission check below on top of it.',
              },
              {
                name: 'Permission check (jobs:create, offers:send, webhooks:manage and so on)',
                what: 'Most admin endpoints also name a permission from the catalog, and refuse a caller whose role does not hold it with 403 "Missing required permission: {name}". So the matrix is enforced by the routes that name each permission.',
                how: 'A few endpoints check a permission and nothing else: reading the catalog and roles (rbac:read), creating, updating and deleting custom roles and assigning a role to a user (rbac:manage), reading the audit log (audit:read) and the performance review routes. Those follow the checkboxes alone.',
              },
              {
                name: 'Super Admin only (role check)',
                what: 'Rejects anything other than superadmin with 403 "Superadmin access required". Used by deleting a user, purging resumes by date, purging expired job descriptions, and toggling auto-delete for expired job descriptions.',
                how: 'Plus a few in-handler rules. The general user-update endpoint accepts any admin, but rejects a write to the role field from a non-superadmin with 403 "Only a Super Admin can change a user\'s role". An HR Admin can create and edit Recruiter accounts only. Writing the security policy needs security:manage, which only Super Admin holds by default.',
              },
            ],
            warnings: [
              'A custom role is not an admin role. Ticking jobs:delete for a custom role does not let it delete a job, because the job endpoint also asks for an admin role. A custom role is useful for narrowing what a person can reach through the endpoints that check only a permission: the matrix, the audit log and the performance reviews. Do not treat it as a way to build a "hiring manager with half the powers of an HR Admin".',
              'Department scoping is its own rule. A user who has a department assigned and whose role lacks departments:cross_scope is narrowed to their own department: they see that department\'s jobs, and the candidates, scorecards, offers and reports that belong to them, and an id from another department answers as if it did not exist. A job with no department stays visible to everyone. Admin and Super Admin hold the bypass by default, and a Recruiter does not, so a Recruiter with a department set is confined to it.',
            ],
          },
        ],
      },
      {
        id: 'rbac-matrix',
        title: 'Role × capability matrix',
        summary:
          'The definitive answer to "who can do what". Read it as capabilities, not raw permission strings. Each row names something a person actually does in the product and states which of the three roles can do it, and whether the limit is enforced by the API or only by the interface.',
        subsections: [
          {
            id: 'matrix-numbers',
            title: 'The permission catalog at a glance',
            body: [
              'The catalog holds 57 permissions across 23 categories. The three built-in roles hold:',
              'Super Admin, all 57. Every permission in the catalog, with no exclusions.',
              'HR Admin, 54. Everything except users:manage, rbac:manage and security:manage, the permissions that are themselves about controlling who can do what and how strictly accounts are protected.',
              'Recruiter, 8, all reads: jobs:read, resumes:read, intel:read, candidates:read, coding:read, scenarios:read, offers:read, analytics:read.',
              'The permission a route names is checked by that route, so the catalog and the behaviour agree. A Recruiter reads; every write endpoint needs an admin role as well as its permission. Even the reads are trimmed: candidate, pipeline and offer data reaches a Recruiter without interview reports, scores, transcripts, integrity data, scorecards or reviewer notes. The match percentage stays.',
            ],
          },
          {
            id: 'matrix-table',
            title: 'Capability by role',
            body: [
              'Reading key for each row: "SA" is Super Admin, "HRA" is HR Admin, "REC" is Recruiter.',
            ],
            controls: [
              {
                name: 'Sign in, view own profile, change own password',
                what: 'SA yes · HRA yes · REC yes.',
                how: 'Password changes are subject to the platform password policy, which a Super Admin edits on Platform Settings → Security Policies. An account created by single sign-on has no password, so it does not get a Change Password card.',
              },
              {
                name: 'View Dashboard analytics (funnel, time-to-hire, drop-off, recruiter performance, diversity)',
                what: 'SA yes · HRA yes · REC yes.',
                how: 'The cost block needs the cost:read permission, which both admin roles hold. Needs attention is an icon in the top bar, for admins only.',
              },
              {
                name: 'See the Needs attention icon',
                what: 'SA yes · HRA yes · REC no.',
                how: 'API-enforced with the admin check and the attention:read permission. The icon is not rendered for a Recruiter and the endpoints refuse them. An admin confined to a department only sees that department\'s work in it.',
              },
              {
                name: 'Read interview reports, scores, transcripts, integrity data and scorecards',
                what: 'SA yes · HRA yes · REC no.',
                how: 'API-enforced. Recruiters receive none of it anywhere in the product, including the candidate, pipeline and offer lists, and keep the match percentage. The same goes for the Compare candidates window.',
              },
              {
                name: 'View the cost block (Total cost and the price of each area)',
                what: 'SA yes · HRA yes · REC no.',
                how: 'API-enforced with the cost:read permission: the server sends figures only to a role that holds it, and a Recruiter gets a short note instead.',
              },
              {
                name: 'Browse jobs, resumes and candidates',
                what: 'SA yes · HRA yes · REC yes.',
                how: 'A Recruiter with a department set only sees that department\'s jobs, and the candidates of those jobs. A job with no department stays visible to everyone.',
              },
              {
                name: 'Create, edit and delete job descriptions',
                what: 'SA yes · HRA yes · REC no.',
                how: 'API-enforced with the admin check.',
              },
              {
                name: 'Upload resumes (single and bulk)',
                what: 'SA yes · HRA yes · REC no.',
                how: 'API-enforced. Bulk upload is capped at 500 files per request by default.',
              },
              {
                name: 'Invite, decide on and email candidates',
                what: 'SA yes · HRA yes · REC no.',
                how: 'API-enforced. Recruiters can read pipelines but not act on them. Nothing is sent to a candidate automatically: an admin chooses, per candidate, between the AI interview and an interview on another platform.',
              },
              {
                name: 'Set up an interview on another platform, change or resend the meeting, submit the interviewer scorecard, generate the interview guide, share a scorecard link with an interviewer',
                what: 'SA yes · HRA yes · REC no.',
                how: 'API-enforced with the admin check. Until a scorecard exists, Hire, hold, Send offer and the offer-letter email are refused with "Add the interview review first." A no-show does not lift that block. The scorecard link itself needs no account: whoever holds it can fill in and edit that one scorecard until it is locked, expires or is revoked.',
              },
              {
                name: 'Run Re-match across all resumes and JDs',
                what: 'SA yes · HRA hidden · REC no.',
                how: 'Interface-gated for HR Admin; the API would accept an HR Admin call. Refused for Recruiters by the admin check.',
              },
              {
                name: 'Schedule interviews, read interview reports',
                what: 'SA yes · HRA yes · REC no.',
              },
              {
                name: 'Manage offers (create, approve, send, withdraw)',
                what: 'SA yes · HRA yes · REC no.',
              },
              {
                name: 'Manage scenarios, workflow rules, coding questions; read coding submissions',
                what: 'SA yes · HRA yes · REC no.',
                how: 'All on Interview & Automation, behind AdminRoute.',
              },
              {
                name: 'Configure company profile, branding, departments, designations',
                what: 'SA yes · HRA yes · REC no.',
                how: 'All on Organization, behind AdminRoute.',
              },
              {
                name: 'Configure email templates, webhooks, system settings',
                what: 'SA yes · HRA yes · REC no.',
                how: 'All on Platform Settings, behind AdminRoute.',
              },
              {
                name: 'Set the model for each AI job (Models by Job)',
                what: 'SA yes · HRA yes · REC no.',
                how: 'Platform Settings, System tab, behind the admin check. A Recruiter cannot open Platform Settings.',
              },
              {
                name: 'Create users, edit them and reset their passwords',
                what: 'SA yes · HRA Recruiters only · REC no.',
                how: 'API-enforced. An HR Admin creates only Recruiter accounts and cannot edit or reset an admin or Super Admin account. Setting a department follows the same limit.',
              },
              {
                name: 'List every user account',
                what: 'SA yes · HRA no (Recruiters only) · REC no.',
                how: 'API-enforced. The HR Admin view is filtered server-side, not just hidden.',
              },
              {
                name: 'Assign or change a user\'s role',
                what: 'SA yes · HRA no · REC no.',
                how: 'API-enforced on both write paths, the RBAC assignment endpoint and the role field on the general user update.',
              },
              {
                name: 'Delete a user account',
                what: 'SA yes · HRA no · REC no.',
                how: 'API-enforced. You cannot delete your own account, and the last active Super Admin cannot be deactivated or demoted.',
              },
              {
                name: 'Read the permission catalog and role list',
                what: 'SA yes · HRA yes · REC no.',
                how: 'Permission-enforced via rbac:read, which HR Admin holds by default.',
              },
              {
                name: 'Create, edit or delete custom roles; change the permission matrix',
                what: 'SA yes · HRA no · REC no.',
                how: 'Permission-enforced via rbac:manage. For HR Admin the controls are disabled with the tooltip "Only a Super Admin can do this". Deleting a role that users hold needs a role to move them to.',
              },
              {
                name: 'Read the security policy',
                what: 'SA yes · HRA yes, read only · REC no.',
                how: 'Platform Settings → Security Policies. An HR Admin sees the fields disabled with a "Read only" badge.',
              },
              {
                name: 'Change the security policy',
                what: 'SA yes · HRA no · REC no.',
                how: 'Permission-enforced via security:manage, which is excluded from the HR Admin default. A policy write can loosen every account\'s password rules or switch off lockout.',
              },
              {
                name: 'Email Delivery: status, test email, resend failed invites',
                what: 'SA yes · HRA yes · REC no.',
                how: 'Permission-enforced via email:manage together with the admin check.',
              },
              {
                name: 'Read the audit log',
                what: 'SA yes · HRA yes · REC no.',
                how: 'Permission-enforced via audit:read, which HR Admin holds by default.',
              },
              {
                name: 'Dismiss or clear resume batch notifications',
                what: 'SA yes · HRA no · REC no.',
                how: 'API-enforced. Everyone can read the batch list.',
              },
              {
                name: 'Purge resumes by date range',
                what: 'SA yes · HRA no · REC no.',
                how: 'API-enforced. The most destructive capability in the product.',
              },
              {
                name: 'Purge expired JDs; toggle auto-delete of expired JDs',
                what: 'SA yes · HRA no · REC no.',
                how: 'API-enforced. Everyone can read the expired list.',
              },
              {
                name: 'Bypass department scoping',
                what: 'SA yes · HRA yes · REC no by default.',
                how: 'Admin and Super Admin hold departments:cross_scope; Recruiter does not. A person with no department set is never confined, so nothing is scoped until you give a Recruiter a department on the Users tab. From then on that Recruiter sees only that department\'s jobs and candidates.',
              },
            ],
          },
        ],
      },
      {
        id: 'rbac-custom',
        title: 'Custom roles, what they can and cannot do',
        summary:
          'A custom role is a document holding a name and a list of permissions. It is created on the Roles & Permissions tab and assigned on the Users tab. Custom roles are useful for narrowing what a person can reach through the endpoints that check a permission alone, such as the audit log and the performance reviews. They do not open endpoints that also need an admin role.',
        subsections: [
          {
            id: 'custom-mechanics',
            title: 'How role resolution works',
            body: [
              'When the system needs to know what a role can do, it looks for a role document with that name first, and falls back to the built-in defaults if there is none. A custom role with a brand-new name gets exactly the permissions you tick, and nothing else. There is no inheritance and no base set.',
              'The names standard, admin and superadmin are reserved. Creating a custom role with one of them is refused with "This role name is reserved for a built-in role. Choose a different name.", whatever the capitalisation, so a custom role can no longer override a built-in one and strip every Super Admin of access. The built-in columns in the matrix are locked and always show the platform defaults. A role document with a built-in name that was created before the names were reserved is still honoured and shown in the built-in column it overrides.',
            ],
            steps: [
              'Open Users & Roles → Roles & Permissions.',
              'Press + New Role. Give it a lowercase, no-spaces name. You cannot rename it later.',
              'Save. The role is created with no permissions at all.',
              'Find its new column in the matrix and tick the permissions it should hold. Each tick saves immediately.',
              'Go to the Users tab, edit a user, and pick the new role from the Role dropdown. Custom roles appear alongside the three built-ins.',
              'Have that user sign out and back in, so their cached role and nav match what the API will now enforce.',
            ],
            warnings: [
              'A user holding a custom role fails every admin and Super Admin role check, because those compare the role string against the literal values admin and superadmin. A custom role called "hiring_manager" with every permission in the catalog ticked still cannot create a job, because the job endpoint asks for an admin role as well as jobs:create. In practice a custom role behaves like a Recruiter whose access to the permission-only endpoints you adjust.',
              'Deleting a custom role that people hold needs you to choose a role to move them to. The dialog will not delete until you do, and the move happens in the same step, so nobody is left holding a name that resolves to no permissions. The toast reports how many were moved.',
              'Role names are not validated for shape. A typo creates a second, separate role rather than an error, and assigning a user to a role name that does not exist is rejected, but only on the two role-write endpoints, which is the protection you are relying on.',
            ],
            tips: [
              'Before creating a custom role, ask what you actually want to change. If the answer is "who can see the audit log" or "who can read the permission matrix", a custom role works. If it is "let this person create jobs but not delete them", it does not. That granularity is not available.',
              'Every role and permission change is written to the audit log as role_create, role_update, role_delete or user_role_assign, with the actor and the exact permission list. That is your review trail; use the Audit Log tab filtered on resource type "role".',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'sa-architecture',
    title: 'How the system fits together',
    blurb:
      'Enough architecture to diagnose a problem and answer a security questionnaire, without reading the source. Four things: the shape of the deployment, how authentication actually behaves, what the AI layer does and costs, and where data lives.',
    sections: [
      {
        id: 'arch-shape',
        title: 'Deployment shape',
        summary:
          'A single-page application in the browser talking to one HTTP API. There is no server-side rendering and no background push channel. One running backend serves many companies at once. Each company is its own workspace, with its own users, roles, jobs, candidates, settings and branding, and no company can read another\'s data. The people who run the deployment see counts and spend across companies, never candidates, resumes or reports.',
        subsections: [
          {
            id: 'arch-shape-parts',
            title: 'The moving parts',
            controls: [
              {
                name: 'The web app',
                what: 'A React single-page application built with Vite and served as static files. All routing happens in the browser; the server never renders a page.',
                how: 'Because routing is client-side, a hard refresh on a deep link only works if the host is configured to serve the app for unknown paths. If refreshing /dashboard/users gives a 404 from the host rather than the app, that host rule is missing.',
              },
              {
                name: 'The API',
                what: 'One HTTP service. Every call the app makes goes to /api/v1 under a single base URL, configured at build time.',
                how: 'In local development the dev server runs on port 5173 and proxies /api/v1 to a backend on port 8000. In a deployed environment the app is pointed at the API\'s public URL by an environment variable at build time, which means changing the API address requires a rebuild, not a config edit.',
              },
              {
                name: 'The database',
                what: 'MongoDB, holding every collection the product uses. Every company\'s records sit in the same collections, each stamped with its company, and the API only ever reads and writes the signed-in person\'s own company. When it is unreachable the API answers 503 "Database unavailable" rather than failing opaquely.',
                how: 'That exact string is the fingerprint. If several unrelated screens all show it at once, the problem is the database, not the feature.',
              },
              {
                name: 'The vector index',
                what: 'A separate vector search service holding resume and job-description embeddings. Matching quality depends on it; nothing else does.',
                how: 'If matching returns nothing but everything else works, suspect this rather than the database. Embeddings are regeneratable. Losing them costs a re-embed, not data. Recover them by re-running the match rather than by hunting for a copy.',
              },
              {
                name: 'No WebSocket',
                what: 'There is no push channel. Progress on long-running work, bulk uploads, re-matching, is polled by the browser.',
                how: 'This is a deployment constraint, not an oversight: the backend runs behind a function URL that does not support persistent connections. It is why closing the tab during a bulk upload loses the progress view but not the work.',
              },
            ],
          },
        ],
      },
      {
        id: 'arch-auth',
        title: 'Authentication and sessions',
        summary:
          'Bearer tokens, stored in the browser, attached to every request, validated against the live user record on every call. Understanding the three places state lives, the token, the browser\'s cached user record, and the database, explains almost every confusing access problem you will be asked about.',
        subsections: [
          {
            id: 'arch-auth-flow',
            title: 'What happens on sign-in',
            steps: [
              'The user posts their email and password. The email is lower-cased and trimmed first, so casing never matters.',
              'Rate limits are checked: ten attempts per email and thirty per source IP inside a five-minute window, both answered with 429.',
              'If account lockout is enabled and the sign-in is currently locked, the request is refused with 423 "Too many sign-in attempts. Try again later." before the password is even checked. The answer is the same for an email that has no account, so it reveals nothing.',
              'The password is verified. On failure, if lockout is enabled, the failure counter increments and may trip a lock. On success the counter and any lock are cleared.',
              'A disabled account is refused with 403 "Account disabled", after the password check, so a disabled user still resets their own lockout counter by logging in correctly.',
              'For a company that requires single sign-on, a password sign-in is refused with 403 "Your company requires single sign-on." Super Admins and platform owners are exempt, so they can still sign in with a password.',
              'If the account has an authenticator app on, the response asks for an authenticator code, or one of the account\'s eight recovery codes, and no email is sent. A recovery code works once.',
              'If the account requires OTP, a six-digit code is emailed and the response asks for it. The code expires in ten minutes and allows five wrong guesses before it is burned.',
              'Otherwise a token is minted, carrying the user\'s email and an expiry taken from the Session Timeout override on Platform Settings → Security Policies, or the platform default of 1440 minutes when there is no override.',
              'The browser stores the token and a copy of the user record, email, name and role, in local storage, and uses that cached role to decide which nav entries and routes to show.',
            ],
          },
          {
            id: 'arch-auth-runtime',
            title: 'What happens on every subsequent request',
            body: [
              'The token is attached automatically to every API call. The API decodes it, pulls the email out, and re-reads that user from the database, so the role, the active flag and every other attribute are always current, never whatever was true at login.',
              'If the token is expired or invalid, or the user has been deleted or deactivated, the API answers 401. The app reacts to a 401 on any call other than sign-in itself by clearing the stored session and hard-redirecting to /login; a wrong password or code at sign-in is shown on the form instead. A 403 saying the workspace is suspended, its trial has ended or its subscription has ended does the same. There is no refresh token, no retry, and no warning.',
            ],
            controls: [
              {
                name: 'The token',
                what: 'A signed JWT carrying the user\'s email and an expiry. It is the only credential. It cannot be revoked on its own.',
                how: 'Deactivating or deleting the user is the effective revocation. The next request re-reads the user record and fails. That takes effect within one request, not at token expiry. A person can also end every older session of their own account with Sign out everywhere on My Profile, which is what a password change does too.',
              },
              {
                name: 'The cached user record',
                what: 'Email, name and role, kept in browser local storage under a single key alongside the token. Drives the nav, the role badge and the route guards.',
                how: 'This is the stale one. It is written at login and never refreshed. A role change is live on the API immediately and invisible in the interface until the user signs out and back in.',
              },
              {
                name: 'The database user record',
                what: 'The source of truth. Role, active flag, OTP requirement, department, lockout counters, last login.',
                how: 'Everything you change on Users & Roles lands here and is enforced from the next request onward.',
              },
              {
                name: 'Candidate-facing links',
                what: 'Interview and invite links carry a long random token that is hard to guess. They are longer and stronger than before.',
                how: 'Links issued earlier still work, so nothing already sent to a candidate has to be reissued.',
              },
              {
                name: 'Optional one-time codes',
                what: 'A person can switch OTP login on for themselves on My Profile. When an admin has set Require OTP on login for the account, the switch is locked on and reads "Required by your administrator", so the person cannot release it.',
                how: 'OTP depends on working email. Confirm Platform Settings → Email Delivery shows a configured provider before requiring OTP for anyone.',
              },
              {
                name: 'Two-step verification with an authenticator app',
                what: 'A person can turn on an authenticator app (6-digit codes that change every 30 seconds) on My Profile. They get eight single-use recovery codes, shown once. From then on sign-in asks for the app code and sends no email.',
                how: 'It does not depend on email, so it is the better second step where mail is unreliable. A person who loses their phone and their recovery codes needs a Reset authenticator from an admin on Users & Roles. The authenticator of an admin or Super Admin account can be reset by a Super Admin only.',
              },
            ],
            warnings: [
              'A 401 is destructive to in-progress work. It clears the session and navigates away immediately, so any unsaved form is lost. Users experience an expired session as losing work, which is worth weighing when you set the session timeout.',
              'Signing out clears the token from this browser only. It does not invalidate the token server-side. A token copied out of local storage keeps working until it expires, unless the account\'s owner uses Sign out everywhere on My Profile, or changes the password, which ends every older session.',
              'There is a demo-token bypass in the backend that grants any role with no credentials at all. It is disabled by default and the service refuses to start with obviously-default secrets, but it is worth confirming it is off in any environment you inherit. It is the single most dangerous configuration flag in the product.',
            ],
          },
        ],
      },
      {
        id: 'arch-ai',
        title: 'The AI layer',
        summary:
          'Each AI job runs on a model your company chooses: resume parsing, job-description parsing, interview evaluation and the rest. Matching additionally uses an embedding model and a vector index. Cost is metered per operation and accumulated in an append-only ledger.',
        subsections: [
          {
            id: 'arch-ai-parts',
            title: 'What the AI layer does',
            controls: [
              {
                name: 'The chat models',
                what: 'Chosen per job under Models by Job in Platform Settings. A job left on Default uses its standard model: the company default for job description parsing, interviews, the interview guide, the scorecard summary draft, offer letters and the fit second opinion; the RESUME_CLASSIFICATION_MODEL, CODE_EVAL_MODEL and CODE_CORRECTNESS_MODEL settings, Claude Haiku 4.5 unless the deployment says otherwise, for CV classification and the AI code review.',
                how: 'The dropdowns offer Anthropic and OpenAI models, cheapest first within each provider. A model whose provider has no key is greyed out and refused. Embeddings, speech synthesis and transcription are billed by OpenAI; chat work by whichever provider the model belongs to.',
              },
              {
                name: 'The embedding model',
                what: 'The model that converts resume and job-description text into vectors. Chosen under Models by Job like any other job, from three OpenAI embedding models that fit the vector index.',
                how: 'It is why matching still costs money even when nothing is being parsed, and why the Total cost block counts Embedding tokens separately. Switching it leaves the old model\'s vectors unmatched until Re-embed now has re-made them.',
              },
              {
                name: 'Matching thresholds',
                what: 'Similarity floors that decide which resumes attach to which job descriptions, plus a skills bonus and a stricter floor for cross-domain matches. Configured in the deployment environment, not in the interface.',
                how: 'If matching feels too loose or too tight and the model is not at fault, these are the levers, but they are outside the app, so changing them is a deployment task.',
              },
              {
                name: 'Match threshold',
                what: 'The match score the Fit Snapshot draws as its "Match threshold". Scoring never emails a candidate on its own unless AUTO_INVITE_ENABLED is on, which it is not by default: a candidate above the threshold waits in the pipeline until HR uses Set up interview and chooses an AI interview or another platform. Also an environment setting.',
                how: 'Treat it as a guide to who is worth interviewing. The Auto-invited count in the batch summary modal on Activity now reflects older batches only.',
              },
              {
                name: 'The cost ledger',
                what: 'An append-only record of every tracked AI operation and its estimated cost, feeding Total cost and the price of each area on the dashboard.',
                how: 'Never reduced by any deletion in the product. It is the only figure that survives a full purge, which makes it the reliable long-run baseline.',
              },
              {
                name: 'Text the AI is given as data',
                what: 'Résumé text, interview transcripts and notes are passed to the AI as material to read, not as instructions. A line in a résumé that tells the AI to ignore its instructions or to give a high score can no longer instruct it.',
                how: 'There is nothing to configure. The instructions the AI is given are fixed in the platform and are not editable by a company.',
              },
            ],
            warnings: [
              'Changing a job\'s model changes cost and quality for that job at once, for everybody in your company. List prices differ by two orders of magnitude between the cheapest and dearest models offered.',
              'A model whose provider key is missing is refused when you choose it. If a key is removed later, jobs on that provider degrade silently. Verify after any switch by parsing one job description or generating one set of interview questions and confirming the result is populated.',
            ],
          },
        ],
      },
      {
        id: 'arch-data',
        title: 'Where data lives',
        summary:
          'A practical map of the collections behind the screens. This build ships no export/import screen, so nothing below is recoverable from inside the product. Plan recovery at the database level.',
        subsections: [
          {
            id: 'arch-data-map',
            title: 'Collection map',
            controls: [
              {
                name: 'Recruiting core, jobs, resumes, candidates, offers',
                what: 'Everything the Recruiting workspace shows.',
                how: 'The original uploaded resume files live separately from the resume records, so the two have to be recovered together to be useful.',
              },
              {
                name: 'People, users',
                what: 'Accounts, roles, active flags, OTP requirement, lockout counters.',
                how: 'Password hashes live here too. A user recovered without theirs cannot log in until someone resets their password.',
              },
              {
                name: 'Org structure, departments, designations',
                what: 'Referenced by name from designations, and by id from jobs and users.',
              },
              {
                name: 'Automation, scenarios, workflow_rules, coding_questions, webhook_subscriptions',
                what: 'Webhook subscriptions here are live the moment they exist. Recovering an old one re-enables an endpoint you may have turned off deliberately.',
              },
              {
                name: 'Configuration, branding, company settings, email templates, notification settings, password policy, JD auto-delete flag',
                what: 'Runtime configuration, changeable by an admin at any time.',
                how: 'This is the single biggest gap to plan around. Document your configuration outside the product, or a rebuild into a fresh install will leave you re-doing the whole setup runbook by hand.',
              },
              {
                name: 'History, audit_log, email_log, upload_batches, coding_submissions, cost_ledger, webhook_deliveries, cron_runs',
                what: 'Append-only trails and operational bookkeeping rather than restorable state; the audit log in particular is evidence, so it is never rewritten from anywhere, including from anything that could inject fabricated history.',
                how: 'If you need long-term retention of the audit trail, export it at the database level. Webhook delivery rows are kept for about 30 days; the Deliveries panel shows the last 50 per webhook. cron_runs records the outcome of each scheduled run, which is what the status lines on Interview & Automation read back.',
              },
              {
                name: 'Transient, rate limits, SSO state, OTP records',
                what: 'All short-lived by design; recovering them would be actively harmful. A stale lockout could be resurrected.',
              },
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'sa-integrations',
    title: 'Integrations & configuration surface',
    blurb:
      'What has to be configured, and where, for email, webhooks, single sign-on, AI models and the optional integrations to work. The dividing line matters: some of this is configured inside the app by an admin, and some only exists as deployment environment settings that no screen can change.',
    sections: [
      {
        id: 'int-overview',
        title: 'In-app settings versus deployment settings',
        summary:
          'Two configuration layers. What an admin can change from a screen, and what only whoever controls the deployment can change. Knowing which is which saves you hunting for a screen that does not exist.',
        subsections: [
          {
            id: 'int-split',
            title: 'The split',
            controls: [
              {
                name: 'Configured in the app',
                what: 'Company profile, branding, notification alerts, departments, designations and job grades (Organization); your own mail server, single sign-on, HR system, Zoom and Teams accounts, and data retention (the Email, Sign-in, Integrations and Data tabs of Organization, Super Admin only); email templates, webhooks, security policies and the model for each AI job (Platform Settings); scenarios, workflow rules and coding questions (Interview & Automation); users and roles (Users & Roles).',
                how: 'All of it is stored in the database and changeable at runtime by an admin.',
              },
              {
                name: 'Configured in the deployment',
                what: 'Every credential and every threshold: the platform\'s mail transport, provider API keys, Google sign-in client details and the approved sign-up domains (SSO_ALLOWED_EMAIL_DOMAINS), the platform-wide webhook signing secret, the cron secret (CRON_SECRET) that switches on scheduled runs, matching thresholds, upload limits, token lifetime default, rate limits, the code-execution service, and the meeting-provider and HRMS accounts of the default company. Every other company sets its own mail server, single sign-on, HR system, Zoom and Teams in the app, and never uses someone else\'s account. The auto-invite setting (AUTO_INVITE_ENABLED) is off by default, so scoring does not email a candidate on its own.',
                how: 'These live in the backend\'s environment. There is no screen for them. Changing one is a deployment task and usually requires a restart.',
              },
              {
                name: 'The Company Profile tab\'s integration status view',
                what: 'The Organization screen\'s first tab includes a read-only status view of the external services the platform depends on, as Configured or Not Configured: the AI providers (OpenAI and Anthropic), the vector index, Google sign-in, webhook signing, email transport (SMTP or Amazon SES), the code sandbox and each external job source. The server sends the list, so another integration it reports, such as a meeting provider or the HRMS connector, appears without a screen change. It never shows the secret values themselves.',
                how: 'Check it first whenever a feature reports "not configured". The code sandbox has two engines, Judge0 and Piston, and only the one the deployment selects can read Configured; the other reads Not in use even when an address is set for it. The view reads from in-memory settings, with no database dependency, so it keeps working even during a database outage, which makes it a useful signal that the API itself is alive. If it shows "Could not load integrations status." with a Retry button, the API is unreachable, not misconfigured. For a deeper test, Platform Settings → System → Run live check probes the database, both AI keys, the vector index and the code sandbox for real.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Startup configuration warnings',
                what: 'The backend audits its own configuration at startup and logs what is missing, no mail transport, no AI provider key, an OpenAI key absent while an Anthropic one is present, and so on. These are logged loudly and are non-fatal.',
                how: 'They are only visible in the deployment logs, never in the app. If you inherit an environment, reading its startup log is the single fastest inventory of what is wrong with it.',
              },
              {
                name: 'Startup security gates',
                what: 'Two settings make the service refuse to start outright: a signing secret still set to the shipped placeholder, and a default Super Admin password still set to the shipped literal. A further set of weaker findings, placeholder-looking values, a short signing secret, a short or common Super Admin password, and the demo-auth bypass left on outside debug mode, are logged as errors but do not block startup by default.',
                how: 'A deployment setting promotes every weak finding to fatal. Turn it on in any real environment; it is the difference between a security finding being noticed and being logged past.',
              },
            ],
          },
        ],
      },
      {
        id: 'int-email',
        title: 'Email',
        summary:
          'Email carries one-time login codes, candidate invitations, interview links, offer letters and admin notifications. If it is not configured, none of those reach anyone, and several of them fail quietly.',
        subsections: [
          {
            id: 'int-email-config',
            title: 'What has to be set up',
            controls: [
              {
                name: 'Transport',
                what: 'Three states, checked in order. If the SES flag is on, mail goes through the AWS SES API. Otherwise, if an SMTP host is set, mail goes through SMTP. If neither is set, the platform enters a development fallback that does not deliver anything.',
                how: 'For SMTP the deployment needs host, port, username, password and a TLS flag; the default port is 587 with TLS on. For SES it needs the region, and credentials come from the platform\'s own identity rather than being configured here. When SES is on there is deliberately no SMTP fallback. An SES failure is a hard failure, not a downgrade.',
              },
              {
                name: 'Your own mail server (Organization, Email tab)',
                kind: 'tab',
                what: 'Where the plan includes it, your company can send its mail through its own SMTP server, from its own address, instead of through the platform\'s sender. A switch chooses The platform or Your own mail server. For your own: From name, From address, Reply-to address, Host, Port (25, 465, 587 or 2525), Username, Password and Use TLS.',
                how: 'The password is write-only: it reads Password saved, with Change and Remove, and Remove takes effect when you save. Save first, then use Check connection, which logs in to the server without sending anything, and Send a test email, which says whether it was delivered and whose sender carried it. A message that fails through your own server is never sent another way, because the From address is yours. The host must resolve to public addresses only. If the plan lacks it, the tab reads "Your plan does not include a custom mail server." and shows no form. The DKIM and SPF records for your own domain are yours to set in DNS.',
                access: 'Super Admin only',
              },
              {
                name: 'With no transport configured',
                what: 'With no transport configured at all, every send is written to the server log with the full message body and recorded in the delivery log with a status of not-sent. On a development setup (DEBUG on) the calling code is told it worked, so local work keeps going. Anywhere else it is told the email was not sent.',
                how: 'So a live deployment without email fails in plain sight: the invite or the meeting details show as not sent, and nothing reaches the candidate. Confirm Platform Settings → Email Delivery reads Configured, and that the Company Profile integration status shows an email transport, before you rely on any invitation. The same tab counts Console only emails and the interview invites that never went out, and can send them once a provider works.',
              },
              {
                name: 'From address and name',
                what: 'The sender on every outbound message. Defaults are placeholders and must be replaced.',
                how: 'Use an address on a domain you control and have authenticated for sending, or your invitations will land in spam regardless of how the rest is configured.',
              },
              {
                name: 'Frontend URL',
                what: 'The public base URL used to build every link inside an email, interview links, offer links, coding assessment links, shared profile links.',
                how: 'If it is wrong, emails are delivered and every link inside them is broken. This is the most common single misconfiguration after the transport itself, because nothing in the app fails. The recipient just gets a dead link.',
              },
              {
                name: 'Email Templates tab',
                what: 'On Platform Settings. Eight overridable templates: Interview Invitation, Post-Interview Status, Assessment Invitation, Offer Letter, Rejection Notice, Reminder / Follow-up, Interview on Another Platform, and Physical Interview Call. Each opens in an editor on a ready-made sample, with a subject, a message, a folded-away plain-text version, click-to-insert placeholders and a preview.',
                how: 'Placeholders use double-brace syntax such as {{candidate_name}} and {{job_title}}, and are whitespace-tolerant. An unrecognised placeholder is left on the page as literal text rather than raising an error, so a typo ships silently to a candidate; the preview shows it as written. The sample is an offer to start from, not what is sent: until you save, candidates get the built-in default, which looks the same but is not word for word identical. Deleting your version resets that template to its built-in default. Every field falls back independently.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'The candidate-facing warning',
                what: 'A one-line red warning above the editor on every candidate-facing template: it goes straight to the candidate, so no scores, evaluation results or recommendations.',
                how: 'That warning is the only enforcement. There is no server-side content check. If you paste a score placeholder into a candidate template, it will be sent. Treat the warning as a policy you have to keep, not a guard rail that will catch you.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Branding & Notifications tab',
                what: 'On Organization. Sets an admin notification address and offers five internal event toggles: Offer Declined, Candidate Flagged for Integrity, Job Import Failed, Coding Submission Execution Failed, and Webhook Delivery Failed. All default to off.',
                how: 'These alerts are sent. When a ticked event happens, the notify address gets a short plain email that names the event and the item involved and never carries scores or report text. The same item sends at most one email an hour. Send test notification sends one message to the saved address and shows Sent or Failed with the reason. Alerts go out through the same mail transport as everything else, so they need the transport above to be configured.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Email delivery log',
                what: 'Every send is recorded with recipient, subject, template, the candidate and job it relates to, and a status of sent, failed or not-sent.',
                how: 'It is surfaced per candidate on the candidate record, and as a company-wide view on Platform Settings → Email Delivery, which shows the last seven days of Sent, Failed and Console only counts and the newest failed emails. One-time login codes are the exception. They are not recorded at all, so a user reporting a missing OTP leaves no trace anywhere in the app.',
              },
            ],
            warnings: [
              'With email unconfigured, one-time login codes cannot be delivered. Never turn on Require OTP on login for an account before you have confirmed email works end to end. You will lock that user out with no way to let them in, and no log entry to diagnose it from.',
              'The one-time-code template is not overridable. Eight of the outbound templates are configurable; the login code email is hardcoded, and so is the reminder the platform sends before an interview on another platform.',
            ],
            steps: [
              'Have the deployment configured with a transport, a real from-address and the correct public frontend URL.',
              'Create a throwaway user account with an email address you control.',
              'Turn on Require OTP on login for that account and try to sign in as them. Receiving the code proves transport, sender and delivery in one step.',
              'Use Set up interview on a test candidate and click the link in the email. That proves the frontend URL is right.',
              'Turn OTP back off and delete the test account.',
            ],
          },
        ],
      },
      {
        id: 'int-webhooks',
        title: 'Outbound webhooks',
        summary:
          'Push recruiting events to another system as they happen. Subscriptions are managed in the app on Platform Settings, and each can carry its own signing secret; a deployment-wide secret signs the rest. Delivery is best-effort: each call has a short time limit, one retry after a timeout or a server error, and a record you can read. That record is a diagnostic, not a guarantee, which shapes how you should use them.',
        subsections: [
          {
            id: 'int-webhooks-config',
            title: 'Setting them up',
            body: [
              'A subscription is a URL, a list of events it wants, a payload format, an optional signing secret and an active flag. A delivery is an HTTP POST with a short time limit. A call that times out or gets a server error is tried once more while there is time left. Every delivery is recorded and shown on that webhook\'s Deliveries panel.',
              'Events now fire from the platform itself, not only from workflow rules: a candidate is invited, changes status, is hired or is rejected; an interview is completed; an interview is scheduled on another platform; a scorecard is submitted; an offer is created, sent, accepted or declined; a job is created. A workflow rule with the fire_webhook action can still send an event of your own choosing.',
            ],
            controls: [
              {
                name: 'Webhooks tab',
                what: 'On Platform Settings. A table of URL, Event Types, Format and Status, with Send test, Deliveries, Edit and Delete on each row.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'URL',
                kind: 'field',
                what: 'The endpoint to POST to. Must be a public http or https address.',
                how: 'Loopback, private-network, link-local and reserved addresses are rejected outright with a 400 explaining exactly that. The check runs when you create the subscription, when you edit it, when you test it, and again at every delivery, so a URL that later resolves to a private address stops being delivered to, silently.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Event Types',
                kind: 'field',
                what: 'A checklist of the events the platform announces, plus an All events box. Each is shown by its readable name: Candidate invited, Candidate status changed, Candidate hired, Candidate rejected, Interview completed, Interview scheduled on another platform, Scorecard submitted, Offer created, Offer sent, Offer accepted, Offer declined and Job created.',
                how: 'Underneath, matching is an exact comparison against the event\'s key, such as candidate.invited or offer.accepted. A name the platform does not know shows as a flagged chip with an Unknown label, and saving with one is refused with a red "Unknown event type(s): ..." message. A subscription saved before the list existed with a free-text name keeps delivering until it is edited, and cannot be saved again until the unknown name is removed.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Format',
                kind: 'field',
                what: 'One of raw, slack or teams. Raw posts the event payload verbatim. Slack and teams post a one-line human-readable summary instead, suitable for a channel.',
                how: 'The teams format targets classic channel-connector webhooks. Newer Teams workflow webhooks expect a different payload shape and are not supported.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Send test',
                kind: 'button',
                what: 'Sends one test delivery and shows the result on the row: a Delivered or Failed badge, the receiving endpoint\'s HTTP status, and a line of detail such as the connection error.',
                how: 'The result stays on the row until you test again. Test after creating a subscription, and again after any change to the receiving service. A test is a single attempt.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Deliveries',
                kind: 'button',
                what: 'Opens a side panel with the last 50 deliveries to that URL, newest first: Sent or Failed, the event, the HTTP status, how long the call took in milliseconds, how long ago it happened and the error. Refresh re-reads it; Esc or the close button shuts it.',
                how: 'This is your history for diagnosing a receiver that says it never got an event. Delivery rows are kept for about 30 days, and error text is scrubbed of keys and URL credentials.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Signature',
                what: 'Every delivery carries an HMAC-SHA256 signature of the exact request body, as lowercase hex with no prefix, in an X-Webhook-Signature header. The event name travels alongside it in an X-Webhook-Event header, and a unique delivery id in X-Webhook-Delivery.',
                how: 'The signing key is a per-subscription secret if one is set, otherwise a deployment-wide signing secret. With neither, the header is still sent, as an empty string. Your receiver should treat an empty signature as a failed verification, not as "no signature to check".',
              },
              {
                name: 'Signing secret',
                kind: 'field',
                what: 'A subscription can carry its own signing secret, which takes precedence over the platform-wide one. Set it on the Add Webhook or Edit form.',
                how: 'The field is write-only. The platform never sends a stored secret back to the browser; a blue "Secret set" badge on the row and in the edit form says one is stored, and leaving the field empty on edit keeps it. Type a new value to replace it. There is no way to read it back, so keep a copy where your receiver can use it.',
                access: 'HR Admin & Super Admin',
              },
            ],
            warnings: [
              'Delivery is still best-effort. A call that times out or gets a server error is retried once while there is time, a non-2xx answer is recorded as Failed, and nothing is queued for later. If your receiver was down for an hour, those events are not replayed. The Deliveries panel shows what failed so you can reconcile it.',
              'Never build a system of record on webhooks from this platform. They are suitable for notifications and for triggering non-critical automation. Anything that must not be missed has to be reconciled by polling the API instead.',
              'A webhook subscription on its own now delivers real events. Check the Active flag and the event list before you assume a subscription is dormant. A workflow rule with the fire_webhook action sends the event named in its Action Params event_type, or its trigger\'s own name if there is none; only a subscription that lists that exact name receives it.',
              'Webhook payloads carry candidate data. The events the platform announces itself carry ids, names and the stage, and are built not to include scores, report text, email addresses or phone numbers. What a workflow rule posts is whatever its trigger supplies, which can include more, so check a rule\'s payload before you point it at a system outside your control. Treat a webhook endpoint with the same care as a database credential: whoever controls that URL learns who is being hired and when.',
            ],
            faqs: [
              {
                q: 'The Webhook Delivery Failed notification toggle is on but I never get an email.',
                a: 'Work down the list. Is the event ticked and saved on Organization, Branding & Notifications, and is the notify address the one you expect? Does Send test notification there say Sent? Does Platform Settings, Email Delivery show a configured provider? Without one, mail is only written to the log. Last, the alert is sent at most once an hour for the same webhook, so a second failure inside that hour is held back. Open Deliveries on the webhook row to see every recent attempt and its error either way.',
              },
              {
                q: 'Test succeeds but real events never arrive.',
                a: 'Check the subscription first: is Active ticked, and does Event Types include the event you expect? Events are picked from a checklist of named events, so a typo is not possible there, but a subscription saved before the checklist existed can still hold an old free-text name, shown as a flagged Unknown chip, that never matches. Then open Deliveries on the row: a delivery that reached your receiver shows Sent with its HTTP status, one that did not shows Failed with the error. For an event sent by a workflow rule, the rule\'s event_type must be the same name as a ticked event, such as candidate.invited.',
              },
            ],
          },
        ],
      },
      {
        id: 'int-sso',
        title: 'Single sign-on',
        summary:
          'Two kinds, alongside password login. Google sign-in is optional and entirely a deployment configuration: there is no screen for it, and no way to tell from inside the app whether it is enabled other than whether the button appears on the login page. Your company can also set up its own OpenID Connect sign-in (Okta, Microsoft Entra, Google Workspace, Auth0 or any OpenID provider) on Organization, Sign-in tab.',
        subsections: [
          {
            id: 'int-sso-config',
            title: 'How it works and what it needs',
            body: [
              'The flow is the standard redirect dance: the user starts at your login page, is sent to the identity provider, comes back to the app\'s /sso-callback route, and the app exchanges what it was given for a normal platform session token. From that point the session is identical to a password login, same token, same expiry, same role lookup.',
              'A single-use anti-forgery value is issued at the start of the flow and consumed on return. It expires in ten minutes, which is why an SSO attempt left open on a lunch break fails with a state error rather than logging the person in.',
            ],
            controls: [
              {
                name: 'Your company\'s own sign-in (Organization, Sign-in tab)',
                kind: 'tab',
                what: 'Where the plan includes it, you set up single sign-on with your own identity provider: Enable single sign-on, Issuer, Client ID, Client secret (write-only, shown as Client secret saved), Scopes and Require single sign-on. A read-only Redirect URI to register with your provider has a Copy button, and a list of Email domains shows what the platform has assigned to your company.',
                how: 'Register the redirect URI with your provider first, save, then press Test, which fetches the provider\'s discovery document and says what it found. Changing the issuer or the client ID asks for the client secret again. Your people then see "Sign in with <provider> single sign-on" on /login?company=<your slug>, or on your own web address. Require single sign-on refuses password sign-in and password-reset emails for everyone in the company except Super Admins, who see a small Administrator sign-in button for their password. A new person is created on first sign-in only from an email domain the platform owner has assigned to your company; ask them to add yours.',
                access: 'Super Admin only',
              },
              {
                name: 'Client id, client secret, redirect URI',
                what: 'The three deployment settings that enable SSO. All three must be present; with any of them blank the feature reports itself as not configured and every attempt fails with 503 "SSO not configured".',
                how: 'The redirect URI registered with the identity provider must exactly match the platform\'s callback URL, including scheme and host. A mismatch is the most common failure and it surfaces at the provider, before your app is ever reached.',
              },
              {
                name: 'Sign in with Google',
                kind: 'button',
                what: 'The button under the "or" divider on the login page. It is rendered unconditionally.',
                how: 'This is worth knowing before you roll out: the button appears whether or not SSO is configured. On a deployment without it, users who press it get a raw error page rather than anything the app styled. If you are not using SSO, warn your users or the first thing they will do is press it.',
              },
              {
                name: '/sso-callback',
                kind: 'link',
                what: 'The route the identity provider ultimately returns to. It stores the session, then fetches the user record to learn the role, retrying a few times with a short backoff before giving up.',
                how: 'The retry exists specifically so that a transient failure cannot leave an admin signed in with no role. If it exhausts its attempts it signs the user out and shows "Signed in, but we could not load your account details. Please try signing in again." When the identity provider or the platform refuses the sign-in, the page shows the reason it was given, with a link back to sign-in.',
              },
              {
                name: 'Just-in-time account creation',
                what: 'A user signing in through SSO with an email the platform has never seen gets an account created automatically, always with the Recruiter role and always active.',
                how: 'SSO can therefore never mint an admin. Promote a new arrival on Users & Roles after their first sign-in. Their account will not exist until then, so you cannot pre-assign a role. An account created this way has no password, so My Profile does not show a Change Password card for it.',
              },
              {
                name: 'SSO domains',
                what: 'A first-time Google sign-in is created in the company that has claimed the person\'s email domain, such as acme.com. A domain belongs to one company, and the platform owner sets each company\'s SSO domains. On an install that predates multiple companies, the SSO_ALLOWED_EMAIL_DOMAINS deployment setting, a comma-separated list, still names the domains of the default company.',
                how: 'A new person from a domain no company has claimed is refused with 403 "This email domain is not allowed to sign up with single sign-on. Ask your administrator to create your account." Someone an admin already created can still sign in whatever their domain: the claim governs who may be created by Google sign-in, not who may use it. Capitalisation and a leading @ are ignored. Ask your platform owner to claim your domain.',
              },
              {
                name: 'The integration status flag',
                what: 'The Company Profile integration view reports Google sign-in as configured only when the client id, the client secret and the redirect URI are all set.',
                how: 'It can still read as configured while the flow fails, for instance if the redirect URI registered with Google does not match. Treat a green flag here as necessary but not sufficient. Test the actual button.',
              },
            ],
            warnings: [
              'The session token is passed back to the browser in the URL query string. It therefore lands in browser history, and in the access logs of anything between the user and your app. This is a real consideration for a security review: a token copied out of a history entry works until it expires, and tokens cannot be revoked individually.',
              'The password policy does not apply to an SSO login. Password rules are irrelevant to it by definition, and the failed-login lockout counter is only maintained on the password path. If you rely on lockout as a control, SSO is a separate door with no lockout on it.',
              'An account deactivated in the platform is refused at SSO with 403 "Account is deactivated", and an identity provider account whose email is not verified is refused with 403. Those are the only two account-state checks in the SSO path.',
              '"Invalid or expired state, possible CSRF, retry login" means the single-use anti-forgery value was missing or already consumed. In practice it is a stale browser tab, a double-submitted callback, or the user pressing Back, not an attack. Have them start again from the login page.',
            ],
          },
        ],
      },
      {
        id: 'int-company-systems',
        title: 'Your HR system, Zoom and Teams',
        path: '/dashboard/organization?tab=integrations',
        access: 'Super Admin only',
        summary:
          'Each company connects its own HR system, Zoom and Microsoft Teams accounts, so a meeting or a hire in your company never uses somebody else\'s account. Where the plan includes integrations; otherwise the tab says so and shows no form.',
        subsections: [
          {
            id: 'int-company-systems-config',
            title: 'The Integrations tab',
            controls: [
              { name: 'HR system', kind: 'field', what: 'Endpoint URL, Authorization header, a write-only Token and a switch, "Send the candidate when they are hired".', how: 'The address must be a public https address. The token is sent in the header you name.' },
              { name: 'Zoom', kind: 'field', what: 'Account ID, Client ID and a write-only Client secret, so Set up interview can create the meeting for you.' },
              { name: 'Microsoft Teams', kind: 'field', what: 'Tenant ID, Client ID, a write-only Client secret and the Organizer, the account that owns the meetings.' },
              { name: 'Token saved / Client secret saved', kind: 'badge', what: 'A secret is never shown again. A saved one reads "saved" with Change and Remove, and Remove takes effect when you press that card\'s Save Changes.', how: 'Each system has its own Save Changes, because they are separate accounts that fail separately.' },
              { name: 'Configured / Not configured', kind: 'badge', what: 'Whether the system has what it needs.' },
              { name: 'Using the platform\'s account', kind: 'badge', what: 'On the default company only: the deployment\'s own account is in use because none is set here. The fields stay open so you can set your own.' },
            ],
          },
        ],
      },
      {
        id: 'int-data',
        title: 'Data retention and erasing a person',
        path: '/dashboard/organization?tab=data',
        access: 'Super Admin only',
        summary:
          'How long the company keeps what it holds about people, and erasing one person on request. The default is to keep everything for ever; the periods are your decision.',
        subsections: [
          {
            id: 'int-data-retention',
            title: 'Retention',
            controls: [
              { name: 'Erase candidates after (days)', kind: 'field', what: 'Candidates in a final state, counted from their last activity, are erased this many days after it. A final state is rejected, not selected, withdrawn, or an interview invite that expired without the person ever starting.', how: 'Never a candidate who was hired, who holds an offer or an employee record, who is in progress, or whose last activity cannot be dated. The minimum is 30 and the most is 36,500.' },
              { name: 'Erase résumés with no candidate after (days)', kind: 'field', what: 'Résumés older than this that belong to no candidate, for example uploads that were never matched.' },
              { name: 'Keep for ever', kind: 'toggle', what: 'One switch per period. On, the period is empty and nothing of that kind is erased. It is the default.' },
              { name: 'Last purge', kind: 'badge', what: 'When the scheduled job last erased something, and how many candidates and résumés it removed. It reads "No purge has run yet" until then.', how: 'The job runs with the daily scheduled jobs, so it needs scheduled runs switched on. Each run that removes something writes one entry to the audit log with the counts and no personal data.' },
            ],
            warnings: [
              'A retention period erases for good. It uses the same erasure as the button below, so nothing can be restored. Start with a long period and read the Last purge line before shortening it.',
            ],
          },
          {
            id: 'int-data-erase',
            title: 'Erasing a person',
            steps: [
              'On the Data tab, type the person\'s email address under Erase a person by email and a reason of 3 to 500 characters. To erase one application only, open the candidate\'s row menu in the pipeline and choose Erase personal data.',
              'Click Erase. A dialog asks you to type ERASE; the red button stays off until you have.',
              'If the person has an accepted offer or an employee record, the server refuses and says so. The dialog closes and a checkbox, "Also erase their offer and employee records", appears. Tick it only if those records may go too, then erase again.',
              'The result says how many candidate records were erased and how much was removed from each store.',
            ],
            controls: [
              { name: 'Erase a person by email', kind: 'field', what: 'Erases every candidate record held under that email address, in every job.', how: 'It says "No candidate has that email address." when nothing matched.' },
              { name: 'Erase personal data', kind: 'menu', what: 'In a pipeline row\'s three-dot menu, last in the list, in red. Erases that one application.', how: 'Shown only to an account that holds the candidates:erase permission, which only a Super Admin has unless you grant it.', access: 'Super Admin only' },
              { name: 'Reason', kind: 'field', what: 'Why the person is being erased, 3 to 500 characters. Kept on the audit record.' },
            ],
            warnings: [
              'Erasing is irreversible. It removes the name, email and every résumé version and file, the interview transcripts, reports, scorecards and guides, recruiter notes, demographics, coding submissions, interviewer links and report shares. What remains is a record that someone applied, with the stage, decision and dates, who erased it and why.',
              'Email log rows are kept so the plan\'s usage counts stay true, but lose the address and subject. Audit entries keep who and when, without the free text. If some search entries could not be removed, the page says so; erasing again, or the next retention run, retries them.',
              'An erased person appears as Erased candidate wherever candidates are listed. Every action on that record is refused afterwards, so it cannot be brought back to life.',
            ],
          },
        ],
      },
      {
        id: 'int-models',
        title: 'AI model providers',
        summary:
          'The models on offer under Models by Job are fixed in the platform: Claude models (Anthropic key) and OpenAI models (OpenAI key). A model whose provider has no key is greyed out and cannot be chosen.',
        subsections: [
          {
            id: 'int-models-config',
            title: 'Keys and consequences',
            body: [
              'Models by Job offers Claude models and OpenAI models, one block per provider, cheapest first, each with its list price in US dollars per 1M tokens as input and output. A job left on Default uses its standard model; choosing a model changes only that job. Claude models need the Anthropic key and OpenAI models need the OpenAI key; a model whose key is missing cannot be chosen.',
              'CV classification and the AI code review default to the RESUME_CLASSIFICATION_MODEL, CODE_EVAL_MODEL and CODE_CORRECTNESS_MODEL settings (Claude Haiku 4.5 unless the deployment says otherwise) until a company picks a model for them. The OpenAI key is still needed for the default résumé and job embeddings and for interview voice (speech and transcription), because Anthropic has no equivalent. Check the cost block on the dashboard after changes to see what the platform is costing you.',
            ],
            controls: [
              {
                name: 'OpenAI key',
                what: 'Effectively mandatory. Without it, résumé and job embeddings and matching, and the voice interview\'s speech synthesis and transcription stop working. None of those have an alternate provider.',
                how: 'The chat work runs on Claude, but embeddings and voice still require the OpenAI key. Treat its absence as a serious outage rather than a degraded mode.',
              },
              {
                name: 'Anthropic key',
                what: 'Effectively mandatory while any job runs on a Claude model, which is every job by default. It powers JD parsing, CV classification, interview questions and evaluation, the interview guide, offer-letter drafting and the AI code-quality review on coding assessments.',
                how: 'Without it those features fail at first use, and the AI code review is skipped rather than failed: the coding assessment still returns correctness results, just no quality commentary.',
              },
              {
                name: 'Vector index key',
                what: 'Enables similarity matching between resumes and job descriptions.',
                how: 'Without it, matching stops while everything else appears healthy. This is the failure that presents as "we upload resumes and nothing ever matches".',
              },
              {
                name: 'Default model',
                what: 'The standard model for every job that has none of its own. It comes from the deployment (DEFAULT_LLM_MODEL), or from the choice stored on your company if one was saved before Models by Job existed.',
                how: 'Models by Job names it in brackets on the Default option of each row. To move one job off it, choose a model for that job.',
              },
              {
                name: 'Per-operation model override',
                what: 'A request may name its own model, and when it does that model wins over the row for that job. Creating a job description no longer does: it follows the job description parsing row. Uploading resumes never does: classification follows the CV classification row.',
                how: 'If two people get different parsing quality for the same work, check that nobody calls the API with an explicit model.',
              },
            ],
            warnings: [
              'AI failures are silent. When a model call fails, a missing key, a rate limit, an invalid model, the platform logs it and returns an empty result rather than an error. The practical symptom is a resume or job description that parses into nothing, or an interview evaluation that comes back blank. Nothing on screen says "the AI call failed".',
              'Embedding failures are silent in a worse way: a failed embedding returns a zero vector, which is a valid-looking value that matches nothing. Resumes appear to process successfully and then never match any job description.',
              'There is no failover between providers. If the selected model\'s provider is unreachable, every AI operation degrades to empty output until you change the model or fix the key.',
              'A model is marked (not set up) only when its provider has no key at all. A key that is present but rejected looks the same as a working one. After any switch, parse one job description or generate one set of interview questions and confirm the result is populated before you walk away.',
            ],
          },
        ],
      },
      {
        id: 'int-optional',
        title: 'Optional integrations',
        summary:
          'Four further integrations exist, all optional, all deployment-configured, and all reporting themselves as "not configured" rather than failing when their settings are absent. Each degrades to a sensible fallback.',
        subsections: [
          {
            id: 'int-optional-list',
            title: 'What else can be wired up',
            controls: [
              {
                name: 'Code execution service',
                what: 'Runs candidate-submitted code for the AI coding assessment. Candidate code is never executed by the platform itself. It is always delegated to this service.',
                how: 'Unconfigured, the coding assessment reports "not configured" and cannot grade correctness. The static plagiarism check runs regardless. It is pure text comparison with no external service and no AI cost.',
              },
              {
                name: 'Video meeting providers',
                what: 'Zoom or Microsoft Teams, for interview scheduling. Both use a server-side credential, so there is no per-user consent step.',
                how: 'Unconfigured, scheduling still works and falls back to an .ics calendar file download. If both are configured, a deployment setting picks which one wins; with exactly one configured it is used automatically.',
              },
              {
                name: 'HRMS / payroll connector',
                what: 'Pushes a normalised employee record to an endpoint your HR system exposes, optionally automatically when a candidate is hired or accepts an offer.',
                how: 'There is no universal HR system API, so this is a generic outbound push with a configurable auth header, plus a payroll-ready export for systems that cannot receive one.',
              },
              {
                name: 'External job sources',
                what: 'Imports job postings from external boards. Five sources are free and need no key (Remotive, Arbeitnow, RemoteOK, The Muse and Jobicy); LinkedIn and Indeed need a provider key each and report as "not configured" without one.',
                how: 'Configured sources are re-synced by the daily scheduled run, as its Job source sync job. In a serverless deployment nothing runs on a timer inside the platform, so that run only happens when CRON_SECRET is set. If imports have quietly stopped, read the scheduled-runs lines above the table on Interview & Automation → Workflow Rules: they show when Job source sync last ran, its status and a line of detail, or say that scheduled runs are off.',
              },
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'sa-runbook',
    title: 'Day-1 setup runbook',
    blurb:
      'An ordered checklist for standing up your company\'s workspace, from first sign-in to first candidate. The order matters. Several steps depend on earlier ones, and creating your org structure before your users is the difference between a smooth rollout and a morning of re-work.',
    sections: [
      {
        id: 'runbook-steps',
        title: 'The ordered checklist',
        summary:
          'Fourteen steps, each naming the exact screen. Expect ninety minutes for the configuration and rather longer if you are also writing email copy. Do not skip step 1 or step 14.',
        subsections: [
          {
            id: 'runbook-before',
            title: 'Before you start, confirm your workspace is ready',
            steps: [
              'Sign in with the Super Admin account your platform owner created for your company. If every sign-in is refused as suspended, ask them to check that your company and its client are both active.',
              'Change the Super Admin password you were given immediately, from your own profile screen (click your name in the top bar to open it). Someone else chose it, so treat it as known to them.',
              'Open Organization → Company Profile and read the integration status view. Note which integrations report as configured. If email is not among them, stop and get it configured before going further. Steps 7 and 9 depend on it, and so does the first interview invitation in the verification below.',
            ],
            warnings: [
              'Do not proceed past this point with the password you were given still in place. Everything else you configure sits behind that one credential.',
            ],
          },
          {
            id: 'runbook-main',
            title: 'The build-out',
            steps: [
              '1. Organization → Company Profile. Fill in the company details. These appear on candidate-facing pages and in outbound email, so get them right before anything is sent.',
              '2. Organization → Departments, Designations & Grades. Create your department structure and job titles first, because job descriptions and user records both reference them and you cannot pick one that does not exist yet.',
              '3. Platform Settings → Security Policies. Set the minimum password length, whether a number and a symbol are required, how many failed sign-ins lock an account, and any session timeout. Do this before you create accounts, so every password is created under the rules. The shipped policy asks for nothing beyond one character and has lockout off.',
              '4. Users & Roles → Users tab → + Add User. Create your second Super Admin. Do this before anything else touches access control, so a lockout can never leave the platform without an operator. Give it a real person\'s address, not a shared mailbox.',
              '5. Users & Roles → Users tab. Create your HR Admins, then your Recruiters. Prefer Send an invitation email instead of typing passwords, so nobody but the person knows theirs. Assign each a role in the Role dropdown. It is the only place a role is set. Give a Recruiter a Department if you want them to see only that department\'s jobs and candidates.',
              '6. Users & Roles → Roles & Permissions. Only if you need a custom role. Read the custom-role warnings in the RBAC chapter first; for most organizations the three built-in roles are the right answer and this step is skipped.',
              '7. Organization → Branding & Notifications. Upload your logo and apply your colours, set the notify address, tick the internal events that should email your admins and press Send test notification to prove the address works.',
              '8. Platform Settings → System. Review Models by Job: each job shows the model it runs on and its price, and Default follows the platform default. Choose deliberately; a model whose provider key is missing cannot be chosen. Then press Run live check and read each row: database, Anthropic key, OpenAI key, vector index and code sandbox should all say OK.',
              '9. Platform Settings → Email Delivery. Press Verify connection, then send a test email to an address you control. Do not go further until both succeed. Without a working provider, invitations are reported as not sent and nothing reaches the candidate.',
              '10. Platform Settings → Email Templates. Open each outbound template: it starts on a ready-made sample you can edit, with a preview and click-to-insert placeholders. Change what you need, check the Preview and save. A template you leave alone keeps the built-in default. Include Interview on Another Platform if you use Zoom, Meet or Teams, and Physical Interview Call if you interview in person.',
              '11. Platform Settings → Webhooks. Only if you are pushing events elsewhere. Create the subscription from the event checklist, press Send test, then open Deliveries to see the call. Most events fire by themselves, so a workflow rule is only needed for an event of your own conditions; for that, set the rule\'s event_type to the same event name.',
              '12. Interview & Automation → Scenarios, then Workflow Rules, then Coding Questions. Scenarios and coding questions are content you will keep adding to; workflow rules are the automation that acts on pipeline events, so configure them after you know what your pipeline looks like. Read the scheduled-runs lines above the rules. If they say scheduled runs are off, the deployment needs a cron secret before reminders and job syncs happen on their own.',
              '13. Recruiting → + Create New JD. Create your first job description. Give it a realistic deadline. It is what makes the job expire, and an expired job stops matching new resumes.',
              '14. Recruiting → Upload Resumes. Upload a small batch, five or ten files, not five hundred. Then open Activity from the bell icon in the top bar and open the batch summary on the Resumes tab.',
            ],
          },
          {
            id: 'runbook-verify',
            title: 'Verifying the first run',
            body: [
              'The batch summary modal on Activity is the single best end-to-end health check in the product. It tells you, in one view, whether ingestion, parsing, matching and cost tracking are all working.',
            ],
            controls: [
              {
                name: 'Uploaded / Processed',
                kind: 'badge',
                what: 'Files accepted versus files successfully parsed. These should match.',
                how: 'A gap means parsing failures. Check the Failed files list at the bottom of the modal for the per-file reason.',
              },
              {
                name: 'Failed',
                kind: 'badge',
                what: 'Files that errored during processing, listed individually with their error message further down the modal.',
                how: 'On a first run, a non-zero value here almost always means either an unsupported file format or a missing AI provider key.',
              },
              {
                name: 'Duplicates skipped',
                kind: 'badge',
                what: 'Files recognised as already present. Expected to be zero on a first upload.',
              },
              {
                name: 'Matched to JDs / Not matched',
                kind: 'badge',
                what: 'How many resumes attached to at least one job description. This is the number that proves matching and the vector index are working.',
                how: 'All zero after uploading relevant resumes against a live job description means matching is broken. Check the vector index and confirm the job description actually parsed.',
              },
              {
                name: 'Auto-invited',
                kind: 'badge',
                what: 'Kept for older batches. Nothing is emailed automatically any more: candidates who clear the match bar wait in the pipeline for a recruiter.',
                how: 'An upload therefore never sends an invitation by itself. Invitations and meeting details go out only when someone uses Set up interview on the candidate.',
              },
              {
                name: 'AI cost (this batch)',
                kind: 'badge',
                what: 'Estimated cost of this batch, with the prompt, completion and embedding token split beneath it.',
                how: 'Multiply by your expected volume before you commit to a model. This is your cheapest opportunity to discover an expensive default.',
              },
              {
                name: 'Resumes per Job Description',
                kind: 'column',
                what: 'Per-job breakdown of where the batch\'s resumes landed.',
                how: 'If everything piled onto one job description, your thresholds are too loose or your job descriptions are too similar.',
              },
            ],
            steps: [
              'Confirm Processed equals Uploaded and Failed is zero.',
              'Confirm Matched to JDs is non-zero and the per-job breakdown looks sensible.',
              'Open the candidate pipeline on the job description and confirm the matched candidates appear with scores.',
              'Use Set up interview on a test candidate whose address you control and send yourself one interview invitation, either the AI interview or an interview on another platform. Click the link in the email. This proves email transport and the public frontend URL together.',
            ],
            warnings: [
              'Step 14 is a live upload and it spends real AI credit. The upload itself emails nobody, but Set up interview does, so only use it on addresses you control during the first run, and use synthetic resumes.',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'sa-ops',
    title: 'Troubleshooting & operations',
    blurb:
      'Reading the audit log, decoding the error codes each surface produces, and the two or three failures you will actually be paged for. Everything in this product can and cannot do.',
    sections: [
      {
        id: 'ops-audit',
        title: 'Reading the audit log',
        path: '/dashboard/users?tab=audit',
        access: 'HR Admin & Super Admin',
        summary:
          'The audit log is the third tab on Users & Roles. It records mutating actions with the actor, the action, the resource and a details payload. It is broad but not comprehensive: not every write in the product is in it, so knowing what it does and does not contain is essential before you rely on it in an investigation.',
        subsections: [
          {
            id: 'ops-audit-what',
            title: 'What is recorded',
            body: [
              'Entries are written for account changes (creation, update, deletion, password resets and role assignment); roles; departments, designations and job grades; platform configuration (the model for each AI job, email templates, webhooks, workflow rules, scenarios, coding questions, the security policy, branding, company settings and notification settings); and the main recruiting actions (job creation, update and deletion; résumé uploads and deletions; candidate invitations and decisions; bulk stage moves; interview scheduling, interviews on another platform, interview guides and scorecards; offers; report shares). Self-service changes to a profile, a password or OTP are recorded too, as are scheduled runs.',
              'Entries are written best-effort and never block the action that triggered them. That means a failed audit write is silent. An action can succeed with no log entry if the database hiccuped at that moment. Absence of an entry is weak evidence.',
            ],
            controls: [
              {
                name: 'Actor Email',
                kind: 'filter',
                what: 'Case-insensitive substring match on who performed the action. Offers suggestions from the actors already present in the log, but stays free text.',
                how: 'Substring matching means typing a domain finds everyone at that domain.',
              },
              {
                name: 'Action',
                kind: 'filter',
                what: 'Case-insensitive substring match on the action name. Suggestions come from the actions actually present.',
                how: 'The names worth knowing: user_create, user_update, user_delete, user_role_assign, role_create, role_update, role_delete, department_create, department_update, department_delete, designation_create, designation_delete, job_create, job_update, job_delete, resume_upload, resume_delete, candidate_invited, candidate_decision, offer_send, security_policy_update, webhook_created, workflow_rule_updated. Typing "delete" finds every deletion across every resource type.',
              },
              {
                name: 'Resource Type',
                kind: 'filter',
                what: 'Exact match, chosen from a dropdown of the types present. First option is "All resources".',
                how: 'Use "user" for account changes, "role" for permission changes, and "department" or "designation" for org-structure changes.',
              },
              {
                name: 'Resource ID',
                kind: 'filter',
                what: 'Case-insensitive match on the identifier of the record acted on: a user\'s email, a role name, a job, candidate, offer or résumé id. A partial value matches too.',
                how: 'This is the "what happened to this one record" filter, for example every change to one job or every action on one account. Copy the value from the Resource ID column of an entry you already found.',
              },
              {
                name: 'From / To',
                kind: 'filter',
                what: 'Date bounds on when the action happened. The To date includes the whole of that day.',
              },
              {
                name: 'Apply',
                kind: 'button',
                what: 'Runs the query with the current filter values and resets to page 1. Nothing is fetched until you press it. The filter boxes are a draft.',
                how: 'This trips people up: editing a filter and waiting does nothing.',
              },
              {
                name: 'Clear',
                kind: 'button',
                what: 'Resets every filter. Only shown when at least one filter is actually applied.',
              },
              {
                name: 'Date/Time',
                kind: 'column',
                what: 'When the action happened, in your browser locale. Entries are newest first.',
              },
              {
                name: 'Actor',
                kind: 'column',
                what: 'The email of the account that performed the action. Stored as a plain string, so it survives the actor being deleted.',
              },
              {
                name: 'Action',
                kind: 'column',
                what: 'The action name, shown as a blue badge.',
              },
              {
                name: 'Resource Type / Resource ID',
                kind: 'column',
                what: 'What was acted on. For users the id is the email; for roles it is the role name.',
              },
              {
                name: 'Details',
                kind: 'column',
                what: 'The payload of the change, flattened to key-value pairs. Truncated on screen with the full text in the hover tooltip.',
                how: 'This is where the substance is. A user_role_assign entry carries both the old and the new role; a role_update carries the permission keys added and removed.',
              },
              {
                name: '↻ Refresh',
                kind: 'button',
                what: 'Re-fetches the current page. The tab loads lazily on first visit, so this is also how you pick up entries written while you were looking at it.',
              },
            ],
            warnings: [
              'Some actions still leave no entry. The resume purge by date range on Activity, the most destructive action in the product, writes no audit entry at all, although deleting résumés one at a time or in bulk does. Treat the list of recorded actions as what the log can prove, and the absence of an entry for anything else as no evidence either way.',
              'Entries are not editable or deletable through the product, which is the point, but they are also not signed, so anyone with database access can alter them.',
            ],
            faqs: [
              {
                q: '"Could not load the audit log. The endpoint may not be available yet."',
                a: 'The request failed. Either your role lost the audit-read permission through a custom role override, or the API is unreachable. Check whether other admin screens load.',
              },
              {
                q: 'Who purged those resumes?',
                a: 'If it was the date-range purge on Activity, the audit log will not tell you: that purge is not audited. Your remaining evidence is who held Super Admin at the time, on the Users tab. If résumés were deleted one at a time or in bulk, each one has a resume_delete entry; filter by Action "resume_delete" or paste a résumé id into Resource ID.',
              },
            ],
          },
        ],
      },
      {
        id: 'ops-codes',
        title: 'What each error code means, by surface',
        summary:
          'The product surfaces raw API messages in most of its toasts and banners, which is genuinely useful once you can read them. This is the decoder.',
        subsections: [
          {
            id: 'ops-codes-table',
            title: 'Status codes',
            controls: [
              {
                name: '400 Bad Request',
                what: 'Your input was rejected before anything was written. On password fields it is the policy check; on an import it is a shape violation; on a role assignment it is an unknown role name; on a new custom role it is a reserved name (standard, admin or superadmin); on user deletion it is "Cannot delete yourself".',
                how: 'Always accompanied by a specific message. Read it. It names the exact rule that failed.',
              },
              {
                name: '401 Unauthorized',
                what: 'Your session is invalid, expired, ended by Sign out everywhere or a password change, or belongs to a user who has been deleted or deactivated. The app clears the session and sends you to /login the moment it sees one on any call except sign-in itself, where a wrong password or code is shown on the form.',
                how: 'If it happens immediately after signing in, suspect a clock skew between the browser and the server, or an account that was deactivated between the login and the next call.',
              },
              {
                name: '403 Forbidden, "Admin access required"',
                what: 'A Recruiter hit an admin-only endpoint. Normally invisible, because the interface hides those screens.',
                how: 'Seeing this in the interface means the browser\'s cached role is stale. The user was demoted while signed in. Have them sign out and back in.',
              },
              {
                name: '403 Forbidden, "Superadmin access required"',
                what: 'One of the Super-Admin-only endpoints refused you. Same cause: a stale cached role, or genuinely not being Super Admin.',
              },
              {
                name: '403 Forbidden, "Only a Super Admin can change a user\'s role"',
                what: 'An HR Admin tried to write the role field on a user. Expected and correct.',
              },
              {
                name: '403 Forbidden, "Missing required permission: {name}"',
                what: 'A permission-gated endpoint refused you because your role does not hold the permission the endpoint names. Most admin endpoints check a permission, so the name in the message tells you which box is missing.',
                how: 'A Recruiter or a custom role meets this where the role lacks the box. If a Super Admin or an HR Admin sees it for a permission their built-in role should hold, an older install may still have a role document with a built-in name overriding that role. Look in the built-in column on the Roles & Permissions tab for what the role actually holds.',
              },
              {
                name: '403 Forbidden, "Your company requires single sign-on."',
                what: 'Password sign-in, or a password-reset email, was refused because your company requires single sign-on. Super Admins and platform owners are exempt.',
                how: 'Use the single sign-on button on the sign-in page. A Super Admin who is locked out of their identity provider uses Administrator sign-in.',
              },
              {
                name: '403 Forbidden, "This workspace is suspended" or "This workspace\'s trial has ended" or "This workspace\'s subscription has ended"',
                what: 'The workspace is blocked: a platform owner suspended it, or its trial or subscription is over. Everyone is signed out, and the sign-in page says which.',
                how: 'Nothing is deleted. The platform owner lifts it by activating the workspace or renewing the subscription.',
              },
              {
                name: '402 Payment Required, "Your plan does not include ..."',
                what: 'The plan does not include the feature, such as your own mail server, single sign-on or integrations. The matching Organization tab shows the same sentence with no form. A monthly AI budget that is used up answers 402 too, with the amount.',
                how: 'Ask the platform owner to switch the feature on or raise the budget.',
              },
              {
                name: '403 Forbidden, "Account disabled"',
                what: 'Correct password, but the account\'s Active toggle is off. Turn it back on from Users & Roles → Edit.',
              },
              {
                name: '409 Conflict',
                what: 'A role with that name already exists (role names are unique); or a role you are deleting is still held by users and you have not chosen a role to move them to; or a change would leave no active Super Admin, or would change your own role or deactivate your own account.',
                how: 'The message says which. For the delete case, the Delete dialog asks for the role to move people to.',
              },
              {
                name: '422 Unprocessable',
                what: 'The request was well-formed but refused for a reason the page shows in words: an unknown webhook event type.',
                how: 'Fix the field named in the message and save again. Nothing was stored.',
              },
              {
                name: '410 Gone',
                what: 'A candidate-facing link, interview, offer, coding assessment, is spent or expired. Invite links expire seven days after issue by default; interview links are single-use.',
                how: 'The fix is to resend the invitation, which mints a fresh link.',
              },
              {
                name: '413 Payload Too Large',
                what: 'An upload exceeded the platform limit, most often an interview answer recording, or the plan\'s storage is full ("Your plan\'s storage is full"), which refuses new résumé uploads.',
                how: 'For storage, see the Storage line on Organization, Company Profile, and delete what you no longer need or ask for a larger cap.',
              },
              {
                name: '423 Locked',
                what: 'Sign-in lockout: "Too many sign-in attempts. Try again later." Failed sign-ins are counted for an email from one address, and for the email across addresses, and an unknown email is counted the same way. While a sign-in is locked it is not even checked against the password. Wait out the duration you configured. There is no unlock control.',
                how: 'The message is the same whatever the email, so it does not say whether an account exists. A correct sign-in clears that sign-in\'s count.',
              },
              {
                name: '429 Too Many Requests',
                what: 'The request rate limiter. Ten login attempts per email or thirty per source IP inside five minutes; a separate, tighter limit on OTP verification.',
                how: 'Distinct from lockout, and not configurable from any screen. A whole office behind one IP can trip the IP limit collectively. Run live check, Send test email and Verify connection have their own limits and answer with a message asking you to wait a moment.',
              },
              {
                name: '503 Service Unavailable, "Database unavailable"',
                what: 'The API is running but cannot reach the database. Every screen that reads or writes will fail together.',
                how: 'This is the one code that means "not your fault, not a configuration problem". If a single screen shows it and others are fine, look again. It is almost certainly on more than one.',
              },
            ],
          },
        ],
      },
      {
        id: 'ops-uploads',
        title: 'When uploads or scores look wrong',
        summary:
          'The two questions you will be asked most often, and how to work through them without guessing.',
        subsections: [
          {
            id: 'ops-uploads-fail',
            title: 'Resume uploads are failing',
            steps: [
              'Open Activity from the bell icon in the top bar, go to Resumes, and click into the most recent batch. The Failed count and the Failed files list at the bottom give you the per-file error message, which is usually the whole answer.',
              'Check Uploaded against Processed. If Uploaded is lower than the number of files chosen, some were rejected before processing. The modal notes how many temp or invalid files were ignored, which catches the common case of editor lock files being swept up by a folder selection.',
              'If every file failed with an AI-related error, the model or its provider key is the problem. Check the CV classification and Embeddings rows under Models by Job and confirm the selected models\' providers are configured.',
              'If the batch never appears at all, the upload request itself failed. Bulk upload is capped at 500 files per request by default; a larger selection is rejected outright.',
              'If failures are intermittent and correlate with large batches, the operator\'s session may be expiring mid-upload. Check your Session Timeout setting.',
            ],
            faqs: [
              {
                q: 'Resumes report as processed but the records are empty or nearly empty.',
                a: 'That is the signature of a silently failing AI call. The platform returns an empty result rather than an error when a model call fails, so processing "succeeds" with nothing in it. Check that the selected model\'s provider key is configured, then re-upload one file to confirm.',
              },
              {
                q: 'Everything processes fine but nothing ever matches a job description.',
                a: 'Two likely causes, both silent. Either the vector index is not configured, or embeddings are failing and returning a placeholder value that matches nothing. Confirm the vector index shows as configured on Organization → Company Profile.',
              },
            ],
          },
          {
            id: 'ops-scores-wrong',
            title: 'Match scores look wrong',
            steps: [
              'Confirm the job description actually parsed. An unparsed job description is skipped by matching entirely. It will never gather candidates no matter how many relevant resumes you upload.',
              'Check the deadline. A job description past its deadline stops matching new resumes, and if auto-delete is on it will have been deleted rather than merely closed.',
              'Open the batch summary and read Resumes per Job Description. If one job description swallowed everything, the job descriptions are too similar to each other or the thresholds are too loose.',
              'If scores changed suddenly across the board, look for a model change. Models by Job is company-wide and leaves no confirmation, so a colleague may have changed a row without realising. A changed embedding model also leaves older CVs unmatched until they are re-embedded.',
              'Run Re-match once after any deliberate model or threshold change, so existing pipelines are rebuilt against the new configuration. Do not run it speculatively. It charges the whole resume pool.',
              'If matching returns nothing at all across every job description, suspect the vector index rather than the database. Everything else in the product will look healthy.',
            ],
            warnings: [
              'Re-match rebuilds pipelines and costs money proportional to your whole resume pool. It is a deliberate corrective action, not a diagnostic step.',
            ],
          },
        ],
      },
    ],
  },
]

export const superAdminGuide: RoleGuide = {
  role: 'superadmin',
  label: 'Super Admin',
  tagline: 'The complete system guide, every screen, plus the company controls only you hold.',
  intro: [
    'You hold the highest role in your company\'s workspace: its top administrator. Your reach is that one company, and nobody in another company can see yours. Everything a Recruiter and an HR Admin can do, you can do, so this guide contains their guides in full, followed by the material that is yours alone.',
    'Start with "Powers only you have" if you are new to the role. It is a single index of the capabilities gated to Super Admin, and it is the fastest way to understand what you are responsible for that nobody else can cover.',
    'One habit will save you more trouble than anything else in this guide: keep a second Super Admin account, held by a different person, so that a lockout or a mistaken role change is an inconvenience rather than an outage.',
    'One structural point worth carrying into every chapter: access is decided by both the role and the permission. Most admin endpoints require an admin role and the permission they name, so a ticked box in the matrix is enforced by the endpoint it names, but it cannot lift a custom role past the admin role check. The RBAC chapter sets out exactly where the line falls.',
    'Two facts about what people can see are worth knowing from the start. Recruiters never receive interview reports, scores, transcripts, integrity data or scorecards; only admins do, and a Recruiter still sees the match percentage. And a person whose account is limited to a department only sees that department\'s jobs and candidates.',
  ],
  chapters: [...coreChapters, ...adminChapters, ...superAdminChapters],
}

export default superAdminGuide
