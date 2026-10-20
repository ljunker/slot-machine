import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthGate, InvitationPage, PasswordResetPage } from './Auth'
import PublicProgram from './PublicProgram'
import PublicSessionPage from './PublicSessionPage'
import './styles.css'

const isPublicPage = window.location.pathname.startsWith('/programm/')
const publicMatch = window.location.pathname.match(/^\/programm\/([1-9]\d*)\/?$/)
const sessionMatch = window.location.pathname.match(/^\/programm\/([1-9]\d*)\/sessions\/([1-9]\d*)\/?$/)
const invitationMatch = window.location.pathname.match(/^\/einladung\/([^/]+)\/?$/)
const resetMatch = window.location.pathname.match(/^\/passwort-zuruecksetzen(?:\/([^/]+))?\/?$/)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {sessionMatch ? <PublicSessionPage eventId={Number(sessionMatch[1])} sessionId={Number(sessionMatch[2])} /> :
      isPublicPage ? <PublicProgram eventId={publicMatch ? Number(publicMatch[1]) : null} /> :
        invitationMatch ? <InvitationPage token={invitationMatch[1]} /> :
          resetMatch ? <PasswordResetPage token={resetMatch[1] ?? null} /> : <AuthGate />}
  </React.StrictMode>,
)
