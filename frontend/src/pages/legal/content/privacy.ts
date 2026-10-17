import { h3, p, table, ul, type LegalDoc } from '../../../components/site/blockModel'
import { SITE } from '../../../lib/site'

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description: 'How Hirely.ai collects, uses, shares and protects personal data, and the rights and choices you have over it.',
  intro: 'This policy explains what personal data Hirely.ai handles through the platform and this website, why, who receives it and how you can control it. If you applied for a job through a company that uses Hirely.ai, start with the [Candidate Privacy Notice](/candidate-privacy).',
  related: ['/candidate-privacy', '/cookies', '/subprocessors', '/dpa'],
  sections: [
    {
      id: 'who-we-are',
      title: 'Who we are and our role',
      blocks: [
        p('Hirely.ai is an AI recruitment platform. In this policy, we and us mean Hirely.ai.'),
        h3('When we are the controller'),
        p('We are the controller of personal data about people who use our website and platform: account data, billing data, contact form messages and site data. We decide why and how that data is used, and this policy applies to it.'),
        h3('When we are the processor'),
        p("Companies that use Hirely.ai, our customers, put candidate data into the platform: names, resumes, interview answers and similar records. For that data the customer is the controller and we are the processor. We process it to provide the service to that customer, on the customer's instructions and under our [Data Processing Addendum](/dpa)."),
        p("The customer's own privacy notice explains how it uses candidate data. If you applied for a job or took an interview, read the [Candidate Privacy Notice](/candidate-privacy) and contact the employer first with any request."),
      ],
    },
    {
      id: 'scope',
      title: 'What this policy covers',
      blocks: [
        p('This policy covers personal data we handle as controller:'),
        ul([
          'People who visit our public website, including the careers pages.',
          'People who write to us through the contact form.',
          'People who have an account on the platform, such as recruiters, hiring managers and company administrators.',
          'Customers and their billing, plan and usage records.',
        ]),
        p('It does not cover candidate data we process for customers (see above), or the websites and services of customers and other third parties that we link to.'),
        p('The careers pages list jobs published by our customers. When you apply, your application goes only to the company that owns the job, and that company is the controller of it.'),
      ],
    },
    {
      id: 'information-we-collect',
      title: 'The information we collect',
      blocks: [
        p('The table shows the data we handle, where it comes from, why we use it and the legal basis we rely on.'),
        table(
          ['Category', 'Examples', 'Where it comes from', 'Why we use it', 'Legal basis'],
          [
            ['Account data', 'Name, email address, role, optional job title, time zone, profile picture', 'You, or the company administrator who created your account', 'To create and run your account, sign you in and show you the right workspace', 'Contract'],
            ['Sign-in and security data', 'Your password (stored only as a bcrypt hash), two-step sign-in settings, recovery codes, the sign-in security policy your company has set', 'You and your company administrator', 'To confirm who you are and protect accounts from misuse', 'Contract; legitimate interests (security)'],
            ['Company and plan data', 'Company settings, branding, plan and limits, usage and AI cost records, billing records', 'Customer administrators and our own systems', 'To provide the workspace, apply plan limits, measure usage and bill the customer', 'Contract; legal obligation (accounting records)'],
            ['Contact form messages', 'Name, email address, optional company, topic, message', 'You', 'To read and answer your message and keep a record of it', 'Legitimate interests'],
            ['Audit and activity logs', 'Administrative actions, who took them and when; activity feed entries', 'Created automatically when the platform is used', 'To keep accounts secure, show customers what changed and support investigations', 'Legitimate interests; contract'],
            ['IP addresses', 'The network address of requests to sign-in and public endpoints', 'Your browser or device', 'To rate limit requests and prevent abuse. Kept only for the short limiting window', 'Legitimate interests'],
            ['Browser storage', 'Session token and basic profile, interview-setup preferences', 'Your browser', 'To keep you signed in and remember settings you chose. See the [Cookie Policy](/cookies)', 'Contract; legitimate interests'],
            ['Candidate data processed for customers', 'Name, email, phone, resume file and extracted text, application note, classification, embedding vector, interview audio and transcript, answers, scores, integrity flags and events, coding submissions with typing and paste events, offers, status history', 'The candidate, or the customer\'s staff who upload or enter it', 'To provide the service to the customer, on the customer\'s instructions', 'Set by the customer as controller. We act as processor'],
          ],
          'Personal data, sources, purposes and legal bases',
        ),
        p('We do not use advertising or analytics trackers on this website or in the platform.'),
      ],
    },
    {
      id: 'how-we-use-information',
      title: 'How we use information',
      blocks: [
        p('We use the information described above to:'),
        ul([
          'Provide, operate and maintain Hirely.ai, and give customers the features in their plan.',
          'Sign you in, keep accounts secure and apply the security policy your company has set.',
          'Answer messages, give support and keep a record of what was agreed.',
          'Measure usage against plan limits, such as the monthly AI budget and storage, and calculate AI cost and billing.',
          'Keep audit logs of administrative actions.',
          'Watch the health of the service and diagnose problems.',
          'Meet our legal obligations and handle legal claims.',
        ]),
        p('We do not sell personal data. We do not use it for advertising, and we do not train AI models on it.'),
      ],
    },
    {
      id: 'legal-bases',
      title: 'Legal bases',
      blocks: [
        p('Where the law requires a legal basis for using personal data, we rely on one of the following.'),
        ul([
          '**Contract.** We need the data to provide the service you or your company asked for, or to take steps before a contract starts.',
          '**Legitimate interests.** We have a genuine business reason, such as keeping the service secure, preventing abuse and answering enquiries. We weigh this against your rights and interests.',
          '**Consent.** We use consent only where we ask for it at the point of collection. You can withdraw it at any time, and doing so does not affect what happened before.',
          '**Legal obligation.** We must keep or share the data to comply with the law, for example accounting duties or a lawful request.',
        ]),
        p('For candidate data we process for customers, the customer decides the purpose and the legal basis.'),
      ],
    },
    {
      id: 'how-ai-is-used',
      title: 'How AI is used',
      blocks: [
        p('Hirely.ai uses AI to take routine work out of recruitment. The recruiter makes every decision.'),
        table(
          ['AI task', 'Provider', 'What it receives'],
          [
            ['Classifying resumes, parsing job descriptions, generating interview questions, scoring answers and writing summaries', 'OpenAI by default (GPT-4o family). Anthropic Claude models when a company or the operator configures them', 'The text needed for the task: job description text, resume text, interview questions and the answers or transcripts being scored'],
            ['Embeddings for matching', 'OpenAI (text-embedding-3-small)', 'Resume and job description text. The resulting vectors are stored in Pinecone, tagged by company'],
            ['Interview voice: text to speech and speech to text', 'OpenAI speech models', 'The text of the interview questions to be spoken, and the audio of the candidate\'s answers for transcription'],
          ],
          'AI tasks, providers and the data they receive',
        ),
        p('AI produces scores, summaries, recommendations and flags. A recruiter reviews them and decides who moves forward. Company administrators can edit the AI prompts and email templates, and the audit log records those changes.'),
        p('Hirely.ai has no model-training pipeline and does not train models on customer data. Read more on our [Responsible AI](/responsible-ai) page.'),
      ],
    },
    {
      id: 'who-we-share-with',
      title: 'Who we share information with',
      blocks: [
        ul([
          "**Your company's workspace.** Other users and administrators of your company can see your account details according to the roles and permissions your company has set.",
          '**Service providers.** We use subprocessors for hosting, the database, vector search, AI models and speech, email and code execution. They are listed on our [Subprocessors](/subprocessors) page and are bound by contract to protect the data.',
          '**Services a company switches on.** If a company enables Google sign-in, its own identity provider, Zoom, Microsoft Teams or an HRMS, data goes to that service only as needed for the feature.',
          '**Legal requirements.** We may disclose data where the law, a court order or a valid request from an authority requires it, or where needed to protect rights, safety or security.',
          '**Business transfers.** If Hirely.ai is involved in a merger, acquisition or sale of assets, data may transfer to the new owner, which may use it as described in this policy.',
        ]),
        p('We do not sell personal data and we do not share it for advertising.'),
      ],
    },
    {
      id: 'international-transfers',
      title: 'International transfers',
      blocks: [
        p('Our service providers and our customers may be located in, or process data in, countries other than the one where you live. Where each provider processes data depends on how a deployment is configured.'),
        p('Where the law requires safeguards for a transfer, we use them. These include Standard Contractual Clauses, where applicable, and other approved transfer mechanisms. For candidate data, transfers are also addressed in the [Data Processing Addendum](/dpa).'),
        p('If you want to know which safeguards apply to your data, ask us through [our contact form](/contact?topic=privacy).'),
      ],
    },
    {
      id: 'how-long-we-keep-data',
      title: 'How long we keep data',
      blocks: [
        h3('Our own data'),
        ul([
          'Account data is kept while the account is open, and afterwards only as long as we need it, for example to resolve disputes or meet legal duties.',
          'Contact form messages are kept as long as needed to answer you and handle any follow-up.',
          'IP addresses are used for rate limiting and kept only for the short limiting window.',
          'Billing and plan records are kept as long as our legal and accounting duties require.',
          'Audit log entries are kept to maintain the record of administrative actions.',
        ]),
        h3('Candidate data held for customers'),
        p('Each company chooses how long to keep candidate records and resumes. A company that sets a period must set at least 30 days. If it leaves the setting empty, records are kept until they are deleted.'),
        p("Candidate records can be erased by candidate or by email address. Erasure removes the personal fields and keeps only a minimal record (identifiers, status and dates), unless the company also confirms erasure of employment records. Resumes, files and vectors are deleted with the candidate."),
      ],
    },
    {
      id: 'security',
      title: 'Security',
      blocks: [
        p('We protect personal data with technical and organisational measures. Among them:'),
        ul([
          'Passwords are hashed with bcrypt, and sessions use signed tokens.',
          'Two-step sign-in with an authenticator app or an emailed code, with recovery codes, plus Google and company identity provider sign-in.',
          'Company security policies: minimum password length, number and symbol requirements, lockout after failed sign-ins and session timeout.',
          'Integration credentials and mail passwords are encrypted at rest and shown masked.',
          'Rate limiting on sign-in and on the public pages and links that candidates use.',
          'Role-based access with department scoping, and an audit log of administrative actions.',
          'Every record is tied to a company, and every query is scoped to that company.',
        ]),
        p('No system is perfectly secure, and we cannot promise absolute security. For more detail, read our [Security](/security) page.'),
      ],
    },
    {
      id: 'your-rights',
      title: 'Your rights and how to use them',
      blocks: [
        p('Depending on where you live, you may have the right to:'),
        ul([
          'Access the personal data we hold about you.',
          'Correct data that is wrong or incomplete.',
          'Ask us to delete your data.',
          'Ask us to restrict how we use it.',
          'Receive your data in a portable format.',
          'Object to uses based on legitimate interests.',
          'Withdraw consent where we rely on it.',
        ]),
        h3('How to make a request'),
        p('Use [our contact form](/contact?topic=privacy) and choose the privacy topic. Tell us what you want and which account or email address it concerns. We may ask you to confirm your identity first, and we will answer within the time the law requires.'),
        h3('If you are a candidate'),
        p("Candidate data belongs to the employer you applied to, because the employer is the controller. Contact the employer first. If you write to us instead, we will pass your request to the employer, since only the employer can decide it."),
      ],
    },
    {
      id: 'cookies-and-storage',
      title: 'Cookies and browser storage',
      blocks: [
        p('We use no advertising cookies, no analytics and no third-party trackers. We store only what is needed to keep you signed in, remember settings you chose and complete single sign-on. The [Cookie Policy](/cookies) lists each item.'),
      ],
    },
    {
      id: 'automated-decisions',
      title: 'Automated decision-making',
      blocks: [
        p('Hirely.ai does not make hiring decisions. Recruiters decide who is shortlisted, interviewed, hired or rejected. The platform does not automatically reject candidates.'),
        p('Three features act without a person pressing a button:'),
        ul([
          '**Auto-invite.** Automatic interview invitations for candidates whose match score is above a threshold are off by default and are switched on only in the deployment settings. It is an automated action, and it only invites. It does not reject anyone.',
          '**Integrity score.** The score is computed from integrity flags, adjusts the interview score and is shown to the recruiter. It does not reject anyone by itself.',
          '**Interview end.** An interview can end automatically after repeated tab switches. The recruiter sees the result and decides what happens next.',
        ]),
        p('If you are a candidate and want a person to look at a result again, ask the employer. You can also use the rights described above.'),
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: [
        p('Hirely.ai is not directed at children under 16, and we do not knowingly collect personal data from them. If you believe a child has given us data, tell us through [our contact form](/contact?topic=privacy) and we will delete it.'),
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        p('We may update this policy as the service or the law changes. The date at the top of the page shows when it last changed. If a change is material, we will tell account holders in a suitable way, for example by email or a notice in the product.'),
      ],
    },
    {
      id: 'contact-and-complaints',
      title: 'Contact and complaints',
      blocks: [
        p('For questions about this policy or to make a request, use [our contact form](/contact?topic=privacy).'),
        ...(SITE.privacyEmail ? [p(`You can also write to [${SITE.privacyEmail}](mailto:${SITE.privacyEmail}).`)] : []),
        ...(SITE.address ? [p(`Our address is ${SITE.entity}, ${SITE.address}.`)] : []),
        p('You have the right to complain to the data protection supervisory authority where you live or work. We would like the chance to put things right first, but you do not have to contact us before you complain.'),
      ],
    },
  ],
}
