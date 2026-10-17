import { h3, note, ol, p, table, ul, type LegalDoc } from '../../../components/site/blockModel'
import { SITE } from '../../../lib/site'

export const CANDIDATE_PRIVACY: LegalDoc = {
  slug: 'candidate-privacy',
  title: 'Candidate Privacy Notice',
  description: 'What is collected when you apply or interview through Hirely.ai, how AI is used, who sees your data and how to use your rights.',
  intro: 'You are reading this because you applied for a job, or were invited to an interview or assessment, through a company that uses Hirely.ai. It explains what is collected, why, who can see it and what you can do.',
  related: ['/privacy', '/cookies', '/subprocessors', '/accessibility'],
  sections: [
    {
      id: 'who-is-responsible',
      title: 'Who is responsible for your data',
      blocks: [
        p('The company you applied to, the employer, decides why and how your data is used. It is the controller of your data.'),
        p("Hirely.ai provides the recruitment software. We process your data on the employer's behalf and on its instructions. In this notice, we and us mean Hirely.ai."),
        p("The employer's own privacy notice may add to this one, for example about how it uses your application in its hiring decisions. Pages you use may show the employer's own Terms and Privacy links."),
        p('Your data can also reach us because the employer uploaded your resume itself. Either way, this notice applies. For our website and accounts, see our [Privacy Policy](/privacy).'),
      ],
    },
    {
      id: 'what-is-collected',
      title: 'What is collected at each stage',
      blocks: [
        table(
          ['Stage', 'What is collected', 'Why'],
          [
            ['Applying through the careers page', 'Your name, email address, phone number and note (the last two are optional), your consent, your resume file and the text taken from it', 'To send your application to the employer that owns the job, and to read and score it'],
            ['Screening', 'A classification of your resume (domain, seniority, skills, experience and education), a numeric representation of it used for matching (an embedding), and scores against the open roles', 'To help the employer see which roles you may fit and to review applications faster'],
            ['Interview', 'Audio of your spoken answers, a transcript, your answers, the score for each answer, and the report built from them', 'To assess your answers and give the recruiter a scored report'],
            ['Integrity signals during the interview', 'Flags and events such as switching tabs or no face detected. Face analysis runs in your browser. Hirely.ai does not record or store video', 'To tell the recruiter when something may need a closer look'],
            ['Coding assessment', 'The code you write, how you typed it and any paste events', 'To run your code against hidden test cases and to compare submissions and typing patterns, so a recruiter can review anything unusual'],
            ['Offers', 'The offer sent to you and your acceptance', 'To record your response for the employer'],
            ['Throughout', 'Status changes as your application moves through the employer\'s process', 'To keep a record of where your application stands'],
          ],
          'Data collected at each stage of the process',
        ),
        p('Email we send you about your application never contains scores or report content.'),
      ],
    },
    {
      id: 'how-ai-is-used',
      title: 'How AI is used on your application',
      blocks: [
        ul([
          '**Parsing and matching.** AI reads your resume, sorts it into domain, seniority and skills, and compares it with the employer\'s open roles.',
          '**Question generation.** AI writes interview questions based on your resume and the role.',
          '**Speech.** A synthetic voice reads the questions aloud (text to speech), and your spoken answers are turned into text (speech to text).',
          '**Scoring.** AI scores your answers and writes summaries for the recruiter.',
        ]),
        p('A person decides. Scores, summaries, recommendations and flags help the recruiter. They do not decide for the recruiter, and the platform does not automatically reject any candidate.'),
        p('Automatic invitations are off by default. Where the service has been set up to send them, candidates whose match score is above a threshold are invited to interview automatically, and the invitation is all that is sent. You can ask the employer whether it uses them.'),
        p('AI language models, embeddings and speech are provided by OpenAI by default, or by Anthropic when the employer or operator configures it. Hirely.ai does not train AI models on customer data. Read more on our [Responsible AI](/responsible-ai) page.'),
        p('If you want a person to look at a result again, ask the employer.'),
      ],
    },
    {
      id: 'integrity-flags',
      title: 'What an integrity flag means',
      blocks: [
        p('During an interview or coding assessment the page watches for signals that something may be off. Each one is a flag. Flags are for human review. They are not automatic penalties.'),
        p('Flags go into the report the recruiter reads, and an integrity score is computed from them. The score adjusts the interview score and does not reject anyone by itself. Flags can be caused by ordinary things, such as a weak connection or someone walking into the room, and the recruiter weighs them with everything else.'),
        h3('Interview flags'),
        table(
          ['Flag', 'What it means'],
          [
            ['Tab switch', 'You moved to a different browser tab.'],
            ['Window blur', 'The interview window lost focus, for example because you clicked into another program.'],
            ['Left fullscreen', 'The interview left fullscreen mode.'],
            ['Multiple displays', 'More than one display was detected.'],
            ['Screen share detected', 'Screen sharing was detected.'],
            ['Connection lost', 'Your connection to the interview dropped.'],
            ['No face detected', 'The camera did not find a face.'],
            ['Multiple faces', 'More than one face was seen.'],
            ['Gaze off screen', 'Your gaze appeared to be away from the screen.'],
            ['Phone detected', 'A phone appeared in view of the camera.'],
            ['Identity mismatch', 'The identity check flagged a mismatch.'],
            ['Page unload attempt', 'You tried to close, reload or leave the interview page.'],
          ],
          'Interview integrity flags',
        ),
        h3('Coding assessment flags'),
        table(
          ['Flag', 'What it means'],
          [
            ['Paste blocked', 'You tried to paste into the code editor and the editor blocked it.'],
            ['Paste burst', 'A lot of text appeared in the editor at once.'],
            ['Low typing ratio', 'Little of the final code was typed by hand.'],
          ],
          'Coding assessment integrity flags',
        ),
        note('Face analysis runs in your browser. Hirely.ai does not record or store video.'),
        p('One action is automatic: an interview can end by itself after repeated tab switches. The recruiter sees the result and decides what happens next.'),
      ],
    },
    {
      id: 'who-can-see',
      title: 'Who can see your data',
      blocks: [
        ul([
          "**The employer's authorised staff.** Access depends on the roles and departments the employer has set up.",
          '**Our service providers.** Companies that host the service, store data, run AI models and speech, send email and run code in the coding sandbox. They are listed on our [Subprocessors](/subprocessors) page.',
        ]),
        p('Other companies using Hirely.ai cannot see your data. Every record is tied to one company, and every query is limited to that company. The careers pages list jobs from many companies, but your application goes only to the company that owns the job.'),
        p('We do not sell your data.'),
      ],
    },
    {
      id: 'how-long-kept',
      title: 'How long your data is kept',
      blocks: [
        p('The employer sets how long to keep candidate records and resumes. If it sets a period, the period is at least 30 days. If it sets none, records are kept until they are deleted. The employer\'s own privacy notice may give more detail.'),
        p('You can ask the employer to erase your data. The employer can erase a candidate by candidate record or by email address. Erasure removes your personal details and keeps only a minimal record (identifiers, status and dates), unless the employer also confirms erasure of employment records. Your resume, files and matching data are deleted with you.'),
      ],
    },
    {
      id: 'your-rights',
      title: 'Your rights and how to use them',
      blocks: [
        p('Depending on where you live, you may have the right to see your data, correct it, have it erased, restrict how it is used, object to its use, receive it in a portable format, withdraw consent, and ask for a person to review a result.'),
        ol([
          "Ask the employer first. It is the controller, and its privacy notice or the email you received shows how to reach it.",
          'If you cannot reach the employer, or prefer not to, use [our contact form](/contact?topic=privacy). Tell us the employer, the job and the email address you applied with. We will pass your request to the employer.',
          'The employer answers your request. It may ask you to confirm your identity first.',
        ]),
        p('We pass requests on because only the employer can decide them. If you gave consent when you applied, you can withdraw it the same way. Withdrawing does not affect what was done before.'),
        p('You also have the right to complain to the data protection supervisory authority where you live or work.'),
      ],
    },
    {
      id: 'not-providing-data',
      title: 'If you do not provide data or decline the interview',
      blocks: [
        p('The careers form needs your name, email address, consent and resume. Your phone number and note are optional. Without the required details your application cannot be submitted.'),
        p("You can choose not to take part in an interview or assessment. What that means for your application is the employer's decision. Hirely.ai does not reject you automatically. If you have a concern about taking part, for example about the camera or microphone, tell the employer before you start."),
      ],
    },
    {
      id: 'accommodations',
      title: 'Accommodations and accessibility',
      blocks: [
        p('If you need an adjustment to the process, for example because of a disability or a health condition, ask the employer. The employer decides which adjustments are possible. Hirely.ai cannot grant them for the employer.'),
        p('Read about our own work on this in our [Accessibility](/accessibility) statement.'),
      ],
    },
    {
      id: 'security',
      title: 'Security',
      blocks: [
        ul([
          'The service is served over HTTPS.',
          'Your interview, offer and similar links are unguessable and unique to you. Keep them private.',
          'Sign-in and the public pages and links candidates use, including careers, applications, and interview and offer links, are rate limited.',
          'Uploaded files are checked for size, type and content signature.',
          "Each employer's data is kept separate from every other company's.",
        ]),
        p('Read more on our [Security](/security) page.'),
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        p('For questions about a specific application or a decision, contact the employer. For questions about how Hirely.ai handles data, or to have a request passed to the employer, use [our contact form](/contact?topic=privacy).'),
        ...(SITE.privacyEmail ? [p(`You can also write to [${SITE.privacyEmail}](mailto:${SITE.privacyEmail}).`)] : []),
        ...(SITE.address ? [p(`Our address is ${SITE.entity}, ${SITE.address}.`)] : []),
      ],
    },
  ],
}
