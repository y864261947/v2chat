import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/guide/')({
  component: RouteComponent,
})

export function RouteComponent() {
  const navigate = useNavigate()

  useEffect(() => {
    void navigate({ to: '/settings/v2api', replace: true })
  }, [navigate])

  return null
}
