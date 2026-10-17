import { p, table, ul, type LegalDoc } from '../../../components/site/blockModel'

export const COOKIES: LegalDoc = {
  slug: 'cookies',
  title: 'Cookie Policy',
  description: 'The cookies and browser storage Hirely.ai uses. Only what is needed to work: no advertising, no analytics and no third-party trackers.',
  intro: 'Hirely.ai stores only what it needs to keep you signed in and remember settings you chose. It uses no advertising, no analytics and no third-party trackers.',
  related: ['/privacy', '/candidate-privacy', '/subprocessors'],
  sections: [
    {
      id: 'what-this-covers',
      title: 'What this policy covers',
      blocks: [
        p('This policy covers cookies and similar browser storage, such as local storage and session storage, used by the Hirely.ai website and platform. A cookie is a small file a site asks your browser to keep. Browser storage works in a similar way but is not sent to the server with every request.'),
      ],
    },
    {
      id: 'our-approach',
      title: 'Our approach',
      blocks: [
        p('We store only what is needed to provide a feature you asked for: staying signed in, remembering a setting you chose, or completing a single sign-on attempt.'),
        ul([
          'No advertising cookies.',
          'No analytics.',
          'No third-party trackers.',
        ]),
        p('Because we use nothing beyond this, there is nothing to accept or decline, and no cookie banner is shown.'),
      ],
    },
    {
      id: 'what-we-store',
      title: 'What we store',
      blocks: [
        table(
          ['Name', 'Type', 'Purpose', 'Duration'],
          [
            ['`hr-bot-auth`', 'Local storage, needed to sign in', 'Keeps you signed in. Holds your session token and basic profile.', 'Stays until you sign out or clear your browser storage. The session token stops working when your session expires.'],
            ['`hr-bot-upload`', 'Local storage, needed for bulk upload', 'Keeps the progress of a bulk resume upload, so the status is still shown if you refresh the page.', 'Stays until you dismiss the upload status or clear your browser storage.'],
            ['`hr-bot.interview-setup:*`', 'Local storage, preference', 'Remembers your last-used choices when you set up an interview for a candidate: the meeting platform, duration and label. The part after the colon identifies your account.', 'Stays until you clear your browser storage.'],
            ['`hr_oidc_binding`', 'Cookie, needed for single sign-on (httpOnly, SameSite=Lax, Secure on HTTPS)', "Ties a single sign-on attempt through a company's own identity provider to the browser that started it.", 'Short-lived. Removed when the sign-in completes or expires.'],
            ['Demo session flags', 'Session storage, demo mode only', 'Hold demo changes and a sign-in notice while you try the demo.', 'Until you close the browser tab or window.'],
          ],
          'Cookies and browser storage used by Hirely.ai',
        ),
        p('None of these items is shared with advertisers or analytics services.'),
      ],
    },
    {
      id: 'candidate-pages',
      title: 'Candidate-facing pages',
      blocks: [
        p('The interview, coding assessment, offer and careers pages do not require you to sign in. They do not set cookies and do not write to local or session storage. What you submit, such as your application, answers, code or acceptance, is sent to our servers and not kept in your browser.'),
        p('The interview page asks your browser for permission to use your microphone and camera. That is a browser permission, not a cookie, and you control it in your browser settings. Face analysis runs in your browser, and Hirely.ai does not record or store video.'),
        p('These pages can show the employer\'s own Terms and Privacy links. Those belong to the employer. For how candidate data is handled, read the [Candidate Privacy Notice](/candidate-privacy).'),
      ],
    },
    {
      id: 'controlling-storage',
      title: 'How to control or delete it',
      blocks: [
        p('You can view and delete cookies and site data in your browser settings, and most browsers let you block them. Signing out removes your session from the app.'),
        p('Clearing browser storage signs you out and removes saved preferences. Blocking the single sign-on cookie stops sign-in through a company identity provider from completing.'),
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        p('If we ever add storage that is not needed to provide a feature, such as analytics or advertising, we will update this policy and ask for your consent before it is set. The date at the top of the page shows when this policy last changed.'),
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        p('For how we handle personal data more generally, read our [Privacy Policy](/privacy). For questions about this policy, use [our contact form](/contact?topic=privacy).'),
      ],
    },
  ],
}
