import 'server-only'

import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { getPayloadClient } from '@/lib/payload'

const COOKIE_NAME = 'app-session'

export function createAppAuth(collection: 'users') {
  return {
    async login(email: string, password: string) {
      const payload = await getPayloadClient()
      return payload.login({ collection, data: { email, password } })
    },
    async setSession(token: string) {
      const store = await cookies()
      store.set(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 14,
      })
    },
    async currentUser() {
      const token = (await cookies()).get(COOKIE_NAME)?.value
      if (!token) return null
      const payload = await getPayloadClient()
      const { user } = await payload.auth({
        headers: new Headers({ Authorization: `JWT ${token}` }),
      })
      return user?.collection === collection ? user : null
    },
    async logout() {
      ;(await cookies()).delete(COOKIE_NAME)
    },
  }
}

export const appAuth = createAppAuth('users')

export const hashValue = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex')

export function createPersonalSecret() {
  return `SW-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
}

export function encryptSecret(secret: string, password: string) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(password, salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [salt, iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.')
}

export function decryptSecret(value: string, password: string) {
  const [salt, iv, tag, encrypted] = value
    .split('.')
    .map((part) => Buffer.from(part, 'base64url'))
  const key = crypto.scryptSync(password, salt, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  )
}
