import { useParams } from 'react-router-dom'

export default function SessionPage() {
  const { sessionId } = useParams()
  return (
    <section>
      <h2 className="text-xl font-semibold">Session</h2>
      <p className="text-sm opacity-70">Session {sessionId}</p>
    </section>
  )
}
