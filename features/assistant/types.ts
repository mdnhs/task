export type AssistantData = {
  title: string
  subtitle: string
  greeting: string
  suggestions: string[]
  replies: { match: string[]; text: string }[]
  fallback: string
  imageReply: string
}
