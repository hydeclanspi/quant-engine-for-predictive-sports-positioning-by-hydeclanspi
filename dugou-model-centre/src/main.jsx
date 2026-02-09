import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { bootstrapCloudSnapshotOnLoad } from './lib/localData'
import './index.css'

const renderApp = () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}

const bootstrapBeforeRender = async () => {
  const timeout = new Promise((resolve) => {
    window.setTimeout(resolve, 2500)
  })
  try {
    await Promise.race([bootstrapCloudSnapshotOnLoad(), timeout])
  } catch {
    // Fall back to local snapshot when cloud bootstrap fails.
  }
}

bootstrapBeforeRender().finally(renderApp)
