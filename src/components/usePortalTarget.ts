'use client'

import { useEffect, useState } from 'react'

/**
 * Where dialogs and full-screen views render: the app root. Rendered inside a side panel or the
 * chat (each its own z-10 layer), a z-60 overlay would still sit under the next panel.
 * `.ui-root` rather than body, so overlays keep the interface zoom.
 */
export function usePortalTarget() {
  const [target, setTarget] = useState<Element | null>(null)
  useEffect(() => { setTarget(document.querySelector('.ui-root') || document.body) }, [])
  return target
}
