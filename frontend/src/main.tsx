import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PublicProgram from './PublicProgram'
import './styles.css'

const isPublicPage = window.location.pathname.startsWith('/programm/')
const publicMatch = window.location.pathname.match(/^\/programm\/([1-9]\d*)\/?$/)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPublicPage ? <PublicProgram eventId={publicMatch ? Number(publicMatch[1]) : null} /> : <App />}
  </React.StrictMode>,
)
