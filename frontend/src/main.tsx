import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim()

if (measurementId) {
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
  document.head.appendChild(script)

  window.dataLayer = window.dataLayer || []

  function gtag(...args: unknown[]) {
    window.dataLayer?.push(args)
  }

  gtag('js', new Date())
  gtag('config', measurementId)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
