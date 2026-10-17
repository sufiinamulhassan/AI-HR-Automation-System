import { SITE } from '../../../lib/site'
import { h3, p, table, ul, type LegalDoc } from '../../../components/site/blockModel'

export const ACCESSIBILITY: LegalDoc = {
  slug: 'accessibility',
  title: 'Accessibility',
  description:
    'Our accessibility commitment for Hirely.ai: the WCAG 2.2 AA target, what is in place, known limits, accommodations and how to report a barrier.',
  intro:
    'We want Hirely.ai to work for everyone who uses it, including candidates applying for jobs. This page explains our target, what we have done, where the gaps are and how to tell us about a barrier.',
  related: ['/terms', '/candidate-privacy', '/privacy'],
  sections: [
    {
      id: 'our-commitment',
      title: 'Our commitment and target',
      blocks: [
        p('Hiring tools shape who gets an opportunity, so they have to be usable by people with different abilities and different ways of working with a computer. We build Hirely.ai with that in mind.'),
        p('We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. This is a target. It is not a statement that the service already conforms in full.'),
      ],
    },
    {
      id: 'what-we-do',
      title: 'What we do',
      blocks: [
        h3('The public site'),
        p('The public pages, including the home page, features, pricing, security, careers and legal pages, are built with these in place:'),
        table(
          ['Area', 'What it means'],
          [
            ['Keyboard operation', 'Links, buttons, menus and forms can be used with a keyboard.'],
            ['Visible focus', 'The element that has keyboard focus is clearly marked.'],
            ['Skip link', 'A link at the top of each page lets you jump straight to the main content.'],
            ['Landmarks and headings', 'Pages use landmark regions and a logical heading order, so assistive technology can navigate them.'],
            ['Labelled form fields', 'Every field in the contact form and the application form has a label.'],
            ['Reduced motion', 'Animation is reduced when your system asks for reduced motion.'],
            ['Responsive layout', 'Pages adapt to small and large screens, and to larger text sizes.'],
            ['Text alternatives', 'Images that carry meaning have a text alternative.'],
          ],
        ),
        h3('The application'),
        p('The application behind sign-in is work in progress. We are improving it, and some screens may not yet meet our target. We would rather tell you that plainly than say otherwise. If something blocks you, please [report it](/contact?topic=support).'),
      ],
    },
    {
      id: 'known-limitations',
      title: 'Known limitations',
      blocks: [
        ul([
          '**Live interviews.** A voice interview needs a microphone, because the AI interviewer asks questions aloud and the candidate answers aloud. Proctored sessions also need a camera. If this is a barrier for you, speak to the employer about an alternative before you start.',
          '**Third-party content.** Coding assessments run code in an external sandbox service, and meetings can be held in Zoom or Microsoft Teams when a company enables them. We do not control how accessible those services are.',
          '**PDF files.** Interview reports and offer letters are produced as PDF files, and a PDF may not work as well with assistive technology as a web page does.',
          '**Application screens.** As noted above, parts of the signed-in application are still being improved.',
        ]),
      ],
    },
    {
      id: 'accommodations',
      title: 'Accommodations for candidates',
      blocks: [
        p('If you need an adjustment to an interview, a coding assessment or an application, ask the employer first. The employer decides the hiring process, including the format and timing of any interview or assessment, so it is the one who can change it.'),
        p('If you are not sure whom to ask, or the employer has not responded, we will help route your request. Use [our contact form](/contact?topic=support), tell us which employer and role it concerns, and say what you need. We will pass details on only with your permission.'),
        p('Some assistive tools can look unusual to the automated integrity checks in interviews and assessments. Tell the employer in advance if you use them. Integrity flags are signals for a person to review. They do not reject anyone by themselves.'),
      ],
    },
    {
      id: 'report-a-barrier',
      title: 'How to report a barrier',
      blocks: [
        p('Tell us through [our contact form](/contact?topic=support) and choose the support topic. It helps if you include:'),
        ul([
          'the page or step where the problem happened, and a link if you have one;',
          'what you were trying to do and what happened instead;',
          'the browser, device and operating system you use;',
          'any assistive technology you use, and its version;',
          'whether you are a visitor, a candidate or a user of a customer account;',
          'how you would like us to reply.',
        ]),
        p('Please do not send passwords or the private link to your interview or offer.'),
        ...(SITE.contactEmail ? [p(`You can also write to [${SITE.contactEmail}](mailto:${SITE.contactEmail}).`)] : []),
      ],
    },
    {
      id: 'our-response',
      title: 'Our response approach',
      blocks: [
        p('We read every report. We will reply using the contact details you give us and tell you what we can do. We fix problems in the order that matters most to the people affected, starting with barriers that stop someone from completing a task.'),
        p('If we cannot fix something right away, we will try to offer another way to get the same information or finish the same task. If your request is tied to a deadline, such as an interview date, say so in your message.'),
      ],
    },
    {
      id: 'technical-notes',
      title: 'Technical notes',
      blocks: [
        p('We support current versions of Chrome, Edge, Firefox and Safari. Using an up-to-date browser gives you the best results with assistive technology.'),
        p('Hirely.ai is a web application built with HTML, CSS and JavaScript, and it needs JavaScript to run. How well it works for you also depends on your browser, operating system and assistive technology.'),
      ],
    },
  ],
}
