import type { TrustContent } from '../../../lib/siteContent'

export const TRUST: TrustContent = {
  intro:
    'The trust center brings together what Hirely.ai publishes about security, AI, privacy and its providers. It states what we do, and it says plainly what we have not published.',
  pillars: [
    {
      icon: 'shield',
      title: 'Security',
      text: 'Sign-in, access control, company isolation, encrypted credentials and the settings your admins control.',
      to: '/security',
    },
    {
      icon: 'eye',
      title: 'Responsible AI',
      text: 'Where AI is used, what it sees, what it produces and who makes the call afterwards.',
      to: '/responsible-ai',
    },
    {
      icon: 'filecheck',
      title: 'Privacy Policy',
      text: 'What Hirely.ai collects through the website and your account, why, and what you can control.',
      to: '/privacy',
    },
    {
      icon: 'users',
      title: 'Candidate Privacy Notice',
      text: 'What is collected when you apply or interview, how AI is used, who sees your data and how to use your rights.',
      to: '/candidate-privacy',
    },
    {
      icon: 'database',
      title: 'Data Processing Addendum',
      text: 'How we handle personal data on behalf of customers: roles, security, subprocessors and deletion.',
      to: '/dpa',
    },
    {
      icon: 'server',
      title: 'Subprocessors',
      text: 'The providers that process data for Hirely.ai, what each one does and when it is used.',
      to: '/subprocessors',
    },
  ],
  commitments: [
    {
      title: 'Access and sign-in',
      items: [
        'Passwords are hashed with bcrypt, and sessions use signed tokens.',
        'Two-step sign-in with an authenticator app or an emailed code, with recovery codes.',
        'Each company sets its own password length, number and symbol rules, lockout and session timeout.',
        'Sign-in with Google, or with a company-owned OIDC identity provider on the Enterprise plan.',
        'The API refuses to start with a shipped default secret or default admin password.',
      ],
    },
    {
      title: 'Data and isolation',
      items: [
        'Every record is tied to a company, and every query is scoped to that company in the data layer.',
        'Vectors in Pinecone are tagged by company.',
        'Cross-company access is rejected, and automated tests cover it.',
        'Integration credentials and mail passwords are encrypted at rest and shown masked.',
        'Sign-in and public pages are rate limited, and uploaded files and webhook URLs are checked.',
      ],
    },
    {
      title: 'AI and decisions',
      items: [
        'A person makes every hiring decision, and the platform does not reject candidates automatically.',
        'Auto-invite is off by default and is switched on only in the deployment settings.',
        'Hirely.ai has no model-training pipeline and does not train models on customer data.',
        'Admins edit AI prompts and email templates, and the audit log records changes.',
        'Integrity signals are flags for human review, and no video is recorded or stored.',
      ],
    },
    {
      title: 'Candidates',
      items: [
        'Interview, offer and scorecard links are unguessable.',
        'Email to candidates never carries scores or report content.',
        "Candidate pages can show the employer's own Terms and Privacy links.",
        'Each company sets retention, with a minimum of 30 days, and candidate records can be erased by candidate or by email address.',
        'No advertising, analytics or tracking cookies, and no third-party trackers.',
      ],
    },
  ],
  faqs: [
    {
      q: 'Does Hirely.ai hold third-party security certifications?',
      a: 'We have not published third-party certifications, audit reports, penetration test results or uptime figures, and we do not claim any. What we do state is on the [security](/security) page, and you can ask for more through the [security form](/contact?topic=security).',
    },
    {
      q: 'How do we get a security questionnaire answered?',
      a: 'Use the [security form](/contact?topic=security), say which review you are completing and include the questions. Our written answers follow the rule this site follows: we state what is true and say plainly what we have not published.',
    },
    {
      q: 'How do I report a security problem?',
      a: 'Use the [security form](/contact?topic=security) and include what you found and where, the steps to reproduce it, the impact you expect and how to reach you. Please test only with your own account and your own data.',
    },
    {
      q: 'Who is responsible for candidate data?',
      a: 'For candidate data uploaded or collected on behalf of a company, the company is the controller and Hirely.ai is the processor. For account, billing, contact-form and site data, Hirely.ai is the controller. See the [Data Processing Addendum](/dpa) and the [Privacy Policy](/privacy).',
    },
    {
      q: 'Which providers process our data?',
      a: 'Vercel hosts the app, MongoDB stores data and Pinecone handles vector search. OpenAI is the default AI and speech provider, with Anthropic when configured, plus email and code-execution services, and where each one processes data depends on how a deployment is configured. The [subprocessors](/subprocessors) page lists every provider.',
    },
  ],
}
