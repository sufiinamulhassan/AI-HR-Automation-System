import type { GuideChapter, RoleGuide } from '../types'
import { coreChapters } from './recruiterGuide'


const orientationChapter: GuideChapter = {
  id: 'admin-orientation',
  title: 'Administration - orientation',
  blurb: 'What an admin account adds to the app, where those screens live, and which of them you can only read.',
  sections: [
    {
      id: 'admin-nav',
      title: 'The Admin Settings group',
      path: '/dashboard',
      summary:
        'An admin account keeps every screen a Recruiter has and adds a collapsible "Admin Settings" group at the bottom of the sidebar. Five entries live there for an HR Admin. They are configuration surfaces: they change how the product behaves for everyone else, so most of what you do here has no undo beyond editing it back.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'finding-the-group',
          title: 'Finding the admin screens',
          body: [
            'The sidebar has two blocks. The top block - Dashboard, Recruiting, Activity - is the same for every signed-in user. Below a divider sits a single "Admin Settings" row with a chevron; the four admin destinations are hidden inside it until you expand it.',
            'The group expands itself automatically whenever you navigate onto an admin route, including by pasting a direct link, so an admin page is never active while its nav entry is hidden. Once open it stays open until you collapse it by hand.',
          ],
          controls: [
            {
              name: 'Admin Settings',
              kind: 'button',
              what: 'Expands or collapses the admin sub-navigation. It also highlights as active whenever the current route is one of the admin pages.',
              how: 'Purely a display toggle - collapsing it does not remove your access. If you arrive on an admin page by link, it opens on its own.',
            },
            {
              name: 'Users & Roles',
              kind: 'link',
              what: 'Opens /dashboard/users - user accounts, the role/permission matrix, and the platform audit log, as three tabs.',
              how: 'The tab you can act on most as a plain HR Admin is Audit Log; the user list and the matrix are partly Super-Admin-gated. See the chapter below.',
            },
            {
              name: 'Platform Settings',
              kind: 'link',
              what: 'Opens /dashboard/settings - the default AI model and health readout, email templates, AI prompt overrides, and outbound webhooks, as four tabs.',
            },
            {
              name: 'Organization',
              kind: 'link',
              what: 'Opens /dashboard/organization - company profile and integration status, branding and notification settings, and the department/designation structure, as three tabs.',
            },
            {
              name: 'Interview & Automation',
              kind: 'link',
              what: 'Opens /dashboard/interview-automation - scenario interview prompts, workflow automation rules, the coding question bank, and coding submissions, as four tabs.',
            },
            {
              name: 'HR Admin Portal',
              kind: 'badge',
              what: 'The line under the Hirely.ai logo in the sidebar. It reads "HR Admin Portal" for role admin, "Super Admin Portal" for superadmin and "Recruiter Portal" for standard.',
              how: 'The quickest way to confirm which role your session is actually running as. The role chip beside your name in the sidebar footer says the same thing.',
            },
          ],
          tips: [
            'Every admin page is reachable by URL. Bookmark the exact tab you use daily - the tab is part of the query string.',
          ],
        },
        {
          id: 'admin-vs-superadmin',
          title: 'HR Admin vs Super Admin - where the line falls',
          body: [
            'Both roles get through the same route guard (AdminRoute lets in admin and superadmin alike), so an HR Admin can open all five pages. The difference is enforced inside the pages and by the backend, per action.',
            'Rather than hiding half-usable screens, the product lets you in and degrades: a control you cannot use is disabled, hidden, or answers with a permission error. The table below is the complete list of what a plain HR Admin cannot do on an otherwise-admin page.',
          ],
          controls: [
            {
              name: 'List all users',
              kind: 'button',
              what: 'GET /auth/users is Super-Admin-only. For a plain HR Admin it answers 403 and the Users tab shows a notice instead of the table.',
              how: 'You can still create users and reset passwords - you just cannot browse the roster.',
              access: 'Super Admin only',
            },
            {
              name: 'Delete a user',
              kind: 'button',
              what: 'The red Delete button in the user row is rendered only for a Super Admin.',
              access: 'Super Admin only',
            },
            {
              name: 'Assign a role',
              kind: 'field',
              what: 'Every role write goes through PATCH /rbac/users/{email}/role, which needs the rbac:manage permission - held by superadmin only.',
              how: 'The Role dropdown is still visible and editable in the user modal, but the save will be rejected. See the Users tab section for exactly what happens to the rest of the form.',
              access: 'Super Admin only',
            },
            {
              name: 'Create / edit / delete a custom role',
              kind: 'button',
              what: 'The role modal and the matrix checkboxes are wired to Super-Admin-gated endpoints; the page also short-circuits these handlers when the signed-in user is not a superadmin.',
              access: 'Super Admin only',
            },
            {
              name: 'Read the permission matrix',
              kind: 'tab',
              what: 'Allowed. An HR Admin holds rbac:read, so the whole matrix - built-in defaults and custom roles - renders normally.',
            },
            {
              name: 'Read the audit log',
              kind: 'tab',
              what: 'Allowed. An HR Admin holds audit:read, so filtering and paging the log works fully.',
            },
          ],
          faqs: [
            {
              q: 'I clicked an admin link and landed back on the dashboard.',
              a: 'AdminRoute sends any non-admin to /dashboard, silently - there is no access-denied screen anywhere in the product. Check the role on your own account under Users & Roles.',
            },
            {
              q: 'A save came back with a permission error but part of my change stuck.',
              a: 'Some forms write to two endpoints. The user edit modal is the one to watch: profile fields save first, the role second. If the role write is refused the toast reports it, the modal stays open, but the name/active/OTP change is already applied.',
            },
          ],
        },
        {
          id: 'admin-page-conventions',
          title: 'Conventions shared by every admin page',
          body: [
            'The five admin screens are merged pages: what used to be fourteen separate sidebar entries is now five pages with tabs. They all behave the same way, so learning one teaches you the rest.',
          ],
          controls: [
            {
              name: 'Tabs',
              kind: 'tab',
              what: 'The active tab is stored in the URL as ?tab=…, and the first tab of each page is the bare URL with no query at all.',
              how: 'Link colleagues straight to a tab. Note that tab switches use history replacement, so the browser Back button leaves the page entirely rather than stepping back through tabs.',
            },
            {
              name: 'Tab counts',
              kind: 'badge',
              what: 'The small number beside a tab label is the live row count for that tab (users, custom roles, audit entries, scenarios, rules, questions, campaigns, mentorship pairings).',
              how: 'A missing count means that tab has not loaded its data yet - the count appears the first time you open it.',
            },
            {
              name: 'Toast',
              kind: 'badge',
              what: 'A short message in the corner confirming a write or reporting the server error text. It clears itself after about 3 seconds (3.5 on Organization).',
              how: 'The toast is the only place the API error is shown on most of these pages. If a save appears to do nothing, look for the toast before retrying.',
            },
            {
              name: 'Header action button',
              kind: 'button',
              what: 'The primary button at the top-right belongs to the active tab and changes with it - for example + Add User on Users, + New Role on Roles & Permissions, and Refresh on Audit Log.',
            },
            {
              name: 'Confirm dialogs',
              kind: 'button',
              what: 'Deletes and sends use the browser native confirm() dialog, quoting the exact record name.',
              how: 'Read the dialog text - for a department delete and a campaign send it is the only place the real consequence is spelled out.',
            },
          ],
          tips: [
            'Data loads per tab, not per page. Opening Organization does not fetch departments until you open the Departments tab; Interview & Automation is the exception, loading its three configuration tabs together so the counts are honest from the first paint.',
          ],
        },
      ],
    },
  ],
}


const usersRolesChapter: GuideChapter = {
  id: 'users-roles',
  title: 'Users, Roles & Audit',
  blurb: 'One page, three tabs: who has an account, what each role may do, and the record of every change anyone made.',
  sections: [
    {
      id: 'users-tab',
      title: 'Users tab',
      path: '/dashboard/users',
      summary:
        'Create accounts, edit profiles, force OTP, reset passwords and (as a Super Admin) delete users. This is also the only place in the product where a person\'s role is assigned - the permission matrix on the next tab decides what a role means, never who holds it.',
      access: 'HR Admin & Super Admin - the user list itself is Super Admin only',
      subsections: [
        {
          id: 'users-blocked-notice',
          title: 'If you see "requires Super Admin access"',
          body: [
            'The user table is populated by GET /auth/users, which is Super-Admin-only. For a plain HR Admin that call answers 403 and the card renders this instead: "Listing all users requires Super Admin access. Use the + Add User button above to create new users."',
            'That is the intended behaviour, not an outage. Creating a user, editing one you know the email of, and resetting a password all still work - you simply cannot enumerate the roster. The Users tab also drops its count badge and the "N of M users" line while blocked.',
          ],
          faqs: [
            {
              q: 'The notice is showing but I am a Super Admin.',
              a: 'Then the request failed for another reason (backend down, expired session). Any 401 signs you out automatically, so if you are still on the page it was not an auth expiry - check the backend health readout on Platform Settings → System.',
            },
          ],
        },
        {
          id: 'users-overview-controls',
          title: 'Stat cards, search and the table',
          body: [
            'Four stat cards summarise the roster, then a search box filters it client-side. Everything here is computed from the already-loaded list, so it is instant and it works offline of the server.',
          ],
          controls: [
            { name: 'Total Users', kind: 'badge', what: 'Count of every account returned by the list call.' },
            { name: 'Super Admins', kind: 'badge', what: 'How many of those accounts hold role superadmin.' },
            { name: 'HR Admins', kind: 'badge', what: 'How many hold role admin.' },
            { name: 'Active', kind: 'badge', what: 'How many have is_active true. Inactive accounts still exist and still count in Total Users.' },
            {
              name: 'Search by name, email or role…',
              kind: 'filter',
              what: 'Case-insensitive substring match across the name, email and role of each loaded user. No request is made.',
              how: 'Searching for a role matches the raw value (admin, superadmin, standard, or a custom role name) - not the display label, so "HR Admin" finds nothing but "admin" finds both admins and superadmins.',
            },
            { name: 'N of M users', kind: 'badge', what: 'How many rows survive the search, out of the loaded total. Hidden while loading or while the list is blocked.' },
            { name: 'User', kind: 'column', what: 'Avatar initial, full name and email. The avatar is colour-coded by role - a distinct colour marks a custom role.' },
            { name: 'Role', kind: 'column', what: 'The role badge. Built-in roles show their friendly label (Super Admin / HR Admin / Recruiter); a custom role shows its raw role_name.' },
            { name: 'Status', kind: 'column', what: 'Active (green) or Inactive (red), from is_active. An inactive account cannot sign in.' },
            { name: 'OTP', kind: 'column', what: 'On (blue) or Off (grey) - whether that user must enter a one-time code after their password.' },
            { name: 'Last Login', kind: 'column', what: 'Date of last successful sign-in, formatted day/month/year, or a dash if the user has never signed in.' },
            { name: 'Actions', kind: 'column', what: 'Edit, Reset PW, and - for a Super Admin only - Delete.' },
          ],
        },
        {
          id: 'create-user',
          title: 'Create a user',
          steps: [
            'Click + Add User in the page header.',
            'Enter Email * - this is the account identifier and cannot be changed afterwards (the field is not even shown on the edit modal).',
            'Enter Full Name *.',
            'Pick a Role. The dropdown lists Recruiter, HR Admin, Super Admin (hidden unless you are a Super Admin) and every custom role by its raw name.',
            'Enter a Password *. The placeholder states the minimum: 8 characters.',
            'Tick Require OTP on login if this person must enter a one-time code as well as their password.',
            'Click Create User. On success the modal closes, a "User created" toast appears and the list reloads.',
          ],
          controls: [
            { name: '+ Add User', kind: 'button', what: 'Opens the Create New User modal with an empty form defaulting to the Recruiter role and OTP off.' },
            { name: 'Email *', kind: 'field', what: 'The login identifier. Sent as the email on POST /auth/users.', how: 'Immutable once created. Getting it wrong means deleting the account (Super Admin) and starting again.' },
            { name: 'Full Name *', kind: 'field', what: 'Display name shown in the table, the sidebar and audit entries.' },
            {
              name: 'Role',
              kind: 'field',
              what: 'Which role the new account holds. Built-in roles are sent straight to the create endpoint; a custom role is applied as a second call.',
              how: 'POST /auth/users only accepts the three built-in role literals, so choosing a custom role creates the user as Recruiter first and then issues a role assignment. That second call is Super-Admin-gated - see the warning below.',
            },
            { name: 'Password *', kind: 'field', what: 'The initial password, set directly - no invitation email is sent and the user is not forced to change it.', how: 'Minimum 8 characters. Send it to the person over a channel you trust; there is no self-serve first-login flow.' },
            { name: 'Require OTP on login', kind: 'toggle', what: 'Sets otp_required. When on, sign-in stops after the password and asks for a one-time code.' },
            { name: 'Create User', kind: 'button', what: 'Submits the form. Shows "Saving…" while in flight.' },
            { name: 'Cancel', kind: 'button', what: 'Closes the modal, discarding the form. Clicking the dark overlay does the same.' },
          ],
          warnings: [
            'Choosing a custom role as a plain HR Admin half-succeeds: the account is created as a Recruiter, then the role assignment is refused, the error toast appears and the modal stays open. Do not click Create User again - that would try to create a duplicate. Close the modal and ask a Super Admin to set the role.',
            'There is no "invite" flow. Whatever you type into Password * is the user\'s live password from that moment.',
          ],
        },
        {
          id: 'edit-user',
          title: 'Edit a user, change a role, deactivate an account',
          steps: [
            'Click Edit on the user\'s row. The modal is titled "Edit - <name>".',
            'Adjust Full Name, Role, Active account and Require OTP on login as needed. Email is deliberately absent.',
            'Click Save Changes.',
          ],
          body: [
            'Profile fields and the role deliberately travel to different endpoints. The name/active/OTP trio goes to PATCH /auth/users/{email}; the role - built-in or custom - goes to PATCH /rbac/users/{email}/role, the only endpoint that validates a role name and records the change as a role assignment in the audit log. The role is never sent to the profile endpoint.',
            'The role call is only made when the value actually changed, so saving an unchanged Role costs nothing and is not audited.',
          ],
          controls: [
            { name: 'Edit', kind: 'button', what: 'Opens the edit modal pre-filled from the row.' },
            { name: 'Full Name *', kind: 'field', what: 'Updates the display name via the profile endpoint.' },
            {
              name: 'Role',
              kind: 'field',
              what: 'Reassigns the user. Writes through the RBAC endpoint so the change is validated and audited.',
              how: 'The field hint in the modal says it plainly: this is the only place a role is assigned. Permissions per role are edited on the Roles & Permissions tab, reachable from the hint link.',
              access: 'Super Admin only (the endpoint needs rbac:manage)',
            },
            { name: 'Active account', kind: 'toggle', what: 'Clearing it sets is_active false, which blocks sign-in without deleting the account or its history.', how: 'This is the safe alternative to deleting a leaver - audit entries keep pointing at a real user record.' },
            { name: 'Require OTP on login', kind: 'toggle', what: 'Turns the one-time-code step on or off for that user.' },
            { name: 'Save Changes', kind: 'button', what: 'Writes the profile, then the role if it changed. Success closes the modal, toasts "User updated" and reloads the list.' },
          ],
          warnings: [
            'If the role write is rejected (a plain HR Admin, or an invalid custom role name), the profile change has already been committed. The modal stays open and the toast carries the server\'s reason - do not assume nothing happened.',
          ],
        },
        {
          id: 'reset-password',
          title: 'Reset someone\'s password',
          steps: [
            'Click Reset PW on the user\'s row.',
            'Type the new password into New Password.',
            'Click Reset Password.',
          ],
          controls: [
            { name: 'Reset PW', kind: 'button', what: 'Opens the "Reset Password - <name>" modal for that account.' },
            { name: 'New Password', kind: 'field', what: 'The replacement password, applied immediately via POST /auth/admin/reset-password.' },
            { name: 'Reset Password', kind: 'button', what: 'Submits. Disabled while the field is empty or the request is in flight.' },
          ],
          warnings: [
            'The user is not emailed and is not prompted to change it at next sign-in. You must deliver the new password yourself.',
            'The reset does not reload the list and does not change any other field - the modal simply closes with a "Password reset successfully" toast.',
          ],
        },
        {
          id: 'delete-user',
          title: 'Delete a user',
          body: [
            'The Delete button only renders for a Super Admin. It asks "Delete user <email>? This cannot be undone." and then calls DELETE /auth/users/{email}.',
          ],
          controls: [
            { name: 'Delete', kind: 'button', what: 'Permanently removes the account.', access: 'Super Admin only' },
          ],
          warnings: [
            'Deleting is irreversible and removes the account outright. Prefer clearing Active account on the edit modal for someone who has left - it blocks sign-in while keeping the record that audit entries refer to.',
          ],
        },
      ],
    },
    {
      id: 'roles-tab',
      title: 'Roles & Permissions tab',
      path: '/dashboard/users?tab=roles',
      summary:
        'The permission matrix: every permission the backend knows about, down the left, against every role across the top. Built-in role columns are fixed and read-only for everyone. Custom role columns are editable - by a Super Admin only, saving the moment a box is ticked.',
      access: 'Readable by HR Admin & Super Admin; editable by Super Admin only',
      subsections: [
        {
          id: 'reading-the-matrix',
          title: 'Reading the matrix',
          body: [
            'Permissions are flat "resource:action" strings. The part before the colon becomes the category heading (a grey band across the table), and the part after becomes the readable row label; the raw key is printed underneath it in small type so you can match it to an API error.',
            'Columns are, in order: the three built-in roles - Super Admin, HR Admin, Recruiter - then one column per custom role. A padlock on a built-in column means "permissions are fixed"; those checkboxes are always disabled.',
            'One subtlety: a custom role document may be created with the same name as a built-in role, in which case it overrides that role\'s defaults. Such a document is shown inside the built-in column it overrides, not as an extra column, so the matrix always reflects what the backend will actually resolve.',
          ],
          controls: [
            { name: 'Permission Matrix', kind: 'column', what: 'Card title. The line under it reports "N permissions · M categories · K custom roles" - a quick sanity check that the catalog loaded.' },
            {
              name: 'Filter permissions…',
              kind: 'filter',
              what: 'Narrows the matrix to permission keys or category names containing what you type. Client-side only.',
              how: 'Type a category word ("coding", "offers") to see a whole feature area, or an action ("delete", "manage") to compare one verb across every resource.',
            },
            { name: 'Clear filter', kind: 'button', what: 'Appears in the empty state when nothing matches; resets the filter box.' },
            { name: 'Permission', kind: 'column', what: 'Left-hand column: the readable action name, with the exact permission key beneath it.' },
            { name: 'Super Admin / HR Admin / Recruiter', kind: 'column', what: 'The three built-in role columns, showing the backend\'s built_in_defaults. Always read-only, marked with a padlock.' },
            { name: 'Custom role column', kind: 'column', what: 'One per custom role, headed by the role name (hover for its description) with edit and delete icons.' },
            { name: 'Checkbox cell', kind: 'toggle', what: 'For a custom role, ticking or clearing it grants or revokes that permission and saves immediately - there is no Save button.', access: 'Super Admin only' },
            { name: '+ Add a custom role', kind: 'button', what: 'Stands in for the custom-role column when none exist yet; opens the New Role modal.' },
            { name: 'Users', kind: 'link', what: 'In the hint bar - jumps to the Users tab, where roles are actually assigned to people.' },
            { name: 'Audit Log', kind: 'link', what: 'In the hint bar - jumps to the Audit Log tab, where every change made here is recorded.' },
          ],
          tips: [
            'This tab answers "what can this role do", never "who has this role". For the latter, use the Users tab.',
          ],
        },
        {
          id: 'permission-catalog',
          title: 'What the categories cover',
          body: [
            'The category headings are friendly names for the permission-key prefix. Knowing the mapping makes an API 403 self-explanatory - the error names the key, the matrix shows you which roles hold it.',
            'jobs → Jobs. resumes → Resumes. intel → Bulk Resume Ingestion. candidates → Candidates. interview → Interview. coding → AI Coding Assessment. scenarios → Scenario Interviews. offers → Offer Management. analytics → HR Analytics. workflows → Workflow Automation. webhooks → Outbound Webhooks. departments → Departments. designations → Designations. users → User Management. rbac → Roles & Permissions. audit → Audit Log.',
            'Any prefix the frontend does not have a label for is title-cased and shown as-is, so a new backend permission area appears in the matrix without a frontend change.',
          ],
          tips: [
            'The two rows that explain most of this page\'s own behaviour are rbac:read (HR Admin has it - that is why you can see the matrix) and rbac:manage (Super Admin only - that is why you cannot edit it).',
          ],
        },
        {
          id: 'create-custom-role',
          title: 'Create a custom role',
          steps: [
            'Click + New Role in the page header (or + Add a custom role in the matrix when there are none yet).',
            'Enter a Name * - use a lowercase snake_case identifier such as hiring_manager; this is the literal role value stored on user records.',
            'Optionally add a Description; it appears as the tooltip on the column header.',
            'Click Create. The role is created with zero permissions.',
            'Find its new column in the matrix and tick the permissions it should have. Each tick saves on its own.',
          ],
          controls: [
            { name: '+ New Role', kind: 'button', what: 'Opens the New Role modal.', access: 'Super Admin only' },
            { name: 'Name *', kind: 'field', what: 'The role identifier. Required, and permanently fixed at creation.', how: 'The modal states it outright: a role cannot be renamed after creation - the backend has no rename. Choose carefully.' },
            { name: 'Description', kind: 'field', what: 'Optional free text, shown as the column tooltip.' },
            { name: 'Create', kind: 'button', what: 'Creates the role with an empty permission list.' },
            { name: 'Save Changes', kind: 'button', what: 'On the edit modal, updates the description only. The Name field is disabled there.' },
          ],
          tips: [
            'A brand-new custom role can do nothing at all until you tick permissions. Assigning it to a person before that effectively locks them out of every feature.',
          ],
        },
        {
          id: 'edit-delete-role',
          title: 'Edit or delete a custom role',
          body: [
            'The pencil icon on a custom role column opens the edit modal - description only, since names are immutable. The trash icon deletes the role after confirming "Delete custom role “X”? Users with this role will need to be reassigned."',
            'Permission toggles are optimistic: the checkbox flips instantly and the cell is disabled while the write is in flight. If the server refuses, the checkbox snaps back to its previous state and the error appears as a toast - so a box that visibly reverts means the save failed.',
          ],
          controls: [
            { name: 'Edit description', kind: 'button', what: 'Pencil icon on the column header - opens the edit modal.', access: 'Super Admin only' },
            { name: 'Delete role', kind: 'button', what: 'Trash icon on the column header - deletes the custom role after a confirm.', access: 'Super Admin only' },
          ],
          warnings: [
            'Deleting a custom role does not reassign the people who hold it. Move them to another role on the Users tab first, or they are left holding a role that no longer resolves to any permissions.',
            'There is no undo on a permission toggle and no draft state - each tick is a live write to the role document.',
          ],
        },
      ],
    },
    {
      id: 'audit-tab',
      title: 'Audit Log tab',
      path: '/dashboard/users?tab=audit',
      summary:
        'The append-only record of every mutating action across the platform: who did it, what they did, to which resource, and when. It sits on this page because it is the record of what the other two tabs did - every role create, update, delete and assignment writes an entry here.',
      access: 'HR Admin & Super Admin (admin holds audit:read)',
      subsections: [
        {
          id: 'audit-filters',
          title: 'Filtering the log',
          body: [
            'Five filter inputs sit above the table. Nothing is applied while you type - the filters are drafts until you press Apply, which also resets you to page 1. This is deliberate: the log is server-side paginated, so each change would otherwise be a fresh query.',
            'The Actor Email and Action boxes are free text with suggestion lists attached. The suggestions are fetched once per visit from the values actually present in the log, so they never offer a value that would return nothing - but you are not restricted to them, and a partial value such as "role_" still filters.',
          ],
          steps: [
            'Set any combination of Actor Email, Action, Resource Type, From and To.',
            'Click Apply. The table reloads from page 1 with those filters.',
            'Click Clear to drop every filter and go back to the full log. Clear only appears once filters are actually applied.',
          ],
          controls: [
            {
              name: 'Actor Email',
              kind: 'filter',
              what: 'Restricts entries to one person\'s actions. Free text with a suggestion list of actors seen in the log.',
              how: 'This is the "what did this admin do" filter. Combine with a date range when investigating a specific change.',
            },
            {
              name: 'Action',
              kind: 'filter',
              what: 'Restricts to one action name, e.g. role_update. Free text with a suggestion list of actions present in the log.',
              how: 'Use the suggestions to learn the vocabulary - the exact action strings come from the backend, not from a fixed frontend list.',
            },
            {
              name: 'Resource Type',
              kind: 'filter',
              what: 'A dropdown built from the resource types the log actually contains, plus "All resources". A value carried in from a link that is no longer in the list stays selectable rather than silently resetting.',
            },
            { name: 'From', kind: 'filter', what: 'Start of the date range, sent as start_date. Inclusive.' },
            { name: 'To', kind: 'filter', what: 'End of the date range, sent as end_date.' },
            { name: 'Apply', kind: 'button', what: 'Commits the draft filters, resets to page 1 and re-queries the log.' },
            { name: 'Clear', kind: 'button', what: 'Empties every filter and re-queries. Only rendered while at least one filter is applied.' },
            { name: '↻ Refresh', kind: 'button', what: 'The header action on this tab - re-reads the current page with the current filters. Reads "Refreshing…" while in flight.', how: 'The log is written by everything else in the platform, so re-reading is the only useful action here. Use it after performing an action in another tab to see the entry appear.' },
          ],
          tips: [
            'The log loads lazily. Opening /dashboard/users never queries it - it is only fetched when you open this tab, which is also when the tab\'s count badge first appears.',
          ],
        },
        {
          id: 'audit-table',
          title: 'Reading an entry',
          controls: [
            { name: 'Date/Time', kind: 'column', what: 'When the action was recorded, in day/month/year local format. Falls back to the raw string if the timestamp cannot be parsed.' },
            { name: 'Actor', kind: 'column', what: 'The email of whoever performed the action, or a dash when the entry has no actor recorded.' },
            { name: 'Action', kind: 'column', what: 'The action name as a blue badge, e.g. role_update, role_assign.' },
            { name: 'Resource Type', kind: 'column', what: 'What kind of thing was changed - the same vocabulary as the Resource Type filter.' },
            { name: 'Resource ID', kind: 'column', what: 'The identifier of the specific record touched. Paste it into the corresponding filter elsewhere in the product to find the record.' },
            { name: 'Details', kind: 'column', what: 'Whatever context the call site recorded, flattened to "key: value · key: value" pairs - for a role change, typically old_role and new_role. Truncated in the cell; hover for the full text.' },
          ],
          faqs: [
            {
              q: 'The table says "No audit entries match these filters."',
              a: 'The query succeeded and returned nothing. Widen the date range or clear the Action box - free-text Action values are matched exactly by the backend, so a typo returns an empty page rather than an error.',
            },
            {
              q: 'It says "Could not load the audit log. The endpoint may not be available yet."',
              a: 'The request itself failed. The tab count disappears in this state too. Check backend health on Platform Settings → System; if the backend is up, your account may not hold audit:read.',
            },
          ],
        },
        {
          id: 'audit-paging',
          title: 'Paging',
          body: [
            'The log is paged 25 entries at a time. Pagination controls appear only when there is more than one page, and the tab\'s count badge shows the total number of entries matching the current filters.',
          ],
          controls: [
            { name: '← Prev', kind: 'button', what: 'Previous page. Disabled on page 1.' },
            { name: 'Page X of Y', kind: 'badge', what: 'Current position. Y is the total matching entries divided by the 25-per-page limit.' },
            { name: 'Next →', kind: 'button', what: 'Next page. Disabled on the last page.' },
          ],
          tips: [
            'Applying or clearing a filter always jumps back to page 1, so you cannot end up stranded past the end of a narrower result set.',
          ],
        },
      ],
    },
  ],
}


const platformSettingsChapter: GuideChapter = {
  id: 'platform-settings',
  title: 'Platform Settings',
  blurb: 'How the platform behaves: which AI model runs by default, what candidates receive by email, what the AI is told to do, and who gets notified over HTTP.',
  sections: [
    {
      id: 'settings-system',
      title: 'System tab',
      path: '/dashboard/settings',
      summary:
        'Three read-outs and one decision. The read-outs are platform volume, backend health and environment; the decision is which large language model the whole platform uses by default.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'platform-overview',
          title: 'Platform Overview',
          body: [
            'Three tiles, fetched independently so one call failing does not blank the others. A tile shows an ellipsis while loading and 0 if its call failed.',
          ],
          controls: [
            { name: 'Processed Resumes', kind: 'badge', what: 'Total resumes ingested, from the bulk resume ingestion stats endpoint.' },
            { name: 'Job Descriptions', kind: 'badge', what: 'Total job descriptions, from the jobs stats endpoint.' },
            { name: 'Candidates Hired', kind: 'badge', what: 'Total hires, read from the invite funnel on the same ingestion stats call as Processed Resumes.' },
          ],
        },
        {
          id: 'ai-model-config',
          title: 'Choosing the default AI model',
          body: [
            'The card lists every model the backend offers as a clickable card, grouped visually by provider (an OpenAI, an Anthropic and a generic icon). Clicking one sets it as the platform default immediately - there is no separate save.',
            'This is the model used when nothing else is specified: resume parsing and scoring, job description parsing, interview question generation and evaluation, coding question generation and code-quality review. Individual users can still override it for their own session with the model selector in the sidebar footer; this setting is the fallback everyone starts from.',
          ],
          steps: [
            'Open Platform Settings - the System tab is the default, so no query string is needed.',
            'Find the card for the model you want under Default LLM Model.',
            'Click it. A "Default model updated" toast confirms the write; a failure toasts "Failed to update model".',
          ],
          controls: [
            { name: 'Default LLM Model', kind: 'column', what: 'Card title. The blue badge beside it names the provider of the currently active model.' },
            { name: 'Model card', kind: 'button', what: 'Each card shows the model label, its raw id and its provider. Clicking it calls PATCH /auth/models/default.', how: 'Every card is disabled while a change is saving, so a double click cannot race two writes.' },
            { name: '✓ Active', kind: 'badge', what: 'Marks the card that is currently the platform default.' },
            { name: 'No models available. Check backend connection.', kind: 'badge', what: 'Shown instead of the grid when the model list came back empty - almost always a backend connectivity problem rather than a configuration one.' },
          ],
          warnings: [
            'The selection is applied to the local store before the request completes, so the highlight moves even if the save then fails. If you see "Failed to update model", reload the page to see the real server-side default.',
          ],
          tips: [
            'Changing the default model changes AI output quality and cost for every feature at once. If a scoring or question-generation behaviour changed unexpectedly, this is the first setting to check.',
          ],
        },
        {
          id: 'environment',
          title: 'Environment and health',
          controls: [
            { name: 'Backend Status', kind: 'badge', what: 'Live result of the /health probe: "✓ Online" in green, "✗ Offline" in red, or an ellipsis while checking.', how: 'This is the fastest triage step when any admin page shows empty tables - the pages swallow network errors silently, this readout does not.' },
            { name: 'Active Modules', kind: 'badge', what: 'The module names the backend reports as enabled. Only rendered when the health response includes them.' },
            { name: 'API Base URL', kind: 'badge', what: 'The origin this build sends API calls to. Deployed, the API shares the site origin and this shows that origin; set VITE_API_BASE_URL only when the API lives on a different host.' },
            { name: 'API Version', kind: 'badge', what: 'The API namespace in use: v1.' },
            { name: 'Platform Version', kind: 'badge', what: 'The product version this build reports: v3.0.' },
            { name: 'Current Model', kind: 'badge', what: 'The active model id, echoing the selection above.' },
          ],
        },
      ],
    },
    {
      id: 'settings-email',
      title: 'Email Templates tab',
      path: '/dashboard/settings?tab=email',
      summary:
        'Override the subject and body of the system emails the platform sends. Each template maps to one send function on the backend; leaving a field blank keeps that field\'s built-in default, so you can customise only the subject and inherit the body.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'email-list',
          title: 'The template list',
          controls: [
            { name: 'Template', kind: 'column', what: 'The friendly name and a one-line description of when that email is sent.' },
            { name: 'Audience', kind: 'column', what: 'Candidate-facing (amber) or Internal (grey). Candidate-facing means the mail is delivered to an applicant, not to a colleague.' },
            { name: 'Status', kind: 'column', what: 'Customized (blue) when an override exists, Default (grey) when the built-in text is in use.' },
            { name: 'Edit', kind: 'button', what: 'Opens the editor for that template.' },
            { name: 'Reset to Default', kind: 'button', what: 'Deletes your override so the built-in text is used again. Only rendered on rows that are actually customised.' },
          ],
          tips: [
            'Scan the Status column first. Anything showing Customized is text your organisation wrote and owns - it will not pick up product improvements to that email.',
          ],
        },
        {
          id: 'edit-email-template',
          title: 'Edit a template',
          steps: [
            'Click Edit on the template row.',
            'Read the red warning if the template is candidate-facing.',
            'Check the "Available placeholders for this template" chips - these are the double-brace tokens the send function will substitute.',
            'Fill in Subject, HTML Body and Plain-text Body. Leave any of the three blank to keep the built-in default for that field.',
            'Click Save Template.',
          ],
          controls: [
            { name: 'Available placeholders for this template', kind: 'badge', what: 'The token list, shown as {{name}} chips. Only these are substituted; anything else is sent literally.' },
            { name: 'Subject', kind: 'field', what: 'Overrides the subject line. Placeholder text spells out the fallback: leave blank to use the built-in default subject.' },
            { name: 'HTML Body', kind: 'field', what: 'Overrides the HTML part of the message.' },
            { name: 'Plain-text Body', kind: 'field', what: 'Overrides the plain-text part, which is what a text-only mail client shows.', how: 'If you customise the HTML body, customise this too - otherwise the two versions of the same email say different things.' },
            { name: 'Save Template', kind: 'button', what: 'Saves the non-blank fields as your override via PUT /email-templates/{key}.' },
            { name: 'Reset to Default', kind: 'button', what: 'Also present in the modal footer for a customised template. Confirms, then deletes the whole override.' },
            { name: 'Cancel', kind: 'button', what: 'Closes without saving.' },
          ],
          warnings: [
            'A candidate-facing template must never contain interview scores, evaluation results, recommendations or report content. The editor shows a fixed red warning above every candidate-facing template for exactly this reason: candidates may only ever receive a link and plain instructions. Scores and reports are admin-only and are never emailed to candidates regardless of what is typed here.',
            'Reset to Default deletes your customised subject and body outright - there is no version history. Copy the text somewhere before resetting if you may want it back.',
          ],
          faqs: [
            {
              q: 'What actually changes downstream when I edit a template?',
              a: 'Each template key corresponds to one send function on the backend. Editing the interview-invite template changes the mail candidates receive when they are invited; editing the coding-assessment template changes the assessment invite, and so on. The send is otherwise unchanged - same trigger, same recipient, different words.',
            },
            {
              q: 'I cleared a field and saved, but the old override is still there.',
              a: 'Blank means "use the built-in default for this field", and blank fields are simply not sent. To remove customisation entirely, use Reset to Default.',
            },
          ],
        },
      ],
    },
    {
      id: 'settings-prompts',
      title: 'AI Prompts tab',
      path: '/dashboard/settings?tab=prompts',
      summary:
        'The system and user prompts behind job-description parsing and interview question generation and evaluation, editable without a code deploy. This is the highest-leverage and highest-risk screen in the admin area: a bad prompt silently degrades parsing and scoring for everyone.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'prompt-list',
          title: 'The prompt list',
          body: [
            'The panel\'s own guidance is worth repeating: leave a prompt at its default unless you have a specific reason to change it.',
          ],
          controls: [
            { name: 'Prompt', kind: 'column', what: 'The friendly name and a description of what that prompt is used for.' },
            { name: 'Key', kind: 'column', what: 'The raw prompt key, shown as code. This is what the backend logs refer to.' },
            { name: 'Status', kind: 'column', what: 'Customized (blue) or Default (grey).' },
            { name: 'Last Updated', kind: 'column', what: 'When the override was last saved and by whom. A dash for prompts still on their default.' },
            { name: 'Edit', kind: 'button', what: 'Opens the prompt editor.' },
            { name: 'Reset to Default', kind: 'button', what: 'Deletes the override. Disabled for prompts that are not customised; reads "Resetting…" while in flight.' },
          ],
        },
        {
          id: 'edit-prompt',
          title: 'Edit a prompt safely',
          steps: [
            'Click Edit on the row. The modal is titled "Edit - <label>".',
            'Read the required-placeholder pills at the top. Every one of them must appear in your User Prompt Template, exactly as written including the curly braces.',
            'Click "Show built-in default (read-only)" and copy the default as your starting point rather than writing from scratch.',
            'Edit the System Prompt (the role/behaviour instruction) and the User Prompt Template (the per-request payload).',
            'Confirm no pill is highlighted as missing, then click Save Override.',
          ],
          controls: [
            { name: 'Required placeholders', kind: 'badge', what: 'Pills listing the tokens the template must contain. A missing one is highlighted, and a red "Missing: {x}, {y}" line spells out which.' },
            { name: 'System Prompt', kind: 'field', what: 'The standing instruction sent as the system message - tone, role, output shape. Cannot be saved empty.' },
            { name: 'User Prompt Template', kind: 'field', what: 'The per-request message, with placeholders substituted at run time. Cannot be saved empty.' },
            { name: 'Show built-in default (read-only)', kind: 'button', what: 'Reveals the shipped default system prompt and user template, side by side and non-editable. The label flips to "Hide built-in default".', how: 'Use it as a reference and as a diff: if your override is misbehaving, compare it against the default before resetting.' },
            { name: 'Save Override', kind: 'button', what: 'Writes your version via PATCH /prompt-config/{key}. Disabled while either textarea is empty.' },
            { name: 'Cancel', kind: 'button', what: 'Closes without saving.' },
          ],
          warnings: [
            'A User Prompt Template missing any required placeholder still saves - and then silently falls back to the built-in default at run time. Nothing will look broken; the AI simply will not be using your text. Always clear every missing-placeholder warning before saving.',
            'Reset to Default asks for confirmation ("This deletes your customization") and then discards your override permanently.',
          ],
          faqs: [
            {
              q: 'What does editing a prompt actually change?',
              a: 'The prompts here drive job-description parsing (how a pasted or imported JD becomes structured requirements) and interview question generation and evaluation. Change them and every subsequent parse, generated question set and evaluation uses your wording - existing records are not reprocessed.',
            },
            {
              q: 'My change had no effect at all.',
              a: 'Nine times out of ten a required placeholder is missing, so the backend fell back to the default. Reopen the editor and look for the red Missing line.',
            },
          ],
        },
      ],
    },
    {
      id: 'settings-webhooks',
      title: 'Webhooks tab',
      path: '/dashboard/settings?tab=webhooks',
      summary:
        'Outbound HTTP subscriptions. When a pipeline event occurs, every active subscription listening for that event type receives a POST. This is also the delivery mechanism behind the fire_webhook workflow action.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'webhook-list',
          title: 'The subscriptions table',
          controls: [
            { name: '+ Add Webhook', kind: 'button', what: 'Opens the Add Webhook modal.' },
            { name: 'URL', kind: 'column', what: 'The endpoint that receives the POST.' },
            { name: 'Event Types', kind: 'column', what: 'The event names this subscription listens for, shown as chips.' },
            { name: 'Format', kind: 'column', what: 'RAW, SLACK or TEAMS - how the payload is shaped before sending.' },
            { name: 'Status', kind: 'column', what: 'Active (green) or Inactive (grey). Inactive subscriptions are kept but never fired.' },
            { name: 'Test', kind: 'button', what: 'Sends a test delivery to that URL right now and reports Success or Failed as a badge beside the buttons.', how: 'The result badge clears itself after 5 seconds. Test after every create or URL edit - a typo in the URL is otherwise invisible until a real event is dropped.' },
            { name: 'Edit', kind: 'button', what: 'Opens the modal pre-filled, with the extra Active checkbox.' },
            { name: 'Delete', kind: 'button', what: 'Removes the subscription after confirming "Delete webhook for “<url>”?".' },
          ],
        },
        {
          id: 'add-webhook',
          title: 'Add or edit a webhook',
          steps: [
            'Click + Add Webhook.',
            'Paste the receiving URL into URL *.',
            'List the events in Event Types * as a comma-separated string, e.g. candidate_invited, interview_completed.',
            'Choose a Format. Raw sends the JSON payload; Slack and Teams wrap it as a short human-readable summary line for those products\' incoming webhook / connector formats.',
            'Click Create. Then click Test on the new row to confirm the endpoint answers.',
          ],
          controls: [
            { name: 'URL *', kind: 'field', what: 'The destination. Required - the save button stays disabled until it and Event Types are both non-empty.' },
            { name: 'Event Types *', kind: 'field', what: 'Comma-separated event names. Whitespace around each name is trimmed and empty entries are dropped, so trailing commas are harmless.', how: 'Names must match what the backend emits. Use the trigger vocabulary from Interview & Automation → Workflow Rules as your reference point for pipeline events.' },
            { name: 'Format', kind: 'field', what: 'Raw (default JSON payload), Slack (incoming webhook) or Teams (channel connector).', how: 'Pick Slack or Teams when the URL is a chat incoming-webhook - the raw payload would render as an unreadable blob there.' },
            { name: 'Active', kind: 'toggle', what: 'Only on the edit modal. Clearing it stops deliveries without deleting the subscription and losing its configuration.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the subscription. Disabled while URL or Event Types is blank.' },
          ],
          warnings: [
            'Deleting a webhook is immediate and cannot be undone; the URL and event list are gone. If you only want to stop deliveries temporarily, edit it and clear Active instead.',
          ],
          faqs: [
            {
              q: 'A workflow rule with the fire_webhook action does nothing.',
              a: 'That action posts the trigger context to every matching webhook subscription. If no active subscription lists the relevant event type, the action completes with nowhere to send. Check this tab first.',
            },
            {
              q: 'Test says Failed.',
              a: 'The delivery attempt itself failed - bad URL, unreachable host, or the receiver returned an error. Nothing is retried automatically, so fix the URL and test again.',
            },
          ],
        },
      ],
    },
  ],
}


const organizationChapter: GuideChapter = {
  id: 'organization',
  title: 'Organization',
  blurb: 'Who this company is, what it looks like, and how it is structured - company profile, integration status, branding, notifications, departments and designations.',
  sections: [
    {
      id: 'org-company',
      title: 'Company Profile tab',
      path: '/dashboard/organization',
      summary:
        'Your organisation\'s identity details, plus a read-only board showing which external services and job boards have credentials configured.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'company-profile-form',
          title: 'Editing the company profile',
          steps: [
            'Open Organization - the Company Profile tab is the default.',
            'Fill in the fields you need. Nothing here is required, and blanks are saved as blanks.',
            'Click Save Changes. The form re-renders from the server\'s response, and a "Company settings saved" toast confirms it.',
          ],
          controls: [
            { name: 'Company Name', kind: 'field', what: 'The organisation name used across the product.' },
            { name: 'Industry', kind: 'field', what: 'Free-text industry description, e.g. Software & Technology.' },
            { name: 'Company Size', kind: 'field', what: 'Free text, e.g. 51-200 employees. Not validated or parsed.' },
            { name: 'Website', kind: 'field', what: 'Your public site URL.' },
            { name: 'Primary Contact Email', kind: 'field', what: 'The HR contact address for the organisation. Typed as an email input, so the browser flags an obviously malformed value.' },
            { name: 'Address', kind: 'field', what: 'Single-line postal address; spans the full width of the form.' },
            { name: 'Save Changes', kind: 'button', what: 'PATCHes the six fields together. Reads "Saving…" while in flight.' },
            { name: 'Last saved', kind: 'badge', what: 'Timestamp of the previous successful save, shown next to the button once the record has an updated_at.' },
          ],
        },
        {
          id: 'integrations-status',
          title: 'Integrations Status',
          body: [
            'A read-only board in two groups: Core Services (the AI providers, mail and storage the platform depends on) and Job Board Sources (the external boards Hirely.ai can import jobs from).',
            'Each row is either Configured or Not Configured. That reflects only whether a key is present on the backend - actual secret values are never shown here and are never transmitted to the browser. There is nothing to edit on this card; credentials are environment configuration, set outside the app.',
          ],
          controls: [
            { name: 'Read-only', kind: 'badge', what: 'Marks the whole card as informational. There is no edit path for these values in the UI.' },
            { name: 'Core Services', kind: 'column', what: 'Group heading for the platform\'s own dependencies.' },
            { name: 'Job Board Sources', kind: 'column', what: 'Group heading for external job feeds available to the job import feature.' },
            { name: 'Free', kind: 'badge', what: 'Marks a job source that needs no API key. Those sources are usable immediately.' },
            { name: 'Configured', kind: 'badge', what: 'Green - a credential is present for that service.' },
            { name: 'Not Configured', kind: 'badge', what: 'Grey - no credential. Features depending on that service will not work until it is set on the backend.' },
          ],
          tips: [
            'If a job import returns nothing from a particular board, check its row here before assuming the search terms were wrong.',
          ],
        },
      ],
    },
    {
      id: 'org-branding',
      title: 'Branding & Notifications tab',
      path: '/dashboard/organization?tab=branding',
      summary:
        'White-label the app with your logo and two brand colours, and choose which internal events should notify an admin mailbox.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'branding-form',
          title: 'Branding / White-Labeling',
          steps: [
            'Paste a publicly reachable image URL into Company Logo URL, or leave it blank to keep the default Hirely.ai mark.',
            'Set Primary Color and Accent Color, either with the colour swatch or by typing a hex code.',
            'Check the Live Preview panel - it re-renders as you type, showing the logo, a primary button and an accent badge.',
            'Click Save Branding.',
          ],
          controls: [
            { name: 'Company Logo URL', kind: 'field', what: 'An absolute image URL used as the product logo. Blank keeps the built-in Hirely.ai mark.', how: 'The preview hides the image if it fails to load - a logo that vanishes from the preview will not render for your users either. It must be reachable without authentication.' },
            { name: 'Primary Color', kind: 'field', what: 'The main brand colour. Two inputs that stay in sync: a native colour swatch and a hex text box. Default #4778f3.' },
            { name: 'Accent Color', kind: 'field', what: 'The secondary brand colour. Default #222022.' },
            { name: 'Live Preview', kind: 'badge', what: 'A miniature card showing your logo (or an "HR" placeholder tinted with the primary colour), a Primary Button and an Accent Badge.' },
            { name: 'Reset to Defaults', kind: 'button', what: 'Puts the form back to the shipped defaults - blank logo, #4778f3, #222022.', how: 'This only changes the form. Nothing is saved until you also click Save Branding, so you can back out by switching tabs instead.' },
            { name: 'Save Branding', kind: 'button', what: 'Validates the colours and PATCHes all three values.' },
            { name: 'Last saved', kind: 'badge', what: 'Timestamp of the previous successful branding save.' },
          ],
          warnings: [
            'Both colours must be 6-digit hex codes including the leading hash, e.g. #4778f3. A 3-digit shorthand or a named colour is rejected client-side with the toast "Colors must be valid 6-digit hex codes, e.g. #4778f3" and nothing is sent.',
            'Branding is applied at page load. The success toast says so - "reload other open tabs to see it applied there too". Colleagues with the app already open keep the old palette until they refresh.',
          ],
        },
        {
          id: 'notification-settings',
          title: 'Notification Settings',
          body: [
            'A single destination mailbox plus a checkbox per internal event. The event list comes from the backend, so it grows without a frontend change; each row carries its own label and description.',
            'Be aware of the honest caveat printed at the bottom of the card: saving these settings does not yet send any emails. Wiring delivery into each event (offer declines, integrity flags, failed imports and so on) is a follow-up. Treat this as recording your intent, not as switching alerts on.',
          ],
          controls: [
            { name: 'Notify Email', kind: 'field', what: 'The internal mailbox these event notifications would be sent to. Not a candidate-facing address.' },
            { name: 'Event checkbox', kind: 'toggle', what: 'One per event, with the event\'s label and description. Ticking marks that event as enabled in the saved map.' },
            { name: 'Save Notification Settings', kind: 'button', what: 'Sends the address plus an event → enabled map, then re-renders from the response.' },
            { name: 'Last saved', kind: 'badge', what: 'Timestamp of the previous successful save.' },
          ],
          faqs: [
            {
              q: 'I enabled an event but never received an email.',
              a: 'Expected today - delivery is not wired up yet, as the note on the card states. Use the Webhooks tab of Platform Settings if you need real-time outbound notification now.',
            },
          ],
        },
      ],
    },
    {
      id: 'org-departments',
      title: 'Departments & Designations tab',
      path: '/dashboard/organization?tab=departments',
      summary:
        'The two reference lists that everything else scopes to: departments (used by jobs, users and designations) and designations (job titles, each optionally belonging to a department). Two side-by-side tables, each with its own add button.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'departments-table',
          title: 'Departments',
          body: [
            'The key column here is Used by. The backend returns a reference count per department - designations, jobs and users - and the table renders it as chips such as "2 designations · 1 job". A department nothing points at reads "Not referenced" and is safe to remove.',
          ],
          controls: [
            { name: '+ Add Department', kind: 'button', what: 'Opens the Add Department modal.' },
            { name: 'Name', kind: 'column', what: 'The department name. This string is what designations and jobs refer to.' },
            { name: 'Used by', kind: 'column', what: 'Reference-count chips per category, or "Not referenced". This is the pre-flight check for a delete.' },
            { name: 'Edit', kind: 'button', what: 'Opens the department modal pre-filled.' },
            { name: 'Delete', kind: 'button', what: 'Attempts to delete after a confirm. See the forced-delete flow below.' },
            { name: 'Name *', kind: 'field', what: 'In the modal - required. When editing a department that has designations, a hint states how many will be re-pointed by a rename.' },
            { name: 'Description', kind: 'field', what: 'Optional free text.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the department. Disabled while Name is blank.' },
          ],
          warnings: [
            'Renaming a department cascades. Designations link to a department by name, so the backend re-points them and the toast reports how many: "Department updated - 2 designations re-pointed". Records that reference the old name in other ways are not part of that cascade.',
          ],
        },
        {
          id: 'delete-department',
          title: 'Deleting a department that is still in use',
          body: [
            'A delete of a referenced department is refused by the backend with a 409, and the error names the exact counts. The page does not report a flat failure - it shows you the server\'s explanation and offers to force it.',
          ],
          steps: [
            'Click Delete and confirm the first dialog ("Delete department “X”?").',
            'If the department is unreferenced it is deleted and you are done.',
            'If it is still referenced, a second dialog appears carrying the server\'s exact message - for example "Department “Engineering” is still referenced by 2 designations, 1 jobs." - followed by "Delete it anyway? Designations naming it will be detached."',
            'Confirm to force the delete, or cancel to keep the department. Forcing reports how many designations were detached.',
          ],
          warnings: [
            'A forced delete detaches every designation that named the department - they survive, but with no department. Jobs and users that referenced it are left pointing at a name that no longer exists.',
            'Only a 409 offers the forced path. Any other failure (503, permission, network) is reported as a plain error toast with no second chance - that is deliberate, so a transient outage is never escalated into a force.',
          ],
          tips: [
            'The Used by chips can be stale if someone else has been editing. The 409 message is computed at delete time and is the authority - read it rather than the table.',
          ],
        },
        {
          id: 'designations-table',
          title: 'Designations',
          body: [
            'Job titles. Each may optionally belong to one department, chosen from the departments that exist right now.',
          ],
          controls: [
            { name: '+ Add Designation', kind: 'button', what: 'Opens the Add Designation modal.' },
            { name: 'Name', kind: 'column', what: 'The job title, e.g. Senior Software Engineer.' },
            { name: 'Department', kind: 'column', what: 'The department this title sits in, or a dash when unattached.' },
            { name: 'Edit', kind: 'button', what: 'Opens the designation modal pre-filled.' },
            { name: 'Delete', kind: 'button', what: 'Deletes after a single confirm - there is no reference check and no forced-delete step for designations.' },
            { name: 'Name *', kind: 'field', what: 'Required. The title text.' },
            { name: 'Department', kind: 'field', what: 'A dropdown of existing departments plus "- None -". Stored by department name, which is why a department rename has to cascade.' },
            { name: 'Description', kind: 'field', what: 'Optional free text.' },
          ],
          warnings: [
            'Unlike departments, deleting a designation is not blocked by anything that references it. Confirm carefully.',
          ],
        },
      ],
    },
  ],
}


const interviewAutomationChapter: GuideChapter = {
  id: 'interview-automation',
  title: 'Interview & Automation',
  blurb: 'Scenario interview prompts, event-driven workflow rules, the coding question bank, and the review surface for candidate code.',
  sections: [
    {
      id: 'ia-scenarios',
      title: 'Scenarios tab',
      path: '/dashboard/interview-automation',
      summary:
        'Scenario-based interview prompts. Each scenario is a situation the AI interviewer presents to a candidate, plus the dimensions the answer is scored on. Optionally scoped to a job domain so the right scenarios surface for the right roles.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'scenarios-table',
          title: 'The scenario list',
          controls: [
            { name: '+ Add Scenario', kind: 'button', what: 'Opens the Add Scenario modal.' },
            { name: 'Name', kind: 'column', what: 'The scenario title, used to identify it when assigning.' },
            { name: 'Job Domain', kind: 'column', what: 'The domain this scenario is scoped to, or a dash for an unscoped (generally applicable) one.' },
            { name: 'Evaluation Dimensions', kind: 'column', what: 'Chips for each dimension the answer is scored against.' },
            { name: 'Status', kind: 'column', what: 'Active (green) or Inactive (grey). Inactive scenarios are kept but not used.' },
            { name: 'Edit', kind: 'button', what: 'Opens the modal pre-filled, with the extra Active checkbox.' },
            { name: 'Delete', kind: 'button', what: 'Deletes after confirming "Delete scenario “X”?".' },
          ],
        },
        {
          id: 'create-scenario',
          title: 'Author a scenario',
          steps: [
            'Click + Add Scenario.',
            'Give it a Name * - something recognisable in a list, e.g. System Design Deep Dive.',
            'Write the Prompt * - the situation the interviewer should present to the candidate. This is the text the AI works from, so be specific about the setup and what a good answer would address.',
            'Optionally set a Job Domain, e.g. software_engineering, to scope it.',
            'Tick the Evaluation Dimensions that matter for this scenario. All five are ticked by default.',
            'Click Create.',
          ],
          controls: [
            { name: 'Name *', kind: 'field', what: 'Required title.' },
            { name: 'Prompt *', kind: 'field', what: 'Required. The scenario description handed to the AI interviewer.', how: 'This is the single field that determines interview quality. Write it as an instruction to an interviewer, not as a question to the candidate.' },
            { name: 'Job Domain', kind: 'field', what: 'Optional free-text domain key used to scope the scenario. Use the same snake_case convention as elsewhere (software_engineering).' },
            { name: 'Technical', kind: 'toggle', what: 'Evaluation dimension - depth of technical reasoning.' },
            { name: 'Problem Solving', kind: 'toggle', what: 'Evaluation dimension - how the candidate decomposes and attacks the problem.' },
            { name: 'Communication', kind: 'toggle', what: 'Evaluation dimension - clarity of explanation.' },
            { name: 'Decision Making', kind: 'toggle', what: 'Evaluation dimension - quality of the trade-offs chosen.' },
            { name: 'Confidence', kind: 'toggle', what: 'Evaluation dimension - assurance and ownership in the answer.' },
            { name: 'Active', kind: 'toggle', what: 'Only on the edit modal. Clearing it retires the scenario without deleting it.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the scenario. Disabled while Name or Prompt is blank.' },
          ],
          tips: [
            'Deselect dimensions that a scenario cannot really test. Scoring a pure communication exercise on Technical produces a meaningless number that still lands in the report.',
          ],
        },
      ],
    },
    {
      id: 'ia-workflows',
      title: 'Workflow Rules tab',
      path: '/dashboard/interview-automation?tab=workflows',
      summary:
        'If-this-then-that for the recruitment pipeline. A rule fires on a trigger event, checks its conditions against that event\'s context, and runs one action. Rules are the mechanism behind auto-emailing, stage moves, webhook fan-out and offer-approval automation.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'rules-table',
          title: 'The rules list',
          controls: [
            { name: '+ Add Rule', kind: 'button', what: 'Opens the Add Rule modal.' },
            { name: 'Send Pending Reminders Now', kind: 'button', what: 'Runs the reminder sweep immediately instead of waiting for its schedule, and toasts how many were sent ("Reminders sent: N").', how: 'A manual kick, not a rule. Useful for verifying reminder email content after editing the template, and for catching up after a backend outage.' },
            { name: 'Name', kind: 'column', what: 'The rule name.' },
            { name: 'Trigger', kind: 'column', what: 'The raw trigger_type this rule listens for.' },
            { name: 'Action', kind: 'column', what: 'The raw action_type this rule runs.' },
            { name: 'Status', kind: 'column', what: 'Active (green) or Inactive (grey). Inactive rules never fire.' },
            { name: 'Test', kind: 'button', what: 'Opens the rule tester - evaluates the rule\'s conditions against a context you supply, without running the action.' },
            { name: 'Edit', kind: 'button', what: 'Opens the modal pre-filled, with the extra Active checkbox.' },
            { name: 'Delete', kind: 'button', what: 'Deletes after confirming "Delete workflow rule “X”?".' },
          ],
        },
        {
          id: 'triggers',
          title: 'Trigger types - when a rule is evaluated',
          body: [
            'These six are the complete list, and the backend rejects anything else with a 422. Each trigger supplies a context object; the fields available in your conditions are whatever that event carries.',
          ],
          controls: [
            { name: 'resume_processed', kind: 'field', what: 'Fires after a resume has been parsed and scored against a job.', how: 'The natural place for score-threshold automation - for example match_score gte 0.8 then change_pipeline_stage.' },
            { name: 'candidate_invited', kind: 'field', what: 'Fires when a candidate is invited to interview.' },
            { name: 'candidate_status_changed', kind: 'field', what: 'Fires on any pipeline stage change for a candidate.' },
            { name: 'interview_completed', kind: 'field', what: 'Fires once an interview session has finished and been evaluated.' },
            { name: 'offer_created', kind: 'field', what: 'Fires when a new offer record is created. Carries the offer context, including an offer_id.' },
            { name: 'offer_status_changed', kind: 'field', what: 'Fires when an offer moves state (approved, sent, accepted, declined, withdrawn). Carries an offer_id.' },
          ],
        },
        {
          id: 'actions',
          title: 'Action types - what a rule does',
          body: [
            'Six actions, each with its own expectations about action_params. The modal prints a one-line explanation under the picker as you choose.',
          ],
          controls: [
            { name: 'send_email', kind: 'field', what: 'Sends a reminder/follow-up to the candidate - or the offer letter itself, with email_kind set to "offer" in the params.' },
            { name: 'change_pipeline_stage', kind: 'field', what: 'Moves the candidate to the stage named in action_params.stage.', how: 'The stage value must match a real pipeline stage name, or the move is a no-op.' },
            { name: 'fire_webhook', kind: 'field', what: 'Posts the trigger context to every matching webhook subscription configured on Platform Settings → Webhooks.' },
            { name: 'approve_offer', kind: 'field', what: 'Approves the offer in context - only valid while the offer is in draft or pending_approval.', how: 'Pair with the offer_created trigger and a salary condition to auto-approve everything below a threshold.' },
            { name: 'send_offer', kind: 'field', what: 'Emails an approved offer to the candidate.', how: 'Pair with offer_status_changed plus a condition of status eq approved.' },
            { name: 'withdraw_offer', kind: 'field', what: 'Withdraws a non-terminal offer.' },
          ],
          warnings: [
            'The three offer actions need an offer_id, which only offer_created and offer_status_changed provide. Choose an offer action on any other trigger and the modal shows an amber warning - the rule will save (both values are individually valid) and then be skipped every single time, unless you put an explicit offer_id in Action Params. That is the hardest kind of rule bug to notice, which is why it is caught here rather than at save.',
          ],
        },
        {
          id: 'create-rule',
          title: 'Build a rule',
          steps: [
            'Click + Add Rule.',
            'Name * the rule so its purpose is obvious in the list, e.g. "Auto-invite high scorers".',
            'Choose a Trigger Type.',
            'Fill in the Conditions rows. Each row is a field name, an operator and a value; the field must exist in that trigger\'s context. Use + Add Condition for more; rows with an empty field are dropped on save.',
            'Choose an Action Type and read the help line underneath it.',
            'Write the Action Params (JSON) the action needs, e.g. {"stage": "interview"} or {"template": "invite"}. The default is an empty object.',
            'Click Create, then use Test on the new row to prove the conditions match the shape of data you expect.',
          ],
          controls: [
            { name: 'Name *', kind: 'field', what: 'Required rule name.' },
            { name: 'Trigger Type', kind: 'field', what: 'Dropdown of the six trigger events.' },
            { name: 'Conditions', kind: 'field', what: 'Rows of field / operator / value, all of which must hold for the action to run.' },
            { name: 'field', kind: 'field', what: 'The context key to test, e.g. match_score or status. Typed free-hand - nothing validates that the key exists on that trigger.' },
            { name: 'operator', kind: 'field', what: 'One of eq, neq, gte, lte, contains.', how: 'gte/lte are for numbers such as a score or salary; contains is the substring test for text fields.' },
            { name: 'value', kind: 'field', what: 'What to compare against, entered as text.' },
            { name: '+ Add Condition', kind: 'button', what: 'Appends another condition row.' },
            { name: '✕', kind: 'button', what: 'Removes that condition row. Disabled when only one row remains - a rule always has at least one row in the form, though an empty one is discarded on save.' },
            { name: 'Action Type', kind: 'field', what: 'Dropdown of the six actions, with contextual help beneath.' },
            { name: 'Action Params (JSON)', kind: 'field', what: 'A JSON object passed to the action. Validated as you type; an invalid document shows "action_params must be valid JSON" and blocks the save.' },
            { name: 'Active', kind: 'toggle', what: 'Only on the edit modal. Clearing it stops the rule firing without deleting it.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the rule. Disabled while the name is blank or the JSON is invalid.' },
          ],
          tips: [
            'A rule with zero usable conditions matches everything that trigger emits. If you genuinely want that, it is fine - just be sure the action is safe to run on every event.',
          ],
        },
        {
          id: 'test-rule',
          title: 'Test a rule before trusting it',
          body: [
            'The tester evaluates only the conditions. It tells you whether the rule would match a given context - it never runs the action, so testing a send_offer rule sends nothing.',
          ],
          steps: [
            'Click Test on the rule row. The modal is titled "Test Rule - <name>".',
            'Paste a sample context object into Context (JSON), e.g. {"match_score": 0.82}.',
            'Click Run Test.',
            'Read the result: "Matched: true" or "Matched: false".',
          ],
          controls: [
            { name: 'Context (JSON)', kind: 'field', what: 'The pretend event payload. Must be valid JSON or you get "Context must be valid JSON" before anything is sent.' },
            { name: 'Run Test', kind: 'button', what: 'Posts the context to the rule\'s test endpoint and reports whether the conditions matched.' },
            { name: 'Matched: true / Matched: false', kind: 'badge', what: 'The verdict. False with a context you believe should match usually means a field name typo or a string/number mismatch in the value.' },
            { name: 'Close', kind: 'button', what: 'Dismisses the tester.' },
          ],
          warnings: [
            'A passing test does not prove the action will succeed - only that the conditions match. An offer action on a non-offer trigger will test as Matched: true and still be skipped at run time for want of an offer_id.',
          ],
        },
      ],
    },
    {
      id: 'ia-questions',
      title: 'Coding Questions tab',
      path: '/dashboard/interview-automation?tab=questions',
      summary:
        'The AI coding assessment question bank: problem statement, per-language starter code, and the test cases each submission is executed against. Candidates see the description, the starter code for their chosen language, and only the visible test cases.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'questions-table',
          title: 'The question bank',
          controls: [
            { name: '+ Add Question', kind: 'button', what: 'Opens the Add Coding Question modal.' },
            { name: 'Title', kind: 'column', what: 'The question name shown when assigning and in the submissions list.' },
            { name: 'Job Domain', kind: 'column', what: 'Optional scope, or a dash.' },
            { name: 'Difficulty', kind: 'column', what: 'easy (green), medium (amber) or hard (red).' },
            { name: 'Languages', kind: 'column', what: 'Which starter-code templates exist, comma separated. Today the editor offers python and javascript.' },
            { name: 'Test Cases', kind: 'column', what: 'How many test cases the question has, visible and hidden combined.' },
            { name: 'Edit', kind: 'button', what: 'Opens the question modal pre-filled.' },
            { name: 'Delete', kind: 'button', what: 'Deletes after confirming "Delete coding question “X”?".' },
          ],
          warnings: [
            'Deleting a question does not delete the submissions made against it. Those rows survive and fall back to showing the raw question id where the title used to be.',
          ],
        },
        {
          id: 'author-question',
          title: 'Author a coding question',
          steps: [
            'Click + Add Question.',
            'Enter a Title * and the Description * - the description is the problem statement the candidate reads, so include the input/output contract and any constraints.',
            'Optionally set a Job Domain, and pick a Difficulty (Easy / Medium / Hard; medium is the default).',
            'Fill in Starter Code by Language for python and javascript. Both are pre-seeded with a one-line comment stub.',
            'Add Test Cases. Each has an Input, an Expected Output, and a Hidden flag. The form starts with one empty case.',
            'Tick "Hidden test (not shown to candidate)" on the cases that should not be revealed.',
            'Click Create.',
          ],
          controls: [
            { name: 'Title *', kind: 'field', what: 'Required. The question name.' },
            { name: 'Description *', kind: 'field', what: 'Required. The full problem statement shown to the candidate.' },
            { name: 'Job Domain', kind: 'field', what: 'Optional scoping key.' },
            { name: 'Difficulty', kind: 'field', what: 'Easy, Medium or Hard. Drives the badge colour and is available for filtering.' },
            { name: 'Starter Code by Language', kind: 'field', what: 'One textarea per supported language, pre-filled with a stub comment. Spell-check is off in these boxes.', how: 'Give the candidate a working signature to fill in, not an empty file - it removes a whole class of "wrong entry point" failures against your test cases.' },
            { name: '+ Add Test Case', kind: 'button', what: 'Appends another empty test case block.' },
            { name: 'Input', kind: 'field', what: 'The stdin/argument payload handed to the submitted program for that case.' },
            { name: 'Expected Output', kind: 'field', what: 'The exact output the run must produce to count as a pass.', how: 'Comparison is exact - trailing newlines and whitespace matter. Keep outputs simple and single-line where you can.' },
            { name: 'Hidden test (not shown to candidate)', kind: 'toggle', what: 'Marks the case as hidden. Hidden cases still run and still count toward the score, but their content is never shown to the candidate.', how: 'Use a mix: a couple of visible cases so the candidate can self-check, and hidden edge cases so the solution cannot be special-cased.' },
            { name: 'Remove', kind: 'button', what: 'Deletes that test case block. Disabled when only one case remains.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the question. Disabled while Title or Description is blank.' },
          ],
          tips: [
            'Editing a question does not re-run past submissions. Scores already recorded were computed against the test cases as they were at the time.',
          ],
        },
      ],
    },
    {
      id: 'ia-submissions',
      title: 'Submissions tab',
      path: '/dashboard/interview-automation?tab=submissions',
      summary:
        'Every coding submission across every candidate, newest-first and paged. Each row expands into the full review: similarity check, static complexity, AI code-quality review, the submitted code, and the visible and hidden test results. This is a review surface - nothing here is editable.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'submissions-filters',
          title: 'Filtering and deep links',
          body: [
            'Two filters: a candidate id box and a flagged-only checkbox. The candidate filter is committed on submit (press Enter or click Apply) and is written into the URL, which is what makes a submission view linkable.',
            'That is also how the rest of the product links here: /dashboard/interview-automation?tab=submissions&candidate_id=<id> opens straight onto one candidate\'s submissions. The legacy /dashboard/coding-submissions route preserves the query string when it redirects, so old links carrying a candidate_id still land correctly.',
          ],
          controls: [
            { name: 'Filter by candidate_id - leave blank for all', kind: 'filter', what: 'Restricts the list to one candidate. Applied on submit, not as you type, and mirrored into the URL as ?candidate_id=.' },
            { name: 'Apply', kind: 'button', what: 'Commits the candidate id box and re-queries from page 1.' },
            { name: 'Clear', kind: 'button', what: 'Drops the candidate filter. Only shown while one is applied.' },
            { name: 'Similarity-flagged only', kind: 'toggle', what: 'Shows only submissions the similarity checker flagged. Combines with the candidate filter and resets you to page 1.', how: 'The fastest integrity sweep: tick it with no candidate filter to see every flagged submission on the platform.' },
            { name: 'All submissions / Submissions for <id>', kind: 'column', what: 'The results card title, reflecting the active candidate filter.' },
            { name: 'N total', kind: 'badge', what: 'How many submissions match the current filters, across all pages.' },
          ],
          tips: [
            'Switching to another tab drops the candidate_id from the URL on purpose, so the other tabs never sit on a stale invisible filter. Coming back to Submissions starts unfiltered.',
          ],
        },
        {
          id: 'submission-row',
          title: 'Reading a submission row',
          body: [
            'Collapsed, each row names the candidate, the question, the language and the submission time, then carries a set of badges. Click anywhere on the header to expand it.',
          ],
          controls: [
            { name: 'Status badge', kind: 'badge', what: 'completed (green), error (red) or queued (grey). An error means the run itself failed, not that the candidate failed the tests.' },
            { name: 'Score %', kind: 'badge', what: 'Test-case pass rate. Green at 80 and above, amber from 50, red below 50.' },
            { name: 'Q <n>', kind: 'badge', what: 'The AI code-quality score out of 100, coloured on the same thresholds. Only shown when a quality review exists.' },
            { name: '⚠ Similarity', kind: 'badge', what: 'Red badge meaning this submission was flagged as highly similar to another candidate\'s.', how: 'Treat it as a prompt to review, never as proof - see the similarity panel for the actual numbers.' },
            { name: '▼ / ▲', kind: 'button', what: 'Expands or collapses the full review panel. Only one row is expanded at a time.' },
          ],
        },
        {
          id: 'similarity-panel',
          title: 'Similarity check',
          body: [
            'Comparison is structural: comments are stripped and identifiers normalised before comparing, so renaming variables or reformatting does not lower the number. It runs against other candidates\' submissions to the same question.',
            'Two numbers matter and they catch different cheats. Overall overlap is the share of the combined work that is common. "Contained in another" catches a verbatim copy that has been padded out with extra code - a case overall overlap alone misses.',
          ],
          controls: [
            { name: 'compared against N other candidates', kind: 'badge', what: 'The comparison population. If it says "(most recent only)", the comparison set was truncated to the most recent submissions.' },
            { name: 'overall overlap', kind: 'badge', what: 'The Jaccard-style similarity percentage against the closest other submission.' },
            { name: 'contained in another', kind: 'badge', what: 'The containment percentage - how much of this submission appears wholly inside another one.' },
            { name: 'flag threshold', kind: 'badge', what: 'The percentage at which the checker raises the flag, shown so you can judge a near-miss.' },
            { name: 'Match row', kind: 'column', what: 'Each match lists its percentage and the other candidate id.' },
            { name: 'identical', kind: 'badge', what: 'Red - the two submissions are identical once normalised.' },
            { name: 'contained + padded', kind: 'badge', what: 'Amber - this submission is largely contained in the other, padded with extra code. The copy-then-pad signature.' },
          ],
          warnings: [
            'The match list names other candidates, which makes this panel admin-only. It is stripped from every candidate-facing response and must never be pasted into an email to an applicant.',
            'Very short submissions are reported but never flagged - short answers converge by construction, so a similarity score on them means nothing. The panel says so explicitly when that applies.',
          ],
        },
        {
          id: 'complexity-quality',
          title: 'Complexity and AI quality review',
          body: [
            'Complexity is deterministic static analysis - no AI involved, identical run to run. Quality is an AI review of the code as written, which is the axis a pass/fail test runner cannot see.',
          ],
          controls: [
            { name: 'Complexity band', kind: 'badge', what: 'low (green), moderate (grey), high or very high (amber).', how: 'High is not automatically bad - a hard problem earns it, which is why the palette stops at amber and never goes red.' },
            { name: 'cyclomatic', kind: 'badge', what: 'Cyclomatic complexity: the number of independent paths through the code.' },
            { name: 'max nesting', kind: 'badge', what: 'Deepest block nesting reached.' },
            { name: 'lines of code', kind: 'badge', what: 'Executable lines, excluding comments and blanks.' },
            { name: 'functions', kind: 'badge', what: 'How many functions were defined.' },
            { name: 'AI code-quality review', kind: 'badge', what: 'Overall score out of 100, coloured on the same thresholds as the test score.' },
            { name: 'readability / structure / efficiency / idiomatic / problem solving', kind: 'badge', what: 'The five sub-scores behind the overall quality number.' },
            { name: 'Approach summary', kind: 'column', what: 'A short prose description of how the candidate solved it.' },
            { name: 'For the recruiter', kind: 'column', what: 'Guidance written specifically for the reviewer - the internal counterpart of the candidate-facing feedback.' },
            { name: 'Strengths', kind: 'column', what: 'Bullet list of what the review rated well.' },
            { name: 'Concerns', kind: 'column', what: 'Bullet list of what the review flagged.' },
          ],
        },
        {
          id: 'code-and-tests',
          title: 'Code and test results',
          controls: [
            { name: 'Submitted Code', kind: 'column', what: 'The exact code as submitted. Reads "(not stored)" when the submission predates code retention or storage was disabled.' },
            { name: 'Visible Test Cases', kind: 'column', what: 'Results for the cases the candidate could see, each with expected and actual output.' },
            { name: 'Hidden Test Cases - X of Y passed', kind: 'column', what: 'Results for the hidden cases, with the pass count in the heading.', how: 'This is the number that usually decides the outcome - a candidate who special-cased the visible tests will pass those and fail here.' },
            { name: 'PASS / FAIL', kind: 'badge', what: 'Per-case verdict. FAIL rows show what was expected against what the code actually produced.' },
          ],
        },
        {
          id: 'submissions-paging',
          title: 'Paging',
          controls: [
            { name: 'Page X of Y', kind: 'badge', what: 'Position in the result set. 25 submissions per page; controls appear only when there is more than one page.' },
            { name: '← Previous', kind: 'button', what: 'Previous page. Disabled on page 1.' },
            { name: 'Next →', kind: 'button', what: 'Next page. Disabled on the last page.' },
          ],
          faqs: [
            {
              q: 'The list says "Failed to load coding submissions".',
              a: 'The query failed outright rather than returning nothing. Check backend health on Platform Settings → System; unlike an empty result, this state shows no total and no rows.',
            },
          ],
        },
      ],
    },
  ],
}


const adminReferenceChapter: GuideChapter = {
  id: 'admin-reference',
  title: 'Admin reference',
  blurb: 'Where the old admin pages went, and how to read the errors these screens report.',
  sections: [
    {
      id: 'legacy-routes',
      title: 'Old bookmarks still work',
      path: '/dashboard',
      summary:
        'Fourteen separate admin pages were merged into five tabbed pages. Every retired route is kept as a redirect, so an old bookmark, an old email link or a deep link from another system still resolves - it just lands on the corresponding tab now. Redirects replace the history entry, so the Back button will not bounce you between the old and new URL.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'redirect-table',
          title: 'Where each old route lands',
          controls: [
            { name: '/dashboard/roles', kind: 'link', what: 'Now /dashboard/users?tab=roles - the Roles & Permissions tab of Users & Roles.' },
            { name: '/dashboard/audit-log', kind: 'link', what: 'Now /dashboard/users?tab=audit - the Audit Log tab of Users & Roles.' },
            { name: '/dashboard/webhooks', kind: 'link', what: 'Now /dashboard/settings?tab=webhooks - the Webhooks tab of Platform Settings.' },
            { name: '/dashboard/prompt-config', kind: 'link', what: 'Now /dashboard/settings?tab=prompts - the AI Prompts tab of Platform Settings.' },
            { name: '/dashboard/email-templates', kind: 'link', what: 'Now /dashboard/settings?tab=email - the Email Templates tab of Platform Settings.' },
            { name: '/dashboard/company-settings', kind: 'link', what: 'Now /dashboard/organization - the Company Profile tab, which is the page default.' },
            { name: '/dashboard/branding', kind: 'link', what: 'Now /dashboard/organization?tab=branding - the Branding & Notifications tab.' },
            { name: '/dashboard/departments', kind: 'link', what: 'Now /dashboard/organization?tab=departments - the Departments & Designations tab.' },
            { name: '/dashboard/scenarios', kind: 'link', what: 'Now /dashboard/interview-automation?tab=scenarios - the Scenarios tab.' },
            { name: '/dashboard/workflows', kind: 'link', what: 'Now /dashboard/interview-automation?tab=workflows - the Workflow Rules tab.' },
            { name: '/dashboard/coding-questions', kind: 'link', what: 'Now /dashboard/interview-automation?tab=questions - the Coding Questions tab.' },
            { name: '/dashboard/coding-submissions', kind: 'link', what: 'Now /dashboard/interview-automation?tab=submissions - the Submissions tab. This redirect preserves the whole query string, so an existing link carrying ?candidate_id=… still opens that candidate\'s submissions.' },
          ],
          tips: [
            'Anything that is not a known route at all falls through to the site root rather than showing a 404 page. If a link takes you to the landing page, the path was wrong, not merely retired.',
          ],
        },
      ],
    },
    {
      id: 'admin-troubleshooting',
      title: 'Reading errors on the admin pages',
      summary:
        'These pages surface backend errors in a consistent way. Knowing the shapes saves a lot of guessing.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'error-shapes',
          title: 'What each failure looks like',
          controls: [
            { name: 'Toast with server text', kind: 'badge', what: 'The normal failure path. The server\'s own explanation is shown verbatim; a validation error with several problems is joined with semicolons.', how: 'Toasts clear after about 3 seconds. If you missed one, repeat the action rather than assuming it succeeded.' },
            { name: 'Silent empty table', kind: 'badge', what: 'Several panels swallow load errors and simply render an empty list - webhooks, prompts, templates, scenarios, rules, questions, company profile and branding all do this.', how: 'An unexpectedly empty admin table almost always means the backend call failed, not that the data is gone. Confirm with Backend Status on Platform Settings → System before creating anything.' },
            { name: 'Signed out unexpectedly', kind: 'badge', what: 'Any 401 logs you out and sends you to /login. There is no demo-token carve-out - every 401 is a genuinely expired session.' },
            { name: '403 / permission refused', kind: 'badge', what: 'You reached the endpoint but your role lacks the permission. On this platform that almost always means an action is Super-Admin-only.', how: 'Cross-check the permission key in the error against the Roles & Permissions matrix - it will show you exactly which roles hold it.' },
            { name: '409 conflict', kind: 'badge', what: 'The record is still referenced by something. Today only the department delete produces this, and it is handled with an explicit forced-delete prompt.' },
            { name: '422 validation', kind: 'badge', what: 'The payload was rejected. Common causes: a workflow trigger or action name the backend does not recognise, or a role name that does not exist.' },
          ],
          faqs: [
            {
              q: 'A change I made is not visible to a colleague.',
              a: 'Branding is applied at page load, and most admin pages fetch once per tab visit. Ask them to reload. Nothing on these pages pushes live updates - there is no websocket in this product.',
            },
            {
              q: 'How do I find out who changed a setting?',
              a: 'Users & Roles → Audit Log. Filter by Resource Type or Action, or by the person on Actor Email. Role changes in particular are recorded there with their old and new values in the Details column.',
            },
          ],
        },
      ],
    },
  ],
}

export const adminChapters: GuideChapter[] = [
  orientationChapter,
  usersRolesChapter,
  platformSettingsChapter,
  organizationChapter,
  interviewAutomationChapter,
  adminReferenceChapter,
]

export const hrAdminGuide: RoleGuide = {
  role: 'admin',
  label: 'HR Admin',
  tagline: 'Everything a Recruiter can do, plus the four screens that configure how the platform behaves.',
  intro: [
    'An HR Admin account keeps every recruiting screen and adds an "Admin Settings" group to the sidebar with four destinations: Users & Roles, Platform Settings, Organization, and Interview & Automation.',
    'These are configuration surfaces. What you change here applies to everyone - the AI model behind resume scoring, the words candidates read in an invitation email, the departments jobs are filed under, the rules that move candidates through the pipeline. Most of it takes effect immediately and quietly, so the guide flags the handful of actions that cannot be undone: deleting a user or a custom role, forcing a department delete, and resetting a prompt or an email template.',
    'A few things inside these pages are Super Admin only, and the product lets you in anyway rather than hiding half-usable screens: the user list answers 403 and shows a notice, the permission matrix renders read-only, and role assignment is refused. Every such control is marked below so you know before you click, not after.',
    'The chapters before this one are the recruiting workflow, unchanged from the Recruiter guide - an admin account does not take anything away.',
  ],
  chapters: [...coreChapters, ...adminChapters],
}

export default hrAdminGuide
