import { p, table, type LegalDoc } from '../../../components/site/blockModel'

export const SUBPROCESSORS: LegalDoc = {
  slug: 'subprocessors',
  title: 'Subprocessors',
  description: 'The third-party providers Hirely.ai uses to process personal data, what each one does, and how we choose them and announce changes.',
  intro: 'Hirely.ai uses the providers below to run the platform. This page lists what each one does, what data it may process and when it is used.',
  related: ['/dpa', '/privacy', '/candidate-privacy'],
  sections: [
    {
      id: 'what-this-list-is',
      title: 'What this list is',
      blocks: [
        p('A subprocessor is a third party that processes personal data to help us deliver Hirely.ai. For candidate data, we process it on behalf of our customers, and the subprocessors on this page help us do that. Our [Data Processing Addendum](/dpa) covers that arrangement.'),
        p('Which providers apply to a given company depends on how that company and the deployment are configured. The sections below say when each one is used.'),
      ],
    },
    {
      id: 'providers',
      title: 'Providers we use',
      blocks: [
        table(
          ['Provider', 'What it does for Hirely.ai', 'Data it may process', 'When it is used'],
          [
            ['Vercel', 'Hosts the application and serves it over HTTPS', 'Requests to and from the application, which can include any data you send to it', 'Always'],
            ['MongoDB', 'Database', 'Stored platform data: account and company data, candidate records and their results, audit logs and contact form messages', 'Always'],
            ['Pinecone', 'Vector search for matching resumes and roles', 'Embedding vectors of resumes and job descriptions, tagged by company', 'Whenever matching is used'],
            ['OpenAI', 'Language models, embeddings (text-embedding-3-small), text to speech and speech to text', 'Job description and resume text, interview questions, answers and transcripts, and the audio of candidate answers for transcription', 'Default provider whenever AI features are used'],
            ['Anthropic', 'Language models (Claude)', 'The text used for language-model tasks such as classification, question generation, scoring and summaries', 'Only when a company or the operator configures it'],
            ['Amazon SES', 'Email delivery', 'Recipient email addresses and the content of emails, such as invitations and offer links. Emails to candidates never carry scores or report content', 'Only when enabled'],
            ['SMTP servers', 'Email delivery, using the platform\'s server or a company\'s own server', 'The same email data as above', 'When the platform or a company sends email by SMTP'],
            ['Judge0 or Piston', 'Runs candidate code in an external sandbox for coding assessments', 'The code a candidate writes and the inputs and results of running it', 'Only for coding assessments'],
          ],
          'Subprocessors used by Hirely.ai',
        ),
      ],
    },
    {
      id: 'optional-services',
      title: 'Optional services a company enables',
      blocks: [
        p('These services are not used unless a company administrator turns them on. The company chooses them and controls the connection.'),
        table(
          ['Service', 'What it does', 'Data it may process', 'Who decides'],
          [
            ['Google sign-in', 'Lets people sign in with a Google account', 'The identity details exchanged at sign-in, such as the account email address', 'The company, by enabling it'],
            ["The company's own OIDC provider", "Single sign-on through the company's identity provider", 'The identity details exchanged at sign-in', 'The company, which chooses the provider'],
            ['Zoom', 'Schedules interviews as Zoom meetings', 'Details needed to create a meeting, such as its label, time and duration, and who is invited', 'The company, by enabling the integration'],
            ['Microsoft Teams', 'Schedules interviews as Teams meetings', 'Details needed to create a meeting, such as its label, time and duration, and who is invited', 'The company, by enabling the integration'],
            ['HRMS', "Exchanges records with the company's HR management system", 'Records the company chooses to exchange. What is shared depends on how the company sets up the integration', 'The company, by enabling the integration'],
          ],
          'Optional services enabled by a company',
        ),
        p("Each of these services also has its own relationship with the company and its own terms. The company's administrator can turn them off."),
      ],
    },
    {
      id: 'where-data-is-processed',
      title: 'Where data is processed',
      blocks: [
        p('Where each provider processes data depends on how the deployment is configured and on the provider\'s own infrastructure. Transfers outside your country are covered in the international transfers section of our [Privacy Policy](/privacy).'),
        p('If you need more detail for a specific deployment, ask us through [our contact form](/contact?topic=privacy).'),
      ],
    },
    {
      id: 'how-we-choose',
      title: 'How we choose and bind subprocessors',
      blocks: [
        p('We use written contracts with our subprocessors that include data protection terms. We choose each provider for a specific function, and the tables above show what each one may process.'),
      ],
    },
    {
      id: 'changes-and-objections',
      title: 'Changes and the right to object',
      blocks: [
        p('When we add or replace a subprocessor, we update this page. Customers with an order form may also be notified in the way that order form states.'),
        p('A customer that has concerns about a new subprocessor can raise an objection. The [Data Processing Addendum](/dpa) explains how.'),
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        p('For questions about this list, use [our contact form](/contact?topic=privacy).'),
      ],
    },
  ],
}
