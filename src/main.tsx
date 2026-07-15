import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './auth.css'
import './navigation.css'
import './palette.css'
import './tab-motion.css'
import './profile.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
