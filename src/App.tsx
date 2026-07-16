import { type ChangeEvent, type CSSProperties, FormEvent, type MouseEvent as ReactMouseEvent, type TouchEvent, useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { flushSync } from 'react-dom'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CallIcon,
  CheckIcon,
  CameraIcon,
  GroupIcon,
  LockIcon,
  Menu2Icon,
  MessageIcon,
  MicrophoneIcon,
  MoneyIcon,
  NotificationIcon,
  PlusIcon,
  ProfileCircleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  Shield2Icon,
  StarIcon,
  TrashIcon,
} from '@astraicons/react/linear'
import { type Session } from '@supabase/supabase-js'
import { hasSupabase, supabase } from './supabase'

type Profile = {
  id: string
  username: string
  display_name: string
  avatar_color: string | null
  avatar_path: string | null
  is_admin: boolean
  badge: 'helper' | 'idea' | null
  is_banned: boolean
  last_seen_at: string | null
}

type Chat = Profile & {
  conversation_id: string
  last_body: string | null
  last_created_at: string | null
  last_sender_id: string | null
  is_pinned: boolean
  is_muted: boolean
  is_blocked: boolean
  block_hidden: boolean
  blocked_by_other: boolean
  hidden_presence_since: string | null
}

type ChatRow = Chat

type Message = {
  id: string
  sender_id: string
  body: string
  created_at: string
  read_at: string | null
  image_path: string | null
  image_name: string | null
  audio_path: string | null
  audio_name: string | null
  audio_duration: number | null
  reply_to_id?: string | null
  reply_body?: string | null
  reply_sender_id?: string | null
  forwarded_from_id?: string | null
  edited_at?: string | null
}

type AdminAudit = {
  id: string
  action: 'badge' | 'ban' | 'osi'
  target_user_id: string
  username: string
  display_name: string
  previous_state: Record<string, unknown>
  next_state: Record<string, unknown>
  created_at: string
  undone_at: string | null
}

type CallSignal = {
  call_id: string
  conversation_id: string
  sender_id: string
  recipient_id: string
  kind: 'offer' | 'answer' | 'ice' | 'hangup' | 'decline'
  payload: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
  created_at?: string
}

type MessageMenu = {
  message: Message
  x: number
  y: number
  mode: 'actions' | 'delete'
}

type ChatMenu = {
  chat: Chat
  x: number
  y: number
  mode: 'actions' | 'block'
}

type Story = {
  story_id: string
  user_id: string
  username: string
  display_name: string
  avatar_color: string | null
  avatar_path: string | null
  media_path: string
  media_type: 'image' | 'video' | 'gif'
  overlay_text: string | null
  description: string | null
  aspect_ratio: string
  created_at: string
  expires_at: string
}

type StoryViewer = {
  user_id: string
  username: string
  display_name: string
  avatar_color: string | null
  avatar_path: string | null
  reaction: 'heart' | null
  viewed_at: string
}

const defaultAvatarColor = '#dfe6f0'
const lockTimestampKey = (userId: string) => `osirium:last-hidden-at:${userId}`
const appLockStorageKey = (userId: string) => `osirium:local-app-lock:${userId}`
const appLockedStorageKey = (userId: string) => `osirium:local-app-locked:${userId}`
const lockPasswordIterations = 210_000
const favoritesConversationId = 'local:favorites'
const favoritesStorageKey = (userId: string) => `osirium:favorites:${userId}`

type PrivacyProfile = {
  username: string | null
  display_name: string | null
  bio: string | null
  avatar_path: string | null
  public_id: number | null
  osi_balance: number | null
}

type LocalAppLock = {
  passwordHash: string
  passwordSalt: string
  timeoutSeconds: number
}

function readLocalAppLock(userId: string): LocalAppLock | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(appLockStorageKey(userId)) || 'null') as Partial<LocalAppLock> | null
    if (!value || typeof value.passwordHash !== 'string' || typeof value.passwordSalt !== 'string' || typeof value.timeoutSeconds !== 'number') return null
    return value as LocalAppLock
  } catch {
    return null
  }
}

function initials(value: string) {
  return value.replace(/^@/, '').slice(0, 2).toUpperCase() || 'О'
}

function formatTime(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatPresence(value: string | null, forceOffline = false) {
  if (!value) return 'недавно'
  if (!forceOffline && Date.now() - new Date(value).getTime() < 15_000) return 'в сети'
  return 'недавно'
  if (!value) return 'давненько не заходил'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value || '').getTime()) / 60_000))
  if (!forceOffline && minutes < 2) return 'в сети'
  if (forceOffline && minutes < 60) return 'был в сети 1 д. назад'
  if (minutes < 60) return `был в сети ${minutes} мин. назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `был в сети ${hours} ч. назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `был в сети ${days} дн. назад`
  if (days < 14) return 'был в сети неделю назад'
  return 'давненько не заходил'
}

async function compressImage(file: File, aspectRatio = 0) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  const image = await createImageBitmap(file)
  const sourceRatio = image.width / image.height
  let sourceWidth = image.width
  let sourceHeight = image.height
  let sourceX = 0
  let sourceY = 0
  if (aspectRatio) {
    if (sourceRatio > aspectRatio) {
      sourceWidth = Math.round(image.height * aspectRatio)
      sourceX = Math.round((image.width - sourceWidth) / 2)
    } else {
      sourceHeight = Math.round(image.width / aspectRatio)
      sourceY = Math.round((image.height - sourceHeight) / 2)
    }
  }
  const longestSide = 1280
  const scale = Math.min(1, longestSide / Math.max(sourceWidth, sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sourceWidth * scale)
  canvas.height = Math.round(sourceHeight * scale)
  canvas.getContext('2d')?.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.74))
  image.close()
  return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: 'image/webp' }) : file
}

function formatPreview(body: string | null) {
  return body || 'Нет сообщений — напишите первым'
}

function bytesToBase64(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function hashLockPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: base64ToBytes(salt), iterations: lockPasswordIterations, hash: 'SHA-256' }, key, 256)
  return bytesToBase64(hash)
}

function createLockSalt() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)).buffer)
}

function profileAvatarUrl(path: string | null) {
  return path && supabase ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : null
}

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read file'))
    reader.onerror = () => reject(reader.error || new Error('Unable to read file'))
    reader.readAsDataURL(blob)
  })
}

async function resolveWithin<T>(promise: PromiseLike<T>, timeoutMs = 7000): Promise<T> {
  let timer = 0
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
      }),
    ])
  } finally {
    window.clearTimeout(timer)
  }
}

function formatPublicId(value: number | null) {
  return value === null ? '' : String(value).padStart(12, '0')
}

function RoleBadge({ isAdmin, badge }: { isAdmin?: boolean; badge?: Profile['badge'] }) {
  if (isAdmin) return <span className="admin-badge" aria-label="Администратор"><CheckIcon /></span>
  if (!badge) return null
  return <span className={`admin-badge badge-${badge}`} aria-label={badge === 'helper' ? 'Хелпер' : 'Идейник'}><CheckIcon /></span>
}

function AdminBadge({ isAdmin }: { isAdmin?: boolean }) {
  return <RoleBadge isAdmin={isAdmin} />
}

function messageDayKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function messageDateLabel(value: string) {
  const messageDate = new Date(value)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(messageDate)
  day.setHours(0, 0, 0, 0)
  const difference = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (difference === 0) return 'Сегодня'
  if (difference === 1) return 'Вчера'
  if (difference === 2) return 'Позавчера'
  return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: messageDate.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(messageDate)
}

function vapidKeyBytes(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const source = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(source, (character) => character.charCodeAt(0))
}

function VoicePlayer({ src, duration }: { src: string; duration: number | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const update = () => {
      setCurrentTime(audio.currentTime)
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
    }
    const ended = () => setPlaying(false)
    audio.addEventListener('timeupdate', update)
    audio.addEventListener('ended', ended)
    return () => { audio.removeEventListener('timeupdate', update); audio.removeEventListener('ended', ended) }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) { void audio.play(); setPlaying(true) } else { audio.pause(); setPlaying(false) }
  }
  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio) return
    const value = Number(event.target.value)
    audio.currentTime = value * (audio.duration || duration || 1)
    setProgress(value)
  }
  const shownDuration = Math.max(0, Math.round(audioRef.current?.duration || duration || 0))
  return <div className="voice-player"><audio ref={audioRef} src={src} preload="metadata" /><button type="button" className="voice-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>{playing ? 'Ⅱ' : '▶'}</button><input className="voice-progress" type="range" min="0" max="1" step="0.01" value={progress} onChange={seek} aria-label="Прогресс голосового" /><span className="voice-time">{Math.round(currentTime)} / {shownDuration}</span></div>
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null)
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null)
  const [favoritesSearch, setFavoritesSearch] = useState('')
  const [chatMenu, setChatMenu] = useState<ChatMenu | null>(null)
  const [draft, setDraft] = useState('')
  const [showWelcome, setShowWelcome] = useState(false)
  const [appBooting, setAppBooting] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [directChatLoading, setDirectChatLoading] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState('Чаты')
  const [selectedProfile, setSelectedProfile] = useState<Chat | null>(null)
  const [selectedProfileBio, setSelectedProfileBio] = useState('')
  const [selectedProfileLoading, setSelectedProfileLoading] = useState(false)
  const [contacts, setContacts] = useState<Record<string, string>>({})
  const [contactLabel, setContactLabel] = useState('')
  const [contactEditorOpen, setContactEditorOpen] = useState(false)
  const [contactSaving, setContactSaving] = useState(false)
  const [contactError, setContactError] = useState('')
  const [authenticated, setAuthenticated] = useState(!hasSupabase)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUsername, setCurrentUsername] = useState('пользователь')
  const [currentPublicId, setCurrentPublicId] = useState<number | null>(null)
  const [currentIsAdmin, setCurrentIsAdmin] = useState(false)
  const [currentOsiBalance, setCurrentOsiBalance] = useState(0)
  const [currentDisplayName, setCurrentDisplayName] = useState('')
  const [profileBio, setProfileBio] = useState('')
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<'Профиль' | 'Оси' | 'Истории' | 'Уведомления' | 'Оформление' | 'Конфиденциальность' | 'Локальный пароль' | 'Опасная зона' | 'Админ-панель'>('Профиль')
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [adminSearch, setAdminSearch] = useState('')
  const [adminResults, setAdminResults] = useState<Profile[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [announcementDraft, setAnnouncementDraft] = useState('')
  const [announcementSaving, setAnnouncementSaving] = useState(false)
  const [announcementError, setAnnouncementError] = useState('')
  const [osiAmount, setOsiAmount] = useState('100')
  const [adminAudit, setAdminAudit] = useState<AdminAudit[]>([])
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [newAccountPassword, setNewAccountPassword] = useState('')
  const [newAccountPasswordRepeat, setNewAccountPasswordRepeat] = useState('')
  const [accountPasswordError, setAccountPasswordError] = useState('')
  const [accountPasswordSaving, setAccountPasswordSaving] = useState(false)
  const [appLockHash, setAppLockHash] = useState<string | null>(null)
  const [appLockSalt, setAppLockSalt] = useState<string | null>(null)
  const [appLockTimeout, setAppLockTimeout] = useState(60)
  const [appLocked, setAppLocked] = useState(false)
  const [lockAttempt, setLockAttempt] = useState('')
  const [lockError, setLockError] = useState('')
  const [newLockPassword, setNewLockPassword] = useState('')
  const [newLockPasswordRepeat, setNewLockPasswordRepeat] = useState('')
  const [currentLockPassword, setCurrentLockPassword] = useState('')
  const [localPasswordAccessGranted, setLocalPasswordAccessGranted] = useState(false)
  const [localPasswordOrigin, setLocalPasswordOrigin] = useState<'Профиль' | 'Настройки'>('Настройки')
  const [privacyError, setPrivacyError] = useState('')
  const [privacySaving, setPrivacySaving] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => 'Notification' in window ? Notification.permission : 'unsupported')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => window.localStorage.getItem('osirium:theme') === 'light' ? 'light' : 'dark')
  const [authLoading, setAuthLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const [sending, setSending] = useState(false)
  const [sendAnimating, setSendAnimating] = useState(false)
  const [, setPresenceTick] = useState(0)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [voiceRecording, setVoiceRecording] = useState(false)
  const [voiceLocked, setVoiceLocked] = useState(false)
  const [voicePaused, setVoicePaused] = useState(false)
  const [voiceSeconds, setVoiceSeconds] = useState(0)
  const [stories, setStories] = useState<Story[]>([])
  const [storyUrls, setStoryUrls] = useState<Record<string, string>>({})
  const [openedStory, setOpenedStory] = useState<Story | null>(null)
  const [storyMediaLoaded, setStoryMediaLoaded] = useState(false)
  const [storyReply, setStoryReply] = useState('')
  const [storyReplying, setStoryReplying] = useState(false)
  const [storyReaction, setStoryReaction] = useState<'heart' | null>(null)
  const [messageReactions, setMessageReactions] = useState<Record<string, boolean>>({})
  const [storyViewers, setStoryViewers] = useState<StoryViewer[]>([])
  const [storyViewersOpen, setStoryViewersOpen] = useState(false)
  const [storyViewerError, setStoryViewerError] = useState('')
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null)
  const [avatarCropUrl, setAvatarCropUrl] = useState<string | null>(null)
  const [avatarCropZoom, setAvatarCropZoom] = useState(1)
  const [avatarCropOffset, setAvatarCropOffset] = useState({ x: 0, y: 0 })
  const [storyFile, setStoryFile] = useState<File | null>(null)
  const [storyPreviewUrl, setStoryPreviewUrl] = useState<string | null>(null)
  const [storyOverlayText, setStoryOverlayText] = useState('')
  const [storyDescription, setStoryDescription] = useState('')
  const [storyAspectRatio, setStoryAspectRatio] = useState('9:16')
  const [storyUploading, setStoryUploading] = useState(false)
  const [storyError, setStoryError] = useState('')
  const [messageImageUrls, setMessageImageUrls] = useState<Record<string, string>>({})
  const [loadedMessageImages, setLoadedMessageImages] = useState<Record<string, boolean>>({})
  const [openedImage, setOpenedImage] = useState<{ src: string; name: string } | null>(null)
  const [imageScale, setImageScale] = useState(1)
  const [callTarget, setCallTarget] = useState<Chat | null>(null)
  const [callStatus, setCallStatus] = useState<'calling' | 'incoming' | 'connected' | 'microphone-error' | 'signal-error'>('calling')
  const callStreamRef = useRef<MediaStream | null>(null)
  const callPeerRef = useRef<RTCPeerConnection | null>(null)
  const callIdRef = useRef<string | null>(null)
  const queuedIceCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const pendingCallIceCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({})
  const incomingOfferRef = useRef<CallSignal | null>(null)
  const chatsRef = useRef<Chat[]>([])
  const callSignalHandlerRef = useRef<(signal: CallSignal) => void>(() => undefined)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStartedAtRef = useRef(0)
  const voiceHoldTimerRef = useRef<number | null>(null)
  const voiceHoldActiveRef = useRef(false)
  const voiceSendOnStopRef = useRef(false)
  const storyInputRef = useRef<HTMLInputElement>(null)
  const composerInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const avatarCropDragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null)
  const imagePinchRef = useRef<{ distance: number; scale: number } | null>(null)
  const bootStartedAtRef = useRef(Date.now())

  chatsRef.current = chats

  useEffect(() => {
    const fallback = window.setTimeout(() => setAppBooting(false), 8000)
    return () => window.clearTimeout(fallback)
  }, [])
  const messageHoldTimerRef = useRef<number | null>(null)
  const chatHoldTimerRef = useRef<number | null>(null)
  const scrollToLatestMessageRef = useRef(false)

  const favoriteChat: Chat | null = currentUserId ? { id: currentUserId, username: 'избранное', display_name: 'Избранное', avatar_color: '#376eb3', avatar_path: null, is_admin: false, badge: null, is_banned: false, last_seen_at: new Date().toISOString(), conversation_id: favoritesConversationId, last_body: 'Локальное облако заметок', last_created_at: null, last_sender_id: currentUserId, is_pinned: true, is_muted: false, is_blocked: false, block_hidden: false, blocked_by_other: false, hidden_presence_since: null } : null
  const selectedChat = selectedConversation === favoritesConversationId ? favoriteChat : chats.find((item) => item.conversation_id === selectedConversation) ?? null
  const displayedMessages = selectedConversation === favoritesConversationId && favoritesSearch.trim()
    ? messages.filter((message) => message.body.toLowerCase().includes(favoritesSearch.trim().toLowerCase()))
    : messages
  const navIndex = ['Чаты', 'Профиль', 'Настройки'].indexOf(activeNav)
  function selectNavLabel(label: string) {
    setSelectedProfile(null)
    setActiveNav(label)
    if (label === 'Настройки') setMobileSettingsOpen(false)
  }
  const query = search.trim().toLowerCase()
  const isUserSearch = query.length >= 3
  const displayNameFor = (profile: Pick<Profile, 'id' | 'username' | 'display_name'>) => contacts[profile.id] || profile.display_name || `@${profile.username}`
  const visibleChats = useMemo(
    () => chats
      .filter((item) => `${item.username} ${item.display_name} ${contacts[item.id] || ''}`.toLowerCase().includes(query))
      .sort((left, right) => Number(right.is_pinned) - Number(left.is_pinned) || new Date(right.last_created_at || 0).getTime() - new Date(left.last_created_at || 0).getTime()),
    [chats, contacts, query],
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('osirium:theme', theme)
  }, [theme])

  useEffect(() => {
    const timer = window.setInterval(() => setPresenceTick((value) => value + 1), 5000)
    return () => window.clearInterval(timer)
  }, [])

  function switchTheme(nextTheme: 'dark' | 'light', event: ReactMouseEvent<HTMLButtonElement>) {
    if (nextTheme === theme) return
    const button = event.currentTarget.getBoundingClientRect()
    document.documentElement.style.setProperty('--theme-origin-x', `${button.left + button.width / 2}px`)
    document.documentElement.style.setProperty('--theme-origin-y', `${button.top + button.height / 2}px`)
    const applyTheme = () => {
      document.documentElement.dataset.theme = nextTheme
      window.localStorage.setItem('osirium:theme', nextTheme)
      flushSync(() => setTheme(nextTheme))
    }
    const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => unknown }
    if (transitionDocument.startViewTransition) transitionDocument.startViewTransition(applyTheme)
    else applyTheme()
  }
  const storiesByAge = useMemo(
    () => [...stories].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()),
    [stories],
  )
  const storyOwners = useMemo(
    () => Array.from(new Map(storiesByAge.map((story) => [story.user_id, story])).values()),
    [storiesByAge],
  )
  const openedStorySequence = useMemo(
    () => openedStory ? storiesByAge.filter((story) => story.user_id === openedStory.user_id) : [],
    [openedStory, storiesByAge],
  )
  const openedStoryIndex = openedStory ? openedStorySequence.findIndex((story) => story.story_id === openedStory.story_id) : -1
  const previousStory = openedStoryIndex > 0 ? openedStorySequence[openedStoryIndex - 1] : null
  const nextStory = openedStoryIndex >= 0 && openedStoryIndex < openedStorySequence.length - 1 ? openedStorySequence[openedStoryIndex + 1] : null

  const loadChats = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('list_direct_conversations')
    if (error) {
      setChatError('Не удалось загрузить диалоги. Попробуйте обновить страницу.')
      return
    }
    setChats((data ?? []).map((row: Record<string, unknown>) => ({ ...row, id: (row as { id?: string; other_user_id?: string }).id ?? (row as { other_user_id?: string }).other_user_id })) as ChatRow[])
  }, [])

  const syncPushSubscription = useCallback(async (permission = notificationPermission) => {
    if (permission !== 'granted' || !supabase || !currentUserId || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BOlx31pxPjpvr4hw1alTWnv6aLO13qkvQme3AQIk6RpaOLLMdoqJul8A7NND7YRablzhOB9f1NOozbeZr5osCZA'
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey) })
      const json = subscription.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: subscription.endpoint,
        user_id: currentUserId,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      }, { onConflict: 'endpoint' })
      if (error) throw error
    } catch {
      setChatError('Не удалось подключить это устройство к уведомлениям. Откройте Osirium с иконки на экране Домой и попробуйте ещё раз.')
    }
  }, [currentUserId, notificationPermission])

  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    if (permission === 'granted') void syncPushSubscription('granted')
  }

  useEffect(() => {
    if (authenticated && notificationPermission === 'granted') void syncPushSubscription()
  }, [authenticated, currentUserId, notificationPermission, syncPushSubscription])

  function notifyRecipient(message: Message) {
    if (!supabase || selectedConversation === favoritesConversationId) return
    void supabase.functions.invoke('send-push', { body: { message_id: message.id } })
  }

  function notifyIncomingCall(callId: string) {
    if (!supabase) return
    void supabase.functions.invoke('send-push', { body: { call_id: callId } })
  }

  function notifyAnnouncementPublished(announcementId: string) {
    if (!supabase) return
    void supabase.functions.invoke('send-push', { body: { announcement_id: announcementId } })
  }

  function notifyStoryPublished(storyId: string) {
    if (!supabase) return
    void supabase.functions.invoke('send-push', { body: { story_id: storyId, event: 'story_published' } })
  }

  function notifyStoryReaction(storyId: string) {
    if (!supabase) return
    void supabase.functions.invoke('send-push', { body: { story_id: storyId, event: 'story_reaction' } })
  }

  function notifyMessageReaction(messageId: string) {
    if (!supabase) return
    void supabase.functions.invoke('send-push', { body: { message_id: messageId, event: 'message_reaction' } })
  }

  async function toggleMessageReaction(message: Message) {
    const next = !messageReactions[message.id]
    if (selectedConversation === favoritesConversationId) {
      setMessageReactions((current) => ({ ...current, [message.id]: next }))
      return
    }
    if (!supabase || !currentUserId) return
    const { data, error } = await supabase.rpc('toggle_message_reaction', { p_message_id: message.id, p_reaction: 'heart' })
    if (error) {
      setChatError(`Не удалось поставить реакцию: ${error.message}`)
      return
    }
    const active = Boolean(data)
    setMessageReactions((current) => ({ ...current, [message.id]: active }))
    if (active && message.sender_id !== currentUserId) notifyMessageReaction(message.id)
  }

  const loadStories = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('list_contact_stories')
    if (error) return
    const records = (data ?? []) as Story[]
    setStories(records)
    if (!records.length) {
      setStoryUrls({})
      return
    }
    const { data: signed } = await supabase.storage.from('stories').createSignedUrls(records.map((story) => story.media_path), 3600)
    setStoryUrls(Object.fromEntries(records.map((story) => [story.story_id, signed?.find((item) => item.path === story.media_path)?.signedUrl]).filter((item): item is [string, string] => Boolean(item[1]))))
  }, [])

  const loadContacts = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('contacts').select('contact_id, label')
    if (!error) setContacts(Object.fromEntries((data ?? []).map((contact) => [contact.contact_id as string, contact.label as string])))
  }, [])

  const loadImageUrls = useCallback(async (records: Message[]) => {
    if (!supabase) return
    const imageRecords = records.filter((record) => record.image_path || record.audio_path)
    if (!imageRecords.length) return
    const { data } = await supabase.storage.from('chat-media').createSignedUrls(imageRecords.map((record) => (record.image_path || record.audio_path) as string), 3600)
    const urlByPath = new Map((data ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]))
    const nextUrls = Object.fromEntries(imageRecords.flatMap((record) => {
      const url = urlByPath.get((record.image_path || record.audio_path) as string)
      return url ? [[record.id, url]] : []
    }))
    if (Object.keys(nextUrls).length) setMessageImageUrls((current) => ({ ...current, ...nextUrls }))
  }, [])

  const loadPinnedMessage = useCallback(async (conversationId: string) => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('get_pinned_message', { p_conversation_id: conversationId })
    if (!error) setPinnedMessage((data?.[0] as Message | undefined) ?? null)
  }, [])

  const loadMessages = useCallback(async (conversationId: string) => {
    if (conversationId === favoritesConversationId) {
      try {
        const localMessages = JSON.parse(window.localStorage.getItem(favoritesStorageKey(currentUserId || 'guest')) || '[]') as Message[]
        setMessages(localMessages)
        setMessageImageUrls(Object.fromEntries(localMessages.flatMap((message) => {
          const source = message.image_path || message.audio_path
          return source?.startsWith('data:') ? [[message.id, source]] : []
        })))
      } catch { setMessages([]) }
      setPinnedMessage(null)
      return
    }
    if (!supabase) return
    await supabase.rpc('mark_direct_messages_read', { p_conversation_id: conversationId })
    const { data, error } = await supabase.rpc('list_messages', { p_conversation_id: conversationId })
    if (error) {
      setChatError('Не удалось загрузить сообщения.')
      return
    }
    const records = (data ?? []) as Message[]
    scrollToLatestMessageRef.current = true
    setMessages(records)
    void loadImageUrls(records)
    void loadPinnedMessage(conversationId)
  }, [loadImageUrls, loadPinnedMessage])

  useEffect(() => {
    if (!sending && selectedConversation && !appLocked) {
      window.requestAnimationFrame(() => composerInputRef.current?.focus())
    }
  }, [sending, selectedConversation, appLocked])

  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>('.composer .send')
    button?.classList.toggle('is-sending', sendAnimating)
  }, [sendAnimating])

  useEffect(() => {
    const messagesRoot = document.querySelector('.messages')
    if (!messagesRoot) return
    const handleDoubleClick = (event: Event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-message-id]')
      const message = target ? messages.find((item) => item.id === target.dataset.messageId) : null
      if (message) void toggleMessageReaction(message)
    }
    messagesRoot.addEventListener('dblclick', handleDoubleClick)
    return () => messagesRoot.removeEventListener('dblclick', handleDoubleClick)
  })

  useEffect(() => {
    document.querySelectorAll<HTMLElement>('.messages [data-message-id]').forEach((element) => {
      element.classList.toggle('message-reacted', Boolean(messageReactions[element.dataset.messageId || '']))
    })
  }, [messageReactions, messages])

  useEffect(() => {
    if (!supabase) {
      setAppBooting(false)
      return
    }
    const client = supabase
    let active = true
    const finishBoot = () => {
      if (active) setAppBooting(false)
    }

    const hydrate = async (session: Session | null) => {
      if (!active) return
      const user = session?.user
      setAuthenticated(Boolean(user))
      setCurrentUserId(user?.id ?? null)
      setCurrentUsername(String(user?.user_metadata?.username ?? 'пользователь'))
      if (!user) {
        setCurrentPublicId(null)
        setCurrentIsAdmin(false)
        setCurrentOsiBalance(0)
        setAppLocked(false)
        setAppLockHash(null)
        setAppLockSalt(null)
        setShowWelcome(true)
        finishBoot()
        return
      }

      const { data: privacyProfile } = await resolveWithin(
        client.from('profiles').select('username, display_name, bio, avatar_path, public_id, osi_balance').eq('id', user.id).maybeSingle(),
      ).catch(() => ({ data: null }))
      if (!active) return

      const profile = privacyProfile as PrivacyProfile | null
      const lock = readLocalAppLock(user.id)
      const timeout = lock?.timeoutSeconds ?? 60
      setCurrentUsername(profile?.username || String(user.user_metadata?.username ?? 'пользователь'))
      setCurrentPublicId(profile?.public_id ?? null)
      setCurrentIsAdmin(profile?.public_id === 1)
      setCurrentOsiBalance(profile?.osi_balance ?? 0)
      setCurrentDisplayName(profile?.display_name || profile?.username || String(user.user_metadata?.username ?? 'пользователь'))
      setProfileBio(profile?.bio || '')
      setCurrentAvatarUrl(profile?.avatar_path ? client.storage.from('avatars').getPublicUrl(profile.avatar_path).data.publicUrl : null)
      setAppLockHash(lock?.passwordHash ?? null)
      setAppLockSalt(lock?.passwordSalt ?? null)
      setAppLockTimeout(timeout)
      if (lock?.passwordHash && lock.passwordSalt && window.localStorage.getItem(appLockedStorageKey(user.id)) === '1') {
        setAppLocked(true)
      }
      await Promise.allSettled([
        resolveWithin(loadChats()),
        resolveWithin(loadStories()),
        resolveWithin(loadContacts()),
      ])
      finishBoot()
    }

    void resolveWithin(client.auth.getSession()).then(({ data }) => hydrate(data.session)).catch(() => {
      setShowWelcome(true)
      finishBoot()
    })
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => { void hydrate(session).catch(finishBoot) })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadChats, loadContacts, loadStories])

  useEffect(() => {
    if (!supabase || !authenticated || !currentUserId) return
    const client = supabase
    let lastTouchedAt = 0
    const touchPresence = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastTouchedAt < 10_000) return
      lastTouchedAt = Date.now()
      void client.rpc('touch_presence')
    }
    touchPresence()
    const interval = window.setInterval(touchPresence, 15_000)
    document.addEventListener('visibilitychange', touchPresence)
    window.addEventListener('focus', touchPresence)
    window.addEventListener('pointerdown', touchPresence)
    window.addEventListener('keydown', touchPresence)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', touchPresence)
      window.removeEventListener('focus', touchPresence)
      window.removeEventListener('pointerdown', touchPresence)
      window.removeEventListener('keydown', touchPresence)
    }
  }, [authenticated, currentUserId])

  useEffect(() => {
    if (!authenticated) return
    const refreshChats = () => {
      if (document.visibilityState === 'visible') void loadChats()
    }
    const interval = window.setInterval(refreshChats, 15_000)
    document.addEventListener('visibilitychange', refreshChats)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshChats)
    }
  }, [authenticated, loadChats])

  useEffect(() => {
    if (!appLockHash || !appLockSalt || !currentUserId || appLocked) return
    let lastStoredAt = 0
    const recordActivity = () => {
      const now = Date.now()
      if (now - lastStoredAt < 1000) return
      lastStoredAt = now
      window.localStorage.setItem(lockTimestampKey(currentUserId), String(now))
    }
    const checkLock = () => {
      if (document.visibilityState !== 'visible') return false
      const lastActivityAt = Number(window.localStorage.getItem(lockTimestampKey(currentUserId)) || 0)
      if (lastActivityAt && Date.now() - lastActivityAt >= appLockTimeout * 1000) {
        window.localStorage.setItem(appLockedStorageKey(currentUserId), '1')
        setAppLocked(true)
        return true
      }
      return false
    }
    if (!checkLock()) recordActivity()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !checkLock()) recordActivity()
    }
    const onFocus = () => { if (!checkLock()) recordActivity() }
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']
    activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(checkLock, 1000)
    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity))
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  }, [appLockHash, appLockSalt, appLockTimeout, appLocked, currentUserId])

  useEffect(() => {
    if (!appLocked || !currentUserId) return
    const persistLock = () => window.localStorage.setItem(appLockedStorageKey(currentUserId), '1')
    persistLock()
    window.addEventListener('pagehide', persistLock)
    return () => window.removeEventListener('pagehide', persistLock)
  }, [appLocked, currentUserId])

  useEffect(() => {
    if (activeNav === 'Профиль') setSettingsSection('Профиль')
  }, [activeNav])

  useEffect(() => {
    if (activeNav === 'Настройки' && ['Профиль', 'Оси', 'Конфиденциальность', 'Истории'].includes(settingsSection)) setSettingsSection('Уведомления')
  }, [activeNav])

  useEffect(() => {
    if (window.matchMedia('(max-width: 720px)').matches && activeNav === 'Настройки' && settingsSection === 'Конфиденциальность' && localPasswordOrigin === 'Профиль') {
      setActiveNav('Профиль')
      setLocalPasswordOrigin('Настройки')
    }
  }, [activeNav, localPasswordOrigin, settingsSection])

  useEffect(() => {
    if (!supabase || !authenticated || query.length < 3) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    const client = supabase
    setSearchLoading(true)
    const timeout = window.setTimeout(async () => {
      const { data, error } = await client.rpc('search_users', { search_text: query })
      if (!error) setSearchResults((data ?? []) as Profile[])
      else setChatError('Не удалось выполнить поиск пользователей.')
      setSearchLoading(false)
    }, 260)

    return () => window.clearTimeout(timeout)
  }, [authenticated, query])

  useEffect(() => {
    if (!supabase || !selectedConversation || selectedConversation === favoritesConversationId) return
    const client = supabase
    const channel = client
      .channel(`messages-${selectedConversation}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConversation}` }, (payload) => {
        const message = payload.new as Message
        const incomingBlocked = message.sender_id !== currentUserId && selectedChat?.is_blocked
        const container = document.querySelector<HTMLElement>('.messages')
        if (container && container.scrollHeight - container.scrollTop - container.clientHeight < 180) scrollToLatestMessageRef.current = true
        if (!incomingBlocked) setMessages((current) => current.some((item) => item.id === message.id) ? current.map((item) => item.id === message.id ? { ...item, ...message } : item) : [...current, message])
        if (payload.eventType === 'INSERT' && message.sender_id !== currentUserId) setChats((current) => current.map((chat) => chat.id === message.sender_id ? { ...chat, last_seen_at: new Date().toISOString(), hidden_presence_since: null } : chat))
        if (payload.eventType === 'INSERT' && message.sender_id !== currentUserId && !selectedChat?.is_muted && !incomingBlocked) {
          const sound = notificationAudioRef.current
          if (sound) {
            sound.currentTime = 0
            void sound.play().catch(() => undefined)
          }
        }
        if (!incomingBlocked) void loadImageUrls([message])
        void loadChats()
      })
      .subscribe()

    return () => { void client.removeChannel(channel) }
  }, [currentUserId, loadChats, loadImageUrls, selectedChat?.is_blocked, selectedChat?.is_muted, selectedConversation])

  useEffect(() => {
    if (!scrollToLatestMessageRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>('.messages')
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      scrollToLatestMessageRef.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, selectedConversation])

  useEffect(() => () => {
    callStreamRef.current?.getTracks().forEach((track) => track.stop())
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  async function selectChat(chat: Chat) {
    if (chat.conversation_id === selectedConversation) {
      setSelectedConversation(null)
      setSelectedProfile(null)
      setMessages([])
      setPinnedMessage(null)
      setActiveNav('Чаты')
      return
    }
    setSelectedConversation(chat.conversation_id)
    setSelectedProfile(null)
    setActiveNav('Чаты')
    setMessages([])
    setPinnedMessage(null)
    setChatError('')
    await loadMessages(chat.conversation_id)
  }

  async function startDirectChat(profile: Profile) {
    if (!supabase || profile.id === currentUserId) return
    setChatError('')
    setDirectChatLoading(profile.id)
    const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { other_user_id: profile.id })
    setDirectChatLoading(null)
    if (error || !data) {
      setChatError('Не удалось создать диалог. Попробуйте ещё раз.')
      return
    }

    const nextChat: Chat = {
      ...profile,
      conversation_id: data as string,
      last_body: null,
      last_created_at: null,
      last_sender_id: null,
      is_pinned: false,
      is_muted: false,
      is_blocked: false,
      block_hidden: false,
      blocked_by_other: false,
      hidden_presence_since: null,
    }
    setChats((current) => [nextChat, ...current.filter((item) => item.conversation_id !== nextChat.conversation_id)])
    setSearch('')
    await selectChat(nextChat)
  }

  async function openProfile(profile: Chat) {
    setSelectedProfile(profile)
    setSelectedProfileBio('')
    setContactLabel(contacts[profile.id] || profile.display_name || profile.username)
    setContactEditorOpen(false)
    setContactError('')
    setSelectedProfileLoading(true)
    if (!supabase) {
      setSelectedProfileLoading(false)
      return
    }
    const { data, error } = await supabase.rpc('get_public_profile', { p_user_id: profile.id })
    if (!error) setSelectedProfileBio(String(data?.[0]?.bio || ''))
    setSelectedProfileLoading(false)
  }

  async function saveContact(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !currentUserId || !selectedProfile) return
    const label = contactLabel.trim().slice(0, 48) || selectedProfile.display_name || selectedProfile.username
    setContactSaving(true)
    setContactError('')
    const { error } = await supabase.from('contacts').upsert({ owner_id: currentUserId, contact_id: selectedProfile.id, label }, { onConflict: 'owner_id,contact_id' })
    setContactSaving(false)
    if (error) {
      setContactError('Не удалось сохранить контакт.')
      return
    }
    setContacts((current) => ({ ...current, [selectedProfile.id]: label }))
    setContactEditorOpen(false)
  }

  async function deleteContact() {
    if (!supabase || !currentUserId || !selectedProfile) return
    setContactSaving(true)
    setContactError('')
    const { error } = await supabase.from('contacts').delete().eq('owner_id', currentUserId).eq('contact_id', selectedProfile.id)
    setContactSaving(false)
    if (error) {
      setContactError('Не удалось удалить контакт.')
      return
    }
    setContacts((current) => {
      const next = { ...current }
      delete next[selectedProfile.id]
      return next
    })
    setContactLabel(selectedProfile.display_name || selectedProfile.username)
    setContactEditorOpen(false)
  }

  async function publishAnnouncement(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !currentIsAdmin || announcementSaving) return
    const body = announcementDraft.trim()
    if (!body) {
      setAnnouncementError('Напишите текст оповещения.')
      return
    }
    setAnnouncementSaving(true)
    setAnnouncementError('')
    const { data: announcementId, error } = await supabase.rpc('create_admin_announcement', { p_body: body })
    setAnnouncementSaving(false)
    if (error) {
      setAnnouncementError(`Не удалось опубликовать: ${error.message}`)
      return
    }
    setAnnouncementDraft('')
    if (typeof announcementId === 'string') notifyAnnouncementPublished(announcementId)
  }

  async function searchAdminUsers(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !currentIsAdmin) return
    const query = adminSearch.trim().replace(/^@/, '').toLowerCase()
    if (query.length < 3) {
      setAdminError('Введите минимум 3 символа логина.')
      setAdminResults([])
      return
    }
    setAdminLoading(true)
    setAdminError('')
    const { data, error } = await supabase.rpc('search_users', { search_text: query })
    setAdminLoading(false)
    if (error) {
      setAdminError('Не удалось найти пользователя.')
      return
    }
    setAdminResults((data ?? []) as Profile[])
    if (!data?.length) setAdminError('Пользователь не найден.')
  }

  async function assignBadge(profile: Profile, badge: 'helper' | 'idea' | null) {
    if (!supabase || !currentIsAdmin) return
    const { error } = await supabase.rpc('admin_set_badge', { p_user_id: profile.id, p_badge: badge })
    if (error) {
      setAdminError('Не удалось изменить бейдж.')
      return
    }
    setAdminResults((current) => current.map((item) => item.id === profile.id ? { ...item, badge } : item))
    setChats((current) => current.map((item) => item.id === profile.id ? { ...item, badge } : item))
    void loadAdminAudit()
  }

  async function grantOsi(profile: Profile) {
    if (!supabase || !currentIsAdmin) return
    const amount = Number(osiAmount)
    if (!Number.isInteger(amount) || amount <= 0) {
      setAdminError('Укажите положительное целое количество Оси.')
      return
    }
    const { error } = await supabase.rpc('admin_grant_osi', { p_user_id: profile.id, p_amount: amount })
    if (error) setAdminError('Не удалось выдать Оси.')
    else {
      setAdminError('Оси выданы.')
      void loadAdminAudit()
    }
  }

  async function setUserBan(profile: Profile, banned: boolean) {
    if (!supabase || !currentIsAdmin) return
    const { error } = await supabase.rpc('admin_set_ban', { p_user_id: profile.id, p_is_banned: banned, p_reason: banned ? 'Нарушение правил Osirium' : null })
    if (error) {
      setAdminError('Не удалось изменить блокировку.')
      return
    }
    setAdminResults((current) => current.map((item) => item.id === profile.id ? { ...item, is_banned: banned } : item))
    void loadAdminAudit()
  }

  async function loadAdminAudit() {
    if (!supabase || !currentIsAdmin) return
    const { data } = await supabase.rpc('list_admin_audit_log')
    setAdminAudit((data ?? []) as AdminAudit[])
  }

  async function undoAdminAudit(entry: AdminAudit) {
    if (!supabase || entry.undone_at) return
    const { error } = await supabase.rpc('undo_admin_audit_action', { p_log_id: entry.id })
    if (error) {
      setAdminError('Не удалось отменить действие: ' + error.message)
      return
    }
    setAdminAudit((current) => current.map((item) => item.id === entry.id ? { ...item, undone_at: new Date().toISOString() } : item))
    await loadChats()
  }

  useEffect(() => {
    if (activeNav === 'Настройки' && settingsSection === 'Админ-панель') void loadAdminAudit()
  }, [activeNav, currentIsAdmin, settingsSection])

  function clearMessageHold() {
    if (messageHoldTimerRef.current !== null) window.clearTimeout(messageHoldTimerRef.current)
    messageHoldTimerRef.current = null
  }

  useEffect(() => {
    document.querySelectorAll<HTMLAudioElement>('.voice-message audio').forEach((audio) => {
      if (audio.parentElement?.querySelector('.voice-player-dom')) return
      audio.controls = false
      const player = document.createElement('div')
      player.className = 'voice-player-dom'
      const play = document.createElement('button')
      play.type = 'button'
      play.className = 'voice-play'
      play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>'
      const range = document.createElement('input')
      range.type = 'range'
      range.min = '0'
      range.max = '1'
      range.step = '0.01'
      range.value = '0'
      range.className = 'voice-progress'
      const time = document.createElement('span')
      time.className = 'voice-time'
      time.textContent = '0:00'
      play.onclick = () => { if (audio.paused) { void audio.play(); play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z" fill="currentColor"/></svg>' } else { audio.pause(); play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>' } }
      audio.ontimeupdate = () => { range.value = audio.duration ? String(audio.currentTime / audio.duration) : '0'; time.textContent = `${Math.floor(audio.currentTime / 60)}:${String(Math.floor(audio.currentTime % 60)).padStart(2, '0')}` }
      audio.onended = () => { play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>' }
      range.oninput = () => { audio.currentTime = Number(range.value) * (audio.duration || 1) }
      player.append(play, range, time)
      audio.parentElement?.append(player)
    })
  })

  useEffect(() => {
    const pattern = /((?:https?:\/\/|www\.)[^\s<]+)/gi
    document.querySelectorAll<HTMLElement>('.bubble-wrap .bubble').forEach((bubble) => {
      if (bubble.querySelector('.message-link')) return
      const textNode = Array.from(bubble.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      const text = textNode?.textContent
      if (!text || !pattern.test(text)) return
      pattern.lastIndex = 0
      const fragment = document.createDocumentFragment()
      text.split(pattern).forEach((part) => {
        if (!part) return
        if (/(?:https?:\/\/|www\.)/i.test(part)) {
          const link = document.createElement('a')
          link.className = 'message-link'
          link.href = part.startsWith('www.') ? `https://${part}` : part
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.textContent = part
          fragment.append(link)
        } else fragment.append(document.createTextNode(part))
      })
      textNode.replaceWith(fragment)
    })
  })

  function openMessageMenu(message: Message, x: number, y: number) {
    clearMessageHold()
    setMessageMenu({ message, x: Math.min(Math.max(14, x), window.innerWidth - 230), y: Math.min(Math.max(14, y - 24), Math.max(14, window.innerHeight - 310)), mode: 'actions' })
  }

  function startMessageHold(message: Message, x: number, y: number) {
    clearMessageHold()
    messageHoldTimerRef.current = window.setTimeout(() => openMessageMenu(message, x, y), 550)
  }

  function clearChatHold() {
    if (chatHoldTimerRef.current !== null) window.clearTimeout(chatHoldTimerRef.current)
    chatHoldTimerRef.current = null
  }

  function openChatMenu(chat: Chat, x: number, y: number) {
    if (chat.conversation_id === favoritesConversationId) return
    clearChatHold()
    setChatMenu({ chat, x: Math.min(Math.max(14, x), window.innerWidth - 236), y: Math.min(Math.max(14, y), window.innerHeight - 220), mode: 'actions' })
  }

  function startChatHold(chat: Chat, x: number, y: number) {
    if (chat.conversation_id === favoritesConversationId) return
    clearChatHold()
    chatHoldTimerRef.current = window.setTimeout(() => openChatMenu(chat, x, y), 550)
  }

  async function toggleChatPin(chat: Chat) {
    if (!supabase) return
    const { data, error } = await supabase.rpc('toggle_direct_conversation_pin', { p_conversation_id: chat.conversation_id })
    if (error) setChatError('Не удалось изменить закрепление чата.')
    else setChats((current) => current.map((item) => item.conversation_id === chat.conversation_id ? { ...item, is_pinned: Boolean(data) } : item))
    setChatMenu(null)
  }

  async function toggleChatMute(chat: Chat) {
    if (!supabase) return
    const { data, error } = await supabase.rpc('toggle_direct_conversation_mute', { p_conversation_id: chat.conversation_id })
    if (error) setChatError('Не удалось изменить режим без звука.')
    else setChats((current) => current.map((item) => item.conversation_id === chat.conversation_id ? { ...item, is_muted: Boolean(data) } : item))
    setChatMenu(null)
  }

  async function setChatBlock(chat: Chat, hidden: boolean, blocked = true) {
    if (!supabase) return
    const { error } = await supabase.rpc('set_direct_conversation_block', { p_conversation_id: chat.conversation_id, p_hidden: hidden, p_blocked: blocked })
    if (error) {
      setChatError('Не удалось изменить блокировку.')
      return
    }
    setChats((current) => current.map((item) => item.conversation_id === chat.conversation_id ? { ...item, is_blocked: blocked, block_hidden: blocked && hidden, hidden_presence_since: blocked && hidden ? new Date().toISOString() : null } : item))
    setChatMenu(null)
    if (selectedConversation === chat.conversation_id && blocked) setMessages((current) => current.filter((message) => message.sender_id === currentUserId))
  }

  async function toggleMessagePin(message: Message) {
    if (!supabase || !selectedConversation) return
    const { error } = await supabase.rpc('toggle_direct_message_pin', { p_message_id: message.id })
    if (error) {
      setChatError('Не удалось закрепить сообщение.')
      return
    }
    setMessageMenu(null)
    await loadPinnedMessage(selectedConversation)
  }

  async function deleteMessage(message: Message, forEveryone: boolean) {
    if (!supabase || !selectedConversation) return
    const { error } = await supabase.rpc('delete_direct_message', { p_message_id: message.id, p_for_everyone: forEveryone })
    if (error) {
      setChatError(forEveryone ? 'Не удалось удалить сообщение у всех.' : 'Не удалось удалить сообщение.')
      return
    }
    setMessageMenu(null)
    await loadMessages(selectedConversation)
    await loadChats()
  }

  async function copyMessage(message: Message) {
    const text = message.image_path ? 'Фото' : message.audio_path ? 'Голосовое сообщение' : message.body
    try {
      await navigator.clipboard.writeText(text)
      setChatError('Сообщение скопировано.')
    } catch {
      setChatError('Не удалось скопировать сообщение.')
    }
    setMessageMenu(null)
  }

  async function downloadVoiceMessage(message: Message) {
    const url = messageImageUrls[message.id]
    if (!url) return
    const sender = message.sender_id === currentUserId ? currentDisplayName || currentUsername : selectedChat?.display_name || selectedChat?.username || 'Osirium'
    const extension = message.audio_name?.split('.').pop()?.toLowerCase() || 'webm'
    const filename = `${sender.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'Osirium'} - голосовое.${extension}`
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error('download failed')
      const blobUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch {
      setChatError('Не удалось скачать голосовое.')
    }
    setMessageMenu(null)
  }

  function beginReply(message: Message) {
    setEditingMessage(null)
    setReplyingTo(message)
    setMessageMenu(null)
    window.requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  function beginEdit(message: Message) {
    if (message.sender_id !== currentUserId || message.image_path || message.audio_path) return
    setReplyingTo(null)
    setEditingMessage(message)
    setDraft(message.body)
    setMessageMenu(null)
    window.requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  async function forwardMessage(chat: Chat) {
    const message = forwardingMessage
    if (!message || !currentUserId) return
    const body = message.image_path ? 'Переслано: Фото' : message.audio_path ? 'Переслано: Голосовое сообщение' : message.body
    if (chat.conversation_id === favoritesConversationId) {
      const localMessage: Message = { id: crypto.randomUUID(), sender_id: currentUserId, body: `Переслано: ${body}`, created_at: new Date().toISOString(), read_at: new Date().toISOString(), image_path: null, image_name: null, audio_path: null, audio_name: null, audio_duration: null, forwarded_from_id: message.id }
      const stored = JSON.parse(window.localStorage.getItem(favoritesStorageKey(currentUserId)) || '[]') as Message[]
      window.localStorage.setItem(favoritesStorageKey(currentUserId), JSON.stringify([...stored, localMessage]))
    } else if (supabase) {
      let error: { message?: string } | null = null
      if ((message.image_path || message.audio_path) && messageImageUrls[message.id]) {
        try {
          const source = await fetch(messageImageUrls[message.id])
          const blob = await source.blob()
          const isImage = Boolean(message.image_path)
          const name = isImage ? message.image_name || 'photo' : message.audio_name || 'voice'
          const path = `${chat.conversation_id}/${currentUserId}/${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
          const upload = await supabase.storage.from('chat-media').upload(path, blob, { cacheControl: '31536000', contentType: blob.type || (isImage ? 'image/jpeg' : 'audio/webm') })
          if (upload.error) throw upload.error
          const result = isImage
            ? await supabase.rpc('send_image_message', { p_conversation_id: chat.conversation_id, p_image_path: path, p_image_name: name })
            : await supabase.rpc('send_voice_message', { p_conversation_id: chat.conversation_id, p_audio_path: path, p_audio_name: name, p_audio_duration: message.audio_duration || 1 })
          error = result.error
        } catch (reason) {
          error = reason instanceof Error ? reason : { message: 'upload failed' }
        }
      } else {
        const result = await supabase.rpc('send_direct_message', { p_conversation_id: chat.conversation_id, p_body: body, p_reply_to_id: null, p_forwarded_from_id: message.id })
        error = result.error
      }
      if (error) setChatError('Не удалось переслать сообщение.')
      else await loadChats()
    }
    setForwardingMessage(null)
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selectedConversation || sending || !currentUserId) return
    setSendAnimating(true)
    window.setTimeout(() => setSendAnimating(false), 420)
    setSendAnimating(true)
    window.setTimeout(() => setSendAnimating(false), 420)
    if (editingMessage && selectedConversation !== favoritesConversationId && supabase) {
      setSending(true)
      const { error } = await supabase.rpc('edit_direct_message', { p_message_id: editingMessage.id, p_body: body })
      setSending(false)
      if (error) {
        setChatError('Не удалось изменить сообщение.')
        return
      }
      setMessages((current) => current.map((message) => message.id === editingMessage.id ? { ...message, body, edited_at: new Date().toISOString() } : message))
      setDraft('')
      setEditingMessage(null)
      window.requestAnimationFrame(() => composerInputRef.current?.focus())
      return
    }
    if (selectedConversation === favoritesConversationId) {
      const message: Message = { id: crypto.randomUUID(), sender_id: currentUserId, body, created_at: new Date().toISOString(), read_at: new Date().toISOString(), image_path: null, image_name: null, audio_path: null, audio_name: null, audio_duration: null }
      scrollToLatestMessageRef.current = true
      setMessages((current) => {
        const next = [...current, message]
        window.localStorage.setItem(favoritesStorageKey(currentUserId), JSON.stringify(next))
        return next
      })
      setDraft('')
      window.requestAnimationFrame(() => composerInputRef.current?.focus())
      return
    }
    if (!supabase) return

    setSending(true)
    setChatError('')
    const { data, error } = await supabase.rpc('send_direct_message', {
      p_conversation_id: selectedConversation,
      p_body: body,
      p_reply_to_id: replyingTo?.id ?? null,
      p_forwarded_from_id: null,
    })
    setSending(false)

    if (error || !data?.[0]) {
      setChatError(error?.message ? `Не удалось отправить сообщение: ${error.message}` : 'Не удалось отправить сообщение.')
      return
    }

    const message = data[0] as Message
    scrollToLatestMessageRef.current = true
    setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
    setChats((current) => current.map((item) => item.conversation_id === selectedConversation
      ? { ...item, last_body: message.body, last_created_at: message.created_at, last_sender_id: message.sender_id }
      : item))
    setDraft('')
    setReplyingTo(null)
    notifyRecipient(message)
    window.requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setChatError('Можно отправлять только изображения.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setChatError('Максимальный размер изображения — 8 МБ.')
      return
    }
    void uploadPhoto(file)
  }

  async function uploadPhoto(file: File) {
    if (!selectedConversation || !currentUserId || photoUploading) return
    setPhotoUploading(true)
    setChatError('')
    const uploadFile = await compressImage(file)
    if (selectedConversation === favoritesConversationId) {
      try {
        const source = await blobAsDataUrl(uploadFile)
        const message: Message = { id: crypto.randomUUID(), sender_id: currentUserId, body: '', created_at: new Date().toISOString(), read_at: new Date().toISOString(), image_path: source, image_name: file.name, audio_path: null, audio_name: null, audio_duration: null }
        setMessages((current) => {
          const next = [...current, message]
          window.localStorage.setItem(favoritesStorageKey(currentUserId), JSON.stringify(next))
          return next
        })
        setMessageImageUrls((current) => ({ ...current, [message.id]: source }))
        setLoadedMessageImages((current) => ({ ...current, [message.id]: true }))
      } catch {
        setChatError('Не удалось сохранить фото на этом устройстве.')
      }
      setPhotoUploading(false)
      return
    }
    if (!supabase) {
      setPhotoUploading(false)
      return
    }
    const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'image'
    const path = `${selectedConversation}/${currentUserId}/${crypto.randomUUID()}-${safeName}`
    const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, uploadFile, {
      cacheControl: '31536000',
      contentType: uploadFile.type,
      upsert: false,
    })
    if (uploadError) {
      setPhotoUploading(false)
      setChatError(`Не удалось загрузить фото: ${uploadError.message}`)
      return
    }

    const { data, error } = await supabase.rpc('send_image_message', {
      p_conversation_id: selectedConversation,
      p_image_path: path,
      p_image_name: file.name,
    })
    setPhotoUploading(false)
    if (error || !data?.[0]) {
      await supabase.storage.from('chat-media').remove([path])
      setChatError('Не удалось отправить фото.')
      return
    }

    const message = data[0] as Message
    setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
    void loadImageUrls([message])
    setChats((current) => current.map((item) => item.conversation_id === selectedConversation
      ? { ...item, last_body: 'Фото', last_created_at: message.created_at, last_sender_id: message.sender_id }
      : item))
    notifyRecipient(message)
  }

  function handleStorySelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const isSupported = file.type.startsWith('image/') || file.type.startsWith('video/')
    if (!isSupported) {
      setStoryError('Выберите фото, GIF или видео.')
      return
    }
    if (file.type.startsWith('video/') && file.size > 20 * 1024 * 1024) {
      setStoryError('Видео для истории должно быть не больше 20 МБ.')
      return
    }
    if (file.type === 'image/gif' && file.size > 10 * 1024 * 1024) {
      setStoryError('GIF для истории должен быть не больше 10 МБ.')
      return
    }
    if (storyPreviewUrl) URL.revokeObjectURL(storyPreviewUrl)
    setStoryFile(file)
    setStoryPreviewUrl(URL.createObjectURL(file))
    setStoryError('')
  }

  async function publishStory(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !currentUserId || !storyFile || storyUploading) return
    setStoryUploading(true)
    setStoryError('')
    const ratioMap: Record<string, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 }
    const uploadFile = storyFile.type.startsWith('image/') && storyFile.type !== 'image/gif'
      ? await compressImage(storyFile, ratioMap[storyAspectRatio])
      : storyFile
    const mediaType: Story['media_type'] = uploadFile.type === 'image/gif' ? 'gif' : uploadFile.type.startsWith('video/') ? 'video' : 'image'
    const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'story'
    const path = `${currentUserId}/${crypto.randomUUID()}-${safeName}`
    const { error: uploadError } = await supabase.storage.from('stories').upload(path, uploadFile, { cacheControl: '86400', contentType: uploadFile.type, upsert: false })
    if (uploadError) {
      setStoryUploading(false)
      setStoryError(`Не удалось загрузить историю: ${uploadError.message}`)
      return
    }
    const { data: createdStory, error: insertError } = await supabase.from('stories').insert({
      user_id: currentUserId,
      media_path: path,
      media_type: mediaType,
      overlay_text: storyOverlayText.trim() || null,
      description: storyDescription.trim() || null,
      aspect_ratio: storyAspectRatio,
    }).select('id').single()
    setStoryUploading(false)
    if (insertError) {
      await supabase.storage.from('stories').remove([path])
      setStoryError('Не удалось опубликовать историю.')
      return
    }
    if (storyPreviewUrl) URL.revokeObjectURL(storyPreviewUrl)
    setStoryFile(null)
    setStoryPreviewUrl(null)
    setStoryOverlayText('')
    setStoryDescription('')
    if (createdStory?.id) notifyStoryPublished(createdStory.id as string)
    await loadStories()
  }

  async function loadStoryViewers(storyId: string) {
    if (!supabase) return
    const { data, error } = await supabase.rpc('list_story_viewers', { p_story_id: storyId })
    if (error) {
      setStoryViewerError(`Не удалось загрузить зрителей: ${error.message}`)
      return
    }
    setStoryViewers((data ?? []) as StoryViewer[])
  }

  async function openStory(story: Story) {
    setOpenedStory(story)
    setStoryMediaLoaded(false)
    setStoryReply('')
    setStoryReaction(null)
    setStoryViewersOpen(false)
    setStoryViewerError('')
    if (!supabase) return
    if (!storyUrls[story.story_id]) {
      const { data, error } = await supabase.storage.from('stories').createSignedUrl(story.media_path, 3600)
      if (error || !data?.signedUrl) {
        setStoryViewerError('Не удалось открыть историю. Попробуйте ещё раз.')
        return
      }
      setStoryUrls((current) => ({ ...current, [story.story_id]: data.signedUrl }))
    }
    if (story.user_id !== currentUserId) {
      const { error } = await supabase.rpc('record_story_view', { p_story_id: story.story_id, p_reaction: null })
      if (error) setStoryViewerError('Не удалось отметить просмотр истории.')
    } else {
      await loadStoryViewers(story.story_id)
    }
  }

  async function reactToStory() {
    if (!supabase || !openedStory || openedStory.user_id === currentUserId) return
    const nextReaction = storyReaction === 'heart' ? null : 'heart'
    const { error } = await supabase.rpc('record_story_view', { p_story_id: openedStory.story_id, p_reaction: nextReaction, p_clear_reaction: nextReaction === null })
    if (error) {
      setStoryViewerError('Не удалось поставить реакцию.')
      return
    }
    setStoryReaction(nextReaction)
    if (nextReaction === 'heart') notifyStoryReaction(openedStory.story_id)
  }

  async function replyToStory(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !openedStory || openedStory.user_id === currentUserId || storyReplying) return
    const body = storyReply.trim()
    if (!body) return
    setStoryReplying(true)
    setStoryViewerError('')
    const { error } = await supabase.rpc('reply_to_story', { p_story_id: openedStory.story_id, p_body: body })
    setStoryReplying(false)
    if (error) {
      setStoryViewerError('Не удалось отправить ответ на историю.')
      return
    }
    setStoryReply('')
    await loadChats()
  }

  async function uploadVoice(blob: Blob, duration: number) {
    if (!selectedConversation || !currentUserId || !blob.size) return
    const extension = blob.type.includes('ogg') ? 'ogg' : 'webm'
    if (selectedConversation === favoritesConversationId) {
      try {
        const source = await blobAsDataUrl(blob)
        const message: Message = { id: crypto.randomUUID(), sender_id: currentUserId, body: '', created_at: new Date().toISOString(), read_at: new Date().toISOString(), image_path: null, image_name: null, audio_path: source, audio_name: `Голосовое.${extension}`, audio_duration: Math.max(1, duration) }
        setMessages((current) => {
          const next = [...current, message]
          window.localStorage.setItem(favoritesStorageKey(currentUserId), JSON.stringify(next))
          return next
        })
        setMessageImageUrls((current) => ({ ...current, [message.id]: source }))
      } catch {
        setChatError('Не удалось сохранить голосовое на этом устройстве.')
      }
      return
    }
    if (!supabase) return
    const path = `${selectedConversation}/${currentUserId}/${crypto.randomUUID()}-voice.${extension}`
    const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, blob, { cacheControl: '31536000', contentType: blob.type || 'audio/webm', upsert: false })
    if (uploadError) {
      setChatError('Не удалось загрузить голосовое сообщение.')
      return
    }
    const { data, error } = await supabase.rpc('send_voice_message', { p_conversation_id: selectedConversation, p_audio_path: path, p_audio_name: `Голосовое.${extension}`, p_audio_duration: Math.max(1, duration) })
    if (error || !data?.[0]) {
      await supabase.storage.from('chat-media').remove([path])
      setChatError('Не удалось отправить голосовое сообщение.')
      return
    }
    const message = data[0] as Message
    setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
    void loadImageUrls([message])
    setChats((current) => current.map((item) => item.conversation_id === selectedConversation
      ? { ...item, last_body: 'Голосовое сообщение', last_created_at: message.created_at, last_sender_id: message.sender_id }
      : item))
    notifyRecipient(message)
  }

  async function startVoiceRecording() {
    if (voiceRecorderRef.current || voiceRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      voiceChunksRef.current = []
      voiceStreamRef.current = stream
      voiceRecorderRef.current = recorder
      voiceStartedAtRef.current = Date.now()
      recorder.ondataavailable = (event) => { if (event.data.size) voiceChunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const duration = Math.max(1, Math.round((Date.now() - voiceStartedAtRef.current) / 1000))
        const shouldSend = voiceSendOnStopRef.current
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop())
        voiceStreamRef.current = null
        voiceRecorderRef.current = null
        voiceChunksRef.current = []
        voiceSendOnStopRef.current = false
        setVoiceRecording(false)
        setVoiceLocked(false)
        setVoicePaused(false)
        setVoiceSeconds(0)
        if (shouldSend && blob.size) void uploadVoice(blob, duration)
      }
      recorder.start(250)
      setVoiceRecording(true)
      setVoiceSeconds(0)
    } catch {
      setChatError('Не удалось получить доступ к микрофону.')
    }
  }

  function finishVoiceRecording(send: boolean) {
    if (voiceHoldTimerRef.current) window.clearTimeout(voiceHoldTimerRef.current)
    voiceHoldTimerRef.current = null
    voiceSendOnStopRef.current = send
    const recorder = voiceRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  function onVoicePointerDown() {
    if (voiceRecording) return
    voiceHoldActiveRef.current = false
    void startVoiceRecording()
    voiceHoldTimerRef.current = window.setTimeout(() => { voiceHoldActiveRef.current = true }, 250)
  }

  function onVoicePointerUp() {
    if (voiceHoldTimerRef.current) window.clearTimeout(voiceHoldTimerRef.current)
    voiceHoldTimerRef.current = null
    if (voiceHoldActiveRef.current) finishVoiceRecording(true)
    else setVoiceLocked(true)
  }

  function toggleVoicePause() {
    const recorder = voiceRecorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause()
      setVoicePaused(true)
    } else if (recorder.state === 'paused') {
      recorder.resume()
      setVoicePaused(false)
    }
  }

  useEffect(() => {
    if (!voiceRecording || voicePaused) return
    const timer = window.setInterval(() => setVoiceSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [voicePaused, voiceRecording])

  async function savePrivacySettings(event: FormEvent) {
    event.preventDefault()
    if (!currentUserId) return
    setPrivacyError('')
    if (appLockHash && appLockSalt && !localPasswordAccessGranted) {
      setPrivacyError('Сначала введите текущий локальный пароль.')
      return
    }
    if (newLockPassword || newLockPasswordRepeat) {
      if (!/^\d{6}$/.test(newLockPassword)) {
        setPrivacyError('Код-пароль должен состоять из 6 цифр.')
        return
      }
      if (newLockPassword !== newLockPasswordRepeat) {
        setPrivacyError('Пароли не совпадают.')
        return
      }
    } else if (!appLockHash || !appLockSalt) {
      setPrivacyError('Введите новый пароль и повторите его.')
      return
    }

    setPrivacySaving(true)
    const salt = newLockPassword ? createLockSalt() : appLockSalt as string
    const hash = newLockPassword ? await hashLockPassword(newLockPassword, salt) : appLockHash as string
    window.localStorage.setItem(appLockStorageKey(currentUserId), JSON.stringify({
      passwordHash: hash,
      passwordSalt: salt,
      timeoutSeconds: appLockTimeout,
    } satisfies LocalAppLock))
    setPrivacySaving(false)

    setAppLockHash(hash)
    setAppLockSalt(salt)
    setNewLockPassword('')
    setNewLockPasswordRepeat('')
  }

  async function verifyLocalPasswordForSettings(event: FormEvent) {
    event.preventDefault()
    if (!appLockHash || !appLockSalt) {
      setLocalPasswordAccessGranted(true)
      return
    }
    setPrivacyError('')
    if (!/^\d{6}$/.test(currentLockPassword)) {
      setPrivacyError('Введите 6 цифр текущего локального пароля.')
      return
    }
    const hash = await hashLockPassword(currentLockPassword, appLockSalt)
    if (hash !== appLockHash) {
      setPrivacyError('Неверный локальный пароль.')
      return
    }
    setCurrentLockPassword('')
    setLocalPasswordAccessGranted(true)
  }

  function openLocalPasswordSettings() {
    setLocalPasswordOrigin(activeNav === 'Профиль' ? 'Профиль' : 'Настройки')
    setPrivacyError('')
    setCurrentLockPassword('')
    setNewLockPassword('')
    setNewLockPasswordRepeat('')
    setLocalPasswordAccessGranted(!appLockHash)
    setActiveNav('Настройки')
    setSettingsSection('Локальный пароль')
  }

  function leaveLocalPasswordSettings() {
    setPrivacyError('')
    setSettingsSection('Конфиденциальность')
    setActiveNav(localPasswordOrigin)
  }

  function removeLocalPassword() {
    if (!currentUserId) return
    window.localStorage.removeItem(appLockStorageKey(currentUserId))
    window.localStorage.removeItem(appLockedStorageKey(currentUserId))
    setAppLockHash(null)
    setAppLockSalt(null)
    setAppLocked(false)
    setCurrentLockPassword('')
    setNewLockPassword('')
    setNewLockPasswordRepeat('')
    setLocalPasswordAccessGranted(false)
    setPrivacyError('')
    setSettingsSection('Конфиденциальность')
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !currentUserId) return
    const displayName = currentDisplayName.trim()
    if (displayName.length < 2 || displayName.length > 48) {
      setProfileError('Display-ник должен содержать от 2 до 48 символов.')
      return
    }
    if (profileBio.length > 160) {
      setProfileError('Описание не должно быть длиннее 160 символов.')
      return
    }
    setProfileSaving(true)
    setProfileError('')
    const { error } = await supabase.from('profiles').update({ display_name: displayName, bio: profileBio.trim() }).eq('id', currentUserId)
    setProfileSaving(false)
    if (error) setProfileError('Не удалось сохранить профиль. Проверьте SQL-миграцию.')
  }

  async function handleAvatarSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !supabase || !currentUserId) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setProfileError('Аватар: JPG, PNG, WebP или GIF до 8 МБ.')
      return
    }
    if (avatarCropUrl) URL.revokeObjectURL(avatarCropUrl)
    setAvatarCropFile(file)
    setAvatarCropUrl(URL.createObjectURL(file))
    setAvatarCropZoom(1)
    setAvatarCropOffset({ x: 0, y: 0 })
  }

  async function saveAvatarCrop() {
    const file = avatarCropFile
    if (!file || !supabase || !currentUserId) return
    setAvatarUploading(true)
    setProfileError('')
    let uploadFile = file
    if (file.type !== 'image/gif') {
      const image = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 640
      const context = canvas.getContext('2d')
      if (!context) return
      const scale = Math.max(640 / image.width, 640 / image.height) * avatarCropZoom
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(image, (640 - width) / 2 + avatarCropOffset.x * (640 / 260), (640 - height) / 2 + avatarCropOffset.y * (640 / 260), width, height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86))
      image.close()
      if (!blob) { setAvatarUploading(false); setProfileError('Не удалось подготовить аватар.'); return }
      uploadFile = new File([blob], 'avatar.webp', { type: 'image/webp' })
    }
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const finalExtension = uploadFile.type === 'image/webp' ? 'webp' : extension
    const finalPath = `${currentUserId}/avatar-${Date.now()}.${finalExtension}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(finalPath, uploadFile, { upsert: false, contentType: uploadFile.type })
    if (uploadError) {
      setAvatarUploading(false)
      setProfileError(`Не удалось загрузить аватар: ${uploadError.message}`)
      return
    }
    const { error: profileUpdateError } = await supabase.from('profiles').update({ avatar_path: finalPath }).eq('id', currentUserId)
    setAvatarUploading(false)
    if (profileUpdateError) {
      setProfileError('Аватар загрузился, но не сохранился в профиле.')
      return
    }
    setCurrentAvatarUrl(supabase.storage.from('avatars').getPublicUrl(finalPath).data.publicUrl)
    if (avatarCropUrl) URL.revokeObjectURL(avatarCropUrl)
    setAvatarCropFile(null)
    setAvatarCropUrl(null)
  }

  async function changeAccountPassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (newAccountPassword.length < 8) {
      setAccountPasswordError('Пароль аккаунта должен содержать минимум 8 символов.')
      return
    }
    if (newAccountPassword !== newAccountPasswordRepeat) {
      setAccountPasswordError('Пароли не совпадают.')
      return
    }
    setAccountPasswordSaving(true)
    setAccountPasswordError('')
    const { error } = await supabase.auth.updateUser({ password: newAccountPassword })
    setAccountPasswordSaving(false)
    if (error) {
      setAccountPasswordError(error.message)
      return
    }
    setNewAccountPassword('')
    setNewAccountPasswordRepeat('')
  }

  async function unlockApp(event: FormEvent) {
    event.preventDefault()
    if (!appLockHash || !appLockSalt) return
    const hash = await hashLockPassword(lockAttempt, appLockSalt)
    if (hash !== appLockHash) {
      setLockError('Неверный пароль.')
      return
    }
    setLockAttempt('')
    setLockError('')
    setAppLocked(false)
    if (currentUserId) {
      window.localStorage.removeItem(lockTimestampKey(currentUserId))
      window.localStorage.removeItem(appLockedStorageKey(currentUserId))
    }
  }

  async function sendCallSignal(target: Chat, callId: string, kind: CallSignal['kind'], payload: CallSignal['payload'] = {}) {
    if (!supabase || !currentUserId) throw new Error('Call signaling is unavailable')
    const { error } = await supabase.rpc('send_call_signal', {
      p_call_id: callId,
      p_conversation_id: target.conversation_id,
      p_recipient_id: target.id,
      p_kind: kind,
      p_payload: payload,
    })
    if (error) throw error
  }

  function releaseCallResources() {
    const callId = callIdRef.current
    callPeerRef.current?.close()
    callPeerRef.current = null
    callStreamRef.current?.getTracks().forEach((track) => track.stop())
    callStreamRef.current = null
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    if (callId) delete pendingCallIceCandidatesRef.current[callId]
    callIdRef.current = null
    queuedIceCandidatesRef.current = []
    incomingOfferRef.current = null
  }

  function createCallPeer(target: Chat, callId: string) {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    peer.onicecandidate = (event) => {
      if (event.candidate) void sendCallSignal(target, callId, 'ice', { candidate: event.candidate.toJSON() }).catch(() => setCallStatus('signal-error'))
    }
    peer.ontrack = (event) => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = event.streams[0]
      setCallStatus('connected')
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') endCall(false)
    }
    callPeerRef.current = peer
    callIdRef.current = callId
    return peer
  }

  async function resolveCallTarget(signal: CallSignal) {
    const chat = chatsRef.current.find((item) => item.id === signal.sender_id && item.conversation_id === signal.conversation_id)
    if (chat) return chat
    if (!supabase) return null
    const { data } = await supabase.rpc('get_public_profile', { p_user_id: signal.sender_id })
    const profile = data?.[0] as Profile | undefined
    return profile ? { ...profile, conversation_id: signal.conversation_id, last_body: null, last_created_at: null, last_sender_id: null, is_pinned: false, is_muted: false, is_blocked: false, block_hidden: false, blocked_by_other: false, hidden_presence_since: null } : null
  }

  async function handleCallSignal(signal: CallSignal) {
    if (signal.kind === 'offer') {
      if (incomingOfferRef.current?.call_id === signal.call_id) return
      if (callPeerRef.current || incomingOfferRef.current) {
        const target = await resolveCallTarget(signal)
        if (target) void sendCallSignal(target, signal.call_id, 'decline').catch(() => undefined)
        return
      }
      const target = await resolveCallTarget(signal)
      if (!target) return
      incomingOfferRef.current = signal
      setCallTarget(target)
      setCallStatus('incoming')
      return
    }
    if (signal.kind === 'ice' && signal.payload.candidate) {
      const peer = callPeerRef.current
      if (!peer || signal.call_id !== callIdRef.current) {
        const candidates = pendingCallIceCandidatesRef.current[signal.call_id] || []
        if (candidates.length < 32) candidates.push(signal.payload.candidate)
        pendingCallIceCandidatesRef.current[signal.call_id] = candidates
        return
      }
      try {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.payload.candidate)
        else queuedIceCandidatesRef.current.push(signal.payload.candidate)
      } catch {
        setCallStatus('signal-error')
      }
      return
    }
    const peer = callPeerRef.current
    if (!peer || signal.call_id !== callIdRef.current) {
      if (signal.kind === 'hangup' || signal.kind === 'decline') {
        delete pendingCallIceCandidatesRef.current[signal.call_id]
        if (signal.call_id === incomingOfferRef.current?.call_id) endCall(false)
      }
      return
    }
    try {
      if (signal.kind === 'answer' && signal.payload.description) {
        await peer.setRemoteDescription(signal.payload.description)
        for (const candidate of queuedIceCandidatesRef.current.splice(0)) await peer.addIceCandidate(candidate)
      }
      if (signal.kind === 'hangup' || signal.kind === 'decline') endCall(false)
    } catch {
      setCallStatus('signal-error')
    }
  }

  async function startCall() {
    if (!selectedChat || selectedConversation === favoritesConversationId || selectedChat.is_blocked) return
    setCallTarget(selectedChat)
    setCallStatus('calling')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setCallStatus('microphone-error')
      return
    }
    try {
      callStreamRef.current = stream
      const callId = crypto.randomUUID()
      const peer = createCallPeer(selectedChat, callId)
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await sendCallSignal(selectedChat, callId, 'offer', { description: offer })
      notifyIncomingCall(callId)
    } catch {
      releaseCallResources()
      setCallStatus('signal-error')
    }
  }

  async function acceptCall() {
    const signal = incomingOfferRef.current
    const target = callTarget
    if (!signal || !target) return
    setCallStatus('calling')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setCallStatus('microphone-error')
      return
    }
    try {
      callStreamRef.current = stream
      const peer = createCallPeer(target, signal.call_id)
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      await peer.setRemoteDescription(signal.payload.description as RTCSessionDescriptionInit)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      await sendCallSignal(target, signal.call_id, 'answer', { description: answer })
      const pendingCandidates = pendingCallIceCandidatesRef.current[signal.call_id] || []
      delete pendingCallIceCandidatesRef.current[signal.call_id]
      for (const candidate of [...pendingCandidates, ...queuedIceCandidatesRef.current.splice(0)]) await peer.addIceCandidate(candidate)
    } catch {
      releaseCallResources()
      setCallStatus('signal-error')
    }
  }

  function endCall(notify = true) {
    const callId = callIdRef.current || incomingOfferRef.current?.call_id
    if (notify && callTarget && callId) void sendCallSignal(callTarget, callId, 'hangup').catch(() => undefined)
    releaseCallResources()
    setCallTarget(null)
  }

  function declineCall() {
    if (callTarget && incomingOfferRef.current) void sendCallSignal(callTarget, incomingOfferRef.current.call_id, 'decline').catch(() => undefined)
    endCall(false)
  }

  callSignalHandlerRef.current = (signal) => { void handleCallSignal(signal) }

  useEffect(() => {
    if (!supabase || !currentUserId) return
    const client = supabase
    const channel = client.channel(`call-signals-${currentUserId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `recipient_id=eq.${currentUserId}` }, (payload) => { callSignalHandlerRef.current(payload.new as CallSignal) }).subscribe()
    return () => { void client.removeChannel(channel) }
  }, [currentUserId])

  useEffect(() => {
    if (!supabase || !currentUserId) return
    const client = supabase
    let cancelled = false
    const restoreIncomingCall = async () => {
      if (cancelled || document.visibilityState !== 'visible' || callPeerRef.current || incomingOfferRef.current) return
      const { data } = await client
        .from('call_signals')
        .select('call_id, conversation_id, sender_id, recipient_id, kind, payload, created_at')
        .eq('recipient_id', currentUserId)
        .in('kind', ['offer', 'hangup', 'decline'])
        .gte('created_at', new Date(Date.now() - 90_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(30)
      if (cancelled || !data?.length) return
      const endedCalls = new Set((data as CallSignal[]).filter((signal) => signal.kind === 'hangup' || signal.kind === 'decline').map((signal) => signal.call_id))
      const offer = (data as CallSignal[]).find((signal) => signal.kind === 'offer' && !endedCalls.has(signal.call_id))
      if (offer) callSignalHandlerRef.current(offer)
    }
    void restoreIncomingCall()
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void restoreIncomingCall() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [currentUserId])

  function clampImageScale(value: number) {
    return Math.min(5, Math.max(1, value))
  }

  function handleImageWheel(event: WheelEvent<HTMLImageElement>) {
    event.preventDefault()
    setImageScale((current) => clampImageScale(current - event.deltaY * 0.0015))
  }

  function handleImageTouchStart(event: TouchEvent<HTMLImageElement>) {
    if (event.touches.length !== 2) return
    const [first, second] = [event.touches[0], event.touches[1]]
    imagePinchRef.current = { distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY), scale: imageScale }
  }

  function handleImageTouchMove(event: TouchEvent<HTMLImageElement>) {
    if (event.touches.length !== 2 || !imagePinchRef.current) return
    event.preventDefault()
    const [first, second] = [event.touches[0], event.touches[1]]
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
    setImageScale(clampImageScale(imagePinchRef.current.scale * (distance / imagePinchRef.current.distance)))
  }

  function resetImageZoom() {
    imagePinchRef.current = null
    setImageScale(1)
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut()
    setAuthenticated(false)
    setCurrentUserId(null)
    setCurrentPublicId(null)
    setCurrentIsAdmin(false)
    setCurrentOsiBalance(0)
    setChats([])
    setMessages([])
    setSelectedConversation(null)
    setAppLocked(false)
    setAppLockHash(null)
    setAppLockSalt(null)
    if (currentUserId) {
      window.localStorage.removeItem(lockTimestampKey(currentUserId))
      window.localStorage.removeItem(appLockedStorageKey(currentUserId))
    }
    setShowWelcome(true)
    setAuthMode('login')
    setActiveNav('Чаты')
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault()
    const login = username.trim().toLowerCase()
    if (authMode === 'register' && !/^[a-z0-9_]{3,24}$/.test(login)) {
      setAuthError('Логин: от 3 до 24 символов — латиница, цифры или _.')
      return
    }
    if (password.length < 8) {
      setAuthError('Пароль должен состоять минимум из 8 символов.')
      return
    }
    if (!supabase) {
      setAuthError('Сервис пока не подключён.')
      return
    }

    setAuthLoading(true)
    setAuthError('')
    const { data, error } = await supabase.functions.invoke('username-auth', {
      body: { action: authMode, username: login, password },
    })
    setAuthLoading(false)
    if (error || !data?.session) {
      let functionMessage: string | undefined
      const response = error && typeof error === 'object' && 'context' in error ? (error as { context?: Response }).context : undefined
      if (response) {
        const body = await response.clone().json().catch(() => null) as { error?: string } | null
        functionMessage = body?.error
      }
      const message = functionMessage || data?.error || error?.message || 'Не удалось выполнить вход.'
      setAuthError(message === 'Invalid login credentials'
        ? 'Логин или пароль неверны. Если вы здесь впервые, создайте аккаунт.'
        : message)
      return
    }

    const { error: sessionError } = await supabase.auth.setSession(data.session)
    if (sessionError) {
      setAuthError('Не удалось сохранить вход. Попробуйте ещё раз.')
      return
    }
    setAuthenticated(true)
    setShowWelcome(false)
  }

  const renderChatRow = (chat: Chat) => (
    <button key={chat.conversation_id} onClick={() => { void selectChat(chat) }} onContextMenu={(event) => { event.preventDefault(); openChatMenu(chat, event.clientX, event.clientY) }} onTouchStart={(event) => { const touch = event.touches[0]; startChatHold(chat, touch.clientX, touch.clientY) }} onTouchMove={clearChatHold} onTouchEnd={clearChatHold} onTouchCancel={clearChatHold} className={`chat-row ${chat.conversation_id === selectedConversation ? 'selected' : ''} ${chat.is_pinned ? 'pinned' : ''}`}>
      <span className={`avatar ${chat.conversation_id === favoritesConversationId ? 'favorites-avatar' : ''}`} style={{ backgroundColor: chat.avatar_color || defaultAvatarColor }}>{chat.conversation_id === favoritesConversationId ? <StarIcon /> : profileAvatarUrl(chat.avatar_path) ? <img src={profileAvatarUrl(chat.avatar_path) as string} alt="" /> : initials(displayNameFor(chat))}</span>
      <span className="chat-copy">
        <span className="chat-line"><strong>{displayNameFor(chat)}<RoleBadge isAdmin={chat.is_admin} badge={chat.badge} /></strong><time>{formatTime(chat.last_created_at)}</time></span>
        <span className={`chat-line ${formatPresence(chat.hidden_presence_since || chat.last_seen_at, Boolean(chat.hidden_presence_since)) === 'в сети' ? 'presence-online' : ''}`}><small>{formatPresence(chat.hidden_presence_since || chat.last_seen_at, Boolean(chat.hidden_presence_since))} · {formatPreview(chat.last_body)}</small></span>
      </span>
    </button>
  )

  const renderUserResult = (profile: Profile) => (
    <button key={profile.id} onClick={() => { void startDirectChat(profile) }} className="chat-row search-result" disabled={directChatLoading === profile.id}>
      <span className="avatar" style={{ backgroundColor: profile.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(profile.avatar_path) ? <img src={profileAvatarUrl(profile.avatar_path) as string} alt="" /> : initials(displayNameFor(profile))}</span>
      <span className="chat-copy"><span className="chat-line"><strong>{displayNameFor(profile)}<RoleBadge isAdmin={profile.is_admin} badge={profile.badge} /></strong></span><span className="chat-line"><small>@{profile.username} · {directChatLoading === profile.id ? 'Открываем диалог…' : 'Начать диалог'}</small></span></span>
    </button>
  )

  return <main className={`app-shell ${mobileSettingsOpen ? 'mobile-settings-open' : ''} ${activeNav === 'Настройки' ? 'settings-active' : ''}`}>
    <audio ref={notificationAudioRef} src="/message-notification.mp3" preload="auto" />
    {appBooting && <div className="app-loader" role="status" aria-label="Загрузка Osirium"><div className="app-loader-mark" /><p>OSIRIUM</p><span>Загружаем пространство</span><i /></div>}
    <aside className="sidebar">
      <div className="sidebar-head"><h1>{activeNav === 'Чаты' ? 'Сообщения' : activeNav}</h1>{activeNav !== 'Настройки' && <button className="icon-button" aria-label="Новый диалог" onClick={() => { setActiveNav('Чаты'); setSearch('') }}><PlusIcon /></button>}</div>
      {(activeNav === 'Чаты' || activeNav === 'Контакты') && storyOwners.length > 0 && <div className="stories-row" aria-label="Истории">{storyOwners.map((story) => <button type="button" className="story-avatar" key={story.user_id} onClick={() => { void openStory(story) }}><span className="avatar" style={{ backgroundColor: story.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(story.avatar_path) ? <img src={profileAvatarUrl(story.avatar_path) as string} alt="" /> : initials(story.display_name || story.username)}</span><small>{story.display_name || `@${story.username}`}</small></button>)}</div>}
      {(activeNav === 'Чаты' || activeNav === 'Контакты') && <label className="search"><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value.replace(/^@/, ''))} placeholder="Поиск" /></label>}
      {(activeNav === 'Чаты' || activeNav === 'Контакты') && <section className="chat-list">
        {isUserSearch ? <>
          {searchLoading && <p className="list-note">Ищем пользователей…</p>}
          {!searchLoading && searchResults.map(renderUserResult)}
          {!searchLoading && !searchResults.length && <p className="list-note">Пользователи по этому логину не найдены.</p>}
        </> : <>
          {favoriteChat && renderChatRow(favoriteChat)}
          {visibleChats.map(renderChatRow)}
          {!visibleChats.length && <p className="list-note">Введите минимум 3 символа логина, чтобы найти человека.</p>}
        </>}
      </section>}
      {chatError && <p className="sidebar-error" role="alert">{chatError}</p>}
      {activeNav === 'Главная' && <div className="sidebar-note"><span>СЕГОДНЯ</span><strong>Диалогов: {chats.length}</strong><p>Найдите человека по логину и начните приватный разговор.</p></div>}
      {activeNav === 'Настройки' && <section className="settings-menu" onClick={() => setMobileSettingsOpen(true)}><p>АККАУНТ</p><button className={settingsSection === 'Профиль' ? 'active' : ''} onClick={() => setSettingsSection('Профиль')}><ProfileCircleIcon /><strong>Профиль</strong></button><button className={settingsSection === 'Оси' ? 'active' : ''} onClick={() => setSettingsSection('Оси')}><MoneyIcon /><strong>Оси</strong></button><button className={settingsSection === 'Конфиденциальность' ? 'active' : ''} onClick={() => setSettingsSection('Конфиденциальность')}><LockIcon /><strong>Конфиденциальность</strong></button>{currentIsAdmin && <><p>АДМИНИСТРАТОР</p><button className={settingsSection === 'Админ-панель' ? 'active' : ''} onClick={() => setSettingsSection('Админ-панель')}><Shield2Icon /><strong>Админ-панель</strong></button></>}<p>УПРАВЛЕНИЕ</p><button className={`danger ${settingsSection === 'Опасная зона' ? 'active' : ''}`} onClick={() => setSettingsSection('Опасная зона')}><TrashIcon /><strong>Опасная зона</strong></button></section>}
      {activeNav === 'Настройки' && <section className="settings-menu stories-settings-link"><p>ОБЩЕНИЕ</p><button className={settingsSection === 'Истории' ? 'active' : ''} onClick={() => { setSettingsSection('Истории'); setMobileSettingsOpen(true) }}><CameraIcon /><strong>Истории</strong></button></section>}
      {activeNav === 'Настройки' && <section className="settings-menu notifications-settings-link"><p>ПРИЛОЖЕНИЕ</p><button className={settingsSection === 'Уведомления' ? 'active' : ''} onClick={() => { setSettingsSection('Уведомления'); setMobileSettingsOpen(true) }}><NotificationIcon /><strong>Уведомления</strong></button><button className={settingsSection === 'Оформление' ? 'active' : ''} onClick={() => { setSettingsSection('Оформление'); setMobileSettingsOpen(true) }}><SettingsIcon /><strong>Оформление</strong></button></section>}
      {activeNav === 'Профиль' && <section className="settings-menu profile-account-menu" onClick={() => setMobileSettingsOpen(true)}><p>АККАУНТ</p><button className={settingsSection === 'Профиль' ? 'active' : ''} onClick={() => setSettingsSection('Профиль')}><ProfileCircleIcon /><strong>Профиль</strong></button><button className={settingsSection === 'Оси' ? 'active' : ''} onClick={() => setSettingsSection('Оси')}><MoneyIcon /><strong>Оси</strong></button><button className={settingsSection === 'Конфиденциальность' ? 'active' : ''} onClick={() => setSettingsSection('Конфиденциальность')}><LockIcon /><strong>Конфиденциальность</strong></button><button className={settingsSection === 'Истории' ? 'active' : ''} onClick={() => { setSettingsSection('Истории'); setMobileSettingsOpen(true) }}><CameraIcon /><strong>Истории</strong></button></section>}
      <nav className="bottom-nav" aria-label="Основная навигация" style={{ '--active-offset': `calc(${navIndex * 100}% + ${navIndex * 6}px)` } as CSSProperties}>
        {[['Чаты', MessageIcon], ['Профиль', ProfileCircleIcon], ['Настройки', SettingsIcon]].map(([label, Icon]) => <button key={label as string} onClick={() => selectNavLabel(label as string)} className={activeNav === label ? 'active' : ''}><Icon /><span>{label as string}</span></button>)}
      </nav>
    </aside>

    {currentIsAdmin && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && <section className="admin-announcement-float">
      <p className="eyebrow">ОПОВЕЩЕНИЯ</p>
      <h3>От имени Osirium</h3>
      <form className="announcement-form" onSubmit={publishAnnouncement}>
        <textarea value={announcementDraft} onChange={(event) => setAnnouncementDraft(event.target.value.slice(0, 500))} maxLength={500} placeholder="Например: сегодня технические работы..." />
        <div className="announcement-form-footer"><small>{announcementDraft.length}/500</small><button className="privacy-save" disabled={announcementSaving}>{announcementSaving ? 'Публикуем...' : 'Опубликовать'}</button></div>
      </form>
      {announcementError && <p className="privacy-error">{announcementError}</p>}
    </section>}

    {!selectedProfile && activeNav === 'Профиль' && <div className="page-view settings-view profile-hub"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К профилю</button>{settingsSection === 'Профиль' && <><p className="eyebrow">АККАУНТ</p><h2>Профиль<AdminBadge isAdmin={currentIsAdmin} /></h2><p className="profile-public-id">Ваш ID: {formatPublicId(currentPublicId)}</p><form className="profile-form" onSubmit={saveProfile}><input ref={avatarInputRef} className="photo-picker" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarSelection} /><div className="avatar-editor"><button type="button" className="avatar profile-avatar avatar-upload" onClick={() => avatarInputRef.current?.click()}>{currentAvatarUrl ? <img src={currentAvatarUrl} alt="Ваш аватар" /> : initials(currentDisplayName || currentUsername)}</button><div><strong>Аватар</strong><small>{avatarUploading ? 'Загружаем…' : 'Настроить фото'}</small><button type="button" className="text-button" onClick={() => avatarInputRef.current?.click()}>Изменить фото</button></div></div><label>Display-ник<input value={currentDisplayName} onChange={(event) => setCurrentDisplayName(event.target.value.slice(0, 48))} maxLength={48} /></label><label>Описание<textarea value={profileBio} onChange={(event) => setProfileBio(event.target.value.slice(0, 160))} maxLength={160} /></label><button className="privacy-save" disabled={profileSaving}>{profileSaving ? 'Сохраняем…' : 'Сохранить профиль'}</button>{profileError && <p className="privacy-error">{profileError}</p>}</form></>}{settingsSection === 'Оси' && <><p className="eyebrow">ВАЛЮТА</p><h2>Оси</h2><div className="osi-balance-card"><img className="osi-symbol" src="/osi-currency-icon.png" alt="" /><div><small>Ваш баланс</small><strong>{currentOsiBalance.toLocaleString('ru-RU')} Оси</strong></div></div></>}{settingsSection === 'Конфиденциальность' && <section className="privacy-section"><p className="eyebrow">АККАУНТ</p><h2>Конфиденциальность</h2><h3>Локальный пароль</h3><p>Отдельный код только для этого браузера. Он не меняет пароль аккаунта.</p><form className="privacy-form" onSubmit={savePrivacySettings}><label>Код-пароль<input type="password" inputMode="numeric" maxLength={6} value={newLockPassword} onChange={(event) => setNewLockPassword(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 цифр" /></label><label>Повторите код<input type="password" inputMode="numeric" maxLength={6} value={newLockPasswordRepeat} onChange={(event) => setNewLockPasswordRepeat(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Повторите 6 цифр" /></label><label>Запрашивать пароль через<select value={appLockTimeout} onChange={(event) => setAppLockTimeout(Number(event.target.value))}><option value={60}>1 минуту</option><option value={300}>5 минут</option><option value={900}>15 минут</option><option value={1800}>30 минут</option><option value={3600}>1 час</option></select></label><button className="privacy-save" disabled={privacySaving}>{privacySaving ? 'Сохраняем…' : 'Сохранить'}</button>{privacyError && <p className="privacy-error">{privacyError}</p>}</form></section>}</div>}
    {!selectedProfile && activeNav === 'Профиль' && settingsSection === 'Истории' && <div className="page-view settings-view story-settings-page profile-story-page"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К профилю</button><p className="eyebrow">ИСТОРИИ</p><h2>Поделиться историей</h2><p className="settings-description">Истории видят только люди, с которыми у вас уже есть диалог. Через 24 часа они исчезают.</p><form className="story-form" onSubmit={publishStory}><input ref={storyInputRef} className="photo-picker" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" onChange={handleStorySelection} /><button type="button" className="story-add" onClick={() => storyInputRef.current?.click()}>Добавить историю</button><label>Размер<select value={storyAspectRatio} onChange={(event) => setStoryAspectRatio(event.target.value)}><option value="9:16">Вертикальный · 9:16</option><option value="1:1">Квадрат · 1:1</option><option value="16:9">Горизонтальный · 16:9</option></select></label>{storyPreviewUrl && <div className={`story-preview ratio-${storyAspectRatio.replace(':', '-')}`}>{storyFile?.type.startsWith('video/') ? <video src={storyPreviewUrl} controls /> : <img src={storyPreviewUrl} alt="Предпросмотр истории" />}{storyOverlayText && <strong>{storyOverlayText}</strong>}</div>}<label>Надпись на истории<input value={storyOverlayText} onChange={(event) => setStoryOverlayText(event.target.value.slice(0, 80))} maxLength={80} placeholder="Например, доброе утро" /></label><label>Описание<textarea value={storyDescription} onChange={(event) => setStoryDescription(event.target.value.slice(0, 180))} maxLength={180} placeholder="Описание истории" /></label><button className="story-publish" disabled={!storyFile || storyUploading}>{storyUploading ? 'Публикуем…' : 'Опубликовать'}</button>{storyError && <p className="privacy-error">{storyError}</p>}</form></div>}
    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && currentIsAdmin && <div className="page-view settings-view admin-page"><p className="eyebrow">АДМИНИСТРАТОР</p><h2>Бейджи пользователей</h2><p className="settings-description">Выдавайте роли людям. Белый бейдж администратора назначается только системой и виден только у вас.</p><form className="admin-search-form" onSubmit={searchAdminUsers}><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Найти по username" /><button className="privacy-save" disabled={adminLoading}>{adminLoading ? 'Ищем…' : 'Найти'}</button></form>{adminError && <p className="privacy-error">{adminError}</p>}<div className="admin-results">{adminResults.map((profile) => <div className="admin-user" key={profile.id}><span className="avatar" style={{ backgroundColor: profile.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(profile.avatar_path) ? <img src={profileAvatarUrl(profile.avatar_path) as string} alt="" /> : initials(profile.display_name || profile.username)}</span><div><strong>{profile.display_name || `@${profile.username}`}<RoleBadge isAdmin={profile.is_admin} badge={profile.badge} /></strong><small>@{profile.username}</small></div><div className="admin-badge-actions"><button className="badge-helper" onClick={() => { void assignBadge(profile, 'helper') }}>Хелпер</button><button className="badge-idea" onClick={() => { void assignBadge(profile, 'idea') }}>Идейник</button><button className="badge-clear" onClick={() => { void assignBadge(profile, null) }}>Снять</button></div></div>)}</div></div>}
    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Оси' && <div className="page-view settings-view osi-page"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button><p className="eyebrow">ВАЛЮТА</p><h2>Оси</h2><div className="osi-balance-card"><img className="osi-symbol" src="/osi-currency-icon.png" alt="" /><div><small>Ваш баланс</small><strong>{currentOsiBalance.toLocaleString('ru-RU')} Оси</strong></div></div><p className="settings-description">Оси — внутренняя валюта Osirium. Пока её нельзя заработать, но баланс уже сохраняется в профиле.</p></div>}
    {currentIsAdmin && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && <div className="page-view settings-view admin-page admin-page-secondary"><p className="eyebrow">ДОСТУП И ВАЛЮТА</p><h2>Блокировка и Оси</h2><p className="settings-description">Выдавайте Оси или блокируйте аккаунты. Заблокированный пользователь не сможет войти и писать сообщения.</p><div className="admin-results">{adminResults.map((profile) => <div className="admin-user" key={`controls-${profile.id}`}><div><strong>@{profile.username}</strong><small>{profile.is_banned ? 'Заблокирован' : 'Активен'}</small></div><div className="admin-badge-actions"><input className="osi-amount-input" type="number" min="1" step="1" value={osiAmount} onChange={(event) => setOsiAmount(event.target.value)} aria-label="Количество Оси" /><button className="badge-idea" onClick={() => { void grantOsi(profile) }}>Выдать Оси</button><button className={profile.is_banned ? 'badge-unban' : 'badge-ban'} onClick={() => { void setUserBan(profile, !profile.is_banned) }}>{profile.is_banned ? 'Разблокировать' : 'Заблокировать'}</button></div></div>)}</div></div>}
    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Истории' && <div className="page-view settings-view story-settings-page"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button><p className="eyebrow">ИСТОРИИ</p><h2>Поделиться историей</h2><p className="settings-description">Истории видят только люди, с которыми у вас уже есть диалог. Через 24 часа они исчезают.</p><form className="story-form" onSubmit={publishStory}><input ref={storyInputRef} className="photo-picker" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" onChange={handleStorySelection} /><button type="button" className="story-add" onClick={() => storyInputRef.current?.click()}>Добавить историю</button><label>Размер<select value={storyAspectRatio} onChange={(event) => setStoryAspectRatio(event.target.value)}><option value="9:16">Вертикальный · 9:16</option><option value="1:1">Квадрат · 1:1</option><option value="16:9">Горизонтальный · 16:9</option></select></label>{storyPreviewUrl && <div className={`story-preview ratio-${storyAspectRatio.replace(':', '-')}`}>{storyFile?.type.startsWith('video/') ? <video src={storyPreviewUrl} controls /> : <img src={storyPreviewUrl} alt="Предпросмотр истории" />}{storyOverlayText && <strong>{storyOverlayText}</strong>}</div>}<label>Надпись на истории<input value={storyOverlayText} onChange={(event) => setStoryOverlayText(event.target.value.slice(0, 80))} maxLength={80} placeholder="Например, доброе утро" /></label><label>Описание<textarea value={storyDescription} onChange={(event) => setStoryDescription(event.target.value.slice(0, 180))} maxLength={180} placeholder="Описание истории" /></label><button className="story-publish" disabled={!storyFile || storyUploading}>{storyUploading ? 'Публикуем…' : 'Опубликовать'}</button>{storyError && <p className="privacy-error">{storyError}</p>}</form></div>}
    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Уведомления' && <div className="page-view settings-view notifications-page"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button><p className="eyebrow">УВЕДОМЛЕНИЯ</p><h2>Уведомления</h2><p className="settings-description">Подключите уведомления один раз — Osirium сохранит настройку на этом устройстве.</p><ol className="notification-steps"><li><b>iPhone.</b> Откройте Osirium в Safari, добавьте сайт на экран «Домой», затем включите уведомления уже в приложении.</li><li><b>Android.</b> Разрешите уведомления в Chrome или в установленном веб‑приложении.</li><li><b>ПК.</b> Разрешите уведомления для osirium.lol в браузере.</li><li>После включения разрешение и подключение сохраняются для этого устройства.</li></ol>{notificationPermission === 'granted' && <p className="notification-status granted">Уведомления разрешены для этого устройства.</p>}{notificationPermission === 'denied' && <p className="notification-status">Уведомления запрещены. Включите их в настройках браузера или устройства.</p>}{notificationPermission === 'unsupported' && <p className="notification-status">Этот браузер не поддерживает уведомления.</p>}<p className="notification-note">Если кнопка не срабатывает, проверьте разрешение уведомлений в настройках браузера или системы.</p>{notificationPermission === 'default' && <button type="button" className="notification-enable" onClick={() => { void requestNotificationPermission() }}>Включить уведомления</button>}</div>}
    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Оформление' && <div className="page-view settings-view appearance-page"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button><p className="eyebrow">ПРИЛОЖЕНИЕ</p><h2>Оформление</h2><p className="settings-description">Выберите тему, которая будет использоваться на этом устройстве.</p><section className="theme-settings"><strong>Тема</strong><div><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={(event) => switchTheme('dark', event)}>Тёмная</button><button type="button" className={theme === 'light' ? 'active' : ''} onClick={(event) => switchTheme('light', event)}>Белая</button></div></section></div>}
    {mobileSettingsOpen && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && <button type="button" className="mobile-admin-return" aria-label="К настройкам" onClick={() => { setSettingsSection('Профиль'); setMobileSettingsOpen(false) }}><ArrowLeftIcon /></button>}
    <section className={`conversation ${selectedChat ? 'is-open' : ''} ${selectedConversation === favoritesConversationId ? 'favorites' : ''}`}>
      {!selectedProfile && (activeNav === 'Настройки' || activeNav === 'Профиль') && settingsSection === 'Конфиденциальность' && <div className="local-password-page privacy-overview"><button type="button" className="mobile-page-back" onClick={() => { if (activeNav === 'Профиль') setSettingsSection('Профиль'); setMobileSettingsOpen(false) }}>← {activeNav === 'Профиль' ? 'К профилю' : 'К настройкам'}</button><p className="eyebrow">АККАУНТ</p><h2>Конфиденциальность</h2><button type="button" className="local-password-entry" onClick={openLocalPasswordSettings}><span><strong>Локальный пароль</strong><small>{appLockHash ? 'Код установлен на этом устройстве' : 'Защитите вход отдельным кодом'}</small></span><ArrowRightIcon /></button></div>}
      {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Локальный пароль' && <div className="local-password-page"><button type="button" className="local-password-back" onClick={() => { setPrivacyError(''); setSettingsSection('Конфиденциальность') }}><ArrowLeftIcon /><span>Конфиденциальность</span></button><p className="eyebrow">КОНФИДЕНЦИАЛЬНОСТЬ</p><h2>Локальный пароль</h2><p className="settings-description">Отдельный код только для этого браузера. Он не меняет пароль аккаунта.</p>{appLockHash && !localPasswordAccessGranted ? <form className="privacy-form" onSubmit={verifyLocalPasswordForSettings}><label>Текущий код<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={currentLockPassword} onChange={(event) => setCurrentLockPassword(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="current-password" placeholder="Введите 6 цифр" /></label><button className="privacy-save">Продолжить</button>{privacyError && <p className="privacy-error">{privacyError}</p>}</form> : <form className="privacy-form" onSubmit={savePrivacySettings}><label>Код-пароль<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newLockPassword} onChange={(event) => setNewLockPassword(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="new-password" placeholder="6 цифр" /></label><label>Повторите код<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newLockPasswordRepeat} onChange={(event) => setNewLockPasswordRepeat(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="new-password" placeholder="Повторите 6 цифр" /></label><label>Запрашивать пароль через<select value={appLockTimeout} onChange={(event) => setAppLockTimeout(Number(event.target.value))}><option value={60}>1 минуту</option><option value={300}>5 минут</option><option value={900}>15 минут</option><option value={1800}>30 минут</option><option value={3600}>1 час</option></select></label><button className="privacy-save" disabled={privacySaving}>{privacySaving ? 'Сохраняем…' : appLockHash ? 'Сохранить изменения' : 'Включить пароль'}</button>{appLockHash && <button type="button" className="local-password-remove" onClick={removeLocalPassword}>Убрать локальный пароль</button>}{privacyError && <p className="privacy-error">{privacyError}</p>}</form>}</div>}
      {!selectedProfile && activeNav === 'Чаты' && selectedChat && <header className="mobile-conversation-head"><button className="mobile-menu" aria-label="Вернуться к чатам" onClick={() => { setSelectedConversation(null); setMessages([]); setPinnedMessage(null) }}><Menu2Icon /></button><button type="button" className="mobile-chat-profile" aria-label={`Открыть профиль ${displayNameFor(selectedChat)}`} onClick={() => { void openProfile(selectedChat) }}><span className="avatar small" style={{ backgroundColor: selectedChat.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(selectedChat.avatar_path) ? <img src={profileAvatarUrl(selectedChat.avatar_path) as string} alt="" /> : initials(displayNameFor(selectedChat))}</span><span><strong>{displayNameFor(selectedChat)}<RoleBadge isAdmin={selectedChat.is_admin} badge={selectedChat.badge} /></strong><small className={formatPresence(selectedChat.hidden_presence_since || selectedChat.last_seen_at, Boolean(selectedChat.hidden_presence_since)) === 'в сети' ? 'presence-online' : ''}>{formatPresence(selectedChat.hidden_presence_since || selectedChat.last_seen_at, Boolean(selectedChat.hidden_presence_since))}</small></span></button><button type="button" className="icon-button call-button" aria-label="Позвонить" onClick={() => { void startCall() }}><CallIcon /></button></header>}
      {selectedProfile && <div className="profile-view">
        <button type="button" className="profile-back" aria-label="Назад" onClick={() => { setSelectedProfile(null); setSelectedProfileBio(''); setContactEditorOpen(false) }}><ArrowLeftIcon /></button>
        <span className="avatar profile-large" style={{ backgroundColor: selectedProfile.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(selectedProfile.avatar_path) ? <img src={profileAvatarUrl(selectedProfile.avatar_path) as string} alt="" /> : initials(displayNameFor(selectedProfile))}</span>
        <h2>{displayNameFor(selectedProfile)}<RoleBadge isAdmin={selectedProfile.is_admin} badge={selectedProfile.badge} /></h2>
        <p className="profile-status">@{selectedProfile.username}</p>
        <div className="profile-info"><span>ОПИСАНИЕ</span><p>{selectedProfileLoading ? 'Загружаем…' : selectedProfileBio || `${displayNameFor(selectedProfile)} ещё не придумал что можно написать в описание ;<`}</p></div>
        <button className="page-action" onClick={() => { void selectChat(selectedProfile) }}>Открыть диалог <ArrowRightIcon /></button>
        {!contactEditorOpen ? <button type="button" className="contact-entry-button" onClick={() => { setContactEditorOpen(true); setContactError('') }}>{contacts[selectedProfile.id] ? 'Изменить контакт' : 'Добавить в контакты'}</button> : <div className="contact-sheet-overlay" onClick={() => setContactEditorOpen(false)}>
          <form className="contact-sheet" onSubmit={saveContact} onClick={(event) => event.stopPropagation()}>
            <span>{contacts[selectedProfile.id] ? 'Изменить контакт' : 'Добавить в контакты'}</span>
            <label>Как записать человека<input autoFocus value={contactLabel} onChange={(event) => setContactLabel(event.target.value.slice(0, 48))} maxLength={48} placeholder="Имя контакта" /></label>
            {contacts[selectedProfile.id] && <p className="contact-sheet-hint">Оставьте поле пустым, чтобы вернуть исходный display-ник.</p>}
            <button disabled={contactSaving}>{contactSaving ? 'Сохраняем…' : contacts[selectedProfile.id] ? 'Сохранить имя' : 'Добавить в контакты'}</button>
            {contacts[selectedProfile.id] && <button type="button" className="contact-delete-button" disabled={contactSaving} onClick={() => { void deleteContact() }}>Удалить контакт</button>}
            {contactError && <small>{contactError}</small>}
          </form>
        </div>}
      </div>}
      {!selectedProfile && activeNav === 'Чаты' && (selectedChat ? <>
        <header className="conversation-head"><button className="mobile-menu" aria-label="Вернуться к чатам" onClick={() => { setSelectedConversation(null); setMessages([]); setPinnedMessage(null) }}><Menu2Icon /></button><button type="button" className="icon-button call-button" aria-label="Позвонить" onClick={() => { void startCall() }}><CallIcon /></button><button type="button" className="avatar small header-avatar" aria-label={`Открыть профиль ${displayNameFor(selectedChat)}`} onClick={() => { void openProfile(selectedChat) }} style={{ backgroundColor: selectedChat.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(selectedChat.avatar_path) ? <img src={profileAvatarUrl(selectedChat.avatar_path) as string} alt="" /> : initials(displayNameFor(selectedChat))}</button><div><strong>{displayNameFor(selectedChat)}<RoleBadge isAdmin={selectedChat.is_admin} badge={selectedChat.badge} /></strong><span className={formatPresence(selectedChat.hidden_presence_since || selectedChat.last_seen_at, Boolean(selectedChat.hidden_presence_since)) === 'в сети' ? 'presence-online' : ''}>{formatPresence(selectedChat.hidden_presence_since || selectedChat.last_seen_at, Boolean(selectedChat.hidden_presence_since))}</span></div></header>
      {selectedChat.blocked_by_other && <div className="system-message"><strong>Ось-Бот</strong><span>Ваши последующие сообщения не будут видны собеседнику, увы он вас заблокировал ;&lt;&lt;</span></div>}
      {pinnedMessage && <button type="button" className="pinned-message" onClick={() => openMessageMenu(pinnedMessage, window.innerWidth / 2, 110)}><strong>Закреплённое сообщение</strong><span>{pinnedMessage.image_path ? 'Фотография' : pinnedMessage.body}</span></button>}
      {selectedConversation === favoritesConversationId && <label className="favorites-search"><SearchIcon /><input value={favoritesSearch} onChange={(event) => setFavoritesSearch(event.target.value)} placeholder="Поиск в Избранном" /></label>}<div className="messages">{displayedMessages.map((message, index) => <div key={message.id}>{(index === 0 || messageDayKey(displayedMessages[index - 1].created_at) !== messageDayKey(message.created_at)) && <div className="date-label">{messageDateLabel(message.created_at)}</div>}<div className={`bubble-wrap ${message.sender_id === currentUserId ? 'mine' : ''}`} data-message-id={message.id} onContextMenu={(event) => { event.preventDefault(); openMessageMenu(message, event.clientX, event.clientY) }} onTouchStart={(event) => { const touch = event.touches[0]; startMessageHold(message, touch.clientX, touch.clientY) }} onTouchMove={clearMessageHold} onTouchEnd={clearMessageHold} onTouchCancel={clearMessageHold}><div className="bubble">{message.forwarded_from_id && <small className="message-forwarded">Пересланное сообщение</small>}{message.reply_to_id && <span className="message-reply">{message.reply_sender_id === currentUserId ? 'Вы' : 'Ответ'} · {message.reply_body || 'Сообщение недоступно'}</span>}{message.image_path && (messageImageUrls[message.id] ? <button type="button" className="message-image-button" aria-label="Открыть фотографию" onClick={() => { resetImageZoom(); setOpenedImage({ src: messageImageUrls[message.id], name: message.image_name || 'Фотография' }) }}><img className={`message-image ${loadedMessageImages[message.id] ? 'is-loaded' : ''}`} src={messageImageUrls[message.id]} alt={message.image_name || 'Фотография'} onLoad={() => setLoadedMessageImages((current) => ({ ...current, [message.id]: true }))} /></button> : <span className="image-loading">Загрузка фото…</span>)}{message.audio_path && (messageImageUrls[message.id] ? <div className="voice-message"><span>Голосовое · {message.audio_duration || 0} сек.</span><audio controls preload="metadata" src={messageImageUrls[message.id]} /></div> : <span className="image-loading">Загрузка голосового…</span>)}{!message.image_path && !message.audio_path && message.body}<time>{formatTime(message.created_at)}{message.edited_at && <span> · изм.</span>}{message.sender_id === currentUserId && message.read_at && <span className="read-receipt" aria-label="Прочитано"><CheckIcon /></span>}</time></div></div></div>)}{chatError && <p className="chat-error">{chatError}</p>}</div>
        {voiceLocked && <div className="voice-record-menu"><strong>{voicePaused ? 'На паузе' : 'Запись голосового'} · {voiceSeconds} сек.</strong><button type="button" onClick={toggleVoicePause}>{voicePaused ? 'Продолжить' : 'Пауза'}</button><button type="button" onClick={() => finishVoiceRecording(true)}>Отправить</button><button type="button" className="voice-delete" onClick={() => finishVoiceRecording(false)}>Удалить</button></div>}<form onSubmit={sendMessage} className="composer"><input ref={photoInputRef} className="photo-picker" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePhotoSelection} /><button type="button" className="composer-action" aria-label="Прикрепить фото" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}><CameraIcon /></button><input ref={composerInputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Написать сообщение" disabled={sending || voiceRecording} /><button type="button" className={`composer-action voice-button ${voiceRecording ? 'is-recording' : ''}`} aria-label="Записать голосовое" onPointerDown={onVoicePointerDown} onPointerUp={onVoicePointerUp} onPointerCancel={() => { if (voiceHoldActiveRef.current) finishVoiceRecording(false) }} disabled={photoUploading}><MicrophoneIcon /></button><button className="send" aria-label="Отправить" disabled={sending || voiceRecording}><ArrowRightIcon /></button></form>
      </> : <div className="page-view"><p className="eyebrow">ЛИЧНЫЕ СООБЩЕНИЯ</p><h2>Найдите человека по логину.</h2><p>Введите в поиске слева минимум 3 символа из его @логина — после этого можно начать настоящий диалог.</p></div>)}
      {!selectedProfile && activeNav === 'Главная' && <div className="page-view"><p className="eyebrow">OSIRIUM</p><h2>Ваши сообщения.</h2><p>У вас {chats.length} {chats.length === 1 ? 'диалог' : 'диалогов'}. Используйте поиск, чтобы написать новому человеку.</p><button className="page-action" onClick={() => setActiveNav('Чаты')}>Открыть чаты <ArrowRightIcon /></button></div>}
      {!selectedProfile && activeNav === 'Контакты' && <div className="page-view contacts-view"><p className="eyebrow">ПОИСК ЛЮДЕЙ</p><h2>Контакты по логину</h2><p>Поиск находится слева. Логин доступен в формате @username; в результатах отображаются только подходящие пользователи.</p></div>}
      {!selectedProfile && activeNav === 'Настройки' && <div className="page-view settings-view"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button><p className="eyebrow">НАСТРОЙКИ</p>{settingsSection === 'Профиль' && <><h2>Профиль<AdminBadge isAdmin={currentIsAdmin} /></h2><p className="profile-public-id">Ваш ID: {formatPublicId(currentPublicId)}</p><p className="settings-description">Username <b>@{currentUsername}</b> используется для поиска и остаётся отдельным от display-ника.</p><form className="profile-form" onSubmit={saveProfile}><input ref={avatarInputRef} className="photo-picker" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarSelection} /><div className="avatar-editor"><button type="button" className="avatar profile-avatar avatar-upload" onClick={() => avatarInputRef.current?.click()} aria-label="Изменить аватар">{currentAvatarUrl ? <img src={currentAvatarUrl} alt="Ваш аватар" /> : initials(currentDisplayName || currentUsername)}</button><div><strong>Аватар</strong><small>{avatarUploading ? 'Загружаем…' : 'JPG, PNG или WebP до 5 МБ'}</small><button type="button" className="text-button" onClick={() => avatarInputRef.current?.click()}>Изменить фото</button></div></div><label>Display-ник<input value={currentDisplayName} onChange={(event) => setCurrentDisplayName(event.target.value.slice(0, 48))} maxLength={48} placeholder="Как вас будут видеть" /></label><label>Описание<textarea value={profileBio} onChange={(event) => setProfileBio(event.target.value.slice(0, 160))} maxLength={160} placeholder="Расскажите о себе" /><small>{profileBio.length}/160</small></label><button className="privacy-save" disabled={profileSaving}>{profileSaving ? 'Сохраняем…' : 'Сохранить профиль'}</button>{profileError && <p className="privacy-error">{profileError}</p>}</form></>}{settingsSection === 'Конфиденциальность' && <section className="privacy-section"><h2>Конфиденциальность</h2><h3>Локальный пароль</h3><p>Это отдельный код только для этого браузера. Он не меняет пароль аккаунта и не покидает устройство.</p><form className="privacy-form" onSubmit={savePrivacySettings}><label>Код-пароль<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newLockPassword} onChange={(event) => setNewLockPassword(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="new-password" placeholder={appLockHash ? 'Оставьте пустым, чтобы не менять' : '6 цифр'} /></label><label>Повторите код<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newLockPasswordRepeat} onChange={(event) => setNewLockPasswordRepeat(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="new-password" placeholder="Повторите 6 цифр" /></label><label>Запрашивать пароль через<select value={appLockTimeout} onChange={(event) => setAppLockTimeout(Number(event.target.value))}><option value={60}>1 минуту</option><option value={300}>5 минут</option><option value={900}>15 минут</option><option value={1800}>30 минут</option><option value={3600}>1 час</option></select></label><button className="privacy-save" disabled={privacySaving}>{privacySaving ? 'Сохраняем…' : appLockHash ? 'Сохранить изменения' : 'Включить пароль'}</button>{privacyError && <p className="privacy-error">{privacyError}</p>}</form></section>}{settingsSection === 'Опасная зона' && <section className="danger-zone"><h2>Опасная зона</h2><p>Здесь меняется основной пароль аккаунта — он используется при входе в Osirium.</p><form className="privacy-form" onSubmit={changeAccountPassword}><label>Новый пароль аккаунта<input type="password" value={newAccountPassword} onChange={(event) => setNewAccountPassword(event.target.value)} autoComplete="new-password" placeholder="Минимум 8 символов" /></label><label>Повторите пароль<input type="password" value={newAccountPasswordRepeat} onChange={(event) => setNewAccountPasswordRepeat(event.target.value)} autoComplete="new-password" placeholder="Повторите пароль" /></label><button className="privacy-save" disabled={accountPasswordSaving}>{accountPasswordSaving ? 'Меняем…' : 'Сменить пароль'}</button>{accountPasswordError && <p className="privacy-error">{accountPasswordError}</p>}</form><button className="logout" onClick={() => { void logout() }}>Выйти из аккаунта</button></section>}</div>}
    </section>

    <audio ref={remoteAudioRef} autoPlay />{callTarget && <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Звонок"><div className="call-card"><span className="avatar call-avatar" style={{ backgroundColor: callTarget.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(callTarget.avatar_path) ? <img src={profileAvatarUrl(callTarget.avatar_path) as string} alt="" /> : initials(callTarget.display_name || callTarget.username)}</span><h2>{callTarget.display_name || `@${callTarget.username}`}</h2><p>{callStatus === 'incoming' ? 'Входящий звонок' : callStatus === 'connected' ? 'Вы разговариваете' : callStatus === 'calling' ? 'Соединение…' : callStatus === 'signal-error' ? 'Не удалось доставить звонок. Попробуйте ещё раз.' : 'Не удалось получить доступ к микрофону'}</p>{(callStatus === 'calling' || callStatus === 'incoming') && <span className="call-pulse" aria-hidden="true" />}{callStatus === 'incoming' && <div className="call-actions"><button type="button" className="call-accept" onClick={() => { void acceptCall() }}>Принять</button><button type="button" className="call-hangup" onClick={declineCall}>Отклонить</button></div>}{callStatus !== 'incoming' && <button type="button" className="call-hangup" onClick={() => endCall()}>Завершить звонок</button>}</div></div>}

    {chatMenu && <div className="message-menu-layer" onClick={() => setChatMenu(null)}><div className="message-menu chat-menu" style={{ left: chatMenu.x, top: chatMenu.y }} onClick={(event) => event.stopPropagation()}>{chatMenu.mode === 'actions' ? <><button onClick={() => { void toggleChatPin(chatMenu.chat) }}>{chatMenu.chat.is_pinned ? 'Открепить чат' : 'Закрепить чат'}</button><button onClick={() => { void toggleChatMute(chatMenu.chat) }}>{chatMenu.chat.is_muted ? 'Включить звук' : 'Без звука'}</button>{chatMenu.chat.is_blocked ? <button className="message-menu-danger" onClick={() => { void setChatBlock(chatMenu.chat, false, false) }}>Разблокировать</button> : <button className="message-menu-danger" onClick={() => setChatMenu((current) => current ? { ...current, mode: 'block' } : null)}>Заблокировать</button>}</> : <><p>Заблокировать пользователя</p><button className="message-menu-danger" onClick={() => { void setChatBlock(chatMenu.chat, false) }}>Заблокировать</button><button onClick={() => { void setChatBlock(chatMenu.chat, true) }}>Заблокировать скрытно</button><button className="message-menu-back" onClick={() => setChatMenu((current) => current ? { ...current, mode: 'actions' } : null)}>Назад</button></>}</div></div>}
    {messageMenu && <div className="message-menu-layer" onClick={() => setMessageMenu(null)}>
      <div className="message-menu" style={{ left: messageMenu.x, top: messageMenu.y }} onClick={(event) => event.stopPropagation()}>
        {messageMenu.mode === 'actions' ? <>
          <button onClick={() => beginReply(messageMenu.message)}>Ответить</button>
          <button onClick={() => { setForwardingMessage(messageMenu.message); setMessageMenu(null) }}>Переслать</button>
          <button onClick={() => { void copyMessage(messageMenu.message) }}>Копировать</button>
          {messageMenu.message.sender_id === currentUserId && !messageMenu.message.image_path && !messageMenu.message.audio_path && <button onClick={() => beginEdit(messageMenu.message)}>Изменить</button>}
          <button onClick={() => { void toggleMessagePin(messageMenu.message) }}>{pinnedMessage?.id === messageMenu.message.id ? 'Открепить сообщение' : 'Закрепить сообщение'}</button>
          {messageMenu.message.audio_path && <button onClick={() => { void downloadVoiceMessage(messageMenu.message) }}>Скачать голосовое</button>}
          <button className="message-menu-danger" onClick={() => setMessageMenu((current) => current ? { ...current, mode: 'delete' } : null)}>Удалить</button>
        </> : <>
          <p>Удалить сообщение</p>
          {messageMenu.message.sender_id === currentUserId && <button className="message-menu-danger" onClick={() => { void deleteMessage(messageMenu.message, true) }}>Удалить у всех</button>}
          <button onClick={() => { void deleteMessage(messageMenu.message, false) }}>Удалить у себя</button>
          <button className="message-menu-back" onClick={() => setMessageMenu((current) => current ? { ...current, mode: 'actions' } : null)}>Назад</button>
        </>}
      </div>
    </div>}
    {forwardingMessage && <div className="forward-overlay" onClick={() => setForwardingMessage(null)}><section className="forward-sheet" onClick={(event) => event.stopPropagation()}><h3>Переслать сообщение</h3>{favoriteChat && <button onClick={() => { void forwardMessage(favoriteChat) }}>★ Избранное</button>}{chats.map((chat) => <button key={chat.conversation_id} onClick={() => { void forwardMessage(chat) }}>{chat.display_name || `@${chat.username}`}</button>)}</section></div>}
    {openedImage && <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фотографии" onClick={() => setOpenedImage(null)}><button type="button" className="image-viewer-close" aria-label="Закрыть фотографию" onClick={() => setOpenedImage(null)}>×</button><img className="image-viewer-photo" src={openedImage.src} alt={openedImage.name} style={{ transform: `scale(${imageScale})` }} onWheel={handleImageWheel} onTouchStart={handleImageTouchStart} onTouchMove={handleImageTouchMove} onTouchEnd={() => { imagePinchRef.current = null }} onDoubleClick={resetImageZoom} onClick={(event) => event.stopPropagation()} /><span>{openedImage.name}</span></div>}
    {appLocked && <div className="app-lock-overlay" role="dialog" aria-modal="true" aria-label="Osirium заблокирован"><form className="app-lock-card" onSubmit={unlockApp}><h2>Введите код</h2><p>Osirium был заблокирован после периода бездействия.</p><input autoFocus type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={lockAttempt} onChange={(event) => setLockAttempt(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="current-password" placeholder="6 цифр" /><button>Разблокировать</button>{lockError && <span className="app-lock-error">{lockError}</span>}</form></div>}
    {!appBooting && showWelcome && !authenticated && <div className="welcome-overlay"><div className="welcome-card"><div className="welcome-logo"><span>o</span></div><p className="eyebrow">OSIRIUM</p><h2>{authMode === 'login' ? <>С возвращением<br />в Osirium</> : <>Создайте<br />свой Osirium</>}</h2><p>{authMode === 'login' ? 'Войдите, чтобы продолжить.' : 'Свобода начинается с имени.'}</p><form onSubmit={authenticate} className="auth-form"><label>Логин<input autoFocus value={username} onChange={(event) => setUsername(event.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} autoComplete="username" placeholder="osirium_user" /></label><label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="Минимум 8 символов" /></label><button disabled={authLoading}>{authLoading ? 'Подождите…' : authMode === 'login' ? 'Войти' : 'Создать аккаунт'}</button></form><button className="auth-switch" type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}</button>{authError && <p className="auth-error">{authError}</p>}</div></div>}
    {avatarCropUrl && <div className="avatar-crop-overlay" role="dialog" aria-modal="true"><div className="avatar-crop-card"><h2>Настроить аватар</h2><p>Перетаскивай фото, масштабируй колесом или ползунком.</p><div className="avatar-crop-frame" onWheel={(event) => { event.preventDefault(); setAvatarCropZoom((value) => Math.max(1, Math.min(3, value - event.deltaY * .001))) }} onPointerDown={(event) => { avatarCropDragRef.current = { x: event.clientX, y: event.clientY, offsetX: avatarCropOffset.x, offsetY: avatarCropOffset.y }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { const drag = avatarCropDragRef.current; if (drag) setAvatarCropOffset({ x: drag.offsetX + event.clientX - drag.x, y: drag.offsetY + event.clientY - drag.y }) }} onPointerUp={() => { avatarCropDragRef.current = null }}><img src={avatarCropUrl} alt="Настройка аватара" style={{ transform: `translate(${avatarCropOffset.x}px, ${avatarCropOffset.y}px) scale(${avatarCropZoom})` }} /></div><label className="avatar-crop-zoom">Масштаб<input type="range" min="1" max="3" step="0.01" value={avatarCropZoom} onChange={(event) => setAvatarCropZoom(Number(event.target.value))} /></label>{avatarCropFile?.type === 'image/gif' && <small>GIF сохранится анимированным; для него используется исходный кадр без обрезки.</small>}<div><button type="button" className="avatar-crop-cancel" onClick={() => { if (avatarCropUrl) URL.revokeObjectURL(avatarCropUrl); setAvatarCropUrl(null); setAvatarCropFile(null) }}>Отмена</button><button type="button" className="avatar-crop-save" onClick={() => { void saveAvatarCrop() }} disabled={avatarUploading}>{avatarUploading ? 'Сохраняем…' : 'Сохранить аватар'}</button></div></div></div>}
    {openedStory && !storyUrls[openedStory.story_id] && storyViewerError && <div className="story-viewer" role="dialog" aria-modal="true" onClick={() => setOpenedStory(null)}><div className="story-access-error" onClick={(event) => event.stopPropagation()}><strong>История недоступна</strong><span>{storyViewerError}</span></div></div>}
    {openedStory && storyUrls[openedStory.story_id] && <div className="story-viewer" role="dialog" aria-modal="true" onClick={() => setOpenedStory(null)}><div className={`story-viewer-media ratio-${openedStory.aspect_ratio.replace(':', '-')}`} onClick={(event) => event.stopPropagation()}>{openedStory.media_type === 'video' ? <video className={`story-media ${storyMediaLoaded ? 'is-loaded' : ''}`} src={storyUrls[openedStory.story_id]} controls autoPlay onCanPlay={() => setStoryMediaLoaded(true)} /> : <img className={`story-media ${storyMediaLoaded ? 'is-loaded' : ''}`} src={storyUrls[openedStory.story_id]} alt="История" onLoad={() => setStoryMediaLoaded(true)} />}{previousStory && <button type="button" className="story-step story-step-previous" aria-label="Предыдущая история" onClick={() => { void openStory(previousStory) }}><ArrowRightIcon /></button>}{nextStory && <button type="button" className="story-step story-step-next" aria-label="Следующая история" onClick={() => { void openStory(nextStory) }}><ArrowRightIcon /></button>}{openedStory.user_id === currentUserId && <button type="button" className="story-viewers-toggle" onClick={() => { setStoryViewersOpen((value) => !value); if (!storyViewersOpen) void loadStoryViewers(openedStory.story_id) }}>Зрители{storyViewers.length ? ` · ${storyViewers.length}` : ''}</button>}<div className="story-viewer-copy"><strong>{openedStory.overlay_text}</strong><p>{openedStory.description}</p></div>{openedStory.user_id !== currentUserId && <form className="story-reply" onSubmit={replyToStory}><input value={storyReply} onChange={(event) => setStoryReply(event.target.value.slice(0, 500))} placeholder="Написать сообщение" maxLength={500} /><button type="button" className={`story-reaction ${storyReaction ? 'active' : ''}`} aria-label="Поставить реакцию" onClick={() => { void reactToStory() }}><img src="/story-reaction.png" alt="" /></button><button className="story-reply-send" disabled={storyReplying || !storyReply.trim()} aria-label="Отправить ответ"><ArrowRightIcon /></button></form>}{storyViewersOpen && openedStory.user_id === currentUserId && <div className="story-viewers"><strong>Зрители</strong>{storyViewerError && <small>{storyViewerError}</small>}{storyViewers.length ? storyViewers.map((viewer) => <div className="story-viewer-user" key={viewer.user_id}><span className="avatar" style={{ backgroundColor: viewer.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(viewer.avatar_path) ? <img src={profileAvatarUrl(viewer.avatar_path) as string} alt="" /> : initials(viewer.display_name || viewer.username)}</span><span>{viewer.display_name || `@${viewer.username}`}<small>Просмотрено в {formatTime(viewer.viewed_at)}</small></span>{viewer.reaction === 'heart' && <img src="/story-reaction.png" alt="Реакция" />}</div>) : <p>Пока никто не посмотрел.</p>}</div>}{storyViewerError && !storyViewersOpen && <span className="story-viewer-error">{storyViewerError}</span>}</div></div>}
    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && currentIsAdmin && <div className="admin-audit-float"><p className="eyebrow">ЖУРНАЛ</p><h3>Действия администратора</h3><div className="admin-audit-list">{adminAudit.length ? adminAudit.map((entry) => <div className="admin-audit-row" key={entry.id}><div><strong>{entry.action === 'badge' ? 'Бейдж' : entry.action === 'ban' ? 'Блокировка' : 'Выдача Оси'} · @{entry.username}</strong><small>{formatTime(entry.created_at)}{entry.undone_at ? ' · отменено' : ''}</small></div>{!entry.undone_at && <button type="button" onClick={() => { void undoAdminAudit(entry) }}>Отменить</button>}</div>) : <p className="list-note">Действий пока нет.</p>}</div></div>}
  </main>
}
