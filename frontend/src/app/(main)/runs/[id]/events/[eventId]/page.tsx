import RunViewer from '@/components/run/RunViewer'

interface Props {
  params: Promise<{ id: string; eventId: string }>
}

export default async function EventDeepLinkPage({ params }: Props) {
  const { id, eventId } = await params
  return (
    <div className="h-[calc(100vh-3.5rem)] -mx-6 -my-6 md:-mx-8 md:-my-7 lg:-mx-10 lg:-my-8">
      <RunViewer runId={id} initialEventId={eventId} />
    </div>
  )
}
