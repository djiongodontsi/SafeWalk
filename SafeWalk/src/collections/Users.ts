import type { Access, CollectionConfig } from 'payload'

const isSelf: Access = ({ req }) =>
  req.user?.collection === 'users' ? { id: { equals: req.user.id } } : false

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: { hidden: true, useAsTitle: 'email' },
  access: {
    create: () => false,
    read: isSelf,
    update: isSelf,
    delete: isSelf,
  },
  fields: [
    { name: 'firstName', type: 'text', required: true },
    { name: 'lastName', type: 'text', required: true },
    { name: 'phone', type: 'text', required: true },
    { name: 'birthDate', type: 'date', required: true },
    { name: 'emailConfirmed', type: 'checkbox', defaultValue: false },
    { name: 'secretFingerprint', type: 'text', required: true },
    { name: 'secretLookupHash', type: 'text', unique: true, hidden: true },
    { name: 'encryptedSecret', type: 'text', required: true, hidden: true },
    { name: 'accountActive', type: 'checkbox', defaultValue: true },
    { name: 'rgpdConsent', type: 'checkbox', defaultValue: false },
    { name: 'rgpdConsentDate', type: 'date' },
    { name: 'rgpdConsentVersion', type: 'text' },
    { name: 'webauthnChallenge', type: 'text', hidden: true },
    { name: 'webauthnPurpose', type: 'text', hidden: true },
    { name: 'webauthnOrigin', type: 'text', hidden: true },
    { name: 'webauthnRPID', type: 'text', hidden: true },
    { name: 'biometricGrantPurpose', type: 'text', hidden: true },
    { name: 'biometricGrantExpiresAt', type: 'date', hidden: true },
    { name: 'verificationCodeHash', type: 'text', hidden: true },
    { name: 'verificationCodeExpiresAt', type: 'date', hidden: true },
  ],
  versions: false,
}
