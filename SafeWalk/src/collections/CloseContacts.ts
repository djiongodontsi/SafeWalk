import type { Access, CollectionConfig } from 'payload'

const ownsContact: Access = ({ req }) =>
  req.user?.collection === 'users'
    ? { owner: { equals: req.user.id } }
    : false

export const CloseContacts: CollectionConfig = {
  slug: 'close-contacts',
  admin: { hidden: true, useAsTitle: 'name' },
  access: {
    create: ({ req }) => req.user?.collection === 'users',
    read: ownsContact,
    update: ownsContact,
    delete: ownsContact,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'phone', type: 'text', required: true },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    {
      name: 'relatedUser',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    { name: 'favorite', type: 'checkbox', defaultValue: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'accepted',
      options: [
        { label: 'En attente', value: 'pending' },
        { label: 'Accepté', value: 'accepted' },
      ],
      required: true,
    },
  ],
  versions: false,
}
