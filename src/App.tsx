import { type ChangeEvent, type CSSProperties, FormEvent, type TouchEvent, useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import {
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
  PlusIcon,
  ProfileCircleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  Shield2Icon,
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
}

type Chat = Profile & {
  conversation_id: string
  last_body: string | null
  last_created_at: string | null
  last_sender_id: string | null
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
}

type MessageMenu = {
  message: Message
  x: number
  y: number
  mode: 'actions' | 'delete'
}

const defaultAvatarColor = '#dfe6f0'
const lockTimestampKey = (userId: string) => `osirium:last-hidden-at:${userId}`
const appLockStorageKey = (userId: string) => `osirium:local-app-lock:${userId}`
const appLockedStorageKey = (userId: string) => `osirium:local-app-locked:${userId}`
const lockPasswordIterations = 210_000

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

export default function App() {
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null)
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null)
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
  const [authenticated, setAuthenticated] = useState(!hasSupabase)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUsername, setCurrentUsername] = useState('пользователь')
  const [currentPublicId, setCurrentPublicId] = useState<number | null>(null)
  const [currentIsAdmin, setCurrentIsAdmin] = useState(false)
  const [currentOsiBalance, setCurrentOsiBalance] = useState(0)
  const [currentDisplayName, setCurrentDisplayName] = useState('')
  const [profileBio, setProfileBio] = useState('')
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<'Профиль' | 'Оси' | 'Конфиденциальность' | 'Опасная зона' | 'Админ-панель'>('Профиль')
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [adminSearch, setAdminSearch] = useState('')
  const [adminResults, setAdminResults] = useState<Profile[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [osiAmount, setOsiAmount] = useState('100')
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
  const [privacyError, setPrivacyError] = useState('')
  const [privacySaving, setPrivacySaving] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const [sending, setSending] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [messageImageUrls, setMessageImageUrls] = useState<Record<string, string>>({})
  const [loadedMessageImages, setLoadedMessageImages] = useState<Record<string, boolean>>({})
  const [openedImage, setOpenedImage] = useState<{ src: string; name: string } | null>(null)
  const [imageScale, setImageScale] = useState(1)
  const [callTarget, setCallTarget] = useState<Chat | null>(null)
  const [callStatus, setCallStatus] = useState<'calling' | 'microphone-error'>('calling')
  const callStreamRef = useRef<MediaStream | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const composerInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const imagePinchRef = useRef<{ distance: number; scale: number } | null>(null)
  const bootStartedAtRef = useRef(Date.now())
  const messageHoldTimerRef = useRef<number | null>(null)

  const selectedChat = chats.find((item) => item.conversation_id === selectedConversation) ?? null
  const navIndex = ['Чаты', 'Контакты', 'Настройки'].indexOf(activeNav)
  const query = search.trim().toLowerCase()
  const isUserSearch = query.length >= 3
  const visibleChats = useMemo(
    () => chats.filter((item) => `${item.username} ${item.display_name}`.toLowerCase().includes(query)),
    [chats, query],
  )

  const loadChats = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('list_direct_conversations')
    if (error) {
      setChatError('Не удалось загрузить диалоги. Попробуйте обновить страницу.')
      return
    }
    setChats((data ?? []) as ChatRow[])
  }, [])

  const loadImageUrls = useCallback(async (records: Message[]) => {
    if (!supabase) return
    const imageRecords = records.filter((record) => record.image_path)
    if (!imageRecords.length) return
    const { data } = await supabase.storage.from('chat-media').createSignedUrls(imageRecords.map((record) => record.image_path as string), 3600)
    const urlByPath = new Map((data ?? []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]))
    const nextUrls = Object.fromEntries(imageRecords.flatMap((record) => {
      const url = urlByPath.get(record.image_path as string)
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
    if (!supabase) return
    await supabase.rpc('mark_direct_messages_read', { p_conversation_id: conversationId })
    const { data, error } = await supabase.rpc('list_messages', { p_conversation_id: conversationId })
    if (error) {
      setChatError('Не удалось загрузить сообщения.')
      return
    }
    const records = (data ?? []) as Message[]
    setMessages(records)
    void loadImageUrls(records)
    void loadPinnedMessage(conversationId)
  }, [loadImageUrls, loadPinnedMessage])

  useEffect(() => {
    if (!supabase) {
      const timer = window.setTimeout(() => setAppBooting(false), 1500)
      return () => window.clearTimeout(timer)
    }
    const client = supabase
    let active = true
    const finishBoot = () => {
      const remaining = Math.max(0, 1500 - (Date.now() - bootStartedAtRef.current))
      window.setTimeout(() => { if (active) setAppBooting(false) }, remaining)
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

      const { data: privacyProfile } = await client.from('profiles').select('username, display_name, bio, avatar_path, public_id, osi_balance').eq('id', user.id).maybeSingle()
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
      const hiddenAt = Number(window.localStorage.getItem(lockTimestampKey(user.id)) || 0)
      if (lock?.passwordHash && lock.passwordSalt && (window.localStorage.getItem(appLockedStorageKey(user.id)) === '1' || (hiddenAt && Date.now() - hiddenAt >= timeout * 1000))) {
        window.localStorage.setItem(appLockedStorageKey(user.id), '1')
        setAppLocked(true)
      }
      await loadChats()
      finishBoot()
    }

    void client.auth.getSession().then(({ data }) => hydrate(data.session))
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => { void hydrate(session) })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadChats])

  useEffect(() => {
    if (!appLockHash || !appLockSalt || !currentUserId) return
    const markInactive = () => window.localStorage.setItem(lockTimestampKey(currentUserId), String(Date.now()))
    const checkLock = () => {
      if (document.visibilityState !== 'visible') return
      const hiddenAt = Number(window.localStorage.getItem(lockTimestampKey(currentUserId)) || 0)
      if (hiddenAt && Date.now() - hiddenAt >= appLockTimeout * 1000) {
        window.localStorage.setItem(appLockedStorageKey(currentUserId), '1')
        setAppLocked(true)
      }
    }
    const onVisibilityChange = () => document.visibilityState === 'hidden' ? markInactive() : checkLock()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', markInactive)
    window.addEventListener('focus', checkLock)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', markInactive)
      window.removeEventListener('focus', checkLock)
    }
  }, [appLockHash, appLockSalt, appLockTimeout, currentUserId])

  useEffect(() => {
    if (!appLocked || !currentUserId) return
    const persistLock = () => window.localStorage.setItem(appLockedStorageKey(currentUserId), '1')
    persistLock()
    window.addEventListener('pagehide', persistLock)
    return () => window.removeEventListener('pagehide', persistLock)
  }, [appLocked, currentUserId])

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
    if (!supabase || !selectedConversation) return
    const client = supabase
    const channel = client
      .channel(`messages-${selectedConversation}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedConversation}` }, (payload) => {
        const message = payload.new as Message
        setMessages((current) => current.some((item) => item.id === message.id) ? current.map((item) => item.id === message.id ? { ...item, ...message } : item) : [...current, message])
        void loadImageUrls([message])
        void loadChats()
      })
      .subscribe()

    return () => { void client.removeChannel(channel) }
  }, [loadChats, loadImageUrls, selectedConversation])

  useEffect(() => () => {
    callStreamRef.current?.getTracks().forEach((track) => track.stop())
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
    }
    setChats((current) => [nextChat, ...current.filter((item) => item.conversation_id !== nextChat.conversation_id)])
    setSearch('')
    await selectChat(nextChat)
  }

  async function openProfile(profile: Chat) {
    setSelectedProfile(profile)
    setSelectedProfileBio('')
    setSelectedProfileLoading(true)
    if (!supabase) {
      setSelectedProfileLoading(false)
      return
    }
    const { data, error } = await supabase.rpc('get_public_profile', { p_user_id: profile.id })
    if (!error) setSelectedProfileBio(String(data?.[0]?.bio || ''))
    setSelectedProfileLoading(false)
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
    else setAdminError('Оси выданы.')
  }

  async function setUserBan(profile: Profile, banned: boolean) {
    if (!supabase || !currentIsAdmin) return
    const { error } = await supabase.rpc('admin_set_ban', { p_user_id: profile.id, p_is_banned: banned, p_reason: banned ? 'Нарушение правил Osirium' : null })
    if (error) {
      setAdminError('Не удалось изменить блокировку.')
      return
    }
    setAdminResults((current) => current.map((item) => item.id === profile.id ? { ...item, is_banned: banned } : item))
  }

  function clearMessageHold() {
    if (messageHoldTimerRef.current !== null) window.clearTimeout(messageHoldTimerRef.current)
    messageHoldTimerRef.current = null
  }

  function openMessageMenu(message: Message, x: number, y: number) {
    clearMessageHold()
    setMessageMenu({ message, x: Math.min(Math.max(14, x), window.innerWidth - 230), y: Math.min(Math.max(14, y), window.innerHeight - 180), mode: 'actions' })
  }

  function startMessageHold(message: Message, x: number, y: number) {
    clearMessageHold()
    messageHoldTimerRef.current = window.setTimeout(() => openMessageMenu(message, x, y), 550)
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

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !supabase || !selectedConversation || sending) return

    setSending(true)
    setChatError('')
    const { data, error } = await supabase.rpc('send_direct_message', {
      p_conversation_id: selectedConversation,
      p_body: body,
    })
    setSending(false)

    if (error || !data?.[0]) {
      setChatError('Не удалось отправить сообщение.')
      return
    }

    const message = data[0] as Message
    setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
    setChats((current) => current.map((item) => item.conversation_id === selectedConversation
      ? { ...item, last_body: message.body, last_created_at: message.created_at, last_sender_id: message.sender_id }
      : item))
    setDraft('')
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
    if (!supabase || !selectedConversation || !currentUserId || photoUploading) return
    setPhotoUploading(true)
    setChatError('')
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'image'
    const path = `${selectedConversation}/${currentUserId}/${crypto.randomUUID()}-${safeName}`
    const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type,
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
  }

  async function savePrivacySettings(event: FormEvent) {
    event.preventDefault()
    if (!currentUserId) return
    setPrivacyError('')
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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setProfileError('Аватар: JPG, PNG или WebP до 5 МБ.')
      return
    }
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${currentUserId}/avatar-${Date.now()}.${extension}`
    setAvatarUploading(true)
    setProfileError('')
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type })
    if (uploadError) {
      setAvatarUploading(false)
      setProfileError(`Не удалось загрузить аватар: ${uploadError.message}`)
      return
    }
    const { error: profileUpdateError } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', currentUserId)
    setAvatarUploading(false)
    if (profileUpdateError) {
      setProfileError('Аватар загрузился, но не сохранился в профиле.')
      return
    }
    setCurrentAvatarUrl(supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl)
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

  async function startCall() {
    if (!selectedChat) return
    setCallTarget(selectedChat)
    setCallStatus('calling')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      callStreamRef.current = stream
    } catch {
      setCallStatus('microphone-error')
    }
  }

  function endCall() {
    callStreamRef.current?.getTracks().forEach((track) => track.stop())
    callStreamRef.current = null
    setCallTarget(null)
  }

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
    <button key={chat.conversation_id} onClick={() => { void selectChat(chat) }} className={`chat-row ${chat.conversation_id === selectedConversation ? 'selected' : ''}`}>
      <span className="avatar" style={{ backgroundColor: chat.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(chat.avatar_path) ? <img src={profileAvatarUrl(chat.avatar_path) as string} alt="" /> : initials(chat.display_name || chat.username)}</span>
      <span className="chat-copy">
        <span className="chat-line"><strong>{chat.display_name || `@${chat.username}`}<RoleBadge isAdmin={chat.is_admin} badge={chat.badge} /></strong><time>{formatTime(chat.last_created_at)}</time></span>
        <span className="chat-line"><small>@{chat.username} · {formatPreview(chat.last_body)}</small></span>
      </span>
    </button>
  )

  const renderUserResult = (profile: Profile) => (
    <button key={profile.id} onClick={() => { void startDirectChat(profile) }} className="chat-row search-result" disabled={directChatLoading === profile.id}>
      <span className="avatar" style={{ backgroundColor: profile.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(profile.avatar_path) ? <img src={profileAvatarUrl(profile.avatar_path) as string} alt="" /> : initials(profile.display_name || profile.username)}</span>
      <span className="chat-copy"><span className="chat-line"><strong>{profile.display_name || `@${profile.username}`}<RoleBadge isAdmin={profile.is_admin} badge={profile.badge} /></strong></span><span className="chat-line"><small>@{profile.username} · {directChatLoading === profile.id ? 'Открываем диалог…' : 'Начать диалог'}</small></span></span>
    </button>
  )

  return <main className={`app-shell ${mobileSettingsOpen ? 'mobile-settings-open' : ''}`}>
    {appBooting && <div className="app-loader" role="status" aria-label="Загрузка Osirium"><div className="app-loader-mark" /><p>OSIRIUM</p><span>Загружаем пространство</span><i /></div>}
    <aside className="sidebar">
      <div className="sidebar-head"><h1>{activeNav === 'Чаты' ? 'Сообщения' : activeNav}</h1>{activeNav !== 'Настройки' && <button className="icon-button" aria-label="Новый диалог" onClick={() => { setActiveNav('Чаты'); setSearch('') }}><PlusIcon /></button>}</div>
      {(activeNav === 'Чаты' || activeNav === 'Контакты') && <label className="search"><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value.replace(/^@/, ''))} placeholder="Поиск" /></label>}
      {(activeNav === 'Чаты' || activeNav === 'Контакты') && <section className="chat-list">
        {isUserSearch ? <>
          {searchLoading && <p className="list-note">Ищем пользователей…</p>}
          {!searchLoading && searchResults.map(renderUserResult)}
          {!searchLoading && !searchResults.length && <p className="list-note">Пользователи по этому логину не найдены.</p>}
        </> : <>
          {visibleChats.map(renderChatRow)}
          {!visibleChats.length && <p className="list-note">Введите минимум 3 символа логина, чтобы найти человека.</p>}
        </>}
      </section>}
      {chatError && <p className="sidebar-error" role="alert">{chatError}</p>}
      {activeNav === 'Главная' && <div className="sidebar-note"><span>СЕГОДНЯ</span><strong>Диалогов: {chats.length}</strong><p>Найдите человека по логину и начните приватный разговор.</p></div>}
      {activeNav === 'Настройки' && <section className="settings-menu" onClick={() => setMobileSettingsOpen(true)}><p>АККАУНТ</p><button className={settingsSection === 'Профиль' ? 'active' : ''} onClick={() => setSettingsSection('Профиль')}><ProfileCircleIcon /><strong>Профиль</strong></button><button className={settingsSection === 'Оси' ? 'active' : ''} onClick={() => setSettingsSection('Оси')}><MoneyIcon /><strong>Оси</strong></button><button className={settingsSection === 'Конфиденциальность' ? 'active' : ''} onClick={() => setSettingsSection('Конфиденциальность')}><LockIcon /><strong>Конфиденциальность</strong></button>{currentIsAdmin && <><p>АДМИНИСТРАТОР</p><button className={settingsSection === 'Админ-панель' ? 'active' : ''} onClick={() => setSettingsSection('Админ-панель')}><Shield2Icon /><strong>Админ-панель</strong></button></>}<p>УПРАВЛЕНИЕ</p><button className={`danger ${settingsSection === 'Опасная зона' ? 'active' : ''}`} onClick={() => setSettingsSection('Опасная зона')}><TrashIcon /><strong>Опасная зона</strong></button></section>}
      <nav className="bottom-nav" aria-label="Основная навигация" style={{ '--active-offset': `calc(${navIndex * 100}% + ${navIndex * 6}px)` } as CSSProperties}>
        {[['Чаты', MessageIcon], ['Контакты', GroupIcon], ['Настройки', SettingsIcon]].map(([label, Icon]) => <button key={label as string} onClick={() => { setSelectedProfile(null); setActiveNav(label as string); if (label === 'Настройки') setMobileSettingsOpen(false) }} className={activeNav === label ? 'active' : ''}><Icon /><span>{label as string}</span></button>)}
      </nav>
    </aside>

    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && currentIsAdmin && <div className="page-view settings-view admin-page"><p className="eyebrow">АДМИНИСТРАТОР</p><h2>Бейджи пользователей</h2><p className="settings-description">Выдавайте роли людям. Белый бейдж администратора назначается только системой и виден только у вас.</p><form className="admin-search-form" onSubmit={searchAdminUsers}><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Найти по username" /><button className="privacy-save" disabled={adminLoading}>{adminLoading ? 'Ищем…' : 'Найти'}</button></form>{adminError && <p className="privacy-error">{adminError}</p>}<div className="admin-results">{adminResults.map((profile) => <div className="admin-user" key={profile.id}><span className="avatar" style={{ backgroundColor: profile.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(profile.avatar_path) ? <img src={profileAvatarUrl(profile.avatar_path) as string} alt="" /> : initials(profile.display_name || profile.username)}</span><div><strong>{profile.display_name || `@${profile.username}`}<RoleBadge isAdmin={profile.is_admin} badge={profile.badge} /></strong><small>@{profile.username}</small></div><div className="admin-badge-actions"><button className="badge-helper" onClick={() => { void assignBadge(profile, 'helper') }}>Хелпер</button><button className="badge-idea" onClick={() => { void assignBadge(profile, 'idea') }}>Идейник</button><button className="badge-clear" onClick={() => { void assignBadge(profile, null) }}>Снять</button></div></div>)}</div></div>}
    {!selectedProfile && activeNav === 'Настройки' && settingsSection === 'Оси' && <div className="page-view settings-view osi-page"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button><p className="eyebrow">ВАЛЮТА</p><h2>Оси</h2><div className="osi-balance-card"><img className="osi-symbol" src="/osi-currency-icon.png" alt="" /><div><small>Ваш баланс</small><strong>{currentOsiBalance.toLocaleString('ru-RU')} Оси</strong></div></div><p className="settings-description">Оси — внутренняя валюта Osirium. Пока её нельзя заработать, но баланс уже сохраняется в профиле.</p></div>}
    {currentIsAdmin && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && <div className="page-view settings-view admin-page admin-page-secondary"><p className="eyebrow">ДОСТУП И ВАЛЮТА</p><h2>Блокировка и Оси</h2><p className="settings-description">Выдавайте Оси или блокируйте аккаунты. Заблокированный пользователь не сможет войти и писать сообщения.</p><div className="admin-results">{adminResults.map((profile) => <div className="admin-user" key={`controls-${profile.id}`}><div><strong>@{profile.username}</strong><small>{profile.is_banned ? 'Заблокирован' : 'Активен'}</small></div><div className="admin-badge-actions"><input className="osi-amount-input" type="number" min="1" step="1" value={osiAmount} onChange={(event) => setOsiAmount(event.target.value)} aria-label="Количество Оси" /><button className="badge-idea" onClick={() => { void grantOsi(profile) }}>Выдать Оси</button><button className={profile.is_banned ? 'badge-unban' : 'badge-ban'} onClick={() => { void setUserBan(profile, !profile.is_banned) }}>{profile.is_banned ? 'Разблокировать' : 'Заблокировать'}</button></div></div>)}</div></div>}
    {mobileSettingsOpen && activeNav === 'Настройки' && settingsSection === 'Админ-панель' && <button type="button" className="mobile-admin-return" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button>}
    <section className={`conversation ${selectedChat ? 'is-open' : ''}`}>
      {selectedProfile && <div className="profile-view"><button className="profile-back" onClick={() => { setSelectedProfile(null); setSelectedProfileBio('') }}>← Назад</button><span className="avatar profile-large" style={{ backgroundColor: selectedProfile.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(selectedProfile.avatar_path) ? <img src={profileAvatarUrl(selectedProfile.avatar_path) as string} alt="" /> : initials(selectedProfile.display_name || selectedProfile.username)}</span><h2>{selectedProfile.display_name || `@${selectedProfile.username}`}<RoleBadge isAdmin={selectedProfile.is_admin} badge={selectedProfile.badge} /></h2><p className="profile-status">@{selectedProfile.username}</p><div className="profile-info"><span>ОПИСАНИЕ</span><p>{selectedProfileLoading ? 'Загружаем…' : selectedProfileBio || `${selectedProfile.display_name || `@${selectedProfile.username}`} ещё не придумал что можно написать в описание ;<`}</p></div><button className="page-action" onClick={() => { void selectChat(selectedProfile) }}>Открыть диалог <ArrowRightIcon /></button></div>}
      {!selectedProfile && activeNav === 'Чаты' && (selectedChat ? <>
        <header className="conversation-head"><button className="mobile-menu" aria-label="Вернуться к чатам" onClick={() => { setSelectedConversation(null); setMessages([]); setPinnedMessage(null) }}><Menu2Icon /></button><button type="button" className="icon-button call-button" aria-label="Позвонить" onClick={() => { void startCall() }}><CallIcon /></button><button type="button" className="avatar small header-avatar" aria-label={`Открыть профиль ${selectedChat.display_name}`} onClick={() => { void openProfile(selectedChat) }} style={{ backgroundColor: selectedChat.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(selectedChat.avatar_path) ? <img src={profileAvatarUrl(selectedChat.avatar_path) as string} alt="" /> : initials(selectedChat.display_name || selectedChat.username)}</button><div><strong>{selectedChat.display_name || `@${selectedChat.username}`}<RoleBadge isAdmin={selectedChat.is_admin} badge={selectedChat.badge} /></strong><span>@{selectedChat.username}</span></div></header>
      {pinnedMessage && <button type="button" className="pinned-message" onClick={() => openMessageMenu(pinnedMessage, window.innerWidth / 2, 110)}><strong>Закреплённое сообщение</strong><span>{pinnedMessage.image_path ? 'Фотография' : pinnedMessage.body}</span></button>}
      <div className="messages">{messages.map((message, index) => <div key={message.id}>{(index === 0 || messageDayKey(messages[index - 1].created_at) !== messageDayKey(message.created_at)) && <div className="date-label">{messageDateLabel(message.created_at)}</div>}<div className={`bubble-wrap ${message.sender_id === currentUserId ? 'mine' : ''}`} onContextMenu={(event) => { event.preventDefault(); openMessageMenu(message, event.clientX, event.clientY) }} onTouchStart={(event) => { const touch = event.touches[0]; startMessageHold(message, touch.clientX, touch.clientY) }} onTouchMove={clearMessageHold} onTouchEnd={clearMessageHold} onTouchCancel={clearMessageHold}><div className="bubble">{message.image_path && (messageImageUrls[message.id] ? <button type="button" className="message-image-button" aria-label="Открыть фотографию" onClick={() => { resetImageZoom(); setOpenedImage({ src: messageImageUrls[message.id], name: message.image_name || 'Фотография' }) }}><img className={`message-image ${loadedMessageImages[message.id] ? 'is-loaded' : ''}`} src={messageImageUrls[message.id]} alt={message.image_name || 'Фотография'} onLoad={() => setLoadedMessageImages((current) => ({ ...current, [message.id]: true }))} /></button> : <span className="image-loading">Загрузка фото…</span>)}{!message.image_path && message.body}<time>{formatTime(message.created_at)}{message.sender_id === currentUserId && message.read_at && <span className="read-receipt" aria-label="Прочитано"><CheckIcon /></span>}</time></div></div></div>)}{chatError && <p className="chat-error">{chatError}</p>}</div>
        <form onSubmit={sendMessage} className="composer"><input ref={photoInputRef} className="photo-picker" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePhotoSelection} /><button type="button" className="composer-action" aria-label="Прикрепить фото" onClick={() => photoInputRef.current?.click()} disabled={photoUploading}><CameraIcon /></button><input ref={composerInputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Написать сообщение" disabled={sending} /><button type="button" className="composer-action" aria-label="Записать голосовое"><MicrophoneIcon /></button><button className="send" aria-label="Отправить" disabled={sending}><ArrowRightIcon /></button></form>
      </> : <div className="page-view"><p className="eyebrow">ЛИЧНЫЕ СООБЩЕНИЯ</p><h2>Найдите человека по логину.</h2><p>Введите в поиске слева минимум 3 символа из его @логина — после этого можно начать настоящий диалог.</p></div>)}
      {!selectedProfile && activeNav === 'Главная' && <div className="page-view"><p className="eyebrow">OSIRIUM</p><h2>Ваши сообщения.</h2><p>У вас {chats.length} {chats.length === 1 ? 'диалог' : 'диалогов'}. Используйте поиск, чтобы написать новому человеку.</p><button className="page-action" onClick={() => setActiveNav('Чаты')}>Открыть чаты <ArrowRightIcon /></button></div>}
      {!selectedProfile && activeNav === 'Контакты' && <div className="page-view contacts-view"><p className="eyebrow">ПОИСК ЛЮДЕЙ</p><h2>Контакты по логину</h2><p>Поиск находится слева. Логин доступен в формате @username; в результатах отображаются только подходящие пользователи.</p></div>}
      {!selectedProfile && activeNav === 'Настройки' && <div className="page-view settings-view"><button type="button" className="mobile-page-back" onClick={() => setMobileSettingsOpen(false)}>← К настройкам</button><p className="eyebrow">НАСТРОЙКИ</p>{settingsSection === 'Профиль' && <><h2>Профиль<AdminBadge isAdmin={currentIsAdmin} /></h2><p className="profile-public-id">Ваш ID: {formatPublicId(currentPublicId)}</p><p className="settings-description">Username <b>@{currentUsername}</b> используется для поиска и остаётся отдельным от display-ника.</p><form className="profile-form" onSubmit={saveProfile}><input ref={avatarInputRef} className="photo-picker" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarSelection} /><div className="avatar-editor"><button type="button" className="avatar profile-avatar avatar-upload" onClick={() => avatarInputRef.current?.click()} aria-label="Изменить аватар">{currentAvatarUrl ? <img src={currentAvatarUrl} alt="Ваш аватар" /> : initials(currentDisplayName || currentUsername)}</button><div><strong>Аватар</strong><small>{avatarUploading ? 'Загружаем…' : 'JPG, PNG или WebP до 5 МБ'}</small><button type="button" className="text-button" onClick={() => avatarInputRef.current?.click()}>Изменить фото</button></div></div><label>Display-ник<input value={currentDisplayName} onChange={(event) => setCurrentDisplayName(event.target.value.slice(0, 48))} maxLength={48} placeholder="Как вас будут видеть" /></label><label>Описание<textarea value={profileBio} onChange={(event) => setProfileBio(event.target.value.slice(0, 160))} maxLength={160} placeholder="Расскажите о себе" /><small>{profileBio.length}/160</small></label><button className="privacy-save" disabled={profileSaving}>{profileSaving ? 'Сохраняем…' : 'Сохранить профиль'}</button>{profileError && <p className="privacy-error">{profileError}</p>}</form></>}{settingsSection === 'Конфиденциальность' && <section className="privacy-section"><h2>Конфиденциальность</h2><h3>Локальный пароль</h3><p>Это отдельный код только для этого браузера. Он не меняет пароль аккаунта и не покидает устройство.</p><form className="privacy-form" onSubmit={savePrivacySettings}><label>Код-пароль<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newLockPassword} onChange={(event) => setNewLockPassword(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="new-password" placeholder={appLockHash ? 'Оставьте пустым, чтобы не менять' : '6 цифр'} /></label><label>Повторите код<input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={newLockPasswordRepeat} onChange={(event) => setNewLockPasswordRepeat(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="new-password" placeholder="Повторите 6 цифр" /></label><label>Запрашивать пароль через<select value={appLockTimeout} onChange={(event) => setAppLockTimeout(Number(event.target.value))}><option value={60}>1 минуту</option><option value={300}>5 минут</option><option value={900}>15 минут</option><option value={1800}>30 минут</option><option value={3600}>1 час</option></select></label><button className="privacy-save" disabled={privacySaving}>{privacySaving ? 'Сохраняем…' : appLockHash ? 'Сохранить изменения' : 'Включить пароль'}</button>{privacyError && <p className="privacy-error">{privacyError}</p>}</form></section>}{settingsSection === 'Опасная зона' && <section className="danger-zone"><h2>Опасная зона</h2><p>Здесь меняется основной пароль аккаунта — он используется при входе в Osirium.</p><form className="privacy-form" onSubmit={changeAccountPassword}><label>Новый пароль аккаунта<input type="password" value={newAccountPassword} onChange={(event) => setNewAccountPassword(event.target.value)} autoComplete="new-password" placeholder="Минимум 8 символов" /></label><label>Повторите пароль<input type="password" value={newAccountPasswordRepeat} onChange={(event) => setNewAccountPasswordRepeat(event.target.value)} autoComplete="new-password" placeholder="Повторите пароль" /></label><button className="privacy-save" disabled={accountPasswordSaving}>{accountPasswordSaving ? 'Меняем…' : 'Сменить пароль'}</button>{accountPasswordError && <p className="privacy-error">{accountPasswordError}</p>}</form><button className="logout" onClick={() => { void logout() }}>Выйти из аккаунта</button></section>}</div>}
    </section>

    {callTarget && <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Исходящий звонок"><div className="call-card"><span className="avatar call-avatar" style={{ backgroundColor: callTarget.avatar_color || defaultAvatarColor }}>{profileAvatarUrl(callTarget.avatar_path) ? <img src={profileAvatarUrl(callTarget.avatar_path) as string} alt="" /> : initials(callTarget.display_name || callTarget.username)}</span><h2>{callTarget.display_name || `@${callTarget.username}`}</h2><p>{callStatus === 'calling' ? 'Соединение…' : 'Не удалось получить доступ к микрофону'}</p>{callStatus === 'calling' && <span className="call-pulse" aria-hidden="true" />}<button type="button" className="call-hangup" onClick={endCall}>Завершить звонок</button></div></div>}

    {messageMenu && <div className="message-menu-layer" onClick={() => setMessageMenu(null)}><div className="message-menu" style={{ left: messageMenu.x, top: messageMenu.y }} onClick={(event) => event.stopPropagation()}>{messageMenu.mode === 'actions' ? <><button onClick={() => { void toggleMessagePin(messageMenu.message) }}>{pinnedMessage?.id === messageMenu.message.id ? 'Открепить сообщение' : 'Закрепить сообщение'}</button><button className="message-menu-danger" onClick={() => setMessageMenu((current) => current ? { ...current, mode: 'delete' } : null)}>Удалить</button></> : <><p>Удалить сообщение</p>{messageMenu.message.sender_id === currentUserId && <button className="message-menu-danger" onClick={() => { void deleteMessage(messageMenu.message, true) }}>Удалить у всех</button>}<button onClick={() => { void deleteMessage(messageMenu.message, false) }}>Удалить у себя</button><button className="message-menu-back" onClick={() => setMessageMenu((current) => current ? { ...current, mode: 'actions' } : null)}>Назад</button></>}</div></div>}
    {openedImage && <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фотографии" onClick={() => setOpenedImage(null)}><button type="button" className="image-viewer-close" aria-label="Закрыть фотографию" onClick={() => setOpenedImage(null)}>×</button><img className="image-viewer-photo" src={openedImage.src} alt={openedImage.name} style={{ transform: `scale(${imageScale})` }} onWheel={handleImageWheel} onTouchStart={handleImageTouchStart} onTouchMove={handleImageTouchMove} onTouchEnd={() => { imagePinchRef.current = null }} onDoubleClick={resetImageZoom} onClick={(event) => event.stopPropagation()} /><span>{openedImage.name}</span></div>}
    {appLocked && <div className="app-lock-overlay" role="dialog" aria-modal="true" aria-label="Osirium заблокирован"><form className="app-lock-card" onSubmit={unlockApp}><h2>Введите код</h2><p>Osirium был заблокирован после периода бездействия.</p><input autoFocus type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={lockAttempt} onChange={(event) => setLockAttempt(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="current-password" placeholder="6 цифр" /><button>Разблокировать</button>{lockError && <span className="app-lock-error">{lockError}</span>}</form></div>}
    {!appBooting && showWelcome && !authenticated && <div className="welcome-overlay"><div className="welcome-card"><div className="welcome-logo"><span>o</span></div><p className="eyebrow">OSIRIUM</p><h2>{authMode === 'login' ? <>С возвращением<br />в Osirium</> : <>Создайте<br />свой Osirium</>}</h2><p>{authMode === 'login' ? 'Войдите, чтобы продолжить.' : 'Свобода начинается с имени.'}</p><form onSubmit={authenticate} className="auth-form"><label>Логин<input autoFocus value={username} onChange={(event) => setUsername(event.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} autoComplete="username" placeholder="osirium_user" /></label><label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="Минимум 8 символов" /></label><button disabled={authLoading}>{authLoading ? 'Подождите…' : authMode === 'login' ? 'Войти' : 'Создать аккаунт'}</button></form><button className="auth-switch" type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}</button>{authError && <p className="auth-error">{authError}</p>}</div></div>}
  </main>
}
