import type { Access, CollectionConfig } from 'payload'

const ownsPasskey: Access = ({ req }) =>
  req.user?.collection === 'users'
    ? { owner: { equals: req.user.id } }
    : false

export const Passkeys: CollectionConfig = {
  slug: 'passkeys',
  admin: { hidden: true, useAsTitle: 'credentialID' },
  access: {
    create: () => false,
    read: ownsPasskey,
    update: ownsPasskey,
    delete: ownsPasskey,
  },
  fields: [
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    { name: 'credentialID', type: 'text', required: true, unique: true },
    { name: 'publicKey', type: 'textarea', required: true },
    { name: 'counter', type: 'number', required: true, defaultValue: 0 },
    { name: 'transports', type: 'json' },
    { name: 'deviceType', type: 'text' },
    { name: 'backedUp', type: 'checkbox', defaultValue: false },
  ],
  versions: false,
}
