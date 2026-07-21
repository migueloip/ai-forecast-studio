export async function resolveMeetingWorkspaceContext(
  search: string,
  storedContextId: string | null,
  resolveConversation: (conversationId: string) => Promise<{ analysisId: string }>,
) {
  const params = new URLSearchParams(search)
  const explicitContext = params.get('context')
  if (explicitContext) return explicitContext
  const conversationId = params.get('conversation')
  if (!conversationId) return storedContextId
  return (await resolveConversation(conversationId)).analysisId
}
