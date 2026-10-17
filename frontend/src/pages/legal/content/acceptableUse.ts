import { SITE } from '../../../lib/site'
import { h3, p, table, ul, type LegalDoc } from '../../../components/site/blockModel'

export const ACCEPTABLE_USE: LegalDoc = {
  slug: 'acceptable-use',
  title: 'Acceptable Use Policy',
  description:
    'The rules for using Hirely.ai: fair and lawful hiring, the data you upload, protecting the service, and candidate conduct in interviews and assessments.',
  intro:
    'This policy sets out what is and is not allowed on Hirely.ai. It keeps the service safe for our customers and fair for the candidates who go through it.',
  related: ['/terms', '/privacy', '/candidate-privacy', '/dpa'],
  sections: [
    {
      id: 'purpose-and-scope',
      title: 'Purpose and who this applies to',
      blocks: [
        p('This policy is part of the [Terms of Service](/terms). It applies to three groups of people:'),
        ul([
          '**Customers**: the clients and companies that hold accounts on Hirely.ai.',
          '**Their users**: recruiters, hiring managers, interviewers, reviewers and administrators who sign in on a customer\'s behalf.',
          '**Candidates**: people who apply for a role, or who take an interview or a coding assessment, through the service.',
        ]),
        p('The examples below are not a complete list. If something would harm the service, a customer or a candidate in the same way as an example, treat it as covered. Customers are responsible for the conduct of their users.'),
      ],
    },
    {
      id: 'lawful-and-fair-hiring',
      title: 'Lawful and fair hiring',
      blocks: [
        h3('No unlawful discrimination'),
        p('Do not use the service to treat people unfairly because of a characteristic that the law protects, such as race, colour, ethnicity, national origin, sex, gender, sexual orientation, age, disability, religion, pregnancy or marital status. Do not write job criteria, AI prompts, interview scenarios or score thresholds that screen candidates in or out on that basis.'),
        h3('Use the service for what it is designed for'),
        p('Hirely.ai supports recruitment: reading resumes, matching candidates to roles, interviews, coding assessments, offers and performance review cycles. Do not use it to make decisions it is not designed for, such as decisions about credit, housing, insurance, education or law enforcement. Do not treat integrity flags as proof of misconduct.'),
        h3('Keep a person in the decision'),
        ul([
          'A person must review AI scores, summaries, recommendations and flags before any decision about a candidate.',
          'Do not build processes that reject candidates automatically on AI output alone.',
          'Use automatic invitations only if the law and your own policies allow it.',
        ]),
        h3('Be honest with candidates'),
        ul([
          'Do not publish fake, misleading or unlawful jobs on the careers site.',
          'Do not use a job post, an application form or an invitation to collect personal data for any other purpose.',
          'Do not ask candidates to pay money to apply, interview or receive an offer.',
          'Give candidates the notices and obtain the consents that the law requires.',
        ]),
      ],
    },
    {
      id: 'data-you-upload',
      title: 'Data you may upload and rights you must hold',
      blocks: [
        p('Only upload or collect data that you have the right to use for recruitment. You are responsible for the lawfulness of what you put into the service.'),
        ul([
          'Do not upload data that was collected unlawfully, or taken from sources whose terms forbid collecting it, such as scraped profiles.',
          'Do not upload content that infringes someone else\'s intellectual property, or content that is unlawful, harassing or abusive.',
          'Do not upload more sensitive data than the hiring process needs, such as government identity numbers, health records or financial account details.',
          'Do not upload malware, or files that disguise their real type. Uploaded files are checked for size, type and content signature, and files that fail are refused.',
          'Respect the file types the service accepts: PDF, DOC and DOCX for resumes, and TXT on the careers application form.',
          'Keep to the storage and upload limits of your plan.',
        ]),
        p('Candidates who apply on the careers site must give their own details and a resume that is theirs.'),
      ],
    },
    {
      id: 'accounts-and-credentials',
      title: 'Protecting accounts and credentials',
      blocks: [
        ul([
          'Keep your credentials private. Do not share an account between people.',
          'Use a strong password that meets your company security policy, and turn on two-step sign-in with an authenticator app or an emailed code.',
          'Give each user only the role and department access they need, and remove access when a person leaves.',
          'Do not try to reach another company\'s data or another person\'s account. Cross-company access is rejected.',
          'Treat interview, coding, offer, review and scorecard links as private. They are unguessable by design, so do not post them publicly or send them to anyone other than the intended person.',
          'If you think an account or link has been compromised, tell us at once through [our contact form](/contact?topic=security).',
        ]),
      ],
    },
    {
      id: 'protecting-the-service',
      title: 'Protecting the service',
      blocks: [
        p('Do not do any of the following:'),
        table(
          ['Not allowed', 'Examples'],
          [
            ['Scraping and harvesting', 'Collecting jobs, candidate data or other content from the careers site or the application in bulk by automated means.'],
            ['Probing and attacking', 'Scanning for vulnerabilities, trying to break authentication, or testing the service\'s defences without our written permission.'],
            ['Load testing and flooding', 'Sending traffic meant to slow, overload or disrupt the service or other customers.'],
            ['Bypassing limits and controls', 'Working around rate limits, plan limits (AI budget, storage, users, companies), permissions, department scoping or any other access control.'],
            ['Abusing public endpoints', 'Automated or fake submissions to careers applications, the contact form, interview links or offer links.'],
            ['Misusing integrations', 'Pointing webhooks or integrations at private-network addresses or at systems you do not control.'],
            ['Reverse engineering', 'Copying, decompiling or extracting the service\'s code, prompts or models, or building a competing product from it.'],
          ],
        ),
        p('If you find a weakness, do not exploit it. Report it through [our contact form](/contact?topic=security).'),
      ],
    },
    {
      id: 'messages-and-invitations',
      title: 'Messages and invitations',
      blocks: [
        p('The service sends email for you, such as invitations, offers and review requests. You are responsible for what is sent in your name.'),
        ul([
          'Send messages only to people who have a genuine reason to receive them, such as candidates who applied or whom you have a legitimate reason to contact.',
          'Do not send spam or unsolicited bulk messages, and follow the anti-spam laws that apply to you.',
          'Do not send deceptive invitations. Do not pretend to be another company or person, and do not use misleading subject lines or fake roles.',
          'Do not use email templates, invitations or offer letters to ask candidates for payments, passwords or data you do not need.',
          'If you use your own SMTP server, you are responsible for its sender reputation and for the domain you send from.',
        ]),
      ],
    },
    {
      id: 'candidate-conduct',
      title: 'Candidate conduct in interviews and coding assessments',
      blocks: [
        p('The employer decides the rules for each interview and assessment, and tells you what they are. In all cases:'),
        h3('Be yourself'),
        p('Do not impersonate another person, and do not let anyone else answer or code for you. Identity mismatch and multiple faces are flagged for the employer.'),
        h3('No unauthorised assistance'),
        p('Do not use another person, an AI tool, another device, notes, search or pasted answers unless the employer has said you may. Follow the instructions you are given.'),
        h3('Do not tamper with proctoring'),
        ul([
          'Do not block, switch off, spoof or work around the camera, microphone, face analysis, fullscreen requirement or tab and window monitoring.',
          'Do not use virtual cameras, extra displays, remote-control tools or a phone to get help during a session.',
          'Do not use screen sharing, screen recording or capture tools in a way that breaks the employer\'s rules. Do not copy, record or share interview questions or test cases with others.',
        ]),
        h3('Coding assessments'),
        ul([
          'Write your own code. Submissions are compared for plagiarism.',
          'Do not work around the paste-blocked editor, and do not try to see or extract hidden test cases.',
          'Do not run code meant to attack or damage the sandbox or other systems.',
        ]),
        p('Integrity flags are signals for the employer to review. They do not reject anyone by themselves, and the employer decides what follows. Some interviews can end automatically after repeated tab switches. If you have a technical problem, or need an adjustment, contact the employer. Our [Accessibility](/accessibility) page explains how we can help.'),
      ],
    },
    {
      id: 'enforcement',
      title: 'Enforcement',
      blocks: [
        p('We look at how serious a breach is, whether it was deliberate or repeated, and what harm it caused. Depending on that, we may:'),
        ul([
          'send a warning and ask for the problem to be fixed;',
          'remove content or disable a feature, link or integration;',
          'apply stricter rate limits;',
          'suspend a user, a company or a client;',
          'terminate the agreement, as set out in the [Terms of Service](/terms);',
          'report unlawful activity to the relevant authorities, where the law requires or allows it.',
        ]),
        p('We may act without notice where there is a risk to security, to other customers or to candidates. We may investigate suspected breaches, which can involve reviewing logs and other information needed to establish what happened. If you think we acted in error, tell us through [our contact form](/contact?topic=support).'),
        p('Employers decide how to respond to a candidate\'s conduct in an interview or assessment. We do not make that decision for them.'),
      ],
    },
    {
      id: 'reporting-abuse',
      title: 'Reporting abuse',
      blocks: [
        ul([
          'To report a security weakness, a compromised account or an attack on the service, use [the security topic of our contact form](/contact?topic=security).',
          'To report anything else, such as misuse by a customer, a fake job post, or a suspicious email that claims to come from Hirely.ai or from an employer using it, use [the general topic of our contact form](/contact?topic=other).',
        ]),
        p('Please tell us what happened and when, which company or job it relates to, and any link or message involved. Do not send passwords or full candidate records. If you are a candidate and an invitation looks wrong, check with the employer who sent it.'),
        ...(SITE.securityEmail ? [p(`Security reports can also be sent to [${SITE.securityEmail}](mailto:${SITE.securityEmail}).`)] : []),
        ...(SITE.contactEmail ? [p(`Other reports can also be sent to [${SITE.contactEmail}](mailto:${SITE.contactEmail}).`)] : []),
      ],
    },
  ],
}
