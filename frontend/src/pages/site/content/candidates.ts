import { h3, note, ol, p, table, ul } from '../../../components/site/blockModel'
import type { CandidateGuide } from '../../../lib/siteContent'

export const CANDIDATE_GUIDE: CandidateGuide = {
  intro:
    'This page is for people who applied for a job, or were invited to an AI interview or coding assessment, through an employer that uses Hirely.ai. Hirely.ai is the tool, and the employer makes every hiring decision.',
  steps: [
    {
      title: 'Apply or get an invite',
      description:
        'Apply on the careers page, or open the interview or assessment link in the email the employer sent you. Each link is unique to you, so keep it private.',
    },
    {
      title: 'Check your setup',
      description:
        'Use Google Chrome on a device with a camera, a microphone and speakers or headphones. Pick a quiet place and close other apps and tabs.',
    },
    {
      title: 'Take the interview',
      description:
        'Allow camera and microphone access when asked. An AI voice asks questions made for you, you answer aloud, and you stay on the interview tab until it ends.',
    },
    {
      title: 'Wait for the employer',
      description:
        'The employer reviews the results and decides what happens next. Contact the employer about your outcome, because Hirely.ai does not decide.',
    },
  ],
  sections: [
    {
      id: 'what-to-expect',
      title: 'What to expect in the interview',
      blocks: [
        p('An interview is a voice conversation with an AI interviewer, held in your browser. The questions are generated from your resume and the role, and the AI can add a follow-up after an answer.'),
        h3('Step by step'),
        ol([
          'Open the link from the employer. If the interview is scheduled for later, the page tells you it is not open yet.',
          'Choose whether to turn on camera-based integrity monitoring. The interview goes ahead normally either way.',
          'Press the start button and allow camera and microphone access when your browser asks. The page then goes fullscreen.',
          'Listen to each question. An AI voice reads it aloud and the text appears on screen.',
          "Answer aloud. By default the interview starts listening when the question ends and moves on when you stop speaking. If you press 'Use buttons instead', you record your answer, check the transcript and choose to record again or use it.",
          'At the end you may see one optional question about gender and location. The screen says it is used only for diversity reporting, and you can skip it.',
          'When the last question is done, the page confirms the interview is complete and you can close the window.',
        ]),
        h3('What you see on screen'),
        ul([
          'A countdown timer and a question counter.',
          'Your own camera image next to the AI interviewer.',
          'A live transcript of the conversation, plus captions you can switch on in browsers that support them.',
          'An AI Notes tab with tips on your pace and clarity. The panel says only you can see it.',
          'A Summary tab that recaps the answers you have given. It is built on your own device and is not sent anywhere.',
          'A Whiteboard tab for sketching, which opens by itself on questions about design or architecture.',
          'A Code Screening tab. If the employer assigned a coding task, you work on it there. If not, it is a scratchpad that is not graded or submitted.',
          'An End Interview button, which submits the answers you have given so far.',
        ]),
        p('Each answer can run for up to 3 minutes, and the timer shows how long the whole interview can last. When the timer reaches zero, your answers so far are submitted.'),
        note('Your interview link works once. After you finish, the same link says the session is already complete, and links also expire after a set number of days, so ask the employer for a new invite if yours has expired.'),
      ],
    },
    {
      id: 'get-ready',
      title: 'Getting your device ready',
      blocks: [
        p('A few minutes of preparation avoids most problems. Check these before you open the link.'),
        ul([
          'Use Google Chrome. If your browser cannot record audio, the page asks you to open the link in Chrome, and other browsers may not support live captions.',
          'Check that your camera and microphone work and that no other app, such as a video-call app, is using them.',
          'Use speakers or headphones so you can hear the questions. If audio does not play, the question is still shown as text.',
          'Sit in a quiet place where you are the only person in view. If camera monitoring is on, more than one face in view can raise a flag.',
          'Close other tabs, chat apps and notifications before you begin. Moving to another tab or clicking into another window is recorded.',
          'Use a single display if you can, because a second display may be noted.',
          'Plug in your device and use a stable internet connection.',
        ]),
        p('The page asks your browser for both camera and microphone access to start, even if you decline camera-based monitoring. If your browser blocks them, the page explains what to change and offers a Retry button.'),
      ],
    },
    {
      id: 'what-is-checked',
      title: 'What is checked during the interview, and why',
      blocks: [
        p('Integrity checks help the employer trust that you took the interview yourself, in one sitting. They produce flags for a person to review, and a flag is a signal, not proof.'),
        table(
          ['What is checked', 'What happens'],
          [
            ['Tab switches and window focus', 'The page notices when you move to another tab or click into another window. You get a warning each time, and the event is shared with the recruiter.'],
            ['Fullscreen', 'You are asked to stay in fullscreen. If you leave, a banner asks you to go back and the event is recorded.'],
            ['Displays and screen capture', 'The page notes if more than one display is detected, and if screen capture is requested in the browser.'],
            ['Connection and leaving the page', 'A lost connection and any attempt to close or reload the page are recorded. If you try to leave while an answer is recording or uploading, the browser asks you to confirm.'],
            ['Camera checks, only if you turn them on', 'Your browser looks for a visible face, more than one face, a phone in view and whether you seem to look away from the screen. It also checks whether the face in view still matches the one seen at the start, and only short results such as face detected go to the recruiter.'],
            ['Code editor', 'Pasting and dropping text into the editor is blocked and recorded. A large amount of text appearing at once, or very little typing compared with the final code, is flagged too.'],
          ],
          'Integrity checks during the interview',
        ),
        p('Flags go into the report the recruiter reads, and an integrity score is computed from them. The score adjusts the interview score and does not reject anyone by itself, and flags can have ordinary causes such as a weak connection.'),
        h3('What stays on your device'),
        ul([
          'Face analysis runs in your browser, on your own device. Your video is never uploaded, recorded or stored.',
          'Your spoken answers are recorded as audio and sent to be turned into text by OpenAI speech models, as listed on the [subprocessors](/subprocessors) page.',
        ]),
        p('If you switch tabs or windows three times, the interview ends and your answers so far are submitted. The recruiter is told, and a person decides what happens next.'),
      ],
    },
    {
      id: 'if-something-goes-wrong',
      title: 'If something goes wrong',
      blocks: [
        table(
          ['If this happens', 'Do this'],
          [
            ['The page will not start', 'Check that your camera and microphone are connected and not used by another app, allow access in the browser and press Retry. If the browser cannot record audio, open the link in Google Chrome.'],
            ['A question does not play aloud', 'The question is shown as text. Read it and answer as normal.'],
            ['The page could not hear your answer', 'It tells you after you answer. Record the answer again.'],
            ['Transcription fails', 'Check your connection and record the answer again.'],
            ['Your connection drops', 'A lost connection is recorded as a flag, and it can have an ordinary cause. Reconnect, and record the answer again if it did not go through.'],
            ['You switch tabs or windows by accident', 'You see a warning and the event is recorded. Go back to the interview, because the third time ends it and submits your answers so far.'],
            ['You leave fullscreen', 'A banner appears. Press Return to fullscreen.'],
            ['The link says it has expired, is not open yet or is already used', 'Read the message for the time or reason. A link works for one interview, so ask the employer for a new invite if yours expired or was used.'],
            ['The page says the interview is held on another platform', 'Use the meeting link in your email instead.'],
            ['Time runs out', 'Your answers so far are submitted automatically.'],
            ['You need an adjustment, or have a concern about the camera', 'Tell the employer before you start. The employer decides which adjustments are possible. Our own work is on the [accessibility](/accessibility) page.'],
          ],
          'Common problems and what to do',
        ),
        p('If a page on Hirely.ai itself does not work, tell us through [the support form](/contact?topic=support). For anything about your application, contact the employer.'),
      ],
    },
    {
      id: 'coding-assessment',
      title: 'Coding assessment tips',
      blocks: [
        p('Some employers send a coding assessment, either as its own link or as a tab inside the interview. You write code in an editor in your browser, and your code runs in a separate sandbox service.'),
        ul([
          'Read the task and the sample test cases first. Each sample shows an input and the expected output.',
          'Choose your language from the list. Each language has a starter template, and Reset returns the editor to it.',
          'Use Run code to run your program on the first sample case and see its output, errors and compile messages.',
          'Use Run tests when you are ready. It runs your code against all the test cases, shows the visible results, and tells you how many hidden tests passed.',
          'Running the tests submits your solution, and the editor then locks. Check your code before you press it.',
          'Your work is saved automatically about every 8 seconds while you type.',
          'Type your own solution. Pasting and dropping text are blocked and recorded, and the typing is analysed alongside the code.',
          'Do not write code that only returns the sample outputs, because hidden tests check other cases.',
        ]),
        p('After the tests run you see a score. The employer sees more detail than you do and decides what it means.'),
      ],
    },
    {
      id: 'your-data-and-rights',
      title: 'Your data and rights',
      blocks: [
        p("The employer decides why and how your data is used. Hirely.ai processes it on the employer's behalf."),
        p('The [Candidate Privacy Notice](/candidate-privacy) explains what is collected at each stage, how AI is used and who can see your data.'),
        ul([
          '**Retention.** The employer chooses how long candidate records and resumes are kept. If it sets a period, the period is at least 30 days, and if it sets none, records are kept until they are deleted.',
          '**Erasure.** You can ask the employer to erase your data, by your candidate record or by the email address you used. Erasure removes your personal details and keeps only a minimal record of ids, status and dates, unless the employer also confirms erasure of employment records. Your resume, files and matching data are deleted with you.',
          '**Other rights.** Depending on where you live, you may be able to see, correct or export your data, object to how it is used, withdraw consent or ask for a person to review a result. Ask the employer first, because it is the controller of your data.',
          '**If you cannot reach the employer.** Use [our privacy form](/contact?topic=privacy). Tell us the employer, the job and the email address you applied with, and we pass your request to the employer, who decides it.',
          '**Email.** Email about your application never carries scores or report content.',
          '**Accessibility.** If you need an adjustment, ask the employer. Read our own statement on the [accessibility](/accessibility) page.',
        ]),
      ],
    },
  ],
  faqs: [
    {
      q: 'Does Hirely.ai keep a video of me?',
      a: 'No. If you turn on camera monitoring, your video is analysed in your browser and never uploaded or stored. Only your spoken answers are recorded, as audio, so they can be turned into text.',
    },
    {
      q: 'Who decides whether I get the job?',
      a: 'The employer. Hirely.ai is the tool, and a person at the employer reads the report and decides. The platform does not reject candidates automatically, so contact the employer about the outcome.',
    },
    {
      q: 'Will I see my score?',
      a: 'Interview scores and reports go to the recruiter, and email about your application never carries them. In a coding assessment, the page shows your test results and a score after the tests run.',
    },
    {
      q: 'Can I decline camera monitoring?',
      a: 'Yes. Before the interview starts, you choose between enabling camera-based monitoring and continuing without it, and the interview goes ahead either way. If you have a concern, tell the employer before you start.',
    },
    {
      q: 'What happens if I switch tabs?',
      a: 'You get a warning, and the event is recorded and shared with the recruiter. The third time, the interview ends and your answers so far are submitted, and a person decides what happens next.',
    },
    {
      q: 'Can I retake the interview?',
      a: 'A link works for one interview. If something went wrong on your side or ours, ask the employer, because only the employer can send you a new invite.',
    },
    {
      q: 'What questions will I be asked?',
      a: 'They are generated from your resume and the role, so they differ from candidate to candidate. The AI may add a follow-up question after an answer.',
    },
    {
      q: 'Is there a time limit?',
      a: 'Yes. A countdown timer shows the time left for the whole interview, and each answer can run for up to 3 minutes. When the timer ends, your answers so far are submitted.',
    },
  ],
}
