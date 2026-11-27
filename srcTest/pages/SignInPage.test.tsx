// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SignInPage from '../../src/pages/SignInPage'

const mocks = vi.hoisted(() => ({
  completeEmailLink: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  completeEmailLink: mocks.completeEmailLink,
}))

beforeEach(() => {
  mocks.completeEmailLink.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/" element={<div>Home page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SignInPage', () => {
  it('finishes the sign in and opens the home page', async () => {
    mocks.completeEmailLink.mockResolvedValue({ status: 'signed-in' })

    renderPage()

    expect(await screen.findByText('Home page')).toBeTruthy()
    expect(mocks.completeEmailLink).toHaveBeenCalledWith(window.location.href)
  })

  it('asks for the email when this device has none saved', async () => {
    mocks.completeEmailLink
      .mockResolvedValueOnce({ status: 'email-needed' })
      .mockResolvedValueOnce({ status: 'signed-in' })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Finish signing in' })).toBeTruthy()
    await userEvent.type(screen.getByLabelText('Email address'), 'phil@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Finish signing in' }))

    expect(await screen.findByText('Home page')).toBeTruthy()
    expect(mocks.completeEmailLink).toHaveBeenLastCalledWith(
      window.location.href,
      'phil@example.com',
    )
  })

  it('explains an address that is not a sign-in link', async () => {
    mocks.completeEmailLink.mockResolvedValue({ status: 'invalid' })

    renderPage()

    expect(await screen.findByText("This isn't a sign-in link.")).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }))

    expect(await screen.findByText('Home page')).toBeTruthy()
  })
})
