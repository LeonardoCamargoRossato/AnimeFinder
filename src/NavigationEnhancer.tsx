import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'

export default function NavigationEnhancer() {
  const location = useLocation()
  const navigate = useNavigate()
  const [gearHost, setGearHost] = useState<HTMLElement | null>(null)
  const [importHost, setImportHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let mountedGearHost: HTMLDivElement | null = null
    let mountedImportHost: HTMLDivElement | null = null

    const sync = () => {
      const nav = document.querySelector('.main-nav')
      if (nav) {
        const watchedLink = nav.querySelector('a[href*="/app/my-anime"]') as HTMLElement | null
        const importLink = nav.querySelector('a[href*="/app/import"]') as HTMLElement | null
        const settingsLink = nav.querySelector('a[href*="/app/settings"]') as HTMLElement | null

        if (watchedLink && watchedLink.textContent !== 'My Watched Anime') watchedLink.textContent = 'My Watched Anime'
        if (importLink) importLink.style.display = 'none'
        if (settingsLink) settingsLink.style.display = 'none'
      }

      const userTools = document.querySelector('.user-tools')
      const themeButton = userTools?.querySelector('.icon-button')
      if (userTools && themeButton) {
        const existing = userTools.querySelector(':scope > .settings-gear-host') as HTMLDivElement | null
        if (existing) {
          mountedGearHost = existing
          setGearHost(existing)
        } else {
          const host = document.createElement('div')
          host.className = 'settings-gear-host'
          themeButton.insertAdjacentElement('afterend', host)
          mountedGearHost = host
          setGearHost(host)
        }
      }

      if (location.pathname === '/app/settings') {
        const settingsPage = document.querySelector('.page.narrow-page')
        if (settingsPage) {
          const existing = settingsPage.querySelector(':scope > .settings-import-host') as HTMLDivElement | null
          if (existing) {
            mountedImportHost = existing
            setImportHost(existing)
          } else {
            const host = document.createElement('div')
            host.className = 'settings-import-host'
            const firstSettingsCard = settingsPage.querySelector('.settings-card')
            settingsPage.insertBefore(host, firstSettingsCard ?? null)
            mountedImportHost = host
            setImportHost(host)
          }
        }
      } else {
        setImportHost(null)
      }
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mountedGearHost?.remove()
      mountedImportHost?.remove()
    }
  }, [location.pathname])

  return (
    <>
      {gearHost && createPortal(
        <button
          className={location.pathname === '/app/settings' || location.pathname === '/app/import' ? 'icon-button settings-gear active' : 'icon-button settings-gear'}
          onClick={() => navigate('/app/settings')}
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>,
        gearHost,
      )}

      {importHost && createPortal(
        <section className="settings-card settings-import-card">
          <div>
            <span className="eyebrow">IMPORT</span>
            <h2>Import Anime List</h2>
          </div>
          <div className="settings-import-copy">
            <div>
              <strong>Import your existing watched list</strong>
              <p>Paste titles from Evernote or another list, review MyAnimeList matches, confirm them, and save the approved anime to your watched catalog.</p>
            </div>
            <button className="primary-button" onClick={() => navigate('/app/import')}>Open Import</button>
          </div>
        </section>,
        importHost,
      )}
    </>
  )
}
