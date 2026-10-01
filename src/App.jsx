import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { api, clearSession, getStoredUser, saveSession } from './lib/api'

const DEFAULT_HIKER = {
  email: 'hiker@twendehike.co.ke',
  password: 'Hiker123!',
}

const DEFAULT_EVENT_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22800%22 viewBox=%220 0 1200 800%22%3E%3Crect width=%221200%22 height=%22800%22 fill=%22%23e7e5e4%22/%3E%3Cpath d=%22M0 620 260 400l180 130 190-250 310 340 260-180v360H0z%22 fill=%22%23a8a29e%22/%3E%3Ccircle cx=%22930%22 cy=%22180%22 r=%2270%22 fill=%22%23d6d3d1%22/%3E%3C/svg%3E'

const DEFAULT_HERO_SETTINGS = {
  heroImageUrl: '',
  heroOverlayColor: '#064e3b',
  heroHeadline: 'Conquer the Aberdares, Longonot & Mt. Kenya.',
  heroSubtitle: 'Verified trail captains, licensed KWS rangers, pickup from Nairobi CBD, and seamless booking with Lipa na M-PESA.',
  heroBadge: "KENYA'S #1 TRAIL MARKETPLACE",
}

const getClientLikeKey = () => {
  if (typeof window === 'undefined') return 'anonymous-user'
  try {
    const existing = window.localStorage.getItem('twendehike_client_key')
    if (existing) return existing
    const generated = `anon-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`
    window.localStorage.setItem('twendehike_client_key', generated)
    return generated
  } catch (error) {
    return `anon-${Date.now().toString(36)}`
  }
}

const COUNTY_OPTIONS = [
  ['Mombasa', 1], ['Kwale', 2], ['Kilifi', 3], ['Tana River', 4], ['Lamu', 5], ['Taita Taveta', 6],
  ['Garissa', 7], ['Wajir', 8], ['Mandera', 9], ['Marsabit', 10], ['Isiolo', 11], ['Meru', 12],
  ['Tharaka Nithi', 13], ['Embu', 14], ['Kitui', 15], ['Machakos', 16], ['Makueni', 17], ['Nyandarua', 18],
  ['Nyeri', 19], ['Kirinyaga', 20], ["Murang'a", 21], ['Kiambu', 22], ['Turkana', 23], ['West Pokot', 24],
  ['Samburu', 25], ['Trans Nzoia', 26], ['Uasin Gishu', 27], ['Elgeyo Marakwet', 28], ['Nandi', 29],
  ['Baringo', 30], ['Laikipia', 31], ['Nakuru', 32], ['Narok', 33], ['Kajiado', 34], ['Kericho', 35],
  ['Bomet', 36], ['Kakamega', 37], ['Vihiga', 38], ['Bungoma', 39], ['Busia', 40], ['Siaya', 41],
  ['Kisumu', 42], ['Homa Bay', 43], ['Migori', 44], ['Kisii', 45], ['Nyamira', 46], ['Nairobi', 47],
].map(([name, id]) => ({ id, name, code: String(id).padStart(3, '0') }))

const KENYA_COUNTIES = COUNTY_OPTIONS.map((county) => county.name)

const DEFAULT_INCLUSIONS = [
  'Round-trip road transfer from Nairobi',
  'Certified trail leader',
  'First-aid and safety briefing',
  'Trail snacks and hydration support',
  'Park entry fees and permits',
]

const DEFAULT_CHECKLIST = [
  'Waterproof hiking boots',
  'At least 2L water bottle',
  'Warm layer / fleece',
  'Rain jacket',
  'Headlamp or torch',
  'Energy snacks',
  'Sun hat and sunscreen',
]

const STORAGE_KEYS = {
  hikes: 'twendehike_marketplace_hikes',
  pending: 'twendehike_pending_hikes',
  approved: 'twendehike_approved_hikes',
  removed: 'twendehike_removed_hikes',
  completed: 'twendehike_completed_hikes',
}

const readStorage = (key, fallback) => {
  if (typeof window === 'undefined') return fallback
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch (error) {
    return fallback
  }
}

const persistMarketplaceState = (nextHikes, nextApprovedHikes) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEYS.hikes, JSON.stringify(nextHikes))
  window.localStorage.setItem(STORAGE_KEYS.approved, JSON.stringify(nextApprovedHikes))
}

const getEffectiveTier = (hike) => {
  const tiers = Array.isArray(hike?.tiers) ? hike.tiers : []
  if (!tiers.length) {
    return { name: 'Standard Hiker', price: Number(hike?.price || 0) }
  }

  const eventDate = new Date(hike?.date || hike?.eventDate || Date.now())
  const cutoff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const earlyBirdTier = tiers.find((tier) => /^early/i.test(String(tier.name || '')) && Number(tier.price || 0) > 0)
  const standardTier = tiers.find((tier) => /standard|regular/i.test(String(tier.name || '')) && Number(tier.price || 0) > 0) || tiers[0]

  if (eventDate > cutoff && earlyBirdTier) {
    return earlyBirdTier
  }

  return standardTier || tiers[0]
}

const createOrganizerCredential = () => {
  const seed = Math.random().toString(36).slice(2, 8)
  return {
    email: `host-${seed}@twendehike.co.ke`,
    password: `Host${seed.toUpperCase()}!`,
  }
}

const normalizeEvent = (event, index = 0) => {
  const organizerName = event.organizerName || (event.organizer?.firstName ? `${event.organizer.firstName} ${event.organizer.lastName}` : event.organizer || 'Twende Hike Kenya')
  const maxTickets = Number(event.maxTickets || event.capacity || 30)
  const soldTickets = Number(event.soldTickets || event.bookedSlots || 0)
  const organizerRating = Number(event.organizerRating || 4.9)
  const interestCount = Number(event.interestCount ?? event.totalRatings ?? 0)

  return {
    id: event.id,
    title: event.title,
    tag: event.tag || (index % 2 === 0 ? 'beginner' : 'prep'),
    county: event.county?.name || event.county || 'Nairobi',
    difficulty: event.difficulty || 'Moderate',
    distance: event.distance || '10 KM',
    elevation: event.elevation || '1,800 m',
    duration: event.duration || '4 - 5 Hours',
    departure: event.departure || '5:30 AM Nairobi CBD',
    pickup: event.meetingPoint || event.pickup || event.locationText || '',
    meetingPoint: event.meetingPoint || event.pickup || event.locationText || '',
    pickupTime: event.pickupTime || event.departure || event.startTime || '05:30 AM',
    googleMapUrl: event.googleMapUrl || event.mapUrl || '',
    date: event.eventDate || event.date || new Date().toISOString(),
    image: event.image || event.photos?.[0] || event.images?.[0] || DEFAULT_EVENT_IMAGE,
    photos: event.photos?.length ? event.photos : (event.images?.length ? event.images : []),
    organizer: organizerName,
    organizerName: event.organizerName || organizerName,
    organizerPhone: event.organizerPhone || '',
    organizerEmail: event.organizerEmail || '',
    organizerRating,
    interestCount,
    totalRatings: Number(event.totalRatings || 0),
    visibleName: event.visibleName ?? true,
    verified: event.verified ?? true,
    description: event.summary || event.description || 'A scenic adventure designed for unforgettable outdoor experiences in Kenya.',
    inclusions: Array.isArray(event.inclusions) && event.inclusions.length ? event.inclusions : DEFAULT_INCLUSIONS,
    gear: event.gear || ['Hiking boots', 'Water bottle', 'Light rain jacket'],
    tiers: event.tiers || [{ name: 'Standard Hiker', price: Number(event.price || 0), active: true, note: 'Standard Fare' }],
    price: Number(event.price || 0),
    maxTickets,
    soldTickets,
    status: event.status || 'approved',
  }
}

const initialPending = []

const generateOrganizerPassword = (name, email, phone) => {
  const cleanName = (name || 'host').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'HST'
  const cleanEmail = (email || 'host').split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'HOST'
  const cleanPhone = (phone || '0000').replace(/\D/g, '').slice(-4) || '0000'
  const uniqueKey = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${cleanName}${cleanEmail}${cleanPhone}${uniqueKey}!`
}

function App() {
  const [activeView, setActiveView] = useState('discover')
  const [activeTag, setActiveTag] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [difficulty, setDifficulty] = useState('all')
  const [county, setCounty] = useState('all')
  const [countyInput, setCountyInput] = useState('All Locations')
  const [countyMenuOpen, setCountyMenuOpen] = useState(false)
  const [countyDisplayLimit, setCountyDisplayLimit] = useState(5)
  const [countySearch, setCountySearch] = useState('Nairobi')
  const [isCountyDropdownOpen, setIsCountyDropdownOpen] = useState(false)
  const [selectedCounty, setSelectedCounty] = useState(() => COUNTY_OPTIONS.find((entry) => entry.name === 'Nairobi'))
  const [maxPrice, setMaxPrice] = useState(15000)
  const [mapMode, setMapMode] = useState('grid')
  const [hikes, setHikes] = useState([])
  const [userBookings, setUserBookings] = useState([])
  const [hikerProfile, setHikerProfile] = useState(() => {
    if (typeof window === 'undefined') return { fullName: '', phoneNumber: '' }
    try {
      const storedProfile = localStorage.getItem('twendehike_hiker_profile')
      return storedProfile ? JSON.parse(storedProfile) : { fullName: '', phoneNumber: '' }
    } catch (error) {
      return { fullName: '', phoneNumber: '' }
    }
  })
  const [profileDraft, setProfileDraft] = useState(() => {
    if (typeof window === 'undefined') return { fullName: '', phoneNumber: '' }
    try {
      const storedProfile = localStorage.getItem('twendehike_hiker_profile')
      return storedProfile ? JSON.parse(storedProfile) : { fullName: '', phoneNumber: '' }
    } catch (error) {
      return { fullName: '', phoneNumber: '' }
    }
  })
  const [organizerManifest, setOrganizerManifest] = useState([])
  const [pendingHikes, setPendingHikes] = useState([])
  const [approvedHikes, setApprovedHikes] = useState([])
  const [organizerRequests, setOrganizerRequests] = useState([])
  const [approvedOrganizers, setApprovedOrganizers] = useState([])
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('twendehike_theme') === 'dark'
  })
  const [organizerLogin, setOrganizerLogin] = useState({ email: '', password: '' })
  const [organizerSession, setOrganizerSession] = useState(null)
  const [selectedInclusions, setSelectedInclusions] = useState(DEFAULT_INCLUSIONS.slice(0, 3))
  const [selectedChecklistItems, setSelectedChecklistItems] = useState(DEFAULT_CHECKLIST.slice(0, 3))
  const [organizerRequestForm, setOrganizerRequestForm] = useState({
    name: '',
    email: '',
    phone: '',
    organization: '',
  })
  const [eventModal, setEventModal] = useState(null)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [selectedTierIndex, setSelectedTierIndex] = useState(0)
  const [checkoutHike, setCheckoutHike] = useState(null)
  const [checkoutStep, setCheckoutStep] = useState('form')
  const [toast, setToast] = useState('')
  const [ticketModal, setTicketModal] = useState(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [authUser, setAuthUser] = useState(getStoredUser())
  const [hikerSession, setHikerSession] = useState(() => {
    if (typeof window === 'undefined') return null
    try {
      const storedSession = localStorage.getItem('twendehike_hiker_session')
      return storedSession ? JSON.parse(storedSession) : null
    } catch (error) {
      return null
    }
  })
  const [hikerAuthMode, setHikerAuthMode] = useState('login')
  const [hikerAuthForm, setHikerAuthForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  })
  const [hikerAuthError, setHikerAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(true)
  const [checkoutForm, setCheckoutForm] = useState({
    fullName: hikerProfile.fullName || '',
    idNumber: '',
    emergencyContact: hikerProfile.emergencyContact || '',
    pickup: '',
    phoneNumber: hikerProfile.phoneNumber || '',
  })
  const [paymentReference, setPaymentReference] = useState('')
  const [checkoutPayment, setCheckoutPayment] = useState(null)
  const [removedHikes, setRemovedHikes] = useState(() => readStorage(STORAGE_KEYS.removed, []))
  const [completedHikes, setCompletedHikes] = useState(() => readStorage(STORAGE_KEYS.completed, []))
  const [ticketRequests, setTicketRequests] = useState([])
  const [uploadedEventImages, setUploadedEventImages] = useState([])
  const [organizerRatings, setOrganizerRatings] = useState({})
  const [likedHikes, setLikedHikes] = useState(() => {
    if (typeof window === 'undefined') return []
    try {
      return JSON.parse(localStorage.getItem('twendehike_liked_hikes') || '[]')
    } catch (error) {
      return []
    }
  })
  const [adminLoginOpen, setAdminLoginOpen] = useState(false)
  const [scannerRef, setScannerRef] = useState('')
  const [adminCredentials, setAdminCredentials] = useState({ email: '', password: '' })
  const [adminProfileForm, setAdminProfileForm] = useState({ firstName: '', lastName: '' })
  const [adminPasswordForm, setAdminPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [adminMessage, setAdminMessage] = useState('')
  const [heroSettings, setHeroSettings] = useState(DEFAULT_HERO_SETTINGS)
  const [heroSettingsForm, setHeroSettingsForm] = useState(DEFAULT_HERO_SETTINGS)
  const [adminEvents, setAdminEvents] = useState([])
  const overlayHistoryRef = useRef(false)

  const showToast = (message) => {
    setToast(message)
    window.clearTimeout(showToast.timeout)
    showToast.timeout = window.setTimeout(() => setToast(''), 3500)
  }

  const pushOverlayHistory = () => {
    if (typeof window === 'undefined' || overlayHistoryRef.current) return
    window.history.pushState({ twendeOverlay: true }, '')
    overlayHistoryRef.current = true
  }

  const closeOverlayHistory = () => {
    if (typeof window === 'undefined' || !overlayHistoryRef.current) return
    overlayHistoryRef.current = false
    window.history.back()
  }

  useEffect(() => {
    const handlePopState = () => {
      if (!overlayHistoryRef.current) return
      overlayHistoryRef.current = false
      setEventModal(null)
      setCheckoutHike(null)
      setTicketModal(null)
      setAdminLoginOpen(false)
      setCreateModalOpen(false)
      setMobileMenuOpen(false)
      setLightboxIndex(null)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (activeView !== 'admin' || authUser?.role !== 'super_admin') return

    api.getAdminEvents()
      .then((response) => {
        const allEvents = Array.isArray(response?.data) ? response.data.map((event, index) => normalizeEvent(event, index)) : []
        setAdminEvents(allEvents)
        setPendingHikes(allEvents.filter((event) => event.status === 'pending_approval'))
        setApprovedHikes(allEvents.filter((event) => ['approved', 'published'].includes(event.status)))
        setHikes(allEvents.filter((event) => ['approved', 'published'].includes(event.status)))
      })
      .catch((error) => setAdminMessage(error.message || 'Unable to load admin events.'))
  }, [activeView, authUser])

  const getStoredHikerAccounts = () => {
    if (typeof window === 'undefined') return []
    try {
      const rawAccounts = localStorage.getItem('twendehike_hiker_accounts')
      return rawAccounts ? JSON.parse(rawAccounts) : []
    } catch (error) {
      return []
    }
  }

  const persistHikerSession = (nextSession) => {
    if (typeof window === 'undefined') return

    setHikerSession(nextSession)
    setUserBookings(nextSession?.bookings || [])
    setHikerProfile({
      fullName: nextSession?.fullName || '',
      phoneNumber: nextSession?.phoneNumber || '',
      emergencyContact: nextSession?.emergencyContact || '',
    })
    setProfileDraft({
      fullName: nextSession?.fullName || '',
      phoneNumber: nextSession?.phoneNumber || '',
      emergencyContact: nextSession?.emergencyContact || '',
    })
    localStorage.setItem('twendehike_hiker_session', JSON.stringify(nextSession))

    const accounts = getStoredHikerAccounts()
    const accountIndex = accounts.findIndex((account) => account.id === nextSession?.id)

    if (nextSession) {
      const nextAccounts = [...accounts]
      if (accountIndex >= 0) {
        nextAccounts[accountIndex] = nextSession
      } else {
        nextAccounts.unshift(nextSession)
      }
      localStorage.setItem('twendehike_hiker_accounts', JSON.stringify(nextAccounts))
    }
  }

  const logoutHiker = () => {
    setHikerSession(null)
    setUserBookings([])
    setHikerProfile({ fullName: '', phoneNumber: '', emergencyContact: '' })
    setProfileDraft({ fullName: '', phoneNumber: '', emergencyContact: '' })
    localStorage.removeItem('twendehike_hiker_session')
    showToast('Logged out from your private hiker account.')
  }

  const handleHikerAuthSubmit = (event) => {
    event.preventDefault()

    const email = hikerAuthForm.email.trim().toLowerCase()
    const password = hikerAuthForm.password.trim()
    const phone = hikerAuthForm.phone.trim()
    const name = hikerAuthForm.name.trim()

    if (!email || !password) {
      setHikerAuthError('Email and password are required.')
      return
    }

    const accounts = getStoredHikerAccounts()

    if (hikerAuthMode === 'signup') {
      if (!name || !phone) {
        setHikerAuthError('Full name and phone number are required to create an account.')
        return
      }
      if (hikerAuthForm.confirmPassword && hikerAuthForm.confirmPassword !== password) {
        setHikerAuthError('The password confirmation does not match.')
        return
      }
      if (accounts.some((account) => account.email.toLowerCase() === email)) {
        setHikerAuthError('An account with that email already exists. Please log in instead.')
        return
      }

      const newAccount = {
        id: `hiker-${Date.now()}`,
        fullName: name,
        email,
        phoneNumber: phone,
        emergencyContact: '',
        password,
        bookings: [],
      }

      const nextAccounts = [newAccount, ...accounts]
      localStorage.setItem('twendehike_hiker_accounts', JSON.stringify(nextAccounts))
      persistHikerSession(newAccount)
      setHikerAuthForm({ name: '', email: '', phone: '', password: '', confirmPassword: '' })
      setHikerAuthError('')
      showToast('Your private hiking account has been created.')
      return
    }

    const matchedAccount = accounts.find(
      (account) => account.email.toLowerCase() === email && account.password === password,
    )

    if (!matchedAccount) {
      setHikerAuthError('We could not match that hiker account. Please check your details.')
      return
    }

    persistHikerSession(matchedAccount)
    setHikerAuthForm({ name: '', email: '', phone: '', password: '', confirmPassword: '' })
    setHikerAuthError('')
    showToast(`Welcome back, ${matchedAccount.fullName}.`)
  }

  const generateQrMatrix = (value) => {
    const normalized = (value || 'TWENDEHIKE').toString()
    const size = 21
    const matrix = Array.from({ length: size }, () => Array(size).fill(false))

    const fillFinderPattern = (startRow, startCol) => {
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 7; col += 1) {
          const isBorder = row === 0 || row === 6 || col === 0 || col === 6
          const isCenter = row >= 2 && row <= 4 && col >= 2 && col <= 4
          matrix[startRow + row][startCol + col] = isBorder || isCenter
        }
      }
    }

    fillFinderPattern(0, 0)
    fillFinderPattern(0, size - 7)
    fillFinderPattern(size - 7, 0)

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (row === 0 || col === 0 || row === size - 1 || col === size - 1) continue
        const seed = normalized.charCodeAt((row * 7 + col * 3) % normalized.length) + row * 13 + col * 17
        matrix[row][col] = seed % 2 === 0
      }
    }

    return matrix
  }

  const saveHikerProfile = (event) => {
    event.preventDefault()
    const trimmedName = profileDraft.fullName.trim()
    const trimmedPhone = profileDraft.phoneNumber.trim()

    if (!trimmedName || !trimmedPhone) {
      showToast('Name and phone number are required to save your profile.')
      return
    }

    const nextProfile = {
      fullName: trimmedName,
      phoneNumber: trimmedPhone,
      emergencyContact: profileDraft.emergencyContact?.trim() || '',
    }

    setHikerProfile(nextProfile)
    setProfileDraft(nextProfile)

    const nextSession = hikerSession
      ? { ...hikerSession, ...nextProfile, bookings: hikerSession.bookings || [] }
      : null

    if (nextSession) {
      persistHikerSession(nextSession)
    } else if (typeof window !== 'undefined') {
      localStorage.setItem('twendehike_hiker_profile', JSON.stringify(nextProfile))
    }

    showToast('Your hiker profile has been saved.')
  }

  const organizerScanStats = useMemo(() => {
    const checkedInCount = organizerManifest.filter((item) => item.checkedIn).length
    return {
      checkedIn: checkedInCount,
      total: organizerManifest.length,
    }
  }, [organizerManifest])

  const scanTicketForCheckIn = () => {
    const reference = scannerRef.trim()
    if (!reference) {
      showToast('Enter a ticket reference to scan a hiker.')
      return
    }

    const match = organizerManifest.find((item) => item.ref.toLowerCase() === reference.toLowerCase())
    if (!match) {
      showToast('No matching ticket reference was found for this scan.')
      return
    }

    setOrganizerManifest((prev) => prev.map((item) => item.ref.toLowerCase() === reference.toLowerCase() ? { ...item, checkedIn: true } : item))
    setScannerRef('')
    showToast(`${match.name} checked in successfully.`)
  }

  const logout = () => {
    clearSession()
    setAuthUser(null)
    setActiveView('discover')
    setAdminLoginOpen(false)
    setAdminMessage('')
    showToast('You have been logged out.')
  }

  useEffect(() => {
    if (authUser?.role === 'super_admin') {
      setAdminProfileForm({ firstName: authUser.firstName || '', lastName: authUser.lastName || '' })
    }
  }, [authUser])

  useEffect(() => {
    const hasStoredToken = !!localStorage.getItem('twendehike_access_token')

    if (authUser && authUser.role !== 'super_admin') {
      clearSession()
      setAuthUser(null)
      return
    }

    if (!hasStoredToken && authUser?.role === 'super_admin') {
      clearSession()
      setAuthUser(null)
      setActiveView('discover')
      setAdminLoginOpen(false)
    }
  }, [authUser])

  useEffect(() => {
    if (activeView === 'admin' && (!authUser || authUser.role !== 'super_admin' || !localStorage.getItem('twendehike_access_token'))) {
      setActiveView('discover')
      setAdminLoginOpen(true)
      setAdminMessage('Admin session expired. Please log in again.')
    }
  }, [activeView, authUser])

  useEffect(() => {
    document.body.classList.toggle('theme-dark', darkMode)
    window.localStorage.setItem('twendehike_theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    setProfileDraft(hikerProfile)
    setCheckoutForm((prev) => ({
      ...prev,
      fullName: hikerProfile.fullName || prev.fullName,
      phoneNumber: hikerProfile.phoneNumber || prev.phoneNumber,
      emergencyContact: hikerProfile.emergencyContact || prev.emergencyContact,
    }))
  }, [hikerProfile])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.pending, JSON.stringify(pendingHikes))
  }, [pendingHikes])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.approved, JSON.stringify(approvedHikes))
  }, [approvedHikes])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.removed, JSON.stringify(removedHikes))
  }, [removedHikes])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.completed, JSON.stringify(completedHikes))
  }, [completedHikes])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.hikes, JSON.stringify(hikes))
  }, [hikes])

  useEffect(() => {
    const demoTitles = ['Ngong Hills Sunrise Hike', 'Menengai Crater Loop']
    Object.values(STORAGE_KEYS).forEach((key) => {
      try {
        const storedValue = window.localStorage.getItem(key)
        if (!storedValue) return
        const parsed = JSON.parse(storedValue)
        if (Array.isArray(parsed) && parsed.some((item) => demoTitles.includes(item?.title))) {
          window.localStorage.removeItem(key)
        }
      } catch (error) {
        // Ignore malformed storage entries; they are not a valid app state.
      }
    })
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const storedUser = getStoredUser()
        if (storedUser) {
          setAuthUser(storedUser)
        }

        const fallbackApproved = readStorage(STORAGE_KEYS.approved, [])
        const fallbackHikes = readStorage(STORAGE_KEYS.hikes, [])

        const [eventsResult, settingsResult] = await Promise.all([
          api.getPublicEvents(),
          api.getHeroSettings().catch(() => ({ data: DEFAULT_HERO_SETTINGS })),
        ])
        const heroData = settingsResult?.data || {}
        const loadedSettings = {
          ...DEFAULT_HERO_SETTINGS,
          heroHeadline: heroData.title || heroData.heroHeadline || DEFAULT_HERO_SETTINGS.heroHeadline,
          heroSubtitle: heroData.subtitle || heroData.heroSubtitle || DEFAULT_HERO_SETTINGS.heroSubtitle,
          heroBadge: heroData.badge || heroData.heroBadge || DEFAULT_HERO_SETTINGS.heroBadge,
          heroImageUrl: heroData.bg_image || heroData.heroImageUrl || DEFAULT_HERO_SETTINGS.heroImageUrl,
          heroOverlayColor: heroData.bg_color || heroData.heroOverlayColor || DEFAULT_HERO_SETTINGS.heroOverlayColor,
        }
        setHeroSettings({ ...DEFAULT_HERO_SETTINGS, ...loadedSettings })
        setHeroSettingsForm({ ...DEFAULT_HERO_SETTINGS, ...loadedSettings })
        const eventList = Array.isArray(eventsResult?.data) ? eventsResult.data : []
        const normalizedRemote = eventList.map((item, index) => normalizeEvent(item, index))
        const fallbackList = Array.isArray(fallbackApproved) && fallbackApproved.length ? fallbackApproved : fallbackHikes
        const mergedHikes = normalizedRemote.length ? normalizedRemote : fallbackList

        setHikes(mergedHikes)
        setApprovedHikes(mergedHikes)
        persistMarketplaceState(mergedHikes, mergedHikes)

        if (hikerSession) {
          setUserBookings(hikerSession.bookings || [])
          setHikerProfile({
            fullName: hikerSession.fullName || '',
            phoneNumber: hikerSession.phoneNumber || '',
            emergencyContact: hikerSession.emergencyContact || '',
          })
          setProfileDraft({
            fullName: hikerSession.fullName || '',
            phoneNumber: hikerSession.phoneNumber || '',
            emergencyContact: hikerSession.emergencyContact || '',
          })
        }
      } catch (error) {
        const fallbackApproved = readStorage(STORAGE_KEYS.approved, [])
        const fallbackHikes = readStorage(STORAGE_KEYS.hikes, [])
        const persistedHikes = fallbackApproved.length ? fallbackApproved : fallbackHikes
        setHikes(persistedHikes)
        setApprovedHikes(persistedHikes)
        persistMarketplaceState(persistedHikes, persistedHikes)
        showToast(error.message || 'Unable to load trail marketplace.')
      } finally {
        setAuthLoading(false)
      }
    }

    bootstrap()
  }, [])

  const sortHikes = (items) => [...items].sort((a, b) => {
    const scoreA = Number(a.organizerRating || 0) * 10 + Number(a.totalRatings || 0)
    const scoreB = Number(b.organizerRating || 0) * 10 + Number(b.totalRatings || 0)
    return scoreB - scoreA
  })

  const filteredHikes = useMemo(() => {
    return sortHikes(hikes).filter((hike) => {
      if (activeTag !== 'all' && hike.tag !== activeTag) return false
      if (searchTerm && !hike.title.toLowerCase().includes(searchTerm.toLowerCase()) && !hike.description.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false
      }
      if (difficulty !== 'all' && hike.difficulty !== difficulty) return false
        if (county !== 'all' && !String(hike.county || '').toLowerCase().includes(String(county).toLowerCase())) return false
      const lowestTier = Math.min(...hike.tiers.map((tier) => Number(tier.price || 0)))
      if (lowestTier > maxPrice) return false
      return Number(hike.soldTickets || 0) < Number(hike.maxTickets || Number.MAX_SAFE_INTEGER)
    })
  }, [activeTag, searchTerm, difficulty, county, maxPrice, hikes])

  const countySuggestions = useMemo(() => {
    const query = (countyInput || 'All Locations').trim().toLowerCase()
    if (!query || query === 'all locations') {
      return KENYA_COUNTIES
    }
    return KENYA_COUNTIES.filter((entry) => entry.toLowerCase().includes(query))
  }, [countyInput])

  const visibleCountySuggestions = countySuggestions.slice(0, countyDisplayLimit)

  const filteredCreationCounties = useMemo(() => {
    const query = countySearch.trim().toLowerCase()
    if (!query || query === selectedCounty?.name.toLowerCase()) return COUNTY_OPTIONS
    return COUNTY_OPTIONS.filter((entry) => entry.name.toLowerCase().includes(query))
  }, [countySearch, selectedCounty])

  const selectCreationCounty = (countyOption) => {
    setSelectedCounty(countyOption)
    setCountySearch(countyOption.name)
    setIsCountyDropdownOpen(false)
  }

  const resetFilters = () => {
    setSearchTerm('')
    setDifficulty('all')
    setCounty('all')
    setCountyInput('All Locations')
    setCountyMenuOpen(false)
    setCountyDisplayLimit(5)
    setMaxPrice(15000)
    setActiveTag('all')
  }

  const openEventModal = (hike) => {
    pushOverlayHistory()
    setEventModal(hike)
    setSelectedTierIndex(0)
  }

  const closeEventModal = () => {
    setEventModal(null)
    setLightboxIndex(null)
    closeOverlayHistory()
  }

  const openCreateModal = () => {
    pushOverlayHistory()
    setCreateModalOpen(true)
  }

  const closeCreateModal = () => {
    setCreateModalOpen(false)
    closeOverlayHistory()
  }

  const openAdminLogin = () => {
    pushOverlayHistory()
    setAdminLoginOpen(true)
  }

  const closeAdminLogin = () => {
    setAdminLoginOpen(false)
    closeOverlayHistory()
  }

  const closeCheckout = () => {
    setCheckoutHike(null)
    closeOverlayHistory()
  }

  const openTicketModal = (booking) => {
    pushOverlayHistory()
    setTicketModal(booking)
  }

  const closeTicketModal = () => {
    setTicketModal(null)
    closeOverlayHistory()
  }

  const openEventLightbox = (index) => setLightboxIndex(index)
  const closeEventLightbox = () => setLightboxIndex(null)

  const eventModalPhotos = eventModal?.photos?.length
    ? eventModal.photos
    : eventModal?.image
      ? [eventModal.image]
      : []

  const bookSelectedTier = () => {
    if (!eventModal) return
    if (Number(eventModal.soldTickets || 0) >= Number(eventModal.maxTickets || 0)) {
      showToast('This hike is sold out. No more tickets are available.')
      return
    }

    const selectedTier = eventModal.tiers[selectedTierIndex] || eventModal.tiers[0]
    setCheckoutForm((prev) => ({
      ...prev,
      pickup: eventModal.pickup || eventModal.locationText || 'Direct at trailhead',
      fullName: hikerProfile.fullName || prev.fullName || '',
      phoneNumber: hikerProfile.phoneNumber || prev.phoneNumber || '',
    }))
    setCheckoutHike({ hike: eventModal, tier: selectedTier })
    setCheckoutStep('form')
    setCreateModalOpen(false)
    setEventModal(null)
  }

  const triggerStkPrompt = async () => {
    if (!checkoutHike) return

    const phoneDigits = String(checkoutForm.phoneNumber || '').replace(/\D/g, '').replace(/^0/, '')
    const normalizedPhoneNumber = phoneDigits.startsWith('254') ? `+${phoneDigits}` : `+254${phoneDigits}`

    try {
      const paymentResult = await api.initiateStkPush({
        eventId: checkoutHike.hike.id,
        phoneNumber: normalizedPhoneNumber,
        amount: Number(checkoutHike.tier.price),
        quantity: 1,
        pickupLocation: checkoutForm.pickup || checkoutHike.hike.pickup || 'Direct at trailhead',
      })

      const paymentData = paymentResult?.data || paymentResult
      setCheckoutPayment(paymentData)
      setCheckoutStep('prompt')
      showToast('STK Push triggered. Check your M-PESA prompt.')
    } catch (error) {
      showToast(error.message || 'Unable to start STK push.')
      setCheckoutStep('form')
    }
  }

  const confirmStkPin = async () => {
    if (!checkoutHike) return

    try {
      const checkoutId = checkoutPayment?.checkoutRequestID || checkoutPayment?.checkoutRequestId || `CK-${Date.now()}`
      const merchantId = checkoutPayment?.merchantRequestID || checkoutPayment?.merchantRequestId || `MR-${Date.now()}`
      const receipt = `SL${Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8)}`

      const callbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: merchantId,
            CheckoutRequestID: checkoutId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: Number(checkoutHike.tier.price) },
                { Name: 'MpesaReceiptNumber', Value: receipt },
                { Name: 'TransactionDate', Value: `${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}` },
                { Name: 'PhoneNumber', Value: checkoutForm.phoneNumber },
              ],
            },
          },
        },
      }

      const callbackResponse = await api.mpesaCallback(callbackPayload)
      const bookingId = callbackResponse?.data?.bookingId || `TH-BK-${Math.floor(10000 + Math.random() * 90000)}`
      const hikerName = (hikerSession?.fullName || hikerProfile.fullName || checkoutForm.fullName || 'Hiker').trim()
      const newBooking = {
        bookingId,
        mpesaRef: callbackResponse?.data?.receiptNumber || receipt,
        hikeId: checkoutHike.hike.id,
        hikeTitle: checkoutHike.hike.title,
        county: checkoutHike.hike.county,
        distance: checkoutHike.hike.distance,
        elevation: checkoutHike.hike.elevation,
        duration: checkoutHike.hike.duration,
        date: formatDate(checkoutHike.hike.date),
        hikerName,
        hikerPhone: checkoutForm.phoneNumber || hikerSession?.phoneNumber || hikerProfile.phoneNumber || '+254712345678',
        idNumber: checkoutForm.idNumber,
        seatBus: `Rosa Bus ${Math.floor(Math.random() * 2) + 1} #${Math.floor(Math.random() * 20) + 1}`,
        pickup: checkoutForm.pickup,
        price: `KES ${Number(checkoutHike.tier.price).toLocaleString()}`,
        status: 'Confirmed & Active',
      }

      setHikes((prev) =>
        prev.map((hike) =>
          hike.id === checkoutHike.hike.id
            ? { ...hike, soldTickets: Number(hike.soldTickets || 0) + 1 }
            : hike,
        ),
      )

      const nextBookings = [newBooking, ...(userBookings || [])]
      const nextSession = hikerSession
        ? {
            ...hikerSession,
            fullName: hikerName,
            phoneNumber: checkoutForm.phoneNumber || hikerSession.phoneNumber || '+254712345678',
            bookings: nextBookings,
          }
        : {
            id: `hiker-${Date.now()}`,
            fullName: hikerName,
            email: `${(hikerName || 'hiker').toLowerCase().replace(/\s+/g, '.') || 'hiker'}@twendehike.local`,
            phoneNumber: checkoutForm.phoneNumber || '+254712345678',
            emergencyContact: checkoutForm.emergencyContact || '',
            password: 'private-account',
            bookings: nextBookings,
          }

      setPaymentReference(newBooking.mpesaRef)
      setCheckoutStep('success')
      setUserBookings(nextBookings)
      persistHikerSession(nextSession)
      setOrganizerManifest((prev) => [
        {
          id: `M${prev.length + 1}`,
          name: newBooking.hikerName,
          ref: newBooking.mpesaRef,
          pickup: newBooking.pickup,
          phone: checkoutForm.phoneNumber,
          checkedIn: false,
          note: 'New M-PESA booking',
        },
        ...prev,
      ])
      showToast('Payment successful! Digital pass generated.')
    } catch (error) {
      showToast(error.message || 'Payment confirmation failed.')
      setCheckoutStep('form')
    }
  }

  const handleEventImageChange = (event) => {
    const files = Array.from(event.target.files || [])
    const readableFiles = files.filter((file) => file instanceof File)

    if (!readableFiles.length) return

    Promise.all(
      readableFiles.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ''))
            reader.onerror = () => reject(new Error('Unable to read the selected image.'))
            reader.readAsDataURL(file)
          }),
      ),
    )
      .then((imageDataUrls) => {
        setUploadedEventImages((prev) => [...prev, ...imageDataUrls.filter(Boolean)])
        event.target.value = ''
      })
      .catch(() => {
        showToast('One or more selected images could not be processed.')
      })
  }

  const handleRemoveUploadedImage = (indexToRemove) => {
    setUploadedEventImages((prev) => prev.filter((_, index) => index !== indexToRemove))
  }

  const clearUploadedEventImages = () => {
    setUploadedEventImages([])
  }

  const addInclusion = (value) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSelectedInclusions((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
  }

  const addChecklistItem = (value) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSelectedChecklistItems((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
  }

  const handleCreateHikeSubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    form.noValidate = true

    const title = (form.newTitle?.value || '').trim()
    const countyValue = selectedCounty?.name || 'Nairobi'
    const countyId = Number(selectedCounty?.id || 47)
    const difficultyValue = form.newDifficulty?.value || 'Moderate'
    const date = form.newDate?.value || ''
    const distance = (form.newDistance?.value || '').trim()
    const elevation = (form.newElevation?.value || '').trim()
    const earlyPrice = Number(form.newPriceEarly?.value || 0)
    const standardPrice = Number(form.newPriceStd?.value || 0)
    const pickup = (form.newPickup?.value || '').trim()
    const pickupTime = (form.newPickupTime?.value || '').trim()
    const googleMapUrl = (form.newMapUrl?.value || '').trim()
    const description = (form.newDesc?.value || '').trim()
    const summary = description || title || 'Exciting hike with Twende Hike Kenya'
    const maxTickets = Number(form.newMaxTickets?.value || 0)
    const publicHostName = (form.newHostName?.value || '').trim() || 'Kenyan Explorer'
    const organizerPhone = (form.newOrganizerPhone?.value || '').trim()
    const organizerEmail = (form.newOrganizerEmail?.value || '').trim()
    const additionalTicketsNeeded = Number(form.newAdditionalTickets?.value || 0)
    const customPackageName = (form.newCustomPackageName?.value || '').trim()
    const customPackagePrice = Number(form.newCustomPackagePrice?.value || 0)
    const customPackageNote = (form.newCustomPackageNote?.value || '').trim()

    if (!title || !date || !pickup || !countyValue || !countyId) {
      showToast('Please add the expedition title, county, date, and pickup point before submitting.')
      return
    }

    if (!maxTickets || maxTickets < 1) {
      showToast('Maximum tickets are required before publishing a hike.')
      return
    }

    if (!Number.isFinite(earlyPrice) || earlyPrice < 0 || !Number.isFinite(standardPrice) || standardPrice < 0) {
      showToast('Please enter valid early bird and standard prices before submitting.')
      return
    }

    const selectedPhotos = uploadedEventImages
    const customTiers = [
      { name: 'Early Bird', price: earlyPrice, note: 'Promo' },
      { name: 'Standard Hiker', price: standardPrice, active: true },
    ]

    if (customPackageName && customPackagePrice > 0) {
      customTiers.push({ name: customPackageName, price: customPackagePrice, note: customPackageNote || 'Custom itinerary package', active: false })
    }

    const newHike = {
      title,
      tag: 'prep',
      county: countyValue,
      difficulty: difficultyValue,
      distance,
      elevation,
      duration: '7 - 8 Hours',
      departure: '5:30 AM Nairobi',
      pickup,
      meetingPoint: pickup,
      pickupTime: pickupTime || '05:30 AM',
      googleMapUrl,
      date,
      image: selectedPhotos[0] || DEFAULT_EVENT_IMAGE,
      photos: selectedPhotos,
      organizer: publicHostName,
      organizerName: publicHostName,
      organizerPhone,
      organizerEmail,
      organizerRating: 4.9,
      interestCount: 0,
      visibleName: true,
      verified: false,
      description: description || summary || title || 'Exciting hike with Twende Hike Kenya',
      inclusions: selectedInclusions.length ? selectedInclusions : DEFAULT_INCLUSIONS,
      gear: selectedChecklistItems.length ? selectedChecklistItems : DEFAULT_CHECKLIST,
      tiers: customTiers,
      maxTickets,
      soldTickets: 0,
      totalRatings: 0,
      status: 'pending_approval',
    }

    let storedEvent = { ...newHike }
    try {
      const createResponse = await api.createEvent({
        title: String(title || '').trim() || 'Untitled Hike',
        summary: String(summary || '').trim() || 'Exciting hike with Twende Hike Kenya',
        description: String(description || summary || '').trim() || 'Exciting hike with Twende Hike Kenya',
        countyId,
        countyName: countyValue,
        locationText: pickup,
        meetingPoint: pickup,
        pickupTime: pickupTime || '05:30 AM',
        googleMapUrl,
        inclusions: selectedInclusions,
        eventDate: date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        startTime: '05:30:00',
        endTime: '13:00:00',
        price: Number(standardPrice) || 0,
        capacity: Number(maxTickets) || 30,
        status: 'pending_approval',
        organizerName: publicHostName,
        organizerPhone,
        organizerEmail,
        images: uploadedEventImages,
        tiers: customTiers,
      })

      const createdEvent = createResponse?.data || createResponse
      if (!createdEvent || !createdEvent.id) {
        throw new Error(createResponse?.message || 'The server did not return a valid hike ID.')
      }

      storedEvent = { ...newHike, ...createdEvent, id: createdEvent.id, status: 'pending_approval' }
    } catch (error) {
      showToast(error.message || 'Unable to save this hike to the database.')
      return
    }

    setPendingHikes((prev) => [storedEvent, ...prev])
    if (additionalTicketsNeeded > 0) {
      setTicketRequests((prev) => [{
        id: `req-${Date.now()}`,
        title,
        organizer: publicHostName,
        requested: additionalTicketsNeeded,
        status: 'pending',
      }, ...prev])
    }
    setCreateModalOpen(false)
    setUploadedEventImages([])
    setSelectedInclusions(DEFAULT_INCLUSIONS.slice(0, 3))
    setSelectedChecklistItems(DEFAULT_CHECKLIST.slice(0, 3))
    form.reset()
    showToast('Form submitted! Awaiting approval.')
  }

  const approveHikeListing = async (index) => {
    const approved = pendingHikes[index]
    if (!approved) return

    const validEventId = typeof approved.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approved.id)
    if (!validEventId) {
      showToast('This hike has no valid database ID. Save it again before approving.')
      return
    }

    try {
      const reviewResponse = await api.reviewEvent(approved.id, { decision: 'approved', notes: 'Approved by superadmin' })
      const persistedEvent = reviewResponse?.data || reviewResponse
      if (persistedEvent?.id) {
        approved.id = persistedEvent.id
      }
    } catch (error) {
      showToast(error.message || 'Unable to approve this hike in the database.')
      return
    }

    const normalized = normalizeEvent({ ...approved, status: 'published', organizerName: approved.organizerName || approved.organizer }, 0)

    setApprovedHikes((prev) => {
      const nextApproved = [normalized, ...prev.filter((item) => item.id !== normalized.id)]
      persistMarketplaceState(
        sortHikes([normalized, ...hikes.filter((item) => item.id !== normalized.id)]),
        nextApproved,
      )
      return nextApproved
    })
    setHikes((prev) => {
      const nextHikes = sortHikes([normalized, ...prev.filter((item) => item.id !== normalized.id)])
      persistMarketplaceState(nextHikes, [normalized, ...approvedHikes.filter((item) => item.id !== normalized.id)])
      return nextHikes
    })
    setPendingHikes((prev) => prev.filter((_, i) => i !== index))
    showToast(`${approved.title} approved and published to the marketplace.`)
  }

  const approveOrganizerRequest = (index) => {
    const request = organizerRequests[index]
    if (!request) return

    const generatedPassword = generateOrganizerPassword(request.name, request.email, request.phone)
    const approvedHost = {
      id: `host-approved-${Date.now()}`,
      name: request.organization || request.name,
      email: request.email,
      phone: request.phone,
      password: generatedPassword,
      visibleName: true,
    }

    setApprovedOrganizers((prev) => [approvedHost, ...prev])
    setOrganizerRequests((prev) => prev.filter((_, i) => i !== index))
    showToast(`Host approved. Credentials sent to ${request.email} and ${request.phone}. Password: ${generatedPassword}`)
  }

  const handleHostRequestSubmit = (event) => {
    event.preventDefault()

    if (!organizerRequestForm.name || !organizerRequestForm.email || !organizerRequestForm.phone) {
      showToast('Name, email, and phone number are required for host verification.')
      return
    }

    const payload = {
      id: `host-req-${Date.now()}`,
      name: organizerRequestForm.name,
      email: organizerRequestForm.email,
      phone: organizerRequestForm.phone,
      organization: organizerRequestForm.organization || 'Independent Host',
      status: 'pending',
    }

    setOrganizerRequests((prev) => [payload, ...prev])
    setOrganizerRequestForm({ name: '', email: '', phone: '', organization: '' })
    showToast('Host request submitted for admin approval.')
  }

  const rejectHikeListing = (index) => {
    const rejected = pendingHikes[index]
    setPendingHikes((prev) => prev.filter((_, i) => i !== index))
    showToast(`Listing '${rejected.title}' was rejected.`)
  }

  const deleteEventFromAdmin = async (target) => {
    if (!target) return
    if (!target.id) {
      showToast('This hike has no database ID and cannot be deleted.')
      return
    }

    try {
      const response = await api.deleteEvent(target.id)
      if (!response?.success) {
        throw new Error(response?.message || 'The event was not deleted.')
      }
      setHikes((prev) => prev.filter((item) => item.id !== target.id))
      setApprovedHikes((prev) => prev.filter((item) => item.id !== target.id))
      setPendingHikes((prev) => prev.filter((item) => item.id !== target.id))
      setRemovedHikes((prev) => prev.filter((item) => item.id !== target.id))
      setCompletedHikes((prev) => prev.filter((item) => item.id !== target.id))
      showToast(`${target.title} was permanently deleted.`)
    } catch (error) {
      showToast(error.message || 'Unable to delete this hike.')
    }
  }

  const removeApprovedHike = (index, fromRemoved = false) => {
    const target = fromRemoved ? removedHikes[index] : (approvedHikes[index] || hikes[index])
    if (!target) return

    if (!fromRemoved) {
      setRemovedHikes((prev) => [target, ...prev])
      setApprovedHikes((prev) => prev.filter((_, idx) => idx !== index))
      setHikes((prev) => prev.filter((item) => item.id !== target.id))
    } else {
      setRemovedHikes((prev) => prev.filter((_, idx) => idx !== index))
    }
    showToast(`${target.title} moved to the removed hikes list.`)
  }

  const completeApprovedHike = (index) => {
    const target = approvedHikes[index] || hikes[index]
    if (!target) return

    setCompletedHikes((prev) => [target, ...prev])
    setApprovedHikes((prev) => prev.filter((_, idx) => idx !== index))
    setHikes((prev) => prev.filter((item) => item.id !== target.id))
    showToast(`${target.title} marked complete.`)
  }

  const permanentlyDeleteHike = (index, listType = 'removed') => {
    if (listType === 'removed') {
      const target = removedHikes[index]
      deleteEventFromAdmin(target)
      return
    }

    const target = completedHikes[index]
    deleteEventFromAdmin(target)
  }

  const organizerPayoutSummary = useMemo(() => {
    const collection = approvedHikes.reduce((total, hike) => {
      const minTierPrice = Math.min(...(hike.tiers || []).map((tier) => Number(tier.price || 0)))
      const hikeCollection = Number(hike.soldTickets || 0) * (Number.isFinite(minTierPrice) ? minTierPrice : 0)
      return total + hikeCollection
    }, 0)

    const companyFee = collection * 0.1
    const organizerPayout = collection - companyFee

    return {
      collection,
      companyFee,
      organizerPayout,
    }
  }, [approvedHikes])

  const toggleHikerCheckIn = (index) => {
    setOrganizerManifest((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex === index) {
          return { ...item, checkedIn: !item.checkedIn }
        }
        return item
      }),
    )
  }

  const handleOrganizerLogin = (event) => {
    event.preventDefault()

    const match = approvedOrganizers.find(
      (organizer) => organizer.email.toLowerCase() === organizerLogin.email.toLowerCase() && organizer.password === organizerLogin.password,
    )

    if (!match) {
      showToast('Invalid organizer email or password.')
      return
    }

    setOrganizerSession(match)
    showToast(`Welcome back, ${match.name}.`)
  }

  const showPass = (booking) => {
    openTicketModal(booking)
  }

  const handleInterestClick = async (hikeId) => {
    try {
      const response = await api.likeEvent(hikeId, { clientKey: getClientLikeKey() })
      const result = response?.data || response
      const hasLiked = Boolean(result?.hasLiked)
      const likesCount = Number(result?.likesCount ?? 0)

      setLikedHikes((prev) => {
        const next = hasLiked ? [...new Set([...prev, hikeId])] : prev.filter((item) => item !== hikeId)
        if (typeof window !== 'undefined') {
          localStorage.setItem('twendehike_liked_hikes', JSON.stringify(next))
        }
        return next
      })

      setHikes((prev) =>
        prev.map((item) =>
          item.id === hikeId
            ? { ...item, interestCount: likesCount, likesCount, totalRatings: likesCount }
            : item,
        ),
      )

      showToast(hasLiked ? 'Thanks! You marked this expedition as interesting.' : 'Your like was removed.')
    } catch (error) {
      showToast(error.message || 'Unable to update the expedition like.')
    }
  }

  const submitOrganizerRating = (booking, rating) => {
    const hike = hikes.find((item) => item.id === booking.hikeId) || { organizerName: booking.hikeTitle }
    const organizerKey = hike.organizerName || booking.hikeTitle
    const previous = organizerRatings[organizerKey] || { total: 0, count: 0 }
    const nextTotal = previous.total + Number(rating)
    const nextCount = previous.count + 1
    const nextAverage = nextTotal / nextCount

    setOrganizerRatings((prev) => ({ ...prev, [organizerKey]: { total: nextTotal, count: nextCount, average: nextAverage } }))
    setHikes((prev) =>
      prev.map((item) =>
        item.id === booking.hikeId
          ? { ...item, organizerRating: Number(nextAverage.toFixed(1)), totalRatings: nextCount }
          : item,
      ),
    )
    setTicketModal(null)
    showToast('Thanks for rating the organizer.')
  }

  const downloadTicket = async (booking) => {
    try {
      const blob = await api.downloadTicketPdf(booking.bookingId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `ticket-${booking.bookingId}.pdf`
      link.click()
      URL.revokeObjectURL(url)
      showToast(`Ticket ${booking.bookingId} downloaded.`)
    } catch (error) {
      showToast(error.message || 'Unable to download ticket.')
    }
  }

  const handleAdminLogin = async (event) => {
    event.preventDefault()

    try {
      const loginResult = await api.login(adminCredentials.email, adminCredentials.password)
      const user = loginResult?.data?.user

      if (!user || user.role !== 'super_admin') {
        throw new Error('This account is not authorized for the platform admin portal.')
      }

      saveSession(loginResult)
      setAuthUser(user)
      setAdminProfileForm({ firstName: user.firstName || '', lastName: user.lastName || '' })
      setActiveView('admin')
      closeAdminLogin()
      setAdminMessage('')
      showToast('Admin access granted.')
    } catch (error) {
      setAdminMessage(error.message || 'Unable to access admin portal.')
    }
  }

  const handleAdminPasswordReset = async (event) => {
    event.preventDefault()

    if (!authUser || authUser.role !== 'super_admin') {
      setAdminMessage('Session expired. Please log in again as the superadmin.')
      clearSession()
      setAuthUser(null)
      openAdminLogin()
      return
    }

    if (!adminPasswordForm.currentPassword || !adminPasswordForm.newPassword) {
      setAdminMessage('Current and new passwords are required.')
      return
    }

    if (adminPasswordForm.newPassword !== adminPasswordForm.confirmPassword) {
      setAdminMessage('New password confirmation does not match.')
      return
    }

    try {
      await api.resetAdminPassword({
        currentPassword: adminPasswordForm.currentPassword,
        newPassword: adminPasswordForm.newPassword,
      })

      setAdminPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setAdminMessage('Superadmin password updated successfully.')
      showToast('Superadmin password reset complete.')
    } catch (error) {
      setAdminMessage(error.message || 'Unable to reset the superadmin password.')
    }
  }

  const handleAdminProfileUpdate = async (event) => {
    event.preventDefault()

    try {
      const response = await api.updateAdminProfile(adminProfileForm)
      const updatedUser = response?.data?.user
      if (!response?.success || !updatedUser) {
        throw new Error(response?.message || 'Unable to update admin name.')
      }

      setAuthUser(updatedUser)
      saveSession({ data: { user: updatedUser } })
      setAdminMessage('Superadmin name updated successfully.')
      showToast('Superadmin name updated.')
    } catch (error) {
      setAdminMessage(error.message || 'Unable to update admin name.')
    }
  }

  const handleHeroSettingsUpdate = async (event) => {
    event.preventDefault()

    try {
      const response = await api.updateHeroSettings({
        title: heroSettingsForm.heroHeadline,
        subtitle: heroSettingsForm.heroSubtitle,
        badge: heroSettingsForm.heroBadge,
        bg_image: heroSettingsForm.heroImageUrl,
        bg_color: heroSettingsForm.heroOverlayColor,
      })
      const updatedSettings = response?.data
      if (!response?.success || !updatedSettings) {
        throw new Error(response?.message || 'Unable to update hero settings.')
      }
      const nextSettings = {
        ...DEFAULT_HERO_SETTINGS,
        heroHeadline: updatedSettings.title || DEFAULT_HERO_SETTINGS.heroHeadline,
        heroSubtitle: updatedSettings.subtitle || DEFAULT_HERO_SETTINGS.heroSubtitle,
        heroBadge: updatedSettings.badge || DEFAULT_HERO_SETTINGS.heroBadge,
        heroImageUrl: updatedSettings.bg_image || '',
        heroOverlayColor: updatedSettings.bg_color || DEFAULT_HERO_SETTINGS.heroOverlayColor,
      }
      setHeroSettings(nextSettings)
      setHeroSettingsForm(nextSettings)
      showToast('Hero banner settings updated.')
    } catch (error) {
      setAdminMessage(error.message || 'Unable to update hero settings.')
    }
  }

  const renderDifficultyBadge = (difficultyLevel) => {
    const palette = {
      Easy: 'bg-emerald-100 text-emerald-900',
      Moderate: 'bg-amber-100 text-amber-900',
      Challenging: 'bg-orange-100 text-orange-900',
      Extreme: 'bg-red-100 text-red-900',
    }
    return palette[difficultyLevel] || 'bg-stone-200 text-stone-800'
  }

  if (authLoading) {
    return <div className="app-shell"><div className="empty-state"><h4>Loading marketplace...</h4></div></div>
  }

  return (
    <div className={`app-shell ${darkMode ? 'theme-dark' : ''}`}>
      <header className="topbar">
        <div className="brand-wrap" onClick={() => setActiveView('discover')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setActiveView('discover')}>
          <div className="brand-mark">T</div>
          <div className="brand-copy">
            <span className="brand-name">TWENDE<span className="brand-accent">HIKE</span></span>
            <span className="brand-sub">Kenya Trail Adventures</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          {[
            { id: 'discover', label: 'Explore Trails' },
            { id: 'hiker-hub', label: 'My Hikes & Passes' },
            { id: 'organizer', label: 'Organizer Studio' },
            ...(authUser?.role === 'super_admin' ? [{ id: 'admin', label: 'Platform Admin' }] : []),
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-button ${activeView === item.id ? 'active' : ''}`}
              onClick={() => {
                if (item.id === 'admin' && (!authUser || authUser.role !== 'super_admin')) {
                  openAdminLogin()
                  return
                }
                setActiveView(item.id)
              }}
            >
              <span>{item.label}</span>
              {item.id === 'hiker-hub' && userBookings.length > 0 && <span className="nav-badge">{userBookings.length}</span>}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <button type="button" className="ghost-btn small header-theme-toggle" onClick={() => setDarkMode((value) => !value)} aria-label={darkMode ? 'Use light theme' : 'Use dark theme'}>
            <span className="theme-icon" aria-hidden="true">{darkMode ? '☀' : '☾'}</span>
            <span className="theme-label">{darkMode ? 'Light Theme' : 'Dark Theme'}</span>
          </button>
          {authUser?.role === 'super_admin' ? (
            <button type="button" className="ghost-btn small" onClick={logout}>
              Logout
            </button>
          ) : (
            <button type="button" className="ghost-btn small" onClick={openAdminLogin}>
              Admin Access
            </button>
          )}
          <div className="instant-tag">Instant M-PESA STK Push</div>
          <button type="button" className="primary-btn small header-host-button" onClick={openCreateModal}>
            Host a Hike
          </button>
          <button type="button" className="mobile-menu-toggle" onClick={() => {
            if (mobileMenuOpen) {
              setMobileMenuOpen(false)
              closeOverlayHistory()
            } else {
              pushOverlayHistory()
              setMobileMenuOpen(true)
            }
          }} aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen}>
            {mobileMenuOpen ? '×' : '☰'}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-menu-backdrop" onClick={() => { setMobileMenuOpen(false); closeOverlayHistory() }}>
          <div className="mobile-menu-sheet" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="mobile-menu-close" onClick={() => { setMobileMenuOpen(false); closeOverlayHistory() }} aria-label="Close menu">×</button>
            <button type="button" onClick={() => { setActiveView('hiker-hub'); setMobileMenuOpen(false); closeOverlayHistory() }}>My Hikes &amp; Passes</button>
            <button type="button" onClick={() => { setActiveView('organizer'); setMobileMenuOpen(false); closeOverlayHistory() }}>Organizer Studio</button>
            <button type="button" onClick={() => { setMobileMenuOpen(false); openAdminLogin() }}>Admin Access</button>
            <button type="button" onClick={() => { setMobileMenuOpen(false); openCreateModal() }}>Host a Hike</button>
          </div>
        </div>
      )}

      <main className="content-area">
        {activeView === 'discover' && (
          <section className="discover-view">
            <div
              className="hero-banner"
              style={heroSettings.heroImageUrl ? {
                backgroundImage: `linear-gradient(90deg, ${heroSettings.heroOverlayColor || DEFAULT_HERO_SETTINGS.heroOverlayColor} 0%, rgba(6, 45, 31, 0.45) 62%, rgba(6, 45, 31, 0.15) 100%), url(${heroSettings.heroImageUrl})`,
              } : undefined}
            >
              <div className="hero-content">
                <div className="hero-pill">{heroSettings.heroBadge || DEFAULT_HERO_SETTINGS.heroBadge}</div>
                <h1>{heroSettings.heroHeadline || DEFAULT_HERO_SETTINGS.heroHeadline}</h1>
                <p>
                  {heroSettings.heroSubtitle || DEFAULT_HERO_SETTINGS.heroSubtitle}
                </p>

                <div className="tag-row filter-pills-container">
                  {['all', 'beginner', 'aberdares', 'prep', 'nairobi'].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-pill ${activeTag === tag ? 'selected' : ''}`}
                      onClick={() => setActiveTag(tag)}
                    >
                      {tag === 'all' && 'All Trails'}
                      {tag === 'beginner' && '🌿 Beginner Friendly'}
                      {tag === 'aberdares' && '🏔️ Aberdares Hardcore'}
                      {tag === 'prep' && '🧗 Mt. Kenya Prep'}
                      {tag === 'nairobi' && '📍 Near Nairobi (<90min)'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="search-panel">
              <div className="field-box">
                <label>Search</label>
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search trail, e.g. 'Elephant Hill'"
                />
              </div>

              <div className="field-box">
                <label>Difficulty</label>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="all">All Difficulty Levels</option>
                  <option value="Easy">Easy</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Challenging">Challenging</option>
                  <option value="Extreme">Extreme</option>
                </select>
              </div>

              <div className="field-box county-field-box">
                <label>County</label>
                <div className="county-input-wrap">
                  <input
                    value={countyInput}
                    onFocus={() => {
                      setCountyMenuOpen(true)
                      setCountyDisplayLimit(5)
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setCountyMenuOpen(false), 120)
                    }}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      setCountyInput(nextValue)
                      setCounty(nextValue.trim() && nextValue.toLowerCase() !== 'all locations' ? nextValue : 'all')
                      setCountyMenuOpen(true)
                      setCountyDisplayLimit(5)
                    }}
                    placeholder="All Locations"
                  />

                  {countyMenuOpen && (
                    <div className="county-suggestions">
                      <button
                        type="button"
                        className={`county-option ${county === 'all' ? 'selected' : ''}`}
                        onMouseDown={() => {
                          setCounty('all')
                          setCountyInput('All Locations')
                          setCountyMenuOpen(false)
                          setCountyDisplayLimit(5)
                        }}
                      >
                        All Locations
                      </button>

                      {visibleCountySuggestions.map((countyName) => (
                        <button
                          key={countyName}
                          type="button"
                          className={`county-option ${county === countyName ? 'selected' : ''}`}
                          onMouseDown={() => {
                            setCounty(countyName)
                            setCountyInput(countyName)
                            setCountyMenuOpen(false)
                            setCountyDisplayLimit(5)
                          }}
                        >
                          {countyName}
                        </button>
                      ))}

                      {countySuggestions.length > visibleCountySuggestions.length && (
                        <button
                          type="button"
                          className="county-show-more"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            setCountyDisplayLimit((previous) => previous + 5)
                          }}
                        >
                          Show more
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="field-box price-box">
                <label>Max price</label>
                <div className="range-wrap">
                  <input
                    type="range"
                    min="0"
                    max="15000"
                    step="500"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min="0"
                    max="15000"
                    step="500"
                    value={maxPrice}
                    onChange={(e) => {
                      const next = Number(e.target.value || 0)
                      setMaxPrice(Math.min(15000, Math.max(0, next)))
                    }}
                    className="price-input"
                  />
                  <span className="range-label">
                    {maxPrice >= 15000 ? 'KES 15000+' : `KES ${maxPrice.toLocaleString()}`}
                  </span>
                </div>
              </div>
            </div>

            <div className="toolbar-row">
              <span>
                Showing <strong>{filteredHikes.length}</strong> planned expeditions
              </span>
              <div className="toggle-group">
                <button type="button" className={`toggle-btn ${mapMode === 'grid' ? 'active' : ''}`} onClick={() => setMapMode('grid')}>
                  Grid
                </button>
                <button type="button" className={`toggle-btn ${mapMode === 'map' ? 'active' : ''}`} onClick={() => setMapMode('map')}>
                  Trail Map
                </button>
              </div>
            </div>

            {mapMode === 'map' && (
              <div className="map-panel">
                <div className="map-head">
                  <div>
                    <h3>Interactive Kenyan Trail Map</h3>
                    <p>Tap pins to preview meeting time, altitude, and book direct.</p>
                  </div>
                  <span className="map-pill">Live GPS Coordinates</span>
                </div>
                <div className="map-surface">
                  {filteredHikes.map((hike) => (
                    <div
                      key={hike.id}
                      className="map-pin"
                      style={{ left: `${(hike.id.length * 13) % 75}%`, top: `${(hike.id.length * 17) % 62}%` }}
                      onClick={() => openEventModal(hike)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && openEventModal(hike)}
                    >
                      <span>{hike.county}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card-grid">
              {filteredHikes.length === 0 ? (
                <div className="empty-state">
                  <h4>No expeditions found</h4>
                  <p>Try relaxing your search criteria or reset the filters.</p>
                  <button type="button" className="secondary-btn" onClick={resetFilters}>Reset Filters</button>
                </div>
              ) : (
                filteredHikes.map((hike) => {
                  const displayTier = getEffectiveTier(hike)
                  const displayPrice = Number(displayTier?.price || 0)
                  return (
                    <article className="hike-card" key={hike.id}>
                      <div className="card-image-wrap" style={{ backgroundImage: `url(${hike.image})` }}>
                        <div className="card-badges">
                          <span className={`badge-chip ${renderDifficultyBadge(hike.difficulty)}`}>{hike.difficulty}</span>
                          <span className="badge-chip light">📍 {hike.county}</span>
                        </div>
                        <button
                          type="button"
                          className={`card-rating ${likedHikes.includes(hike.id) ? 'liked' : ''}`}
                          onClick={() => handleInterestClick(hike.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              handleInterestClick(hike.id)
                            }
                          }}
                          title="Mark this expedition as interesting"
                          aria-label={`Mark ${hike.title} as interesting`}
                        >
                          ♥ {Number(hike.interestCount || 0)}
                        </button>
                      </div>

                      <div className="card-body">
                        <div className="card-meta-line">
                          <span>By {hike.organizer}</span>
                          {hike.verified && <span className="verified-dot">✓</span>}
                        </div>
                        <h3>{hike.title}</h3>
                        <p className="card-description">{hike.description}</p>

                        <div className="three-stats">
                          <div>
                            <span>Distance</span>
                            <strong>{hike.distance}</strong>
                          </div>
                          <div>
                            <span>Altitude</span>
                            <strong>{hike.elevation}</strong>
                          </div>
                          <div>
                            <span>Duration</span>
                            <strong>{hike.duration}</strong>
                          </div>
                        </div>

                        <div className="card-footer">
                          <div>
                            <small>{displayTier.name}</small>
                            <strong>KES {displayPrice.toLocaleString()}</strong>
                          </div>
                          <button type="button" className="primary-btn small" onClick={() => openEventModal(hike)}>
                            Details
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        )}

        {activeView === 'hiker-hub' && (
          <section className="hub-view">
            {!hikerSession ? (
              <div className="profile-panel">
                <div className="profile-header">
                  <div className="profile-avatar">H</div>
                  <div>
                    <h2>Private Hiker Access</h2>
                    <p>Create an account or sign in to keep your tickets and contact details private.</p>
                  </div>
                </div>

                <div className="auth-tabs">
                  <button type="button" className={`tab-btn ${hikerAuthMode === 'login' ? 'active' : ''}`} onClick={() => setHikerAuthMode('login')}>Log In</button>
                  <button type="button" className={`tab-btn ${hikerAuthMode === 'signup' ? 'active' : ''}`} onClick={() => setHikerAuthMode('signup')}>Create Account</button>
                </div>

                <form onSubmit={handleHikerAuthSubmit} className="profile-form">
                  {hikerAuthMode === 'signup' && (
                    <>
                      <div className="field-group">
                        <label>Full Name</label>
                        <input
                          value={hikerAuthForm.name}
                          onChange={(event) => setHikerAuthForm((prev) => ({ ...prev, name: event.target.value }))}
                          placeholder="Your full name"
                          required
                        />
                      </div>
                      <div className="field-group">
                        <label>Phone Number</label>
                        <input
                          value={hikerAuthForm.phone}
                          onChange={(event) => setHikerAuthForm((prev) => ({ ...prev, phone: event.target.value }))}
                          placeholder="+2547..."
                          required
                        />
                      </div>
                    </>
                  )}

                  <div className="field-group">
                    <label>Email Address</label>
                    <input
                      type="email"
                      value={hikerAuthForm.email}
                      onChange={(event) => setHikerAuthForm((prev) => ({ ...prev, email: event.target.value }))}
                      placeholder="you@example.com"
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label>Password</label>
                    <input
                      type="password"
                      value={hikerAuthForm.password}
                      onChange={(event) => setHikerAuthForm((prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="Create a password"
                      required
                    />
                  </div>

                  {hikerAuthMode === 'signup' && (
                    <div className="field-group">
                      <label>Confirm Password</label>
                      <input
                        type="password"
                        value={hikerAuthForm.confirmPassword}
                        onChange={(event) => setHikerAuthForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                        placeholder="Repeat your password"
                      />
                    </div>
                  )}

                  {hikerAuthError && <p className="admin-message">{hikerAuthError}</p>}

                  <button type="submit" className="primary-btn small">
                    {hikerAuthMode === 'login' ? 'Access My Passes' : 'Create Private Account'}
                  </button>
                </form>
              </div>
            ) : (
              <>
                <div className="profile-panel">
                  <div className="profile-header">
                    <div className="profile-avatar">{(hikerProfile.fullName || 'WK').split(' ').slice(0, 2).map((value) => value[0]).join('').toUpperCase()}</div>
                    <div>
                      <h2>{hikerProfile.fullName || 'Hiker'}</h2>
                      <p>Private hiker profile • {hikerSession.email}</p>
                    </div>
                  </div>

                  <div className="profile-summary">
                    <div>
                      <span>Saved Phone</span>
                      <strong>{hikerProfile.phoneNumber || '+254712345678'}</strong>
                    </div>
                    <div>
                      <span>Booked Hikes</span>
                      <strong>{userBookings.length}</strong>
                    </div>
                  </div>

                  <form onSubmit={saveHikerProfile} className="profile-form">
                    <div className="split-fields">
                      <div className="field-group">
                        <label>Full Name</label>
                        <input
                          value={profileDraft.fullName || ''}
                          onChange={(event) => setProfileDraft((prev) => ({ ...prev, fullName: event.target.value }))}
                          placeholder="Your full name"
                        />
                      </div>
                      <div className="field-group">
                        <label>Phone Number</label>
                        <input
                          value={profileDraft.phoneNumber || ''}
                          onChange={(event) => setProfileDraft((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                          placeholder="+2547..."
                        />
                      </div>
                    </div>
                    <div className="field-group">
                      <label>Emergency Contact</label>
                      <input
                        value={profileDraft.emergencyContact || ''}
                        onChange={(event) => setProfileDraft((prev) => ({ ...prev, emergencyContact: event.target.value }))}
                        placeholder="0712..."
                      />
                    </div>
                    <div className="create-actions">
                      <button type="submit" className="primary-btn small">Save Profile</button>
                      <button type="button" className="ghost-btn small" onClick={logoutHiker}>Logout</button>
                    </div>
                  </form>
                </div>

                <div className="tickets-wrap">
                  <h3>Active Upcoming Expedition Passes</h3>
                  {userBookings.length === 0 ? (
                    <div className="empty-state narrow">
                      <h4>No passes yet</h4>
                      <p>Book a hike from the marketplace to generate your ticket.</p>
                    </div>
                  ) : (
                    userBookings.map((booking) => (
                      <div key={booking.bookingId} className="ticket-card">
                        <div className="ticket-topline">
                          <span className="status-pill">{booking.status}</span>
                          <span className="ticket-ref">M-PESA REF: {booking.mpesaRef}</span>
                        </div>
                        <h4>{booking.hikeTitle}</h4>

                        <div className="ticket-grid">
                          <div>
                            <span>Date</span>
                            <strong>{booking.date}</strong>
                          </div>
                          <div>
                            <span>Location</span>
                            <strong>{booking.county || 'Kenya'}</strong>
                          </div>
                          <div>
                            <span>Distance</span>
                            <strong>{booking.distance || 'N/A'}</strong>
                          </div>
                          <div>
                            <span>Pickup</span>
                            <strong>{booking.pickup}</strong>
                          </div>
                        </div>

                        <div className="ticket-actions">
                          <button type="button" className="primary-btn small" onClick={() => showPass(booking)}>
                            Show Digital Pass
                          </button>
                          <button type="button" className="ghost-btn" onClick={() => downloadTicket(booking)}>
                            Download
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {activeView === 'organizer' && (
          <section className="organizer-view">
            {!organizerSession ? (
              <div className="organizer-login-card">
                <h3>Organizer Studio Login</h3>
                <p>Use the approved organizer email and password generated after superadmin approval.</p>
                <form onSubmit={handleOrganizerLogin} className="create-form compact-form">
                  <div className="field-group">
                    <label>Organizer Email</label>
                    <input
                      type="email"
                      value={organizerLogin.email}
                      onChange={(event) => setOrganizerLogin((prev) => ({ ...prev, email: event.target.value }))}
                      placeholder="organizer@yourcompany.co.ke"
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>Password</label>
                    <input
                      type="password"
                      value={organizerLogin.password}
                      onChange={(event) => setOrganizerLogin((prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="Generated organizer password"
                      required
                    />
                  </div>
                  <div className="create-actions">
                    <button type="submit" className="primary-btn small">Login to Studio</button>
                  </div>
                </form>
              </div>
            ) : (
              <>
                <div className="organizer-banner">
                  <div>
                    <span className="verified-badge">Verified Trail Host • Safaricom B2C Integrated</span>
                    <h2>{organizerSession.name}</h2>
                    <p>Lead Captain: {organizerSession.name} • {organizerSession.email}</p>
                  </div>
                  <div className="organizer-actions">
                    <button type="button" className="primary-btn small" onClick={openCreateModal}>
                      List New Expedition
                    </button>
                    <button type="button" className="secondary-btn small" onClick={() => showToast('Payout request submitted.')}>Request M-PESA Payout</button>
                    <button type="button" className="ghost-btn small" onClick={() => setOrganizerSession(null)}>Logout</button>
                  </div>
                </div>

                <div className="stats-grid">
                  <div className="mini-stat-card">
                    <span>Gross Collections</span>
                    <strong>KES {organizerPayoutSummary.collection.toLocaleString()}</strong>
                  </div>
                  <div className="mini-stat-card">
                    <span>Platform Commission (10%)</span>
                    <strong>KES {organizerPayoutSummary.companyFee.toLocaleString()}</strong>
                  </div>
                  <div className="mini-stat-card">
                    <span>Net Payout</span>
                    <strong>KES {organizerPayoutSummary.organizerPayout.toLocaleString()}</strong>
                  </div>
                  <div className="mini-stat-card">
                    <span>Confirmed Hikers</span>
                    <strong>{organizerManifest.length} Hikers</strong>
                  </div>
                </div>

                <div className="organizer-panel">
                  <h3>Host Event Request</h3>
                  <form onSubmit={handleHostRequestSubmit} className="create-form compact-form">
                    <div className="split-fields">
                      <div className="field-group">
                        <label>Host Name</label>
                        <input
                          value={organizerRequestForm.name}
                          onChange={(event) => setOrganizerRequestForm((prev) => ({ ...prev, name: event.target.value }))}
                          placeholder="e.g. Peter Mwangi"
                          required
                        />
                      </div>
                      <div className="field-group">
                        <label>Business / Team</label>
                        <input
                          value={organizerRequestForm.organization}
                          onChange={(event) => setOrganizerRequestForm((prev) => ({ ...prev, organization: event.target.value }))}
                          placeholder="Great Rift Adventures"
                        />
                      </div>
                    </div>

                    <div className="split-fields">
                      <div className="field-group">
                        <label>Email Address</label>
                        <input
                          type="email"
                          value={organizerRequestForm.email}
                          onChange={(event) => setOrganizerRequestForm((prev) => ({ ...prev, email: event.target.value }))}
                          placeholder="organizer@example.com"
                          required
                        />
                      </div>
                      <div className="field-group">
                        <label>Phone Number</label>
                        <input
                          type="tel"
                          value={organizerRequestForm.phone}
                          onChange={(event) => setOrganizerRequestForm((prev) => ({ ...prev, phone: event.target.value }))}
                          placeholder="+254712345678"
                          required
                        />
                      </div>
                    </div>

                    <div className="create-actions">
                      <button type="submit" className="primary-btn small">Submit Organizer Request</button>
                    </div>
                  </form>
                </div>

                <div className="organizer-panel">
                  <h3>Organiser Public Profile</h3>
                  <div className="field-group">
                    <label>Public Name to Show on the Marketplace</label>
                    <input value={organizerSession ? organizerSession.name : 'Outdoor Kenya Expeditions'} readOnly />
                  </div>
                  <div className="field-group">
                    <label>Average Rating</label>
                    <input value="4.9 / 5.0" readOnly />
                  </div>
                  <div className="field-group">
                    <label>Request Additional Tickets</label>
                    <input type="number" min="1" placeholder="e.g. 12" defaultValue={12} />
                  </div>
                  <button type="button" className="primary-btn small" onClick={() => {
                    const requested = Number(document.querySelector('.organizer-panel input[type="number"]')?.value || 0)
                    if (requested > 0) {
                      setTicketRequests((prev) => [{
                        id: `req-${Date.now()}`,
                        title: 'Capacity Expansion Request',
                        organizer: organizerSession ? organizerSession.name : 'Outdoor Kenya Expeditions',
                        requested,
                        status: 'pending',
                      }, ...prev])
                      showToast(`Ticket request for ${requested} additional seats sent to admin.`)
                    }
                  }}>
                    Notify Admin
                  </button>
                </div>

                <div className="organizer-panel">
                  <h3>Hiker Ticket Scanner</h3>
                  <div className="scanner-row">
                    <input
                      value={scannerRef}
                      onChange={(event) => setScannerRef(event.target.value)}
                      placeholder="Scan or enter ticket reference"
                    />
                    <button type="button" className="primary-btn small" onClick={scanTicketForCheckIn}>Check In</button>
                  </div>
                  <div className="stats-grid compact-grid">
                    <div className="mini-stat-card">
                      <span>Checked In</span>
                      <strong>{organizerScanStats.checkedIn}</strong>
                    </div>
                    <div className="mini-stat-card">
                      <span>Manifest Total</span>
                      <strong>{organizerScanStats.total}</strong>
                    </div>
                  </div>
                </div>

                <div className="manifest-box">
                  <div className="manifest-head">
                    <div>
                      <h3>Elephant Hill Expedition — Live Bus Manifest</h3>
                      <p>Departure: Saturday 5:30 AM • Nairobi pickup point</p>
                    </div>
                    <div className="manifest-actions">
                      <button type="button" className="ghost-btn small" onClick={() => showToast('Camera activated. Scanning Hiker QR...')}>
                        Scan Hiker QR
                      </button>
                      <button type="button" className="ghost-btn small" onClick={() => showToast('Manifest exported.')}>Export Manifest</button>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Hiker Name</th>
                          <th>M-PESA Ref</th>
                          <th>Pickup Point</th>
                          <th>Emergency Contact</th>
                          <th>Medical / Dietary</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {organizerManifest.map((item, index) => (
                          <tr key={item.id}>
                            <td>{item.name}</td>
                            <td>{item.ref}</td>
                            <td>{item.pickup}</td>
                            <td>{item.phone}</td>
                            <td>{item.note}</td>
                            <td>
                              <span className={`status-tag ${item.checkedIn ? 'ok' : 'pending'}`}>{item.checkedIn ? 'On Board' : 'Pending'}</span>
                            </td>
                            <td>
                              <button type="button" className="table-btn" onClick={() => toggleHikerCheckIn(index)}>
                                {item.checkedIn ? 'Uncheck' : 'Check In'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {activeView === 'admin' && (
          <section className="admin-view">
            <div className="admin-panel">
              <div className="admin-header">
                <div>
                  <span className="safe-badge">Superadmin Governance</span>
                  <h2>TwendeHike Marketplace Operations</h2>
                </div>
                <div className="admin-header-actions">
                  <span className="status-ok">Safaricom Daraja API: CONNECTED</span>
                  <button type="button" className="ghost-btn small" onClick={logout}>Logout</button>
                </div>
              </div>

              <div className="admin-metrics">
                <div className="mini-stat-card">
                  <span>Total GMV</span>
                  <strong>KES 1,489,200</strong>
                </div>
                <div className="mini-stat-card">
                  <span>Platform Revenue</span>
                  <strong>KES 119,136</strong>
                </div>
                <div className="mini-stat-card">
                  <span>Registered Captains</span>
                  <strong>28 Organizers</strong>
                </div>
              </div>

              <div className="admin-queue admin-events-list">
                <h3>All Event Listings</h3>
                {adminEvents.length === 0 ? <p className="empty-inline">No event listings found.</p> : adminEvents.map((event) => (
                  <div key={`all-event-${event.id}`} className="queue-item">
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.county} County • {event.status} • {event.date || 'Upcoming'}</p>
                    </div>
                    <span className="status-pill">{event.status}</span>
                  </div>
                ))}
              </div>

              <div className="admin-reset-box hero-settings-panel">
                <h3>Hero Banner Settings</h3>
                <form onSubmit={handleHeroSettingsUpdate} className="create-form">
                  <div className="field-group">
                    <label>Hero Badge Text</label>
                    <input
                      value={heroSettingsForm.heroBadge}
                      onChange={(event) => setHeroSettingsForm((prev) => ({ ...prev, heroBadge: event.target.value }))}
                      placeholder="KENYA'S #1 TRAIL MARKETPLACE"
                    />
                  </div>
                  <div className="field-group">
                    <label>Hero Headline</label>
                    <input
                      value={heroSettingsForm.heroHeadline}
                      onChange={(event) => setHeroSettingsForm((prev) => ({ ...prev, heroHeadline: event.target.value }))}
                      placeholder="Conquer the Aberdares, Longonot & Mt. Kenya."
                    />
                  </div>
                  <div className="field-group">
                    <label>Hero Subtitle</label>
                    <textarea
                      rows="3"
                      value={heroSettingsForm.heroSubtitle}
                      onChange={(event) => setHeroSettingsForm((prev) => ({ ...prev, heroSubtitle: event.target.value }))}
                      placeholder="Verified trail captains and seamless booking with Lipa na M-PESA."
                    />
                  </div>
                  <div className="field-group">
                    <label>Hero Background Image URL</label>
                    <input
                      type="url"
                      value={heroSettingsForm.heroImageUrl}
                      onChange={(event) => setHeroSettingsForm((prev) => ({ ...prev, heroImageUrl: event.target.value }))}
                      placeholder="https://images.example.com/hero.jpg"
                    />
                  </div>
                  <div className="field-group">
                    <label>Hero Overlay Color</label>
                    <input
                      type="text"
                      value={heroSettingsForm.heroOverlayColor}
                      onChange={(event) => setHeroSettingsForm((prev) => ({ ...prev, heroOverlayColor: event.target.value }))}
                      placeholder="#062d1f"
                    />
                  </div>
                  <div className="create-actions">
                    <button type="submit" className="primary-btn small">Save Hero Settings</button>
                  </div>
                </form>
              </div>

              <div className="admin-ticket-block">
                <h3>Ticket Capacity Requests</h3>
                {ticketRequests.length === 0 ? (
                  <p className="empty-inline">No additional-capacity requests right now.</p>
                ) : (
                  ticketRequests.map((request) => (
                    <div key={request.id} className="queue-item">
                      <div>
                        <strong>{request.title}</strong>
                        <p>
                          {request.organizer} • requested +{request.requested} tickets • {request.status}
                        </p>
                      </div>
                      <div className="queue-actions">
                        <button type="button" className="primary-btn small" onClick={() => setTicketRequests((prev) => prev.filter((item) => item.id !== request.id))}>Resolve</button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="admin-ticket-block">
                <h3>Organizer Access Requests</h3>
                {organizerRequests.length === 0 ? (
                  <p className="empty-inline">No new host requests.</p>
                ) : (
                  organizerRequests.map((request, index) => (
                    <div key={request.id} className="queue-item">
                      <div>
                        <strong>{request.organization || request.name}</strong>
                        <p>{request.name} • {request.email} • pending review</p>
                      </div>
                      <div className="queue-actions">
                        <button type="button" className="primary-btn small" onClick={() => approveOrganizerRequest(index)}>Approve Access</button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="admin-reset-box">
                <h3>Update Superadmin Name</h3>
                <form onSubmit={handleAdminProfileUpdate} className="create-form">
                  <div className="split-fields">
                    <div className="field-group">
                      <label>First Name</label>
                      <input
                        value={adminProfileForm.firstName}
                        onChange={(event) => setAdminProfileForm((prev) => ({ ...prev, firstName: event.target.value }))}
                        placeholder="First name"
                      />
                    </div>
                    <div className="field-group">
                      <label>Last Name</label>
                      <input
                        value={adminProfileForm.lastName}
                        onChange={(event) => setAdminProfileForm((prev) => ({ ...prev, lastName: event.target.value }))}
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div className="create-actions">
                    <button type="submit" className="primary-btn small">Update Name</button>
                  </div>
                </form>
              </div>

              <div className="admin-reset-box">
                <h3>Reset Superadmin Password</h3>
                <form onSubmit={handleAdminPasswordReset} className="create-form">
                  <div className="split-fields">
                    <div className="field-group">
                      <label>Current Password</label>
                      <input
                        type="password"
                        value={adminPasswordForm.currentPassword}
                        onChange={(e) => setAdminPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                        placeholder="Current password"
                      />
                    </div>
                    <div className="field-group">
                      <label>New Password</label>
                      <input
                        type="password"
                        value={adminPasswordForm.newPassword}
                        onChange={(e) => setAdminPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                        placeholder="New password"
                      />
                    </div>
                  </div>

                  <div className="field-group">
                    <label>Confirm New Password</label>
                    <input
                      type="password"
                      value={adminPasswordForm.confirmPassword}
                      onChange={(e) => setAdminPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                      placeholder="Confirm new password"
                    />
                  </div>

                  {adminMessage && <p className="admin-message">{adminMessage}</p>}

                  <div className="create-actions">
                    <button type="submit" className="primary-btn small">Update Password</button>
                  </div>
                </form>
              </div>

              <div className="admin-queue">
                <h3>Hike Approval Queue</h3>
                {pendingHikes.length === 0 ? <p className="empty-inline">No hikes waiting for approval.</p> : pendingHikes.map((hike, index) => (
                  <div key={hike.id || `${hike.title}-${index}`} className="queue-item">
                    <div>
                      <strong>{hike.title}</strong>
                      <p>
                        By {hike.organizer} • {hike.county} County • {hike.date || 'Upcoming'}
                      </p>
                    </div>
                    <div className="queue-actions">
                      <button type="button" className="primary-btn small" onClick={() => approveHikeListing(index)}>
                        Approve &amp; Publish
                      </button>
                      <button type="button" className="ghost-btn" onClick={() => rejectHikeListing(index)}>
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="admin-queue">
                <h3>Approved Hikes</h3>
                {approvedHikes.length === 0 ? <p className="empty-inline">No approved hikes yet.</p> : approvedHikes.map((hike, index) => (
                  <div key={`${hike.id}-approved-${index}`} className="queue-item">
                    <div>
                      <strong>{hike.title}</strong>
                      <p>{hike.organizer} • {hike.county} County • {hike.maxTickets} max tickets</p>
                    </div>
                    <div className="queue-actions">
                      <button type="button" className="ghost-btn small" onClick={() => deleteEventFromAdmin(hike)}>Delete</button>
                      <button type="button" className="ghost-btn small" onClick={() => completeApprovedHike(index)}>Complete</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="admin-lifecycle-grid">
                <div className="admin-mini-panel">
                  <h3>Removed Hikes</h3>
                  {removedHikes.length === 0 ? <p className="empty-inline">No removed hikes.</p> : removedHikes.map((hike, index) => (
                    <div key={`${hike.id}-removed-${index}`} className="mini-list-item">
                      <div>
                        <strong>{hike.title}</strong>
                        <small>{hike.organizer}</small>
                      </div>
                      <div className="queue-actions">
                        <button type="button" className="ghost-btn small" onClick={() => removeApprovedHike(index, true)}>Restore</button>
                        <button type="button" className="ghost-btn small" onClick={() => permanentlyDeleteHike(index, 'removed')}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="admin-mini-panel">
                  <h3>Completed Hikes</h3>
                  {completedHikes.length === 0 ? <p className="empty-inline">No completed hikes.</p> : completedHikes.map((hike, index) => (
                    <div key={`${hike.id}-completed-${index}`} className="mini-list-item">
                      <div>
                        <strong>{hike.title}</strong>
                        <small>{hike.organizer}</small>
                      </div>
                      <button type="button" className="ghost-btn small" onClick={() => permanentlyDeleteHike(index, 'completed')}>Delete</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {eventModal && (
        <div className="modal-backdrop" onClick={closeEventModal}>
          <div className="event-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-hero">
              <img src={eventModal.image} alt={eventModal.title} />
              <button type="button" className="close-button" onClick={closeEventModal}>×</button>
              <div className="hero-overlay">
                <div className="modal-badges">
                  <span className={`badge-chip ${renderDifficultyBadge(eventModal.difficulty)}`}>{eventModal.difficulty}</span>
                  <span className="badge-chip light">{eventModal.county}</span>
                </div>
                <h2>{eventModal.title}</h2>
              </div>
            </div>

            <div className="modal-body">
              <div className="stats-grid modal-stats">
                <div>
                  <span>Distance</span>
                  <strong>{eventModal.distance}</strong>
                </div>
                <div>
                  <span>Elevation</span>
                  <strong>{eventModal.elevation}</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>{eventModal.duration}</strong>
                </div>
                <div>
                  <span>Departure</span>
                  <strong>{eventModal.pickupTime || eventModal.departure || '05:30 AM'}</strong>
                </div>
              </div>

              <div className="modal-section">
                <h4>The Expedition Experience</h4>
                <p>{eventModal.description}</p>
              </div>

              {eventModalPhotos.length > 0 && (
                <div className="modal-section">
                  <h4>Event Photos</h4>
                  <div className="photo-gallery">
                    {eventModalPhotos.map((photo, photoIndex) => (
                      <button key={`${photo || 'event-photo'}-${photoIndex}`} type="button" className="gallery-button" onClick={() => openEventLightbox(photoIndex)} aria-label={`Expand ${eventModal.title} photo ${photoIndex + 1}`}>
                        <img src={photo} alt={`${eventModal.title} photo ${photoIndex + 1}`} className="gallery-image" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="modal-section">
                <h4>What’s Included</h4>
                <ul className="info-list">
                  {(eventModal.inclusions?.length ? eventModal.inclusions : DEFAULT_INCLUSIONS).map((item, index) => (
                    (() => {
                      const rawItem = typeof item === 'string' ? item : item?.name || item?.label || item?.title || String(item)
                      const cleanItem = rawItem.replace(/^[✓✔\s\-*]+/, '')
                      return (
                        <li key={`${cleanItem}-${index}`}>
                          <span className="inclusion-check" aria-hidden="true">✓</span>
                          <span>{cleanItem}</span>
                        </li>
                      )
                    })()
                  ))}
                </ul>
              </div>

              <div className="modal-section">
                <h4>Kenyan Trail Checklist</h4>
                <div className="gear-row">
                  {eventModal.gear.map((item) => (
                    <span key={item} className="gear-tag">{item}</span>
                  ))}
                </div>
              </div>

              <div className="modal-section">
                <h4>Meeting &amp; Pickup Point</h4>
                <p className="pickup-note">📍 {eventModal.meetingPoint || eventModal.pickup || eventModal.locationText}</p>
                <p className="pickup-note">🕒 {eventModal.pickupTime || eventModal.departure || '05:30 AM'}</p>
                {eventModal.googleMapUrl && (
                  <a className="map-link" href={eventModal.googleMapUrl} target="_blank" rel="noopener noreferrer">
                    📍 Open in Google Maps ↗
                  </a>
                )}
              </div>

              <div className="modal-section organizer-contact-card">
                <h4>Host &amp; Organizer Contact</h4>
                <div className="organizer-contact-header">
                  <strong>{eventModal.organizerName || eventModal.organizer}</strong>
                  {eventModal.verified && <span className="verified-badge modal-verified">✓ Verified</span>}
                </div>
                <div className="organizer-contact-actions">
                  {eventModal.organizerPhone && (
                    <>
                      <a className="contact-action whatsapp-action" href={`https://wa.me/${String(eventModal.organizerPhone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>
                      <a className="contact-action phone-action" href={`tel:${eventModal.organizerPhone}`}>Call Organizer</a>
                    </>
                  )}
                  {eventModal.organizerEmail && <a className="contact-action email-action" href={`mailto:${eventModal.organizerEmail}`}>Email Organizer</a>}
                </div>
              </div>

              <div className="tier-section">
                <h4>Select Ticket Package</h4>
                <div className="tier-list">
                  {eventModal.tiers.map((tier, index) => (
                    <button
                      key={`${tier.name}-${index}`}
                      type="button"
                      className={`tier-box ${selectedTierIndex === index ? 'selected' : ''}`}
                      onClick={() => setSelectedTierIndex(index)}
                    >
                      <span className="tier-name">{tier.name}</span>
                      <span className="tier-price">KES {Number(tier.price).toLocaleString()}</span>
                      <small>{tier.note}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div>
                <small>Total Payable via M-PESA</small>
                <strong>KES {Number(eventModal.tiers[selectedTierIndex].price).toLocaleString()}</strong>
              </div>
              <button type="button" className="primary-btn" onClick={bookSelectedTier}>
                Book with M-PESA
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxIndex !== null && eventModalPhotos.length > 0 && (
        <div className="lightbox-backdrop" onClick={closeEventLightbox} role="dialog" aria-modal="true" aria-label={`${eventModal.title} photo viewer`}>
          <button type="button" className="lightbox-close" onClick={closeEventLightbox} aria-label="Close photo viewer">×</button>
          {eventModalPhotos.length > 1 && (
            <button
              type="button"
              className="lightbox-nav lightbox-prev"
              onClick={(event) => {
                event.stopPropagation()
                setLightboxIndex((current) => (current - 1 + eventModalPhotos.length) % eventModalPhotos.length)
              }}
              aria-label="Previous photo"
            >
              ‹
            </button>
          )}
          <img
            className="lightbox-image"
            src={eventModalPhotos[lightboxIndex]}
            alt={`${eventModal.title} enlarged photo ${lightboxIndex + 1}`}
            onClick={(event) => event.stopPropagation()}
          />
          {eventModalPhotos.length > 1 && (
            <button
              type="button"
              className="lightbox-nav lightbox-next"
              onClick={(event) => {
                event.stopPropagation()
                setLightboxIndex((current) => (current + 1) % eventModalPhotos.length)
              }}
              aria-label="Next photo"
            >
              ›
            </button>
          )}
          <div className="lightbox-counter">{lightboxIndex + 1} / {eventModalPhotos.length}</div>
        </div>
      )}

      {checkoutHike && (
        <div className="modal-backdrop" onClick={closeCheckout}>
          <div className="checkout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="checkout-header">
              <div className="mpesa-badge">M</div>
              <div>
                <h3>Lipa na M-PESA</h3>
                <p>Instant STK Push to your phone</p>
              </div>
              <button type="button" className="checkout-close" onClick={closeCheckout} aria-label="Close M-PESA checkout">×</button>
            </div>

            {checkoutStep === 'form' && (
              <div className="checkout-form">
                <div className="mpesa-summary-card">
                  <div className="mpesa-summary-topline">
                    <strong>{checkoutHike.hike.title}</strong>
                    <span>{formatDate(checkoutHike.hike.date)} · {checkoutHike.hike.county}</span>
                  </div>
                  <div className="mpesa-summary-bottomline">
                    <span>{checkoutHike.tier.name}</span>
                    <strong>KES {Number(checkoutHike.tier.price).toLocaleString()}</strong>
                  </div>
                </div>

                <div className="field-group">
                  <label>Hiker Full Name</label>
                  <input placeholder="e.g. Jane Wanjiku" value={checkoutForm.fullName} onChange={(e) => setCheckoutForm((prev) => ({ ...prev, fullName: e.target.value }))} />
                </div>

                <div className="split-fields">
                  <div className="field-group">
                    <label>National ID / Passport #</label>
                    <input placeholder="e.g. 12345678" value={checkoutForm.idNumber} onChange={(e) => setCheckoutForm((prev) => ({ ...prev, idNumber: e.target.value }))} />
                  </div>
                  <div className="field-group">
                    <label>Emergency Contact</label>
                    <input placeholder="e.g. Next of Kin Name & 07..." value={checkoutForm.emergencyContact} onChange={(e) => setCheckoutForm((prev) => ({ ...prev, emergencyContact: e.target.value }))} />
                  </div>
                </div>

                <div className="field-group">
                  <label>Pickup Bus Location</label>
                  <select value={checkoutForm.pickup || ''} onChange={(e) => setCheckoutForm((prev) => ({ ...prev, pickup: e.target.value }))}>
                    <option value={checkoutHike?.hike?.pickup || checkoutHike?.hike?.locationText || 'Direct at Trailhead / Event Venue'}>
                      {checkoutHike?.hike?.pickup || checkoutHike?.hike?.locationText || 'Direct at Trailhead / Event Venue'}
                    </option>
                    <option value="Direct at Trailhead / Event Venue">Direct at Trailhead / Event Venue</option>
                  </select>
                </div>

                <div className="field-group">
                  <label>Safaricom M-PESA Phone Number</label>
                  <div className="phone-input-wrap">
                    <span className="phone-prefix">+254</span>
                    <input inputMode="numeric" placeholder="7XXXXXXXX" value={checkoutForm.phoneNumber.replace(/^\+?254/, '').replace(/^0/, '')} onChange={(e) => setCheckoutForm((prev) => ({ ...prev, phoneNumber: e.target.value }))} />
                  </div>
                </div>

                <button type="button" className="mpesa-pay-button" onClick={triggerStkPrompt}>
                  Pay KES {Number(checkoutHike.tier.price).toLocaleString()} via M-PESA
                </button>
              </div>
            )}

            {checkoutStep === 'prompt' && (
              <div className="phone-prompt">
                <div className="simulator-screen">
                  <div className="sim-topline">
                    <span>Safaricom 4G</span>
                    <span>12:25 PM</span>
                    <span>98%</span>
                  </div>

                  <div className="sim-body">
                    <div className="sim-header">Safaricom SIM Toolkit</div>
                    <div className="sim-summary-box">
                      <div>
                        <span>Expedition</span>
                        <strong>{checkoutHike.hike.title}</strong>
                      </div>
                      <div>
                        <span>Ticket</span>
                        <strong>{checkoutHike.tier.name}</strong>
                      </div>
                      <div>
                        <span>Price</span>
                        <strong>KES {Number(checkoutHike.tier.price).toLocaleString()}</strong>
                      </div>
                    </div>
                    <div className="sim-text">
                      Do you want to pay <strong>KES {Number(checkoutHike.tier.price).toLocaleString()}</strong> for this hiking trip via M-PESA?
                    </div>
                    <label>Enter M-PESA PIN</label>
                    <input value="••••" readOnly />
                    <div className="sim-actions">
                      <button type="button" className="secondary-btn small" onClick={() => setCheckoutStep('form')}>
                        Cancel
                      </button>
                      <button type="button" className="primary-btn small" onClick={confirmStkPin}>
                        Send PIN
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {checkoutStep === 'success' && (
              <div className="success-box">
                <div className="success-icon">✓</div>
                <h4>Payment Confirmed!</h4>
                <p>Your pass is active and confirmed on the transport manifest.</p>
                <div className="receipt-box">
                  <div className="receipt-head">
                    <span>MPESA MSG</span>
                    <span>JUST NOW</span>
                  </div>
                  <p>
                    <strong>{paymentReference || 'MPESA CONFIRMED'}</strong> Confirmed. KES {Number(checkoutHike.tier.price).toLocaleString()} has been received for {checkoutHike.hike.title}.
                  </p>
                </div>

                <div className="success-actions">
                  <button type="button" className="primary-btn small" onClick={() => showPass(userBookings[0])}>View Digital QR Pass</button>
                  <button type="button" className="ghost-btn" onClick={() => { closeCheckout(); setActiveView('hiker-hub') }}>
                    My Passes
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {adminLoginOpen && (
        <div className="modal-backdrop" onClick={closeAdminLogin}>
          <div className="create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="create-header">
              <div>
                <h3>Superadmin Access</h3>
                <p>Private platform administration login.</p>
              </div>
              <button type="button" className="close-button" onClick={closeAdminLogin}>×</button>
            </div>

            <form onSubmit={handleAdminLogin} className="create-form">
              <div className="field-group">
                <label>Admin Email</label>
                <input
                  type="email"
                  value={adminCredentials.email}
                  placeholder="admin@yourdomain.com"
                  autoComplete="username"
                  onChange={(e) => setAdminCredentials((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>

              <div className="field-group">
                <label>Password</label>
                <input
                  type="password"
                  value={adminCredentials.password}
                  placeholder="Enter admin password"
                  autoComplete="current-password"
                  onChange={(e) => setAdminCredentials((prev) => ({ ...prev, password: e.target.value }))}
                />
              </div>

              {adminMessage && <p className="admin-message">{adminMessage}</p>}

              <div className="create-actions">
                <button type="button" className="ghost-btn" onClick={closeAdminLogin}>Cancel</button>
                <button type="submit" className="primary-btn">Access Admin</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createModalOpen && (
        <div className="modal-backdrop" onClick={closeCreateModal}>
          <div className="create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="create-header">
              <div>
                <h3>List New Kenyan Trail Expedition</h3>
                <p>Publish your itinerary to thousands of Kenyan hikers.</p>
              </div>
              <button type="button" className="close-button" onClick={closeCreateModal}>×</button>
            </div>

            <form onSubmit={handleCreateHikeSubmit} noValidate className="create-form">
              <div className="field-group">
                <label>Expedition Title</label>
                <input name="newTitle" required placeholder="e.g. Rurimeria Moorland Extreme 4000m Challenge" />
              </div>

              <div className="split-fields">
                <div className="field-group">
                  <label>County / Region</label>
                  <div className="creation-county-combobox">
                    <input
                      name="newCounty"
                      value={countySearch}
                      autoComplete="off"
                      placeholder="Search county, e.g. Nakuru"
                      onFocus={() => {
                        setCountySearch('')
                        setIsCountyDropdownOpen(true)
                      }}
                      onChange={(event) => {
                        setCountySearch(event.target.value)
                        setIsCountyDropdownOpen(true)
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          setIsCountyDropdownOpen(false)
                          setCountySearch(selectedCounty?.name || 'Nairobi')
                        }, 120)
                      }}
                      aria-expanded={isCountyDropdownOpen}
                      aria-autocomplete="list"
                      role="combobox"
                    />
                    {isCountyDropdownOpen && (
                      <div className="county-dropdown-menu" role="listbox">
                        {filteredCreationCounties.length === 0 ? (
                          <div className="county-dropdown-empty">No counties found</div>
                        ) : filteredCreationCounties.map((countyOption) => (
                          <button
                            key={countyOption.id}
                            type="button"
                            className={`county-dropdown-item ${selectedCounty?.id === countyOption.id ? 'active' : ''}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectCreationCounty(countyOption)}
                          >
                            {countyOption.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="field-group">
                  <label>Difficulty</label>
                  <select name="newDifficulty" defaultValue="Moderate">
                    <option value="Easy">Easy</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Challenging">Challenging</option>
                    <option value="Extreme">Extreme</option>
                  </select>
                </div>
              </div>

              <div className="split-fields">
                <div className="field-group">
                  <label>Date</label>
                  <input name="newDate" type="date" required />
                </div>
                <div className="field-group">
                  <label>Distance (KM)</label>
                  <input name="newDistance" placeholder="e.g. 16 KM" />
                </div>
                <div className="field-group">
                  <label>Elevation (Meters)</label>
                  <input name="newElevation" placeholder="e.g. 3,800m" />
                </div>
              </div>

              <div className="field-group">
                <label>Maximum Tickets</label>
                <input name="newMaxTickets" type="number" min="1" required placeholder="e.g. 40" />
              </div>

              <div className="split-fields">
                <div className="field-group">
                  <label>Early Bird Price (KES)</label>
                  <input name="newPriceEarly" type="number" required placeholder="3200" />
                </div>
                <div className="field-group">
                  <label>Standard Price (KES)</label>
                  <input name="newPriceStd" type="number" required placeholder="3800" />
                </div>
              </div>

              <div className="field-group">
                <label>Host / Organization Display Name</label>
                <input name="newHostName" placeholder="Kenyan Explorer" />
              </div>

              <div className="split-fields">
                <div className="field-group">
                  <label>Organizer Phone / WhatsApp</label>
                  <input name="newOrganizerPhone" type="tel" placeholder="+254 712 345 678" />
                </div>
                <div className="field-group">
                  <label>Organizer Email</label>
                  <input name="newOrganizerEmail" type="email" placeholder="host@example.com" />
                </div>
              </div>

              <div className="field-group">
                <label>Meeting &amp; Pickup Location</label>
                <input name="newPickup" required placeholder="e.g. Bata Hilton, Nairobi CBD" />
              </div>

              <div className="field-group">
                <label>Pickup / Departure Time</label>
                <input name="newPickupTime" placeholder="e.g. 04:45 AM" />
              </div>

              <div className="field-group">
                <label>Google Maps Link for Meeting Point</label>
                <input name="newMapUrl" type="url" placeholder="https://maps.app.goo.gl/..." />
              </div>

              <div className="field-group">
                <label>What’s Included</label>
                <div className="chip-inline">
                  <select defaultValue="" onChange={(event) => {
                    const value = event.target.value
                    if (value) {
                      addInclusion(value)
                      event.target.value = ''
                    }
                  }}>
                    <option value="">Select default option</option>
                    {DEFAULT_INCLUSIONS.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Add custom inclusion"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addInclusion(event.target.value)
                        event.target.value = ''
                      }
                    }}
                  />
                </div>
                <div className="tag-cloud">
                  {selectedInclusions.map((item) => (
                    <button type="button" key={item} className="tag-pill" onClick={() => setSelectedInclusions((prev) => prev.filter((entry) => entry !== item))}>
                      {item} ×
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-group">
                <label>Trail Checklist</label>
                <div className="chip-inline">
                  <select defaultValue="" onChange={(event) => {
                    const value = event.target.value
                    if (value) {
                      addChecklistItem(value)
                      event.target.value = ''
                    }
                  }}>
                    <option value="">Select checklist item</option>
                    {DEFAULT_CHECKLIST.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Add custom checklist item"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addChecklistItem(event.target.value)
                        event.target.value = ''
                      }
                    }}
                  />
                </div>
                <div className="tag-cloud">
                  {selectedChecklistItems.map((item) => (
                    <button type="button" key={item} className="tag-pill" onClick={() => setSelectedChecklistItems((prev) => prev.filter((entry) => entry !== item))}>
                      {item} ×
                    </button>
                  ))}
                </div>
              </div>

              <div className="split-fields">
                <div className="field-group">
                  <label>Custom Ticket Package Name</label>
                  <input name="newCustomPackageName" placeholder="e.g. Premium Adventure" />
                </div>
                <div className="field-group">
                  <label>Custom Package Price (KES)</label>
                  <input name="newCustomPackagePrice" type="number" min="0" placeholder="4500" />
                </div>
              </div>

              <div className="field-group">
                <label>Custom Package Note</label>
                <input name="newCustomPackageNote" placeholder="e.g. Includes private guide and breakfast" />
              </div>

              <div className="field-group">
                <label>Upload event photos</label>
                <input type="file" accept="image/*" multiple onChange={handleEventImageChange} />
                {uploadedEventImages.length > 0 && (
                  <div className="upload-preview-wrap">
                    <div className="upload-thumb-row">
                      {uploadedEventImages.map((imageUrl, imageIndex) => (
                        <div key={`${imageUrl}-${imageIndex}`} className="upload-thumb-item">
                          <img src={imageUrl} alt={`Event photo ${imageIndex + 1}`} className="upload-thumb" />
                          <button
                            type="button"
                            className="upload-remove-btn"
                            onClick={() => handleRemoveUploadedImage(imageIndex)}
                            aria-label={`Remove event photo ${imageIndex + 1}`}
                            title="Remove photo"
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="ghost-btn small" onClick={clearUploadedEventImages}>Clear all photos</button>
                  </div>
                )}
              </div>

              <div className="field-group">
                <label>Expedition Overview</label>
                <textarea name="newDesc" rows="3" placeholder="Describe the trail terrain, conditions, and expected experience..." />
              </div>

              <div className="create-actions">
                <button type="button" className="ghost-btn" onClick={closeCreateModal}>Cancel</button>
                <button type="submit" className="primary-btn">Submit for Verification</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ticketModal && (
        <div className="modal-backdrop" onClick={closeTicketModal}>
          <div className="ticket-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ticket-header">
              <strong>Official Trail Boarding Pass</strong>
              <button type="button" className="close-button" onClick={closeTicketModal}>×</button>
            </div>

            <div className="ticket-pass-body">
              <div className="ticket-pass-top">
                <div>
                  <span>Trail Destination</span>
                  <h4>{ticketModal.hikeTitle}</h4>
                  <small>{ticketModal.date}</small>
                </div>
                <span className="validated-tag">VALIDATED</span>
              </div>

              <div className="ticket-pass-grid">
                <div>
                  <span>Hiker</span>
                  <strong>{ticketModal.hikerName}</strong>
                </div>
                <div>
                  <span>Location</span>
                  <strong>{ticketModal.county || 'Kenya'}</strong>
                </div>
                <div>
                  <span>Distance</span>
                  <strong>{ticketModal.distance || 'N/A'}</strong>
                </div>
                <div>
                  <span>Pickup Point</span>
                  <strong>{ticketModal.pickup}</strong>
                </div>
              </div>

              <div className="rating-box">
                <span>Rate this organizer</span>
                <div className="star-row">
                  {[5, 4, 3, 2, 1].map((value) => (
                    <button key={value} type="button" className="star-btn" onClick={() => submitOrganizerRating(ticketModal, value)}>
                      ★
                    </button>
                  ))}
                </div>
              </div>

              <div className="qr-box">
                <svg className="qr-svg" viewBox="0 0 21 21" role="img" aria-label={`Ticket QR for ${ticketModal.mpesaRef}`}>
                  {generateQrMatrix(ticketModal.mpesaRef || ticketModal.bookingId).map((row, rowIndex) =>
                    row.map((cell, colIndex) => (
                      <rect
                        key={`${rowIndex}-${colIndex}`}
                        x={colIndex}
                        y={rowIndex}
                        width="1"
                        height="1"
                        fill={cell ? '#111827' : '#ffffff'}
                      />
                    )),
                  )}
                </svg>
                <span>REF: {ticketModal.mpesaRef}</span>
              </div>
            </div>

            <div className="ticket-actions-row">
              <button type="button" className="primary-btn small" onClick={() => window.print()}>
                Print Pass
              </button>
              <button type="button" className="ghost-btn" onClick={closeTicketModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

const formatDate = (isoDate) => {
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-KE', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default App
