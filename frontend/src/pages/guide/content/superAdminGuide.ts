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
          'A dozen capabilities are reserved to Super Admin. Three are enforced by the API itself and will return 403 to anyone else regardless of what the interface shows; the rest are enforced only by the interface hiding or disabling the control. Both kinds are listed, and the difference is called out per row, because it changes what happens if someone works around the UI.',
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
                what: 'The Users tab list. You get every account; an HR Admin\'s request is answered with Recruiters only, and the interface shows them a notice instead of the table.',
                how: 'See Users & Roles below. This is why the four stat cards read 0 for an HR Admin.',
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
                how: 'See The permission matrix below. This is the one place where the interface is misleading: the controls render for an HR Admin and simply do nothing.',
                access: 'API-enforced (rbac:manage)',
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
                what: 'A platform-wide switch that deletes every expired job description on sight.',
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
                name: 'Total AI Spend · Lifetime',
                kind: 'badge',
                what: 'The spend card on the Dashboard overview.',
                how: 'See AI model and spend below. UI-gated only - the figure is fetched for every role and merely not rendered for them.',
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
                name: 'AI Model (sidebar footer)',
                kind: 'field',
                what: 'Changing the model here writes the platform default for everyone, not a personal preference - for you and for an HR Admin alike.',
                how: 'See AI model and spend below. It is on this list because the consequence is platform-wide and almost nobody realises it.',
                access: 'Admin & Super Admin (shared)',
              },
            ],
            warnings: [
              'The rows marked "UI-gated only" are hidden, not forbidden. An HR Admin who calls the API directly can trigger them. Treat the UI gate as a guardrail against accidents, not as a security boundary - the security boundary is the six API-enforced rows.',
            ],
          },
        ],
      },
      {
        id: 'powers-activity',
        title: 'Activity - the destructive controls',
        path: '/dashboard/activity',
        access: 'Page is open to all signed-in users; the controls below are Super Admin only',
        summary:
          'Every role can read Activity - the resume-processing batch history and the expired job-description list. What only you see are the deletion controls layered on top: dismissing batch notifications, purging resumes by date, and clearing out expired job descriptions manually or automatically. Two of these permanently destroy candidate data.',
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
                how: 'Sits at the right end of each batch row and stops the click from also opening the batch modal. Confirm text: "Dismiss this batch notification? (Processed resumes are kept.)" Failures are swallowed silently - if the row does not disappear, the delete did not happen.',
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
                how: 'With both dates blank it refuses and shows "Pick at least one date." - but note this is the only guard: with one date filled and the other blank, the unbounded side is genuinely unbounded. The confirm dialog spells out the resolved range, e.g. "Permanently delete ALL resumes created between the beginning → 2026-08-07?"',
                access: 'Super Admin only',
              },
            ],
            warnings: [
              'The resume purge is permanent and there is no undo. The confirm dialog states the scope exactly: "This removes them from the database, file store, and JD pipelines. This cannot be undone."',
              'It deletes four things at once: the resume records, the original uploaded files, the candidates\' rows inside every job description\'s pipeline, and the vectors in the search index. A candidate who was mid-pipeline simply vanishes from that job.',
              'A blank From means "since the beginning of time". Filling only To and pressing Delete resumes wipes the entire resume history up to that date. Always fill both boxes unless you genuinely intend an unbounded purge.',
              'The purge is capped at 100,000 resumes per run. On a very large tenant that means one press may not finish the job, and the reported count will be lower than the true range - re-run until it reports 0.',
            ],
            faqs: [
              {
                q: 'It says "Delete failed."',
                a: 'The request errored. Nothing is partially deleted at the record level, but the operation is a sequence of steps - if it failed midway, re-running the same range is safe and idempotent.',
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
                what: 'A platform-wide switch. When on, expired job descriptions are deleted the moment anyone opens this tab, and the list is always empty. Its own caption reads "When on, JDs are removed automatically once their deadline passes. Super-admin only."',
                how: 'The deletion happens on read, not on a schedule - so nothing is removed until a person visits the page, and then everything expired goes at once. Turning it off stops future deletions but does not bring anything back. With it on, the list is replaced by "Auto-delete is on - expired JDs are removed automatically." plus a count of what was just cleaned up.',
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
                what: 'Red badge on every row in this list. Every row here is expired by definition - the badge is a label, not a filter result.',
              },
              {
                name: '↻ Refresh',
                kind: 'button',
                what: 'Re-fetches the expired list and returns to page 1. Available to every role.',
                how: 'With auto-delete on, pressing this is what triggers the deletion sweep.',
              },
            ],
            warnings: [
              'Deleting a job description is permanent and takes its candidate pipeline with it. Every candidate\'s stage, notes and history for that job are gone - the resumes survive, the recruiting context does not.',
              'Auto-delete is the single most consequential toggle on this page, because it removes the human confirmation step forever. With it on, nobody is ever asked "are you sure" again - a job description whose deadline passes is destroyed the next time anyone loads the Activity page. Leave it off unless you have a written retention policy that says otherwise.',
              'Turning auto-delete on hides the list. You lose the ability to review what is about to be deleted, because it is already gone by the time the page renders.',
              'A job description with no deadline never expires and never appears here. Auto-delete cannot touch it.',
            ],
          },
        ],
      },
      {
        id: 'powers-users',
        title: 'Users & Roles - what changes for you',
        path: '/dashboard/users',
        access: 'HR Admin & Super Admin, with several controls reserved to Super Admin',
        summary:
          'An HR Admin can open this screen and see all three tabs, but the page degrades heavily for them: the user list is refused, deletion is hidden, the Super Admin role is filtered out of the role picker, and every permission-matrix control silently does nothing. This section covers only those differences - the screen itself is documented in the Administration chapters.',
        subsections: [
          {
            id: 'pu-users',
            title: 'Users tab',
            controls: [
              {
                name: 'The user list itself',
                kind: 'column',
                what: 'You receive every account. An HR Admin\'s request is filtered server-side to Recruiters only, and when the interface detects the refusal it replaces the table entirely with: "Listing all users requires Super Admin access. Use the + Add User button above to create new users."',
                how: 'This is why the four stat cards (Total Users, Super Admins, HR Admins, Active) all read 0 for an HR Admin - they are counted from the list the browser holds, not from a server aggregate. For you they are accurate.',
                access: 'Super Admin only',
              },
              {
                name: 'Delete',
                kind: 'button',
                what: 'Trash icon in the Actions column. Permanently deletes the user account. Confirm text: "Delete user {email}? This cannot be undone."',
                how: 'Hidden entirely for an HR Admin, and refused by the API on top of that. You cannot delete your own account - the API returns 400 "Cannot delete yourself", which is the platform\'s only protection against removing the last Super Admin.',
                access: 'Super Admin only',
              },
              {
                name: 'Role',
                kind: 'field',
                what: 'The role select in the Create/Edit User modal. Only you see the Super Admin option; for an HR Admin it is filtered out of the list, leaving HR Admin, Recruiter and any custom roles.',
                how: 'The field\'s own hint reads "This is the only place a user\'s role is assigned. Permissions for each role are set on the Roles & Permissions tab." A role change is sent as a separate request from the name/status/OTP changes, so it can succeed or fail independently.',
                access: 'Super Admin only for the Super Admin value',
              },
              {
                name: 'Edit / Reset PW',
                kind: 'button',
                what: 'Available to any admin. Editing covers name, Active account and Require OTP on login; Reset PW sets a new password directly, subject to the password policy.',
                how: 'An HR Admin can do both - but only for the Recruiters they can see. They cannot reach an admin account through this screen.',
              },
              {
                name: '+ Add User',
                kind: 'button',
                what: 'Opens the Create New User modal. Available to any admin, including an HR Admin whose list is blocked - the notice explicitly points them at it.',
                how: 'The Password field is subject to your current password policy, and the request fails at submit with the API\'s message if it does not comply.',
              },
            ],
            warnings: [
              'Deleting a user is permanent and there is no undo in the product. Their audit-log entries survive (the log records the email as a string, not a link), but the account itself is gone. Deactivating with the Active account toggle is almost always the better move - it blocks login with 403 "Account disabled" and keeps the record.',
              'Do not reduce yourself to a single Super Admin account. The only thing stopping the platform from having zero Super Admins is the "Cannot delete yourself" check, and that does not stop you from demoting yourself to HR Admin - after which nobody can promote you back through the interface.',
              'A role change takes effect on the target user\'s very next API request, because the role is re-read from the database on every call. Their sidebar and nav will not change until they sign out and in again, so they can be looking at a menu of screens the API has already started refusing.',
            ],
          },
          {
            id: 'pu-matrix',
            title: 'Roles & Permissions tab - the silent gate',
            body: [
              'This tab shows the permission matrix: one row per permission, grouped by category, with a fixed read-only column for each built-in role (Super Admin, HR Admin, Recruiter) and one editable column per custom role.',
              'The built-in columns carry a lock icon titled "Built-in role - permissions are fixed" and are disabled for everyone, including you. To change what a built-in role can do you have to create a custom role document with the same name - see the RBAC chapter.',
            ],
            controls: [
              {
                name: 'Custom role checkboxes',
                kind: 'toggle',
                what: 'For you: toggling one writes the role\'s full new permission list immediately, with an optimistic flip and a rollback plus the toast "Failed to update permission" if the write fails.',
                how: 'For an HR Admin the checkbox renders enabled and clicking it does absolutely nothing - no toast, no error, not even an optimistic flip. If a colleague says "I ticked it and it did not stick", this is why.',
                access: 'Super Admin only',
              },
              {
                name: '+ New Role',
                kind: 'button',
                what: 'Creates a custom role with no permissions, which you then grant by ticking its column. Its modal hint says exactly that.',
                how: 'For an HR Admin the button opens the modal and Create silently fails. Roles cannot be renamed after creation - the Name field is disabled on edit with the hint "A role cannot be renamed after creation."',
                access: 'Super Admin only',
              },
              {
                name: 'Delete role (trash)',
                kind: 'button',
                what: 'Removes a custom role document. Confirm text: Delete custom role "{name}"? Users with this role will need to be reassigned.',
                how: 'For an HR Admin the confirm dialog never even appears. For you it does - and note the confirm text is a warning, not a guarantee: deleting the role does not reassign anyone.',
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
                how: 'With 46 permissions across 18 categories, use it. When nothing matches you get "No permissions match" plus a Clear filter button.',
              },
            ],
            warnings: [
              'Deleting a custom role does not reassign the people holding it. Their role string stays pointing at a role that no longer exists, which resolves to an empty permission set - they keep their login and lose everything the permission system gates. Reassign every holder on the Users tab first, then delete the role.',
              'The matrix controls are not disabled for an HR Admin, they are inert. This is a genuine interface quirk. If you are training admins, tell them the matrix is read-only for them so they do not spend an afternoon toggling boxes that never save.',
            ],
          },
        ],
      },
      {
        id: 'powers-ai',
        title: 'AI model, spend and re-matching',
        access: 'Mixed - see each control',
        summary:
          'Three controls related to the AI layer behave differently for you. Two are simply hidden from other roles; the third is shared with HR Admin but has a platform-wide effect that its placement in the sidebar does not suggest at all.',
        subsections: [
          {
            id: 'pai-model',
            title: 'The AI Model selector is not a personal preference',
            body: [
              'The AI Model dropdown sits in the sidebar footer, next to your name and the Sign out button. It looks like a per-user, per-session preference. It is not.',
              'Changing it does two things at once: it updates your own browser\'s stored choice, and it sends a request that writes the platform-wide default model for every user and every future AI operation. If you are an admin or Super Admin that request succeeds. If a Recruiter changes it, the request is refused and the effect really is local to their browser - so the same control behaves differently depending on who touches it.',
              'The failure is also silent. If the write is refused the interface says nothing and the dropdown keeps showing the new value, so a Recruiter can believe they changed something global when they have not, and you can believe you changed something local when you have.',
            ],
            controls: [
              {
                name: 'AI Model',
                kind: 'field',
                what: 'Select in the sidebar footer. For an admin or Super Admin, choosing a model writes the platform default. For a Recruiter the write is refused and only their local copy changes.',
                how: 'Choices come from the platform model registry. Picking a model whose provider key is not configured does not fail here - it fails later, at the first operation that tries to use it. Verify a switch by running one small resume upload before you leave it in place.',
                access: 'Platform-wide effect for Admin & Super Admin',
              },
            ],
            warnings: [
              'This control has no confirmation dialog and no visible "this affects everyone" label. Treat every touch of it as a platform configuration change.',
              'Switching to a model from a provider with no configured API key breaks AI processing for everyone until you switch back. Resume parsing, JD parsing, matching and interview evaluation all go through the same model resolution.',
              'Cost changes immediately and by a lot. The registry spans models with roughly a fiftyfold difference in per-token price. Check the Total AI Spend card on the dashboard after switching.',
            ],
          },
          {
            id: 'pai-spend',
            title: 'Total AI Spend · Lifetime',
            body: [
              'The spend card on the Dashboard overview is rendered only for Super Admin. The figure behind it is fetched for every role - it is the rendering that is gated, not the data - but no other role sees it in the interface.',
            ],
            controls: [
              {
                name: 'Total AI Spend · Lifetime',
                kind: 'badge',
                what: 'Estimated lifetime AI cost in USD across every tracked processing run. Shows two decimal places above a dollar and four below it, so small tenants see a real number rather than $0.00.',
                how: 'Beneath it: the number of processing runs and the date tracking started. The card\'s own footnote explains the key property - the total is tracked independently of Activity, so clearing batch history never resets it.',
                access: 'Super Admin only',
              },
              {
                name: 'Avg / Résumé',
                kind: 'badge',
                what: 'Lifetime spend divided by resumes processed, to four decimal places. The most useful number on the card for forecasting.',
                how: 'Multiply by your expected monthly resume volume to budget. Re-check it after any model change - this is the figure that moves.',
                access: 'Super Admin only',
              },
              {
                name: 'Résumés / Prompt / Completion / Embedding',
                kind: 'badge',
                what: 'The volume behind the cost: resumes processed, and prompt, completion and embedding token counts. Token counts are abbreviated to K and M.',
                how: 'A jump in Prompt tokens without a matching jump in Résumés usually means re-matching, not new uploads.',
                access: 'Super Admin only',
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
              'It re-runs similarity matching for the entire resume pool against every parsed job description and rebuilds all candidate pipelines. It never sends invitations - the invite flag is hard-wired off from this button.',
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
                how: 'Note the count and the spend card figure before and after - a full re-match on a large pool is one of the more expensive single actions in the product.',
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
      'The complete access-control model: three built-in roles, three route guards, one permission catalog of 46 entries, and the custom-role mechanism that can extend or override any of it. Read this before you edit the permission matrix, because the matrix governs less than its name suggests.',
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
                what: 'Full platform authority. Everything an HR Admin can do, plus user deletion, role assignment, custom-role management, the Activity purge controls and the spend view. Sidebar reads "Super Admin Portal"; the role badge is amber.',
                how: 'This is an operator role, not a daily-driver role. Have at least two, and ideally use an HR Admin account for routine work so that a mistake cannot be a platform-wide one.',
              },
              {
                name: 'HR Admin (admin)',
                kind: 'badge',
                what: 'Runs recruiting operations and all configuration except access control and platform security. Gets the whole Admin Settings nav group: Users & Roles, Platform Settings, Organization, Interview & Automation. Sidebar reads "HR Admin Portal".',
                how: 'The right role for whoever owns your recruiting process. They can configure email templates, prompts, webhooks, departments, scenarios and workflow rules, and they can create and manage Recruiter accounts - but they cannot see or touch admin accounts, cannot assign roles, and cannot reach anything on the Super Admin list.',
              },
              {
                name: 'Recruiter (standard)',
                kind: 'badge',
                what: 'Day-to-day recruiting. Sees the three module screens - Dashboard, Recruiting, Activity - plus their own profile. The entire Admin Settings nav group is absent. Sidebar reads "Recruiter Portal".',
                how: 'The default for a new account, and the right default. Note that the interface lets a Recruiter do more than their nominal read-only permission set suggests, because most endpoints are gated on the role string rather than on the permission catalog - see the matrix section below.',
              },
              {
                name: 'A custom role',
                kind: 'badge',
                what: 'Any role name you create on the Roles & Permissions tab. Shown with a neutral badge and the raw role name, since there is no friendly label for it.',
                how: 'Custom roles participate in the permission system but not in the role-string checks. Read the custom-role section below before assigning one to a real person - the practical effect is usually narrower than intended.',
              },
            ],
          },
        ],
      },
      {
        id: 'rbac-guards',
        title: 'How access is actually enforced',
        summary:
          'There are two independent enforcement layers, and they do not agree with each other. The interface hides screens using three route guards; the API protects endpoints using either a hardcoded role check or a permission check. Understanding which layer stops what is the difference between configuring access correctly and thinking you have.',
        subsections: [
          {
            id: 'guards-frontend',
            title: 'Layer 1 - route guards in the interface',
            body: [
              'Three guards wrap the dashboard routes. They read the role from the copy of the user record cached in browser storage at login, so they are fast, and they are stale until the next sign-in.',
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
                how: 'Redirects silently - there is no "access denied" screen anywhere in the product. A user who follows an admin link just lands back on the dashboard with no explanation.',
              },
            ],
            warnings: [
              'The guards read a cached role. If you change someone\'s role while they are signed in, their nav and route access do not change until they sign out and back in - but the API starts enforcing the new role on their very next request. The window between the two is when you get confused support tickets: menus that are visible but produce errors.',
            ],
          },
          {
            id: 'guards-backend',
            title: 'Layer 2 - the API',
            body: [
              'Every API request re-reads the user record from the database using the email inside the token. That means a deactivated or deleted account stops working immediately, on the next request, with no need to wait for a session to expire. It also means a role change is live server-side at once.',
              'From there, an endpoint is protected in one of three ways.',
            ],
            controls: [
              {
                name: 'Signed-in only',
                what: 'Any valid token. Used for reads: job and resume listings, candidate lists, analytics, the batch and expired-JD lists on Activity, saved filters, the model list.',
              },
              {
                name: 'Admin or Super Admin (hardcoded role check)',
                what: 'Rejects anything other than admin or superadmin with 403 "Admin access required". This is the workhorse - it protects the great majority of write endpoints across jobs, candidates, interviews, offers, coding, scenarios, workflows, webhooks, branding, company settings, email templates, prompt config, departments, designations, bulk uploads, user creation and password resets.',
                how: 'Crucially, this check reads the role string directly. It does not consult the permission catalog at all, so no amount of editing the permission matrix changes who passes it.',
              },
              {
                name: 'Super Admin only (hardcoded role check)',
                what: 'Rejects anything other than superadmin with 403 "Superadmin access required". Used by exactly three endpoints: deleting a user, purging resumes by date, purging expired job descriptions, and toggling auto-delete for expired job descriptions.',
                how: 'Plus one in-handler variant: the general user-update endpoint accepts any admin, but rejects a write to the role field from a non-superadmin with 403 "Only a Super Admin can change a user\'s role".',
              },
              {
                name: 'Permission check (rbac:read / rbac:manage / audit:read)',
                what: 'The only endpoints that consult the permission catalog. They cover the RBAC surface itself - reading the catalog and roles, creating/updating/deleting custom roles, assigning a role to a user, and reading the audit log.',
                how: 'A failure returns 403 "Missing required permission: {name}". Because this is the one place the catalog is consulted, editing the matrix meaningfully changes behaviour here and essentially nowhere else.',
              },
            ],
            warnings: [
              'The permission catalog is largely aspirational today. Only the RBAC and audit-log endpoints are gated on it; everything else is gated on the role string. Granting a custom role jobs:delete does not let it delete a job, and revoking jobs:delete from admin does not stop an HR Admin deleting one. Treat the matrix as governing access control and audit visibility, not as a general-purpose feature switchboard.',
              'One partial exception: department scoping. A user who has a department assigned and whose role lacks departments:cross_scope is narrowed to their own department when listing jobs and candidates. Both admin and superadmin hold that permission by default, so nothing is scoped until you deliberately remove it.',
            ],
          },
        ],
      },
      {
        id: 'rbac-matrix',
        title: 'Role × capability matrix',
        summary:
          'The definitive answer to "who can do what". Read it as capabilities, not raw permission strings - each row names something a person actually does in the product and states which of the three roles can do it, and whether the limit is enforced by the API or only by the interface.',
        subsections: [
          {
            id: 'matrix-numbers',
            title: 'The permission catalog at a glance',
            body: [
              'The catalog holds 46 permissions across 18 categories. The three built-in roles hold:',
              'Super Admin - all 46. Every permission in the catalog, with no exclusions.',
              'HR Admin - 44. Everything except users:manage and rbac:manage, the two permissions that are themselves about controlling who can do what.',
              'Recruiter - 8, all reads: jobs:read, resumes:read, intel:read, candidates:read, coding:read, scenarios:read, offers:read, analytics:read.',
              'Note the gap between that Recruiter list and what a Recruiter can actually do in the interface. Because most write endpoints are gated on the role string and not on the catalog, a Recruiter\'s real capability is "everything on the five module screens that is not admin-gated" - which is broader than ten read permissions. The catalog describes the intended model; the role checks describe today\'s behaviour.',
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
                how: 'Password changes are subject to the platform password policy. This build ships no screen for editing it, so it runs on its defaults unless changed at the database level.',
              },
              {
                name: 'View Dashboard analytics (funnel, time-to-hire, drop-off, recruiter performance, diversity)',
                what: 'SA yes · HRA yes · REC yes.',
                how: 'Only the AI spend card is gated, to Super Admin.',
              },
              {
                name: 'View Total AI Spend',
                what: 'SA yes · HRA no · REC no.',
                how: 'Interface-gated only. The figure is fetched for everyone and simply not rendered.',
              },
              {
                name: 'Browse jobs, resumes and candidates',
                what: 'SA yes · HRA yes · REC yes.',
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
                how: 'API-enforced. Recruiters can read pipelines but not act on them.',
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
                name: 'Configure email templates, AI prompts, webhooks, system settings',
                what: 'SA yes · HRA yes · REC no.',
                how: 'All on Platform Settings, behind AdminRoute.',
              },
              {
                name: 'Set the platform default AI model',
                what: 'SA yes · HRA yes · REC no.',
                how: 'A Recruiter\'s attempt is refused silently and only changes their own browser copy.',
              },
              {
                name: 'Create users; reset any visible user\'s password',
                what: 'SA yes · HRA yes · REC no.',
                how: 'HR Admin can only see Recruiters, so in practice they can only reset Recruiter passwords.',
              },
              {
                name: 'List every user account',
                what: 'SA yes · HRA no (Recruiters only) · REC no.',
                how: 'API-enforced. The HR Admin view is filtered server-side, not just hidden.',
              },
              {
                name: 'Assign or change a user\'s role',
                what: 'SA yes · HRA no · REC no.',
                how: 'API-enforced on both write paths - the RBAC assignment endpoint and the role field on the general user update.',
              },
              {
                name: 'Delete a user account',
                what: 'SA yes · HRA no · REC no.',
                how: 'API-enforced. You cannot delete your own account.',
              },
              {
                name: 'Read the permission catalog and role list',
                what: 'SA yes · HRA yes · REC no.',
                how: 'Permission-enforced via rbac:read, which HR Admin holds by default.',
              },
              {
                name: 'Create, edit or delete custom roles; change the permission matrix',
                what: 'SA yes · HRA no · REC no.',
                how: 'Permission-enforced via rbac:manage. For HR Admin the controls render but do nothing.',
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
                what: 'SA yes · HRA yes · REC yes by default.',
                how: 'All three built-in roles hold departments:cross_scope, so nothing is scoped out of the box. Scoping only begins once you both assign a department to a user and remove that permission from their role - which, for a built-in role, means creating a same-named custom role override.',
              },
            ],
          },
        ],
      },
      {
        id: 'rbac-custom',
        title: 'Custom roles - what they can and cannot do',
        summary:
          'A custom role is a document holding a name and a list of permissions. It is created on the Roles & Permissions tab and assigned on the Users tab. Custom roles are genuinely useful for one thing - narrowing access control and audit visibility - and misleading for almost everything else, because most of the product does not consult permissions at all.',
        subsections: [
          {
            id: 'custom-mechanics',
            title: 'How role resolution works',
            body: [
              'When the system needs to know what a role can do, it looks for a role document with that name first, and falls back to the built-in defaults if there is none. That has two consequences worth understanding before you create anything.',
              'First, a custom role with a brand-new name gets exactly the permissions you tick, and nothing else. There is no inheritance and no base set.',
              'Second - and this is the powerful, dangerous part - creating a role document named superadmin, admin or standard overrides that built-in role\'s defaults for everyone holding it. That is the only way to change what a built-in role can do, since the built-in columns in the matrix are locked. It is also the only way to lock yourself out of the RBAC system.',
            ],
            steps: [
              'Open Users & Roles → Roles & Permissions.',
              'Press + New Role. Give it a lowercase, no-spaces name - you cannot rename it later.',
              'Save. The role is created with no permissions at all.',
              'Find its new column in the matrix and tick the permissions it should hold. Each tick saves immediately.',
              'Go to the Users tab, edit a user, and pick the new role from the Role dropdown. Custom roles appear alongside the three built-ins.',
              'Have that user sign out and back in, so their cached role and nav match what the API will now enforce.',
            ],
            warnings: [
              'A user holding a custom role fails every hardcoded admin and Super Admin check, because those compare the role string against the literal values admin and superadmin. A custom role called "hiring_manager" with every permission in the catalog ticked still cannot create a job, because the job endpoint asks "is your role string admin or superadmin?" and the answer is no. In practice a custom role today behaves like a Recruiter with adjusted RBAC and audit visibility.',
              'Never create a role document named superadmin without rbac:manage in it. Doing so removes the ability to edit roles from every Super Admin at once, permanently, through the interface - the only recovery is direct database access to delete the offending document. Every role-string-gated screen would keep working, but the permission matrix would be frozen forever.',
              'Deleting a custom role leaves its holders pointing at a name that resolves to no permissions. They can still sign in and still pass the role-string checks (which they were failing anyway), but every permission-gated surface refuses them. Reassign holders first.',
              'Role names are not validated for shape. A typo creates a second, separate role rather than an error, and assigning a user to a role name that does not exist is rejected - but only on the two role-write endpoints, which is the protection you are relying on.',
            ],
            tips: [
              'Before creating a custom role, ask what you actually want to change. If the answer is "who can see the audit log" or "who can edit roles", a custom role works. If it is "let this person create jobs but not delete them", it does not - that granularity does not exist yet.',
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
          'A single-page application in the browser talking to one HTTP API. There is no server-side rendering, no background push channel and no per-tenant deployment - one running backend serves one organization.',
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
                how: 'In local development the dev server runs on port 5173 and proxies /api/v1 to a backend on port 8000. In a deployed environment the app is pointed at the API\'s public URL by an environment variable at build time - which means changing the API address requires a rebuild, not a config edit.',
              },
              {
                name: 'The database',
                what: 'MongoDB, holding every collection the product uses. When it is unreachable the API answers 503 "Database unavailable" rather than failing opaquely.',
                how: 'That exact string is the fingerprint. If several unrelated screens all show it at once, the problem is the database, not the feature.',
              },
              {
                name: 'The vector index',
                what: 'A separate vector search service holding resume and job-description embeddings. Matching quality depends on it; nothing else does.',
                how: 'If matching returns nothing but everything else works, suspect this rather than the database. Embeddings are regeneratable - losing them costs a re-embed, not data. Recover them by re-running the match rather than by hunting for a copy.',
              },
              {
                name: 'No WebSocket',
                what: 'There is no push channel. Progress on long-running work - bulk uploads, re-matching - is polled by the browser.',
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
          'Bearer tokens, stored in the browser, attached to every request, validated against the live user record on every call. Understanding the three places state lives - the token, the browser\'s cached user record, and the database - explains almost every confusing access problem you will be asked about.',
        subsections: [
          {
            id: 'arch-auth-flow',
            title: 'What happens on sign-in',
            steps: [
              'The user posts their email and password. The email is lower-cased and trimmed first, so casing never matters.',
              'Rate limits are checked: ten attempts per email and thirty per source IP inside a five-minute window, both answered with 429.',
              'If account lockout is enabled and the account is currently locked, the request is refused with 423 before the password is even checked.',
              'The password is verified. On failure, if lockout is enabled, the failure counter increments and may trip a lock. On success the counter and any lock are cleared.',
              'A disabled account is refused with 403 "Account disabled" - after the password check, so a disabled user still resets their own lockout counter by logging in correctly.',
              'If the account requires OTP, a six-digit code is emailed and the response asks for it. The code expires in ten minutes and allows five wrong guesses before it is burned.',
              'Otherwise a token is minted, carrying the user\'s email and an expiry taken from your Session Timeout policy or the platform default of 1440 minutes.',
              'The browser stores the token and a copy of the user record - email, name and role - in local storage, and uses that cached role to decide which nav entries and routes to show.',
            ],
          },
          {
            id: 'arch-auth-runtime',
            title: 'What happens on every subsequent request',
            body: [
              'The token is attached automatically to every API call. The API decodes it, pulls the email out, and re-reads that user from the database - so the role, the active flag and every other attribute are always current, never whatever was true at login.',
              'If the token is expired or invalid, or the user has been deleted or deactivated, the API answers 401. The app reacts to any 401 by clearing the stored session and hard-redirecting to /login. There is no refresh token, no retry, and no warning.',
            ],
            controls: [
              {
                name: 'The token',
                what: 'A signed JWT carrying the user\'s email and an expiry. It is the only credential. It cannot be revoked individually.',
                how: 'Deactivating or deleting the user is the effective revocation - the next request re-reads the user record and fails. That takes effect within one request, not at token expiry.',
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
            ],
            warnings: [
              'A 401 is destructive to in-progress work. It clears the session and navigates away immediately, so any unsaved form is lost. Users experience an expired session as losing work, which is worth weighing when you set the session timeout.',
              'Signing out clears the token from this browser only. It does not invalidate the token server-side. A token copied out of local storage keeps working until it expires.',
              'There is a demo-token bypass in the backend that grants any role with no credentials at all. It is disabled by default and the service refuses to start with obviously-default secrets, but it is worth confirming it is off in any environment you inherit - it is the single most dangerous configuration flag in the product.',
            ],
          },
        ],
      },
      {
        id: 'arch-ai',
        title: 'The AI layer',
        summary:
          'One configurable model powers resume parsing, job-description parsing, matching and interview evaluation. Matching additionally uses a separate embedding model and a vector index. Cost is metered per operation and accumulated in an append-only ledger.',
        subsections: [
          {
            id: 'arch-ai-parts',
            title: 'What the AI layer does',
            controls: [
              {
                name: 'The chat model',
                what: 'Selected by the AI Model dropdown and stored as a platform default. Used to parse resumes and job descriptions into structured records, generate and evaluate interviews, and review code quality on coding assessments.',
                how: 'The registry spans several OpenAI models and several Anthropic ones. Anthropic models require their own API key and are unavailable without it - an unavailable model does not fail at selection time, it fails at first use.',
              },
              {
                name: 'The embedding model',
                what: 'A separate, fixed model that converts resume and job-description text into vectors. Not selectable from the interface.',
                how: 'It is why matching still costs money even when nothing is being parsed, and why the spend card breaks out Embedding tokens separately.',
              },
              {
                name: 'Matching thresholds',
                what: 'Similarity floors that decide which resumes attach to which job descriptions, plus a skills bonus and a stricter floor for cross-domain matches. Configured in the deployment environment, not in the interface.',
                how: 'If matching feels too loose or too tight and the model is not at fault, these are the levers - but they are outside the app, so changing them is a deployment task.',
              },
              {
                name: 'Auto-invite threshold',
                what: 'A match score above which a candidate is invited automatically during bulk processing. Also an environment setting.',
                how: 'The Auto-invited count in the batch summary modal on Activity tells you how often it fires.',
              },
              {
                name: 'The cost ledger',
                what: 'An append-only record of every tracked AI operation and its estimated cost, feeding the Total AI Spend card.',
                how: 'Never reduced by any deletion in the product. It is the only figure that survives a full purge, which makes it the reliable long-run baseline.',
              },
            ],
            warnings: [
              'Changing the AI Model changes cost, quality and provider all at once for everybody. The per-token price across the registry varies by roughly fifty times between the cheapest and the most expensive entry.',
              'Switching to a provider whose key is not configured silently degrades every AI feature. Verify after any switch by uploading a single resume and confirming it parses.',
            ],
          },
        ],
      },
      {
        id: 'arch-data',
        title: 'Where data lives',
        summary:
          'A practical map of the collections behind the screens. This build ships no export/import screen, so nothing below is recoverable from inside the product - plan recovery at the database level.',
        subsections: [
          {
            id: 'arch-data-map',
            title: 'Collection map',
            controls: [
              {
                name: 'Recruiting core - jobs, resumes, candidates, offers',
                what: 'Everything the Recruiting workspace shows.',
                how: 'The original uploaded resume files live separately from the resume records, so the two have to be recovered together to be useful.',
              },
              {
                name: 'People - users',
                what: 'Accounts, roles, active flags, OTP requirement, lockout counters.',
                how: 'Password hashes live here too. A user recovered without theirs cannot log in until someone resets their password.',
              },
              {
                name: 'Org structure - departments, designations',
                what: 'Referenced by name from designations, and by id from jobs and users.',
              },
              {
                name: 'Automation - scenarios, workflow_rules, coding_questions, webhook_subscriptions',
                what: 'Webhook subscriptions here are live the moment they exist - recovering an old one re-enables an endpoint you may have turned off deliberately.',
              },
              {
                name: 'Configuration - branding, company settings, email templates, prompt overrides, notification settings, password policy, JD auto-delete flag',
                what: 'Runtime configuration, changeable by an admin at any time.',
                how: 'This is the single biggest gap to plan around. Document your configuration outside the product, or a rebuild into a fresh install will leave you re-doing the whole setup runbook by hand.',
              },
              {
                name: 'History - audit_log, email_log, upload_batches, coding_submissions, cost_ledger',
                what: 'Append-only trails and operational bookkeeping rather than restorable state; the audit log in particular is evidence, so it is never rewritten from anywhere - including from anything that could inject fabricated history.',
                how: 'If you need long-term retention of the audit trail, export it from the Audit Log tab or at the database level.',
              },
              {
                name: 'Transient - rate limits, SSO state, OTP records',
                what: 'All short-lived by design; recovering them would be actively harmful - a stale lockout could be resurrected.',
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
                what: 'Company profile, branding, departments and designations (Organization); email templates, AI prompts, webhooks and system settings (Platform Settings); scenarios, workflow rules and coding questions (Interview & Automation); users and roles (Users & Roles).',
                how: 'All of it is stored in the database and changeable at runtime by an admin.',
              },
              {
                name: 'Configured in the deployment',
                what: 'Every credential and every threshold: the mail transport, provider API keys, single sign-on client details, the webhook signing secret, matching and auto-invite thresholds, upload limits, token lifetime default, rate limits, the code-execution service, meeting providers, and the HRMS connector.',
                how: 'These live in the backend\'s environment. There is no screen for them. Changing one is a deployment task and usually requires a restart.',
              },
              {
                name: 'The Company Profile tab\'s integration status view',
                what: 'The Organization screen\'s first tab includes a live status view of every external integration - configured or not-configured booleans for email transport, single sign-on, the code-execution service, meeting providers, the HRMS connector and each external job source. It never shows the secret values themselves.',
                how: 'Check it first whenever a feature reports "not configured". It reads entirely from in-memory settings, with no database dependency, so it keeps working even during a database outage - which makes it a useful signal that the API itself is alive. If it shows "Could not load integrations status.", the API is unreachable, not misconfigured.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Startup configuration warnings',
                what: 'The backend audits its own configuration at startup and logs what is missing - no mail transport, no AI provider key, an OpenAI key absent while an Anthropic one is present, and so on. These are logged loudly and are non-fatal.',
                how: 'They are only visible in the deployment logs, never in the app. If you inherit an environment, reading its startup log is the single fastest inventory of what is wrong with it.',
              },
              {
                name: 'Startup security gates',
                what: 'Two settings make the service refuse to start outright: a signing secret still set to the shipped placeholder, and a default Super Admin password still set to the shipped literal. A further set of weaker findings - placeholder-looking values, a short signing secret, a short or common Super Admin password, and the demo-auth bypass left on outside debug mode - are logged as errors but do not block startup by default.',
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
          'Email carries one-time login codes, candidate invitations, interview links, offer letters and admin notifications. If it is not configured, none of those reach anyone - and several of them fail quietly.',
        subsections: [
          {
            id: 'int-email-config',
            title: 'What has to be set up',
            controls: [
              {
                name: 'Transport',
                what: 'Three states, checked in order. If the SES flag is on, mail goes through the AWS SES API. Otherwise, if an SMTP host is set, mail goes through SMTP. If neither is set, the platform enters a development fallback that does not deliver anything.',
                how: 'For SMTP the deployment needs host, port, username, password and a TLS flag; the default port is 587 with TLS on. For SES it needs the region, and credentials come from the platform\'s own identity rather than being configured here. When SES is on there is deliberately no SMTP fallback - an SES failure is a hard failure, not a downgrade.',
              },
              {
                name: 'The development fallback (the dangerous one)',
                what: 'With no transport configured at all, every send is logged to the server log with the full message body, recorded in the delivery log with a status of not-sent, and reported back to the calling code as a success.',
                how: 'This is why an unconfigured deployment looks completely healthy from inside the app. Invitations appear to send. Candidates appear invited. Nothing arrives. Confirm the Company Profile integration status shows an email transport before you believe any invitation was delivered.',
              },
              {
                name: 'From address and name',
                what: 'The sender on every outbound message. Defaults are placeholders and must be replaced.',
                how: 'Use an address on a domain you control and have authenticated for sending, or your invitations will land in spam regardless of how the rest is configured.',
              },
              {
                name: 'Frontend URL',
                what: 'The public base URL used to build every link inside an email - interview links, offer links, coding assessment links, shared profile links.',
                how: 'If it is wrong, emails are delivered and every link inside them is broken. This is the most common single misconfiguration after the transport itself, because nothing in the app fails - the recipient just gets a dead link.',
              },
              {
                name: 'Email Templates tab',
                what: 'On Platform Settings. Six overridable templates: Interview Invitation, Post-Interview Status, Assessment Invitation, Offer Letter, Rejection Notice, and Reminder / Follow-up. Each has an editable subject, HTML body and plain-text body.',
                how: 'Placeholders use double-brace syntax such as {{candidate_name}} and {{job_title}}, and are whitespace-tolerant. An unrecognised placeholder is left on the page as literal text rather than raising an error, so a typo ships silently to a candidate. Deleting an override resets that template to its built-in default. Every field falls back independently, so you can override only the subject and keep the shipped body.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'The candidate-facing warning banner',
                what: 'A red banner above the editor on every candidate-facing template, warning that scores, recommendations and report content must never appear in them.',
                how: 'That banner is the only enforcement. There is no server-side content check - if you paste a score placeholder into a candidate template, it will be sent. Treat the banner as a policy you have to keep, not a guard rail that will catch you.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Branding & Notifications tab',
                what: 'On Organization. Sets an admin notification address and offers five internal event toggles: Offer Declined, Candidate Flagged for Integrity, Job Import Failed, Coding Submission Execution Failed, and Webhook Delivery Failed. All default to off.',
                how: 'Important caveat: these toggles are stored but nothing in the platform currently reads them to decide whether to send. Turning them on has no runtime effect today. Do not build an alerting process on them - use webhooks or the deployment logs instead.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Email delivery log',
                what: 'Every send is recorded with recipient, subject, template, the candidate and job it relates to, and a status of sent, failed or not-sent.',
                how: 'It is surfaced per candidate on the candidate record, not as a platform-wide screen. One-time login codes are the exception - they are not recorded at all, so a user reporting a missing OTP leaves no trace anywhere in the app.',
              },
            ],
            warnings: [
              'With email unconfigured, one-time login codes cannot be delivered. Never turn on Require OTP on login for an account before you have confirmed email works end to end - you will lock that user out with no way to let them in, and no log entry to diagnose it from.',
              'The one-time-code template is not overridable. Five of the outbound templates are configurable; the login code email is hardcoded.',
            ],
            steps: [
              'Have the deployment configured with a transport, a real from-address and the correct public frontend URL.',
              'Create a throwaway user account with an email address you control.',
              'Turn on Require OTP on login for that account and try to sign in as them. Receiving the code proves transport, sender and delivery in one step.',
              'Invite a test candidate and click the link in the email. That proves the frontend URL is right.',
              'Turn OTP back off and delete the test account.',
            ],
          },
        ],
      },
      {
        id: 'int-webhooks',
        title: 'Outbound webhooks',
        summary:
          'Push recruiting events to another system as they happen. Subscriptions are managed in the app on Platform Settings; the signing secret that lets the receiver verify the calls is a deployment setting. Delivery is best-effort and fire-and-forget - there is no retry and no delivery history, which shapes everything about how you should use them.',
        subsections: [
          {
            id: 'int-webhooks-config',
            title: 'Setting them up',
            body: [
              'A subscription is a URL, a list of event names it wants, a payload format, and an active flag. Deliveries are a single HTTP POST with a five-second timeout.',
            ],
            controls: [
              {
                name: 'Webhooks tab',
                what: 'On Platform Settings. A table of URL, Event Types, Format and Status, with Test, Edit and Delete on each row.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'URL',
                kind: 'field',
                what: 'The endpoint to POST to. Must be a public http or https address.',
                how: 'Loopback, private-network, link-local and reserved addresses are rejected outright with a 400 explaining exactly that. The check runs when you create the subscription, when you edit it, when you test it, and again at every delivery - so a URL that later resolves to a private address stops being delivered to, silently.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Event Types',
                kind: 'field',
                what: 'A comma-separated free-text list of event names this subscription wants. Matching is exact string comparison.',
                how: 'This is the sharpest edge on the whole feature: there is no dropdown, no validation, and no feedback. A typo produces a subscription that looks correct in the table and never fires. The six event names that can occur without extra configuration are resume_processed, candidate_invited, candidate_status_changed, interview_completed, offer_created and offer_status_changed.',
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
                name: 'Test',
                kind: 'button',
                what: 'Sends one test delivery and reports back the receiving endpoint\'s status code, or the connection error. Result shows as a Success or Failed badge that clears after a few seconds.',
                how: 'This is the only feedback loop the feature has. Real deliveries report nothing anywhere. Test after creating a subscription, and again after any change to the receiving service.',
                access: 'HR Admin & Super Admin',
              },
              {
                name: 'Signature',
                what: 'Every delivery carries an HMAC-SHA256 signature of the exact request body, as lowercase hex with no prefix, in an X-Webhook-Signature header. The event name travels alongside it in an X-Webhook-Event header.',
                how: 'The signing key is a per-subscription secret if one is set, otherwise a deployment-wide signing secret. With neither, the header is still sent - as an empty string. Your receiver should treat an empty signature as a failed verification, not as "no signature to check".',
              },
              {
                name: 'Per-subscription secret',
                what: 'A subscription can carry its own signing secret, which takes precedence over the platform-wide one.',
                how: 'The field is not exposed anywhere in the interface. Every subscription created from the Webhooks tab therefore uses the platform-wide secret. Setting a per-subscription secret requires calling the API directly.',
              },
            ],
            warnings: [
              'There is no retry and no delivery log. A single POST is attempted with a five-second timeout; a non-2xx response or a connection failure is logged on the server and discarded. Nothing is queued, nothing is retried, and nothing appears in the app. If your receiver was down for an hour, those events are gone.',
              'Never build a system of record on webhooks from this platform. They are suitable for notifications and for triggering non-critical automation. Anything that must not be missed has to be reconciled by polling the API instead.',
              'Events only fire from workflow rules. A webhook subscription on its own delivers nothing - something has to send it. The only thing that does is a workflow rule on Interview & Automation whose action is "fire webhook". If your subscription never fires, check that a matching rule exists before you suspect the subscription.',
              'Webhook payloads carry candidate data. Treat a webhook endpoint with the same care as a database credential - whoever controls that URL receives personal data continuously, and you have no record of what was sent.',
            ],
            faqs: [
              {
                q: 'The Webhook Delivery Failed notification toggle is on but I never get an email.',
                a: 'That toggle is stored but not wired to anything today. There is no failure alerting for webhooks. The Test button and the deployment logs are your only visibility.',
              },
              {
                q: 'Test succeeds but real events never arrive.',
                a: 'Almost always the Event Types list. It is free text with exact-string matching, so a plural, a dot instead of an underscore, or a stray space produces a subscription that never matches anything.',
              },
            ],
          },
        ],
      },
      {
        id: 'int-sso',
        title: 'Single sign-on',
        summary:
          'Optional Google OAuth sign-in alongside password login. Entirely a deployment configuration - there is no screen for it, and no way to tell from inside the app whether it is enabled other than whether the button appears on the login page.',
        subsections: [
          {
            id: 'int-sso-config',
            title: 'How it works and what it needs',
            body: [
              'The flow is the standard redirect dance: the user starts at your login page, is sent to the identity provider, comes back to the app\'s /sso-callback route, and the app exchanges what it was given for a normal platform session token. From that point the session is identical to a password login - same token, same expiry, same role lookup.',
              'A single-use anti-forgery value is issued at the start of the flow and consumed on return. It expires in ten minutes, which is why an SSO attempt left open on a lunch break fails with a state error rather than logging the person in.',
            ],
            controls: [
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
                how: 'The retry exists specifically so that a transient failure cannot leave an admin signed in with no role. If it exhausts its attempts it signs the user out and shows "Signed in, but we could not load your account details. Please try signing in again."',
              },
              {
                name: 'Just-in-time account creation',
                what: 'A user signing in through SSO with an email the platform has never seen gets an account created automatically, always with the Recruiter role and always active.',
                how: 'SSO can therefore never mint an admin. Promote a new arrival on Users & Roles after their first sign-in - their account will not exist until then, so you cannot pre-assign a role.',
              },
              {
                name: 'The integration status flag',
                what: 'The Company Profile integration view reports SSO as configured based on the client id alone.',
                how: 'So it can read as configured while the flow still fails, if the secret or the redirect URI is missing. Treat a green flag here as necessary but not sufficient - test the actual button.',
              },
            ],
            warnings: [
              'The session token is passed back to the browser in the URL query string. It therefore lands in browser history, and in the access logs of anything between the user and your app. This is a real consideration for a security review: a token copied out of a history entry works until it expires, and tokens cannot be revoked individually.',
              'The password policy does not apply to an SSO login. Password rules are irrelevant to it by definition, and the failed-login lockout counter is only maintained on the password path. If you rely on lockout as a control, SSO is a separate door with no lockout on it.',
              'An account deactivated in the platform is refused at SSO with 403 "Account is deactivated", and an identity provider account whose email is not verified is refused with 403. Those are the only two account-state checks in the SSO path.',
              '"Invalid or expired state - possible CSRF, retry login" means the single-use anti-forgery value was missing or already consumed. In practice it is a stale browser tab, a double-submitted callback, or the user pressing Back - not an attack. Have them start again from the login page.',
            ],
          },
        ],
      },
      {
        id: 'int-models',
        title: 'AI model providers',
        summary:
          'The model list in the AI Model dropdown is fixed in the platform; which entries actually work depends on which provider keys the deployment has. Selecting a model whose provider is unconfigured is allowed, and fails later.',
        subsections: [
          {
            id: 'int-models-config',
            title: 'Keys and consequences',
            body: [
              'The dropdown always offers the same nine models: six OpenAI entries (GPT-4o, GPT-4o Mini, GPT-4.1, GPT-4.1 Mini, GPT-4 Turbo, GPT-4.5 Preview) and three Anthropic ones (Claude Opus 5, Claude Sonnet 5, Claude Haiku 4.5). The list is fixed in the platform and does not shrink when a provider key is missing.',
              'The default is GPT-4o. Their estimated per-million-token costs span a very wide range - GPT-4o Mini is the cheapest at a small fraction of a dollar, GPT-4.5 Preview is roughly five hundred times more expensive on output. Choosing from this list without looking at the spend card afterwards is how a bill gets away from you.',
            ],
            controls: [
              {
                name: 'OpenAI key',
                what: 'Effectively mandatory. Without it, resume parsing, job-description parsing, embeddings and matching, interview question generation and evaluation, and the voice interview\'s speech synthesis and transcription all stop working. None of those have an alternate provider.',
                how: 'Even if you select a Claude model for the chat work, embeddings and voice still require the OpenAI key. Treat its absence as a total outage rather than a degraded mode.',
              },
              {
                name: 'Anthropic key',
                what: 'Optional. Enables the three Claude entries in the dropdown, and the AI code-quality review on coding assessments.',
                how: 'Without it the code review is skipped rather than failed - the coding assessment still returns correctness results, just no quality commentary. Any Claude model chosen in the dropdown will fail at first use.',
              },
              {
                name: 'Vector index key',
                what: 'Enables similarity matching between resumes and job descriptions.',
                how: 'Without it, matching stops while everything else appears healthy. This is the failure that presents as "we upload resumes and nothing ever matches".',
              },
              {
                name: 'Default model',
                what: 'Stored in the database and changed by the AI Model dropdown. It overrides the deployment\'s configured default from the moment anyone sets it, and applies to every user and every operation that does not carry its own override.',
                how: 'A deployment change to the default model therefore has no effect once anyone has touched the dropdown. To go back to the deployment value you have to select it explicitly.',
              },
              {
                name: 'Per-operation model override',
                what: 'Two places pass a model explicitly rather than using the platform default: creating a job description, and uploading resumes. Both take it from the model stored in your own browser.',
                how: 'That stored value can drift from the platform default - a Recruiter whose write to the default was refused keeps a stale local value and will silently create job descriptions with a different model than everyone else. If parsing quality differs between two people doing the same thing, this is why.',
              },
            ],
            warnings: [
              'AI failures are silent. When a model call fails - a missing key, a rate limit, an invalid model - the platform logs it and returns an empty result rather than an error. The practical symptom is a resume or job description that parses into nothing, or an interview evaluation that comes back blank. Nothing on screen says "the AI call failed".',
              'Embedding failures are silent in a worse way: a failed embedding returns a zero vector, which is a valid-looking value that matches nothing. Resumes appear to process successfully and then never match any job description.',
              'There is no failover between providers. If the selected model\'s provider is unreachable, every AI operation degrades to empty output until you change the model or fix the key.',
              'The model dropdown offers models your deployment cannot necessarily use, with no "unavailable" marker. After any switch, upload one resume and confirm it parses into a populated record before you walk away.',
            ],
          },
        ],
      },
      {
        id: 'int-prompts',
        title: 'AI prompt configuration',
        path: '/dashboard/settings?tab=prompts',
        access: 'HR Admin & Super Admin - reads included',
        summary:
          'Four of the platform\'s AI prompts can be overridden from the app. This is the highest-leverage and highest-risk configuration surface in the product: a good prompt change improves every parse and every evaluation from that moment on, and a bad one degrades all of them silently. Unusually, even reading this screen requires admin - the prompts are treated as sensitive.',
        subsections: [
          {
            id: 'int-prompts-keys',
            title: 'What is configurable',
            controls: [
              {
                name: 'JD Parsing',
                what: 'Turns a raw job-description document into the structured record the rest of the product uses - title, skills, seniority, domain. Placeholders available to it: the job description text, and the industry list.',
                how: 'Change this only with a strong reason. Every job description you ever import or create runs through it, and a bad parse produces a job that never matches anything.',
              },
              {
                name: 'Interview Question Generation',
                what: 'Produces the question set for a candidate\'s interview. Placeholders: job title, difficulty, seniority, the job description, the required skills, the topic list, the candidate\'s resume, and the number of questions.',
                how: 'The most reasonable one to tune, because its output is directly reviewable - generate one interview and read the questions.',
              },
              {
                name: 'Interview Evaluation',
                what: 'Grades a completed interview transcript. Placeholders: job title, the transcript, and the integrity flags raised during the session.',
                how: 'Changing this changes how every subsequent candidate is scored, which makes historical comparisons invalid. Note the date you changed it.',
              },
              {
                name: 'Coding Assessment - Code Quality Review',
                what: 'The AI commentary alongside the pass/fail correctness results on a coding submission. Placeholders: the question title and description, the language, the submitted code, and the passed and total test counts.',
                how: 'This one requires the Anthropic key. Without it the review is skipped entirely and your prompt is never used.',
              },
              {
                name: 'The default, shown alongside your override',
                what: 'Each prompt shows both what is currently in effect and the built-in default, plus whether it has been customised.',
                how: 'Read the default before you replace it. It is the fastest way to see which placeholders the platform expects to substitute.',
              },
              {
                name: 'Reset to default',
                what: 'Deletes your override so the built-in prompt takes over again. Both fields must be filled to save an override in the first place - a blank one is rejected.',
                how: 'Your first move whenever AI output quality drops unexpectedly. Reset, confirm the behaviour returns, then re-introduce your change in smaller pieces.',
              },
            ],
            warnings: [
              'Prompt placeholders here use single-brace syntax, unlike the double-brace syntax in email templates. Getting them confused breaks the prompt.',
              'A broken placeholder does not fail loudly. When an override cannot be rendered, the platform falls back to the built-in default for that one call and carries on. The symptom is intermittent-looking inconsistency - some operations behaving as configured and others not - rather than a clean error.',
              'Every save and reset is written to the audit log, as prompt_template_update and prompt_template_reset. That is your only history - the screen does not keep previous versions.',
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
                what: 'Runs candidate-submitted code for the AI coding assessment. Candidate code is never executed by the platform itself - it is always delegated to this service.',
                how: 'Unconfigured, the coding assessment reports "not configured" and cannot grade correctness. The static plagiarism check runs regardless - it is pure text comparison with no external service and no AI cost.',
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
                what: 'Imports job postings from external boards. Two sources are free and need no key; the rest need a provider key each and report as "not configured" without one.',
                how: 'Enabled sources are re-synced on a recurring schedule. In a serverless deployment that sync is driven by an external scheduler calling the platform, so if imports have quietly stopped, check that the scheduler is still firing before you suspect the sources.',
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
      'An ordered checklist for standing up a fresh organization, from first sign-in to first candidate. The order matters - several steps depend on earlier ones, and creating your org structure before your users is the difference between a smooth rollout and a morning of re-work.',
    sections: [
      {
        id: 'runbook-steps',
        title: 'The ordered checklist',
        summary:
          'Fifteen steps, each naming the exact screen. Expect ninety minutes for the configuration and rather longer if you are also writing email copy and prompts. Do not skip step 1 or step 15.',
        subsections: [
          {
            id: 'runbook-before',
            title: 'Before you start - confirm the deployment is sane',
            steps: [
              'Sign in with the seeded Super Admin account. If the service refuses to start at all, the usual cause is that its signing secret or its default Super Admin password is still the shipped placeholder - the platform deliberately refuses to boot in that state.',
              'Change the seeded Super Admin password immediately, from your own profile screen. The shipped default is public knowledge.',
              'Open Organization → Company Profile and read the integration status view. Note which integrations report as configured. If email is not among them, stop and get it configured before going further - steps 6 and 13 depend on it.',
            ],
            warnings: [
              'Do not proceed past this point with the seeded password still in place. Everything else you configure sits behind that one credential.',
            ],
          },
          {
            id: 'runbook-main',
            title: 'The build-out',
            steps: [
              '1. Organization → Company Profile. Fill in the company details. These appear on candidate-facing pages and in outbound email, so get them right before anything is sent.',
              '2. Organization → Departments & Designations. Create your department structure and job titles first, because job descriptions and user records both reference them and you cannot pick one that does not exist yet.',
              '3. Users & Roles → Users tab → + Add User. Create your second Super Admin. Do this before anything else touches access control, so a lockout can never leave the platform without an operator. Give it a real person\'s address, not a shared mailbox.',
              '4. Users & Roles → Users tab. Create your HR Admins, then your Recruiters. Assign each a role in the Role dropdown - it is the only place a role is set.',
              '5. Users & Roles → Roles & Permissions. Only if you need a custom role. Read the custom-role warnings in the RBAC chapter first; for most organizations the three built-in roles are the right answer and this step is skipped.',
              '7. Organization → Branding & Notifications. Apply your logo and colours, and choose which internal events email your admins.',
              '8. Platform Settings → System. Confirm the AI model. Remember this is the platform default for everyone - pick deliberately, and check the provider key for it exists.',
              '9. Platform Settings → Email Templates. Review and edit every outbound template. The defaults are functional, not on-brand, and candidates see them.',
              '10. Platform Settings → AI Prompts. Read the four prompts and their built-in defaults. Leave them alone unless you have a specific reason - a bad prompt degrades parsing quality across every resume and every interview from that point on, and it does so quietly.',
              '11. Platform Settings → Webhooks. Only if you are pushing events elsewhere. Create the subscription, press Test, and then create the matching workflow rule on Interview & Automation - a subscription with no rule behind it never fires. Copy the event name between the two rather than typing it twice; the Event Types field is unvalidated free text.',
              '12. Interview & Automation → Scenarios, then Workflow Rules, then Coding Questions. Scenarios and coding questions are content you will keep adding to; workflow rules are the automation that acts on pipeline events, so configure them after you know what your pipeline looks like.',
              '14. Hirely.ai → + Create New JD. Create your first job description. Give it a realistic deadline - it is what makes the job expire, and an expired job stops matching new resumes.',
              '15. Hirely.ai → Upload Resumes. Upload a small batch, five or ten files, not five hundred. Then go to Activity → Resumes and open the batch summary.',
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
                how: 'A gap means parsing failures - check the Failed files list at the bottom of the modal for the per-file reason.',
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
                how: 'All zero after uploading relevant resumes against a live job description means matching is broken - check the vector index and confirm the job description actually parsed.',
              },
              {
                name: 'Auto-invited',
                kind: 'badge',
                what: 'Candidates whose match score cleared the auto-invite threshold and who were emailed automatically.',
                how: 'A non-zero value here on a test upload means real invitations went to real addresses. Use obviously fake test resumes on a first run.',
              },
              {
                name: 'OpenAI cost (this batch)',
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
              'Send yourself one interview invitation and click the link in the email. This proves email transport and the public frontend URL together.',
            ],
            warnings: [
              'Step 15 is a live upload. Anything above the auto-invite threshold will email a real invitation to whatever address is on the resume. Use synthetic resumes with addresses you control for the first run.',
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
          'The audit log is the third tab on Users & Roles. It records mutating actions with the actor, the action, the resource and a details payload. It is not comprehensive - it covers the security-relevant surfaces rather than every write in the product - so knowing what it does and does not contain is essential before you rely on it in an investigation.',
        subsections: [
          {
            id: 'ops-audit-what',
            title: 'What is recorded',
            body: [
              'Entries are written for user creation, update and deletion; department and designation creation, update and deletion; custom role creation, update and deletion; and role assignment to a user.',
              'Entries are written best-effort and never block the action that triggered them. That means a failed audit write is silent - an action can succeed with no log entry if the database hiccuped at that moment. Absence of an entry is weak evidence.',
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
                how: 'The names worth knowing: user_create, user_update, user_delete, user_role_assign, role_create, role_update, role_delete, department_create, department_update, department_delete, designation_create, designation_delete. Typing "delete" finds every deletion across every resource type.',
              },
              {
                name: 'Resource Type',
                kind: 'filter',
                what: 'Exact match, chosen from a dropdown of the types present. First option is "All resources".',
                how: 'Use "user" for account changes, "role" for permission changes, and "department" or "designation" for org-structure changes.',
              },
              {
                name: 'From / To',
                kind: 'filter',
                what: 'Date bounds on when the action happened. The To date includes the whole of that day.',
              },
              {
                name: 'Apply',
                kind: 'button',
                what: 'Runs the query with the current filter values and resets to page 1. Nothing is fetched until you press it - the filter boxes are a draft.',
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
              'It does not cover recruiting actions. Creating or deleting a job description, uploading or purging resumes, advancing a candidate, sending an offer - none of those are audited. The resume purge in particular, the most destructive action in the product, leaves no audit entry at all.',
              'Entries are not editable or deletable through the product, which is the point - but they are also not signed, so anyone with database access can alter them.',
            ],
            faqs: [
              {
                q: '"Could not load the audit log. The endpoint may not be available yet."',
                a: 'The request failed. Either your role lost the audit-read permission through a custom role override, or the API is unreachable. Check whether other admin screens load.',
              },
              {
                q: 'Who purged those resumes?',
                a: 'The audit log will not tell you - the purge is not audited. Your remaining evidence is who held Super Admin at the time, on the Users tab.',
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
                what: 'Your input was rejected before anything was written. On password fields it is the policy check; on an import it is a shape violation; on a role assignment it is an unknown role name; on user deletion it is "Cannot delete yourself".',
                how: 'Always accompanied by a specific message. Read it - it names the exact rule that failed.',
              },
              {
                name: '401 Unauthorized',
                what: 'Your session is invalid, expired, or belongs to a user who has been deleted or deactivated. The app clears the session and sends you to /login the moment it sees one.',
                how: 'If it happens immediately after signing in, suspect a clock skew between the browser and the server, or an account that was deactivated between the login and the next call.',
              },
              {
                name: '403 Forbidden - "Admin access required"',
                what: 'A Recruiter hit an admin-only endpoint. Normally invisible, because the interface hides those screens.',
                how: 'Seeing this in the interface means the browser\'s cached role is stale - the user was demoted while signed in. Have them sign out and back in.',
              },
              {
                name: '403 Forbidden - "Superadmin access required"',
                what: 'One of the six Super-Admin-only endpoints refused you. Same cause: a stale cached role, or genuinely not being Super Admin.',
              },
              {
                name: '403 Forbidden - "Only a Super Admin can change a user\'s role"',
                what: 'An HR Admin tried to write the role field on a user. Expected and correct.',
              },
              {
                name: '403 Forbidden - "Missing required permission: {name}"',
                what: 'A permission-gated endpoint refused you. Only the RBAC and audit-log endpoints produce this.',
                how: 'If a Super Admin sees this, someone has created a custom role document overriding a built-in role and dropped a permission from it. Check the Roles & Permissions tab for a custom role sharing a built-in name.',
              },
              {
                name: '403 Forbidden - "Account disabled"',
                what: 'Correct password, but the account\'s Active toggle is off. Turn it back on from Users & Roles → Edit.',
              },
              {
                name: '409 Conflict',
                what: 'A role with that name already exists. Role names are unique.',
              },
              {
                name: '410 Gone',
                what: 'A candidate-facing link - interview, offer, coding assessment - is spent or expired. Invite links expire seven days after issue by default; interview links are single-use.',
                how: 'The fix is to resend the invitation, which mints a fresh link.',
              },
              {
                name: '413 Payload Too Large',
                what: 'An upload exceeded the platform limit. Most often an interview answer recording.',
              },
              {
                name: '423 Locked',
                what: 'Account lockout. Either the attempt that tripped it or a subsequent attempt while the lock runs. Wait out the duration you configured - there is no unlock control.',
              },
              {
                name: '429 Too Many Requests',
                what: 'The request rate limiter. Ten login attempts per email or thirty per source IP inside five minutes; a separate, tighter limit on OTP verification.',
                how: 'Distinct from lockout, and not configurable from any screen. A whole office behind one IP can trip the IP limit collectively.',
              },
              {
                name: '503 Service Unavailable - "Database unavailable"',
                what: 'The API is running but cannot reach the database. Every screen that reads or writes will fail together.',
                how: 'This is the one code that means "not your fault, not a configuration problem". If a single screen shows it and others are fine, look again - it is almost certainly on more than one.',
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
              'Open Activity → Resumes and click into the most recent batch. The Failed count and the Failed files list at the bottom give you the per-file error message, which is usually the whole answer.',
              'Check Uploaded against Processed. If Uploaded is lower than the number of files chosen, some were rejected before processing - the modal notes how many temp or invalid files were ignored, which catches the common case of editor lock files being swept up by a folder selection.',
              'If every file failed with an AI-related error, the model or its provider key is the problem. Check the AI Model dropdown and confirm the selected model\'s provider is configured.',
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
              'Confirm the job description actually parsed. An unparsed job description is skipped by matching entirely - it will never gather candidates no matter how many relevant resumes you upload.',
              'Check the deadline. A job description past its deadline stops matching new resumes, and if auto-delete is on it will have been deleted rather than merely closed.',
              'Open the batch summary and read Resumes per Job Description. If one job description swallowed everything, the job descriptions are too similar to each other or the thresholds are too loose.',
              'If scores changed suddenly across the board, look for a model change. The AI Model dropdown is platform-wide and leaves no confirmation, so a colleague may have changed it without realising.',
              'Run Re-match once after any deliberate model or threshold change, so existing pipelines are rebuilt against the new configuration. Do not run it speculatively - it charges the whole resume pool.',
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
  tagline: 'The complete system guide - every screen, plus the platform controls only you hold.',
  intro: [
    'You hold the highest role in the platform. Everything a Recruiter and an HR Admin can do, you can do - so this guide contains their guides in full, followed by the material that is yours alone.',
    'Start with "Powers only you have" if you are new to the role. It is a single index of the capabilities gated to Super Admin, and it is the fastest way to understand what you are responsible for that nobody else can cover.',
    'One habit will save you more trouble than anything else in this guide: keep a second Super Admin account, held by a different person, so that a lockout or a mistaken role change is an inconvenience rather than an outage.',
    'One structural warning worth carrying into every chapter: the permission matrix governs less than its name suggests. Most of the product is gated on the role string - Super Admin, HR Admin, Recruiter - rather than on permissions, so editing the matrix meaningfully changes access control and audit visibility, and very little else. The RBAC chapter sets out exactly where the line falls.',
  ],
  chapters: [...coreChapters, ...adminChapters, ...superAdminChapters],
}

export default superAdminGuide
