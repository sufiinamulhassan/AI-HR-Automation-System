import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { siteApi } from '../../lib/api'
import { SITE } from '../../lib/site'
import ContactPage from './ContactPage'
import { expectHeadingOrder, expectMeta, expectNoEmDash, expectValidInternalLinks } from './siteTestKit'

const contact = vi.spyOn(siteApi, 'contact')

function open(path = '/contact') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to="/contact?topic=sales">Sales link</Link>
      <Routes>
        <Route path="/contact" element={<ContactPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const field = (name: RegExp | string) => screen.getByLabelText(name)

async function fillGood(u: ReturnType<typeof userEvent.setup>) {
  await u.type(field('Name'), '  Sara   Khan ')
  await u.type(field('Email address'), ' sara@example.com ')
  await u.type(field(/Company/), 'Globex')
  await u.type(field('Message'), '  We would like to see the platform with our team.  ')
  await u.click(field(/I agree that Hirely.ai/))
}

beforeEach(() => {
  contact.mockReset()
  contact.mockResolvedValue({ data: { status: 'received', reference: '9A8B7C6D' } } as never)
})

afterEach(() => {
  SITE.contactEmail = ''
  SITE.address = ''
})

describe('ContactPage: form', () => {
  it('has labelled fields and starts on a neutral topic', () => {
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Talk to us' })).toBeInTheDocument()
    ;['Name', 'Email address', 'Message'].forEach(label => expect(field(label)).toBeInTheDocument())
    expect(field(/Company/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'What is this about?' })).toHaveValue('other')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
  })

  it('offers every topic', () => {
    open()
    const options = within(screen.getByRole('combobox', { name: 'What is this about?' })).getAllByRole('option')
    expect(options.map(o => o.getAttribute('value'))).toEqual(['sales', 'support', 'privacy', 'security', 'other'])
  })

  it('preselects the topic named in the address and explains it', () => {
    open('/contact?topic=privacy')
    expect(screen.getByRole('combobox', { name: 'What is this about?' })).toHaveValue('privacy')
    expect(screen.getByText(/We pass candidate requests on to the employer/)).toBeInTheDocument()
  })

  it('ignores a topic it does not know', () => {
    open('/contact?topic=nonsense')
    expect(screen.getByRole('combobox', { name: 'What is this about?' })).toHaveValue('other')
  })

  it('follows a new topic in the address while the page is open', async () => {
    const u = userEvent.setup()
    open()
    await u.click(screen.getByRole('link', { name: 'Sales link' }))
    expect(screen.getByRole('combobox', { name: 'What is this about?' })).toHaveValue('sales')
  })

  it('counts the characters in the message', async () => {
    const u = userEvent.setup()
    open()
    expect(screen.getByText('0/4000')).toBeInTheDocument()
    await u.type(field('Message'), 'hello')
    expect(screen.getByText('5/4000')).toBeInTheDocument()
  })
})

describe('ContactPage: validation', () => {
  it('names every problem, focuses the first one and sends nothing', async () => {
    const u = userEvent.setup()
    open()
    await u.click(screen.getByRole('button', { name: 'Send message' }))

    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText(/Write at least 10 characters/)).toBeInTheDocument()
    expect(screen.getByText('Please agree that we may use your details to reply.')).toBeInTheDocument()
    expect(field('Name')).toHaveFocus()
    expect(field('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(contact).not.toHaveBeenCalled()
  })

  it('checks a field when you leave it and clears the error once it is fixed', async () => {
    const u = userEvent.setup()
    open()
    await u.type(field('Email address'), 'not-an-email')
    await u.tab()
    const error = screen.getByText('Enter a valid email address.')
    expect(field('Email address')).toHaveAttribute('aria-describedby', error.id)

    await u.clear(field('Email address'))
    await u.type(field('Email address'), 'sara@example.com')
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument()
    expect(field('Email address')).toHaveAttribute('aria-invalid', 'false')
  })

  it('warns when the message is over the limit', () => {
    open()
    fireEvent.change(field('Message'), { target: { value: 'm'.repeat(4001) } })
    expect(screen.getByText('4001/4000')).toHaveClass('is-over')
  })
})

describe('ContactPage: sending', () => {
  it('sends tidy values and then confirms with a reference', async () => {
    const u = userEvent.setup()
    open('/contact?topic=sales')
    await fillGood(u)
    await u.click(screen.getByRole('button', { name: 'Send message' }))

    expect(contact).toHaveBeenCalledWith({
      name: 'Sara Khan',
      email: 'sara@example.com',
      company: 'Globex',
      topic: 'sales',
      message: 'We would like to see the platform with our team.',
      consent: true,
      website: '',
    })
    const heading = await screen.findByRole('heading', { name: 'Message received' })
    expect(heading).toHaveFocus()
    expect(screen.getByText(/We will reply to sara@example.com/)).toBeInTheDocument()
    expect(screen.getByText('9A8B7C6D')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Contact form' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute('href', '/')
  })

  it('passes on whatever a bot typed into the hidden field', async () => {
    const u = userEvent.setup()
    const { container } = open()
    await fillGood(u)
    fireEvent.change(container.querySelector('input[name="website"]') as HTMLInputElement, { target: { value: 'https://spam.example' } })
    await u.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(contact).toHaveBeenCalled())
    expect(contact.mock.calls[0][0].website).toBe('https://spam.example')
  })

  it('hides the spam trap from people and from screen readers', () => {
    const { container } = open()
    const trap = container.querySelector('.xv-hp') as HTMLElement
    expect(trap).toHaveAttribute('aria-hidden', 'true')
    expect(trap.querySelector('input')).toHaveAttribute('tabindex', '-1')
  })

  it('shows the server wording when the message is refused, and lets you try again', async () => {
    const u = userEvent.setup()
    contact.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Choose what your message is about.' } } })
    open()
    await fillGood(u)
    await u.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose what your message is about.')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()

    await u.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('heading', { name: 'Message received' })).toBeInTheDocument()
  })

  it('explains a rate limit and a dropped connection', async () => {
    const u = userEvent.setup()
    contact.mockRejectedValueOnce({ response: { status: 429, data: {} } })
    open()
    await fillGood(u)
    await u.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/several messages/i)

    contact.mockRejectedValueOnce(new Error('offline'))
    await u.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not reach the server/i))
  })

  it('sends once even if the button is pressed twice', async () => {
    const u = userEvent.setup()
    let release: (value: unknown) => void = () => {}
    contact.mockReturnValueOnce(new Promise(resolve => { release = resolve }) as never)
    open()
    await fillGood(u)
    const send = screen.getByRole('button', { name: 'Send message' })
    await u.click(send)
    expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled()
    await u.click(screen.getByRole('button', { name: 'Sending' }))
    expect(contact).toHaveBeenCalledTimes(1)
    release({ data: { status: 'received', reference: 'ABCD1234' } })
    expect(await screen.findByRole('heading', { name: 'Message received' })).toBeInTheDocument()
  })
})

describe('ContactPage: around the form', () => {
  it('explains what happens next and points to related pages', () => {
    open()
    const side = screen.getByRole('complementary', { name: 'Other ways to reach us' })
    expect(within(side).getByRole('heading', { name: 'What happens next' })).toBeInTheDocument()
    expect(within(side).getByRole('link', { name: 'Open roles on the platform' })).toHaveAttribute('href', '/careers')
    expect(within(side).getByRole('link', { name: 'Candidate privacy notice' })).toHaveAttribute('href', '/candidate-privacy')
  })

  it('links the privacy policy from the consent line', () => {
    open()
    expect(within(field(/I agree that Hirely.ai/).closest('label') as HTMLElement).getByRole('link', { name: 'Privacy Policy' }))
      .toHaveAttribute('href', '/privacy')
  })

  it('shows an email address or postal address only when configured', () => {
    const { unmount } = open()
    expect(screen.queryByRole('heading', { name: 'Details' })).not.toBeInTheDocument()
    unmount()

    SITE.contactEmail = 'hello@example.com'
    SITE.address = '1 Example Street'
    open()
    const side = screen.getByRole('complementary', { name: 'Other ways to reach us' })
    expect(within(side).getByRole('link', { name: 'hello@example.com' })).toHaveAttribute('href', 'mailto:hello@example.com')
    expect(within(side).getByText('1 Example Street')).toBeInTheDocument()
  })

  it('follows the site rules', () => {
    const { container } = open()
    expectMeta('Contact')
    expectHeadingOrder(container)
    expectValidInternalLinks(container)
    expectNoEmDash(container)
  })
})
