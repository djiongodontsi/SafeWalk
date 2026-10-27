import { appAuth, createPersonalSecret, decryptSecret, encryptSecret, hashValue } from '@/lib/app-auth'
import { getPayloadClient } from '@/lib/payload'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phonePattern = /^(?:\+33|0)[1-9](?:[\s.-]?\d{2}){4}$/
const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/
const personNamePattern = /^[\p{L}][\p{L}\p{M}' -]{1,49}$/u
const secretIdentifierPattern = /^SW-[A-F0-9]{16}$/
const RGPD_VERSION = '2026-10'

function response(data: object, status = 200) {
  return Response.json(data, { status })
}

async function syncCurrentSecret(
  payload: Awaited<ReturnType<typeof getPayloadClient>>,
  userId: string,
  password: string,
) {
  const result = await payload.find({
    collection: 'users',
    where: { id: { equals: userId } },
    limit: 1,
    showHiddenFields: true,
    overrideAccess: true,
  })
  const user = result.docs[0]
  if (!user?.encryptedSecret) return
  const currentSecret = decryptSecret(user.encryptedSecret, password)
  const secretLookupHash = hashValue(currentSecret)
  if (user.secretLookupHash !== secretLookupHash) {
    await payload.update({
      collection: 'users',
      id: userId,
      data: { secretLookupHash },
      overrideAccess: true,
    })
  }
  return currentSecret
}

async function verifyAdminPin(
  payload: Awaited<ReturnType<typeof getPayloadClient>>,
  pin: string,
) {
  if (!/^\d{6}$/.test(pin))
    return { ok: false, error: 'Saisissez un code à 6 chiffres.', status: 400 }
  const settings = await payload.find({
    collection: 'app-settings',
    limit: 1,
    showHiddenFields: true,
    overrideAccess: true,
  })
  const config = settings.docs[0]
  if (!config) return { ok: true, firstUse: true }
  if (
    config.adminLockedUntil &&
    new Date(config.adminLockedUntil).getTime() > Date.now()
  ) {
    const minutes = Math.max(
      1,
      Math.ceil(
        (new Date(config.adminLockedUntil).getTime() - Date.now()) / 60_000,
      ),
    )
    return {
      ok: false,
      error: `Trop de tentatives. Réessayez dans ${minutes} minute(s).`,
      status: 429,
    }
  }
  if (config.adminPinHash !== hashValue(pin)) {
    const attempts = Number(config.adminFailedAttempts ?? 0) + 1
    await payload.update({
      collection: 'app-settings',
      id: config.id,
      data: {
        adminFailedAttempts: attempts >= 5 ? 0 : attempts,
        adminLockedUntil:
          attempts >= 5
            ? new Date(Date.now() + 15 * 60_000).toISOString()
            : null,
      },
      overrideAccess: true,
    })
    return {
      ok: false,
      error:
        attempts >= 5
          ? 'Trop de tentatives. Accès verrouillé pendant 15 minutes.'
          : `Code incorrect. ${5 - attempts} tentative(s) restante(s).`,
      status: attempts >= 5 ? 429 : 403,
    }
  }
  await payload.update({
    collection: 'app-settings',
    id: config.id,
    data: { adminFailedAttempts: 0, adminLockedUntil: null },
    overrideAccess: true,
  })
  return { ok: true, firstUse: false }
}

async function getHiddenUser(
  payload: Awaited<ReturnType<typeof getPayloadClient>>,
  userId: string,
) {
  const result = await payload.find({
    collection: 'users',
    where: { id: { equals: userId } },
    limit: 1,
    showHiddenFields: true,
    overrideAccess: true,
  })
  return result.docs[0]
}

async function hasBiometricGrant(
  payload: Awaited<ReturnType<typeof getPayloadClient>>,
  userId: string,
  purpose: 'journey-start' | 'journey-finish',
) {
  const user = await getHiddenUser(payload, userId)
  return Boolean(
    user?.biometricGrantPurpose === purpose &&
      user.biometricGrantExpiresAt &&
      new Date(user.biometricGrantExpiresAt).getTime() > Date.now(),
  )
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const action = String(body.action ?? '')
    const payload = await getPayloadClient()

    if (action === 'signup') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const firstName = String(body.firstName ?? '').trim()
      const lastName = String(body.lastName ?? '').trim()
      const phone = String(body.phone ?? '').trim()
      const birthDate = String(body.birthDate ?? '')
      const birth = new Date(birthDate)
      const oldest = new Date()
      oldest.setFullYear(oldest.getFullYear() - 120)
      if (
        !personNamePattern.test(firstName) ||
        !personNamePattern.test(lastName) ||
        !emailPattern.test(email) ||
        !phonePattern.test(phone) ||
        !birthDate ||
        Number.isNaN(birth.getTime()) ||
        birth > new Date() ||
        birth < oldest ||
        body.rgpdConsent !== true
      )
        return response({ error: 'Vérifiez vos informations personnelles.' }, 400)
      if (!strongPassword.test(password))
        return response({ error: 'Le mot de passe doit contenir au moins 12 caractères, une minuscule, une majuscule, un chiffre et un symbole.' }, 400)
      const secret = createPersonalSecret()
      const user = await payload.create({
        collection: 'users',
        data: {
          email,
          password,
          firstName,
          lastName,
          phone,
          birthDate,
          emailConfirmed: true,
          secretFingerprint: `•••• •••• ${secret.slice(-4)}`,
          secretLookupHash: hashValue(secret),
          encryptedSecret: encryptSecret(secret, password),
          accountActive: true,
          rgpdConsent: true,
          rgpdConsentDate: new Date().toISOString(),
          rgpdConsentVersion: RGPD_VERSION,
        },
        overrideAccess: true,
      })
      const login = await appAuth.login(email, password)
      if (!login.token) return response({ error: 'Session indisponible.' }, 500)
      await appAuth.setSession(login.token)
      return response({
        ok: true,
        name: user.firstName,
        fingerprint: user.secretFingerprint,
      })
    }

    if (action === 'login') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const result = await appAuth.login(email, password)
      if (!result.user) return response({ error: 'Identifiants invalides.' }, 401)
      await syncCurrentSecret(payload, result.user.id, password)
      if (!result.token) return response({ error: 'Session indisponible.' }, 500)
      await appAuth.setSession(result.token)
      return response({
        ok: true,
        name: result.user.firstName,
        fingerprint: result.user.secretFingerprint,
      })
    }

    if (action === 'biometricOptions' || action === 'biometricVerify') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const purpose =
        body.purpose === 'journey-finish'
          ? 'journey-finish'
          : 'journey-start'
      const login = await appAuth.login(email, password)
      const current = login.user
      if (!current) return response({ error: 'Identifiants invalides.' }, 401)
      const origin = request.headers.get('origin')
      if (!origin)
        return response(
          { error: 'La vérification biométrique nécessite une origine sécurisée.' },
          400,
        )
      const originURL = new URL(origin)
      if (
        originURL.protocol !== 'https:' &&
        !['localhost', '127.0.0.1'].includes(originURL.hostname)
      )
        return response({ error: 'Face ID nécessite une connexion HTTPS.' }, 400)
      const rpID = originURL.hostname
      const passkeys = await payload.find({
        collection: 'passkeys',
        where: { owner: { equals: current.id } },
        depth: 0,
        limit: 10,
        overrideAccess: true,
      })

      if (action === 'biometricOptions') {
        const mode = passkeys.docs.length ? 'authenticate' : 'register'
        const options =
          mode === 'register'
            ? await generateRegistrationOptions({
                rpName: 'SafeWalk',
                rpID,
                userName: current.email,
                userDisplayName: `${current.firstName} ${current.lastName}`,
                userID: new TextEncoder().encode(String(current.id)),
                attestationType: 'none',
                authenticatorSelection: {
                  authenticatorAttachment: 'platform',
                  residentKey: 'preferred',
                  userVerification: 'required',
                },
                preferredAuthenticatorType: 'localDevice',
              })
            : await generateAuthenticationOptions({
                rpID,
                userVerification: 'required',
                allowCredentials: passkeys.docs.map((passkey) => ({
                  id: passkey.credentialID,
                  transports: Array.isArray(passkey.transports)
                    ? (passkey.transports as string[])
                    : undefined,
                })),
              })
        await payload.update({
          collection: 'users',
          id: current.id,
          data: {
            webauthnChallenge: options.challenge,
            webauthnPurpose: purpose,
            webauthnOrigin: origin,
            webauthnRPID: rpID,
          },
          overrideAccess: true,
        })
        return response({ mode, options })
      }

      const hiddenUser = await getHiddenUser(payload, current.id)
      if (
        !hiddenUser?.webauthnChallenge ||
        hiddenUser.webauthnPurpose !== purpose ||
        hiddenUser.webauthnOrigin !== origin ||
        hiddenUser.webauthnRPID !== rpID
      )
        return response({ error: 'Challenge biométrique invalide.' }, 400)

      if (body.mode === 'register') {
        const verification = await verifyRegistrationResponse({
          response: body.credential as RegistrationResponseJSON,
          expectedChallenge: hiddenUser.webauthnChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        })
        if (!verification.verified)
          return response({ error: 'Vérification biométrique refusée.' }, 401)
        const credential = verification.registrationInfo.credential
        await payload.create({
          collection: 'passkeys',
          data: {
            owner: current.id,
            credentialID: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString('base64url'),
            counter: credential.counter,
            transports: credential.transports ?? [],
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
          },
          overrideAccess: true,
        })
      } else {
        const credentialResponse =
          body.credential as AuthenticationResponseJSON
        const passkey = passkeys.docs.find(
          (item) => item.credentialID === credentialResponse.id,
        )
        if (!passkey)
          return response({ error: 'Passkey inconnue.' }, 404)
        const verification = await verifyAuthenticationResponse({
          response: credentialResponse,
          expectedChallenge: hiddenUser.webauthnChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: {
            id: passkey.credentialID,
            publicKey: new Uint8Array(
              Buffer.from(passkey.publicKey, 'base64url'),
            ),
            counter: passkey.counter,
            transports: Array.isArray(passkey.transports)
              ? (passkey.transports as string[])
              : undefined,
          },
          requireUserVerification: true,
        })
        if (!verification.verified)
          return response({ error: 'Vérification biométrique refusée.' }, 401)
        await payload.update({
          collection: 'passkeys',
          id: passkey.id,
          data: { counter: verification.authenticationInfo.newCounter },
          overrideAccess: true,
        })
      }
      await payload.update({
        collection: 'users',
        id: current.id,
        data: {
          biometricGrantPurpose: purpose,
          biometricGrantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
          webauthnChallenge: null,
        },
        overrideAccess: true,
      })
      return response({ verified: true })
    }

    if (action === 'reveal' || action === 'regenerate') {
      const login = await appAuth.login(
        String(body.email ?? '').trim().toLowerCase(),
        String(body.password ?? ''),
      )
      const current = login.user
      if (!current) return response({ error: 'Identifiants invalides.' }, 401)
      const docs = await payload.find({
        collection: 'users',
        where: { id: { equals: current.id } },
        limit: 1,
        showHiddenFields: true,
        overrideAccess: true,
      })
      const user = docs.docs[0]
      if (action === 'reveal') {
        const secret = decryptSecret(
          user.encryptedSecret,
          String(body.password),
        )
        await payload.update({
          collection: 'users',
          id: current.id,
          data: { secretLookupHash: hashValue(secret) },
          overrideAccess: true,
        })
        return response({ secret })
      }
      const secret = createPersonalSecret()
      const encryptedSecret = encryptSecret(secret, String(body.password))
      const secretFingerprint = `•••• •••• ${secret.slice(-4)}`
      await payload.update({ collection: 'users', id: current.id, data: { encryptedSecret, secretFingerprint, secretLookupHash: hashValue(secret) }, overrideAccess: true })
      return response({ secret, fingerprint: secretFingerprint })
    }

    if (
      [
        'journeyData',
        'createContact',
        'createJourney',
        'updateContact',
        'updateJourney',
        'deleteContact',
        'deleteJourney',
        'startJourney',
        'journeyState',
        'advanceJourney',
        'addJourneyTime',
      ].includes(action)
    ) {
      const login = await appAuth.login(
        String(body.email ?? '').trim().toLowerCase(),
        String(body.password ?? ''),
      )
      const current = login.user
      if (!current) return response({ error: 'Identifiants invalides.' }, 401)

      if (action === 'journeyData') {
        const [contacts, journeys, incomingJourneys] = await Promise.all([
          payload.find({
            collection: 'close-contacts',
            where: { owner: { equals: current.id } },
            limit: 50,
            depth: 0,
            user: current,
            overrideAccess: false,
          }),
          payload.find({
            collection: 'journeys',
            where: { owner: { equals: current.id } },
            limit: 50,
            depth: 0,
            user: current,
            overrideAccess: false,
          }),
          payload.find({
            collection: 'journeys',
            where: {
              and: [
                { participants: { contains: current.id } },
                { status: { equals: 'active' } },
              ],
            },
            limit: 50,
            depth: 0,
            user: current,
            overrideAccess: false,
          }),
        ])
        return response({
          contacts: contacts.docs.map((contact) => ({
            id: contact.id,
            name: contact.name,
            phone: contact.phone,
            favorite: contact.favorite,
            relatedUser: contact.relatedUser,
          })),
          journeys: journeys.docs.map((journey) => ({
            id: journey.id,
            name: journey.name,
            departure: journey.departure ?? 'Départ',
            arrival: journey.arrival ?? 'Arrivée',
            departureMinutes: journey.departureMinutes ?? 0,
            checkpoints: journey.checkpoints,
            totalMinutes: journey.totalMinutes,
            contacts: journey.contacts,
            favorite: journey.favorite,
          })),
          incomingJourneys: incomingJourneys.docs.map((journey) => ({
            id: journey.id,
            name: journey.name,
            departure: journey.departure ?? 'Départ',
            arrival: journey.arrival ?? 'Arrivée',
            status: journey.status,
          })),
        })
      }

      if (action === 'createContact' || action === 'updateContact') {
        const name = String(body.name ?? '').trim()
        const phone = String(body.phone ?? '').trim()
        const secretIdentifier = String(body.secretIdentifier ?? '')
          .trim()
          .toUpperCase()
        if (
          !personNamePattern.test(name) ||
          !phonePattern.test(phone) ||
          (secretIdentifier &&
            !secretIdentifierPattern.test(secretIdentifier))
        )
          return response({ error: 'Vérifiez le nom et le téléphone.' }, 400)
        let relatedUserId = body.relatedUserId
        if (action === 'createContact' || secretIdentifier) {
          const related = await payload.find({
            collection: 'users',
            where: {
              secretLookupHash: { equals: hashValue(secretIdentifier) },
            },
            limit: 1,
            overrideAccess: true,
          })
          if (!related.docs[0])
            return response(
              {
                error:
                  'Identifiant secret introuvable. Vérifiez qu’il s’agit bien de l’identifiant actuel du proche.',
              },
              404,
            )
          relatedUserId = related.docs[0].id
        }
        const data = {
          name,
          phone,
          owner: current.id,
          relatedUser: relatedUserId,
          favorite: body.favorite !== false,
          status: 'accepted' as const,
        }
        const contact =
          action === 'createContact'
            ? await payload.create({
                collection: 'close-contacts',
                data,
                user: current,
                overrideAccess: false,
              })
            : await payload.update({
                collection: 'close-contacts',
                id: body.id,
                data,
                user: current,
                overrideAccess: false,
              })
        return response({
          contact: {
            id: contact.id,
            name: contact.name,
            phone: contact.phone,
            favorite: contact.favorite,
            relatedUser: contact.relatedUser,
          },
        })
      }

      if (action === 'createJourney' || action === 'updateJourney') {
        const name = String(body.name ?? '').trim()
        const departure = String(body.departure ?? '').trim()
        const arrival = String(body.arrival ?? '').trim()
        const departureMinutes = Number(body.departureMinutes ?? 0)
        const checkpoints = Array.isArray(body.checkpoints)
          ? body.checkpoints.map((checkpoint: Record<string, unknown>) => ({
              label: String(checkpoint.label ?? '').trim(),
              minutesToNext: Number(checkpoint.minutesToNext ?? 0),
            }))
          : []
        if (
          !name ||
          name.length > 80 ||
          !departure ||
          departure.length > 100 ||
          !arrival ||
          arrival.length > 100 ||
          !Number.isFinite(departureMinutes) ||
          !Number.isInteger(departureMinutes) ||
          departureMinutes < 0 ||
          departureMinutes > 1440 ||
          checkpoints.length < 3 ||
          checkpoints.length > 20 ||
          checkpoints.some(
            (checkpoint: { label: string; minutesToNext: number }) =>
              !checkpoint.label ||
              checkpoint.label.length > 100 ||
              !Number.isFinite(checkpoint.minutesToNext) ||
              !Number.isInteger(checkpoint.minutesToNext) ||
              checkpoint.minutesToNext < 0 ||
              checkpoint.minutesToNext > 1440,
          )
        )
          return response(
            {
              error:
                'Ajoutez un départ, une arrivée et au moins trois checkpoints valides.',
            },
            400,
          )
        const contactIds = Array.isArray(body.contacts) ? body.contacts : []
        const selectedContacts = contactIds.length
          ? await payload.find({
              collection: 'close-contacts',
              where: {
                and: [
                  { owner: { equals: current.id } },
                  { id: { in: contactIds } },
                ],
              },
              depth: 0,
              limit: 50,
              user: current,
              overrideAccess: false,
            })
          : { docs: [] }
        const data = {
          name,
          departure,
          arrival,
          departureMinutes,
          owner: current.id,
          checkpoints,
          totalMinutes:
            departureMinutes +
            checkpoints.reduce(
            (sum: number, checkpoint: { minutesToNext: number }) =>
              sum + checkpoint.minutesToNext,
            0,
          ),
          contacts: contactIds,
          participants: selectedContacts.docs.map((contact) =>
            typeof contact.relatedUser === 'object'
              ? contact.relatedUser.id
              : contact.relatedUser,
          ),
          favorite: body.favorite !== false,
        }
        const journey =
          action === 'createJourney'
            ? await payload.create({
                collection: 'journeys',
                data,
                user: current,
                overrideAccess: false,
              })
            : await payload.update({
                collection: 'journeys',
                id: body.id,
                data,
                user: current,
                overrideAccess: false,
              })
        return response({
          journey: {
            id: journey.id,
            name: journey.name,
            totalMinutes: journey.totalMinutes,
          },
        })
      }

      if (
        ['startJourney', 'journeyState', 'advanceJourney', 'addJourneyTime'].includes(
          action,
        )
      ) {
        const found = await payload.find({
          collection: 'journeys',
          where: { id: { equals: body.id } },
          limit: 1,
          depth: 0,
          user: current,
          overrideAccess: false,
        })
        const journey = found.docs[0]
        if (!journey) return response({ error: 'Trajet introuvable.' }, 404)
        const isOwner =
          (typeof journey.owner === 'object'
            ? journey.owner.id
            : journey.owner) === current.id
        if (action !== 'journeyState' && !isOwner)
          return response(
            { error: 'Seul le créateur peut piloter ce trajet.' },
            403,
          )
        const durations = [
          Number(journey.departureMinutes ?? 0),
          ...journey.checkpoints.map((checkpoint) =>
            Number(checkpoint.minutesToNext),
          ),
        ]
        if (action === 'startJourney') {
          if (
            !(await hasBiometricGrant(
              payload,
              current.id,
              'journey-start',
            ))
          )
            return response(
              { error: 'Validation Face ID requise pour démarrer.' },
              403,
            )
          const startedAt = new Date()
          const segmentEndsAt = new Date(
            startedAt.getTime() + durations[0] * 60_000,
          )
          await payload.update({
            collection: 'journeys',
            id: journey.id,
            data: {
              status: 'active',
              currentIndex: 0,
              startedAt: startedAt.toISOString(),
              segmentEndsAt: segmentEndsAt.toISOString(),
            },
            user: current,
            overrideAccess: false,
          })
          await payload.update({
            collection: 'users',
            id: current.id,
            data: {
              biometricGrantPurpose: null,
              biometricGrantExpiresAt: null,
            },
            overrideAccess: true,
          })
        }
        if (action === 'advanceJourney') {
          const nextIndex = Number(journey.currentIndex ?? 0) + 1
          const finishing = nextIndex >= durations.length
          if (
            finishing &&
            !(await hasBiometricGrant(
              payload,
              current.id,
              'journey-finish',
            ))
          )
            return response(
              { error: 'Validation Face ID requise pour confirmer l’arrivée.' },
              403,
            )
          await payload.update({
            collection: 'journeys',
            id: journey.id,
            data:
              nextIndex >= durations.length
                ? {
                    status: 'completed',
                    currentIndex: nextIndex,
                    completedAt: new Date().toISOString(),
                  }
                : {
                    currentIndex: nextIndex,
                    segmentEndsAt: new Date(
                      Date.now() + durations[nextIndex] * 60_000,
                    ).toISOString(),
                  },
            user: current,
            overrideAccess: false,
          })
          if (finishing)
            await payload.update({
              collection: 'users',
              id: current.id,
              data: {
                biometricGrantPurpose: null,
                biometricGrantExpiresAt: null,
              },
              overrideAccess: true,
            })
        }
        if (action === 'addJourneyTime') {
          const currentEnd = journey.segmentEndsAt
            ? new Date(journey.segmentEndsAt).getTime()
            : Date.now()
          await payload.update({
            collection: 'journeys',
            id: journey.id,
            data: {
              segmentEndsAt: new Date(
                Math.max(Date.now(), currentEnd) + 20_000,
              ).toISOString(),
            },
            user: current,
            overrideAccess: false,
          })
        }
        const refreshed = await payload.find({
          collection: 'journeys',
          where: { id: { equals: journey.id } },
          limit: 1,
          depth: 0,
          user: current,
          overrideAccess: false,
        })
        const state = refreshed.docs[0]
        return response({
          journey: {
            id: state.id,
            name: state.name,
            departure: state.departure ?? 'Départ',
            arrival: state.arrival ?? 'Arrivée',
            checkpoints: state.checkpoints,
            totalMinutes: state.totalMinutes,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            segmentEndsAt: state.segmentEndsAt,
            currentIndex: state.currentIndex ?? 0,
            owner: typeof state.owner === 'object' ? state.owner.id : state.owner,
            canControl: isOwner,
          },
        })
      }

      const isContact = action === 'deleteContact'
      await payload.delete({
        collection: isContact ? 'close-contacts' : 'journeys',
        id: body.id,
        user: current,
        overrideAccess: false,
      })
      return response({ ok: true })
    }

    if (action === 'getProfile') {
      const login = await appAuth.login(
        String(body.email ?? '').trim().toLowerCase(),
        String(body.password ?? ''),
      )
      const current = login.user
      if (!current) return response({ error: 'Identifiants invalides.' }, 401)
      return response({
        profile: {
          firstName: current.firstName,
          lastName: current.lastName,
          email: current.email,
          phone: current.phone,
          birthDate: current.birthDate,
        },
      })
    }

    if (action === 'updateProfile') {
      const currentPassword = String(body.currentPassword ?? '')
      const login = await appAuth.login(
        String(body.email ?? '').trim().toLowerCase(),
        currentPassword,
      )
      const current = login.user
      if (!current) return response({ error: 'Identifiants invalides.' }, 401)
      const firstName = String(body.firstName ?? '').trim()
      const lastName = String(body.lastName ?? '').trim()
      const phone = String(body.phone ?? '').trim()
      const newPassword = String(body.newPassword ?? '')
      if (
        !personNamePattern.test(firstName) ||
        !personNamePattern.test(lastName) ||
        !phonePattern.test(phone)
      )
        return response({ error: 'Vérifiez le nom, le prénom et le téléphone.' }, 400)
      if (newPassword && !strongPassword.test(newPassword))
        return response({ error: 'Le nouveau mot de passe doit contenir au moins 12 caractères, une minuscule, une majuscule, un chiffre et un symbole.' }, 400)

      const data: Record<string, unknown> = { firstName, lastName, phone }
      if (newPassword) {
        const docs = await payload.find({
          collection: 'users',
          where: { id: { equals: current.id } },
          limit: 1,
          showHiddenFields: true,
          overrideAccess: true,
        })
        const personalSecret = decryptSecret(
          docs.docs[0].encryptedSecret,
          currentPassword,
        )
        data.password = newPassword
        data.encryptedSecret = encryptSecret(personalSecret, newPassword)
      }
      await payload.update({
        collection: 'users',
        id: current.id,
        data,
        user: current,
        overrideAccess: false,
      })
      return response({ ok: true, firstName, lastName, phone })
    }

    if (action === 'logout') {
      await appAuth.logout()
      return response({ ok: true })
    }

    if (action === 'adminList') {
      const pin = String(body.pin ?? '')
      const verification = await verifyAdminPin(payload, pin)
      if (!verification.ok)
        return response(
          { error: verification.error },
          verification.status,
        )
      if (verification.firstUse)
        await payload.create({
          collection: 'app-settings',
          data: {
            adminPinHash: hashValue(pin),
            adminFailedAttempts: 0,
          },
          overrideAccess: true,
        })
      const users = await payload.find({ collection: 'users', limit: 50, overrideAccess: true, sort: '-createdAt' })
      return response({ users: users.docs.map((user) => ({
        id: user.id, firstName: user.firstName, lastName: user.lastName,
        email: user.email, phone: user.phone, emailConfirmed: user.emailConfirmed,
      })) })
    }

    if (action === 'adminDeleteUser') {
      const pin = String(body.pin ?? '')
      const verification = await verifyAdminPin(payload, pin)
      if (!verification.ok || verification.firstUse)
        return response(
          { error: verification.error ?? 'Accès administrateur non initialisé.' },
          verification.status ?? 403,
        )

      const userId = String(body.userId ?? '')
      const target = await payload.find({
        collection: 'users',
        where: { id: { equals: userId } },
        limit: 1,
        overrideAccess: true,
      })
      if (!target.docs[0])
        return response({ error: 'Utilisateur introuvable.' }, 404)

      const [relatedContacts, affectedJourneys] = await Promise.all([
        payload.find({
          collection: 'close-contacts',
          where: {
            or: [
              { owner: { equals: userId } },
              { relatedUser: { equals: userId } },
            ],
          },
          depth: 0,
          limit: 100,
          overrideAccess: true,
        }),
        payload.find({
          collection: 'journeys',
          where: {
            or: [
              { owner: { equals: userId } },
              { participants: { contains: userId } },
            ],
          },
          depth: 0,
          limit: 100,
          overrideAccess: true,
        }),
      ])
      const contactIds = new Set(
        relatedContacts.docs.map((contact) => String(contact.id)),
      )

      for (const journey of affectedJourneys.docs) {
        const ownerId =
          typeof journey.owner === 'object' ? journey.owner.id : journey.owner
        if (String(ownerId) === userId) {
          await payload.delete({
            collection: 'journeys',
            id: journey.id,
            overrideAccess: true,
          })
        } else {
          await payload.update({
            collection: 'journeys',
            id: journey.id,
            data: {
              participants: (journey.participants ?? [])
                .map((participant) =>
                  typeof participant === 'object'
                    ? participant.id
                    : participant,
                )
                .filter((participant) => String(participant) !== userId),
              contacts: (journey.contacts ?? [])
                .map((contact) =>
                  typeof contact === 'object' ? contact.id : contact,
                )
                .filter((contact) => !contactIds.has(String(contact))),
            },
            overrideAccess: true,
          })
        }
      }
      for (const contact of relatedContacts.docs) {
        await payload.delete({
          collection: 'close-contacts',
          id: contact.id,
          overrideAccess: true,
        })
      }
      await payload.delete({
        collection: 'users',
        id: userId,
        overrideAccess: true,
      })
      return response({ ok: true })
    }

    return response({ error: 'Action inconnue.' }, 400)
  } catch (error) {
    const message = error instanceof Error && /email|mot de passe|code|configuré/i.test(error.message)
      ? error.message
      : 'Une erreur est survenue. Vérifiez les informations saisies.'
    return response({ error: message }, 400)
  }
}
