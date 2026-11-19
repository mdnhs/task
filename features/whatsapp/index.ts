// WhatsApp notifications: an FE-only MOCK (demo flag ENABLE_MOCK_MODULES=1) until the backend exists. The routes compose it into Settings and Account through slots.
export { WhatsAppCard, WhatsAppCount } from "./components/integration-card"
export { WhatsAppManageView } from "./components/manage-view"
export { WhatsAppAccountSection } from "./components/account-section"
export { WhatsAppError, WhatsAppCardError } from "./components/error-state"
export { WhatsAppCardSkeleton, WhatsAppManageSkeleton, WhatsAppAccountSkeleton } from "./components/skeletons"
export * from "./api"
export { connectedCount } from "./logic"
export type * from "./types"
