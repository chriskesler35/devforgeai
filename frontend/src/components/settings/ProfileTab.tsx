// Extracted from settings/page.tsx. Lightweight user-profile form
// (name + email) that mirrors into USER.md so the AI sees your identity.
// State and the saveProfile handler live in SettingsPageContent and are
// passed as props — keeping the data flow visible in the parent.

'use client'

interface UserProfile {
  id: string
  name: string
  email?: string
  preferences: Record<string, any>
}

interface ProfileTabProps {
  profile: UserProfile | null
  setProfile: (p: UserProfile | null) => void
  profileSaving: boolean
  profileSaved: boolean
  onSave: () => void | Promise<void>
}

export function ProfileTab({ profile, setProfile, profileSaving, profileSaved, onSave }: ProfileTabProps) {
  return (
    <div className="bg-white shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-medium text-gray-900">User Profile</h3>
          {profileSaved && <span className="text-sm text-green-600 font-medium animate-pulse">Saved!</span>}
        </div>
        <p className="mt-1 text-sm text-gray-500 mb-4">
          Saved here and synced to your AI&apos;s USER.md so it knows who you are.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={profile?.name || ''}
              onChange={(e) => setProfile({ ...profile!, name: e.target.value })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={profile?.email || ''}
              onChange={(e) => setProfile({ ...profile!, email: e.target.value })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div className="pt-1">
            <p className="text-xs text-gray-400 mb-3">
              💡 For richer context (timezone, preferences, projects), use <strong>Settings → Identity → Your Profile</strong> to edit USER.md directly.
            </p>
            <button
              type="button"
              onClick={onSave}
              disabled={profileSaving}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300"
            >
              {profileSaving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
