import { h3, p, table, ul, type LegalDoc } from '../../../components/site/blockModel'

export const DPA: LegalDoc = {
  slug: 'dpa',
  title: 'Data Processing Addendum',
  description:
    'How Hirely.ai processes personal data for its customers: roles, instructions, security, subprocessors, transfers and deletion.',
  intro:
    'This addendum sets out how Hirely.ai handles personal data on behalf of its customers. It forms part of the agreement between us and the customer.',
  related: ['/terms', '/privacy', '/subprocessors', '/candidate-privacy'],
  sections: [
    {
      id: 'scope-and-precedence',
      title: 'Scope and order of precedence',
      blocks: [
        p('This addendum applies when we process personal data on your behalf in providing Hirely.ai. In it, "you" and "the customer" mean the client that has accepted the [Terms of Service](/terms) or signed an order form, and "we" means Hirely.ai. It forms part of the agreement described in the Terms and applies for as long as we process personal data for you.'),
        p('Terms such as controller, processor, personal data, data subject, processing and personal data breach have the meaning given in the data protection law that applies, which may include the EU GDPR, the UK GDPR and the Swiss Federal Act on Data Protection (together, "Data Protection Law").'),
        p('If there is a conflict about the processing of personal data, the following order applies: the Standard Contractual Clauses where they apply, then this addendum, then the Terms and the order form. For anything other than the processing of personal data, the Terms and the order form apply as they say.'),
        p('This addendum does not cover personal data for which we are the controller, such as account, billing, contact form and website data. The [Privacy Policy](/privacy) covers that data.'),
      ],
    },
    {
      id: 'roles',
      title: 'Roles of the parties',
      blocks: [
        p('For candidate data that is uploaded or collected on behalf of a company, and for the other personal data you put into the service, you are the controller and we are the processor. You decide why and how the data is used. We process it for you.'),
        p('If you are a processor for another controller, such as a group company or a client of yours, you confirm that you are authorised to give us the instructions in this addendum on that controller\'s behalf, and we are your subprocessor.'),
        p('Each of us will comply with the Data Protection Law that applies to it. You are responsible for having a lawful basis for the processing, for giving candidates the notices the law requires and for obtaining any consent the law requires.'),
      ],
    },
    {
      id: 'details-of-processing',
      title: 'Details of the processing',
      blocks: [
        table(
          ['Item', 'Description'],
          [
            ['Subject matter', 'Providing the Hirely.ai recruitment platform to the customer.'],
            ['Duration', 'The term of the agreement, and afterwards for as long as needed to return or delete the data as set out in this addendum. Candidate records are also kept or deleted under each company\'s retention settings.'],
            ['Nature of the processing', 'Storing, extracting text from, classifying, embedding, matching and scoring resumes and applications; generating interview questions; recording and transcribing interview answers; scoring answers and coding submissions; producing reports; sending email; displaying data to users; erasing data.'],
            ['Purpose', 'Running the recruitment features the customer uses: job targeting, resume intake, matching, voice interviews, coding assessments, integrity signals for human review, offers, pipeline tracking and performance review cycles.'],
            ['Categories of data subjects', 'Candidates and applicants. The customer\'s users, such as recruiters, administrators, interviewers and reviewers. People who take part in performance reviews.'],
            ['Categories of personal data', 'Candidate data: name, email, phone, resume file and extracted text, application note, classification, embedding vector, interview audio and transcript, answers, scores, integrity flags and events, coding submissions with typing and paste events, offers and status history. User data: name, email, role, optional job title, time zone, profile picture. Audit and activity logs.'],
            ['Special categories', 'The service does not record or store video. Face analysis for integrity signals runs in the candidate\'s browser, and the resulting flags and events are stored. Resumes, notes and interview answers are free text and may contain special categories of data if a candidate includes it. You should not ask candidates for such data unless you need it and have a lawful basis.'],
          ],
          'Description of the processing',
        ),
      ],
    },
    {
      id: 'instructions',
      title: 'Customer instructions',
      blocks: [
        p('We process personal data only on your documented instructions. Your instructions are this addendum, the agreement, and how you and your users use and configure the service, for example by setting retention periods, enabling integrations or editing AI prompts.'),
        p('You may give further written instructions through [our contact form](/contact?topic=privacy) where they are reasonable and consistent with the agreement. If an instruction would need changes to the service or extra work, we will tell you before we act on it.'),
        ul([
          'If we believe an instruction breaks Data Protection Law, we will tell you.',
          'If the law requires us to process data in another way, we will tell you before we do, unless the law forbids it.',
          'We will not use personal data in Customer Data for our own purposes, and we do not train models on it.',
        ]),
      ],
    },
    {
      id: 'personnel',
      title: 'Confidentiality of personnel',
      blocks: [
        p('We limit access to personal data to the people who need it to provide, secure and support the service. Everyone who has access is bound by a duty of confidentiality, by contract or by law.'),
      ],
    },
    {
      id: 'security-measures',
      title: 'Security measures',
      blocks: [
        p('We apply the technical and organisational measures below. The [Security](/security) page describes them in more detail. We may update the measures over time, but we will not reduce the overall level of protection.'),
        table(
          ['Area', 'Measure'],
          [
            ['Authentication', 'Passwords are hashed with bcrypt. Sessions use signed tokens. Two-step sign-in with an authenticator app or an emailed code, with recovery codes. Sign-in with Google or with the company\'s own OIDC provider.'],
            ['Company security policy', 'Each company can set a minimum password length, require a number and a symbol, set lockout after failed sign-ins with a lockout period, and set a session timeout.'],
            ['Access control', 'Role-based access with a permission matrix for each endpoint. Department scoping.'],
            ['Separation between companies', 'Every record is tied to a company and every query is scoped to the company in the data layer. Vectors are tagged by company. Cross-company access is rejected and covered by automated tests.'],
            ['Protection of secrets', 'Integration credentials and mail passwords are encrypted at rest with authenticated encryption and shown masked. The API checks its own configuration at start-up and refuses to start with a shipped default secret or default admin password.'],
            ['Abuse protection', 'Rate limiting on sign-in and on public endpoints, including careers, applications, and interview and offer links. Uploaded files are checked for size, type and content signature. Webhook addresses are checked against private-network targets, and outbound webhooks are signed.'],
            ['Logging', 'An audit log of administrative actions and an activity feed.'],
            ['Candidate communications', 'Interview and offer links are unguessable tokens. Candidate-facing email never carries scores or report content.'],
            ['Hosting', 'The application is deployed on Vercel over HTTPS. Data is stored in MongoDB and vectors in Pinecone.'],
          ],
          'Technical and organisational measures',
        ),
      ],
    },
    {
      id: 'subprocessors',
      title: 'Subprocessors',
      blocks: [
        p('You give us general authorisation to use subprocessors. The current list is on the [Subprocessors](/subprocessors) page. Optional services on that list are used only when a company enables them.'),
        ul([
          '**Notice of changes.** Before we add or replace a subprocessor that will process personal data, we will update the list and tell you, for example by email to your account administrators or by a notice in the service.',
          '**Right to object.** You may object on reasonable data protection grounds within a reasonable time after the notice. We will work with you to resolve the concern. If we cannot, you may end the part of the service that depends on that subprocessor, as set out in the order form.',
          '**Flow-down.** We have a written agreement with each subprocessor that requires it to protect personal data to a standard no less protective than this addendum.',
          '**Responsibility.** We remain responsible to you for our subprocessors\' performance of those obligations.',
        ]),
      ],
    },
    {
      id: 'data-subject-requests',
      title: 'Assistance with requests and assessments',
      blocks: [
        h3('Requests from data subjects'),
        p('If a data subject contacts us about personal data we process for you, we will tell you and, unless the law requires otherwise, direct them to you. We will not respond ourselves except to say that we have passed the request on.'),
        p('The service gives you tools to handle requests:'),
        ul([
          'Each company sets how long it keeps candidate records and resumes. The minimum is 30 days, and an empty setting means keep until deleted.',
          'Candidate records can be erased by candidate or by email address. Erasure removes personal fields and keeps only a minimal record (identifiers, status and dates), unless you also confirm that employment records are to be erased.',
          'Resumes, files and vectors are deleted with the candidate.',
        ]),
        p('If a request needs more than these tools can do, we will give reasonable help. Contact us through [our contact form](/contact?topic=privacy).'),
        h3('Impact assessments'),
        p('Taking into account the nature of the processing and the information available to us, we will give you the information you reasonably need for a data protection impact assessment or a consultation with a regulator. Useful starting points are our [Security](/security) and [Responsible AI](/responsible-ai) pages and the list of subprocessors.'),
      ],
    },
    {
      id: 'personal-data-breach',
      title: 'Personal data breach',
      blocks: [
        p('We will notify you without undue delay after we become aware of a personal data breach affecting personal data we process for you. We will send the notice to your account administrators or to the contact you have given us.'),
        p('The notice will describe, as far as we know, the nature of the breach, the categories and approximate number of people and records concerned, the likely consequences and the measures taken or proposed. Where we cannot provide everything at once, we will provide it in stages as it becomes available.'),
        p('We will take reasonable steps to contain the breach and will cooperate with you. You are responsible for deciding whether to notify regulators and individuals. Our notice is not an admission of fault.'),
      ],
    },
    {
      id: 'international-transfers',
      title: 'International transfers',
      blocks: [
        p('You authorise us and our subprocessors to process personal data in the countries needed to provide the service. Where processing takes place depends on how the service is configured and on the subprocessors involved.'),
        p('Where personal data is transferred from the EEA, the United Kingdom or Switzerland to a country that has not been found to provide an adequate level of protection, the Standard Contractual Clauses and the UK Addendum apply as incorporated by reference into this addendum.'),
        ul([
          'The Standard Contractual Clauses are those approved by the European Commission. Module Two (controller to processor) applies between you and us. Module Three (processor to processor) applies where we transfer data to a subprocessor.',
          'The UK Addendum is the International Data Transfer Addendum issued by the UK Information Commissioner.',
          'For Swiss transfers, references in the clauses to the GDPR are read as references to the Swiss Federal Act on Data Protection.',
          'The description of the transfer is the table of processing details above, the security measures are those above, and the subprocessors are those on the Subprocessors page. Other choices that the clauses require are as stated in the order form.',
          'If the clauses conflict with this addendum, the clauses prevail.',
        ]),
        p('If a transfer mechanism stops being valid, we will work with you in good faith to put another one in place.'),
      ],
    },
    {
      id: 'return-and-deletion',
      title: 'Return and deletion',
      blocks: [
        p('When the agreement ends, we will, at your choice, return or delete the personal data we process for you, unless the law requires us to keep it. Tell us your choice through [our contact form](/contact?topic=privacy). Take any copies you need before the agreement ends.'),
        p('If you do not tell us, the data is kept or deleted under each company\'s retention settings. Resumes, files and vectors are deleted with the candidate record. On request, we will confirm that deletion has taken place.'),
      ],
    },
    {
      id: 'audits-and-information',
      title: 'Audits and information',
      blocks: [
        p('We will give you the information reasonably needed to show that we meet this addendum. This includes this addendum, the Security and Subprocessors pages and written answers to reasonable questions.'),
        p('If that is not enough, you may audit our compliance once a year, or at any time after a personal data breach or where a regulator requires it. The following conditions apply:'),
        ul([
          'You give us reasonable written notice, and the audit takes place during normal business hours.',
          'You or an independent auditor bound by confidentiality carries it out, and the auditor is not our competitor.',
          'The audit is limited to what is needed to check our compliance with this addendum. It does not extend to other customers\' data or to information we must keep confidential.',
          'It is arranged to avoid unreasonable disruption to the service, and each party bears its own costs.',
        ]),
      ],
    },
    {
      id: 'liability',
      title: 'Liability',
      blocks: [
        p('Each party\'s liability under this addendum is subject to the limits and exclusions in the Terms and the order form. Nothing in this addendum limits a liability that the law does not allow to be limited, or the rights of data subjects under the Standard Contractual Clauses.'),
      ],
    },
  ],
}
