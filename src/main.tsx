import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './auth.css'
import './navigation.css'
import './palette.css'
import './tab-motion.css'
import './profile.css'

if ('serviceWorker' in navigator) window.addEventListener('load', () => { void navigator.serviceWorker.register('/service-worker.js') })

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
