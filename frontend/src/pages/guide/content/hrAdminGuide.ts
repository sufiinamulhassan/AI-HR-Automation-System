import type { GuideChapter, RoleGuide } from '../types'
import { coreChapters } from './recruiterGuide'

const orientationChapter: GuideChapter = {
  id: 'admin-orientation',
  title: 'Administration, orientation',
  blurb: 'What an admin account adds to the app, where those screens live, and which of them you can only read.',
  sections: [
    {
      id: 'admin-nav',
      title: 'The Admin Settings group',
      path: '/dashboard',
      summary:
        'An admin account keeps every screen a Recruiter has and adds a collapsible "Admin Settings" group at the bottom of the sidebar. Four entries live there for an HR Admin. They are configuration surfaces: they change how the product behaves for everyone else in your company, so most of what you do here has no undo beyond editing it back.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'finding-the-group',
          title: 'Finding the admin screens',
          body: [
            'The sidebar has two blocks. The top block, Dashboard, Recruiting and Résumés, is the same for every signed-in user (a Performance entry joins it for an account that has been given access to performance reviews). Below a divider sits a single "Admin Settings" row with a chevron; the four admin destinations are hidden inside it until you expand it.',
            'The group expands itself automatically whenever you navigate onto an admin route, including by pasting a direct link, so an admin page is never active while its nav entry is hidden. Once open it stays open until you collapse it by hand.',
            'A top bar also runs above the page content itself, separate from the sidebar. On its right sit the Needs attention icon, which opens a list of the work waiting on HR, and a bell icon that opens /dashboard/activity, now the only way to reach the Activity page since it has no entry of its own in the sidebar.',
          ],
          controls: [
            {
              name: 'Admin Settings',
              kind: 'button',
              what: 'Expands or collapses the admin sub-navigation. It also highlights as active whenever the current route is one of the admin pages.',
              how: 'Purely a display toggle. Collapsing it does not remove your access. If you arrive on an admin page by link, it opens on its own.',
            },
            {
              name: 'Users & Roles',
              kind: 'link',
              what: 'Opens /dashboard/users, user accounts, the role/permission matrix, and the platform audit log, as three tabs.',
              how: 'As an HR Admin you manage Recruiter accounts on the Users tab, read the matrix on Roles & Permissions, and read the Audit Log. Admin accounts, role changes and the matrix itself belong to a Super Admin. See the chapter below.',
            },
            {
              name: 'Platform Settings',
              kind: 'link',
              what: 'Opens /dashboard/settings, the model each AI job runs on, health readout and live check, email templates, outbound webhooks, security policies and email delivery, as five tabs.',
            },
            {
              name: 'Organization',
              kind: 'link',
              what: 'Opens /dashboard/organization, company profile and integration status, branding and notification settings, and the department, designation and job grade lists, as three tabs.',
            },
            {
              name: 'Interview & Automation',
              kind: 'link',
              what: 'Opens /dashboard/interview-automation, scenario interview prompts, workflow automation rules, the coding question bank, live coding sessions and coding submissions, as five tabs.',
            },
            {
              name: 'HR Admin Portal',
              kind: 'badge',
              what: 'The line under the Hirely logo in the sidebar. It reads "HR Admin Portal" for role admin, "Super Admin Portal" for superadmin and "Recruiter Portal" for standard.',
              how: 'The quickest way to confirm which role your session is actually running as. The same role label sits next to your name in the top bar above the page, which also links to your profile.',
            },
          ],
          tips: [
            'Every admin page is reachable by URL. Bookmark the exact tab you use daily. The tab is part of the query string.',
          ],
        },
        {
          id: 'get-started-checklist',
          title: 'The Get started checklist',
          body: [
            'A new company sees a **Get started** card at the top of the dashboard. It lists the few things that make the workspace useful: complete the company profile, add your logo and colours, invite your team, create a job and upload résumés. Admins and Super Admins see it; Recruiters do not.',
          ],
          controls: [
            { name: 'Step rows', kind: 'link', what: 'Each row shows whether the step is done and links to where it is done: Organization, Organization Branding, Users & Roles, Recruiting and Résumés.' },
            { name: '2 of 5', kind: 'badge', what: 'How many steps are done.' },
            { name: 'Dismiss', kind: 'button', what: 'Hides the card for the whole company.', how: 'The card also goes by itself once every step is done.' },
          ],
        },
        {
          id: 'admin-vs-superadmin',
          title: 'HR Admin vs Super Admin, where the line falls',
          body: [
            'Both roles get through the same route guard (AdminRoute lets in admin and superadmin alike), so an HR Admin can open all four pages. The difference is enforced inside the pages and by the backend, per action.',
            'Rather than hiding half-usable screens, the product lets you in and degrades: a control you cannot use is disabled, hidden, or answers with a permission error. The table below is the list of what a plain HR Admin cannot do on an otherwise-admin page.',
          ],
          controls: [
            {
              name: 'Which accounts you see',
              kind: 'column',
              what: 'The Users tab lists Recruiter accounts only. The server filters the list, so admin and Super Admin accounts are not in it at all.',
              how: 'A Super Admin sees every account. This is why the summary cards differ between the two roles.',
              access: 'Super Admin sees every account',
            },
            {
              name: 'Create and edit accounts, reset passwords, set a department',
              kind: 'button',
              what: 'You can do all four for Recruiter accounts. You cannot edit an admin or a Super Admin, reset their password, or give them a department. Those controls are disabled with the tooltip "Only a Super Admin can do this".',
              how: 'A new account you create is always a Recruiter. The role picker is not shown to you.',
              access: 'HR Admin: Recruiters only. Super Admin: any account',
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
              what: 'Every role write goes through PATCH /rbac/users/{email}/role, which needs the rbac:manage permission, held by superadmin only.',
              how: 'The Role field is not shown to you on the edit form. Nobody can change their own role or switch off their own account, and the last Super Admin cannot be removed or demoted.',
              access: 'Super Admin only',
            },
            {
              name: 'Create / edit / delete a custom role',
              kind: 'button',
              what: '+ New Role, the pencil and bin icons on a role column and every matrix checkbox are disabled for an HR Admin, with the tooltip "Only a Super Admin can do this".',
              access: 'Super Admin only',
            },
            {
              name: 'Read the permission matrix',
              kind: 'tab',
              what: 'Allowed. An HR Admin holds rbac:read, so the whole matrix, built-in defaults and custom roles, renders normally.',
            },
            {
              name: 'Read the audit log',
              kind: 'tab',
              what: 'Allowed. An HR Admin holds audit:read, so filtering and paging the log works fully.',
            },
            {
              name: 'Email, Sign-in, Integrations and Data tabs',
              kind: 'tab',
              what: 'On Organization. Your own mail server, your company\'s single sign-on, your HR system, Zoom and Teams accounts, how long personal data is kept and erasing a person on request. These four tabs are not shown to an HR Admin.',
              how: 'They are described in the Super Admin guide. The same goes for the Erase personal data item in a candidate\'s row menu.',
              access: 'Super Admin only',
            },
            {
              name: 'Read the security policies',
              kind: 'tab',
              what: 'Allowed, read only. On Platform Settings → Security Policies the fields are disabled, a Read only badge shows and there is no Save button.',
              access: 'Super Admin changes them',
            },
          ],
          faqs: [
            {
              q: 'I clicked an admin link and landed back on the dashboard.',
              a: 'AdminRoute sends any non-admin to /dashboard, silently. There is no access-denied screen anywhere in the product. Check the role on your own account under Users & Roles.',
            },
            {
              q: 'A toast said "Changes saved, but the role was not changed."',
              a: 'The user edit form writes to two endpoints: the profile first, the role second. If the role write is refused, the profile change is already applied. The form closes, the list reloads so it shows what is really stored, and the toast carries the server\'s reason.',
            },
          ],
        },
        {
          id: 'admin-page-conventions',
          title: 'Conventions shared by every admin page',
          body: [
            'The four admin screens are merged pages: what used to be fourteen separate sidebar entries is now four pages with tabs. They all behave the same way, so learning one teaches you the rest.',
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
              what: 'The small number beside a tab label is the live row count for that tab (users, custom roles, audit entries, scenarios, rules, questions).',
              how: 'A missing count means that tab has not loaded its data yet. The count appears the first time you open it.',
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
              what: 'The primary button at the top-right belongs to the active tab and changes with it, for example + Add User on Users, + New Role on Roles & Permissions, and Refresh on Audit Log.',
            },
            {
              name: 'Confirm dialogs',
              kind: 'button',
              what: 'Deletes and sends use the browser native confirm() dialog, quoting the exact record name.',
              how: 'Read the dialog text. For a department delete it is the only place the real consequence is spelled out.',
            },
            {
              name: 'Retry',
              kind: 'button',
              what: 'When a list or a form cannot be read, most admin panels show a red message with a Retry button in its place, and keep Save disabled, rather than drawing an empty table or a blank form.',
              how: 'A message with Retry is a failed read, and nothing was lost. The Email Templates tab is the exception: it still shows an empty list when the backend cannot be reached, so check Backend Status on the System tab if it looks empty.',
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
        'Create accounts, edit profiles, set a department, force OTP, reset passwords and (as a Super Admin) delete users. This is also the only place in the product where a person\'s role is assigned. The permission matrix on the next tab decides what a role means, never who holds it.',
      access: 'HR Admin & Super Admin. An HR Admin sees and manages Recruiter accounts only; a Super Admin sees every account',
      subsections: [
        {
          id: 'users-list-error',
          title: 'If the user list cannot load',
          body: [
            'When the list cannot be read, the table and the summary cards are replaced by a red message with a Retry button, and the tab loses its count badge. An empty table is never drawn from a failed read, so a failure cannot be mistaken for "no users".',
          ],
          controls: [
            { name: 'Retry', kind: 'button', what: 'Reads the user list again, along with the departments and roles on the same page.' },
          ],
          faqs: [
            {
              q: 'The red message is showing and Retry does not help.',
              a: 'The request is failing for a reason on the server side (backend down, database unavailable). Any 401 signs you out automatically, so if you are still on the page it was not an expired session. Check the backend health readout on Platform Settings → System.',
            },
          ],
        },
        {
          id: 'users-overview-controls',
          title: 'Summary cards, search and the table',
          body: [
            'The list loads 100 accounts at a time. The first summary card shows how many accounts there are in all; the others count the accounts loaded so far. The search box asks the server to match, a moment after you stop typing, so it finds accounts that are not loaded yet. What you are given depends on your role: a Super Admin gets every account, an HR Admin gets Recruiters only.',
          ],
          controls: [
            { name: 'Recruiters', kind: 'badge', what: 'HR Admin view. How many accounts are in your list, all of them Recruiters.' },
            { name: 'Active', kind: 'badge', what: 'How many accounts in your list can sign in. Inactive accounts still exist and still count in the first card.' },
            { name: 'Inactive', kind: 'badge', what: 'HR Admin view. How many accounts in your list are switched off.' },
            { name: 'Total Users', kind: 'badge', what: 'Super Admin view. Count of every account.', access: 'Super Admin only' },
            { name: 'Super Admins', kind: 'badge', what: 'Super Admin view. How many accounts hold role superadmin.', access: 'Super Admin only' },
            { name: 'HR Admins', kind: 'badge', what: 'Super Admin view. How many hold role admin.', access: 'Super Admin only' },
            {
              name: 'Search by name or email…',
              kind: 'filter',
              what: 'Asks the server for the accounts whose name or email matches what you typed, from the first page, a moment after you stop typing. Case-insensitive.',
              how: 'It searches every account you may see, not only the ones loaded. A search with no match says No users match, with what you typed. Clear the box to see everyone again.',
            },
            { name: 'N of M users', kind: 'badge', what: 'How many accounts are loaded, out of how many match. It reads "recruiters" in place of "users" when every account in the list is a Recruiter. Hidden while loading or when the list failed.' },
            { name: 'Load more', kind: 'button', what: 'Under the table while more accounts match than are loaded. Reads the next 100 and adds them below.', how: 'It goes away once every match is loaded. A search carries into it, so you page through the matches only.' },
            { name: 'User', kind: 'column', what: 'Avatar initial, full name and email. The avatar is colour-coded by role. A distinct colour marks a custom role.' },
            { name: 'Role', kind: 'column', what: 'The role badge. Built-in roles show their friendly label (Super Admin / HR Admin / Recruiter); a custom role shows its raw role_name.' },
            { name: 'Department', kind: 'column', what: 'The department the account is placed in, or a dash for none. A Recruiter with a department only sees that department\'s jobs and candidates.', how: 'Departments are created on Organization → Departments, Designations & Grades. See "Edit a user" below for who can set one.' },
            { name: 'Status', kind: 'column', what: 'Active (green) or Inactive (red), from is_active. An inactive account cannot sign in.', how: 'A blue Invited chip beside it means the account was created with an invitation and the person has not yet used the link to choose a password.' },
            { name: 'OTP', kind: 'column', what: 'On (blue) or Off (grey), whether that user must enter a one-time code after their password.', how: 'A green 2FA chip beside it means the person has turned on an authenticator app, which they are asked for at every sign-in.' },
            { name: 'Last Login', kind: 'column', what: 'Date of last successful sign-in, formatted day/month/year, or a dash if the user has never signed in.' },
            { name: 'Actions', kind: 'column', what: 'Edit, Reset PW, Reset authenticator (only on an account with a 2FA chip), Resend invitation (only on an account that is still Invited) and, for a Super Admin only, Delete. Edit, Reset PW, Reset authenticator and Resend invitation are disabled on an admin or Super Admin account when you are an HR Admin.' },
          ],
        },
        {
          id: 'create-user',
          title: 'Create a user',
          steps: [
            'Click + Add User in the page header.',
            'Enter Email *. This is the account identifier and cannot be changed afterwards (the field is not even shown on the edit modal).',
            'Enter Full Name *.',
            'Pick a Role if you are a Super Admin. The dropdown lists Recruiter, HR Admin, Super Admin and every custom role by its raw name. As an HR Admin you do not get a picker: the form shows a Recruiter badge, because a Recruiter is the only account you can create.',
            'Optionally pick a Department.',
            'Either type a Password, with the rules currently in force stated under the field, or tick Send an invitation email instead and the person chooses their own.',
            'Tick Require OTP on login if this person must enter a one-time code as well as their password.',
            'Click Create User. On success the modal closes, a "User created" toast appears and the list reloads. With an invitation the toast says the invitation was sent.',
          ],
          controls: [
            { name: '+ Add User', kind: 'button', what: 'Opens the Create New User modal with an empty form defaulting to the Recruiter role and OTP off.' },
            { name: 'Email *', kind: 'field', what: 'The login identifier. Sent as the email on POST /auth/users.', how: 'Immutable once created. Getting it wrong means deleting the account (Super Admin) and starting again.' },
            { name: 'Full Name *', kind: 'field', what: 'Display name shown in the table, the sidebar and audit entries.' },
            {
              name: 'Role',
              kind: 'field',
              what: 'Which role the new account holds. Built-in roles are sent straight to the create endpoint; a custom role is applied as a second call.',
              how: 'POST /auth/users only accepts the three built-in role literals, so choosing a custom role creates the user as Recruiter first and then issues a role assignment. See the warning below.',
              access: 'Super Admin only. An HR Admin creates Recruiters',
            },
            { name: 'Department', kind: 'field', what: 'The department the new account is placed in, from the list on Organization. "No department" is the default.', how: 'A Recruiter with a department only sees that department\'s jobs and candidates. An HR Admin can set it for a Recruiter; a Super Admin can set it for any account.' },
            { name: 'Password', kind: 'field', what: 'Optional. A password you set directly: the user is not emailed and is not forced to change it.', how: 'The line under the field spells out the rules from Platform Settings → Security Policies, such as "At least 12 characters, with a number and a symbol". It stays empty while the policy asks for nothing beyond one character. If the password breaks a rule, the server\'s reason appears in a toast. Left blank, an invitation is sent instead.' },
            { name: 'Send an invitation email instead', kind: 'toggle', what: 'Hides the Password field and emails the person a link to choose their own password. The account has no usable password until they do.', how: 'The link works once and lasts seven days. The list shows an Invited chip until it is used.' },
            { name: 'Resend invitation', kind: 'button', what: 'On a row marked Invited, sends the link again. A toast says "Invitation sent to <email>".', how: 'Asking for one person too often is refused for a while.' },
            { name: 'Require OTP on login', kind: 'toggle', what: 'Sets otp_required. When on, sign-in stops after the password and asks for a one-time code.' },
            { name: 'Create User', kind: 'button', what: 'Submits the form. Shows "Saving…" while in flight.' },
            { name: 'Cancel', kind: 'button', what: 'Closes the modal, discarding the form. Clicking the dark overlay does the same.' },
          ],
          warnings: [
            'Choosing a custom role as a Super Admin is two calls. If the account is created but the role assignment is then refused, the form closes, the list reloads and a toast reads "User created, but the role was not assigned." followed by the reason. The account exists as a Recruiter. Do not create it again: open it with Edit and set the role there.',
            'If the invitation email could not be sent, a yellow toast reads "The account was created but the email could not be sent". The account exists. Check Platform Settings → Email Delivery, then use Resend invitation on its row, or set a password with Reset PW.',
            'A password you type is the user\'s live password from that moment. Send it over a channel you trust, or prefer the invitation.',
          ],
        },
        {
          id: 'edit-user',
          title: 'Edit a user, change a role, deactivate an account',
          steps: [
            'Click Edit on the user\'s row. The modal is titled "Edit, <name>".',
            'Adjust Full Name, Role (Super Admin only), Department, Active account and Require OTP on login as needed. Email is deliberately absent.',
            'Click Save Changes.',
          ],
          body: [
            'Profile fields and the role deliberately travel to different endpoints. The name, department, active and OTP fields go to PATCH /auth/users/{email}; the role, built-in or custom, goes to PATCH /rbac/users/{email}/role, the only endpoint that validates a role name and records the change as a role assignment in the audit log. The role is never sent to the profile endpoint.',
            'The role call is only made when the value actually changed, so saving an unchanged Role costs nothing and is not audited. The department is likewise sent only when you changed it.',
            'On your own account the Role and Active account controls are disabled: nobody can change their own role or switch off their own account. The platform also refuses to remove or demote the last Super Admin.',
          ],
          controls: [
            { name: 'Edit', kind: 'button', what: 'Opens the edit modal pre-filled from the row. Disabled with the tooltip "Only a Super Admin can do this" on an admin or Super Admin account when you are an HR Admin.' },
            { name: 'Full Name *', kind: 'field', what: 'Updates the display name via the profile endpoint.' },
            {
              name: 'Role',
              kind: 'field',
              what: 'Reassigns the user. Writes through the RBAC endpoint so the change is validated and audited.',
              how: 'The field hint in the modal says it plainly: this is the only place a role is assigned. Permissions per role are edited on the Roles & Permissions tab, reachable from the hint link. An HR Admin does not see this field.',
              access: 'Super Admin only (the endpoint needs rbac:manage)',
            },
            { name: 'Department', kind: 'field', what: 'Moves the account to another department, or to "No department".', how: 'An HR Admin can set it for Recruiters only; a Super Admin can set it for any account. On any other account the field is disabled with the tooltip "Only a Super Admin can do this".' },
            { name: 'Active account', kind: 'toggle', what: 'Clearing it sets is_active false, which blocks sign-in without deleting the account or its history.', how: 'This is the safe alternative to deleting a leaver. Audit entries keep pointing at a real user record.' },
            { name: 'Require OTP on login', kind: 'toggle', what: 'Turns the one-time-code step on or off for that user.' },
            { name: 'Reset authenticator', kind: 'button', what: 'On a row with a 2FA chip, after a confirmation, switches that account\'s authenticator app off so the person can set it up again from My Profile. A toast says "Authenticator reset for <email>".', how: 'Use it when someone has lost their phone and their recovery codes. Same rule as Reset PW: an HR Admin can do it for Recruiters only.' },
            { name: 'Save Changes', kind: 'button', what: 'Writes the profile, then the role if it changed. Success closes the modal, toasts "User updated" and reloads the list.' },
          ],
          warnings: [
            'If the role write is rejected (an invalid custom role name, or a change that would leave no Super Admin), the profile change has already been committed. The modal closes, the list reloads and the toast reads "Changes saved, but the role was not changed." with the server\'s reason. Do not assume nothing happened.',
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
            { name: 'Reset PW', kind: 'button', what: 'Opens the "Reset Password, <name>" modal for that account. As an HR Admin you can reset a Recruiter only; on an admin or Super Admin account the button is disabled with the tooltip "Only a Super Admin can do this".' },
            { name: 'New Password', kind: 'field', what: 'The replacement password, applied immediately via POST /auth/admin/reset-password.', how: 'The line under the field states the password rules currently in force, the same line as on Create a user. A password that breaks a rule is refused with the server\'s reason in a toast.' },
            { name: 'Reset Password', kind: 'button', what: 'Submits. Disabled while the field is empty or the request is in flight.' },
          ],
          warnings: [
            'The user is not emailed and is not prompted to change it at next sign-in. You must deliver the new password yourself. A person who has simply forgotten theirs does not need you: Forgot your password? on the sign-in page emails them a link.',
            'The reset does not reload the list and does not change any other field. The modal simply closes with a "Password reset successfully" toast.',
          ],
        },
        {
          id: 'delete-user',
          title: 'Delete a user',
          body: [
            'The Delete button only renders for a Super Admin. It asks "Delete user <email>? This cannot be undone." and then calls DELETE /auth/users/{email}.',
          ],
          controls: [
            { name: 'Delete', kind: 'button', what: 'Permanently removes the account. It is disabled on your own row, with the tooltip "You cannot delete your own account", and the last Super Admin cannot be removed.', access: 'Super Admin only' },
          ],
          warnings: [
            'Deleting is irreversible and removes the account outright. Prefer clearing Active account on the edit modal for someone who has left. It blocks sign-in while keeping the record that audit entries refer to.',
          ],
        },
      ],
    },
    {
      id: 'roles-tab',
      title: 'Roles & Permissions tab',
      path: '/dashboard/users?tab=roles',
      summary:
        'The permission matrix: every permission the backend knows about, down the left, against every role across the top. Built-in role columns are fixed and read-only for everyone. Custom role columns are editable, by a Super Admin only, saving the moment a box is ticked.',
      access: 'Readable by HR Admin & Super Admin; editable by Super Admin only',
      subsections: [
        {
          id: 'reading-the-matrix',
          title: 'Reading the matrix',
          body: [
            'Permissions are flat "resource:action" strings. The part before the colon becomes the category heading (a grey band across the table), and the part after becomes the readable row label; the raw key is printed underneath it in small type so you can match it to an API error.',
            'Columns are, in order: the three built-in roles, Super Admin, HR Admin, Recruiter, then one column per custom role. A padlock on a built-in column means "permissions are fixed"; those checkboxes are always disabled.',
            'The three built-in names, standard, admin and superadmin, are reserved: a custom role cannot use them, whatever the capitalisation. If an older install still holds a role document with one of those names, it keeps overriding that built-in role and is shown inside the built-in column it overrides, not as an extra column, so the matrix always reflects what the backend will actually resolve.',
          ],
          controls: [
            { name: 'Permission Matrix', kind: 'column', what: 'Card title. The line under it reports "N permissions · M categories · K custom roles", a quick sanity check that the catalog loaded.' },
            {
              name: 'Filter permissions…',
              kind: 'filter',
              what: 'Narrows the matrix to permission keys or category names containing what you type. Client-side only.',
              how: 'Type a category word ("coding", "offers") to see a whole feature area, or an action ("delete", "manage") to compare one verb across every resource.',
            },
            { name: 'Clear filter', kind: 'button', what: 'Appears in the empty state when nothing matches; resets the filter box.' },
            { name: 'Permission', kind: 'column', what: 'Left-hand column: the readable action name, with the exact permission key beneath it.' },
            { name: 'Super Admin / HR Admin / Recruiter', kind: 'column', what: 'The three built-in role columns, showing the backend\'s built_in_defaults. Always read-only, marked with a padlock.' },
            { name: 'Custom role column', kind: 'column', what: 'One per custom role, headed by the role name (hover for its description), a count such as "3 users" of the accounts that hold it, and edit and delete icons.', how: 'The count is the quickest check before you delete a role.' },
            { name: 'Checkbox cell', kind: 'toggle', what: 'For a custom role, ticking or clearing it grants or revokes that permission and saves immediately. There is no Save button.', access: 'Super Admin only' },
            { name: '+ Add a custom role', kind: 'button', what: 'Stands in for the custom-role column when none exist yet; opens the New Role modal.' },
          ],
          tips: [
            'This tab answers "what can this role do", never "who has this role". For the latter, use the Users tab. Every change made here is recorded on the Audit Log tab.',
          ],
        },
        {
          id: 'permissions-enforced',
          title: 'What a ticked box does',
          body: [
            'A permission is checked by the routes that name it. When a role does not hold the permission a route names, the route answers 403 with "Missing required permission: <key>", whatever the screen showed. Ticking or clearing a box therefore changes what the role can do, not just what the matrix says.',
            'Most admin routes check two things. The caller must hold an admin role (admin or superadmin), and must also hold the permission the route names, for example jobs:create, offers:send or webhooks:manage. A custom role is not an admin role, so ticking boxes does not open a route that also needs an admin role. The routes that check a permission and nothing else, and so follow the checkboxes alone, are the matrix routes (rbac:read), the Audit Log routes (audit:read) and the performance review routes.',
            'The built-in columns are fixed. HR Admin holds every permission except users:manage, rbac:manage and security:manage, which stay with Super Admin. Recruiter holds read permissions only.',
          ],
        },
        {
          id: 'permission-catalog',
          title: 'What the categories cover',
          body: [
            'The category headings are friendly names for the permission-key prefix. Knowing the mapping makes an API 403 self-explanatory. The error names the key, the matrix shows you which roles hold it.',
            'jobs → Jobs. resumes → Resumes. intel → Bulk Resume Ingestion. candidates → Candidates. interview → Interview. coding → AI Coding Assessment. scenarios → Scenario Interviews. offers → Offer Management. analytics → HR Analytics. workflows → Workflow Automation. webhooks → Outbound Webhooks. departments → Departments. designations → Designations. users → User Management. rbac → Roles & Permissions. audit → Audit Log.',
            'Any prefix the frontend does not have a label for is title-cased and shown as-is, so a new backend permission area appears in the matrix without a frontend change. Today that covers attention (the Needs attention icon in the top bar), cost, demographics, email (Email Delivery), job_grades, performance and security (Security Policies).',
          ],
          tips: [
            'The two rows that explain most of this page\'s own behaviour are rbac:read (HR Admin has it, that is why you can see the matrix) and rbac:manage (Super Admin only, that is why you cannot edit it).',
          ],
        },
        {
          id: 'create-custom-role',
          title: 'Create a custom role',
          steps: [
            'Click + New Role in the page header (or + Add a custom role in the matrix when there are none yet).',
            'Enter a Name *. Use a lowercase snake_case identifier such as hiring_manager; this is the literal role value stored on user records. The names standard, admin and superadmin are reserved for the built-in roles and are refused with "This role name is reserved for a built-in role. Choose a different name."',
            'Optionally add a Description; it appears as the tooltip on the column header.',
            'Click Create. The role is created with zero permissions.',
            'Find its new column in the matrix and tick the permissions it should have. Each tick saves on its own.',
          ],
          controls: [
            { name: '+ New Role', kind: 'button', what: 'Opens the New Role modal.', access: 'Super Admin only' },
            { name: 'Name *', kind: 'field', what: 'The role identifier. Required, and permanently fixed at creation.', how: 'The modal states it outright: a role cannot be renamed after creation. The backend has no rename. Choose carefully.' },
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
            'The pencil icon on a custom role column opens the edit modal, description only, since names are immutable. The trash icon opens a delete dialog headed "Delete, <role>" that asks "Delete the role “X”? This cannot be undone."',
            'If accounts still hold the role, the dialog adds "N users hold this role. Move them to *" with a list of the other roles, and the Delete Role button stays disabled until you pick one. Everyone who holds the role is moved to it in the same step, and the toast says how many, for example "Role deleted, 3 users moved". With nobody holding the role, it is simply deleted. The count on the column header can be out of date; if the server finds more holders than the dialog knew about, the dialog updates and waits for you to choose a role.',
            'Permission toggles are optimistic: the checkbox flips instantly and the cell is disabled while the write is in flight. If the server refuses, the checkbox snaps back to its previous state and the error appears as a toast, so a box that visibly reverts means the save failed.',
          ],
          controls: [
            { name: 'Edit description', kind: 'button', what: 'Pencil icon on the column header, opens the edit modal.', access: 'Super Admin only' },
            { name: 'Delete role', kind: 'button', what: 'Trash icon on the column header, opens the delete dialog.', access: 'Super Admin only' },
            { name: 'Move them to *', kind: 'field', what: 'Only shown when users hold the role. The role they are moved to; any other role, built-in or custom, can be picked.', how: 'Pick the role that gives those people the access you want them to keep. The move is recorded in the audit log with the role they went to.', access: 'Super Admin only' },
            { name: 'Delete Role', kind: 'button', what: 'Deletes the role, after moving its holders. Disabled until a role is chosen when holders exist.', access: 'Super Admin only' },
          ],
          warnings: [
            'There is no undo on a permission toggle and no draft state. Each tick is a live write to the role document.',
            'Deleting a role is permanent. The people who held it keep their accounts under the role you moved them to; moving them back is a role change on each account.',
          ],
        },
      ],
    },
    {
      id: 'audit-tab',
      title: 'Audit Log tab',
      path: '/dashboard/users?tab=audit',
      summary:
        'The append-only record of every mutating action in your company: who did it, what they did, to which resource, and when. It sits on this page because it is the record of what the other two tabs did. Every role create, update, delete and assignment writes an entry here.',
      access: 'HR Admin & Super Admin (admin holds audit:read)',
      subsections: [
        {
          id: 'audit-filters',
          title: 'Filtering the log',
          body: [
            'Six filter inputs sit above the table. Nothing is applied while you type. The filters are drafts until you press Apply, which also resets you to page 1. This is deliberate: the log is server-side paginated, so each change would otherwise be a fresh query.',
            'The Actor Email and Action boxes are free text with suggestion lists attached. The suggestions are fetched once per visit from the values actually present in the log, so they never offer a value that would return nothing, but you are not restricted to them, and a partial value such as "role_" still filters.',
          ],
          steps: [
            'Set any combination of Actor Email, Action, Resource Type, Resource ID, From and To.',
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
              how: 'Use the suggestions to learn the vocabulary. The exact action strings come from the backend, not from a fixed frontend list.',
            },
            {
              name: 'Resource Type',
              kind: 'filter',
              what: 'A dropdown built from the resource types the log actually contains, plus "All resources". A value carried in from a link that is no longer in the list stays selectable rather than silently resetting.',
            },
            {
              name: 'Resource ID',
              kind: 'filter',
              what: 'Restricts entries to those whose Resource ID contains what you type, ignoring case: a user\'s email, a role name, a job, candidate or offer id. The box shows "Exact ID" as its placeholder, but pasting a whole id is only the most precise way to use it; a part of an id matches too.',
              how: 'Use it to follow one record through its whole history, for example every change made to one job or one user. Copy the value from the Resource ID column of an entry you already found. Combine it with Resource Type when the same id could mean different things.',
            },
            { name: 'From', kind: 'filter', what: 'Start of the date range, sent as start_date. Inclusive.' },
            { name: 'To', kind: 'filter', what: 'End of the date range, sent as end_date.' },
            { name: 'Apply', kind: 'button', what: 'Commits the draft filters, resets to page 1 and re-queries the log.' },
            { name: 'Clear', kind: 'button', what: 'Empties every filter and re-queries. Only rendered while at least one filter is applied.' },
            { name: '↻ Refresh', kind: 'button', what: 'The header action on this tab, re-reads the current page with the current filters. Reads "Refreshing…" while in flight.', how: 'The log is written by everything else in the platform, so re-reading is the only useful action here. Use it after performing an action in another tab to see the entry appear.' },
          ],
          tips: [
            'The log loads lazily. Opening /dashboard/users never queries it. It is only fetched when you open this tab, which is also when the tab\'s count badge first appears.',
          ],
        },
        {
          id: 'audit-table',
          title: 'Reading an entry',
          controls: [
            { name: 'Date/Time', kind: 'column', what: 'When the action was recorded, in day/month/year local format. Falls back to the raw string if the timestamp cannot be parsed.' },
            { name: 'Actor', kind: 'column', what: 'The email of whoever performed the action, or a dash when the entry has no actor recorded.' },
            { name: 'Action', kind: 'column', what: 'The action name as a blue badge, e.g. role_update, role_assign.' },
            { name: 'Resource Type', kind: 'column', what: 'What kind of thing was changed, the same vocabulary as the Resource Type filter.' },
            { name: 'Resource ID', kind: 'column', what: 'The identifier of the specific record touched. Paste it into the corresponding filter elsewhere in the product to find the record.' },
            { name: 'Details', kind: 'column', what: 'Whatever context the call site recorded, flattened to "key: value · key: value" pairs, for a role change, typically old_role and new_role. Truncated in the cell; hover for the full text.' },
          ],
          faqs: [
            {
              q: 'The table says "No audit entries match these filters."',
              a: 'The query succeeded and returned nothing. Widen the date range or clear the Action box. Actor Email, Action and Resource ID match any entry that contains what you typed, ignoring case, so a typo returns an empty page rather than an error.',
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
  blurb: 'How the platform behaves: which AI model runs by default, what candidates receive by email, what the AI is told to do, who gets notified over HTTP, how strict sign-in security is, and whether email is really leaving the platform.',
  sections: [
    {
      id: 'settings-system',
      title: 'System tab',
      path: '/dashboard/settings',
      summary:
        'Platform volume, the default AI model, backend health and environment, and a live check of each dependency. The one decision on this tab is which large language model your company uses by default.',
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
          id: 'models-by-job',
          title: 'Choosing the model for each job',
          body: [
            'Models by Job lists every AI job under three headings. Interview: questions, follow-ups and scoring; interview guides and summary drafts; scenario answer scoring; the interviewer voice (text to speech); and candidate answers (speech to text). Hiring: CV classification, job description parsing, the match second opinion, offer letter drafting and the embeddings that match CVs to jobs. Coding: coding question generation, the code quality review and the code correctness review. Each row has a dropdown and the list price of the model the job runs on now.',
            'The first option, Default, leaves the job on its standard model, named in brackets. The rest are the models that job accepts, in one block per provider (Anthropic, then OpenAI), cheapest first. A model whose provider has no key on this platform is greyed out and marked (not set up). Choosing a model saves at once; there is no separate save. The sidebar has no model picker and there is no company-wide default card: every job is set here.',
            'The choice belongs to your company alone. It applies to every user in it from the next time that job runs, and it does not re-run anything that already ran. A request that names its own model still wins over the row.',
            'Embeddings are different. Two embedding models place the same text in different spaces, so a CV and a job made by different models cannot be compared. Every stored vector records the model that made it and a search only sees vectors made by the model in use. After you switch, a notice counts the jobs and CVs the old model made, and Re-embed now makes them again in small batches, jobs first and then CVs. Until it finishes those documents do not match, and Re-match skips a job that has not been re-embedded yet. Re-embedding is billed as embedding spend and stops, with the reason in a toast, when the monthly AI budget is spent.',
            'Models that think before answering bill that thinking as output, so the platform asks them for low reasoning effort by default (the LLM_EFFORT setting: low, medium, high, xhigh or max). Claude Haiku 4.5 does not think, so the setting does not apply to it.',
          ],
          steps: [
            'Open Platform Settings. The System tab is the default, so no query string is needed.',
            'Find the job under Models by Job and open its dropdown.',
            'Choose a model. A toast names the job and the model it now runs on; a refusal toasts the server\'s reason.',
          ],
          controls: [
            { name: 'Job dropdown', kind: 'field', what: 'One per job. Default follows the standard model for that job; the other options are the models that job accepts, grouped by provider. Saving calls PUT /model-tasks/{job}.', how: 'The dropdown is disabled while its own change is saving, so a double change cannot race two writes.' },
            { name: 'Price', kind: 'badge', what: 'The list price of the model the job runs on now: US dollars per 1M input and output tokens for chat models, per 1M tokens for embeddings, per 1M characters or per minute for speech.' },
            { name: '(not set up)', kind: 'badge', what: 'Marks a model whose provider has no key on this platform. It cannot be chosen; whoever runs the deployment adds the key in the environment.' },
            { name: 'Re-embed now', kind: 'button', what: 'Makes the vectors again for the jobs and CVs the previous embedding model made. It calls POST /model-tasks/embedding/reindex until the server says it is done.', how: 'Shown only while some documents were made by another model. While it runs the button reads Re-embedding and the notice counts how many are done; leaving the page stops it and it can be started again where it left off.' },
            { name: 'Retry', kind: 'button', what: 'Shown with the error when the list of jobs could not be loaded.' },
          ],
          warnings: [
            'A model whose provider key is missing is refused when you choose it, so a job cannot be moved onto a model that would fail at first use. If a key is removed later, jobs already on that provider fail quietly at the next call.',
            'Changing a job to a stronger model changes cost and output quality for that job at once. If scoring or question generation changed unexpectedly, check its row first.',
          ],
          tips: [
            'One CV is a single short model call, about 1,370 input and 210 output tokens, which cost roughly $0.0024 on Claude Haiku 4.5 when measured on the real service: 200 CVs come to about $0.50 plus a few cents of embeddings. The same call costs a few times that on a stronger model, so read the price beside a job before you move it.',
          ],
        },
        {
          id: 'environment',
          title: 'Environment and health',
          controls: [
            { name: 'Backend Status', kind: 'badge', what: 'Live result of the /health probe: "✓ Online" in green, "✗ Offline" in red, or an ellipsis while checking.', how: 'This is the fastest triage step when an admin page shows an error or an empty table. A few panels, Email Templates among them, still show an empty list when the backend cannot be reached; this readout does not.' },
            { name: 'Active Modules', kind: 'badge', what: 'The module names the backend reports as enabled. Only rendered when the health response includes them.' },
            { name: 'API Base URL', kind: 'badge', what: 'The origin this build sends API calls to. Deployed, the API shares the site origin and this shows that origin; set VITE_API_BASE_URL only when the API lives on a different host.' },
            { name: 'API Version', kind: 'badge', what: 'The API namespace in use: v1.' },
            { name: 'Platform Version', kind: 'badge', what: 'The version the backend reports through its health check. It shows a dash when the backend does not report one.' },
          ],
        },
        {
          id: 'live-check',
          title: 'Live Check',
          body: [
            'Backend Status only says the API answers. The Live Check section goes further and tests the things the platform depends on, one at a time.',
          ],
          steps: [
            'Open Platform Settings. The Live Check section is the last block on the System tab.',
            'Click Run live check. The button reads "Checking…" while it runs.',
            'Read the list. Each dependency has its own row: database, Anthropic key, OpenAI key, vector index and code sandbox.',
          ],
          controls: [
            { name: 'Run live check', kind: 'button', what: 'Probes each dependency and lists the result. The time of the last successful run is shown beside the button.', how: 'Run it after changing a key or an environment setting, and whenever a feature stops working and you do not know which dependency is behind it.' },
            { name: 'OK / Failed', kind: 'badge', what: 'Green OK or red Failed for each dependency, followed by how long the probe took in milliseconds and a short detail line.', how: 'The detail line carries the reason for a Failed row. Read it before anything else.' },
          ],
          faqs: [
            {
              q: 'A red message says there were too many checks.',
              a: 'The check is rate limited. The message is the server\'s own, and the results from your last successful run stay on screen under it. Wait a little and run it again.',
            },
          ],
        },
      ],
    },
    {
      id: 'settings-email',
      title: 'Email Templates tab',
      path: '/dashboard/settings?tab=email',
      summary:
        'The wording of the emails candidates receive. Every email has a ready-made sample, so you start from something good and change only what you need. Until you save your own version, the built-in default is sent.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'email-list',
          title: 'The template list',
          controls: [
            { name: 'Template', kind: 'column', what: 'The name of the email.' },
            { name: 'Status', kind: 'column', what: 'Customized (blue) when your own text is saved, Default (grey) when the built-in text is in use.' },
            { name: 'Edit', kind: 'button', what: 'Opens the editor for that template.' },
            { name: 'Reset to Default', kind: 'button', what: 'Deletes your version so the built-in text is used again. Only rendered on rows that are actually customised.' },
          ],
          tips: [
            'Scan the Status column first. Anything showing Customized is text your company wrote and owns. It will not pick up product improvements to that email.',
            'The list has eight templates. "Interview on Another Platform" is the email a candidate gets when you set up, or change, an interview on Zoom, Google Meet, Microsoft Teams or another tool. It is optional like the others: leave it on Default unless you want your own wording. It carries the platform, the time, the join link and your note only, with a calendar invite file attached, and never a score or review content. "Physical Interview Call" is the same for an interview in person: the time, how long it takes, the address with a map link and your note. The reminder the platform sends before such an interview is not editable here.',
            'Every email is in your company\'s own look: the brand colour as a band across the top, your logo on the left of it and the kind of email on the right, and a sign-off with your company name. The colour and logo come from Organization, Branding; the name from Organization. A saved template keeps the look it was saved with; to pick up the new one, Reset to Default or open the ready-made sample and save it again.',
          ],
        },
        {
          id: 'edit-email-template',
          title: 'Edit a template',
          steps: [
            'Click Edit on the template row. The editor opens on your saved text, or on the sample if you have not saved any.',
            'Read the one-line red warning: the email goes straight to the candidate, so it must never include scores, evaluation results or recommendations.',
            'Change the Subject and the Message. Click a placeholder button to insert it where your cursor is.',
            'Click Preview to see the message with example values filled in, then Edit to go back.',
            'Open Plain-text version only if you want to change what a text-only mail client shows.',
            'Click Save Template.',
          ],
          controls: [
            { name: 'Insert a placeholder', kind: 'badge', what: 'One button per {{name}} token the email can fill in. Clicking one inserts it at the cursor in the field you used last: Subject, Message or Plain-text version. From the Preview it returns to the message and adds the token at its end. Only these tokens are filled in; anything else is sent as written.' },
            { name: 'Subject', kind: 'field', what: 'The subject line. It opens on the sample subject.' },
            { name: 'Message', kind: 'field', what: 'The HTML of the email. It opens on the sample, which has the same look as the built-in default.' },
            { name: 'Edit / Preview', kind: 'tab', what: 'Switches the message between its text and a rendered preview with example values (a sample candidate, job and links). The preview runs nothing: its frame has no scripts and no permissions, and a placeholder that is misspelled shows up as written.' },
            { name: 'Plain-text version', kind: 'field', what: 'Folded away until you open it. The plain-text part, which is what a text-only mail client shows.', how: 'If you change the message, change this too, otherwise the two versions of the same email say different things.' },
            { name: 'Use sample', kind: 'button', what: 'Puts the sample wording back into the editor without saving. Shown only when the text differs from the sample.' },
            { name: 'Save Template', kind: 'button', what: 'Saves the three fields as your version via PUT /email-templates/{key}. Disabled until something changes.' },
            { name: 'Reset to Default', kind: 'button', what: 'Also present in the editor footer for a customised template. Confirms, then deletes your version.' },
            { name: 'Cancel', kind: 'button', what: 'Closes without saving.' },
          ],
          warnings: [
            'A candidate-facing template must never contain interview scores, evaluation results, recommendations or report content. The editor shows a fixed red warning above every candidate-facing template for exactly this reason: candidates may only ever receive a link and plain instructions. Scores and reports are admin-only and are never emailed to candidates regardless of what is typed here.',
            'Reset to Default deletes your saved subject and body outright. There is no version history. Copy the text somewhere before resetting if you may want it back.',
          ],
          faqs: [
            {
              q: 'What actually changes downstream when I edit a template?',
              a: 'Each template corresponds to one send function on the backend. Editing the interview-invite template changes the mail candidates receive when they are invited; editing the assessment template changes the assessment invite, and so on. The send is otherwise unchanged, same trigger, same recipient, different words.',
            },
            {
              q: 'I opened a template and the text is already filled in. Is it live?',
              a: 'No. That is the sample, offered as a starting point. Until you save, candidates still get the built-in default, which looks the same but is not word for word identical. Save Template stays disabled until you change something.',
            },
            {
              q: 'I cleared a field and saved, but the old text is still there.',
              a: 'Blank means "use the built-in default for this field", and blank fields are simply not stored. To remove your customisation entirely, use Reset to Default.',
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
        'Outbound HTTP subscriptions. When a recruiting event happens, such as a candidate being invited or an offer being accepted, every active subscription listening for that event receives a POST. This is also the delivery mechanism behind the fire_webhook workflow action.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'webhook-list',
          title: 'The subscriptions table',
          controls: [
            { name: '+ Add Webhook', kind: 'button', what: 'Opens the Add Webhook modal.' },
            { name: 'URL', kind: 'column', what: 'The endpoint that receives the POST.' },
            { name: 'Event Types', kind: 'column', what: 'The events this subscription listens for, shown as chips with their readable names. A name the platform does not know is flagged.', how: 'A flagged chip is a leftover from before the list of events was fixed. It keeps delivering until you edit the subscription, and it cannot be saved again, so remove it there.' },
            { name: 'Format', kind: 'column', what: 'RAW, SLACK or TEAMS, how the payload is shaped before sending.' },
            { name: 'Status', kind: 'column', what: 'Active (green) or Inactive (grey). Inactive subscriptions are kept but never fired. A blue "Secret set" badge beside it means the subscription has its own signing secret.' },
            { name: 'Send test', kind: 'button', what: 'Sends a test delivery to that URL right now. The row then shows a green Delivered or a red Failed badge, the HTTP status the receiver answered with, and a line of detail.', how: 'The result stays on the row until you test again, so you can read the detail without a timer running. Test after every create or URL edit. A typo in the URL is otherwise invisible until a real event is dropped.' },
            { name: 'Deliveries', kind: 'button', what: 'Opens a side panel with the last 50 deliveries to that URL, newest first. Each row has Sent or Failed, the event, the HTTP status, how long the call took in ms, how long ago it happened and the error, if there was one.', how: 'Refresh re-reads the list. Esc or the close button shuts the panel. Use it first when a receiver says it never got an event.' },
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
            'Tick the events you want in Event Types *, or tick All events. At least one is required.',
            'Choose a Format. Raw sends the JSON payload; Slack and Teams wrap it as a short human-readable summary line for those products\' incoming webhook / connector formats.',
            'Optionally type a Signing secret. Leave it empty to sign with the platform-wide secret.',
            'Click Create. Then click Send test on the new row to confirm the endpoint answers.',
          ],
          controls: [
            { name: 'URL *', kind: 'field', what: 'The destination. Required. The save button stays disabled until it is filled and at least one event is ticked. The address must be a public https or http address; a private or loopback address is refused.' },
            { name: 'Event Types *', kind: 'field', what: 'A checklist of the events the platform can announce, each with its readable name, plus an All events box that ticks every one of them. The events are: Candidate invited, Candidate status changed, Candidate hired, Candidate rejected, Interview completed, Interview scheduled on another platform, Scorecard submitted, Offer created, Offer sent, Offer accepted, Offer declined and Job created.', how: 'A name the platform does not know shows as a flagged chip with an Unknown label and a button to remove it. Saving with one is refused with a red "Unknown event type(s): ..." message under the form, and nothing is stored.' },
            { name: 'Format', kind: 'field', what: 'Raw (default JSON payload), Slack (incoming webhook) or Teams (channel connector).', how: 'Pick Slack or Teams when the URL is a chat incoming-webhook. The raw payload would render as an unreadable blob there.' },
            { name: 'Signing secret', kind: 'field', what: 'Optional. A password-style field that signs this subscription\'s deliveries so the receiver can verify them. With no secret here, the platform-wide signing secret is used.', how: 'It is write-only: the platform never sends a stored secret back to the screen. A blue "Secret set" badge shows beside the label when one is stored, and the field then reads "Leave empty to keep the current secret". Type a new value to replace it.' },
            { name: 'Active', kind: 'toggle', what: 'Only on the edit modal. Clearing it stops deliveries without deleting the subscription and losing its configuration.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the subscription. Disabled while URL is blank or no event is ticked.' },
          ],
          warnings: [
            'Deleting a webhook is immediate and cannot be undone; the URL and event list are gone. If you only want to stop deliveries temporarily, edit it and clear Active instead.',
          ],
          faqs: [
            {
              q: 'A workflow rule with the fire_webhook action does nothing.',
              a: 'That action posts the trigger context under one event name: the event_type in its Action Params if it has one, otherwise the trigger\'s own name, such as candidate_invited. A subscription only receives it if it lists that exact name, and subscriptions made from the checklist use names like candidate.invited. Put {"event_type": "candidate.invited"} in the rule\'s Action Params, then check the Deliveries panel to see whether the call went out.',
            },
            {
              q: 'Send test says Failed.',
              a: 'The delivery attempt itself failed: a bad URL, an unreachable host, or the receiver answered with an error. The row shows the HTTP status and the detail. A test is a single attempt, so fix the cause and test again.',
            },
            {
              q: 'A webhook fires, but I never hear when a delivery fails.',
              a: 'Open Deliveries on that row to see every recent attempt with its error. The Webhook Delivery Failed alert on Organization → Branding & Notifications also emails the notify address when a delivery fails, at most once an hour for the same webhook.',
            },
          ],
        },
      ],
    },
    {
      id: 'settings-security',
      title: 'Security Policies tab',
      path: '/dashboard/settings?tab=security',
      summary:
        'Password rules, account lockout and an optional session timeout, applied to every account. An HR Admin can read the policy; only a Super Admin can change it.',
      access: 'HR Admin (read only) & Super Admin (read and change)',
      subsections: [
        {
          id: 'security-policy-form',
          title: 'Reading and changing the policy',
          body: [
            'The card holds three groups of settings. As an HR Admin you see the same values a Super Admin does, but the fields are disabled, a grey Read only badge sits beside the card title, and there is no Save Changes button. If your role cannot read the policy at all, the card says so in one line.',
            'If the stored policy cannot be read, the form is not drawn. A form of default values would look like the real policy, and saving it would overwrite the real one. A red message with a Retry button shows instead.',
          ],
          steps: [
            'Open Platform Settings and click the Security Policies tab.',
            'Change the fields you need under Password Policy, Account Lockout and Session Timeout.',
            'Click Save Changes. A "Security policies saved" toast confirms it.',
          ],
          controls: [
            { name: 'Read only', kind: 'badge', what: 'Shown beside the card title when your role cannot change the policy. The fields are disabled and Save Changes is not offered.', access: 'Shown to HR Admin' },
            { name: 'Minimum Password Length', kind: 'field', what: 'The fewest characters a password may have. A whole number of at least 1.', how: 'The shipped value of 1 asks for nothing, so the rules line under the password fields stays empty until you raise it.', access: 'Super Admin to change' },
            { name: 'Require a number', kind: 'toggle', what: 'A new password must contain a digit.', access: 'Super Admin to change' },
            { name: 'Require a symbol', kind: 'toggle', what: 'A new password must contain a symbol.', access: 'Super Admin to change' },
            { name: 'Max Failed Login Attempts', kind: 'field', what: 'How many wrong passwords lock an account. 0 turns account lockout off entirely.', how: 'Lockout is counted on password sign-in only. Single sign-on has no lockout.', access: 'Super Admin to change' },
            { name: 'Lockout Duration (minutes)', kind: 'field', what: 'How long a locked account stays locked, at least 1. It only applies once an account is actually locked.', access: 'Super Admin to change' },
            { name: 'Override the platform\'s default session timeout', kind: 'toggle', what: 'Ticking it reveals Session Timeout (minutes), starting at 60. Unticked, sign-ins keep the platform\'s default token lifetime.', how: 'Unticking the box and saving clears the override. A shorter timeout signs people out sooner, and a 401 sends them to the login page and loses any unsaved form.', access: 'Super Admin to change' },
            { name: 'Save Changes', kind: 'button', what: 'Checks the values first and shows the problem in a toast, such as "Minimum password length must be a whole number of at least 1", then saves.', access: 'Super Admin only' },
            { name: 'Last saved', kind: 'badge', what: 'Who saved the policy last and when, shown beside the button once a policy has been saved.' },
            { name: 'Retry', kind: 'button', what: 'Reads the policy again after a failed read.' },
          ],
          warnings: [
            'This policy applies to everyone. A stricter password rule applies the next time a password is set, whether that is a new account, a reset by an admin or someone changing their own, and the rules are shown under each of those fields. Existing passwords are not checked again.',
            'Raising Max Failed Login Attempts from 0 turns lockout on for every account at once. A locked account has no unlock control; it opens again when the lockout duration ends.',
          ],
        },
      ],
    },
    {
      id: 'settings-delivery',
      title: 'Email Delivery tab',
      path: '/dashboard/settings?tab=delivery',
      summary:
        'Whether the email the platform sends is really leaving it. The tab shows the email provider, the last seven days of sending, interview invites that never went out, a test email, and the failed invites that can be sent again.',
      access: 'HR Admin & Super Admin (needs the email:manage permission)',
      subsections: [
        {
          id: 'delivery-status',
          title: 'Delivery status',
          body: [
            'With no email provider set up, invite, status and offer emails are only written to the server log and the email log. They are not delivered to anyone, although the rest of the app behaves as if they were. This tab is where you see that. If your role lacks email:manage, the tab shows a one-line notice in place of the cards.',
          ],
          controls: [
            { name: 'Configured / Not configured', kind: 'badge', what: 'Green when a provider is set up, yellow when none is. A line beside it says whether outbound email is being delivered.' },
            { name: 'Verify connection', kind: 'button', what: 'Connects to the mail provider and signs in without sending a message, then shows "Connection OK" or "Connection failed" with the reason.', how: 'Run it after changing the mail settings. It is rate limited, and says so if you press it too often.' },
            { name: 'Refresh', kind: 'button', what: 'Reads the tab again.' },
            { name: 'Provider / From address', kind: 'column', what: 'SMTP or Amazon SES (or None), and the address mail is sent from. The mail server\'s own address, passwords and keys are not shown to a company\'s admins.' },
            { name: 'Warnings', kind: 'badge', what: 'A list of configuration problems the platform found, such as a missing sender address, in plain words.' },
          ],
        },
        {
          id: 'delivery-sending',
          title: 'Sending, testing and resending',
          controls: [
            { name: 'Last 7 Days', kind: 'column', what: 'Three counts: Sent, Failed, and Console only, which are emails that were logged but not delivered because no provider was set up.' },
            { name: 'Waiting Invites', kind: 'column', what: 'The number of candidates whose AI-interview invite was never delivered at all and is still open. Candidates who have been interviewed, whose invite has expired, or who now interview on another platform are not counted.' },
            { name: 'Send waiting invites', kind: 'button', what: 'Sends the invite to up to 25 of those candidates and reports "Sent N, failed N", with how many are skipped and how many are still waiting.', how: 'Disabled when nothing is waiting. Use it once the provider works, to catch up on invites created while it did not.' },
            { name: 'Send to / Send test email', kind: 'field', what: 'Sends one plain message to the address you type and says "Test email delivered to <address>." or "Not delivered:" with the reason.', how: 'This is the quickest end-to-end check of the provider, the sender address and the inbox. Too many test emails in a short time are refused with a message to wait a minute.' },
            { name: 'Recent Failures', kind: 'column', what: 'The newest failed emails: To, Subject, Kind (Interview invite, Status, Offer or Other), When and the Error, with a hint underneath where the platform has one.', how: 'The Needs attention icon in the top bar counts failed emails from the last 24 hours and opens this tab.' },
            { name: 'Resend selected', kind: 'button', what: 'Sends the ticked failed invites again. Only interview invites can be ticked; other kinds are listed for reference.', how: 'A resend summary follows: attempted, delivered, failed and skipped, with the reasons for skips, such as the invite link having expired or the interview already being completed.' },
            { name: 'Resend all eligible invites', kind: 'button', what: 'After a confirmation that every failed interview invite will be emailed to its candidate again, resends them, up to 25 per run.' },
          ],
          warnings: [
            'A resend emails real candidates. The invite carries a link and instructions only, never a score, but check that the provider works with Send test email first so you do not fail the same invites twice.',
          ],
        },
      ],
    },
  ],
}

const organizationChapter: GuideChapter = {
  id: 'organization',
  title: 'Organization',
  blurb: 'Who this company is, what it looks like, and how it is structured, company profile, integration status, branding, notifications, departments and designations.',
  sections: [
    {
      id: 'org-company',
      title: 'Company Profile tab',
      path: '/dashboard/organization',
      summary:
        'Your company\'s identity details, plus a read-only board showing which external services and job boards have credentials configured.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'plan-and-usage',
          title: 'Plan and usage',
          body: [
            'The card at the top of this tab shows the plan your company is on and how much of it you have used. The limits are set by the platform owner and cannot be changed here; ask them to raise one.',
          ],
          controls: [
            { name: 'Users', kind: 'badge', what: 'Active accounts against the plan\'s limit, for example 12 of 25, with a bar. Unlimited when the plan sets no limit.', how: 'At the limit, creating or signing up a new user is refused with "Your plan allows at most N users."' },
            { name: 'AI spend, <month>', kind: 'badge', what: 'This calendar month\'s AI cost against the plan\'s monthly budget, with a bar. Unlimited when there is no budget.', how: 'The bar turns yellow at 80% and red at 100%. At the budget, uploading résumés, creating or importing jobs and generating guides, offers or coding questions are refused until the month ends or the budget is raised. A candidate\'s interview in progress is never stopped.' },
            { name: 'Storage', kind: 'badge', what: 'Résumé files, photos, letterheads and signatures stored, in MB, against the plan\'s cap, with a bar. Unlimited when the plan sets no cap.', how: 'The bar turns yellow at 80% and red at 100%. Once the store is full, uploading a résumé is refused with "Your plan\'s storage is full" until something is deleted or the cap is raised.' },
            { name: 'Emails, last 30 days', kind: 'badge', what: 'How many emails the company sent in the last 30 days.' },
            { name: 'Subscription chip', kind: 'badge', what: 'Beside the plan name: Trial, Active, Past due or Canceled. Nothing shows for a company with no subscription.' },
            { name: 'Trial and past due banners', kind: 'badge', what: 'While your workspace is on a trial, a banner gives the end date and the days left, and becomes an alert in the last three days. A subscription that is past due shows an alert above the figures.', how: 'When a trial or a subscription has ended, everyone in the company is signed out, and the sign-in page says "This workspace\'s trial has ended. Ask your administrator to subscribe." or "This workspace\'s subscription has ended. Ask your administrator to renew." Nothing is deleted; access returns once the platform owner renews it.' },
          ],
        },
        {
          id: 'company-profile-form',
          title: 'Editing the company profile',
          steps: [
            'Open Organization. The Company Profile tab is the default.',
            'Fill in the fields you need. Nothing here is required, and blanks are saved as blanks.',
            'Click Save Changes. The form re-renders from the server\'s response, and a "Company settings saved" toast confirms it.',
          ],
          controls: [
            { name: 'Company Name', kind: 'field', what: 'The name of your company. Each company has its own profile, branding, users and data, and this screen only ever shows and changes your own.' },
            { name: 'Industry', kind: 'field', what: 'Free-text industry description, e.g. Software & Technology.' },
            { name: 'Company Size', kind: 'field', what: 'Free text, e.g. 51-200 employees. Not validated or parsed.' },
            { name: 'Website', kind: 'field', what: 'Your public site URL.' },
            { name: 'Primary Contact Email', kind: 'field', what: 'The HR contact address for your company. Typed as an email input, so the browser flags an obviously malformed value.' },
            { name: 'Address', kind: 'field', what: 'Single-line postal address; spans the full width of the form.' },
            { name: 'Terms link', kind: 'field', what: 'The address of your terms page. It shows as Terms at the foot of the sign-in page and of every page a candidate is sent, and opens in a new tab.', how: 'It must start with https://. Anything else is refused before it is sent, and a refusal from the server shows under the two link fields. Blank clears it.' },
            { name: 'Privacy link', kind: 'field', what: 'The address of your privacy page, shown as Privacy beside Terms. Same rule: https:// only, blank clears it.' },
            { name: 'Save Changes', kind: 'button', what: 'PATCHes the eight fields together. Reads "Saving…" while in flight.' },
            { name: 'Last saved', kind: 'badge', what: 'Timestamp of the previous successful save, shown next to the button once the record has an updated_at.' },
            { name: 'Retry', kind: 'button', what: 'Shown with a red message in place of the form when the company profile could not be read. Save Changes stays disabled until a read succeeds.', how: 'A blank form would look like an empty profile, and saving it would overwrite the stored one with blanks.' },
          ],
        },
        {
          id: 'integrations-status',
          title: 'Integrations Status',
          body: [
            'A read-only board in two groups: Core Services (the AI providers, mail, code sandbox and sign-in services the platform depends on) and Job Board Sources (the external boards Hirely can import jobs from). The groups and rows come from the server, so a service added to the platform later appears here without a change to the screen. Anthropic, Amazon SES, Zoom, Microsoft Teams and the HRMS connector are listed when the server reports them.',
            'Each row is either Configured or Not Configured. That reflects only whether a key or address is present on the backend. Actual secret values are never shown here and are never transmitted to the browser. There is nothing to edit on this card; credentials are environment configuration, set outside the app.',
            'The code sandbox has two possible engines, Judge0 and Piston, and the platform uses only the one it is set to. Only that one can read Configured. The other reads Not in use, even if an address is set for it, because an address for the engine that is not in use does not make code execution work.',
          ],
          controls: [
            { name: 'Read-only', kind: 'badge', what: 'Marks the whole card as informational. There is no edit path for these values in the UI.' },
            { name: 'Core Services', kind: 'column', what: 'Group heading for the platform\'s own dependencies.' },
            { name: 'Job Board Sources', kind: 'column', what: 'Group heading for external job feeds available to the job import feature.' },
            { name: 'Free', kind: 'badge', what: 'Marks a job source that needs no API key. Those sources are usable immediately.' },
            { name: 'Configured', kind: 'badge', what: 'Green, a credential is present for that service.' },
            { name: 'Not Configured', kind: 'badge', what: 'Grey, no credential. Features depending on that service will not work until it is set on the backend.' },
            { name: 'Not in use', kind: 'badge', what: 'Grey, on the code sandbox engine the platform is not set to use.' },
            { name: 'Retry', kind: 'button', what: 'Shown with "Could not load integrations status." when the board could not be read.', how: 'This card is read from the backend\'s own settings, not the database, so a failure here means the API itself is not reachable.' },
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
            'Click Upload logo and choose a PNG or JPEG of up to 1 MB, or paste an https address into Or use a link to a logo. Leave both empty to keep the default Hirely mark.',
            'Set Primary Color and Accent Color, either with the colour swatch or by typing a hex code.',
            'Optionally fill in the Offer Letterhead Header and Footer, or upload a .docx letterhead template.',
            'Check the Live Preview panel. It re-renders as you type, showing the logo, a primary button and an accent badge.',
            'Click Save Branding.',
          ],
          controls: [
            { name: 'Upload logo', kind: 'button', what: 'Opens a file chooser for your logo: a PNG or JPEG of up to 1 MB. It is uploaded at once and becomes your logo everywhere (the sign-in page, the sidebar and the offer letter), without waiting for Save Branding. SVG files are refused because they can carry script.', how: 'The file type is read from the file itself, not its name. The preview updates as soon as the upload finishes.' },
            { name: 'Remove logo', kind: 'button', what: 'Takes the logo away, uploaded or linked, and returns to the default Hirely mark. Shown only when there is a logo.' },
            { name: 'Or use a link to a logo', kind: 'field', what: 'An absolute https image address, for a logo that is already hosted somewhere. With an uploaded logo this box is empty and says so. Typing a link here replaces the uploaded file once you click Save Branding.', how: 'The address must start with https and point to a public address that anyone can reach without signing in. The server fetches it when it builds an offer letter, so an address on a private network, or one that needs a login, is refused when you save.' },
            { name: 'Primary Color', kind: 'field', what: 'The main brand colour. Two inputs that stay in sync: a native colour swatch and a hex text box. Default #4778f3.' },
            { name: 'Accent Color', kind: 'field', what: 'The secondary brand colour. Default #222022.' },
            { name: 'Offer Letterhead Header', kind: 'field', what: 'A line of text printed at the top of generated offer-letter PDFs and, on the first page, of interview report PDFs.' },
            { name: 'Offer Letterhead Footer', kind: 'field', what: 'A line of text printed at the bottom of generated offer-letter PDFs and of every page of interview report PDFs.' },
            { name: 'Upload .docx Template / Replace Template', kind: 'button', what: 'Uploads a Word document to use as the offer-letter letterhead. Its header and footer text and its embedded logo are read out of the file. Only .docx files are accepted.', how: 'Once a template is uploaded it shows a green Active badge, with its file name, whether a logo was found and how many body paragraphs it has, and it takes priority over the plain-text header and footer above. Until then the card reads "No template uploaded yet: the plain-text fields above are used instead." Needs the offers:manage_letterhead permission.' },
            { name: 'Live Preview', kind: 'badge', what: 'A miniature card showing your logo (or an "HR" placeholder tinted with the primary colour), a Primary Button and an Accent Badge.' },
            { name: 'Reset to Defaults', kind: 'button', what: 'Asks "Reset branding to the defaults?" and, if you agree, puts the form back to the shipped defaults: blank logo, #4778f3, #222022 and blank letterhead text.', how: 'This only changes the form. Nothing is saved until you also click Save Branding, so you can back out by switching tabs instead.' },
            { name: 'Save Branding', kind: 'button', what: 'Validates the colours and PATCHes the five values: logo, both colours, letterhead header and footer.' },
            { name: 'Last saved', kind: 'badge', what: 'Timestamp of the previous successful branding save.' },
            { name: 'Retry', kind: 'button', what: 'Shown with a red message in place of the branding form when it could not be read. Reset to Defaults and Save Branding stay disabled until a read succeeds.' },
          ],
          warnings: [
            'Both colours must be 6-digit hex codes including the leading hash, e.g. #4778f3. A 3-digit shorthand or a named colour is rejected client-side with the toast "Colors must be valid 6-digit hex codes, e.g. #4778f3" and nothing is sent.',
            'Branding is applied at page load. The success toast says so, "reload other open tabs to see it applied there too". Colleagues with the app already open keep the old palette until they refresh.',
          ],
        },
        {
          id: 'notification-settings',
          title: 'Notification Settings',
          body: [
            'A single destination mailbox plus a checkbox per internal event. The event list comes from the backend, so it grows without a frontend change; each row carries its own label and description. Every event is off until you tick it.',
            'These alerts are sent. When a ticked event happens, the platform emails the notify address. The events are Offer Declined, Candidate Flagged for Integrity, Job Import Failed, Coding Submission Execution Failed and Webhook Delivery Failed. The email names the event and the candidate, job, offer or webhook involved, and links to the sign-in page. It never carries scores or report text.',
            'The same item sends at most one email an hour, so a job import that keeps retrying, or a webhook that keeps failing, does not fill the inbox. An alert is mail like any other: it is only delivered if the platform has an email provider, which you can check on Platform Settings → Email Delivery.',
          ],
          controls: [
            { name: 'Notify Email', kind: 'field', what: 'The internal mailbox the alerts are sent to. Not a candidate-facing address.' },
            { name: 'Event checkbox', kind: 'toggle', what: 'One per event, with the event\'s label and description. Ticking turns that alert on once you save.' },
            { name: 'Send test notification', kind: 'button', what: 'Sends one test message to the notify email as it is saved and shows the outcome beside the buttons: a green Sent or a red Failed, then the address and the reason.', how: 'It is disabled, with the tooltip "Save the notify email first", while the box holds an address that differs from the saved one, because a test goes to the saved address and not to what you have typed. Use it after changing the address.' },
            { name: 'Save Notification Settings', kind: 'button', what: 'Sends the address plus an event → enabled map, then re-renders from the response.' },
            { name: 'Last saved', kind: 'badge', what: 'Timestamp of the previous successful save.' },
            { name: 'Retry', kind: 'button', what: 'Shown with a red message in place of the form when the settings could not be read. Send test notification and Save Notification Settings stay disabled until a read succeeds.' },
          ],
          faqs: [
            {
              q: 'I enabled an event but never received an email.',
              a: 'Work down this list. Is the event ticked and saved? Is the notify address the one you expect? Does Send test notification say Sent? Does Platform Settings → Email Delivery show a configured provider? Without one, mail is only written to the server log. Last, an alert for the same item is sent once an hour, so a second one inside that hour is held back.',
            },
          ],
        },
      ],
    },
    {
      id: 'org-departments',
      title: 'Departments, Designations & Grades tab',
      path: '/dashboard/organization?tab=departments',
      summary:
        'The two reference lists that everything else scopes to: departments (used by jobs, users and designations) and designations (job titles, each optionally belonging to a department), plus a list of job grades. Each list has its own add button.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'departments-table',
          title: 'Departments',
          body: [
            'The key column here is Used by. The backend returns a reference count per department, designations, jobs and users, and the table renders it as chips such as "2 designations · 1 job". A department nothing points at reads "Not referenced" and is safe to remove.',
          ],
          controls: [
            { name: '+ Add Department', kind: 'button', what: 'Opens the Add Department modal.' },
            { name: 'Name', kind: 'column', what: 'The department name. This string is what designations and jobs refer to.' },
            { name: 'Used by', kind: 'column', what: 'Reference-count chips per category, or "Not referenced". This is the pre-flight check for a delete.' },
            { name: 'Edit', kind: 'button', what: 'Opens the department modal pre-filled.' },
            { name: 'Delete', kind: 'button', what: 'Attempts to delete after a confirm. See the forced-delete flow below.' },
            { name: 'Name *', kind: 'field', what: 'In the modal, required. When editing a department that has designations, a hint states how many will be re-pointed by a rename.' },
            { name: 'Description', kind: 'field', what: 'Optional free text.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the department. Disabled while Name is blank.' },
          ],
          warnings: [
            'Renaming a department cascades. Designations link to a department by name, so the backend re-points them and the toast reports how many: "Department updated, 2 designations re-pointed". Records that reference the old name in other ways are not part of that cascade.',
          ],
        },
        {
          id: 'delete-department',
          title: 'Deleting a department that is still in use',
          body: [
            'A delete of a referenced department is refused by the backend with a 409, and the error names the exact counts. The page does not report a flat failure. It shows you the server\'s explanation and offers to force it.',
          ],
          steps: [
            'Click Delete and confirm the first dialog ("Delete department “X”?").',
            'If the department is unreferenced it is deleted and you are done.',
            'If it is still referenced, a second dialog appears carrying the server\'s exact message, for example "Department “Engineering” is still referenced by 2 designations, 1 jobs.", followed by "Delete it anyway? Designations naming it will be detached."',
            'Confirm to force the delete, or cancel to keep the department. Forcing reports how many designations were detached.',
          ],
          warnings: [
            'A forced delete detaches every designation that named the department. They survive, but with no department. Jobs and users that referenced it are left pointing at a name that no longer exists.',
            'Only a 409 offers the forced path. Any other failure (503, permission, network) is reported as a plain error toast with no second chance. That is deliberate, so a transient outage is never escalated into a force.',
          ],
          tips: [
            'The Used by chips can be stale if someone else has been editing. The 409 message is computed at delete time and is the authority. Read it rather than the table.',
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
            { name: 'Delete', kind: 'button', what: 'Deletes after a single confirm. There is no reference check and no forced-delete step for designations.' },
            { name: 'Name *', kind: 'field', what: 'Required. The title text.' },
            { name: 'Department', kind: 'field', what: 'A dropdown of existing departments plus "None". Stored by department name, which is why a department rename has to cascade.' },
            { name: 'Description', kind: 'field', what: 'Optional free text.' },
          ],
          warnings: [
            'Unlike departments, deleting a designation is not blocked by anything that references it. Confirm carefully.',
          ],
        },
        {
          id: 'job-grades-table',
          title: 'Job grades',
          body: [
            'A third list for the grade names your company uses, such as Grade 5, AVP or VP. Each has a name and an optional description. It has no link to a department.',
          ],
          controls: [
            { name: '+ Add Job Grade', kind: 'button', what: 'Opens the Add Job Grade modal.' },
            { name: 'Name', kind: 'column', what: 'The grade name. Required when adding or editing.' },
            { name: 'Description', kind: 'column', what: 'Optional free text, or a dash.' },
            { name: 'Edit', kind: 'button', what: 'Opens the grade pre-filled.' },
            { name: 'Delete', kind: 'button', what: 'Deletes after confirming "Delete job grade “X”?".' },
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
            { name: 'Job Domain', kind: 'column', what: 'The domain this scenario is scoped to, or a dash for an unscoped (generally applicable) one.', how: 'A domain can be removed again: edit the scenario, empty the Job Domain box and save, and the scenario goes back to a dash.' },
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
            'Give it a Name *, something recognisable in a list, e.g. System Design Deep Dive.',
            'Write the Prompt *, the situation the interviewer should present to the candidate. This is the text the AI works from, so be specific about the setup and what a good answer would address.',
            'Optionally set a Job Domain, e.g. software_engineering, to scope it.',
            'Tick the Evaluation Dimensions that matter for this scenario. All five are ticked by default.',
            'Click Create.',
          ],
          controls: [
            { name: 'Name *', kind: 'field', what: 'Required title.' },
            { name: 'Prompt *', kind: 'field', what: 'Required. The scenario description handed to the AI interviewer.', how: 'This is the single field that determines interview quality. Write it as an instruction to an interviewer, not as a question to the candidate.' },
            { name: 'Job Domain', kind: 'field', what: 'Optional free-text domain key used to scope the scenario. Use the same snake_case convention as elsewhere (software_engineering).', how: 'On an existing scenario, emptying the box and saving clears the domain. A scenario with no domain applies generally.' },
            { name: 'Technical', kind: 'toggle', what: 'Evaluation dimension, depth of technical reasoning.' },
            { name: 'Problem Solving', kind: 'toggle', what: 'Evaluation dimension, how the candidate decomposes and attacks the problem.' },
            { name: 'Communication', kind: 'toggle', what: 'Evaluation dimension, clarity of explanation.' },
            { name: 'Decision Making', kind: 'toggle', what: 'Evaluation dimension, quality of the trade-offs chosen.' },
            { name: 'Confidence', kind: 'toggle', what: 'Evaluation dimension, assurance and ownership in the answer.' },
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
            { name: 'Send Pending Reminders Now', kind: 'button', what: 'Runs the pending-invite reminder sweep immediately instead of waiting for the daily scheduled run, and toasts how many were sent ("Reminders sent: N"). The scheduled-runs status above the table refreshes afterwards.', how: 'A manual kick, not a rule. Useful for verifying reminder email content after editing the template, and for catching up after a backend outage.' },
            { name: 'Scheduled runs', kind: 'column', what: 'A short list above the table, one line per scheduled job: Pending invite reminders, Interview reminders for other platforms and Job source sync. Each shows when it last ran ("Never run" if it has not), a status badge and a line of detail.', how: 'When scheduled runs are switched off, one line says so instead: "Scheduled runs are off because the cron secret is not set." Then nothing runs by itself and only the manual button works. If the status cannot be read the line reads "Scheduled run status is unavailable."' },
            { name: 'Name', kind: 'column', what: 'The rule name.' },
            { name: 'Trigger', kind: 'column', what: 'The raw trigger_type this rule listens for. A yellow "Never fires" badge beside it means the trigger is no longer one the platform raises, so the rule can never run.' },
            { name: 'Action', kind: 'column', what: 'The raw action_type this rule runs.' },
            { name: 'Status', kind: 'column', what: 'Active (green) or Inactive (grey). Inactive rules never fire.' },
            { name: 'Test', kind: 'button', what: 'Opens the rule tester, evaluates the rule\'s conditions against a context you supply, without running the action.' },
            { name: 'Edit', kind: 'button', what: 'Opens the modal pre-filled, with the extra Active checkbox.' },
            { name: 'Delete', kind: 'button', what: 'Deletes after confirming "Delete workflow rule “X”?".' },
          ],
        },
        {
          id: 'triggers',
          title: 'Trigger types, when a rule is evaluated',
          body: [
            'These five are the triggers that fire, and the Trigger Type list offers nothing else. The list comes from the server, so it can only ever show triggers that really fire. Each trigger supplies a context object; the fields available in your conditions are whatever that event carries.',
            'A rule saved earlier on a trigger that no longer fires, resume_processed for example, is kept and still listed, but it can never run. The table marks it with a yellow "Never fires" badge, and when you edit it the Trigger Type shows the old name followed by "(never fires)" so you can see it and move it to one of these five.',
          ],
          controls: [
            { name: 'candidate_invited', kind: 'field', what: 'Fires when a candidate is invited to interview.' },
            { name: 'candidate_status_changed', kind: 'field', what: 'Fires on any pipeline stage change for a candidate.' },
            { name: 'interview_completed', kind: 'field', what: 'Fires once an interview session has finished and been evaluated.' },
            { name: 'offer_created', kind: 'field', what: 'Fires when a new offer record is created. Carries the offer context, including an offer_id.' },
            { name: 'offer_status_changed', kind: 'field', what: 'Fires when an offer moves state (approved, sent, accepted, declined, withdrawn). Carries an offer_id.' },
          ],
        },
        {
          id: 'actions',
          title: 'Action types, what a rule does',
          body: [
            'Six actions, each with its own expectations about action_params. The modal prints a one-line explanation under the picker as you choose.',
          ],
          controls: [
            { name: 'send_email', kind: 'field', what: 'Sends a reminder/follow-up to the candidate, or the offer letter itself, with email_kind set to "offer" in the params.' },
            { name: 'change_pipeline_stage', kind: 'field', what: 'Moves the candidate to the stage named in action_params.stage.', how: 'The stage value must match a real pipeline stage name, or the move is a no-op.' },
            { name: 'fire_webhook', kind: 'field', what: 'Posts the trigger context to every active webhook subscription that lists the event name, configured on Platform Settings → Webhooks.', how: 'The event name is the event_type in the rule\'s Action Params if there is one, otherwise the trigger\'s own name such as candidate_invited. Subscriptions made from the Webhooks checklist list names like candidate.invited, so set {"event_type": "candidate.invited"} to reach them. Many events now reach webhooks without any rule; this action is for the cases a rule\'s conditions decide.' },
            { name: 'approve_offer', kind: 'field', what: 'Approves the offer in context, only valid while the offer is in draft or pending_approval.', how: 'Pair with the offer_created trigger and a salary condition to auto-approve everything below a threshold.' },
            { name: 'send_offer', kind: 'field', what: 'Emails an approved offer to the candidate.', how: 'Pair with offer_status_changed plus a condition of status eq approved.' },
            { name: 'withdraw_offer', kind: 'field', what: 'Withdraws a non-terminal offer.' },
          ],
          warnings: [
            'The three offer actions need an offer_id, which only offer_created and offer_status_changed provide. Choose an offer action on any other trigger and the modal shows an amber warning. The rule will save (both values are individually valid) and then be skipped every single time, unless you put an explicit offer_id in Action Params. That is the hardest kind of rule bug to notice, which is why it is caught here rather than at save.',
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
            { name: 'Trigger Type', kind: 'field', what: 'Dropdown of the five trigger events, listed with their readable names such as "Candidate invited". The first one is the starting choice for a new rule.', how: '+ Add Rule stays disabled until the list has loaded. If the list cannot be loaded a red message with Retry shows above the table.' },
            { name: 'Conditions', kind: 'field', what: 'Rows of field / operator / value, all of which must hold for the action to run.' },
            { name: 'field', kind: 'field', what: 'The context key to test, e.g. match_score or status. Typed free-hand. Nothing validates that the key exists on that trigger.' },
            { name: 'operator', kind: 'field', what: 'One of eq, neq, gte, lte, contains.', how: 'gte/lte are for numbers such as a score or salary; contains is the substring test for text fields.' },
            { name: 'value', kind: 'field', what: 'What to compare against, entered as text.' },
            { name: '+ Add Condition', kind: 'button', what: 'Appends another condition row.' },
            { name: '✕', kind: 'button', what: 'Removes that condition row. Disabled when only one row remains. A rule always has at least one row in the form, though an empty one is discarded on save.' },
            { name: 'Action Type', kind: 'field', what: 'Dropdown of the six actions, with contextual help beneath.' },
            { name: 'Action Params (JSON)', kind: 'field', what: 'A JSON object passed to the action. Validated as you type; an invalid document shows "action_params must be valid JSON" and blocks the save.' },
            { name: 'Active', kind: 'toggle', what: 'Only on the edit modal. Clearing it stops the rule firing without deleting it.' },
            { name: 'Create / Save Changes', kind: 'button', what: 'Writes the rule. Disabled while the name is blank or the JSON is invalid.' },
          ],
          tips: [
            'A rule with zero usable conditions matches everything that trigger emits. If you genuinely want that, it is fine. Just be sure the action is safe to run on every event.',
          ],
        },
        {
          id: 'test-rule',
          title: 'Test a rule before trusting it',
          body: [
            'The tester evaluates only the conditions. It tells you whether the rule would match a given context. It never runs the action, so testing a send_offer rule sends nothing.',
          ],
          steps: [
            'Click Test on the rule row. The modal is titled "Test Rule, <name>".',
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
            'A passing test does not prove the action will succeed, only that the conditions match. An offer action on a non-offer trigger will test as Matched: true and still be skipped at run time for want of an offer_id.',
          ],
        },
        {
          id: 'scheduled-runs',
          title: 'Scheduled runs',
          body: [
            'Some work has to happen on a timer rather than when someone clicks. On a hosted deployment a daily scheduled run does it, and it only runs when the deployment has a cron secret set (the CRON_SECRET setting). Each day it does three jobs, one after the other.',
            'Pending invite reminders: nudges candidates whose AI interview invite has gone unanswered. Interview reminders for other platforms: emails each candidate whose interview on another platform starts within the next 24 hours, with the platform, the time, the join link and your note. Job source sync: re-syncs the job boards that are set up.',
            'The lines above the rules table show each job\'s last run, its status and a line of detail. The detail is plain: how many reminders went out, or that no email provider is set up so they were only written to the log. Nothing here can be configured from the screen; the schedule and the secret belong to the deployment.',
          ],
          faqs: [
            {
              q: 'The table says scheduled runs are off.',
              a: 'The deployment has no cron secret, so the daily run is never called. Reminders and job syncs will not happen by themselves until a Super Admin or whoever manages the deployment sets CRON_SECRET. Send Pending Reminders Now still works in the meantime.',
            },
            {
              q: 'A job shows "Never run".',
              a: 'It has not been recorded yet. Either the daily run has not reached it since scheduled runs were switched on, or the platform was only just set up. Check again after the next daily run.',
            },
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
            { name: 'Questions', kind: 'column', what: 'Card title. The tab loads up to 100 questions. The number on the Coding Questions tab is the real total.', how: 'When more than 100 exist, a "Showing 100 of N" note appears beside + Add Question, so a long bank is never mistaken for the whole bank.' },
            { name: 'Job Domain', kind: 'column', what: 'Optional scope, or a dash.', how: 'To remove a domain, edit the question, empty the Job Domain box and save.' },
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
            'Enter a Title * and the Description *. The description is the problem statement the candidate reads, so include the input/output contract and any constraints.',
            'Optionally set a Job Domain, and pick a Difficulty (Easy / Medium / Hard; medium is the default).',
            'Fill in Starter Code by Language for python and javascript. Both are pre-seeded with a one-line comment stub.',
            'Add Test Cases. Each has an Input, an Expected Output, and a Hidden flag. The form starts with one empty case.',
            'Tick "Hidden test (not shown to candidate)" on the cases that should not be revealed.',
            'Click Create.',
          ],
          controls: [
            { name: 'Title *', kind: 'field', what: 'Required. The question name.' },
            { name: 'Description *', kind: 'field', what: 'Required. The full problem statement shown to the candidate.' },
            { name: 'Job Domain', kind: 'field', what: 'Optional scoping key.', how: 'On an existing question, emptying the box and saving clears the domain.' },
            { name: 'Difficulty', kind: 'field', what: 'Easy, Medium or Hard. Drives the badge colour and is available for filtering.' },
            { name: 'Starter Code by Language', kind: 'field', what: 'One textarea per supported language, pre-filled with a stub comment. Spell-check is off in these boxes.', how: 'Give the candidate a working signature to fill in, not an empty file. It removes a whole class of "wrong entry point" failures against your test cases.' },
            { name: '+ Add Test Case', kind: 'button', what: 'Appends another empty test case block.' },
            { name: 'Input', kind: 'field', what: 'The stdin/argument payload handed to the submitted program for that case.' },
            { name: 'Expected Output', kind: 'field', what: 'The exact output the run must produce to count as a pass.', how: 'Comparison is exact. Trailing newlines and whitespace matter. Keep outputs simple and single-line where you can.' },
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
      id: 'ia-live',
      title: 'Live Sessions tab',
      path: '/dashboard/interview-automation?tab=live',
      summary:
        'Watch a candidate\'s coding assessment while they are writing it. The tab lists who is coding right now, and opens a read-only view of one candidate\'s code. You cannot change their code and nothing here runs it.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'live-sessions-list',
          title: 'Who is coding now',
          body: [
            'The Active sessions card lists every candidate with a coding session in progress, so you do not need a candidate id to find them. Each row shows the candidate\'s name, the question title and the language, and how long ago their code was last saved. When nobody is coding the card reads "No one is coding right now."',
            'The list refreshes by itself every 5 seconds, but only while the browser tab is visible. A hidden tab stops asking, and when you switch back to it the list updates at once, so the screen is current the moment you look at it.',
          ],
          steps: [
            'Open Interview & Automation and click the Live Sessions tab.',
            'Click a candidate in the Active sessions card. A "Live session" card opens beneath it for that person.',
            'Read the status badge and the code. It updates every 5 seconds while the tab is visible.',
            'Click Close to go back to the list.',
          ],
          controls: [
            { name: 'Active sessions', kind: 'column', what: 'Card title. One row per candidate coding right now: name, question and language, and the time of the last save.', how: 'The row you are watching is highlighted. If the list cannot be read, a red message with Retry shows in its place.' },
            { name: 'Live session, <name>', kind: 'column', what: 'The read-only view of the row you clicked. It holds a status badge, the question, the language, the time of the last save and the code as the candidate has typed it.', how: 'The code panel is labelled "Live Code (read-only)". It shows "(nothing typed yet)" until the candidate writes something.' },
            { name: 'Not assigned / Not started / In progress / Submitted', kind: 'badge', what: 'The status of the candidate\'s assessment. Not assigned: no question has been given to this candidate. Not started: a question is assigned but the candidate has not begun. In progress: they are writing code, shown with a live dot. Submitted: the answer has been handed in.', how: 'For Submitted, the live draft is no longer tracked, and a "View full results in Submissions" link takes you to the graded result.' },
            { name: 'Close', kind: 'button', what: 'Closes the live view and returns to the list. It does not affect the candidate in any way.' },
          ],
          faqs: [
            {
              q: 'It says "No candidate found with that ID."',
              a: 'The link you followed carried an id that does not belong to any candidate, so the page stopped asking. Close the view and pick someone from the Active sessions card.',
            },
            {
              q: 'The code has not changed for a while.',
              a: 'The view shows the last saved draft, and the card shows when that was. A candidate who has stopped typing, lost their connection or closed the page will look the same. Nothing here updates while your own browser tab is hidden.',
            },
          ],
        },
      ],
    },
    {
      id: 'ia-submissions',
      title: 'Submissions tab',
      path: '/dashboard/interview-automation?tab=submissions',
      summary:
        'Every coding submission across every candidate, newest-first and paged. Each row expands into the full review: similarity check, static complexity, AI code-quality review, the submitted code, and the visible and hidden test results. This is a review surface. Nothing here is editable.',
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
            { name: 'Filter by candidate_id, leave blank for all', kind: 'filter', what: 'Restricts the list to one candidate. Applied on submit, not as you type, and mirrored into the URL as ?candidate_id=.' },
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
            { name: '⚠ Similarity', kind: 'badge', what: 'Red badge meaning this submission was flagged as highly similar to another candidate\'s.', how: 'Treat it as a prompt to review, never as proof. See the similarity panel for the actual numbers.' },
            { name: '▼ / ▲', kind: 'button', what: 'Expands or collapses the full review panel. Only one row is expanded at a time.' },
          ],
        },
        {
          id: 'similarity-panel',
          title: 'Similarity check',
          body: [
            'Comparison is structural: comments are stripped and identifiers normalised before comparing, so renaming variables or reformatting does not lower the number. It runs against other candidates\' submissions to the same question.',
            'Two numbers matter and they catch different cheats. Overall overlap is the share of the combined work that is common. "Contained in another" catches a verbatim copy that has been padded out with extra code, a case overall overlap alone misses.',
          ],
          controls: [
            { name: 'compared against N other candidates', kind: 'badge', what: 'The comparison population. If it says "(most recent only)", the comparison set was truncated to the most recent submissions.' },
            { name: 'overall overlap', kind: 'badge', what: 'The Jaccard-style similarity percentage against the closest other submission.' },
            { name: 'contained in another', kind: 'badge', what: 'The containment percentage, how much of this submission appears wholly inside another one.' },
            { name: 'flag threshold', kind: 'badge', what: 'The percentage at which the checker raises the flag, shown so you can judge a near-miss.' },
            { name: 'Match row', kind: 'column', what: 'Each match lists its percentage and the other candidate id.' },
            { name: 'identical', kind: 'badge', what: 'Red, the two submissions are identical once normalised.' },
            { name: 'contained + padded', kind: 'badge', what: 'Amber, this submission is largely contained in the other, padded with extra code. The copy-then-pad signature.' },
          ],
          warnings: [
            'The match list names other candidates, which makes this panel admin-only. It is stripped from every candidate-facing response and must never be pasted into an email to an applicant.',
            'Very short submissions are reported but never flagged. Short answers converge by construction, so a similarity score on them means nothing. The panel says so explicitly when that applies.',
          ],
        },
        {
          id: 'complexity-quality',
          title: 'Complexity and AI quality review',
          body: [
            'Complexity is deterministic static analysis, no AI involved, identical run to run. Quality is an AI review of the code as written, which is the axis a pass/fail test runner cannot see.',
          ],
          controls: [
            { name: 'Complexity band', kind: 'badge', what: 'low (green), moderate (grey), high or very high (amber).', how: 'High is not automatically bad. A hard problem earns it, which is why the palette stops at amber and never goes red.' },
            { name: 'cyclomatic', kind: 'badge', what: 'Cyclomatic complexity: the number of independent paths through the code.' },
            { name: 'max nesting', kind: 'badge', what: 'Deepest block nesting reached.' },
            { name: 'lines of code', kind: 'badge', what: 'Executable lines, excluding comments and blanks.' },
            { name: 'functions', kind: 'badge', what: 'How many functions were defined.' },
            { name: 'AI code-quality review', kind: 'badge', what: 'Overall score out of 100, coloured on the same thresholds as the test score.' },
            { name: 'readability / structure / efficiency / idiomatic / problem solving', kind: 'badge', what: 'The five sub-scores behind the overall quality number.' },
            { name: 'Approach summary', kind: 'column', what: 'A short prose description of how the candidate solved it.' },
            { name: 'For the recruiter', kind: 'column', what: 'Guidance written specifically for the reviewer, the internal counterpart of the candidate-facing feedback.' },
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
            { name: 'Hidden Test Cases, X of Y passed', kind: 'column', what: 'Results for the hidden cases, with the pass count in the heading.', how: 'This is the number that usually decides the outcome. A candidate who special-cased the visible tests will pass those and fail here.' },
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
        'Fourteen separate admin pages were merged into four tabbed pages. Every retired route is kept as a redirect, so an old bookmark, an old email link or a deep link from another system still resolves. It just lands on the corresponding tab now. Redirects replace the history entry, so the Back button will not bounce you between the old and new URL.',
      access: 'HR Admin & Super Admin',
      subsections: [
        {
          id: 'redirect-table',
          title: 'Where each old route lands',
          controls: [
            { name: '/dashboard/roles', kind: 'link', what: 'Now /dashboard/users?tab=roles, the Roles & Permissions tab of Users & Roles.' },
            { name: '/dashboard/audit-log', kind: 'link', what: 'Now /dashboard/users?tab=audit, the Audit Log tab of Users & Roles.' },
            { name: '/dashboard/webhooks', kind: 'link', what: 'Now /dashboard/settings?tab=webhooks, the Webhooks tab of Platform Settings.' },
            { name: '/dashboard/prompt-config', kind: 'link', what: 'Now /dashboard/settings, Platform Settings. The AI prompts are not offered to a company, so there is no tab for them.' },
            { name: '/dashboard/email-templates', kind: 'link', what: 'Now /dashboard/settings?tab=email, the Email Templates tab of Platform Settings.' },
            { name: '/dashboard/company-settings', kind: 'link', what: 'Now /dashboard/organization, the Company Profile tab, which is the page default.' },
            { name: '/dashboard/branding', kind: 'link', what: 'Now /dashboard/organization?tab=branding, the Branding & Notifications tab.' },
            { name: '/dashboard/departments', kind: 'link', what: 'Now /dashboard/organization?tab=departments, the Departments, Designations & Grades tab.' },
            { name: '/dashboard/scenarios', kind: 'link', what: 'Now /dashboard/interview-automation?tab=scenarios, the Scenarios tab.' },
            { name: '/dashboard/workflows', kind: 'link', what: 'Now /dashboard/interview-automation?tab=workflows, the Workflow Rules tab.' },
            { name: '/dashboard/coding-questions', kind: 'link', what: 'Now /dashboard/interview-automation?tab=questions, the Coding Questions tab.' },
            { name: '/dashboard/coding-submissions', kind: 'link', what: 'Now /dashboard/interview-automation?tab=submissions, the Submissions tab. This redirect preserves the whole query string, so an existing link carrying ?candidate_id=… still opens that candidate\'s submissions.' },
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
            { name: 'Red message with Retry', kind: 'badge', what: 'Most admin panels show this when a list or form cannot be read: users, webhooks, prompts, scenarios, rules, questions, the company profile, branding, notifications and the security policy. Save stays disabled, so a failed read can never be saved over the real data.', how: 'Press Retry. If it keeps failing, confirm with Backend Status on Platform Settings → System before changing anything.' },
            { name: 'Silent empty table', kind: 'badge', what: 'The Email Templates tab still swallows a load error and renders an empty list.', how: 'An unexpectedly empty Email Templates table almost always means the backend call failed, not that the data is gone. Confirm with Backend Status on Platform Settings → System before editing anything.' },
            { name: 'Signed out unexpectedly', kind: 'badge', what: 'Any 401 logs you out and sends you to /login. There is no demo-token carve-out. Every 401 is a genuinely expired session.' },
            { name: '403 / permission refused', kind: 'badge', what: 'You reached the endpoint but your role lacks the permission. On this platform that almost always means an action is Super-Admin-only.', how: 'Cross-check the permission key in the error ("Missing required permission: <key>") against the Roles & Permissions matrix. It will show you exactly which roles hold it.' },
            { name: '409 conflict', kind: 'badge', what: 'The record is still referenced by something. Today only the department delete produces this, and it is handled with an explicit forced-delete prompt.' },
            { name: '422 validation', kind: 'badge', what: 'The payload was rejected. Common causes: a workflow trigger or action name the backend does not recognise, an unknown webhook event type, or a prompt template with missing or unknown placeholders. The page shows the server\'s sentence, often under the field.' },
          ],
          faqs: [
            {
              q: 'A change I made is not visible to a colleague.',
              a: 'Branding is applied at page load, and most admin pages fetch once per tab visit. Ask them to reload. Nothing on these pages pushes live updates. There is no websocket in this product.',
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
    'These are configuration surfaces. What you change here applies to everyone, the AI model behind resume scoring, the words candidates read in an invitation email, the departments jobs are filed under, the rules that move candidates through the pipeline. Most of it takes effect immediately and quietly, so the guide flags the handful of actions that cannot be undone: deleting a user or a custom role, forcing a department delete, and resetting a prompt or an email template.',
    'A few things inside these pages are Super Admin only, and the product lets you in anyway rather than hiding half-usable screens: your user list holds Recruiters only, the permission matrix renders read-only, the Security Policies tab is read only, and role assignment is refused. Every such control is marked below so you know before you click, not after.',
    'The chapters before this one are the recruiting workflow, as in the Recruiter guide, with the extra controls an admin account has: the Needs attention icon in the top bar, Compare candidates, scorecards and the interview report. Recruiters do not receive interview reports, scores, transcripts, integrity data or scorecards. An admin account does not take anything away.',
  ],
  chapters: [...coreChapters, ...adminChapters],
}

export default hrAdminGuide
