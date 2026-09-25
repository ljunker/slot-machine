import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PublicProgram from './PublicProgram'
import PublicSessionPage from './PublicSessionPage'
import './styles.css'

const isPublicPage = window.location.pathname.startsWith('/programm/')
const publicMatch = window.location.pathname.match(/^\/programm\/([1-9]\d*)\/?$/)
const sessionMatch = window.location.pathname.match(/^\/programm\/([1-9]\d*)\/sessions\/([1-9]\d*)\/?$/)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {sessionMatch ? <PublicSessionPage eventId={Number(sessionMatch[1])} sessionId={Number(sessionMatch[2])} /> :
      isPublicPage ? <PublicProgram eventId={publicMatch ? Number(publicMatch[1]) : null} /> : <App />}
  </React.StrictMode>,
)
