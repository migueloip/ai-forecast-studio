import { Bookmark as BookmarkIcon, Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createBookmark, deleteBookmark, listBookmarks } from '../api'
import { safeErrorMessage } from '../errors'

export function BookmarkButton({ datasetId, resourceType, resourceId, title, actionUrl }: { datasetId?: string | null; resourceType: string; resourceId: string; title: string; actionUrl: string }) {
  const [bookmarkId, setBookmarkId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    listBookmarks().then(({ bookmarks }) => {
      if (active) setBookmarkId(bookmarks.find((item) => item.resource_type === resourceType && item.resource_id === resourceId)?.id ?? null)
    }).catch(() => undefined)
    return () => { active = false }
  }, [resourceId, resourceType])

  const toggle = async () => {
    if (saving) return
    try {
      setSaving(true)
      setError('')
      if (bookmarkId) {
        await deleteBookmark(bookmarkId)
        setBookmarkId(null)
      } else {
        const result = await createBookmark({ datasetId, resourceType, resourceId, title, actionUrl })
        setBookmarkId(result.bookmark.id)
      }
    } catch (cause) {
      setError(safeErrorMessage(cause, 'The bookmark could not be updated.'))
    } finally {
      setSaving(false)
    }
  }

  return <button className={`bookmark-button ${bookmarkId ? 'active' : ''}`} onClick={() => { void toggle() }} disabled={saving} title={error || (bookmarkId ? 'Remove bookmark' : 'Save bookmark')}>{bookmarkId ? <Check size={13}/> : <BookmarkIcon size={13}/>}<span>{bookmarkId ? 'Saved' : 'Bookmark'}</span></button>
}
