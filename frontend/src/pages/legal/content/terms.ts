import { SITE } from '../../../lib/site'
import { h3, p, table, ul, type LegalDoc } from '../../../components/site/blockModel'

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  description:
    'The terms that apply when your organisation uses Hirely.ai: accounts, AI features, data, fees, liability and termination.',
  intro:
    "These terms govern how your organisation uses Hirely.ai, an AI recruitment platform. By creating an account, accepting an order form or using the service, you agree to them.",
  related: ['/privacy', '/acceptable-use', '/dpa', '/subprocessors'],
  sections: [
    {
      id: 'who-we-are',
      title: 'Who we are and this agreement',
      blocks: [
        p("In these terms, \"we\", \"us\" and \"our\" mean Hirely.ai. \"You\" means the organisation that signs an order form, creates a client account or otherwise accepts these terms, together with the people who use the service on its behalf."),
        p("The agreement between us is made up of these terms, any order form you sign with us, the [Data Processing Addendum](/dpa) and the [Acceptable Use Policy](/acceptable-use). If they conflict, the order form prevails on the commercial points it covers, the Data Processing Addendum prevails on the processing of personal data, and these terms prevail over the Acceptable Use Policy."),
        p("Hirely.ai is for business use only. If you accept these terms for an organisation, you confirm that you have the authority to bind it."),
        table(
          ['Term', 'Meaning'],
          [
            ['Service', 'The Hirely.ai platform, including the web application, the public careers site, candidate-facing links and related support.'],
            ['Client', 'The paying customer. A client owns a plan and can hold one or more companies.'],
            ['Company', 'A workspace inside a client. Every record belongs to one company.'],
            ['User', 'A person you give access to a company, such as a recruiter, hiring manager, interviewer or administrator.'],
            ['Candidate', 'A person who applies for a role or is invited to an interview, assessment or offer through the service.'],
            ['Customer Data', 'All data that you, your users or candidates (on your behalf) put into the service, and the results the service produces from it for you.'],
            ['Order form', 'A written order, quote or online sign-up that identifies your plan, fees and any special terms.'],
          ],
          'Defined terms used in this agreement',
        ),
      ],
    },
    {
      id: 'the-service',
      title: 'The service, accounts and how they are organised',
      blocks: [
        p('Hirely.ai helps hiring teams run the work between a job opening and a decision. It parses job descriptions, reads and classifies resumes, matches candidates to roles, runs voice interviews and coding assessments, issues offers and tracks the pipeline. The recruiter makes every decision.'),
        h3('Platform, client and company'),
        p('The service is organised in three levels. We operate the platform. A client is the paying customer and owns a plan. A company is a workspace inside a client. Every record is tied to a company, and access across companies is rejected by the service.'),
        p('You decide which companies to create and which users to give access to, within the limits of your plan.'),
        h3('Accounts and users'),
        ul([
          'Each user has a personal account. Do not share credentials between people.',
          'Administrators assign roles and permissions, and can limit users to departments.',
          'Give us accurate information when you register and keep it up to date.',
          'You are responsible for everything done through your accounts, including by users you invite.',
          'Tell us promptly through [our contact form](/contact?topic=security) if you suspect that an account has been used without permission.',
        ]),
        h3('Candidates'),
        p("Candidates do not need an account. They reach interviews, coding assessments, offers and scorecards through unguessable links, and they can apply to public jobs on the careers site. Candidates are not our customers. Their relationship is with the employer that invited them or owns the job."),
      ],
    },
    {
      id: 'your-responsibilities',
      title: 'Your responsibilities and lawful use',
      blocks: [
        p('You decide how you use the service and who you hire. You are responsible for making sure that your use is lawful in every place where you recruit. In particular, you must:'),
        ul([
          'have a lawful basis for processing candidate data, and give candidates every notice the law requires before you collect their data, including notice that interview answers are recorded as audio and transcribed, that integrity signals may be collected during interviews and that coding activity is monitored, where you use those features;',
          'obtain any consent the law requires. The consent box on the careers application form does not replace notices you owe to candidates;',
          'follow employment, equal opportunity and anti-discrimination laws that apply to your hiring;',
          'follow laws and rules on automated or AI-assisted hiring decisions that apply to you, including requirements for notice, transparency, human review, bias testing and candidate rights, and configure and use the service accordingly;',
          'choose retention periods that fit your legal obligations;',
          'where the law or your own policy requires it, set your own Terms and Privacy links in the company branding settings so they appear on candidate-facing pages;',
          'make sure that job descriptions you publish on the careers site are accurate and lawful.',
        ]),
        p('We provide tools. We do not give legal advice and we do not decide whether your use of the service is lawful.'),
        p('You are responsible for your users. Make sure they follow these terms and the Acceptable Use Policy, and set the company security policy (password rules, two-step sign-in, lockout and session timeout) at a level that fits your risk.'),
      ],
    },
    {
      id: 'customer-data',
      title: 'Customer Data and the licence you give us',
      blocks: [
        p('As between us, you keep all rights in Customer Data. Customer Data includes job descriptions, resumes, candidate records, interview audio and transcripts, answers, scores and reports, coding submissions, offers, settings and branding.'),
        p('You give us a limited, non-exclusive licence to host, store, process, copy, transmit and display Customer Data, and to share it with our subprocessors, only as needed to provide, secure and support the service for you, to bill you, and to meet our legal obligations. We do not train models on Customer Data. Hirely.ai has no model-training pipeline.'),
        p('You confirm that you hold the rights and permissions needed to upload Customer Data and to have us process it as described in these terms.'),
        p('We also generate operational data about the service, such as usage, AI cost, audit and activity logs. We use it to run, bill, secure and support the service.'),
      ],
    },
    {
      id: 'candidate-data',
      title: 'Candidate data and roles',
      blocks: [
        p('For candidate data that is uploaded or collected on behalf of a company, the company is the controller and we are the processor. We process that data only on your documented instructions, as set out in the [Data Processing Addendum](/dpa).'),
        p('For account, billing, contact form and website data, we are the controller. The [Privacy Policy](/privacy) explains how we handle that data, and the [Candidate Privacy Notice](/candidate-privacy) explains what candidates can expect from the service.'),
        ul([
          'Applications submitted on the careers site go only to the company that owns the job.',
          'Each company chooses how long to keep candidate records and resumes. The minimum is 30 days. If the setting is empty, records are kept until they are deleted.',
          'Candidate records can be erased by candidate or by email address. Erasure removes personal fields and leaves only a minimal record (identifiers, status and dates) unless you also confirm that employment records are to be erased. Resumes, files and vectors are deleted with the candidate.',
        ]),
        p('If a candidate contacts us about their data, we may direct them to the employer. We will help you respond to requests as described in the Data Processing Addendum.'),
      ],
    },
    {
      id: 'ai-features',
      title: 'AI features and outputs',
      blocks: [
        p('The service uses language models to classify resumes, generate interview questions, score answers and write summaries. It uses embeddings to match resumes and roles, and speech models to ask interview questions aloud and transcribe answers. The providers are listed on the [Subprocessors](/subprocessors) page.'),
        h3('Recommendations only'),
        p('AI outputs are scores, summaries, recommendations and flags. They are recommendations for a person to review. They are not hiring decisions, and the service does not reject candidates automatically.'),
        ul([
          'Integrity flags from interviews and coding assessments are signals for human review. They are not findings of misconduct, and the integrity score does not reject anyone by itself.',
          'Auto-invite is an automated action. It is off by default and is switched on only in the deployment settings. Where it is on, you are responsible for how you use the invitations it sends.',
          'Company administrators can edit AI prompts and email templates. The audit log records changes. You are responsible for the effect of changes your administrators make.',
        ]),
        h3('Human review and no guarantee'),
        p('A person who is qualified to decide must review AI outputs before you rely on them. AI outputs can be wrong, incomplete or biased. We do not guarantee that they are accurate, complete, fair or suitable for your purpose, and you must not treat them as the only basis for a decision about a person.'),
        p('Read more on our [Responsible AI](/responsible-ai) page.'),
      ],
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable use',
      blocks: [
        p('You and your users must follow the [Acceptable Use Policy](/acceptable-use). It also applies to candidates who take interviews and assessments through the service.'),
        p('We may remove content, restrict features or suspend access, as described in the section on suspension and termination, if use of the service breaks the policy or these terms.'),
      ],
    },
    {
      id: 'plans-and-limits',
      title: 'Plans, usage limits and trials',
      blocks: [
        p('Our plans and their limits are shown on the [Pricing](/pricing) page, which reads them from the service. A plan sets the number of companies you can hold, the number of users in each company, the monthly AI budget, the storage available and which features are included. Some features, such as coding assessments, workflow automation, webhooks, single sign-on and integrations, are available only on some plans.'),
        h3('What happens at a limit'),
        ul([
          'When a company has used its monthly AI budget, new AI actions pause until the next month or until the limit is raised.',
          'When storage is full, uploads are refused until space is freed or the limit is raised.',
          'You cannot add more companies or users than your plan allows.',
        ]),
        p('To raise a limit or change plan, speak to us through [our contact form](/contact?topic=sales). Fees for a higher limit are as stated in your order form or on the Pricing page.'),
        h3('Trials'),
        p('If we offer a trial, its length and limits are stated when it is offered. These terms apply to trials. Trial access is provided without any commitment to availability, and ends when the trial ends unless you move to a paid plan.'),
      ],
    },
    {
      id: 'billing',
      title: 'Fees, billing, renewal and cancellation',
      blocks: [
        ul([
          'Fees are as stated in your order form or, for plans bought online, as shown on the Pricing page when you buy.',
          'Fees exclude taxes unless stated otherwise. You are responsible for taxes that apply to your purchase, other than taxes on our income.',
          'Invoicing and payment dates are as stated in your order form.',
          'Your subscription term and how it renews are as stated in your order form. A change in price applies from your next renewal, and we will tell you before it does.',
          'To change or cancel your plan, tell us through [our contact form](/contact?topic=sales). The notice period and the date on which cancellation takes effect are as stated in your order form.',
          'Refunds, if any, are as stated in your order form.',
        ]),
        p('If you do not pay fees when they are due, we may suspend the service as described in the section on suspension and termination. You stay responsible for fees that have already fallen due.'),
      ],
    },
    {
      id: 'third-party-services',
      title: 'Third-party services and integrations',
      blocks: [
        p('The service relies on providers for language models, embeddings, speech, vector search, database, hosting, email and code execution. They are listed on the [Subprocessors](/subprocessors) page. We stay responsible for them as set out in the Data Processing Addendum.'),
        p('Some features connect to services that you choose to enable: Google sign-in, your own OIDC identity provider, Zoom, Microsoft Teams, an HRMS, your own SMTP server and webhook destinations. When you enable one, you authorise the exchange of data needed for it to work. The provider\'s own terms govern your use of its service, and we are not responsible for how it works.'),
        ul([
          'Coding assessments run in an external sandbox. The candidate\'s code is sent there to run.',
          'Integration credentials and mail passwords are encrypted at rest and shown masked.',
          'You are responsible for the systems that receive your webhooks.',
        ]),
      ],
    },
    {
      id: 'confidentiality-ip',
      title: 'Confidentiality and intellectual property',
      blocks: [
        h3('Confidentiality'),
        p('Each of us must keep the other\'s non-public information confidential. Customer Data is your confidential information. The non-public parts of the service, its documentation and its security design are ours.'),
        p('Use confidential information only to perform or use this agreement. Share it only with people who need it for that purpose and who are bound to protect it, or where the law requires disclosure (tell the other party first, where the law allows). This does not apply to information that is or becomes public through no fault of the receiver, was already known to it, was developed independently, or was received lawfully from someone else. These duties continue after the agreement ends.'),
        h3('Intellectual property'),
        p('We and our licensors own the service, its software, design, documentation and branding. During the term, we give you a limited, non-exclusive, non-transferable right to use the service for your internal recruitment. You may not copy, resell, reverse engineer or build a competing product from the service, or work around its limits.'),
        p('You own Customer Data. You give us the right to display your company name, logo and colours on pages you brand, such as candidate-facing pages.'),
        p('If you send us suggestions about the service, we may use them without obligation to you.'),
      ],
    },
    {
      id: 'security',
      title: 'Security and data protection',
      blocks: [
        p('We protect the service with the measures below. The [Security](/security) page describes them in more detail.'),
        ul([
          'Passwords are hashed with bcrypt, and sessions use signed tokens.',
          'Two-step sign-in with an authenticator app or an emailed code, with recovery codes. Sign-in with Google or with your own OIDC provider.',
          'A company security policy that sets minimum password length, number and symbol requirements, lockout after failed sign-ins and session timeout.',
          'Role-based access, department scoping, and an audit log of administrative actions.',
          'Every query is scoped to the company that owns the data. Cross-company access is rejected and covered by automated tests.',
          'Rate limiting on sign-in and on public endpoints, and checks on the size, type and content signature of uploaded files.',
          'Integration credentials and mail passwords are encrypted at rest.',
        ]),
        p('Security is shared. You manage your users, roles and security policy, and you must keep your credentials safe. No system is free of risk, and we do not promise that the service will never be breached or interrupted.'),
        p('Our duties as a processor of personal data, including breach notification, are in the [Data Processing Addendum](/dpa). To report a vulnerability, use [our contact form](/contact?topic=security).'),
      ],
    },
    {
      id: 'availability',
      title: 'Availability and changes to the service',
      blocks: [
        p('We work to keep the service available, but we do not commit to a level of uptime or response time unless your order form says so. The service may be unavailable for maintenance, or because of a problem at a provider such as our hosting or AI providers.'),
        p('We develop the service continuously. We may add, change or remove features. If a change materially reduces what your plan includes, we will tell you in advance where we reasonably can.'),
        p('Support is available through [our contact form](/contact?topic=support). Any specific support commitments are as stated in your order form.'),
      ],
    },
    {
      id: 'suspension-termination',
      title: 'Suspension and termination',
      blocks: [
        h3('Suspension'),
        p('We may suspend a client, a company or a user, in whole or in part, where:'),
        ul([
          'the Acceptable Use Policy or these terms are breached;',
          'fees are overdue;',
          'use threatens the security or stability of the service or of other customers;',
          'we are required to by law or by a regulator.',
        ]),
        p('Where it is reasonable to do so, we will tell you why and give you a chance to fix the problem first. We will lift the suspension once the cause is resolved. Suspension is not a request to delete Customer Data. Retention settings continue to apply, and you can ask for return or deletion as described below.'),
        h3('Termination'),
        p('You can end the agreement as set out in your order form. We can end it by written notice if you materially breach it and do not fix the breach within a reasonable period after we tell you, or immediately for serious or repeated breaches of the Acceptable Use Policy or for unlawful use.'),
        p('When the agreement ends, your right to use the service ends and you remain responsible for fees that have fallen due. Sections that are meant to continue, such as confidentiality, intellectual property, warranty disclaimer, liability and governing law, continue.'),
        h3('Your data at the end'),
        p('Before the agreement ends, take any copies of Customer Data that you need. On your request, made through [our contact form](/contact?topic=privacy), we will return or delete Customer Data, unless the law requires us to keep it. Otherwise Customer Data is kept or deleted under the retention settings of each company. Resumes, files and vectors are deleted with the candidate record.'),
      ],
    },
    {
      id: 'warranty-disclaimer',
      title: 'Warranty disclaimer',
      blocks: [
        p('We will provide the service with reasonable care and skill. Beyond that, and to the extent the law allows, the service is provided "as is" and "as available". We do not warrant that it will be uninterrupted or error-free, or that AI outputs will be accurate, complete or suitable for any particular purpose. We give no implied warranties of merchantability, fitness for a particular purpose or non-infringement.'),
        p('Nothing in the service is legal, employment or hiring advice. Nothing in these terms excludes a warranty that the law does not allow to be excluded.'),
      ],
    },
    {
      id: 'liability-indemnities',
      title: 'Limitation of liability and indemnities',
      blocks: [
        h3('Limitation of liability'),
        p('Nothing in this agreement limits liability that the law does not allow to be limited, such as liability for fraud or for death or personal injury caused by negligence.'),
        p('Subject to that, neither of us is liable to the other for indirect or consequential loss, or for loss of profit, revenue, goodwill or anticipated savings. Each party\'s total liability under this agreement is limited to the cap stated in the order form or, if none is stated, to the fees paid for the service in the twelve months before the event giving rise to the claim. The cap does not reduce your obligation to pay fees.'),
        p('We are not liable for hiring decisions, for decisions made in reliance on AI outputs, or for the outcome of any recruitment process you run. Liability under the Data Processing Addendum is subject to this section.'),
        h3('Your indemnity'),
        p('You will defend us against third-party claims, including claims by candidates, employees and regulators, and pay the resulting damages, costs and settlements that a court or settlement approved by you awards, to the extent the claim arises from Customer Data or your use of the service in breach of the law or of this agreement. That includes failing to give required notices or obtain required consents, discrimination or unfair treatment in your hiring, and breaches of the Acceptable Use Policy.'),
        h3('Our indemnity'),
        p('We will defend you against third-party claims that the service, as we provide it, infringes that party\'s intellectual property rights, and pay the resulting damages, costs and settlements that a court or settlement approved by us awards. This does not cover claims that arise from Customer Data, from combining the service with something we did not provide, or from use that breaks this agreement. If a claim is made or likely, we may obtain the right for you to keep using the service, change it so it no longer infringes, or end the affected part of the service.'),
        h3('How claims work'),
        p('The party seeking protection must tell the other promptly, let it control the defence and settlement, and give reasonable help. A settlement that admits fault or imposes duties on the protected party needs that party\'s consent.'),
      ],
    },
    {
      id: 'governing-law-changes',
      title: 'Governing law, general terms and changes',
      blocks: [
        h3('Governing law'),
        ...(SITE.governingLaw
          ? [
              p(`These terms and any dispute that arises from them are governed by the laws of ${SITE.governingLaw}. The courts and venue for disputes are as stated in your order form.`),
            ]
          : [p('The governing law and the venue for disputes are as stated in your order form.')]),
        h3('General terms'),
        ul([
          'This agreement is the whole agreement between us on its subject and replaces earlier understandings about it.',
          'If a provision is found unenforceable, the rest stays in force.',
          'A delay in enforcing a right is not a waiver of it.',
          'You may not assign this agreement without our written consent. We may assign it as part of a merger, sale of the business or reorganisation, and will tell you.',
          'Neither of us is liable for a failure caused by events beyond our reasonable control.',
          'We may give you notice by email to your account administrators or inside the service. You may give us notice through [our contact form](/contact).',
        ]),
        h3('Changes to these terms'),
        p('We may update these terms. The date at the top of this page shows when they were last changed. If a change materially affects you, we will tell you before it takes effect. If you keep using the service after that date, you accept the change. A change does not override terms agreed in a signed order form during its term.'),
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        p('If you have a question about these terms, use [our contact form](/contact).'),
        ...(SITE.contactEmail ? [p(`You can also write to [${SITE.contactEmail}](mailto:${SITE.contactEmail}).`)] : []),
        ...(SITE.address ? [p(`Our address is ${SITE.address}.`)] : []),
      ],
    },
  ],
}
