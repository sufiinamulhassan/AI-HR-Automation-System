import { note, ol, p, table, ul } from '../../../components/site/blockModel'
import type { Explainer } from '../../../lib/siteContent'

export const INTEGRATIONS: Explainer[] = [
  {
    slug: 'zoom',
    title: 'Zoom',
    icon: 'video',
    metaTitle: 'Create Zoom interview meetings from the pipeline',
    metaDescription:
      'Connect your own Zoom account to Hirely.ai. Recruiters create a scheduled Zoom meeting for an interview, and the join link is saved on the candidate.',
    eyebrow: 'Zoom',
    headline: 'Create the Zoom meeting',
    accent: 'without leaving the pipeline',
    lead: 'Connect your Zoom account once. When a recruiter schedules an interview, Hirely.ai can create the Zoom meeting and keep the join link with the candidate.',
    stats: [
      { value: '3', label: 'details to enter: account ID, client ID and client secret' },
      { value: '2', label: 'places a recruiter can create a meeting from' },
      { value: 'On', label: 'waiting room, with joining before the host switched off' },
    ],
    stepsEyebrow: 'Setup',
    stepsTitle: 'Connect Zoom in four steps',
    steps: [
      {
        title: 'Create a Zoom app',
        description:
          'In Zoom, create an app that uses account credentials (Server-to-Server OAuth) and allow it to create meetings. Note the account ID, the client ID and the client secret.',
      },
      {
        title: 'Open the Integrations tab',
        description:
          'Sign in as a Super Admin and open Organization, then Integrations. Enter the three values on the Zoom card and save.',
      },
      {
        title: 'Check the card',
        description:
          'The card reads Configured and the secret shows as saved. You can change or remove the secret, but it is never shown again.',
      },
      {
        title: 'Schedule with a meeting',
        description:
          'When a recruiter schedules an interview, they tick the option to create the meeting. The join link is saved on the candidate.',
      },
    ],
    featuresEyebrow: 'What it does',
    featuresTitle: 'What you get with the Zoom connection',
    features: [
      {
        icon: 'video',
        title: 'A real scheduled meeting',
        text: 'Hirely.ai asks Zoom to create the meeting for the slot the recruiter picked. The topic names the candidate and the role.',
      },
      {
        icon: 'lock',
        title: 'Waiting room on',
        text: 'Every meeting is created with the waiting room on, and nobody can join before the host. Registration is not required.',
      },
      {
        icon: 'mail',
        title: 'Candidate emailed the details',
        text: 'For an interview set up on another platform, the candidate is emailed the join link and the time as soon as it is saved.',
      },
      {
        icon: 'key',
        title: 'Secret kept masked',
        text: 'The client secret is encrypted at rest and shown only as saved. You can replace it or remove it at any time.',
      },
      {
        icon: 'users',
        title: 'Zoom or Teams per interview',
        text: 'When both are connected, the recruiter picks the provider for each interview. With one connected, it is used automatically.',
      },
      {
        icon: 'settings',
        title: 'Your account, your meetings',
        text: 'Each company enters its own Zoom account, so meetings are created under your account and not under anyone else.',
      },
    ],
    sections: [
      {
        id: 'zoom-meeting-settings',
        eyebrow: 'The meeting',
        title: 'What Hirely.ai sends to Zoom',
        lead: 'These values are used for every meeting it creates.',
        blocks: [
          table(
            ['Setting', 'Value'],
            [
              ['Topic', 'Interview: the candidate name for the job title'],
              ['Agenda', 'Interview for the job title position'],
              ['Start time', 'The slot the recruiter picked, sent to Zoom in UTC'],
              ['Length', 'The length set on the form, or the default interview length'],
              ['Waiting room', 'On'],
              ['Join before host', 'Off'],
              ['Registration', 'Not required'],
            ],
          ),
        ],
      },
      {
        id: 'zoom-where-it-is-used',
        eyebrow: 'In use',
        title: 'Where recruiters use it',
        blocks: [
          p('A recruiter can create a meeting in two places. In both, the option only appears once an admin has connected the provider.'),
          ul([
            '**Scheduling an AI interview slot.** HR Admins and Super Admins tick the option to create a video meeting for the slot. The schedule still saves if Zoom refuses the request.',
            '**Setting up an interview on another platform.** Choose Zoom as the platform and tick the option to create the meeting for you. Or paste a Zoom link, which must be a real Zoom address.',
          ]),
        ],
      },
      {
        id: 'zoom-limits',
        eyebrow: 'Good to know',
        title: 'What the connection does not do',
        blocks: [
          ul([
            'It creates meetings. It does not join, record or transcribe the call.',
            'It does not move or cancel a meeting. If the time changes, cancel the old meeting in Zoom and create a new one for the new slot.',
            'The interview itself happens in Zoom. For an interview on another platform, the interviewers record the outcome as scorecards, and the scorecards become the interview report.',
          ]),
          note('If Zoom refuses a request, the recruiter sees the status code and the start of the reply from Zoom.'),
        ],
      },
    ],
    plan: 'Zoom is included in the Growth and Enterprise plans, and not in Starter.',
    faqs: [
      {
        q: 'Who can connect Zoom?',
        a: 'A Super Admin, on the Integrations tab under Organization. HR Admins and Recruiters do not see that tab.',
      },
      {
        q: 'Which Zoom details does it need?',
        a: 'An account ID, a client ID and a client secret from a Zoom app that uses account credentials. Hirely.ai requests an access token from Zoom each time it creates a meeting.',
      },
      {
        q: 'Does it join or record the call?',
        a: 'No. The connection only creates the meeting and saves the join link. Nothing in it joins, records or transcribes the call.',
      },
      {
        q: 'What if the interview time changes?',
        a: 'Hirely.ai does not edit or cancel meetings in Zoom. Cancel the old meeting there and create a new one for the new slot.',
      },
      {
        q: 'What if we use another video tool?',
        a: 'The recruiter can set up the interview on another platform and paste the meeting link. Only Zoom and Microsoft Teams meetings can be created for you.',
      },
    ],
    related: ['/integrations/microsoft-teams', '/features', '/pricing'],
    ctaTitle: 'Book interviews without copying links',
    ctaText: 'Ask us and we will walk through scheduling on your own roles.',
  },
  {
    slug: 'microsoft-teams',
    title: 'Microsoft Teams',
    icon: 'users',
    metaTitle: 'Create Microsoft Teams interview meetings',
    metaDescription:
      'Connect your Microsoft tenant to Hirely.ai. Recruiters create a Teams meeting for an interview from the pipeline, and the join link stays on the candidate.',
    eyebrow: 'Microsoft Teams',
    headline: 'Teams meetings for interviews,',
    accent: 'created from the candidate row',
    lead: 'Connect an app in your own Microsoft tenant, and Hirely.ai can create a Teams meeting whenever a recruiter schedules an interview. The meeting is created for the organizer account you choose.',
    stats: [
      { value: '4', label: 'details to enter: tenant ID, client ID, client secret and organizer' },
      { value: '1', label: 'person skips the lobby: the organizer' },
    ],
    stepsEyebrow: 'Setup',
    stepsTitle: 'Connect Teams in four steps',
    steps: [
      {
        title: 'Register an app in your tenant',
        description:
          'In your Microsoft tenant, register an application and create a client secret for it. Note the tenant ID and the application (client) ID.',
      },
      {
        title: 'Allow it to create meetings',
        description:
          'Ask your Microsoft administrator to let the app create online meetings for the organizer account. Hirely.ai shows the reply from Microsoft if a request is refused.',
      },
      {
        title: 'Enter the details',
        description:
          'As a Super Admin, open Organization, then Integrations. On the Microsoft Teams card, enter the tenant ID, client ID, client secret and organizer, then save.',
      },
      {
        title: 'Schedule with a meeting',
        description:
          'A recruiter ticks the option to create the meeting. If Zoom is connected as well, they pick Teams from a list.',
      },
    ],
    featuresEyebrow: 'What it does',
    featuresTitle: 'What you get with the Teams connection',
    features: [
      {
        icon: 'users',
        title: 'Meetings in your tenant',
        text: 'Hirely.ai calls Microsoft Graph with your app credentials and creates an online meeting for the organizer. The subject names the candidate and the role.',
      },
      {
        icon: 'key',
        title: 'An app, not a password',
        text: 'Hirely.ai signs in as your app with a client ID and a client secret. No personal Microsoft password is stored.',
      },
      {
        icon: 'lock',
        title: 'Lobby for everyone else',
        text: 'The meeting is created so that only the organizer bypasses the lobby. Candidates and other guests wait to be admitted.',
      },
      {
        icon: 'calendar',
        title: 'A calendar file for the candidate',
        text: 'When the interview is set up on another platform, the email carries a calendar file along with the link and the time.',
      },
      {
        icon: 'eye',
        title: 'Creates, never reads',
        text: 'The connection asks Microsoft to create meetings. It makes no requests to read calendars, chats or recordings.',
      },
      {
        icon: 'shield',
        title: 'Errors you can act on',
        text: 'If Microsoft refuses a request, Hirely.ai shows the status code and the start of the reply, so an admin can see why.',
      },
    ],
    sections: [
      {
        id: 'teams-meeting-settings',
        eyebrow: 'The meeting',
        title: 'What Hirely.ai sends to Microsoft',
        lead: 'These values are used for every Teams meeting it creates.',
        blocks: [
          table(
            ['Setting', 'Value'],
            [
              ['Subject', 'Interview: the candidate name for the job title'],
              ['Start and end', 'The slot the recruiter picked, plus the interview length'],
              ['Created for', 'The organizer you entered on the Teams card'],
              ['Lobby', 'Only the organizer bypasses it'],
            ],
          ),
        ],
      },
      {
        id: 'teams-before-you-start',
        eyebrow: 'Before you start',
        title: 'What you need from Microsoft',
        blocks: [
          ul([
            'A tenant ID for your Microsoft directory.',
            'An application (client) ID for the app you registered.',
            'A client secret created for that app.',
            'An organizer: the email address or user ID of the account the meetings are created for.',
          ]),
          p('Hirely.ai checks the format of each value when you save. It cannot know whether Microsoft will accept them until the first meeting is created.'),
        ],
      },
    ],
    plan: 'Microsoft Teams is included in the Growth and Enterprise plans, and not in Starter.',
    faqs: [
      {
        q: 'What is the organizer?',
        a: 'The Microsoft account that the meetings are created for, given as an email address or a user ID. Choose an account your recruiting team can use, since the meetings belong to it.',
      },
      {
        q: 'Does a person have to sign in with Microsoft?',
        a: 'No. Hirely.ai uses the client credentials of your app, so nobody signs in with a personal Microsoft account to create a meeting.',
      },
      {
        q: 'Can we test the connection before an interview?',
        a: 'The Teams card has no test button. Save the details, then create a meeting for a practice interview and check that the join link works.',
      },
      {
        q: 'Can Teams and Zoom both be connected?',
        a: 'Yes. When both are connected, the recruiter picks the provider for each interview. When only one is connected, it is used automatically.',
      },
      {
        q: 'Does Hirely.ai read our Microsoft calendars?',
        a: 'No. It only asks Microsoft to create meetings, and it makes no requests to read calendars, chats or recordings.',
      },
    ],
    related: ['/integrations/zoom', '/features', '/pricing'],
    ctaTitle: 'Interview in Teams, scheduled in Hirely.ai',
    ctaText: 'Ask us and we will show the Teams option on a real interview slot.',
  },
  {
    slug: 'hrms',
    title: 'HR systems',
    icon: 'database',
    metaTitle: 'Send hired candidates to your HR system',
    metaDescription:
      'Hirely.ai posts a JSON employee record to your HR system when a candidate is hired, or on request. Your system can also pull the same records on demand.',
    eyebrow: 'HR systems',
    headline: 'Hand hired candidates',
    accent: 'to your HR system',
    lead: 'When a candidate is hired, Hirely.ai can post a record with their details, role and offer to an address you control. Your HR system can also pull the same records whenever it needs them.',
    stats: [
      { value: '1.0', label: 'version of the employee record' },
      { value: 'HTTPS', label: 'endpoints only, on public addresses' },
    ],
    stepsEyebrow: 'Setup',
    stepsTitle: 'Connect your HR system in four steps',
    steps: [
      {
        title: 'Prepare an endpoint',
        description:
          'Ask your HR system team for an https address that accepts a JSON post. Get the name of the authorization header and a token if it needs them.',
      },
      {
        title: 'Open the Integrations tab',
        description:
          'As a Super Admin, open Organization, then Integrations. On the HR system card, enter the endpoint URL, the header name and the token, then save.',
      },
      {
        title: 'Choose when to send',
        description:
          'Tick the option to send the candidate when they are hired. Leave it off to send only on request through the admin API.',
      },
      {
        title: 'Read the sync log',
        description:
          'Every attempt is logged with its status and the HTTP code. Admins read the log through the API.',
      },
    ],
    featuresEyebrow: 'What it does',
    featuresTitle: 'What you get with the HR system connection',
    features: [
      {
        icon: 'database',
        title: 'A versioned record',
        text: 'Each post carries a JSON record marked version 1.0, with contact details, role, department, offer terms and hiring status.',
      },
      {
        icon: 'lightning',
        title: 'Send on hire',
        text: 'With the option on, a hire decision starts the post in the background. It stays off until an admin turns it on.',
      },
      {
        icon: 'arrowupright',
        title: 'Pull when you need to',
        text: 'An export endpoint returns the same records for hired candidates and candidates with an accepted offer. Filter by job or by date.',
      },
      {
        icon: 'shield',
        title: 'Public https addresses only',
        text: 'Hirely.ai refuses an address that is not https, carries a user name or password, or points to a private network.',
      },
      {
        icon: 'key',
        title: 'Token kept masked',
        text: 'The token is encrypted at rest and shown only as saved. Replace it or remove it whenever you need to.',
      },
      {
        icon: 'clock',
        title: 'A log of every attempt',
        text: 'Each post is recorded as sent, failed, blocked or not found, with the HTTP code and the time.',
      },
    ],
    sections: [
      {
        id: 'hrms-record',
        eyebrow: 'The record',
        title: 'What is in the employee record',
        lead: 'Fields that are not known are sent empty.',
        blocks: [
          table(
            ['Group', 'Fields'],
            [
              ['Person', '`candidate_id`, `full_name`, `email`, `phone`, `location`, `linkedin_url`'],
              ['Role', '`job_id`, `job_title`, `department_id`, `employment_type`, `work_location`'],
              ['Offer', '`offer_id`, `salary`, `benefits`, `start_date`, `offer_accepted_at`'],
              ['Hiring', '`hiring_status`, `match_score`, `interview_score`, `seniority_level`, `skills`'],
              ['Envelope', '`record_version`, `exported_at`, `source`'],
            ],
          ),
          note('The record includes the salary and benefits from the accepted offer, and the match and interview scores. Decide whether your HR system should hold them before you connect it.'),
        ],
      },
      {
        id: 'hrms-sending',
        eyebrow: 'Sending',
        title: 'How a post is sent and recorded',
        blocks: [
          ol([
            'A recruiter records a hire decision, or an admin asks for a push through the API.',
            'Hirely.ai builds the record from the candidate, the job, the accepted offer and the resume profile.',
            'It posts the record as JSON to your endpoint, with your authorization header when you set one.',
            'It writes the result to the sync log.',
          ]),
          table(
            ['Status', 'Meaning'],
            [
              ['sent', 'Your system answered with a 2xx code'],
              ['failed', 'Your system answered with another code, did not answer in time, or sent back too much data'],
              ['blocked', 'The address failed the safety check'],
              ['not found', 'The candidate does not exist or has been erased'],
            ],
          ),
          p('Hirely.ai waits up to 15 seconds for an answer and reads up to 64,000 bytes of it. The token is sent as the value of the header you name, exactly as entered, so include a prefix such as Bearer if your system expects one.'),
        ],
      },
      {
        id: 'hrms-limits',
        eyebrow: 'Limits',
        title: 'What the connection does not do',
        blocks: [
          ul([
            'It does not read anything back from your HR system.',
            'It makes one attempt per post. A failed post is not retried, so an admin sends it again through the API.',
            'It has no ready-made connector for a named HR product. It posts a generic JSON record, so a system or an integration tool that can receive that request can use it.',
            'The push and export calls belong to the admin API. The settings screen configures the connection and the automatic push on hire.',
          ]),
        ],
      },
    ],
    plan: 'The HR system integration is included in the Growth and Enterprise plans, and not in Starter.',
    faqs: [
      {
        q: 'Which HR systems does it work with?',
        a: 'Hirely.ai has no connector for a named product. It posts a JSON record to an https address, so any system that can receive that request can use it, directly or through an integration tool.',
      },
      {
        q: 'Does the record include salary?',
        a: 'Yes, when the candidate has an accepted offer. The record also carries the benefits, the start date and the match and interview scores, so check that your HR system should hold them.',
      },
      {
        q: 'What happens if our system is down?',
        a: 'The attempt is logged as failed with the reason, and nothing is retried automatically. An admin can send the record again through the admin API.',
      },
      {
        q: 'Can our HR system pull records instead?',
        a: 'Yes. The export endpoint returns records for hired candidates and candidates with an accepted offer. You can filter by job and by date, and the call needs an admin token.',
      },
      {
        q: 'Is an erased candidate ever sent?',
        a: 'No. A candidate who has been erased is reported as not found, and no record is built.',
      },
    ],
    related: ['/integrations/webhooks', '/features', '/security', '/pricing'],
    ctaTitle: 'Connect hiring to your HR records',
    ctaText: 'Tell us which HR system receives your new hires.',
  },
  {
    slug: 'single-sign-on',
    title: 'Single sign-on',
    icon: 'key',
    metaTitle: 'Single sign-on with Google or your own provider',
    metaDescription:
      'Let people sign in to Hirely.ai with Google, or connect your own OIDC identity provider and require it for everyone except Super Admins.',
    eyebrow: 'Single sign-on',
    headline: 'Sign in with the account',
    accent: 'your team already has',
    lead: 'People can sign in with Google. On the Enterprise plan, a company can also connect its own OIDC identity provider and require it for everyone except Super Admins.',
    stats: [
      { value: '2', label: 'single sign-on options: Google and your own provider' },
      { value: '10', label: 'minutes a company sign-in attempt stays valid' },
    ],
    stepsEyebrow: 'Setup',
    stepsTitle: 'Connect your identity provider in four steps',
    steps: [
      {
        title: 'Copy the redirect address',
        description:
          'As a Super Admin, open Organization, then Sign-in. Copy the read-only redirect URI that Hirely.ai shows.',
      },
      {
        title: 'Register the app',
        description:
          'In your identity provider, create an OIDC application that uses that redirect address. Note the issuer, the client ID and the client secret.',
      },
      {
        title: 'Enter the details and test',
        description:
          'Enter the issuer, client ID, client secret and scopes. Press Test, which checks the provider and signs nobody in.',
      },
      {
        title: 'Turn it on',
        description:
          'Tick Enable single sign-on and save. People then see a sign-in button on the sign-in page for your company, and you can choose to require it.',
      },
    ],
    featuresEyebrow: 'What it does',
    featuresTitle: 'What you get with single sign-on',
    features: [
      {
        icon: 'key',
        title: 'Your OIDC provider',
        text: 'Works with an identity provider that publishes an OIDC discovery document and signs ID tokens with RS256 or ES256.',
      },
      {
        icon: 'shield',
        title: 'A protected sign-in flow',
        text: 'Each attempt uses PKCE with S256, a one-time state and nonce, and a cookie that ties it to the browser that started it.',
      },
      {
        icon: 'circlecheck',
        title: 'Strict token checks',
        text: 'The ID token must match your issuer and client ID, be recent, carry the right nonce and have an email the provider has verified.',
      },
      {
        icon: 'usercheck',
        title: 'Accounts on first sign-in',
        text: 'People with an email domain assigned to your company get a Recruiter account on first sign-in, when a seat is free.',
      },
      {
        icon: 'lock',
        title: 'Require it for everyone',
        text: 'With the requirement on, password sign-in and password reset emails are refused. Super Admins can still use their password.',
      },
      {
        icon: 'settings',
        title: 'Test before you switch on',
        text: 'The Test button checks the discovery document and the signing keys of your provider without signing anyone in.',
      },
    ],
    sections: [
      {
        id: 'sso-fields',
        eyebrow: 'Setup',
        title: 'What the Sign-in tab asks for',
        blocks: [
          table(
            ['Field', 'What to enter'],
            [
              ['Enable single sign-on', 'Turns the company sign-in button on. The issuer, client ID and client secret must be filled in first.'],
              ['Issuer', 'The https address of your identity provider, with no query or fragment.'],
              ['Client ID', 'The client ID of the application you registered.'],
              ['Client secret', 'The secret for that application. It is stored encrypted and shown as saved.'],
              ['Scopes', 'Separated by spaces or commas. The default is `openid email profile`, and `openid` and `email` are required.'],
              ['Require single sign-on', 'Refuses password sign-in for everyone except Super Admins. Single sign-on has to be on first.'],
              ['Redirect URI', 'Read-only. Register this address with your provider.'],
              ['Email domains', 'Read-only. Assigned to your company by the platform.'],
            ],
          ),
          p('Enter the client secret again whenever you change the issuer or the client ID.'),
        ],
      },
      {
        id: 'sso-checks',
        eyebrow: 'Safeguards',
        title: 'What Hirely.ai checks',
        blocks: [
          ul([
            'The discovery document must name the same issuer you entered, and every address in it must be a plain https address on a public network.',
            'If the provider lists what it supports, it must sign ID tokens with RS256 or ES256 and support PKCE with S256.',
            'A sign-in attempt expires after ten minutes, and it only completes in the browser that started it.',
            'The ID token must be issued to your client ID, carry the nonce for that attempt, be recent and have an email address the provider marks as verified.',
            'The person must belong to your company. An account that belongs to another company, or that is deactivated, is refused.',
          ]),
        ],
      },
      {
        id: 'sso-google',
        eyebrow: 'Google',
        title: 'Google sign-in',
        blocks: [
          p('The sign-in page also offers Google. A person with an active account can sign in with a Google account whose email Google has verified.'),
          p('A new person from an email domain that a company has claimed can create an account on first sign-in, when a seat is free. Anyone else is told to ask an administrator for an account.'),
        ],
      },
    ],
    plan: 'Single sign-on with your own identity provider is on the Enterprise plan, and Google sign-in is available as a sign-in option.',
    faqs: [
      {
        q: 'Who can set up single sign-on?',
        a: 'A Super Admin, on the Sign-in tab under Organization. The tab asks for the issuer, client ID, client secret and scopes.',
      },
      {
        q: 'What if our identity provider is unavailable?',
        a: 'Super Admins can still sign in with a password, even when single sign-on is required. They use the Administrator sign-in link on the sign-in page.',
      },
      {
        q: 'Does the platform still ask for a second step?',
        a: 'Not after a single sign-on. Hirely.ai signs the person in once your provider has vouched for them, so multi-factor rules belong in your identity provider.',
      },
      {
        q: 'Does Google sign-in need setup from us?',
        a: 'Nothing is set on the Sign-in tab. Google sign-in is configured for the whole deployment, and new accounts are only created for email domains that a company has claimed.',
      },
      {
        q: 'Are accounts created automatically?',
        a: 'Yes, but only for email domains the platform has assigned to your company, and only when a seat is free. New people get the Recruiter role.',
      },
    ],
    related: ['/security', '/features', '/integrations/email-delivery', '/pricing'],
    ctaTitle: 'Bring your own identity provider',
    ctaText: 'Tell us which provider your company uses.',
  },
  {
    slug: 'webhooks',
    title: 'Webhooks',
    icon: 'webhook',
    metaTitle: 'Signed webhooks for hiring events',
    metaDescription:
      'Send hiring events to your own systems with HMAC-signed webhooks. Choose from 13 event types, with a delivery log and a safety check on every address.',
    eyebrow: 'Webhooks',
    headline: 'Send hiring events',
    accent: 'to your own systems',
    lead: 'Hirely.ai posts a JSON message to your address when something happens, such as a hire or an accepted offer. Each message can be signed with your own secret, so your system can check where it came from.',
    stats: [
      { value: '13', label: 'event types to subscribe to' },
      { value: '50', label: 'recent deliveries shown for each webhook' },
      { value: '30', label: 'days of delivery history kept' },
    ],
    stepsEyebrow: 'Setup',
    stepsTitle: 'Add a webhook in four steps',
    steps: [
      {
        title: 'Open Platform Settings',
        description:
          'Sign in as an HR Admin or Super Admin with permission to manage webhooks. Open Platform Settings, then the Webhooks tab.',
      },
      {
        title: 'Add a webhook',
        description:
          'Enter the address, tick the events you want or All events, and pick a format. Add a signing secret.',
      },
      {
        title: 'Send a test',
        description:
          'Press Send test. Hirely.ai posts a ping event and shows the HTTP status that your system returned.',
      },
      {
        title: 'Watch the deliveries',
        description:
          'Open Deliveries to see each attempt with its event, status, timing and error. Edit the webhook and clear Active to pause it.',
      },
    ],
    featuresEyebrow: 'What it does',
    featuresTitle: 'What you get with webhooks',
    features: [
      {
        icon: 'webhook',
        title: 'Thirteen event types',
        text: 'Candidate, interview, scorecard, offer, job and application events. Or tick All events and receive everything.',
      },
      {
        icon: 'fingerprint',
        title: 'A signature you can check',
        text: 'The `X-Webhook-Signature` header holds an HMAC-SHA256 of the request body, made with your signing secret.',
      },
      {
        icon: 'shield',
        title: 'Public addresses only',
        text: 'An address that points to a private, loopback or link-local network is refused when you save it, and again when Hirely.ai sends.',
      },
      {
        icon: 'message',
        title: 'Slack and Teams formats',
        text: 'Choose Slack or Teams, and the event is sent as a one-line text summary instead of the raw JSON.',
      },
      {
        icon: 'clock',
        title: 'A delivery log',
        text: 'Every attempt is recorded with its HTTP status, duration and error. The Deliveries panel lists the latest 50.',
      },
      {
        icon: 'bell',
        title: 'Failure alerts',
        text: 'Turn on the Webhook Delivery Failed alert to email your notify address, at most once an hour for each webhook.',
      },
    ],
    sections: [
      {
        id: 'webhook-events',
        eyebrow: 'Events',
        title: 'The events you can subscribe to',
        lead: 'Every payload also carries `event` and `occurred_at`.',
        blocks: [
          table(
            ['Event', 'Fires when', 'Main fields'],
            [
              ['`candidate.invited`', 'A candidate is invited to an interview', '`candidate_id`, `candidate_name`, `job_id`, `stage`, `invite_type`'],
              ['`candidate.status_changed`', 'A candidate moves to another stage', '`candidate_id`, `candidate_name`, `job_id`, `stage`, `decision` when there is one'],
              ['`candidate.hired`', 'A hire decision is recorded', '`candidate_id`, `candidate_name`, `job_id`, `stage`, `decision`'],
              ['`candidate.rejected`', 'A reject decision is recorded', '`candidate_id`, `candidate_name`, `job_id`, `stage`, `decision`'],
              ['`interview.completed`', 'A candidate submits an AI interview', '`candidate_id`, `candidate_name`, `job_id`, `stage`'],
              ['`interview.external_scheduled`', 'An interview is scheduled on another platform', '`candidate_id`, `candidate_name`, `job_id`, `stage`, `platform`, `scheduled_start_at`'],
              ['`scorecard.submitted`', 'An interviewer submits a scorecard', '`candidate_id`, `candidate_name`, `job_id`, `scorecard_id`'],
              ['`offer.created`', 'An offer is created', '`offer_id`, `candidate_id`, `candidate_name`, `job_id`, `status`'],
              ['`offer.sent`', 'An offer is sent', '`offer_id`, `candidate_id`, `candidate_name`, `job_id`, `status`'],
              ['`offer.accepted`', 'A candidate accepts an offer', '`offer_id`, `candidate_id`, `candidate_name`, `job_id`, `status`'],
              ['`offer.declined`', 'A candidate declines an offer', '`offer_id`, `candidate_id`, `candidate_name`, `job_id`, `status`'],
              ['`job.created`', 'A job is created', '`job_id`, `title`'],
              ['`application.received`', 'Someone applies on the careers page', '`application_id`, `job_id`, `title`'],
            ],
          ),
          note('A webhook fired by a workflow rule carries the event context of that rule instead. It can include more fields, such as an email address or a match score.'),
        ],
      },
      {
        id: 'webhook-verify',
        eyebrow: 'Verify',
        title: 'How to check a delivery',
        blocks: [
          table(
            ['Header', 'Value'],
            [
              ['`Content-Type`', '`application/json`'],
              ['`X-Webhook-Event`', 'The event name, such as `offer.accepted`'],
              ['`X-Webhook-Delivery`', 'A unique ID for this delivery'],
              ['`X-Webhook-Signature`', 'The HMAC-SHA256 of the raw body, as lowercase hex, made with the signing secret'],
            ],
          ),
          ol([
            'Read the raw request body as bytes, before you parse any JSON.',
            'Compute an HMAC-SHA256 of those bytes with your signing secret and write it as lowercase hex.',
            'Compare the result with `X-Webhook-Signature` using a constant-time comparison.',
            'Store `X-Webhook-Delivery` and skip a delivery you have already handled.',
          ]),
          p('The signature covers the body only and has no timestamp. The delivery ID is what lets you ignore a repeat.'),
          note('Set a signing secret on every webhook. Without one, Hirely.ai falls back to a platform-wide secret if the deployment has one, and otherwise sends the signature header empty.'),
        ],
      },
      {
        id: 'webhook-delivery',
        eyebrow: 'Delivery',
        title: 'How delivery behaves',
        blocks: [
          ul([
            'Each attempt waits up to 2.5 seconds for your answer, and a live event gets at most two attempts within a short overall time limit.',
            'A second attempt is made only when there is no answer or your system returns a 5xx code. A 4xx code is final.',
            'Any 2xx code counts as delivered. Redirects are not followed, and an answer larger than 64,000 bytes counts as a failure.',
            'A failed delivery is recorded and not queued for later, so answer quickly and do slow work after you reply.',
            'Both http and https addresses are accepted. Use https.',
          ]),
          p('Deliveries are kept for 30 days. The Deliveries panel shows the latest 50 for each webhook.'),
        ],
      },
    ],
    plan: 'Webhooks are included in the Growth and Enterprise plans, and not in Starter.',
    faqs: [
      {
        q: 'Can I send events to Slack or Teams?',
        a: 'Yes. Choose the Slack or Teams format and use the incoming webhook address from that tool. The event arrives as a one-line summary instead of raw JSON.',
      },
      {
        q: 'What happens if my endpoint is down?',
        a: 'Hirely.ai tries again once when there is no answer or a 5xx code, then records the delivery as failed. Failed deliveries are not queued for later, and the Deliveries panel shows the error.',
      },
      {
        q: 'Can I see the signing secret after I save it?',
        a: 'No. The list shows a Secret set badge. To change the secret, enter a new one, and leave the field empty to keep the current one.',
      },
      {
        q: 'Do payloads include resumes or interview reports?',
        a: 'No. The events in the table carry ids, names, titles, stages and statuses. Resumes, transcripts and reports are not part of them.',
      },
      {
        q: 'How do I pause a webhook?',
        a: 'Edit it and clear Active. Deleting a webhook removes the address and its event list at once, and it cannot be undone.',
      },
    ],
    related: ['/integrations/hrms', '/features', '/security', '/integrations/email-delivery'],
    ctaTitle: 'Feed hiring events into your tools',
    ctaText: 'Tell us which systems should hear about a hire.',
  },
  {
    slug: 'email-delivery',
    title: 'Email delivery',
    icon: 'mail',
    metaTitle: 'Send hiring email from your own mail server',
    metaDescription:
      'Candidate email goes out through the platform sender, or through your own SMTP server from your own address, with connection checks and a delivery log.',
    eyebrow: 'Email delivery',
    headline: 'Send from the platform',
    accent: 'or from your own domain',
    lead: 'Invitations, interview links, offers and status updates are sent by email. By default they go through the platform sender, and on Growth and Enterprise a Super Admin can switch to your own SMTP server.',
    stats: [
      { value: '4', label: 'SMTP ports accepted: 25, 465, 587 and 2525' },
      { value: '7', label: 'days of sent and failed counts on the delivery tab' },
    ],
    stepsEyebrow: 'Setup',
    stepsTitle: 'Switch to your own mail server in four steps',
    steps: [
      {
        title: 'Open the Email tab',
        description:
          'As a Super Admin, open Organization, then Email. Choose Your own mail server in the Send email through switch.',
      },
      {
        title: 'Enter the server details',
        description:
          'Enter the sender name and address, an optional reply-to address, the host, the port, the user name, the password and the TLS setting. Then save.',
      },
      {
        title: 'Check the connection',
        description:
          'Press Check connection. Hirely.ai connects and signs in to your server, and sends no message.',
      },
      {
        title: 'Send a test email',
        description:
          'Enter your own address and send a test. The result says whether it was delivered through your server or through the platform sender.',
      },
    ],
    featuresEyebrow: 'What it does',
    featuresTitle: 'What you get with your own mail server',
    features: [
      {
        icon: 'mail',
        title: 'Your address on every message',
        text: 'Set the sender name, the sender address and a reply-to address. Candidate email also carries your logo and colours from Branding.',
      },
      {
        icon: 'server',
        title: 'SMTP on four ports',
        text: 'Use port 25, 465, 587 or 2525. Port 465 connects over TLS from the start, and the other ports upgrade to TLS after connecting.',
      },
      {
        icon: 'lock',
        title: 'Password kept masked',
        text: 'The password is encrypted at rest and shown only as saved. You can change it or remove it.',
      },
      {
        icon: 'shield',
        title: 'Public servers only',
        text: 'The host must resolve to public addresses. A mail server on a private network is refused.',
      },
      {
        icon: 'circlecheck',
        title: 'Check before you rely on it',
        text: 'Check connection and the test email are both rate limited, and each use is written to the audit log.',
      },
      {
        icon: 'inbox',
        title: 'A delivery log',
        text: 'Every send is recorded as sent, failed or not sent. Platform Settings shows the last seven days and the newest failures.',
      },
    ],
    sections: [
      {
        id: 'email-routes',
        eyebrow: 'Routes',
        title: 'Two routes for outgoing email',
        blocks: [
          table(
            ['Route', 'Who sets it', 'When it is used'],
            [
              ['Your own mail server', 'A Super Admin, on the Email tab under Organization', 'When the switch is set to Your own mail server and the settings are complete'],
              ['The platform sender', 'The operator of the deployment', 'Otherwise. It uses Amazon SES when that is enabled, and SMTP when it is not'],
            ],
          ),
          p('If your own server fails, the message is not sent another way, because the sender address is yours. The failure is recorded in the delivery log.'),
        ],
      },
      {
        id: 'email-rules',
        eyebrow: 'Rules',
        title: 'What the settings enforce',
        blocks: [
          ul([
            'The host name must resolve to public addresses only.',
            'The port must be 25, 465, 587 or 2525.',
            'The sender address, and the reply-to address if you set one, must be a single valid email address.',
            'A user name needs a password, and a password needs a user name.',
            'TLS has to be on to sign in with a user name and password.',
            'Your own server is used only when the host, port and sender address are set, and the password is saved if a user name is set.',
          ]),
          p('Set the SPF and DKIM records for your sending domain in your own DNS. Hirely.ai does not manage DNS.'),
        ],
      },
      {
        id: 'email-monitoring',
        eyebrow: 'Monitoring',
        title: 'Watching delivery',
        blocks: [
          p('Platform Settings has an Email Delivery tab for HR Admins and Super Admins. It shows sent, failed and console-only counts for the last seven days, the newest failures with the error, and interview invitations that never went out.'),
          p('From there an admin can resend failed invitations, up to 25 per run, and send waiting invitations once a mail provider works.'),
        ],
      },
    ],
    plan: 'Sending through your own mail server is included in the Growth and Enterprise plans, and every plan can send through the platform sender.',
    faqs: [
      {
        q: 'Can we use Amazon SES?',
        a: 'Amazon SES is a platform-level option that the operator of the deployment enables. It is not a setting on the Email tab, where companies connect an SMTP server.',
      },
      {
        q: 'Who can change the mail settings?',
        a: 'Only a Super Admin. The Email tab does not appear for HR Admins or Recruiters, and every change is written to the audit log.',
      },
      {
        q: 'What happens if the connection fails?',
        a: 'The message is recorded as failed with a reason, and it is not sent through the platform instead. Fix the settings, then resend failed invitations from the Email Delivery tab.',
      },
      {
        q: 'Do candidates see our branding in the email?',
        a: 'Yes. Candidate email uses the logo and primary colour from your Branding settings. With your own server it also comes from your sender name and address.',
      },
      {
        q: 'Is there a limit on test emails?',
        a: 'Yes. Each Super Admin can run five connection checks and five test emails in ten minutes, and a company can send twenty test emails an hour.',
      },
    ],
    related: ['/integrations/single-sign-on', '/integrations/webhooks', '/features', '/security'],
    ctaTitle: 'Send hiring email from your domain',
    ctaText: 'Ask us and we will show the mail settings and the delivery log.',
  },
]
