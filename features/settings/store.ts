import { createStore } from "@/lib/store"
import type { Department, Integration, Invite, MatrixData, NotificationsData, SettingsUser, TemplateData } from "./types"

// Client stores, seeded from the route's JSON (scoped per tenant). Mock persistence: survives client navigation, resets on reload.
export const departmentsStore = createStore<Department[]>()
export const usersStore = createStore<SettingsUser[]>()
export const invitesStore = createStore<Invite[]>()
export const matrixStore = createStore<MatrixData["roles"]>()
export const templateStore = createStore<TemplateData["departments"]>()
export const notificationsStore = createStore<NotificationsData>()
export const integrationsStore = createStore<Integration[]>()
