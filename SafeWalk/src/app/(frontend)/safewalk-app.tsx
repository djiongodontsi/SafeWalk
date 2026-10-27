'use client'

import { FormEvent, InputHTMLAttributes, useEffect, useState } from 'react'
import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'

type Screen = 'welcome' | 'auth' | 'legal' | 'home' | 'setup' | 'contact-form' | 'journey-form' | 'active-journey' | 'profile' | 'admin'
type UserRow = { id: string; firstName: string; lastName: string; email: string; phone: string; emailConfirmed: boolean }
type SecureAction = 'reveal' | 'regenerate' | 'profile'
type Profile = { firstName: string; lastName: string; email: string; phone: string; birthDate: string; newPassword: string }
type Contact = { id: string; name: string; phone: string; favorite?: boolean; relatedUser?: string | { id: string } }
type Checkpoint = { label: string; minutesToNext: number }
type Journey = { id: string; name: string; departure: string; arrival: string; departureMinutes: number; checkpoints: Checkpoint[]; totalMinutes: number; contacts?: Array<string | { id: string }>; favorite?: boolean; status?: string; startedAt?: string; completedAt?: string; segmentEndsAt?: string; currentIndex?: number; owner?: string; canControl?: boolean }

const initialForm = { firstName: '', lastName: '', email: '', phone: '', password: '', birthDate: '', rgpdConsent: false }
const initialContact = { id: '', name: '', phone: '', secretIdentifier: '', relatedUserId: '', favorite: true }
const initialJourney = { id: '', name: '', departure: '', arrival: '', departureMinutes: 0, checkpoints: [{ label: '', minutesToNext: 0 }, { label: '', minutesToNext: 0 }, { label: '', minutesToNext: 0 }] as Checkpoint[], contacts: [] as string[], favorite: true }

function saveDraft(name: string, value: object) {
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=86400; Path=/; SameSite=Lax`
}

function readDraft<T>(name: string, fallback: T): T {
  const value = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=')
  if (!value) return fallback
  try {
    return JSON.parse(decodeURIComponent(value))
  } catch {
    return fallback
  }
}

function Shield({ route = false }: { route?: boolean }) {
  return (
    <svg className={route ? 'hero-route' : 'shield'} aria-hidden="true" viewBox="0 0 120 120" fill="none">
      {route ? (
        <>
          <path className="route-line" d="M18 88c15-4 8-28 27-31 17-3 15 22 33 11 14-9 5-29 25-36" />
          <path className="route-shield" d="m61 35 15 6v11c0 10-6 19-15 22-9-3-15-12-15-22V41l15-6Z" />
          <path className="route-check" d="m54 53 5 5 9-10" />
          <circle cx="17" cy="89" r="7" />
          <path d="M103 15c-9 0-16 7-16 16 0 11 16 25 16 25s16-14 16-25c0-9-7-16-16-16Zm0 22a6 6 0 1 1 0-12 6 6 0 0 1 0 12Z" />
        </>
      ) : (
        <>
          <path d="M60 17 95 31v26c0 22-15 42-35 48-20-6-35-26-35-48V31l35-14Z" />
          <path d="m44 61 10 10 23-24" />
        </>
      )}
    </svg>
  )
}

function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        aria-label={
          visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
        }
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6Z" />
          <circle cx="12" cy="12" r="2.8" />
        </svg>
      </button>
    </span>
  )
}

function RouteSmallIcon() {
  return (
    <svg aria-hidden="true" className="small-action-svg" fill="none" viewBox="0 0 24 24">
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
      <path d="M7 18c5 0 2-7 7-7h1c2 0 2-3 2-3" />
    </svg>
  )
}

function PersonSmallIcon() {
  return (
    <svg aria-hidden="true" className="small-action-svg" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg aria-hidden="true" className="bell-icon" fill="none" viewBox="0 0 24 24">
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 5 2 5.5 2 5.5h-15s2-.5 2-5.5Z" />
      <path d="M10 18.5h4" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" className="emergency-chevron" fill="none" viewBox="0 0 16 16">
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

async function api(body: object) {
  const res = await fetch('/api/app-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

export default function SafewalkApp() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [form, setForm] = useState(initialForm)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [fingerprint, setFingerprint] = useState('')
  const [secret, setSecret] = useState('')
  const [userFirstName, setUserFirstName] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [users, setUsers] = useState<UserRow[]>([])
  const [emergency, setEmergency] = useState(false)
  const [secureAction, setSecureAction] = useState<SecureAction | null>(null)
  const [modalPassword, setModalPassword] = useState('')
  const [profilePassword, setProfilePassword] = useState('')
  const [profile, setProfile] = useState<Profile>({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', newPassword: '' })
  const [contacts, setContacts] = useState<Contact[]>([])
  const [journeys, setJourneys] = useState<Journey[]>([])
  const [selectedContact, setSelectedContact] = useState('')
  const [selectedJourney, setSelectedJourney] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [contactDraft, setContactDraft] = useState(initialContact)
  const [journeyDraft, setJourneyDraft] = useState(initialJourney)
  const [journeyStep, setJourneyStep] = useState(0)
  const [incomingJourneys, setIncomingJourneys] = useState<Journey[]>([])
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null)
  const [clock, setClock] = useState(Date.now())
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'Contact' | 'Journey'; id: string } | null>(null)
  const [pendingAdminUser, setPendingAdminUser] = useState<UserRow | null>(null)
  const [legalReturn, setLegalReturn] = useState<'welcome' | 'auth'>('welcome')

  useEffect(() => {
    if (
      screen !== 'active-journey' ||
      !activeJourney ||
      activeJourney.status === 'completed'
    )
      return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    const sync = window.setInterval(async () => {
      const result = await api({ action: 'journeyState', id: activeJourney.id, email: form.email, password: form.password })
      if (result.journey) setActiveJourney(result.journey)
    }, 5000)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(sync)
    }
  }, [screen, activeJourney?.id, activeJourney?.status, form.email, form.password])

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    const result = await api({ action: mode, ...form })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    if (result.fingerprint) setFingerprint(result.fingerprint)
    if (result.name) setUserFirstName(result.name)
    setScreen('home')
  }

  const showAdmin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    const result = await api({ action: 'adminList', pin: adminPin })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    setUsers(result.users); setMessage('Accès autorisé. Ce code devient votre code administrateur s’il s’agit de la première connexion.')
  }

  const deleteAdminUser = async () => {
    if (!pendingAdminUser) return
    setBusy(true); setMessage('')
    const result = await api({
      action: 'adminDeleteUser',
      pin: adminPin,
      userId: pendingAdminUser.id,
    })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    setUsers((current) =>
      current.filter((user) => user.id !== pendingAdminUser.id),
    )
    setPendingAdminUser(null)
    setMessage('Utilisateur et données associées supprimés.')
  }

  const submitSecureAction = async (event: FormEvent) => {
    event.preventDefault()
    if (!secureAction) return
    setBusy(true); setMessage('')
    const result = await api({
      action: secureAction === 'profile' ? 'getProfile' : secureAction,
      email: form.email,
      password: modalPassword,
    })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    if (secureAction === 'profile') {
      setProfile({ ...result.profile, birthDate: result.profile.birthDate?.slice(0, 10) ?? '', newPassword: '' })
      setProfilePassword(modalPassword)
      setScreen('profile')
    } else {
      setSecret(result.secret)
      if (result.fingerprint) setFingerprint(result.fingerprint)
    }
    setSecureAction(null); setModalPassword(''); setMessage('')
  }

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    const result = await api({ action: 'updateProfile', currentPassword: profilePassword, ...profile })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    setForm({ ...form, firstName: result.firstName, lastName: result.lastName, phone: result.phone })
    setUserFirstName(result.firstName)
    if (profile.newPassword) setProfilePassword(profile.newPassword)
    setProfile({ ...profile, newPassword: '' })
    setMessage('Vos informations ont été mises à jour.')
  }

  const logout = async () => {
    await api({ action: 'logout' })
    setForm(initialForm); setSecret(''); setFingerprint(''); setUserFirstName(''); setProfilePassword('')
    setScreen('welcome')
  }

  const loadJourneyData = async () => {
    setBusy(true); setMessage('')
    const result = await api({ action: 'journeyData', email: form.email, password: form.password })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    setContacts(result.contacts)
    setJourneys(result.journeys)
    setIncomingJourneys(result.incomingJourneys ?? [])
    setScreen('setup')
  }

  const openContactForm = (contact?: Contact) => {
    const next = contact
      ? { id: contact.id, name: contact.name, phone: contact.phone, secretIdentifier: '', relatedUserId: typeof contact.relatedUser === 'object' ? contact.relatedUser.id : contact.relatedUser ?? '', favorite: contact.favorite !== false }
      : readDraft('sw-contact-draft', initialContact)
    setContactDraft(next)
    setMessage('')
    setScreen('contact-form')
  }

  const saveContact = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    const result = await api({
      action: contactDraft.id ? 'updateContact' : 'createContact',
      email: form.email,
      password: form.password,
      ...contactDraft,
    })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    document.cookie = 'sw-contact-draft=; Max-Age=0; Path=/'
    setContactDraft(initialContact)
    await loadJourneyData()
  }

  const openJourneyForm = (journey?: Journey) => {
    const next = journey
      ? {
          id: journey.id,
          name: journey.name,
          departure: journey.departure,
          arrival: journey.arrival,
          departureMinutes: journey.departureMinutes,
          checkpoints: journey.checkpoints.map((checkpoint) => ({ label: checkpoint.label, minutesToNext: checkpoint.minutesToNext })),
          contacts: (journey.contacts ?? []).map((contact) => typeof contact === 'object' ? contact.id : contact),
          favorite: journey.favorite !== false,
        }
      : readDraft('sw-journey-draft', initialJourney)
    setJourneyDraft(next)
    setJourneyStep(0)
    setMessage('')
    setScreen('journey-form')
  }

  const updateJourneyDraft = (next: typeof journeyDraft) => {
    setJourneyDraft(next)
    saveDraft('sw-journey-draft', next)
  }

  const saveJourney = async () => {
    setBusy(true); setMessage('')
    const result = await api({
      action: journeyDraft.id ? 'updateJourney' : 'createJourney',
      email: form.email,
      password: form.password,
      ...journeyDraft,
    })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    document.cookie = 'sw-journey-draft=; Max-Age=0; Path=/'
    setJourneyDraft(initialJourney)
    await loadJourneyData()
  }

  const removeItem = async () => {
    if (!pendingDelete) return
    const result = await api({ action: `delete${pendingDelete.kind}`, id: pendingDelete.id, email: form.email, password: form.password })
    setPendingDelete(null)
    if (result.error) return setMessage(result.error)
    await loadJourneyData()
  }

  const openActiveJourney = async (id: string, start = false) => {
    setBusy(true); setMessage('')
    if (start) {
      const verified = await performBiometric('journey-start')
      if (!verified) {
        setBusy(false)
        return
      }
    }
    const result = await api({ action: start ? 'startJourney' : 'journeyState', id, email: form.email, password: form.password })
    setBusy(false)
    if (result.error) return setMessage(result.error)
    setActiveJourney(result.journey)
    setClock(Date.now())
    setScreen('active-journey')
  }

  const performBiometric = async (
    purpose: 'journey-start' | 'journey-finish',
  ) => {
    try {
      if (!window.isSecureContext || !window.PublicKeyCredential) {
        setMessage(
          'Face ID/passkey nécessite Safari ou Chrome sur une connexion HTTPS.',
        )
        return false
      }
      const optionResult = await api({
        action: 'biometricOptions',
        purpose,
        email: form.email,
        password: form.password,
      })
      if (optionResult.error) {
        setMessage(optionResult.error)
        return false
      }
      const credential =
        optionResult.mode === 'register'
          ? await startRegistration({ optionsJSON: optionResult.options })
          : await startAuthentication({ optionsJSON: optionResult.options })
      const verification = await api({
        action: 'biometricVerify',
        purpose,
        mode: optionResult.mode,
        credential,
        email: form.email,
        password: form.password,
      })
      if (!verification.verified) {
        setMessage(
          verification.error ?? 'La vérification Face ID a échoué.',
        )
        return false
      }
      return true
    } catch (error) {
      setMessage(
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Vérification Face ID annulée.'
          : 'Impossible d’effectuer la vérification Face ID sur cet appareil.',
      )
      return false
    }
  }

  const updateActiveJourney = async (action: 'advanceJourney' | 'addJourneyTime') => {
    if (!activeJourney) return
    setMessage('')
    const finishing =
      action === 'advanceJourney' &&
      Number(activeJourney.currentIndex ?? 0) + 1 >=
        activeJourney.checkpoints.length + 1
    if (finishing) {
      setBusy(true)
      const verified = await performBiometric('journey-finish')
      setBusy(false)
      if (!verified) return
    }
    const result = await api({ action, id: activeJourney.id, email: form.email, password: form.password })
    if (result.error) return setMessage(result.error)
    setActiveJourney(result.journey)
    setClock(Date.now())
  }

  const formatTime = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds))
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
  }

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="Application SafeWalk">
        <div className="glow glow-one" /><div className="glow glow-two" />

        {screen === 'welcome' && (
          <div className="welcome">
            <button className="admin-lock-button" onClick={() => setScreen('admin')} aria-label="Accès administrateur">
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <rect x="5" y="10" width="14" height="11" rx="3" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
              </svg>
            </button>
            <div className="wordmark"><span>Safe</span>Walk</div>
            <div className="route-visual"><Shield route /></div>
            <div className="welcome-actions">
              <button className="primary-btn" onClick={() => { setMode('login'); setScreen('auth') }}>Se connecter</button>
              <button className="secondary-btn" onClick={() => { setMode('signup'); setScreen('auth') }}>Créer un compte</button>
            </div>
            <button className="legal-link" onClick={() => { setLegalReturn('welcome'); setScreen('legal') }}>Confidentialité et RGPD</button>
          </div>
        )}

        {screen === 'auth' && (
          <div className="auth-view">
            <button className="back" onClick={() => setScreen('welcome')} aria-label="Retour">‹</button>
            <div className="mini-brand"><Shield /><span>SafeWalk</span></div>
            <h1>{mode === 'signup' ? 'Créer votre compte' : 'Heureux de vous revoir'}</h1>
            <p className="subtitle">{mode === 'signup' ? 'Vos informations nous permettent de veiller sur vous.' : 'Connectez-vous pour retrouver votre espace sécurisé.'}</p>
            <form className="auth-form" onSubmit={submitAuth}>
              {mode === 'signup' && (
                <>
                  <div className="field-row">
                    <label>Prénom<input required minLength={2} maxLength={50} pattern="[A-Za-zÀ-ÿ' -]{2,50}" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
                    <label>Nom<input required minLength={2} maxLength={50} pattern="[A-Za-zÀ-ÿ' -]{2,50}" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
                  </div>
                  <label>Téléphone<input required type="tel" maxLength={20} pattern="(?:\+33|0)[1-9](?:[\s.-]?\d{2}){4}" placeholder="06 12 34 56 78" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
                  <label>Date de naissance<input required type="date" max={new Date().toISOString().slice(0, 10)} value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></label>
                </>
              )}
              <label>Adresse email<input required type="email" maxLength={254} autoComplete="email" placeholder="vous@exemple.fr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Mot de passe<PasswordInput required minLength={12} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
              {mode === 'signup' && <p className="password-rule">12 caractères minimum, avec majuscule, minuscule, chiffre et symbole.</p>}
              {mode === 'signup' && <label className="consent-label"><input required type="checkbox" checked={form.rgpdConsent} onChange={(e) => setForm({ ...form, rgpdConsent: e.target.checked })} /><span>J’accepte le traitement de mes données pour fournir les fonctions de sécurité et de partage SafeWalk. <button type="button" onClick={() => { setLegalReturn('auth'); setScreen('legal') }}>Lire les mentions RGPD</button></span></label>}
              {message && <p className="error-message">{message}</p>}
              <button className="primary-btn" disabled={busy}>{busy ? 'Veuillez patienter…' : mode === 'signup' ? 'Créer mon compte' : 'Continuer'}</button>
            </form>
            <p className="privacy-note">Veuillez vous assurer que vous effectuez votre identification à l’abri des regards indiscrets et dans un lieu sûr.</p>
          </div>
        )}

        {screen === 'legal' && (
          <div className="legal-view">
            <button className="back" onClick={() => setScreen(legalReturn)} aria-label="Retour">‹</button>
            <p className="eyebrow">Protection des données</p>
            <h1>Mentions RGPD</h1>
            <section><h2>Responsable et finalités</h2><p>Le responsable du traitement est l’éditeur du service SafeWalk. Les données sont utilisées pour créer votre compte, sécuriser vos trajets, gérer vos proches et permettre le suivi partagé demandé.</p></section>
            <section><h2>Données traitées</h2><p>Identité, coordonnées, date de naissance, identifiant confidentiel chiffré, proches, trajets, checkpoints et informations techniques de sécurité.</p></section>
            <section><h2>Base légale et destinataires</h2><p>Le traitement repose sur votre consentement et l’exécution du service demandé. Vos données privées sont accessibles à votre compte, aux proches choisis pour les trajets partagés et aux administrateurs autorisés.</p></section>
            <section><h2>Conservation et sécurité</h2><p>Les données sont conservées pendant l’utilisation du compte puis supprimées avec celui-ci, sous réserve des obligations légales. Les mots de passe sont hachés et les identifiants confidentiels sont chiffrés.</p></section>
            <section><h2>Vos droits</h2><p>Vous pouvez demander l’accès, la rectification, l’effacement, la limitation, la portabilité ou retirer votre consentement. Vous pouvez également saisir la CNIL. Utilisez la gestion du profil ou contactez l’éditeur du service.</p></section>
            <p className="legal-version">Version des mentions : octobre 2026</p>
          </div>
        )}

        {screen === 'home' && (
          <div className="home-view">
            <header><div className="mini-brand"><Shield /><span>SafeWalk</span></div><button className="avatar" onClick={() => { setSecureAction('profile'); setMessage('') }} aria-label="Ouvrir mon profil">{userFirstName?.[0] || 'S'}</button></header>
            <div className="home-copy"><p className="eyebrow">● Vous êtes en sécurité</p><h1>Prêt à partir ?</h1><p className="subtitle">Nous veillons sur vous jusqu’à destination.</p></div>
            <div className="start-orbit"><button className="start-btn" onClick={loadJourneyData}><span>{userFirstName || 'Vous'}</span>Commencer<strong>votre trajet</strong></button></div>
            <div className="secret-card"><span>Identifiant confidentiel</span><strong>{secret || fingerprint || '•••• •••• ••••'}</strong><div><button onClick={() => { setSecureAction('reveal'); setMessage('') }}>Révéler</button><button onClick={() => { setSecureAction('regenerate'); setMessage('') }}>Régénérer</button></div></div>
            {message && <p className="error-message">{message}</p>}
          </div>
        )}

        {screen === 'profile' && (
          <div className="profile-view">
            <header><button className="back" onClick={() => { setScreen('home'); setMessage('') }}>‹</button><div className="mini-brand"><Shield /><span>Mon profil</span></div></header>
            <p className="eyebrow">Espace personnel sécurisé</p>
            <h1>Vos informations</h1>
            <p className="subtitle">Votre email et votre date de naissance restent affichés en lecture seule.</p>
            <form className="profile-form" onSubmit={saveProfile}>
              <div className="field-row">
                <label>Prénom<input required minLength={2} maxLength={50} pattern="[A-Za-zÀ-ÿ' -]{2,50}" value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} /></label>
                <label>Nom<input required minLength={2} maxLength={50} pattern="[A-Za-zÀ-ÿ' -]{2,50}" value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} /></label>
              </div>
              <label>Adresse email<input value={profile.email} readOnly aria-readonly="true" /></label>
              <label>Date de naissance<input type="date" value={profile.birthDate} readOnly aria-readonly="true" /></label>
              <label>Numéro de téléphone<input required type="tel" maxLength={20} pattern="(?:\+33|0)[1-9](?:[\s.-]?\d{2}){4}" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
              <label>Nouveau mot de passe <span className="optional">(facultatif)</span><PasswordInput minLength={12} autoComplete="new-password" value={profile.newPassword} onChange={(e) => setProfile({ ...profile, newPassword: e.target.value })} placeholder="Laisser vide pour ne pas modifier" /></label>
              <p className="password-rule">12 caractères minimum, avec majuscule, minuscule, chiffre et symbole.</p>
              {message && <p className={message.includes('mise à jour') ? 'success-message' : 'error-message'}>{message}</p>}
              <button className="primary-btn" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les modifications'}</button>
            </form>
            <button className="logout-btn" type="button" onClick={logout}>Se déconnecter</button>
          </div>
        )}

        {screen === 'setup' && (
          <div className="setup-view">
            <header><button className="back" onClick={() => setScreen('home')}>‹</button><div className="mini-brand"><Shield /><span>SafeWalk</span></div><div className="emergency-wrap"><button className="emergency-btn" onClick={() => setEmergency(!emergency)} aria-expanded={emergency}><BellIcon /><span>Urgence</span><ChevronDownIcon /></button>{emergency && <div className="emergency-menu">{[['112','Urgences européennes'],['15','SAMU'],['17','Police secours'],['18','Pompiers'],['114','Urgence SMS']].map(([n,l]) => <a href={`tel:${n}`} key={n}><span>{l}</span><strong>{n}</strong></a>)}</div>}</div></header>
            <div className="setup-title"><p className="eyebrow">Votre accompagnement</p><h1>Préparons votre trajet</h1></div>
            <div className="favorites-panel">
              <div className="favorite-heading"><strong>Trajets favoris</strong><span>{journeys.length}</span></div>
              <div className="favorite-row">
                {journeys.length ? journeys.filter((journey) => journey.favorite !== false).map((journey) => (
                  <button className={selectedJourney === journey.id ? 'favorite-chip selected' : 'favorite-chip'} key={journey.id} onClick={() => setSelectedJourney(journey.id)}>
                    <span>{journey.name}</span><small>{journey.totalMinutes} min</small>
                    {editMode && <i><b onClick={(event) => { event.stopPropagation(); openJourneyForm(journey) }}>✎</b><b className="trash" onClick={(event) => { event.stopPropagation(); setPendingDelete({ kind: 'Journey', id: journey.id }) }}>×</b></i>}
                  </button>
                )) : <p className="empty-favorite">Aucun trajet enregistré</p>}
              </div>
              <div className="favorite-heading"><strong>Proches favoris</strong><span>{contacts.length}</span></div>
              <div className="favorite-row">
                {contacts.length ? contacts.filter((contact) => contact.favorite !== false).map((contact) => (
                  <button className={selectedContact === contact.id ? 'favorite-chip contact-chip selected' : 'favorite-chip contact-chip'} key={contact.id} onClick={() => setSelectedContact(contact.id)}>
                    <span>{contact.name}</span><small>{contact.phone}</small>
                    {editMode && <i><b onClick={(event) => { event.stopPropagation(); openContactForm(contact) }}>✎</b><b className="trash" onClick={(event) => { event.stopPropagation(); setPendingDelete({ kind: 'Contact', id: contact.id }) }}>×</b></i>}
                  </button>
                )) : <p className="empty-favorite">Aucun proche enregistré</p>}
              </div>
              {incomingJourneys.length > 0 && <><div className="favorite-heading incoming-heading"><strong>Trajets d’un proche en cours</strong><span>{incomingJourneys.length}</span></div><div className="favorite-row">{incomingJourneys.map((journey) => <button className="favorite-chip incoming-chip" key={journey.id} onClick={() => openActiveJourney(journey.id)}><span>{journey.name}</span><small>{journey.departure} → {journey.arrival}</small></button>)}</div></>}
            </div>
            {selectedJourney && <button className="launch-journey" disabled={busy} onClick={() => openActiveJourney(selectedJourney, true)}>Démarrer le trajet sélectionné</button>}
            <div className="setup-actions compact-actions"><button onClick={() => openJourneyForm()}><span className="action-icon"><RouteSmallIcon /></span><span><strong>Créer un trajet</strong><small>Ajouter des checkpoints</small></span><b>+</b></button><button onClick={() => openContactForm()}><span className="action-icon"><PersonSmallIcon /></span><span><strong>Ajouter un proche</strong><small>Créer une relation de confiance</small></span><b>+</b></button></div>
            <button className={editMode ? 'edit-toggle active' : 'edit-toggle'} onClick={() => setEditMode(!editMode)}><span>✎</span>{editMode ? 'Terminer' : 'Modifier'}</button>
          </div>
        )}

        {screen === 'contact-form' && (
          <div className="wizard-view">
            <header><button className="back" onClick={() => setScreen('setup')}>‹</button><div className="mini-brand"><Shield /><span>Nouveau proche</span></div></header>
            <p className="eyebrow">Relation de confiance</p><h1>{contactDraft.id ? 'Modifier le proche' : 'Ajouter un proche'}</h1>
            <p className="subtitle">La confirmation est automatiquement acceptée pendant la phase de test.</p>
            <form className="wizard-form" onSubmit={saveContact}>
              <label>Nom du proche<input required minLength={2} maxLength={50} pattern="[A-Za-zÀ-ÿ' -]{2,50}" value={contactDraft.name} onChange={(e) => { const next = { ...contactDraft, name: e.target.value }; setContactDraft(next); saveDraft('sw-contact-draft', next) }} /></label>
              <label>Numéro de téléphone<input required type="tel" maxLength={20} pattern="(?:\+33|0)[1-9](?:[\s.-]?\d{2}){4}" placeholder="06 12 34 56 78" value={contactDraft.phone} onChange={(e) => { const next = { ...contactDraft, phone: e.target.value }; setContactDraft(next); saveDraft('sw-contact-draft', next) }} /></label>
              <label>Identifiant secret SafeWalk<input required={!contactDraft.id} maxLength={19} pattern="SW-[A-F0-9]{16}" placeholder="SW-0000000000000000" value={contactDraft.secretIdentifier} onChange={(e) => { const next = { ...contactDraft, secretIdentifier: e.target.value.toUpperCase() }; setContactDraft(next); saveDraft('sw-contact-draft', next) }} /></label>
              <label className="check-label"><input type="checkbox" checked={contactDraft.favorite} onChange={(e) => setContactDraft({ ...contactDraft, favorite: e.target.checked })} />Ajouter aux favoris</label>
              {message && <p className="error-message">{message}</p>}
              <div className="wizard-nav"><button type="button" onClick={() => setScreen('setup')} aria-label="Étape précédente">←</button><button className="primary-btn" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le proche'}</button></div>
            </form>
          </div>
        )}

        {screen === 'journey-form' && (
          <div className="wizard-view journey-wizard">
            <header><button className="back" onClick={() => setScreen('setup')}>‹</button><div className="mini-brand"><Shield /><span>Nouveau trajet</span></div><span className="step-count">{journeyStep + 1}/3</span></header>
            {journeyStep === 0 && <div className="wizard-step"><p className="eyebrow">Étape 1</p><h1>Votre trajet</h1><label>Nom du trajet<input required minLength={2} maxLength={80} value={journeyDraft.name} onChange={(e) => updateJourneyDraft({ ...journeyDraft, name: e.target.value })} placeholder="Ex. Retour maison" /></label><label>Point de départ<input required minLength={2} maxLength={100} value={journeyDraft.departure} onChange={(e) => updateJourneyDraft({ ...journeyDraft, departure: e.target.value })} placeholder="Ex. Gare centrale" /></label><label>Temps jusqu’au premier checkpoint<input type="number" min="0" max="1440" step="1" required value={journeyDraft.departureMinutes} onChange={(e) => updateJourneyDraft({ ...journeyDraft, departureMinutes: Number(e.target.value) })} /></label><label>Point d’arrivée<input required minLength={2} maxLength={100} value={journeyDraft.arrival} onChange={(e) => updateJourneyDraft({ ...journeyDraft, arrival: e.target.value })} placeholder="Ex. Domicile" /></label><label className="check-label"><input type="checkbox" checked={journeyDraft.favorite} onChange={(e) => updateJourneyDraft({ ...journeyDraft, favorite: e.target.checked })} />Ajouter aux favoris</label></div>}
            {journeyStep === 1 && <div className="wizard-step"><p className="eyebrow">Étape 2</p><h1>Checkpoints</h1><p className="subtitle">Le départ et l’arrivée encadrent vos checkpoints. Indiquez le temps jusqu’au point suivant.</p><div className="route-sandwich start"><span>D</span><strong>{journeyDraft.departure || 'Départ'}</strong></div><div className="checkpoint-list">{journeyDraft.checkpoints.map((checkpoint, index) => <div className="checkpoint-field" key={index}><span>{index + 1}</span><input required maxLength={100} aria-label={`Checkpoint ${index + 1}`} placeholder="Lieu ou repère" value={checkpoint.label} onChange={(e) => { const checkpoints = [...journeyDraft.checkpoints]; checkpoints[index] = { ...checkpoint, label: e.target.value }; updateJourneyDraft({ ...journeyDraft, checkpoints }) }} /><input required aria-label="Durée en minutes" type="number" min="0" max="1440" step="1" value={checkpoint.minutesToNext} onChange={(e) => { const checkpoints = [...journeyDraft.checkpoints]; checkpoints[index] = { ...checkpoint, minutesToNext: Number(e.target.value) }; updateJourneyDraft({ ...journeyDraft, checkpoints }) }} /><small>min</small>{journeyDraft.checkpoints.length > 3 && <button type="button" onClick={() => updateJourneyDraft({ ...journeyDraft, checkpoints: journeyDraft.checkpoints.filter((_, itemIndex) => itemIndex !== index) })}>×</button>}</div>)}</div><div className="route-sandwich end"><span>A</span><strong>{journeyDraft.arrival || 'Arrivée'}</strong></div><button className="add-checkpoint" type="button" disabled={journeyDraft.checkpoints.length >= 20} onClick={() => updateJourneyDraft({ ...journeyDraft, checkpoints: [...journeyDraft.checkpoints, { label: '', minutesToNext: 0 }] })}>+ Ajouter un checkpoint</button><div className="total-time">Temps total estimé <strong>{journeyDraft.departureMinutes + journeyDraft.checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.minutesToNext), 0)} min</strong></div></div>}
            {journeyStep === 2 && <div className="wizard-step"><p className="eyebrow">Étape 3</p><h1>Partager avec</h1><p className="subtitle">Sélectionnez un ou plusieurs proches liés à votre compte.</p><div className="contact-select">{contacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={journeyDraft.contacts.includes(contact.id)} onChange={(e) => updateJourneyDraft({ ...journeyDraft, contacts: e.target.checked ? [...journeyDraft.contacts, contact.id] : journeyDraft.contacts.filter((id) => id !== contact.id) })} /><span>{contact.name}<small>{contact.phone}</small></span></label>)}{!contacts.length && <p className="empty-favorite">Ajoutez d’abord un proche depuis l’écran précédent.</p>}</div>{message && <p className="error-message">{message}</p>}</div>}
            <div className="wizard-nav fixed-nav"><button type="button" disabled={journeyStep === 0} onClick={() => setJourneyStep(Math.max(0, journeyStep - 1))} aria-label="Étape précédente">←</button>{journeyStep < 2 ? <button type="button" onClick={() => setJourneyStep(Math.min(2, journeyStep + 1))} aria-label="Étape suivante">→</button> : <button className="primary-btn" type="button" disabled={busy} onClick={saveJourney}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>}</div>
          </div>
        )}

        {screen === 'active-journey' && activeJourney && (() => {
          const points = [activeJourney.departure, ...activeJourney.checkpoints.map((checkpoint) => checkpoint.label), activeJourney.arrival]
          const currentIndex = activeJourney.currentIndex ?? 0
          const segmentSeconds = activeJourney.segmentEndsAt ? (new Date(activeJourney.segmentEndsAt).getTime() - clock) / 1000 : 0
          const globalEnd = activeJourney.status === 'completed' && activeJourney.completedAt ? new Date(activeJourney.completedAt).getTime() : clock
          const globalSeconds = activeJourney.startedAt ? (globalEnd - new Date(activeJourney.startedAt).getTime()) / 1000 : 0
          return <div className="active-journey-view">
            <header><button className="back" onClick={loadJourneyData}>‹</button><div><p className="eyebrow">{activeJourney.status === 'completed' ? 'Trajet terminé' : 'Trajet en cours'}</p><strong>{activeJourney.name}</strong></div>{activeJourney.status !== 'completed' && <div className="timer-stack"><div className="global-timer"><small>Temps global</small><b>{formatTime(globalSeconds)}</b></div><div className="segment-timer"><small>Prochain point</small><b>{formatTime(segmentSeconds)}</b>{segmentSeconds <= 0 && activeJourney.canControl && <button onClick={() => updateActiveJourney('addJourneyTime')}>+ 20 s</button>}</div></div>}</header>
            <div className="live-route">
              {points.map((point, index) => <div className={index <= currentIndex ? 'live-point reached' : index === currentIndex + 1 ? 'live-point current' : 'live-point'} key={`${point}-${index}`}><span>{index === 0 ? 'D' : index === points.length - 1 ? 'A' : index}</span><div><small>{index === 0 ? 'Départ' : index === points.length - 1 ? 'Destination' : `Checkpoint ${index}`}</small><strong>{point}</strong></div></div>)}
            </div>
            {activeJourney.status === 'completed' ? <div className="journey-complete"><button className="complete-close" onClick={() => { setActiveJourney(null); loadJourneyData() }} aria-label="Fermer le trajet">×</button><Shield /><strong>Vous êtes arrivé</strong><p>Le trajet est terminé.</p><div className="completed-time"><small>Temps global</small><b>{formatTime(globalSeconds)}</b></div></div> : activeJourney.canControl ? <button className="primary-btn next-point-btn" onClick={() => updateActiveJourney('advanceJourney')}>Point suivant</button> : <p className="shared-live-note">Suivi en direct du trajet de votre proche</p>}
            {message && <p className="error-message biometric-message">{message}</p>}
          </div>
        })()}

        {screen === 'admin' && (
          <div className="admin-view">
            <button className="back" onClick={() => { setScreen('welcome'); setUsers([]); setMessage('') }}>‹</button>
            <p className="eyebrow">Espace protégé</p><h1>Accès administrateur</h1>
            <p className="subtitle">À la première connexion, choisissez votre code administrateur personnel à six chiffres.</p>
            <form onSubmit={showAdmin}><input className="code-input" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="••••••" value={adminPin} onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ''))} /><button className="primary-btn" disabled={busy}>Accéder à la liste</button></form>
            {message && <p className={users.length ? 'success-message' : 'error-message'}>{message}</p>}
            <div className="user-list">{users.map((user) => <article key={user.id}><span>{user.firstName[0]}{user.lastName[0]}</span><div><strong>{user.firstName} {user.lastName}</strong><small>{user.email}</small><small>{user.phone}</small></div><i>{user.emailConfirmed ? 'Vérifié' : 'En attente'}</i><button className="admin-delete-user" onClick={() => setPendingAdminUser(user)} aria-label={`Supprimer ${user.firstName} ${user.lastName}`}><svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button></article>)}</div>
          </div>
        )}

        {secureAction && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSecureAction(null); setModalPassword(''); setMessage('') } }}>
            <section className="secure-modal" role="dialog" aria-modal="true" aria-labelledby="secure-title">
              <button className="modal-close" type="button" onClick={() => { setSecureAction(null); setModalPassword(''); setMessage('') }} aria-label="Fermer">×</button>
              <div className="modal-shield"><Shield /></div>
              <p className="eyebrow">Vérification de sécurité</p>
              <h2 id="secure-title">{secureAction === 'profile' ? 'Accéder à mon profil' : secureAction === 'regenerate' ? 'Régénérer l’identifiant' : 'Révéler l’identifiant'}</h2>
              <p className="subtitle">Saisissez votre mot de passe pour confirmer votre identité.</p>
              <form onSubmit={submitSecureAction}>
                <label>Mot de passe<PasswordInput autoFocus required autoComplete="current-password" value={modalPassword} onChange={(e) => setModalPassword(e.target.value)} /></label>
                {message && <p className="error-message">{message}</p>}
                <button className="primary-btn" disabled={busy}>{busy ? 'Vérification…' : 'Confirmer'}</button>
              </form>
            </section>
          </div>
        )}
        {pendingDelete && (
          <div className="modal-backdrop">
            <section className="secure-modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
              <div className="delete-symbol">×</div>
              <p className="eyebrow">Confirmation</p>
              <h2 id="delete-title">Êtes vous sûr de vouloir poursuivre ?</h2>
              <p className="subtitle">Cette suppression sera définitive.</p>
              <div className="delete-choices"><button className="secondary-btn" onClick={() => setPendingDelete(null)}>Non</button><button className="danger-btn" onClick={removeItem}>Oui</button></div>
            </section>
          </div>
        )}
        {pendingAdminUser && (
          <div className="modal-backdrop">
            <section className="secure-modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="admin-delete-title">
              <div className="delete-symbol">×</div>
              <p className="eyebrow">Suppression utilisateur</p>
              <h2 id="admin-delete-title">Êtes vous sûr de vouloir poursuivre ?</h2>
              <p className="subtitle">Le compte de <strong>{pendingAdminUser.firstName} {pendingAdminUser.lastName}</strong>, ses trajets et ses relations seront définitivement supprimés.</p>
              {message && <p className="error-message">{message}</p>}
              <div className="delete-choices"><button className="secondary-btn" onClick={() => { setPendingAdminUser(null); setMessage('') }}>Non</button><button className="danger-btn" disabled={busy} onClick={deleteAdminUser}>{busy ? 'Suppression…' : 'Oui'}</button></div>
            </section>
          </div>
        )}
        <div className="home-indicator" />
      </section>
    </main>
  )
}
